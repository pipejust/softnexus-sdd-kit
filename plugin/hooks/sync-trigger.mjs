#!/usr/bin/env node
// PostToolUse: si el proyecto está conectado (/sn-connect), dispara la sincronización en segundo plano
// cuando el agente toca ítems, planos o ejecuta git/gh/openspec. Nunca bloquea ni falla la sesión.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const RELEVANT_PATH = /(^|\/)(docs\/items|openspec\/changes)\//;
const RELEVANT_COMMAND = /\b(git|gh|openspec)\b/;

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

try {
  const payload = JSON.parse(await readStdin());
  const root = payload.cwd || process.cwd();
  const script = path.join(root, 'scripts/sn/sn-sync.mjs');
  const input = payload.tool_input ?? {};
  const relevant = payload.tool_name === 'Bash'
    ? RELEVANT_COMMAND.test(String(input.command ?? ''))
    : RELEVANT_PATH.test(path.relative(root, path.resolve(root, String(input.file_path ?? ''))));
  if (relevant && existsSync(path.join(root, '.sn/connectors.json')) && existsSync(script)) {
    spawn(process.execPath, [script, 'sync', '--background'], { windowsHide: true, cwd: root, detached: process.platform !== 'win32', stdio: 'ignore' }).unref();
  }
} catch {
  // Payload ilegible o proyecto sin sincronización: no hacer nada.
}
process.exit(0);
