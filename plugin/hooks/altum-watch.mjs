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
import { fileURLToPath, pathToFileURL } from 'node:url';

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
function shouldRemind(root, name = 'altum-key-remind.json') {
  const file = path.join(root, '.sn/state', name);
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

// Carpeta que todavía no es un proyecto preparado (recién creada, o repo sin la metodología):
// el agente no tiene forma de saber que este equipo trabaja con Spec Driven, así que se lo decimos al abrir la sesión.
const MOTOR_DEL_PLUGIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'sn-sync.mjs');

function orientacion(tieneClave, esRepo = false) {
  // Carpeta con un repositorio que la persona YA tenía clonado (lo más común): no se vuelve a clonar,
  // se prepara aquí mismo y se adopta el trabajo que tenga a medias.
  if (esRepo) {
    const lineas = [
      '[Softnexus] Este repositorio ya está en el computador de la persona pero todavía no tiene la metodología Spec Driven (no hay AGENTS.md ni motor en scripts/sn).',
      'NO le propongas clonarlo de nuevo ni crear otra carpeta: se trabaja aquí mismo. Usa la skill `sn`: primero `git pull` de la rama principal (puede que alguien ya lo haya preparado); si sigue sin preparar, `sn-setup` lo prepara en su propia rama sin tocar su trabajo.',
      'Si la persona estaba a mitad de un desarrollo (rama con cambios o commits), `sn` lo ADOPTA: crea su ficha y un plano con lo ya hecho y lo que falta, y sigue desde ahí. No se rehace nada.',
      `El proyecto de Altum sale solo del repositorio: \`node "${MOTOR_DEL_PLUGIN}" conectar\`. Si varios proyectos usan este repositorio, el comando los nombra: pregunta en cuál va a trabajar POR EL NOMBRE y corre \`… conectar "<nombre>"\`. Nunca pidas una "clave del proyecto".`,
    ];
    if (!tieneClave) lineas.push(FALTA_CLAVE);
    return lineas.join('\n');
  }
  const lineas = [
    '[Softnexus] Esta carpeta todavía no es un proyecto preparado con la metodología Spec Driven de Softnexus, pero la persona sí trabaja con ella.',
    'Si pide traer un proyecto ("clóname X", "bájame el repositorio", "no tengo el proyecto"): NO busques repositorios a mano en GitHub ni en el disco. Usa la skill `sn` — Altum sabe de dónde se clona cada proyecto.',
    `Motor del plugin (sirve aunque la carpeta esté vacía): \`node "${MOTOR_DEL_PLUGIN}" projects\` lista sus proyectos y \`… clone <nombre> --in <carpeta>\` lo trae. Antes de clonar, pregúntale SIEMPRE en qué carpeta lo quiere.`,
    'Para preparar esta carpeta: skill `sn-setup`. Si no sabe qué hacer: skill `sn-help`.',
  ];
  if (!tieneClave) lineas.push(FALTA_CLAVE);
  return lineas.join('\n');
}

const FALTA_CLAVE = '[Altum] Esta persona todavía no tiene guardada su clave personal de Altum, así que no verá sus proyectos ni sus tareas. '
  + 'En una línea, ofrécele guardarla ahora (un solo paso, siguiendo references/clave-altum.md del plugin; la clave nunca se escribe en el chat). Si dice que no, sigue con lo suyo.';

try {
  const payload = JSON.parse(await readStdin());
  const root = payload.cwd || process.cwd();
  const script = path.join(root, 'scripts/sn/sn-sync.mjs');
  const event = payload.hook_event_name;
  if (!existsSync(script)) {
    // Sin proyecto preparado no hay vigilante ni bandeja: solo la orientación de apertura.
    if (event === 'SessionStart') {
      const { hasKey } = await import(pathToFileURL(path.join(path.dirname(MOTOR_DEL_PLUGIN), 'sync/altum.mjs')).href);
      context(orientacion(hasKey({}), existsSync(path.join(root, '.git'))), 'SessionStart');
    }
  } else {
    const connector = altumConnector(root);
    // La clave puede estar en el entorno o, en macOS, en el Llavero: se pregunta al motor.
    const { hasKey } = await import(pathToFileURL(path.join(root, 'scripts/sn/sync/altum.mjs')).href);
    const tieneClave = hasKey(connector || {});
    if (event === 'SessionStart' && !tieneClave) {
      if (shouldRemind(root)) context(FALTA_CLAVE, 'SessionStart');
    } else if (event === 'SessionStart' && connector?.project_id) {
      // En segundo plano: el vigilante y la comprobación de si el proyecto ya tiene repositorio registrado.
      if (connector.watch !== false) spawn(process.execPath, [script, 'watch', connector.name, '--background'], { cwd: root, detached: true, stdio: 'ignore' }).unref();
      spawn(process.execPath, [script, 'repo-check'], { cwd: root, detached: true, stdio: 'ignore' }).unref();
      // Deja al líder de Altum guardado desde el primer minuto: el candado "solo el líder une el PR" lo necesita.
      spawn(process.execPath, [script, 'lead', '--github'], { cwd: root, detached: true, stdio: 'ignore' }).unref();
    } else if (event === 'SessionEnd') {
      execFileSync(process.execPath, [script, 'watch-stop'], { cwd: root, stdio: 'ignore', timeout: 5000 });
    } else if (event === 'UserPromptSubmit' && !tieneClave) {
      if (shouldRemind(root)) context(FALTA_CLAVE);
    } else if (event === 'UserPromptSubmit' && connector?.project_id) {
      const avisos = [];
      // Falta registrar de dónde se clona el proyecto: es lo primero que hay que resolver.
      const { repoReminder } = await import(pathToFileURL(path.join(root, 'scripts/sn/sync/altum-backlog.mjs')).href);
      const falta = repoReminder(root);
      if (falta && shouldRemind(root, 'altum-repo-remind.json')) {
        avisos.push(`[Altum] ${falta}\nDíselo a la persona ANTES de seguir con lo suyo, en una línea, y ofrécele hacerlo tú.`);
      }
      const notes = execFileSync(process.execPath, [script, 'inbox'], { cwd: root, encoding: 'utf8', timeout: 5000 }).trim();
      if (notes && !notes.startsWith('Sin avisos')) {
        avisos.push(`[Altum] Novedades desde el último mensaje (menciónalas en una línea a la persona):\n${notes}`);
      }
      if (avisos.length) context(avisos.join('\n\n'));
    }
  }
} catch {
  // Sin conexión, sin clave o proyecto sin Altum: seguir normal.
}
process.exit(0);
