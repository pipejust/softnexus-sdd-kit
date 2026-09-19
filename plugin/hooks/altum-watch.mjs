#!/usr/bin/env node
// Vigilante de Altum ligado a la sesión (sin n8n) y recordatorio de la clave personal:
//   SessionStart     -> arranca en segundo plano `sn-sync watch <altum>` si el proyecto tiene conector altum y clave
//   UserPromptSubmit -> entrega al agente los avisos nuevos (tareas nuevas o cambiadas en Altum) y vacía la bandeja;
//                       si la persona todavía no tiene su clave, se lo recuerda (una vez cada 12 h) para que se la ofrezca guardar
//   SessionEnd       -> detiene el vigilante
// Nunca bloquea la sesión: ante cualquier problema, no hace nada.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REMIND_EVERY_MS = 12 * 60 * 60 * 1000;

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

function altumConnector(root) {
  const file = path.join(root, '.sn/connectors.json');
  if (!existsSync(file)) return null;
  const { connectors = [] } = JSON.parse(readFileSync(file, 'utf8'));
  return connectors.find((c) => c.kind === 'altum' && c.enabled !== false) || null;
}

// Un recordatorio cada 12 h como máximo: no se le insiste a quien todavía no quiere conectar Altum.
function shouldRemind(root) {
  const file = path.join(root, '.sn/state/altum-key-remind.json');
  try {
    if (existsSync(file) && Date.now() - JSON.parse(readFileSync(file, 'utf8')).at < REMIND_EVERY_MS) return false;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

function context(text, hookEventName = 'UserPromptSubmit') {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } }));
}

const FALTA_CLAVE = '[Altum] Esta persona todavía no tiene guardada su clave personal de Altum, así que no verá sus proyectos ni sus tareas. '
  + 'En una línea, ofrécele guardarla ahora (un solo paso, siguiendo references/clave-altum.md del plugin; la clave nunca se escribe en el chat). Si dice que no, sigue con lo suyo.';

try {
  const payload = JSON.parse(await readStdin());
  const root = payload.cwd || process.cwd();
  const script = path.join(root, 'scripts/sn/sn-sync.mjs');
  const event = payload.hook_event_name;
  if (existsSync(script)) {
    const connector = altumConnector(root);
    // La clave puede estar en el entorno o, en macOS, en el Llavero: se pregunta al motor.
    const { hasKey } = await import(pathToFileURL(path.join(root, 'scripts/sn/sync/altum.mjs')).href);
    const tieneClave = hasKey(connector || {});
    if (event === 'SessionStart' && !tieneClave) {
      if (shouldRemind(root)) context(FALTA_CLAVE, 'SessionStart');
    } else if (event === 'SessionStart' && connector?.project_id && connector.watch !== false) {
      spawn(process.execPath, [script, 'watch', connector.name, '--background'], { cwd: root, detached: true, stdio: 'ignore' }).unref();
    } else if (event === 'SessionEnd') {
      execFileSync(process.execPath, [script, 'watch-stop'], { cwd: root, stdio: 'ignore', timeout: 5000 });
    } else if (event === 'UserPromptSubmit' && !tieneClave) {
      if (shouldRemind(root)) context(FALTA_CLAVE);
    } else if (event === 'UserPromptSubmit' && connector?.project_id) {
      const notes = execFileSync(process.execPath, [script, 'inbox'], { cwd: root, encoding: 'utf8', timeout: 5000 }).trim();
      if (notes && !notes.startsWith('Sin avisos')) {
        context(`[Altum] Novedades desde el último mensaje (menciónalas en una línea a la persona):\n${notes}`);
      }
    }
  }
} catch {
  // Sin conexión, sin clave o proyecto sin Altum: seguir normal.
}
process.exit(0);
