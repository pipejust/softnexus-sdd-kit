// Regresiones reproducidas durante la auditoría del 10 de octubre de 2026.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { comandos, motivoParaBloquear, uneUnPr, abreUnPr } from '../plugin/hooks/comando.mjs';
import { enviarLoQueSePueda, verifyAltumSignature, declararBloqueadores } from '../plugin/scripts/sync/altum.mjs';
import { createHmac } from 'node:crypto';
import { puedeAbrirPr } from '../plugin/scripts/sync/siguiente.mjs';
import { statusOf, planoSellado, parseLog } from '../plugin/scripts/validation-state.mjs';
const dir = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.join(dir, 'tmp'), { recursive: true });
const temp = mkdtempSync(path.join(dir, 'tmp/auditoria-'));
let ok = 0; let fallas = 0;
async function check(nombre, fn) {
  try { await fn(); ok++; console.log(`OK    ${nombre}`); }
  catch (e) { fallas++; console.log(`FALLA ${nombre}: ${e.message}`); }
}
const palabras = (s) => comandos(s)[0].palabras;
const run = (args, input, env = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, args, { cwd: temp, env: { ...process.env, SN_MOTOR_PROPIO: '1', SN_SYNC_NO_GH: '1', ...env } });
  let out = ''; child.stdout.on('data', (b) => { out += b; }); child.stderr.on('data', (b) => { out += b; });
  child.on('close', (code) => resolve({ code, out })); child.stdin.end(input);
});
const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let requests = []; let responder = () => ({ status: 200, body: { id: 't1' } });
server.on('request', async (req, res) => {
  let raw = ''; for await (const b of req) raw += b;
  const body = raw ? JSON.parse(raw) : null; requests.push(body);
  const response = responder(body);
  res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(response.body));
});
try {
  for (const cmd of ['git push origin :main', 'git push origin :refs/heads/main', "bash -lc 'git push --force origin feature'", "bash -c 'echo $SN_ALTUM_KEY | cat'"]) {
    await check(`Guard bloquea ${cmd}`, () => assert.ok(motivoParaBloquear(palabras(cmd))));
  }
  await check('Merge anidado conserva el control de líder', () => assert.ok(uneUnPr(palabras("bash -lc 'gh pr merge 1'"))));
  await check('PR anidado conserva el control de sellos', () => assert.ok(abreUnPr(palabras("sh -ec 'gh pr create'"))));
  await check('Portapapeles anidado sigue permitido', () => assert.equal(motivoParaBloquear(palabras("bash -c 'echo $SN_ALTUM_KEY | pbcopy'")), ''));
  for (const flag of ['changes_requested', 'blocked']) await check(`PR bloqueado con ${flag}`, () => assert.equal(puedeAbrirPr({ id: 'A', change: 'a', stage: 'verified', plan_sealed: true, flag }).puede, false));
  mkdirSync(path.join(temp, '.sn/state'), { recursive: true });
  writeFileSync(path.join(temp, '.sn/connectors.json'), JSON.stringify({ project: 'audit', connectors: [{ name: 'hook', kind: 'webhook', url: base, events: ['*'] }] }));
  const queue = `${JSON.stringify({ connector: 'hook', event: { type: 'sn.item.created', item: { id: 'A' } }, attempts: 0, next_at: 0 })}\n`;
  writeFileSync(path.join(temp, '.sn/state/outbox.jsonl'), queue);
  await check('Dry-run con cola y background no envía ni modifica estado', async () => {
    requests = [];
    const result = await run([path.join(dir, '../plugin/scripts/sn-sync.mjs'), 'sync', '--dry-run', '--background']);
    assert.equal(result.code, 0, result.out); assert.equal(requests.length, 0);
    assert.equal(readFileSync(path.join(temp, '.sn/state/outbox.jsonl'), 'utf8'), queue);
    assert.equal(existsSync(path.join(temp, '.sn/state/last-snapshot.json')), false);
    assert.equal(existsSync(path.join(temp, '.sn/state/lock')), false);
  });
  process.env.SN_AUDIT_TEST_KEY = 'fake-test-only';
  const connector = { base_url: base, key_env: 'SN_AUDIT_TEST_KEY' };
  await check('Altum rechaza fechas, luego padre: el estado sí llega', async () => {
    requests = [];
    responder = (body) => body.due_date ? { status: 403, body: { detail: { error: 'Sin permisos', campos: ['due_date'] } } }
      : body.parent_id ? { status: 422, body: { detail: 'Un/a historia no puede colgar de un/a historia.' } } : { status: 200, body };
    const result = await enviarLoQueSePueda(connector, 'PATCH', '/tasks/t1', { due_date: '2026-10-10', parent_id: 'p1', state: 'closed' });
    assert.equal(requests.length, 3); assert.deepEqual(result, { state: 'closed' });
  });
  await check('Estado rechazado nunca se elimina para fingir éxito', async () => {
    requests = []; responder = () => ({ status: 403, body: { detail: { error: 'Sin permisos', campos: ['state'] } } });
    await assert.rejects(enviarLoQueSePueda(connector, 'PATCH', '/tasks/t1', { state: 'closed', title: 'A' })); assert.equal(requests.length, 1);
  });
  const requested = { type: 'SOLICITUD', seal: 'plano', fields: {}, raw: '' };
  await check('Una aprobación solicitada sin identidad no vale', () => assert.equal(statusOf([requested, { type: 'APROBADO', seal: 'plano', fields: {}, raw: '' }], 'a', { github: 'lider' }).status, 'firma inválida'));
  await check('Sin líder conocido no se acepta una firma solicitada', () => assert.equal(statusOf([requested, { type: 'APROBADO', seal: 'plano', fields: { Valida: 'Ana <ana@x>' }, raw: '' }], 'a', null).status, 'firma inválida'));
  mkdirSync(path.join(temp, 'bin'));
  writeFileSync(path.join(temp, 'bin/gh'), '#!/bin/sh\necho lider\n', { mode: 0o755 });
  writeFileSync(path.join(temp, '.sn/connectors.json'), JSON.stringify({ connectors: [{ kind: 'altum', name: 'altum', project_id: 'p1', key_env: 'SN_AUDIT_UNUSED_KEY', base_url: 'http://127.0.0.1:9' }] }));
  await check('Líder vencido no autoriza merge si falla la consulta', async () => {
    writeFileSync(path.join(temp, '.sn/state/altum-lider.json'), JSON.stringify({ project_id: 'p1', name: 'Líder', github: 'lider', at: Date.now() - 13 * 60 * 60 * 1000 }));
    const result = await run([path.join(dir, '../plugin/hooks/guard.mjs')], JSON.stringify({ cwd: temp, tool_name: 'Bash', tool_input: { command: 'gh pr merge 1' } }), { PATH: `${temp}/bin:${process.env.PATH}`, SN_AUDIT_UNUSED_KEY: '' });
    assert.equal(result.code, 2, result.out); assert.match(result.out, /No pude confirmar/);
  });
  await check('Líder de otro proyecto no autoriza merge', async () => {
    writeFileSync(path.join(temp, '.sn/state/altum-lider.json'), JSON.stringify({ project_id: 'otro', name: 'Líder', github: 'lider', at: Date.now() }));
    const result = await run([path.join(dir, '../plugin/hooks/guard.mjs')], JSON.stringify({ cwd: temp, tool_name: 'Bash', tool_input: { command: "bash -c 'gh pr merge 1'" } }), { PATH: `${temp}/bin:${process.env.PATH}`, SN_AUDIT_UNUSED_KEY: '' });
    assert.equal(result.code, 2, result.out);
  });
  await check('Timestamp inválido no acepta webhook aunque su HMAC coincida', () => {
    const secret = 'fake'; const timestamp = 'incorrecto'; const rawBody = '{}';
    const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    assert.equal(verifyAltumSignature({ secret, timestamp, signature, rawBody }), false);
  });
  const suites = ['reglas-test.mjs', 'auditoria-test.mjs', 'instalador-test.sh', 'run.sh', 'altum-test.sh', 'watch-test.sh', 'proceso-test.sh', 'guard-test.sh'];
  const runnerDir = path.join(temp, 'runner'); mkdirSync(runnerDir);
  writeFileSync(path.join(runnerDir, 'todas.sh'), readFileSync(path.join(dir, 'todas.sh')));
  for (const f of suites) writeFileSync(path.join(runnerDir, f), f.endsWith('.mjs') ? 'console.log("RESULTADO: 0 OK · 0 fallas");' : 'echo "RESULTADO: 0 OK · 0 fallas"');
  await check('La batería falla si una prueba muere sin resumen', () => {
    writeFileSync(path.join(runnerDir, 'run.sh'), 'echo interrumpida\nexit 3\n');
    const result = spawnSync('bash', [path.join(runnerDir, 'todas.sh')], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stdout, /sin resumen válido/);
  });
  await check('La batería falla ante salida no cero con resumen verde', () => {
    writeFileSync(path.join(runnerDir, 'run.sh'), 'echo "RESULTADO: 2 OK · 0 fallas"\nexit 3\n');
    const result = spawnSync('bash', [path.join(runnerDir, 'todas.sh')], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stdout, /salida 3/);
  });
  const anterior = process.cwd(); const validDir = path.join(temp, 'validation'); mkdirSync(validDir);
  process.chdir(validDir);
  try {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Prueba'); git('config', 'user.email', 'prueba@x');
    mkdirSync('openspec/changes/a/specs', { recursive: true });
    writeFileSync('openspec/changes/a/proposal.md', 'Diseño aprobado\n'); writeFileSync('openspec/changes/a/tasks.md', '- [ ] construir\n');
    git('add', '.'); git('commit', '-qm', 'plan'); const commit = git('rev-parse', 'HEAD');
    const approval = (hash) => `## 2026-10-10 12:00 · APROBADO · sello: plano\n- Valida: Persona <prueba@x>\n- Commit validado: ${hash}\n`;
    writeFileSync('openspec/changes/a/validacion.md', approval(commit));
    await check('Marcar tareas conserva el sello del plano', () => { writeFileSync('openspec/changes/a/tasks.md', '- [x] construir\n'); assert.ok(planoSellado('a')); });
    await check('Cambiar el texto de una tarea exige nuevo sello', () => { writeFileSync('openspec/changes/a/tasks.md', '- [x] otro alcance\n'); assert.equal(planoSellado('a'), false); writeFileSync('openspec/changes/a/tasks.md', '- [x] construir\n'); });
    await check('Editar diseño sin commit invalida el sello', () => { writeFileSync('openspec/changes/a/proposal.md', 'Otro diseño\n'); assert.equal(planoSellado('a'), false); });
    git('checkout', '--', 'openspec/changes/a/proposal.md', 'openspec/changes/a/tasks.md');
    git('checkout', '-qb', 'otra'); writeFileSync('otro.txt', 'otro'); git('add', 'otro.txt'); git('commit', '-qm', 'otro'); const ajeno = git('rev-parse', 'HEAD'); git('checkout', '-q', 'main');
    await check('Commit de otra rama no cuenta como validación verificable', () => assert.equal(statusOf(parseLog(approval(ajeno)), 'a', null).status, 'sin commit verificable'));
    await check('Dependencia con fallo temporal se vuelve a declarar', async () => {
      requests = []; responder = (body) => body ? { status: 503, body: {} } : { status: 200, body: [] };
      await assert.rejects(declararBloqueadores(connector, 't1', { id: 'A', blockers: ['B'] }, new Map([['B', 't2']])));
      assert.equal(existsSync('.sn/state/altum-bloqueadores.json'), false);
      responder = (body) => ({ status: 200, body: body || [] });
      await declararBloqueadores(connector, 't1', { id: 'A', blockers: ['B'] }, new Map([['B', 't2']]));
      assert.equal(requests.filter((b) => b?.blocker_id === 't2').length, 2);
    });
  } finally { process.chdir(anterior); }
} finally { await new Promise((resolve) => server.close(resolve)); rmSync(temp, { recursive: true, force: true }); }
console.log(`\nRESULTADO: ${ok} OK · ${fallas} fallas`);
process.exitCode = fallas ? 1 : 0;
