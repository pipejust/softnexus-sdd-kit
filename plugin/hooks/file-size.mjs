#!/usr/bin/env node
// Hook de tamaño de archivo (Softnexus).
//  PreToolUse  Write|Edit|MultiEdit : calcula cómo quedaría el archivo y BLOQUEA (exit 2) si supera MAX_LINES.
//  PostToolUse Write|Edit|MultiEdit : si el archivo quedó sobre WARN_LINES, avisa al agente para dividirlo pronto.
// Las reglas (límites, excepciones, .sn-size-ignore) vienen del mismo script que usa el CI.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MAX_LINES, WARN_LINES, countLines, isChecked, loadBaseline, loadIgnores,
} from '../plantillas/scripts/check-file-size.mjs';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

function applyEdit(text, { old_string: oldText = '', new_string: newText = '', replace_all: all = false }) {
  if (!oldText) return text;
  return all ? text.split(oldText).join(newText) : text.replace(oldText, () => newText);
}

function resultingText(tool, input, filePath) {
  if (tool === 'Write') return String(input.content ?? '');
  const current = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  if (tool === 'Edit') return applyEdit(current, input);
  if (tool === 'MultiEdit') return (input.edits ?? []).reduce(applyEdit, current);
  return current;
}

const raw = await readStdin();
let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0); // Payload ilegible: no bloquear la sesión.
}

const tool = payload.tool_name ?? '';
const input = payload.tool_input ?? {};
const filePath = String(input.file_path ?? '');
const root = payload.cwd || process.cwd();
if (!filePath || !['Write', 'Edit', 'MultiEdit'].includes(tool)) process.exit(0);

const absolute = path.resolve(root, filePath);
const relative = path.relative(root, absolute);

// Los archivos de control del límite solo pueden endurecerse, nunca aflojarse, desde un agente.
function parseBaseline(text) {
  return new Map(text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('\t')).map(([f, n]) => [f, Number(n)]));
}
function block(reason) {
  process.stderr.write(`[softnexus-size] BLOQUEADO: ${reason}\nEsto lo decide el líder técnico.\n`);
  process.exit(2);
}
const controlFile = path.basename(absolute);
if (payload.hook_event_name !== 'PostToolUse' && ['.sn-size-baseline', '.sn-size-ignore'].includes(controlFile) && existsSync(absolute)) {
  const previous = readFileSync(absolute, 'utf8');
  const next = resultingText(tool, input, absolute);
  if (controlFile === '.sn-size-ignore' && next !== previous) {
    block('agregar o cambiar excepciones en .sn-size-ignore no lo hace un agente.');
  }
  if (controlFile === '.sn-size-baseline') {
    const before = parseBaseline(previous);
    const grew = [...parseBaseline(next)].find(([f, n]) => !before.has(f) || n > before.get(f));
    if (grew) block(`la deuda heredada solo puede bajar (${grew[0]}: ${grew[1]} líneas).`);
  }
  process.exit(0);
}
if (!isChecked(relative, loadIgnores(root))) process.exit(0);

if (payload.hook_event_name === 'PostToolUse') {
  const lines = existsSync(absolute) ? countLines(readFileSync(absolute, 'utf8')) : 0;
  if (lines > WARN_LINES) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: loadBaseline(root).has(relative)
          ? `[softnexus-size] ${relative} es deuda heredada (${lines} líneas). No lo hagas crecer; propón reducirlo con la skill sn-split.`
          : `[softnexus-size] ${relative} tiene ${lines} líneas (aviso desde ${WARN_LINES}, máximo ${MAX_LINES}). En la próxima edición pon el código nuevo en un módulo aparte con una responsabilidad clara; no esperes a llegar al límite.`,
      },
    }));
  }
  process.exit(0);
}

const before = existsSync(absolute) ? countLines(readFileSync(absolute, 'utf8')) : 0;
const after = countLines(resultingText(tool, input, absolute));
// Un archivo que ya estaba sobre el límite (deuda heredada) puede editarse si el cambio no lo hace crecer.
if (after > MAX_LINES && after > before) {
  const inherited = before > MAX_LINES || loadBaseline(root).has(relative);
  const howTo = inherited
    ? 'Es deuda heredada: no puede crecer. Pon el código nuevo en otro módulo, o reduce este archivo con la skill sn-split.\n'
    : 'Extrae ahora, en esta misma tarea, el código nuevo a un módulo aparte con una responsabilidad clara.\n';
  process.stderr.write(
    `[softnexus-size] BLOQUEADO: ${relative} quedaría con ${after} líneas (máximo ${MAX_LINES}).\n${howTo}`
    + 'Si es un archivo generado o de datos, agrégalo a .sn-size-ignore (requiere aprobación del líder técnico).\n',
  );
  process.exit(2);
}
process.exit(0);
