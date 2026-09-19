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
  { pattern: /\b(echo|printf|printenv|env)\b[^\n]*\bSN_[A-Z0-9_]*(TOKEN|SECRET|KEY)\b/, reason: 'Imprimir un token o secreto lo expone en la conversación.' },
];

const PROTECTED_PATHS = [
  { pattern: /(^|\/)\.env(\.|$)/, tools: ['Read', 'Edit', 'Write'], reason: 'Archivos .env contienen secretos. Usa .env.example.' },
  { pattern: /(^|\/)(supabase\/migrations|prisma\/migrations|migrations)\/.+\.sql$/, tools: ['Edit'], reason: 'No se editan migraciones existentes. Crea una migración nueva.' },
  // Las plantillas del kit (plugin/plantillas/.github/...) no son CI activo de ningún proyecto.
  { pattern: /^(?!.*\/plantillas\/).*(^|\/)\.github\/workflows\//, tools: ['Edit', 'Write'], reason: 'Cambiar CI es R4. Requiere tech lead.' },
];

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
}

const filePath = String(args.file_path ?? args.path ?? '');
if (filePath) {
  const hit = PROTECTED_PATHS.find(({ pattern, tools }) => tools.includes(tool) && pattern.test(filePath));
  if (hit && !filePath.endsWith('.env.example')) block(hit.reason);
}

process.exit(0);
