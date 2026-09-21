#!/usr/bin/env node
// PreToolUse guard for Softnexus SDD. Exit code 2 blocks the tool call and shows stderr to the agent.
// Deterministic rules only: things that must never depend on the agent "remembering".

const BLOCKED_COMMANDS = [
  { pattern: /\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME|\.\.?)(\s|$)/i, reason: 'Borrado recursivo de raíz, home o directorio actual.' },
  { pattern: /\bgit\s+push\b.*(--force|-f)\b/i, reason: 'git push --force está prohibido. Abre un PR.' },
  { pattern: /\bgit\s+push\b.*\b(main|master|production)\b/i, reason: 'Push directo a rama protegida. Usa un PR.' },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: 'git reset --hard destruye trabajo. Pide confirmación humana.' },
  { pattern: /\bsupabase\s+db\s+(reset|push)\b.*--linked/i, reason: 'Operación sobre la base de datos remota enlazada. Solo el tech lead.' },
  { pattern: /\b(drop\s+(table|schema|database)|truncate\s+table)\b/i, reason: 'DDL destructivo. Crea una migración y pide revisión R3.' },
  { pattern: /\b(cat|less|more|head|tail|source)\s+[^|;]*\.env(\.|\s|$)/i, reason: 'Leer .env expone secretos al contexto del agente.' },
  { pattern: /\bvercel\s+(--prod|deploy\s+.*--prod)\b/i, reason: 'Deploy a producción manual. Producción sale solo por pipeline.' },
  { pattern: /\bnpm\s+publish\b/i, reason: 'Publicar paquetes requiere aprobación humana.' },
  { pattern: /\bgit\s+clone\s+(?:-[^\s]+\s+)*(?:https?:\/\/|git@|ssh:\/\/|file:\/\/)[^\s]+\s*(?:&&|;|\||$)/i,
    reason: 'git clone sin carpeta de destino: la deja donde estés. Pregúntale a la persona DÓNDE la quiere '
      + '(carpeta madre o ruta exacta) y clona con "node scripts/sn/sn-sync.mjs clone <proyecto> --in <carpeta> | --into <ruta>", '
      + 'o con "git clone <url> <ruta>" si el repositorio no está en Altum.' },
  { pattern: /\bgh\s+repo\s+clone\s+[^\s]+\s*(?:&&|;|\||$)/i,
    reason: 'gh repo clone sin carpeta de destino: la deja donde estés. Pregunta primero dónde la quiere la persona.' },
  { pattern: /\b(echo|printf)\b[^\n]*\$\{?SN_[A-Z0-9_]*(TOKEN|SECRET|KEY|PAT)\b|\bprintenv\b[^\n|]*\bSN_[A-Z0-9_]*(TOKEN|SECRET|KEY|PAT)\b|\b(printenv|env)\s*(\||$)/, reason: 'Imprimir un token o secreto lo expone en la conversación.' },
];

const PROTECTED_PATHS = [
  { pattern: /(^|\/)\.env(\.|$)/, tools: ['Read', 'Edit', 'Write'], reason: 'Archivos .env contienen secretos. Usa .env.example.' },
  { pattern: /(^|\/)(supabase\/migrations|prisma\/migrations|migrations)\/.+\.sql$/, tools: ['Edit'], reason: 'No se editan migraciones existentes. Crea una migración nueva.' },
  // Las plantillas del kit (plugin/plantillas/.github/...) no son CI activo de ningún proyecto.
  { pattern: /^(?!.*\/plantillas\/).*(^|\/)\.github\/workflows\//, tools: ['Edit', 'Write'], reason: 'Cambiar CI es R4. Requiere tech lead.' },
];

async function motivoParaNoUnir(cwd) {
  try {
    const { execFileSync } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const lider = JSON.parse(readFileSync(`${cwd}/.sn/state/altum-lider.json`, 'utf8'));
    if (!lider?.github) return ''; // sin líder conocido con GitHub no se puede comprobar: no se bloquea
    const yo = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).trim();
    if (yo && yo.toLowerCase() !== lider.github.toLowerCase()) {
      return `Solo el líder del proyecto (${lider.name}, @${lider.github}) une el PR: es quien cierra el proceso. Él lo hace desde su Claude con /sn-validate. Tú ya terminaste tu parte: el PR queda esperando su aprobación.`;
    }
    return '';
  } catch {
    return '';
  }
}

async function motivoParaNoAbrirPr(cwd) {
  try {
    const { execFileSync } = await import('node:child_process');
    const { existsSync } = await import('node:fs');
    if (!existsSync(`${cwd}/docs/items`)) return '';
    process.chdir(cwd);
    process.env.SN_SYNC_NO_GH = '1'; // para abrir el PR no hace falta preguntarle a GitHub; así es rápido
    const rama = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
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
    return ''; // si no se puede leer el estado, no se bloquea por esto (lo demás del guard sigue)
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

const raw = await readStdin();
let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0); // Malformed hook payload: do not block the session.
}

const tool = input.tool_name ?? '';
const args = input.tool_input ?? {};

if (tool === 'Bash') {
  // Cada comando de una cadena (a && b; c | d) se evalúa por separado para no mezclar palabras entre comandos.
  const segments = String(args.command ?? '').split(/&&|\|\||;|\||\n/);
  const hit = BLOCKED_COMMANDS.find(({ pattern }) => segments.some((segment) => pattern.test(segment)));
  if (hit) block(hit.reason);
  // Sellos: no se abre un PR si el plano del ítem de esta rama no tiene su sello 1 o falta la evidencia.
  // Es determinista a propósito: el agente no puede "saltarse el sello y seguir adelante".
  // Unir el PR es cerrar el proceso: solo lo hace el líder que dice Altum (desde /sn-validate).
  if (segments.some((segment) => /\bgh\s+pr\s+merge\b|\baz\s+repos\s+pr\s+update\b.*--status\s+completed/.test(segment))) {
    const motivo = await motivoParaNoUnir(input.cwd || process.cwd());
    if (motivo) block(motivo);
  }
  if (segments.some((segment) => /\b(gh\s+pr\s+create|az\s+repos\s+pr\s+create)\b/.test(segment))) {
    const motivo = await motivoParaNoAbrirPr(input.cwd || process.cwd());
    if (motivo) block(`Falta un paso del proceso: ${motivo}`);
  }
}

const filePath = String(args.file_path ?? args.path ?? '');
if (filePath) {
  const hit = PROTECTED_PATHS.find(({ pattern, tools }) => tools.includes(tool) && pattern.test(filePath));
  if (hit && !filePath.endsWith('.env.example')) block(hit.reason);
}

process.exit(0);
