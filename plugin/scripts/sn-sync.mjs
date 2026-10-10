#!/usr/bin/env node
// Softnexus sync: mantiene los sistemas de tareas externos al día con el proceso Spec Driven.
//   node sn-sync.mjs sync [--background] [--upsert-only] [--dry-run]   envía los cambios desde la última vez
//   node sn-sync.mjs test [conector]                                     prueba la conexión (evento sn.test)
//   node sn-sync.mjs export [--format csv|json] [--out archivo]          exporta los ítems para otro sistema
//   node sn-sync.mjs fetch <conector> <id-externo>                       trae una tarea del sistema externo
//   node sn-sync.mjs list                                                ítems y su etapa (Markdown, sin conexión)
//   node sn-sync.mjs show <ID>                                           ficha completa + commits, firmas, evidencia
//   node sn-sync.mjs whoami                                              de quién es la clave y qué proyectos tiene
//   node sn-sync.mjs projects [--json]                                   proyectos que ve la clave, por nombre
//   node sn-sync.mjs clone <nombre> [--in <carpeta>|--into <ruta>] clona ese proyecto desde el repo_url de Altum
//   node sn-sync.mjs conectar [nombre]                                une este repo con su proyecto de Altum (lo reconoce por el remoto)
//   node sn-sync.mjs set-repo <nombre> [url]                     registra en Altum de dónde se clona (por defecto, el remoto)
//   node sn-sync.mjs repo-check                                          ¿este proyecto tiene repositorio registrado en Altum?
//   node sn-sync.mjs backlog <altum> [--all] [--json]                    tareas del proyecto: pendientes y si ya están en el repo
//   node sn-sync.mjs pull <altum> [--apply] [--include-closed]           Altum -> repo: tareas abiertas sin traer (--apply las crea)
//   node sn-sync.mjs link <ITEM> <altum> <id-tarea>                      enlaza un ítem con una tarea que ya existe en Altum
//   node sn-sync.mjs watch <altum> [--background] [--every 60]           vigila Altum mientras se trabaja (sin n8n)
//   node sn-sync.mjs watch-stop | inbox [--peek]                         detiene el vigilante / muestra los avisos pendientes
//   node sn-sync.mjs status                                              conectores, pendientes, última sync
//   node sn-sync.mjs githooks                                            activa la sync en commit/merge/pull (agrega, no reemplaza)
// Se ejecuta en la raíz del repositorio. Sin .sn/connectors.json no hace nada (proyecto no conectado).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, esDeActen, hasKey, keyName, listTasks, NotRetryable, projectStates, tareaDeLaFicha } from './sync/altum.mjs';
import { addProjectRepo, backlogMarkdown, identificarRepo, integrantes, miEmpleado, nombreParaGit, checkProjectRepo, fetchAltumTask, leadText, listProjects, listRepos, projectLead, pullAltum, readBacklog, removeProjectRepo, repoReminder, whoAmI, whoAmIText } from './sync/altum-backlog.mjs';
import { alreadyThere, cloneProject, findProject, findRepo, projectsForRepo, targetDir } from './sync/altum-clone.mjs';
import { clearInbox, describe, isWatching, readInbox, stopWatch, watch } from './sync/altum-watch.mjs';
import { deliver, fetchExternal } from './sync/connectors.mjs';
import { readItems, setExternalId, writeImportedItem } from './sync/items.mjs';
import { diffSnapshots, matches } from './sync/events.mjs';
import { itemMarkdown, listMarkdown } from './sync/report.mjs';
import { takeSnapshot } from './sync/snapshot.mjs';
import { mensajeValidacion } from './sync/validacion-mensaje.mjs';
import { aprobacionesPr, firmaDelLider, origenRepo, prDeRama } from './sync/pr.mjs';
import { siguientePaso } from './sync/siguiente.mjs';
import { catalogo, comoActualizar, declaraElPlugin, dejarDeDeclarar, ejecutarPasos, esMasNueva, gitAtrasado, instalaciones, pasosInstalacionGeneral, pasosLimpieza, pasosParaActualizar, proyectosConCopia, ultimaPublicada, versionInstalada, versionPublicadaDeVerdad } from './sync/version.mjs';
import { parseLog } from './validation-state.mjs';
import { leerTexto } from './sync/texto.mjs';
import { codeownersConLider } from './sync/lider.mjs';
import {
  acquireLock, anotarDescartado, appendOutbox, CONFIG_FILE, DESCARTADOS_FILE, loadConfig, loadSnapshot, readOutbox, refreshLock, releaseLock, saveSnapshot, writeOutbox,
} from './sync/store.mjs';

const SELF = fileURLToPath(import.meta.url);
const DEBOUNCE_MS = 3000;
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

// Remoto "origin" de este repositorio, para registrarlo en Altum sin escribirlo a mano.
function remoteUrl() {
  try {
    return execFileSync('git', ['config', '--get', 'remote.origin.url'], { windowsHide: true, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function localActor() {
  try {
    const name = execFileSync('git', ['config', 'user.name'], { windowsHide: true, encoding: 'utf8' }).trim();
    const email = execFileSync('git', ['config', 'user.email'], { windowsHide: true, encoding: 'utf8' }).trim();
    return `${name} <${email}>`;
  } catch {
    return '';
  }
}

// Las notificaciones a personas (Matrix) solo salen desde el computador de quien hizo el cambio,
// para que la sala no reciba el mismo aviso desde cada computador que hace pull. En CI siempre salen.
function wanted(connector, evt, me) {
  if (!matches(connector.events, evt)) return false;
  const onlyMine = connector.only_local_actor ?? connector.kind === 'matrix';
  return !onlyMine || process.env.CI === 'true' || !evt.actor || evt.actor === me;
}

async function attempt(connector, evt, attempts = 0) {
  try {
    await deliver(connector, evt);
    return true;
  } catch (error) {
    if (error instanceof NotRetryable) {
      // Reintentar no cambia nada (es una regla del sistema externo), pero NO se da por entregado:
      // en segundo plano nadie ve la consola, así que queda escrito y "status" lo muestra.
      console.error(`sn-sync: ${connector.name} ${evt.item?.id || ''}: ${error.message}`);
      anotarDescartado({ conector: connector.name, item: evt.item?.id || '', error: error.message });
      return false;
    }
    appendOutbox({ connector: connector.name, event: evt, attempts: attempts + 1, error: error.message, at: new Date().toISOString() });
    return false;
  }
}

async function retryOutbox(config) {
  const pending = readOutbox();
  if (!pending.length) return { retried: 0, dropped: 0 };
  // La foto se toma ANTES de tocar la cola: si leerla falla (git, red, gh), la cola sigue intacta.
  // Antes se vaciaba primero y un error aquí la borraba completa, sin dejar rastro.
  const fresca = new Map(takeSnapshot(config.project).items.map((i) => [i.id, i]));
  writeOutbox([]);
  const byName = new Map(config.connectors.map((c) => [c.name, c]));
  let retried = 0;
  // Al reintentar se usa la ficha de AHORA, no la que quedó guardada cuando falló: si entre tanto la
  // ficha cambió, reenviar la versión vieja revertía Altum. Si la ficha ya no existe, el evento sobra.
  for (const entry of pending) {
    const connector = byName.get(entry.connector);
    const id = entry.event?.item?.id;
    if (id && !fresca.has(id)) {
      anotarDescartado({ conector: entry.connector, item: id, error: 'su ficha ya no existe en el repositorio' });
      continue;
    }
    if (!connector) {
      // El conector se apagó o se renombró: el evento no se puede entregar, y eso se dice.
      anotarDescartado({ conector: entry.connector, item: id || '', error: 'ese conector ya no está en .sn/connectors.json (o quedó apagado)' });
      continue;
    }
    const evento = id ? { ...entry.event, item: fresca.get(id) } : entry.event;
    if (await attempt(connector, evento, entry.attempts)) retried += 1;
  }
  const dropped = writeOutbox(readOutbox());
  return { retried, dropped };
}

function upsertEvents(snapshot) {
  return snapshot.items.map((item) => ({
    specversion: '1.0', id: `${item.id}:${item.stage}:${item.flag}:${item.tasks_done ?? ''}`, type: 'sn.item.upserted',
    source: snapshot.source, project: snapshot.project, time: snapshot.taken_at, actor: item.actor, item,
  }));
}

async function sync(config) {
  if (flag('--background')) {
    spawn(process.execPath, [SELF, 'sync', '--delay'], { windowsHide: true, detached: process.platform !== 'win32', stdio: 'ignore', cwd: process.cwd(), env: process.env }).unref();
    return;
  }
  if (flag('--delay')) await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS));
  if (!acquireLock()) return; // otra sincronización en curso; el siguiente disparo recoge lo que falte
  try {
    const outbox = await retryOutbox(config);
    const snapshot = takeSnapshot(config.project);
    const upsertOnly = flag('--upsert-only');
    const events = upsertOnly ? upsertEvents(snapshot) : diffSnapshots(loadSnapshot(), snapshot);
    const targets = upsertOnly ? config.connectors.filter((c) => ['rest', 'github', 'altum'].includes(c.kind)) : config.connectors;
    const me = localActor();
    let sent = 0;
    let failed = 0;
    for (const evt of events) {
      for (const connector of targets.filter((c) => wanted(c, evt, me))) {
        if (flag('--dry-run')) {
          console.log(`[dry-run] ${connector.name} <- ${evt.type} ${evt.item.id} (${evt.item.stage})`);
        } else if (await attempt(connector, evt)) sent += 1; else failed += 1;
        refreshLock();   // una corrida larga no debe perder el candado a mitad de camino
      }
    }
    if (!flag('--dry-run')) saveSnapshot(snapshot);
    if (!flag('--quiet')) {
      console.log(`sn-sync: ${events.length} eventos · ${sent} entregas · ${failed} en cola`
        + ` · reintentos ok ${outbox.retried}${outbox.dropped ? ` · descartados ${outbox.dropped}` : ''}`);
    }
  } finally {
    releaseLock();
  }
}

async function test(config) {
  const only = args[1];
  const snapshot = { source: 'sn-sync test', project: config.project || path.basename(process.cwd()), taken_at: new Date().toISOString() };
  const item = { id: 'SN-TEST', type: 'chore', title: 'Prueba de conexión Softnexus', stage: 'triaged', stage_label: 'Tarjeta', flag: '', risk: 'R0', size: 'XS' };
  const evt = { specversion: '1.0', id: `test-${Date.now()}`, type: 'sn.test', ...snapshot, time: snapshot.taken_at, item };
  let ok = true;
  for (const connector of config.connectors.filter((c) => !only || c.name === only)) {
    try {
      await deliver(connector, evt);
      console.log(`OK     ${connector.name} (${connector.kind})`);
    } catch (error) {
      ok = false;
      console.log(`FALLA  ${connector.name} (${connector.kind}): ${error.message}`);
    }
  }
  process.exitCode = ok ? 0 : 1;
}

function csvCell(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return /[",;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportItems(config) {
  const { items } = takeSnapshot(config?.project);
  const format = option('--format', 'csv');
  const columns = ['id', 'type', 'title', 'stage', 'stage_label', 'flag', 'risk', 'size', 'assignee', 'branch', 'change', 'pr_url', 'commit_count', 'file', 'created', 'story'];
  const output = format === 'json'
    ? `${JSON.stringify(items, null, 2)}\n`
    : `${columns.join(',')}\n${items.map((i) => columns.map((c) => csvCell(i[c])).join(',')).join('\n')}\n`;
  const out = option('--out', '');
  if (out) {
    writeFileSync(out, output);
    console.log(`${items.length} ítems exportados a ${out}`);
  } else process.stdout.write(output);
}

async function pull(config) {
  const connector = config.connectors.find((c) => c.name === args[1]);
  if (!connector || connector.kind !== 'altum') throw new Error('uso: pull <conector de tipo altum> [--apply]');
  const stateFile = path.join('.sn', 'state', `pull-${connector.name}.json`);
  const since = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')).since : '';
  const startedAt = new Date().toISOString();
  const result = await pullAltum(connector, since, '.', { includeClosed: flag('--include-closed') });
  result.created.forEach((t) => console.log(`${flag('--apply') ? 'NUEVO' : 'nuevo (sin crear)'}  ${t.id}  ${t.title}`));
  result.changed.forEach((c) => console.log(`cambió en Altum  ${c.id}  estado=${c.state}  prioridad=${c.priority}`));
  result.deleted.forEach((d) => console.log(`borrada en Altum  ${d.id}  (#${d.number} ${d.title}): decide si se descarta el ítem o se vuelve a crear`));
  if (flag('--apply')) {
    result.created.forEach((t) => writeImportedItem('.', t));
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ since: startedAt }));
  }
  console.log(`${result.checked} tareas revisadas · ${result.created.length} abiertas sin traer · ${result.changed.length} enlazadas`
    + `${result.skippedClosed ? ` · ${result.skippedClosed} terminadas omitidas` : ''}`
    + `${result.deActen ? ` · ${result.deActen} nacidas en reuniones (Acten)` : ''}`);
}

// Lo que escribió la persona, sin las opciones ni sus valores ("--repo APP SIPAR" no es parte del nombre).
const CON_VALOR = ['--in', '--into', '--repo', '--sello', '--riesgo', '--titulo', '--que', '--pr', '--format', '--out', '--every'];
function textoLibre(lista) {
  const libres = [];
  for (let i = 0; i < lista.length; i += 1) {
    if (CON_VALOR.includes(lista[i])) { i += 1; continue; }
    if (!lista[i].startsWith('--')) libres.push(lista[i]);
  }
  return libres;
}

function gitOut(argumentos) {
  try {
    return execFileSync('git', argumentos, { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// El change activo: el único que haya, o el que pidan por nombre.
function changeActivo(nombre) {
  const dir = 'openspec/changes';
  if (nombre) return nombre;
  if (!existsSync(dir)) return '';
  const activos = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'archive').map((d) => d.name);
  if (activos.length > 1) throw new Error(`hay ${activos.length} cambios abiertos (${activos.join(', ')}): dime cuál con "mensaje <change>"`);
  return activos[0] || '';
}

function urlDelPr(rama) {
  if (process.env.SN_SYNC_NO_GH) return '';
  try {
    return JSON.parse(execFileSync('gh', ['pr', 'view', rama, '--json', 'url'], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).url || '';
  } catch {
    return '';
  }
}

// Mensaje listo para copiarle al líder. Mientras no haya mensajería conectada, esto ES el canal:
// lo arma el motor (no el agente) para que siempre lleve rama, commit, quién firma y cómo empezar.
async function mensaje(config) {
  const change = changeActivo(args[1] && !args[1].startsWith('--') ? args[1] : '');
  const rama = gitOut(['rev-parse', '--abbrev-ref', 'HEAD']);
  const archivo = change ? path.join('openspec/changes', change, 'validacion.md') : '';
  const entradas = archivo && existsSync(archivo) ? parseLog(leerTexto(archivo)) : [];
  const solicitud = [...entradas].reverse().find((e) => e.type === 'SOLICITUD');
  const connector = config?.connectors.find((c) => c.kind === 'altum' && c.project_id);
  // El líder y el nombre del proyecto salen de Altum; si Altum no responde, el mensaje se arma igual.
  let lider = null;
  let proyecto = '';
  if (connector) {
    try {
      lider = await projectLead(connector);
      proyecto = lider?.project || '';
    } catch {
      lider = null;
    }
  }
  process.stdout.write(`${mensajeValidacion({
    proyecto: proyecto || config?.project || path.basename(process.cwd()),
    sello: option('--sello', solicitud?.seal || 'plano'),
    riesgo: option('--riesgo', (solicitud?.fields?.Riesgo || '').split(' · ')[0]),
    pide: localActor().replace(/\s*<[^>]*>$/, '') || '',
    titulo: option('--titulo', change || ''),
    queValidar: option('--que', solicitud?.fields?.['Qué validar'] || ''),
    rama,
    // El commit de la solicitud: es exactamente lo que el líder tiene que mirar, no lo último que haya.
    commit: (solicitud?.raw.match(/Commit:\s*([0-9a-f]{7,40})/)?.[1]) || gitOut(['rev-parse', '--short', 'HEAD']),
    pr: option('--pr', urlDelPr(rama)),
    lider: lider?.falta ? null : lider,
    clonar: proyecto || config?.project || path.basename(process.cwd()),
  })}\n`);
  if (!lider) console.log('(Altum no dijo quién es el líder: pregúntale a la persona a quién se lo manda.)');
  if (!rama || rama === 'main' || rama === 'master') console.log('(Ojo: no estás en una rama de trabajo, así que el líder no tendría qué validar.)');
}

function altumConnector(config, name) {
  const connector = config.connectors.find((c) => c.name === name);
  if (!connector || connector.kind !== 'altum') throw new Error(`no existe un conector altum llamado "${name}"`);
  return connector;
}

// El conector de Altum del repo; si todavía no hay ninguno, basta la clave para leer y clonar.
function anyAltum(config) {
  return config?.connectors.find((c) => c.kind === 'altum') || { name: 'altum', kind: 'altum' };
}

// Quién firma lo dice Altum, siempre. AGENTS.md es solo una copia para leer: si dice otra cosa (se
// escribió a mano antes, o cambió el líder en Altum), se corrige. Nunca se toma la cuenta de GitHub
// de quien está trabajando como líder: quien escribe el código no se aprueba a sí mismo.
const LINEA_LIDER = /^- Líder técnico[^\n]*$/m;

function lineaLider(l) {
  return `- Líder técnico (valida sellos a distancia con \`/sn-validate\`): ${l.name}${l.email ? ` <${l.email}>` : ''}`
    + `${l.github ? ` · GitHub @${l.github}` : ''} — según Altum (se actualiza solo, no se edita a mano)`;
}

function cuentaGithubActual() {
  if (process.env.SN_SYNC_NO_GH === '1') return '';
  try {
    return execFileSync('gh', ['api', 'user', '--jq', '.login'], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).trim();
  } catch {
    return '';
  }
}

// lead [--github]: el líder según Altum. Con --github imprime solo su usuario de GitHub (para pedirle
// la revisión del PR) o falla diciendo por qué no se puede pedir.
async function lead(config) {
  const connector = config?.connectors.find((c) => c.kind === 'altum' && c.project_id);
  if (!connector) throw new Error('uso: lead [--github] — este repositorio todavía no está unido a un proyecto de Altum (/sn-connect)');
  const l = await projectLead(connector);
  if (flag('--github')) {
    if (!l?.name) throw new Error('Altum no dice quién es el líder de este proyecto: no se pide revisión en GitHub (el mensaje sigue sirviendo).');
    if (!l.github) throw new Error(`${l.name} no tiene usuario de GitHub registrado en Altum (ficha del empleado → pestaña Git): no se pide revisión en GitHub; manda el mensaje.`);
    // El líder trabajando en su propio PR: GitHub no deja pedirse revisión a uno mismo, y tampoco hace
    // falta: él firma y une su propio trabajo desde /sn-validate.
    if (l.github.toLowerCase() === cuentaGithubActual().toLowerCase()) throw new Error(`eres el líder de este proyecto (@${l.github}): tu propio PR no necesita la firma de nadie más, lo apruebas y lo unes tú con /sn-validate.`);
    return console.log(l.github);
  }
  process.stdout.write(leadText(l));
  // AGENTS.md y CODEOWNERS son archivos VERSIONADOS del proyecto: el plugin no los cambia por su
  // cuenta (dejaba cambios sin guardar en el repo cada vez que alguien pedía una validación). Solo
  // dice si están desactualizados; los cambia quien corre "lead --escribir" (lo hace /sn-setup) y
  // ese cambio va en un commit, como cualquier otro.
  const escribir = flag('--escribir');
  const pendientes = [];
  if (l?.github && existsSync('.git') && origenRepo().provider !== 'azure_devops') {
    const archivo = '.github/CODEOWNERS';
    const actual = existsSync(archivo) ? leerTexto(archivo) : '';
    const conLider = codeownersConLider(actual, l.github);
    if (conLider !== actual) {
      if (escribir) {
        mkdirSync('.github', { recursive: true });
        writeFileSync(archivo, conLider);
        console.log(`CODEOWNERS: ${l.name} (@${l.github}) queda como revisor (las demás reglas del archivo se conservan).`);
      } else {
        pendientes.push(`CODEOWNERS no tiene al líder (@${l.github}) como revisor general`);
      }
    }
  }
  if (l?.name && existsSync('AGENTS.md')) {
    const texto = leerTexto('AGENTS.md');
    const actual = texto.match(LINEA_LIDER)?.[0];
    const correcta = lineaLider(l);
    if (actual && actual !== correcta) {
      if (escribir) {
        writeFileSync('AGENTS.md', texto.replace(LINEA_LIDER, correcta));
        console.log(`AGENTS.md decía otro líder. Lo corregí con lo que dice Altum:\n  antes:  ${actual}\n  ahora:  ${correcta}`);
      } else {
        pendientes.push(`AGENTS.md dice otro líder (${actual.replace(/^- Líder técnico[^:]*:\s*/, '').slice(0, 60)})`);
      }
    }
  }
  if (pendientes.length) {
    console.log(`\nDesactualizado en el repositorio (no lo toco por mi cuenta): ${pendientes.join('; ')}.`);
    console.log('Para dejarlo igual que Altum, en una rama: lead --escribir, y entrégalo en un PR.');
  }
}

// verificar-firma [<número de PR>]: ¿lo aprobó el líder que dice Altum? Es lo que corre el CI
// (GitHub Actions o Azure Pipelines) como verificación obligatoria: si no, el PR no se puede unir,
// aunque otra persona lo haya aprobado.
async function verificarFirma(config) {
  const connector = config?.connectors.find((c) => c.kind === 'altum' && c.project_id);
  if (!connector) throw new Error('este repositorio no está unido a un proyecto de Altum: sin líder no hay firma que verificar (/sn-connect).');
  const origen = origenRepo();
  const numero = args[1] && /^\d+$/.test(args[1]) ? args[1] : process.env.SN_PR_NUMBER || prDeRama(gitOut(['rev-parse', '--abbrev-ref', 'HEAD']), origen).pr_number;
  if (!numero) throw new Error('no encuentro el PR: pásame el número (verificar-firma <número>).');
  const lider = await projectLead(connector);
  const { valida, motivo } = firmaDelLider(aprobacionesPr(numero, origen), lider);
  console.log(`${valida ? 'FIRMA VÁLIDA' : 'SIN FIRMA DEL LÍDER'} · PR ${numero} (${origen.provider || 'sin remoto'}): ${motivo}`);
  if (!valida) process.exitCode = 1;
}

// proteger-rama [--si]: vuelve obligatoria la verificación "Firma del líder" en la rama principal de
// GitHub, para que un PR no se pueda unir sin la aprobación del líder. Es un ajuste del repositorio
// (lo ve todo el equipo y necesita permisos de administrador): sin --si solo dice qué haría.
// No reemplaza la protección que ya tenga la rama: le AGREGA esta verificación.
function proteger() {
  const origen = origenRepo();
  if (origen.provider === 'azure_devops') {
    console.log('En Azure DevOps se hace desde la política de la rama: Project settings → Repos → Policies → rama principal → Build validation → el pipeline de azure-pipelines-sn.yml, marcado como "Required". Así el PR no se puede completar sin la firma del líder.');
    return;
  }
  const ghJson = (a, input) => JSON.parse(execFileSync('gh', a, { windowsHide: true, encoding: 'utf8', input, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], timeout: 15000 }) || 'null');
  const repo = ghJson(['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef']);
  const rama = repo.defaultBranchRef?.name || 'main';
  if (!flag('--si')) {
    console.log(`Haría obligatoria la verificación "Firma del líder" en ${repo.nameWithOwner} (rama ${rama}): ningún PR se podrá unir sin la aprobación del líder que dice Altum.`);
    console.log('Es un ajuste del repositorio: confírmalo con el líder técnico y vuelve a llamarme con --si.');
    process.exitCode = 1;
    return;
  }
  const base = `repos/${repo.nameWithOwner}/branches/${rama}/protection`;
  try {
    execFileSync('gh', ['api', base], { windowsHide: true, stdio: 'ignore', timeout: 15000 });
  } catch (error) {
    if (/Upgrade to GitHub Pro/i.test(String(error.stderr || error.message))) {
      console.log(`GitHub no permite proteger ramas en repositorios PRIVADOS de cuentas gratuitas (${repo.nameWithOwner}). Opciones: GitHub Pro para la cuenta dueña, o pasar los repositorios a la organización con plan Team.`);
      console.log('Mientras tanto, el control lo hace el plugin: solo el líder de Altum puede unir el PR (desde /sn-validate) y el líder queda como revisor automático (CODEOWNERS).');
      process.exitCode = 1;
      return;
    }
  }
  try {
    ghJson(['api', '-X', 'POST', `${base}/required_status_checks/contexts`, '--input', '-'], JSON.stringify({ contexts: ['Firma del líder'] }));
  } catch {
    // La rama todavía no tenía protección: se crea solo con esta verificación (y sin saltársela nadie).
    ghJson(['api', '-X', 'PUT', base, '--input', '-'], JSON.stringify({
      required_status_checks: { strict: false, contexts: ['Firma del líder'] },
      enforce_admins: true, required_pull_request_reviews: null, restrictions: null,
    }));
  }
  console.log(`Listo: en ${repo.nameWithOwner} ya no se puede unir un PR a ${rama} sin la aprobación del líder según Altum.`);
}

// siguiente [<ID>]: en qué paso va el ítem y qué toca AHORA según el proceso (no según el agente).
// Sin ID: el ítem de la rama actual o, si no hay, todos los que siguen abiertos.
function siguiente(config) {
  const id = args[1] && !args[1].startsWith('--') ? args[1].toLowerCase() : '';
  const rama = gitOut(['rev-parse', '--abbrev-ref', 'HEAD']);
  let items = takeSnapshot(config?.project, { solo: (i) => (id ? i.id.toLowerCase() === id : true) }).items;
  if (!id) {
    const deRama = items.filter((i) => i.branch && i.branch === rama);
    items = deRama.length ? deRama : items.filter((i) => !['done', 'discarded'].includes(i.stage));
  }
  if (!items.length) return console.log(id ? `No existe el ítem ${args[1]}.` : 'No hay ítems abiertos. Para empezar algo: /sn');
  for (const item of items) {
    const { paso, siguiente: sig } = siguientePaso(item);
    console.log(`${item.id} · ${item.title}\n  Paso: ${paso}\n  ➡️ Siguiente: ${sig}`);
  }
}

// dividir <ID>: cierra el plano con lo que ya está hecho y pasa las tareas pendientes a un ítem nuevo.
// Para cuando, construyendo, aparece trabajo que no estaba en el plano o conviene entregar ya lo hecho
// (p. ej. 5 de 7): el change queda completo con esas 5 y las 2 restantes siguen su propio camino.
function dividir(config) {
  const id = args[1];
  const item = takeSnapshot(config?.project, { solo: (i) => i.id.toLowerCase() === String(id).toLowerCase() }).items[0];
  if (!item) throw new Error('uso: dividir <ID del ítem>');
  if (!item.change) throw new Error(`${item.id} no tiene plano (change): no hay tareas que dividir.`);
  const archivo = path.join('openspec/changes', item.change, 'tasks.md');
  if (!existsSync(archivo)) throw new Error(`no encuentro ${archivo}.`);
  const lineas = leerTexto(archivo).split('\n');
  const pendientes = lineas.filter((l) => /^\s*- \[ \]/.test(l));
  const hechas = lineas.filter((l) => /^\s*- \[x\]/i.test(l));
  if (!pendientes.length) return console.log(`${item.id} no tiene tareas pendientes: no hay nada que dividir.`);
  if (!hechas.length) throw new Error(`${item.id} todavía no tiene tareas hechas: en vez de dividir, corrige el plano (openspec-update-change).`);
  const prefijo = item.id.split('-')[0];
  const hoy = new Date();
  const fecha = `${String(hoy.getFullYear()).slice(2)}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`;
  const nuevo = `${prefijo}-${fecha}-${Math.random().toString(16).slice(2, 6)}`;
  const tareas = pendientes.map((l) => l.replace(/^\s*- \[ \]\s*(\d+(\.\d+)*\s*)?/, '- ')).join('\n');
  mkdirSync('docs/items', { recursive: true });
  writeFileSync(path.join('docs/items', `${nuevo}.md`), [
    '---', `id: ${nuevo}`, `type: ${item.type}`, `title: ${item.title} (continuación)`, `risk: ${item.risk || ''}`,
    `assignee: ${item.assignee || ''}`, `parent: ${item.id}`, `origin: dividido de ${item.id}`, `created: ${hoy.toISOString().slice(0, 10)}`, '---',
    '## Historia',
    `Continuación de ${item.id} («${item.title}»). Estas tareas quedaron fuera de su plano para entregar ya lo construido; siguen su propio camino (historia → plano → sello → construir).`,
    '', '## Tareas que pasaron de ' + item.id, tareas, '',
  ].join('\n'));
  const resto = lineas.filter((l) => !/^\s*- \[ \]/.test(l));
  writeFileSync(archivo, `${resto.join('\n').replace(/\n+$/, '')}\n\n> ${pendientes.length} tarea(s) pasaron a ${nuevo} el ${hoy.toISOString().slice(0, 10)}: el plano se cerró con las ${hechas.length} ya hechas.\n`);
  console.log(`Listo: el plano de ${item.id} queda con sus ${hechas.length} tareas hechas (completo).`);
  console.log(`Las ${pendientes.length} pendientes pasaron a ${nuevo} (docs/items/${nuevo}.md), que nace en Altum con su propia tarea.`);
  console.log(`➡️ Siguiente para ${item.id}: evidencia (sn-evidence) y PR. ${nuevo} empieza su camino cuando lo tomen con /sn.`);
}

// Poner secretos y proteger la rama exige ser ADMINISTRADOR del repositorio (no basta con ser el líder
// del proyecto en Altum). Y la clave de Altum de la empresa solo la crea un administrador de Altum.
// Por eso esta configuración nunca se le pide al equipo ni al líder: la hace el administrador.
function esAdminDelRepo() {
  if (process.env.SN_SYNC_NO_GH === '1') return false;
  try {
    return execFileSync('gh', ['api', `repos/{owner}/{repo}`, '--jq', '.permissions.admin'], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).trim() === 'true';
  } catch {
    return false;
  }
}

// pedir-config: ¿le toca a quien está trabajando configurar el proyecto? Solo si administra el repositorio.
async function pedirConfig() {
  const origen = origenRepo();
  if (origen.provider === 'azure_devops') {
    console.log('Esta configuración la hace el administrador del proyecto de Azure DevOps (variable con la clave de empresa y política de la rama). A nadie más se le pide nada.');
    return;
  }
  if (esAdminDelRepo()) {
    const hecho = existsSync('.github/workflows/sn-sync.yml') && existsSync('.github/workflows/firma-lider.yml');
    console.log(hecho
      ? 'Eres administrador de este repositorio y ya tiene las revisiones automáticas. Si falta el secreto con la clave de empresa o proteger la rama: /sn-connect.'
      : 'Eres administrador de este repositorio: puedes dejarlo configurado (5 min, una vez): /sn-connect. Necesitas la clave de Altum de la empresa (Altum → Configuración → Claves de API).');
    return;
  }
  console.log('Nada que hacer de tu parte: esta configuración la hace el administrador del repositorio. Tú sigue con tu trabajo; nada se pierde.');
}

// repos [<nombre>]: los repositorios que tiene ese proyecto en Altum (pueden ser varios).
async function repos(config) {
  const connector = anyAltum(config);
  const query = textoLibre(args.slice(1)).join(' ').trim();
  const todos = await listProjects(connector);
  const { match, candidates } = query ? findProject(todos, query) : { match: todos.find((p) => p.id === connector.project_id) };
  if (candidates) throw new Error(`hay ${candidates.length} proyectos parecidos a "${query}": ${candidates.map((p) => p.name).join(', ')}`);
  if (!match) throw new Error('uso: repos <nombre del proyecto> (o conecta este repositorio con /sn-connect)');
  const lista = (await listRepos(connector, match.id)) || match.repos;
  if (!lista.length) {
    console.log(`"${match.name}" no tiene repositorios registrados en Altum. Regístralo con: set-repo "${match.name}" <url>`);
    return;
  }
  console.log(`"${match.name}" — ${lista.length} repositorio${lista.length > 1 ? 's' : ''}:`);
  lista.forEach((r) => console.log(`  ${r.name.padEnd(38)} ${r.provider === 'github' ? '' : `[${r.provider}] `}${r.url}`));
  if (lista.length > 1) console.log(`\nPara traer uno: clone "${match.name}" --repo <nombre> --in <carpeta>`);
  console.log(`Para quitar uno mal registrado: quitar-repo "${match.name}" <nombre o dirección> --si`);
}

async function projects(config) {
  const list = await listProjects(anyAltum(config));
  if (!list.length) return console.log('La clave no ve proyectos. Revisa que sea la clave correcta.');
  if (flag('--json')) return process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
  list.forEach((p) => console.log(`  ${p.name || '(sin nombre)'}${p.client ? `  · cliente: ${p.client}` : ''}`
    + `${p.repos.length > 1 ? `  (${p.repos.length} repositorios)` : p.repos.length ? '' : '  (sin repositorio en Altum)'}`));
  console.log('\nPara empezar a trabajar en uno: clone "<nombre>"');
}

// actualizar: ¿está al día el plugin en ESTE computador? Cada máquina lo instaló distinto —desde
// GitHub o desde una carpeta clonada a mano, para el usuario o dentro de un proyecto— y por eso
// "ya estás en la última" a veces miente. Aquí se dice la verdad y qué correr, en orden.
async function actualizar() {
  const raiz = path.join(path.dirname(SELF), '..');
  // --solo-revisar: lo corre el hook en segundo plano para dejar la última versión consultada en caché.
  if (flag('--solo-revisar')) { await ultimaPublicada(); return; }
  const cat = catalogo();
  const installs = instalaciones();
  // --general: dejar el plugin UNA sola vez en este computador. Quita las copias que viven dentro de
  // proyectos (y la línea que las pedía) y deja al día la general, la que sirve para todos.
  if (flag('--general')) {
    // Primero la general, sola: si no queda bien (sin red, catálogo movido), no se tocan las copias
    // de los proyectos — dejarlas ahí es mejor que quitarlas y quedarse sin ningún plugin.
    console.log('\nPrimero dejo al día la copia general (la de tu usuario):');
    const resultadoGeneral = ejecutarPasos(pasosInstalacionGeneral({ cat, installs }));
    if (resultadoGeneral.some((r) => !r.ok)) {
      resumen(resultadoGeneral, '');
      console.log('\nNo quito las copias de los proyectos: si la general no quedó instalada, eso te dejaría sin plugin. Corrige esto y vuelve a intentar "actualizar --general".');
      return;
    }
    const copias = proyectosConCopia(installs);
    console.log(copias.length
      ? `\nListo. Ahora quito las ${copias.length} copia(s) que viven dentro de proyectos, para que quede una sola:`
      : '\nListo. No hay copias dentro de proyectos: nada más que hacer.');
    resumen([...resultadoGeneral, ...ejecutarPasos(pasosLimpieza({ installs }))], 'Listo: una sola instalación, para todos los proyectos.');
    if (!process.exitCode) console.log('AHORA SÍ: cierra Claude Code y vuélvelo a abrir.');
    return;
  }

  const actual = versionInstalada(raiz);
  // Lo pide una persona: se le dice la VERDAD, no un dato de caché disfrazado de fresco.
  const { ultima, red } = await versionPublicadaDeVerdad();
  console.log(`Plugin Softnexus: tienes ${actual || '?'}${ultima ? ` · publicada ${ultima}${red ? '' : ' (de la última vez que hubo conexión; ahora no pude consultar)'}` : ' (no pude consultar la última: sin red)'}`);
  if (cat.tipo === 'carpeta') {
    const atrasado = gitAtrasado(cat.carpeta);
    console.log(`El catálogo de este computador es una CARPETA (${cat.carpeta}), no GitHub:`
      + ` "claude plugin marketplace update" solo la revalida, no la actualiza${atrasado ? ` (está ${atrasado} commits atrás)` : ''}.`);
  }
  const viejas = installs.filter((i) => ultima && esMasNueva(ultima, i.version));
  if (installs.length > 1) {
    console.log(`Está instalado ${installs.length} veces: ${installs.map((i) => `${i.scope} ${i.version}`).join(', ')}.`
      + ' Dentro de un proyecto, la copia del proyecto manda sobre la del usuario.');
  }
  if (ultima && !esMasNueva(ultima, actual) && !viejas.length) {
    return console.log(red ? 'Todo al día. No hay nada que hacer.' : 'Parece al día según la última vez que hubo conexión, pero no pude confirmarlo ahora mismo (sin red). Vuelve a intentarlo cuando tengas conexión.');
  }
  const pasos = pasosParaActualizar({ cat, installs });
  if (flag('--arreglar')) {
    console.log(`\nActualizando todo en esta máquina (${pasos.length} pasos):`);
    resumen(ejecutarPasos(pasos), 'Listo: todo quedó al día.');
    if (!process.exitCode) console.log('AHORA SÍ: cierra Claude Code y vuélvelo a abrir. Hasta que no reinicies sigue corriendo la versión vieja.');
    else if (installs.some((i) => i.scope !== 'user')) {
      console.log('\nSi sigue sin quedar, prueba con una sola instalación para todos los proyectos:  node "' + SELF + '" actualizar --general');
    }
    return;
  }
  console.log('\nPara ponerlo al día en esta máquina, en este orden:');
  comoActualizar({ cat, installs }).forEach((paso) => console.log(`  ${paso}`));
  console.log('\nO deja que lo haga solo:  node "' + SELF + '" actualizar --arreglar');
  if (installs.some((i) => i.scope !== 'user')) {
    console.log('Y para no repetir esto nunca más (una sola instalación para todos los proyectos):');
    console.log('  node "' + SELF + '" actualizar --general');
  }
  console.log('Y al final, cierra Claude Code y vuélvelo a abrir: hasta que no reinicies sigue corriendo la versión vieja.');
  if (cat.tipo === 'carpeta') {
    console.log('\nPara no repetir esto cada vez, se puede registrar el catálogo desde GitHub:'
      + '\n  claude plugin marketplace remove softnexus'
      + '\n  claude plugin marketplace add pipejust/softnexus-sdd-kit'
      + '\n  claude plugin install softnexus-sdd@softnexus');
  }
}

// Decir la verdad al final: si algo falló, se ve, se explica cómo terminarlo a mano y el comando
// sale con error (quien lo llama no puede dar por bueno algo que no se hizo).
function resumen(hechos, bien) {
  const conPr = hechos.filter((h) => h.paso?.pendientePr).map((h) => h.paso.pendientePr);
  if (conPr.length) {
    console.log(`\n${conPr.length} repositorio(s) piden el plugin en un archivo VERSIONADO (.claude/settings.json).`
      + ' No lo toqué: es del equipo. Quien administre cada uno, dentro del repo y en una rama:');
    console.log('   node "' + SELF + '" dejar-de-declarar   y entregarlo en un PR');
    conPr.forEach((c) => console.log(`   · ${c}`));
  }
  const fallaron = hechos.filter((h) => !h.ok);
  if (!fallaron.length) return console.log(`\n${bien}`);
  process.exitCode = 1;
  console.log(`\n⚠️  ATENCIÓN: ${fallaron.length} de ${hechos.length} pasos NO se pudieron hacer:`);
  for (const { paso, motivo } of fallaron) {
    const comando = paso.fn ? paso.nota : `${paso.cmd} ${paso.args.join(' ')}`;
    console.log(`   ✗ ${comando}${paso.cwd ? `   (en ${paso.cwd})` : ''}\n     ${motivo}`);
  }
  console.log('\nLo que falló hay que hacerlo a mano (copia el comando de arriba) o decírselo al líder. NO quedó completo.');
  console.log('Para mandar el detalle completo: node "' + SELF + '" actualizar --general > /tmp/sn-plugin.txt 2>&1   y pasa ese archivo.');
}

// dejar-de-declarar: quita "softnexus-sdd@softnexus" del .claude/settings.json de ESTE repositorio.
// Es un cambio del equipo, así que se hace a propósito, en una rama, y se entrega en un PR. Desde ahí
// el plugin solo se activa a nivel de usuario (una instalación por computador).
function dejarDeDeclararAqui() {
  const carpeta = process.cwd();
  if (!declaraElPlugin(carpeta)) return console.log('Este repositorio no pide el plugin en .claude/settings.json: no hay nada que quitar.');
  dejarDeDeclarar(carpeta);
  console.log('Listo: .claude/settings.json ya no pide el plugin (el resto del archivo quedó igual).');
  console.log('Entrégalo en un PR: "chore: el plugin Softnexus se activa por usuario, no por proyecto".');
}

// limpiar-copias: quita el plugin de TODOS los proyectos de este computador (las copias instaladas
// dentro de cada carpeta y la línea que las pedía). Después manda una sola: la del computador.
function limpiarCopias() {
  const installs = instalaciones();
  const copias = proyectosConCopia(installs);
  if (!copias.length) return console.log('Ningún proyecto tiene copia propia del plugin: ya manda una sola, la de tu usuario.');
  console.log(`${copias.length} proyecto(s) tienen su propia copia. Las quito:`);
  const hechos = ejecutarPasos(pasosLimpieza({ installs }));
  resumen(hechos, 'Listo: ya no hay copias dentro de proyectos.');
  console.log('Ahora instala la general si no la tienes: instalar-general.');
}

// instalar-general: deja la copia del computador (ámbito de usuario), la que sirve en TODOS los
// proyectos. Si ya está, la deja al día.
async function instalarGeneral() {
  const cat = catalogo();
  const installs = instalaciones();
  const hechos = ejecutarPasos(pasosInstalacionGeneral({ cat, installs }));
  const copias = proyectosConCopia(installs);
  resumen(hechos, 'Listo: el plugin queda instalado para todos tus proyectos.');
  if (copias.length) console.log(`OJO: ${copias.length} proyecto(s) todavía tienen copia propia y esa manda dentro de ellos. Quítalas con: limpiar-copias.`);
  if (!process.exitCode) console.log('AHORA SÍ: cierra Claude Code y vuélvelo a abrir.');
}

// El conector de Altum de este repositorio, con proyecto y clave listos.
function altumDelRepo(config) {
  const connector = config?.connectors.find((c) => c.kind === 'altum' && c.project_id);
  if (!connector) throw new Error('este repositorio no está unido a un proyecto de Altum: únelo con "conectar".');
  if (!hasKey(connector)) throw new Error(`falta la clave de Altum (${keyName(connector)}) en este computador: guárdala siguiendo references/clave-altum.md.`);
  return connector;
}

// sin-asignar: las tareas del proyecto que no tienen responsable. Es la lista que mira el líder
// para repartir trabajo desde el chat ("asigna la #45 a Danny").
async function sinAsignar(config) {
  const connector = altumDelRepo(config);
  const [{ items }, gente] = await Promise.all([
    listTasks(connector, { project_id: connector.project_id }),
    integrantes(connector),
  ]);
  const abiertas = items.filter((t) => !t.assignee_id && !esDeActen(t));
  if (!abiertas.length) return console.log('Todas las tareas del proyecto tienen responsable.');
  console.log(`${abiertas.length} tarea(s) sin responsable:`);
  abiertas.sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || (a.number ?? 0) - (b.number ?? 0));
  abiertas.forEach((t) => console.log(`  #${String(t.number ?? '?').padEnd(5)} ${String(t.state).padEnd(12)} ${t.title}`));
  console.log(`\nPara repartirlas: asignar <número> <nombre o correo>. Equipo: ${gente.map((m) => m.name).join(', ')}.`);
}

// asignar <número> <nombre o correo>: le pone responsable a una tarea. Altum solo deja hacerlo a
// quien lleva el proyecto; si no, responde 403 y aquí se dice con sus palabras.
async function asignar(config) {
  const connector = altumDelRepo(config);
  const libres = textoLibre(args.slice(1));
  const numero = libres.find((a) => /^#?\d+$/.test(a))?.replace('#', '');
  const quien = libres.filter((a) => a !== `#${numero}` && a !== numero).join(' ').trim();
  if (!numero || !quien) throw new Error('uso: asignar <número de la tarea> <nombre o correo de la persona>');
  const [{ items }, gente] = await Promise.all([
    listTasks(connector, { project_id: connector.project_id }),
    integrantes(connector),
  ]);
  const tarea = items.find((t) => String(t.number) === numero);
  if (!tarea) throw new Error(`no encuentro la tarea #${numero} en este proyecto.`);
  const buscado = quien.toLowerCase();
  const candidatos = gente.filter((m) => m.email.toLowerCase() === buscado || m.name.toLowerCase().includes(buscado));
  if (!candidatos.length) throw new Error(`"${quien}" no está en el equipo del proyecto. Son: ${gente.map((m) => m.name).join(', ')}.`);
  if (candidatos.length > 1) throw new Error(`hay varios parecidos a "${quien}": ${candidatos.map((m) => m.name).join(', ')}. Dime cuál.`);
  const persona = candidatos[0];
  if (tarea.assignee_id === persona.id) return console.log(`La tarea #${numero} ya es de ${persona.name}.`);
  await api(connector, 'PATCH', `/tasks/${tarea.id}`, { assignee_id: persona.id });
  console.log(`Listo: la tarea #${numero} "${tarea.title}" queda a cargo de ${persona.name}.`);
}

// motor [--actualizar]: la copia del motor dentro del repositorio (scripts/sn) es la que usa el CI y
// viaja en las ramas del proyecto, así que puede quedarse atrás del plugin que cada persona actualiza.
// Esto compara las dos y, con --actualizar, deja la copia igual a la del plugin (es código generado).
const ARCHIVOS_MOTOR = ['sn-sync.mjs', 'validation-state.mjs', 'sn-clave-altum.sh', 'sn-clave-altum.ps1'];

function archivosDelMotor(dir) {
  const sueltos = ARCHIVOS_MOTOR.filter((f) => existsSync(path.join(dir, f)));
  const modulos = existsSync(path.join(dir, 'sync'))
    ? readdirSync(path.join(dir, 'sync')).filter((f) => f.endsWith('.mjs')).map((f) => path.join('sync', f))
    : [];
  return [...sueltos, ...modulos];
}

function motorDelPlugin() {
  const raiz = process.env.CLAUDE_PLUGIN_ROOT;
  return raiz ? path.join(raiz, 'scripts') : path.dirname(SELF);
}

function motor() {
  const origen = motorDelPlugin();
  const destino = path.resolve('scripts/sn');
  if (path.resolve(origen) === destino) {
    return console.log('Este repositorio no tiene copia propia del motor: usa la del plugin, que siempre está al día.');
  }
  // Primera vez: con --actualizar se instala completo (así siempre queda con su .version, que es lo
  // que le dice a cada computador si su plugin es más nuevo que esta copia).
  if (!existsSync(destino) && !flag('--actualizar')) {
    return console.log('Este repositorio todavía no tiene el motor (scripts/sn). Para instalarlo: motor --actualizar.');
  }
  mkdirSync(destino, { recursive: true });
  const nombres = [...new Set([...archivosDelMotor(origen), ...archivosDelMotor(destino)])];
  const distintos = nombres.filter((f) => {
    const a = path.join(origen, f);
    const b = path.join(destino, f);
    if (!existsSync(a) || !existsSync(b)) return true;
    return readFileSync(a, 'utf8') !== readFileSync(b, 'utf8');
  });
  if (!distintos.length) return console.log('La copia del motor en el repositorio está igual que la del plugin.');
  if (!flag('--actualizar')) {
    console.log(`La copia del motor en scripts/sn no está igual que la del plugin (${distintos.length} archivo(s)): ${distintos.join(', ')}.`);
    console.log('Los hooks del plugin ya usan el motor del plugin, así que tu sesión no se queda atrás; la copia del repositorio es la que usa el CI.');
    console.log('Para dejarla igual (es código generado, no se edita a mano): motor --actualizar, y entrega el cambio con /sn-ship.');
    return;
  }
  for (const f of distintos) {
    const a = path.join(origen, f);
    const b = path.join(destino, f);
    if (!existsSync(a)) { rmSync(b, { force: true }); continue; }
    mkdirSync(path.dirname(b), { recursive: true });
    copyFileSync(a, b);
  }
  // La copia anota de qué versión salió: así sabe si el plugin de cada computador es más nuevo que ella.
  const version = versionInstalada(path.join(origen, '..'));
  if (version) writeFileSync(path.join(destino, VERSION_DE_LA_COPIA), `${version}\n`);
  console.log(`Motor actualizado en scripts/sn (${distintos.length} archivo(s)). Entrégalo con /sn-ship: es lo que usa el CI.`);
}

// conectar [nombre]: une este repositorio con su proyecto de Altum sin pedirle nada a la persona.
// La clave personal ya dice quién es; el remoto "origin" dice qué repositorio es; Altum sabe qué
// proyectos lo usan. Uno solo → se conecta. Varios (un repositorio para varios proyectos) → se
// pregunta POR NOMBRE. Ninguno → con el nombre que diga la persona se conecta y se registra el repo.
async function conectar(config) {
  const nombre = textoLibre(args.slice(1)).join(' ').trim();
  const connector = anyAltum(config);
  const remoto = remoteUrl();
  const todos = await listProjects(connector);
  if (!todos.length) throw new Error('tu clave de Altum no ve ningún proyecto: pide al líder que te asigne al proyecto en Altum.');
  const delRepo = projectsForRepo(todos, remoto, identificarRepo);
  const entre = nombre ? findProject(delRepo.length ? delRepo : todos, nombre, { exacta: true }) : {};
  const elegido = entre.match || (!nombre && delRepo.length === 1 ? delRepo[0] : null);
  if (!elegido) {
    const opciones = entre.candidates || (delRepo.length ? delRepo : todos);
    console.log(delRepo.length > 1 && !nombre
      ? `Este repositorio lo usan ${delRepo.length} proyectos: ${opciones.map((p) => p.name).join(', ')}. ¿En cuál vas a trabajar?`
      : nombre && !entre.candidates ? `Ninguno de tus proyectos se llama "${nombre}". Tus proyectos: ${opciones.map((p) => p.name).join(', ')}.`
        : nombre ? `"${nombre}" no es el nombre exacto de un proyecto. ¿Cuál de estos es? ${opciones.map((p) => p.name).join(', ')}.`
        : `¿En cuál de tus proyectos vas a trabajar? ${opciones.map((p) => p.name).join(', ')}.`);
    console.log('(Pregúntale a la persona por el NOMBRE del proyecto y vuelve a correr: conectar "<nombre>")');
    process.exitCode = 1;
    return;
  }
  const crudo = existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '')) : { connectors: [] };
  const lista = crudo.connectors || [];
  const previo = lista.find((c) => c.kind === 'altum');
  if (previo?.project_id === elegido.id) return console.log(`Este repositorio ya está conectado con "${elegido.name}" en Altum.`);
  const nuevo = { ...(previo || { name: 'altum', kind: 'altum', events: ['sn.item.*'] }), project_id: elegido.id };
  const conectores = previo ? lista.map((c) => (c === previo ? nuevo : c)) : [...lista, nuevo];
  mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, `${JSON.stringify({ ...crudo, project: crudo.project || elegido.key, connectors: conectores }, null, 2)}\n`);
  console.log(`Conectado: este repositorio trabaja con "${elegido.name}" en Altum.${previo?.project_id ? ' (Antes estaba con otro proyecto.)' : ''}`);
  if (!remoto || delRepo.some((p) => p.id === elegido.id)) return;
  try {
    await addProjectRepo(connector, elegido.id, remoto);
    console.log(`También quedó registrado en Altum que "${elegido.name}" usa este repositorio.`);
  } catch (error) {
    console.log(`(No pude registrar el repositorio en "${elegido.name}": ${error.message}. La conexión funciona igual.)`);
  }
}

// set-repo <nombre> [url]: registra en Altum de dónde se clona ese proyecto.
// Sin url, usa el remoto "origin" de este repositorio.
async function setRepo(config) {
  const libres = textoLibre(args.slice(1));
  const url = libres.find((a) => /^(https?:|git@)/.test(a)) || remoteUrl();
  const query = libres.filter((a) => a !== url).join(' ').trim();
  if (!query) throw new Error('uso: set-repo <nombre del proyecto> [url del repositorio]');
  if (!url) throw new Error('este repositorio no tiene remoto "origin": pasa la dirección como segundo argumento');
  const connector = anyAltum(config);
  const { match, candidates } = findProject(await listProjects(connector), query, { exacta: true });
  if (candidates) {
    console.log(`Hay ${candidates.length} proyectos parecidos a "${query}". ¿Cuál es?`);
    candidates.forEach((p) => console.log(`  ${p.name}`));
    process.exitCode = 1;
    return;
  }
  if (!match) throw new Error(`ninguno de tus proyectos se parece a "${query}".`);
  let resultado;
  try {
    resultado = await addProjectRepo(connector, match.id, url);
  } catch (error) {
    if (/HTTP 403/.test(error.message)) {
      throw new Error('tu clave no tiene el permiso "projects:write" (es anterior a ese cambio): regenérala en Altum → Mi perfil → Mis datos y vuelve a guardarla.');
    }
    throw error;
  }
  if (resultado.modo === 'ya-estaba') return console.log(`"${match.name}" ya tenía registrado ${resultado.repo}. No cambié nada.`);
  if (resultado.modo === 'uno-solo' && match.repo && match.repo !== url) console.log(`Ojo: reemplacé el que tenía (${match.repo}); esta versión de Altum solo guarda uno por proyecto.`);
  const otros = match.repos.filter((r) => r.name !== resultado.repo).map((r) => r.name);
  console.log(`Listo: "${match.name}" se clona desde ${url}${resultado.provider === 'github' ? '' : ` (${resultado.provider})`}.`
    + `${otros.length ? ` Ese proyecto ya tenía: ${otros.join(', ')}.` : ''}`);
  console.log(`Ahora cualquiera del equipo puede pedir "clóname ${match.name}".`);
}

// asegurar <ITEM>: garantiza que el ítem YA tiene su tarea en Altum antes de empezar a construir.
// La sincronización normal corre sola y en segundo plano; esto la hace en primer plano, comprueba
// que la tarea exista de verdad en Altum y, si algo falla, dice por qué en vez de callarse.
async function asegurar(config) {
  const id = args[1];
  if (!id) throw new Error('uso: asegurar <ID del ítem>');
  const connector = config?.connectors.find((c) => c.kind === 'altum' && c.enabled !== false);
  if (!connector?.project_id) throw new Error('este repositorio no está unido a un proyecto de Altum: conéctalo con /sn-connect antes de construir (o sigue sin Altum si la persona así lo decidió).');
  if (!hasKey(connector)) throw new Error(`falta la clave de Altum (${keyName(connector)}) en este computador: guárdala siguiendo references/clave-altum.md.`);
  const buscar = () => takeSnapshot(config.project).items.find((i) => i.id.toLowerCase() === String(id).toLowerCase());
  let item = buscar();
  if (!item) throw new Error(`no existe el ítem ${id} en docs/items/.`);
  // ¿La tarea que dice el ítem existe de verdad en Altum? (pudo borrarse o ser de otro proyecto)
  const existente = async (taskId) => {
    // Sin enlace en el ítem (p. ej. otro computador), se busca por external_ref = ID del ítem.
    if (!taskId) {
      // Coincidencia EXACTA: Altum devuelve todas las tareas del proyecto aunque se filtre por
      // external_ref, y enlazar la ficha a la primera que venga sobrescribe una tarea ajena.
      const suya = await tareaDeLaFicha(connector, item.id);
      if (suya && item.file) setExternalId(item.file, connector.name, suya.id);
      return suya;
    }
    try {
      const tarea = await fetchAltumTask(connector, taskId);
      return tarea?.id ? tarea : null;
    } catch (error) {
      if (/HTTP 404/.test(error.message)) return null;
      throw error;
    }
  };
  // Un enlace mal puesto (a una tarea de reunión que no es suya) no se sigue: antes de tocar nada,
  // se revisa. Las fichas traídas de Acten (ACT-…) sí son de reunión y esas pasan.
  const enlazada = item.external?.[connector.name] || '';
  if (esDeActen({ id: enlazada }) && !/^ACT-/i.test(item.id)) {
    throw new NotRetryable(`${item.id} está enlazado a ${enlazada}, que es una tarea nacida en una reunión y no le corresponde.`
      + ' No la toco. Quita la línea "ext.altum:" de la ficha y vuelve a correr "asegurar": se creará su propia tarea.');
  }
  let tarea = await existente(enlazada);
  if (tarea) {
    // Ya existe: se le lleva la etapa actual del ítem (al cerrar, esto la deja terminada en Altum).
    // forzado: "asegurar" lo corre una persona a propósito (antes de construir, o al unir el PR),
    // así que puede tocar una tarea de otro —por ejemplo, cerrarla cuando su PR se unió—.
    await deliver(connector, { specversion: '1.0', id: `${item.id}:asegurar`, type: 'sn.item.upserted', project: config.project, time: new Date().toISOString(), actor: localActor(), item, forzado: true });
    tarea = await existente(item.external?.[connector.name]);
  } else {
    // Si el ítem apuntaba a una tarea que ya no existe (se borró en Altum), se olvida ese enlace y se crea de nuevo.
    const anterior = item.external?.[connector.name];
    const sinEnlace = { ...item, external: { ...(item.external || {}), [connector.name]: undefined }, ...(anterior ? { recrear: anterior } : {}) };
    // Evento nuevo (con la hora): con el id de siempre, la clave de idempotencia sería la de la tarea
    // borrada y Altum devolvería esa misma en vez de crear otra.
    await deliver(connector, { specversion: '1.0', id: `${item.id}:asegurar:${Date.now()}`, type: 'sn.item.upserted', project: config.project, time: new Date().toISOString(), actor: localActor(), item: sinEnlace, forzado: true });
    item = buscar();
    // Se busca por su external_ref (coincidencia exacta), no por el enlace viejo de la ficha, que
    // apunta a la tarea borrada. Al encontrarla, asegurar sí escribe el enlace nuevo: es explícito.
    tarea = await existente('');
  }
  if (!tarea) throw new Error(`no pude confirmar la tarea de ${item.id} en Altum. Revisa "status" y vuelve a intentar antes de construir.`);
  const numero = tarea.number ? `#${tarea.number}` : tarea.id;
  console.log(`Tarea en Altum ${numero}: ${tarea.title} · estado ${tarea.state}`);
  if (['merged', 'done', 'discarded'].includes(item.stage)) {
    const { done } = await projectStates(connector);
    const cerrada = [...done, 'done', 'cancelled'].includes(tarea.state);
    const como = item.stage === 'discarded' ? `se descartó (${item.discarded})` : 'terminó';
    console.log(cerrada ? `Cerrada en Altum: ${item.id} ${como}.` : `OJO: el ítem ${como} pero la tarea sigue en "${tarea.state}" en Altum.`);
    if (!cerrada) process.exitCode = 1;
  } else {
    console.log(`Ítem ${item.id} enlazado (ext.${connector.name}: ${tarea.id}). Ya se puede construir.`);
  }
}

// quitar-repo <proyecto> <nombre o dirección> --si: saca un repositorio mal registrado del proyecto.
// Pide confirmación explícita porque lo ve todo el equipo: sin --si solo dice qué haría.
async function quitarRepo(config) {
  const libres = textoLibre(args.slice(1));
  const [query, ...resto] = libres;
  const cual = resto.join(' ').trim();
  if (!query || !cual) throw new Error('uso: quitar-repo <nombre del proyecto> <nombre o dirección del repositorio> --si');
  const connector = anyAltum(config);
  const { match, candidates } = findProject(await listProjects(connector), query);
  if (candidates) throw new Error(`hay ${candidates.length} proyectos parecidos a "${query}": ${candidates.map((p) => p.name).join(', ')}`);
  if (!match) throw new Error(`ninguno de tus proyectos se parece a "${query}".`);
  const lista = (await listRepos(connector, match.id)) || match.repos;
  const { repo, choices } = findRepo({ ...match, repos: lista }, cual);
  if (!repo || choices) {
    console.log(`No sé cuál quitar de "${match.name}". Sus repositorios son:`);
    (choices || lista).forEach((r) => console.log(`  ${r.name}`));
    process.exitCode = 1;
    return;
  }
  if (!flag('--si')) {
    console.log(`Quitaría "${repo.name}" de "${match.name}" (${repo.url}).`);
    console.log('Pregúntale a la persona si es ese y vuelve a llamarme con --si. Lo ve todo el equipo; el código no se borra, solo el registro en Altum.');
    process.exitCode = 1;
    return;
  }
  const { quitado, motivo } = await removeProjectRepo(connector, match.id, repo);
  console.log(quitado
    ? `Listo: "${repo.name}" ya no figura en "${match.name}". El repositorio sigue existiendo; solo se quitó de Altum.`
    : `"${repo.name}" no estaba registrado en "${match.name}"${motivo ? '' : ''}. No cambié nada.`);
}

// clone <nombre> [--in <carpeta>] [--dry-run]: busca el proyecto en Altum y lo clona desde repo_url.
// Sirve aunque este repositorio no tenga nada configurado: solo hace falta la clave de Altum.
async function clone(config) {
  const query = textoLibre(args.slice(1)).join(' ').trim();
  if (!query) throw new Error('uso: clone <nombre del proyecto> [--repo <cuál>] [--in <carpeta madre> | --into <ruta exacta> | --here] [--dry-run]');
  const { match, candidates } = findProject(await listProjects(anyAltum(config)), query);
  if (candidates) {
    console.log(`Hay ${candidates.length} proyectos parecidos a "${query}". ¿Cuál es?`);
    candidates.forEach((p) => console.log(`  ${p.name}${p.client ? `  · cliente: ${p.client}` : ''}`));
    process.exitCode = 1;
    return;
  }
  if (!match) throw new Error(`ninguno de tus proyectos se parece a "${query}". Mira la lista con "projects"; si falta uno, pide que te asignen a él en Altum.`);
  if (!match.repo) throw new Error(`"${match.name}" no tiene repositorio registrado en Altum. Regístralo en su ficha ("Repositorios") y vuelve a intentar.`);
  // Un proyecto puede tener varios repositorios (app, web, consola...). Cuál se trae lo elige la persona.
  const { repo, choices } = findRepo(match, option('--repo', ''));
  if (choices) {
    console.log(`"${match.name}" tiene ${choices.length} repositorios. Pregúntale a la persona cuál quiere y vuelve a llamarme con --repo <nombre>:`);
    choices.forEach((r) => console.log(`  --repo ${r.name.split('/').pop().padEnd(20)} ${r.url}`));
    process.exitCode = 1;
    return;
  }
  // La carpeta NUNCA se decide sola: la elige la persona.
  //   --in <carpeta madre> → <carpeta>/<clave>   ·   --into <ruta> o --here → el contenido va ahí mismo.
  if (!flag('--here') && !args.includes('--in') && !args.includes('--into')) {
    throw new Error(`no clono sin saber dónde. Pregúntale a la persona en qué carpeta lo quiere y vuelve a llamarme:\n`
      + `  --in <carpeta madre>   → queda en <carpeta>/${path.basename(targetDir(match, '.', { repo }))}\n`
      + `  --into <ruta exacta>   → el contenido del repositorio queda ahí mismo\n`
      + `  --here                 → en la carpeta actual (solo si está vacía)`);
  }
  const exact = flag('--here') || args.includes('--into');
  const parent = flag('--here') ? '.' : option('--into', option('--in'));
  const dir = targetDir(match, parent, { exact, repo });
  if (alreadyThere(dir)) return console.log(`"${match.name}" ya está en ${dir}. Ábrelo ahí; no se clona de nuevo.`);
  if (flag('--dry-run')) return console.log(`git clone ${repo?.url || match.repo} ${dir}`);
  cloneProject(match, parent, { exact, repo });
  console.log(`Clonado: ${match.name}${match.repos.length > 1 ? ` (${repo.name})` : ''} → ${dir}`);
  console.log(`Ábrelo con Claude Code. Si todavía no tiene la metodología, usa /sn-setup (proyecto de Altum: ${match.id}).`);
}

async function backlog(config) {
  const connector = altumConnector(config, args[1]);
  const [list, equipo, yo] = await Promise.all([
    readBacklog(connector),
    integrantes(connector).catch(() => []),
    miEmpleado(connector).catch(() => null),
  ]);
  if (flag('--json')) process.stdout.write(`${JSON.stringify(list.map(({ task, ...rest }) => rest), null, 2)}\n`);
  else process.stdout.write(backlogMarkdown(list, { all: flag('--all'), equipo, yo }));
}

function link(config) {
  const [, itemId, name, taskId] = args;
  altumConnector(config, name);
  const item = readItems().find((i) => i.id.toLowerCase() === String(itemId).toLowerCase());
  if (!item || !taskId) throw new Error('uso: link <ITEM> <conector altum> <id de la tarea en Altum>');
  setExternalId(item.file, name, taskId);
  const deReunion = String(taskId).startsWith('acten:')
    ? ' Viene de una reunión: solo se le pueden cambiar estado, responsable, título y descripción.' : '';
  console.log(`${item.id} quedó enlazado con la tarea ${taskId} de Altum (${item.file}).${deReunion}`);
}

async function startWatch(config) {
  const connector = altumConnector(config, args[1]);
  if (flag('--background')) {
    if (isWatching()) return;
    const rest = args.filter((a) => a !== '--background');
    spawn(process.execPath, [SELF, ...rest], { windowsHide: true, detached: process.platform !== 'win32', stdio: 'ignore', cwd: process.cwd(), env: process.env }).unref();
    return;
  }
  await watch(connector, {
    everySeconds: Math.max(Number(option('--every', 60)), 20),
    maxMinutes: Number(option('--max-minutes', 480)),
    notify: !flag('--no-notify') && connector.notify !== false,
  });
}

function inbox() {
  const notes = readInbox();
  if (!notes.length) return console.log('Sin avisos nuevos de Altum.');
  notes.forEach((n) => console.log(`- ${describe(n)}`));
  if (!flag('--peek')) clearInbox();
}

function status(config) {
  const last = loadSnapshot();
  console.log(`Proyecto: ${config.project || path.basename(process.cwd())}`);
  config.connectors.forEach((c) => console.log(`  ${c.name.padEnd(14)} ${c.kind.padEnd(8)} eventos: ${(c.events || ['*']).join(', ')}`));
  console.log(`Última sincronización: ${last?.taken_at || 'nunca'} · ítems: ${last?.items.length ?? 0} · en cola: ${readOutbox().length}`);
  // Lo que se rindió tras varios intentos: nunca en silencio.
  const descartados = existsSync(DESCARTADOS_FILE) ? readFileSync(DESCARTADOS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  if (descartados.length) {
    console.log(`No llegaron a Altum (${descartados.length}; se dejaron de reintentar):`);
    descartados.slice(-10).forEach((e) => console.log(`  ${e.at.slice(0, 16)}  ${e.item || '?'}  ${e.error || ''}`));
    console.log('  Para volver a mandarlos: asegurar <ID>');
  }
}

// Agrega una línea marcada a los hooks de git (sin reemplazar hooks existentes como husky).
const HOOK_MARK = '# softnexus-sync';
const HOOK_LINE = `( [ -f .sn/connectors.json ] && [ -f scripts/sn/sn-sync.mjs ] && node scripts/sn/sn-sync.mjs sync --background >/dev/null 2>&1 ) || true ${HOOK_MARK}`;

function githooks() {
  const configured = (() => {
    try { return execFileSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8', windowsHide: true }).trim(); } catch { return ''; }
  })();
  const raiz = gitOut(['rev-parse', '--show-toplevel']);
  const dir = configured ? path.resolve(raiz || '.', configured) : execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { windowsHide: true, encoding: 'utf8' }).trim();
  // Ganchos versionados (core.hooksPath dentro del repositorio, p. ej. .husky): son archivos del equipo.
  // Escribirlos desde cada computador dejaría cambios que nadie pidió: se dice qué agregar, en un PR.
  const enElRepo = raiz && path.resolve(dir).startsWith(`${path.resolve(raiz)}${path.sep}`)
    && !path.resolve(dir).startsWith(`${path.resolve(raiz, '.git')}${path.sep}`);
  const ignorado = (f) => { try { execFileSync('git', ['check-ignore', '-q', f], { windowsHide: true, stdio: 'ignore' }); return true; } catch { return false; } };
  if (enElRepo && !ignorado(path.join(dir, 'post-commit'))) {
    console.log(`Este repositorio usa ganchos de git versionados (${path.relative(raiz, dir)}): son del equipo y no los toco por mi cuenta.`);
    console.log(`Para sincronizar en cada commit, agrega esta línea al final de post-commit, post-merge, post-checkout y post-rewrite de esa carpeta, en un PR:\n  ${HOOK_LINE}`);
    return;
  }
  mkdirSync(dir, { recursive: true });
  for (const hook of ['post-commit', 'post-merge', 'post-checkout', 'post-rewrite']) {
    const file = path.join(dir, hook);
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '#!/bin/sh\n';
    if (!current.includes(HOOK_MARK)) writeFileSync(file, `${current.replace(/\n?$/, '\n')}${HOOK_LINE}\n`);
    chmodSync(file, 0o755);
  }
  console.log(`Sincronización enganchada a commit, merge, checkout y rebase (${dir}).`);
}

// ---- La copia del repositorio cede al motor del plugin ----
// scripts/sn viaja con las ramas: al cambiarse a una rama vieja vuelve un motor viejo, con reglas que
// ya dañaron tareas en Altum. Si este computador tiene el plugin general (alcance usuario) igual o más
// nuevo que esta copia, el trabajo lo hace el del plugin. En el CI no hay plugin: sigue la copia.
const VERSION_DE_LA_COPIA = '.version';
function cederAlPlugin() {
  if (process.env.SN_MOTOR_PROPIO) return;
  const aqui = path.dirname(SELF);
  if (existsSync(path.join(aqui, '..', '.claude-plugin', 'plugin.json'))) return;   // este YA es el del plugin
  const general = instalaciones().find((i) => i.scope === 'user' && i.ruta);
  const suyo = general && path.join(general.ruta, 'scripts', 'sn-sync.mjs');
  if (!suyo || !existsSync(suyo) || path.resolve(suyo) === path.resolve(SELF)) return;
  const mia = existsSync(path.join(aqui, VERSION_DE_LA_COPIA)) ? readFileSync(path.join(aqui, VERSION_DE_LA_COPIA), 'utf8').trim() : '';
  if (mia && esMasNueva(mia, versionInstalada(general.ruta) || general.version)) return;   // la copia es más nueva: manda ella
  const r = spawnSync(process.execPath, [suyo, ...args], { stdio: 'inherit', windowsHide: true, env: { ...process.env, SN_MOTOR_PROPIO: '1' } });
  process.exit(r.status ?? 1);
}
cederAlPlugin();

const command = args[0] || 'sync';
const config = loadConfig();
if (command === 'export') exportItems(config);
else if (command === 'list') process.stdout.write(listMarkdown(takeSnapshot(config?.project)));
else if (command === 'show') {
  const item = takeSnapshot(config?.project).items.find((i) => i.id.toLowerCase() === String(args[1]).toLowerCase());
  if (item) process.stdout.write(itemMarkdown(item));
  else { console.log(`No existe el ítem ${args[1]}. Usa "list" para ver los ids.`); process.exitCode = 1; }
}
else if (command === 'githooks') githooks();
// projects, clone y whoami funcionan aunque el repositorio todavía no esté conectado (incluso en una carpeta vacía): basta la clave de Altum.
else if (command === 'projects') await projects(config);
else if (command === 'lead') await lead(config);
else if (command === 'repos') await repos(config);
else if (command === 'pedir-config') await pedirConfig();
else if (command === 'siguiente') siguiente(config);
else if (command === 'dividir') dividir(config);
else if (command === 'verificar-firma') await verificarFirma(config);
else if (command === 'proteger-rama') proteger();
else if (command === 'asegurar') await asegurar(config);
else if (command === 'quitar-repo') await quitarRepo(config);
else if (command === 'mensaje') await mensaje(config);
else if (command === 'clone') await clone(config);
else if (command === 'set-repo') await setRepo(config);
else if (command === 'conectar') await conectar(config);
else if (command === 'motor') motor();
else if (command === 'actualizar' || command === 'version') await actualizar();
else if (command === 'limpiar-copias') limpiarCopias();
else if (command === 'dejar-de-declarar') dejarDeDeclararAqui();
else if (command === 'instalar-general') await instalarGeneral();
else if (command === 'sin-asignar') await sinAsignar(config);
else if (command === 'asignar') await asignar(config);
// repo-check: mira si el proyecto ya tiene repositorio registrado y lo deja anotado para el aviso.
else if (command === 'repo-check') {
  const connector = config?.connectors.find((c) => c.kind === 'altum' && c.project_id);
  if (connector) {
    const estado = await checkProjectRepo(connector);
    console.log(estado.missing ? repoReminder() : `"${estado.name}" se clona desde ${estado.repo}`);
  }
}
else if (command === 'whoami') {
  const connector = config?.connectors.find((c) => c.kind === 'altum' && (!args[1] || c.name === args[1]))
    || { name: 'altum', kind: 'altum' };
  const yo = await whoAmI(connector);
  process.stdout.write(whoAmIText(yo, connector.project_id));
  const aviso = nombreParaGit(yo, gitOut(['config', 'user.name']));
  if (aviso) console.log(`\n${aviso}`);
}
else if (!config || !config.connectors.length) {
  if (command !== 'sync') console.log('Proyecto sin conectores. Configúralos con /sn-connect.');
} else if (command === 'sync') await sync(config);
else if (command === 'test') await test(config);
else if (command === 'status') status(config);
else if (command === 'pull') await pull(config);
else if (command === 'backlog') await backlog(config);
else if (command === 'link') link(config);
else if (command === 'watch') await startWatch(config);
else if (command === 'watch-stop') console.log(stopWatch() ? 'Vigilante detenido.' : 'No había vigilante activo.');
else if (command === 'inbox') inbox();
else if (command === 'fetch') {
  const connector = config.connectors.find((c) => c.name === args[1]);
  if (!connector) throw new Error(`no existe el conector ${args[1]}`);
  process.stdout.write(`${JSON.stringify(await fetchExternal(connector, args[2]), null, 2)}\n`);
} else {
  console.log('Uso: sn-sync.mjs sync|test|list|show|export|fetch|projects|repos|pedir-config|siguiente|dividir|verificar-firma|proteger-rama|asegurar|whoami|lead|mensaje|clone|conectar|motor|actualizar|limpiar-copias|dejar-de-declarar|instalar-general|sin-asignar|asignar|set-repo|quitar-repo|repo-check|backlog|pull|link|watch|watch-stop|inbox|status|githooks');
  process.exitCode = 2;
}
