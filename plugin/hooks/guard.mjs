#!/usr/bin/env node
// PreToolUse guard for Softnexus SDD. Exit code 2 blocks the tool call and shows stderr to the agent.
// Deterministic rules only: things that must never depend on the agent "remembering".
// Es prevención de accidentes, no un encierro: las reglas de comandos viven en comando.mjs.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abreUnPr, comandos, esSumidero, motivoParaBloquear, uneUnPr } from './comando.mjs';

const MOTOR = fileURLToPath(new URL('../scripts/sn-sync.mjs', import.meta.url));
const LIDER_VIEJO_MS = 12 * 60 * 60 * 1000;

const ES_ENV = /(^|\/)\.env(\.[^/]*)?$/i;
const ENV_DE_EJEMPLO = /\.(example|sample|template|dist|defaults)$/i;
const PROTECTED_PATHS = [
  { prueba: (f) => ES_ENV.test(f) && !ENV_DE_EJEMPLO.test(f), tools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Grep', 'NotebookEdit'], reason: 'Archivos .env contienen secretos. Usa .env.example.' },
  // Las plantillas del kit (plugin/plantillas/.github/...) no son CI activo de ningún proyecto.
  { prueba: (f) => /(^|\/)\.github\/workflows\//.test(f) && !/\/plantillas\//.test(f), tools: ['Edit', 'Write', 'MultiEdit'], reason: 'Cambiar CI es R4. Requiere tech lead.' },
  { prueba: (f) => /(^|\/)\.sn\/state\/altum-lider\.json$/.test(f), tools: ['Edit', 'Write', 'MultiEdit'], reason: 'Quién es el líder lo dice Altum: ese archivo lo escribe el plugin (sn-sync lead), no se edita a mano.' },
];
const ES_MIGRACION = (f) => /(^|\/)(supabase\/migrations|prisma\/migrations|migrations)\/.+\.sql$/.test(f);

function leerJson(archivo) {
  try {
    return JSON.parse(readFileSync(archivo, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

// Solo el líder que dice Altum une el PR. Falla CERRADO: si el repositorio está unido a Altum y no se
// puede confirmar quién es el líder o quién está trabajando, no se une (antes, sin red o sin sesión
// de gh, pasaba cualquiera). Un repositorio sin Altum no tiene este candado.
function motivoParaNoUnir(cwd) {
  const conectores = leerJson(path.join(cwd, '.sn/connectors.json'))?.connectors || [];
  const proyecto = conectores.find((c) => c.kind === 'altum' && c.project_id && c.enabled !== false)?.project_id;
  if (!proyecto) return '';
  const archivo = path.join(cwd, '.sn/state/altum-lider.json');
  let lider = leerJson(archivo);
  const vigente = (l) => l?.name && l.project_id === proyecto && Number.isFinite(l.at) && l.at <= Date.now() && Date.now() - l.at <= LIDER_VIEJO_MS;
  if (!vigente(lider)) {
    // Se pregunta a Altum con el motor del plugin (el que la persona mantiene al día).
    try { execFileSync(process.execPath, [MOTOR, 'lead', '--github'], { cwd, stdio: 'ignore', timeout: 15000, windowsHide: true }); } catch { /* sin clave o sin red */ }
    lider = leerJson(archivo) || lider;
  }
  if (!vigente(lider)) {
    return 'No pude confirmar con Altum quién es el líder del proyecto (sin conexión o sin tu clave). Solo el líder une el PR: inténtalo cuando haya conexión.';
  }
  if (!lider.github) {
    return `El líder (${lider.name}) no tiene su usuario de GitHub registrado en Altum, así que no puedo confirmar quién une el PR. Que lo registre en Altum (Mi perfil) y vuelve a intentarlo.`;
  }
  let yo = '';
  try {
    yo = execFileSync('gh', ['api', 'user', '--jq', '.login'], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).trim();
  } catch { /* sin gh, sin sesión o sin red */ }
  if (!yo) return 'No pude confirmar tu usuario de GitHub (gh sin sesión o sin red: "gh auth status"). Solo el líder une el PR.';
  if (yo.toLowerCase() !== lider.github.toLowerCase()) {
    return `Solo el líder del proyecto (${lider.name}, @${lider.github}) une el PR: es quien cierra el proceso. Él lo hace desde su Claude con /sn-validate. Tú ya terminaste tu parte: el PR queda esperando su aprobación.`;
  }
  return '';
}

async function motivoParaNoAbrirPr(cwd) {
  try {
    if (!existsSync(path.join(cwd, 'docs/items'))) return '';
    process.chdir(cwd);
    process.env.SN_SYNC_NO_GH = '1'; // para abrir el PR no hace falta preguntarle a GitHub; así es rápido
    const rama = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const aqui = new URL('../scripts/sync/', import.meta.url);
    const { takeSnapshot } = await import(new URL('snapshot.mjs', aqui).href);
    const { puedeAbrirPr } = await import(new URL('siguiente.mjs', aqui).href);
    const items = takeSnapshot('', { solo: (i) => i.branch === rama }).items;
    for (const item of items) {
      const { puede, motivo } = puedeAbrirPr(item);
      if (!puede) return motivo;
    }
    return '';
  } catch {
    return 'No pude verificar los sellos y la evidencia del repositorio. Corrige el estado antes de abrir el PR.';
  }
}

function block(reason) {
  process.stderr.write(`[softnexus-guard] BLOQUEADO: ${reason}\nSi es realmente necesario, explícale a la persona por qué y que lo haga el tech lead.\n`);
  process.exit(2);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

let input = null;
try {
  input = JSON.parse(await readStdin());
} catch { /* payload roto: no se bloquea la sesión */ }
if (!input || typeof input !== 'object') process.exit(0);

const tool = input.tool_name ?? '';
const args = input.tool_input ?? {};
const cwd = input.cwd || process.cwd();

if (tool === 'Bash') {
  let rama = null;
  const ramaActual = () => { if (rama === null) rama = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']); return rama; };
  const lista = comandos(args.command);
  lista.forEach(({ palabras, siguiente }, idx) => {
    // Lo que se pasa a un sumidero (portapapeles, "gh secret set"…) no vuelve a imprimirse en la
    // conversación; hacia cualquier otra cosa (grep, cat, tee…) sí puede volver a aparecer.
    const pipedOut = siguiente === '|' && esSumidero(lista[idx + 1]?.palabras || []);
    const motivo = motivoParaBloquear(palabras, { ramaActual, pipedOut });
    if (motivo) block(motivo);
  });
  // Unir el PR es cerrar el proceso: solo lo hace el líder que dice Altum (desde /sn-validate).
  if (lista.some(({ palabras }) => uneUnPr(palabras))) {
    const motivo = motivoParaNoUnir(cwd);
    if (motivo) block(motivo);
  }
  // Sellos: no se abre un PR si el plano del ítem de esta rama no tiene su sello 1 o falta la evidencia.
  // Es determinista a propósito: el agente no puede "saltarse el sello y seguir adelante".
  if (lista.some(({ palabras }) => abreUnPr(palabras))) {
    const motivo = await motivoParaNoAbrirPr(cwd);
    if (motivo) block(`Falta un paso del proceso: ${motivo}`);
  }
}

// Rutas de Windows (C:\proyecto\.env) se comparan igual que las de macOS/Linux.
const filePath = String(args.file_path ?? args.notebook_path ?? args.path ?? '').replace(/\\/g, '/');
if (filePath) {
  const hit = PROTECTED_PATHS.find(({ prueba, tools }) => tools.includes(tool) && prueba(filePath));
  if (hit) block(hit.reason);
  // Migraciones: solo es "existente" (intocable con Edit) si git ya la tiene guardada. Una que el
  // agente acaba de crear con Write, en la misma tarea, se puede corregir con Edit sin problema.
  // Write SÍ se bloquea si ya hay un archivo ahí: eso es sobrescribir una migración que alguien guardó.
  if (ES_MIGRACION(filePath)) {
    const absoluto = path.resolve(cwd, filePath);
    if (tool === 'Edit' || tool === 'MultiEdit') {
      const versionada = (() => {
        try {
          execFileSync('git', ['-C', cwd, 'ls-files', '--error-unmatch', filePath], { stdio: 'ignore', timeout: 5000, windowsHide: true });
          return true;
        } catch {
          return false;
        }
      })();
      if (versionada) block('No se editan migraciones existentes. Crea una migración nueva.');
    }
    if (tool === 'Write' && existsSync(absoluto)) block('Ya existe una migración con ese nombre. No se sobrescribe: crea una migración nueva.');
  }
}

process.exit(0);
