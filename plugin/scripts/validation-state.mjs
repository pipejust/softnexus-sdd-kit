#!/usr/bin/env node
// Estado de las validaciones a distancia (formato en references/validacion.md).
//   node validation-state.mjs            -> estado de cada change activo en la rama actual (JSON)
//   node validation-state.mjs --pending  -> solicitudes sin responder en las ramas remotas (JSON), para sn-validate
// Solo lee git y archivos: el estado nunca se guarda a mano.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerTexto, normalizarTexto } from './sync/texto.mjs';
import { comoSeIdentifica, esElLider, identidadFirmante } from './sync/lider.mjs';

const CHANGES_DIR = 'openspec/changes';
const PLAN_PATHS = ['proposal.md', 'specs', 'design.md', 'tasks.md'];
const ENTRY = /^##\s+(\S+\s+\S+)\s+·\s+(SOLICITUD|APROBADO|CAMBIOS PEDIDOS|RECHAZADO)\s+·\s+sello:\s*(plano|entrega)/;
const FIELD = /^-\s+(Pide|Valida|Rama|Commit|Commit validado|Riesgo|Qué validar|Notas):\s*(.*)$/;

function git(args) {
  try {
    return execFileSync('git', args, { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function commitExists(commit) {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { windowsHide: true, stdio: 'ignore' });
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { windowsHide: true, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function parseLog(entrada) {
  const text = normalizarTexto(entrada);
  const entries = [];
  for (const line of text.split('\n')) {
    const head = line.match(ENTRY);
    if (head) {
      entries.push({ date: head[1], type: head[2], seal: head[3], fields: {}, raw: '' });
      continue;
    }
    if (entries.length) entries[entries.length - 1].raw += `${line}\n`;
    const field = line.match(FIELD);
    if (field && entries.length) entries[entries.length - 1].fields[field[1]] = field[2].trim();
  }
  return entries;
}

function commitOf(entry) {
  // "Commit validado: abc1234" o "Rama: x · Commit: abc1234" (varios campos pueden ir en la misma línea).
  const match = entry.raw.match(/Commit(?: validado)?:\s*([0-9a-f]{7,40})/);
  return match ? match[1] : '';
}

// Un commit inventado o inalcanzable (clon superficial, rama sin traer) NO es "el plano cambió
// después": es que no se puede verificar nada. Se distingue con un símbolo propio para no
// confundirlo con el "vencida" normal de seguir construyendo sobre un plano ya sellado.
const SIN_VERIFICAR = Symbol('sin-commit-verificable');
function tareasCambiaron(commit, change) {
  const archivo = `${CHANGES_DIR}/${change}/tasks.md`;
  const antes = git(['show', `${commit}:${archivo}`]);
  const ahora = existsSync(archivo) ? leerTexto(archivo) : '';
  const normalizar = (t) => t.replace(/\[[xX]\]/g, '[ ]').trim();
  if (normalizar(antes) === normalizar(ahora)) return false;
  // dividir mueve las pendientes a una ficha enlazada; las tareas conservadas no cambian de texto.
  const division = ahora.match(/^> (\d+) tarea\(s\) pasaron a ([A-Za-z0-9-]+) el \d{4}-\d{2}-\d{2}: el plano se cerró con las (\d+) ya hechas\.$/m);
  if (!division) return true;
  const ficha = path.join('docs/items', `${division[2]}.md`);
  if (!existsSync(ficha) || !/^parent:\s*\S+/m.test(leerTexto(ficha))) return true;
  const nuevas = ahora.split('\n').filter((l) => /^\s*- \[[xX]\]/.test(l));
  const viejas = antes.split('\n').filter((l) => /^\s*- \[[ xX]\]/.test(l)).map(normalizar);
  return nuevas.length !== Number(division[3]) || viejas.length - nuevas.length !== Number(division[1])
    || nuevas.some((l) => !viejas.includes(normalizar(l)));
}
function changedSince(commit, change, seal) {
  if (!commit || !commitExists(commit)) return SIN_VERIFICAR;
  const scope = seal === 'plano' ? PLAN_PATHS.map((p) => path.join(CHANGES_DIR, change, p)) : ['.'];
  // Los commits que solo tocan validacion.md no invalidan nada.
  const paths = [...scope, `:(exclude)${CHANGES_DIR}/${change}/validacion.md`,
    ...(seal === 'plano' ? [`:(exclude)${CHANGES_DIR}/${change}/tasks.md`] : [])];
  try {
    if (seal === 'plano' && tareasCambiaron(commit, change)) return true;
    // Compara también el árbol de trabajo: una edición sin commit sí puede cambiar lo aprobado.
    execFileSync('git', ['diff', '--quiet', commit, '--', ...paths], { windowsHide: true, stdio: 'ignore' });
    return Boolean(execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...paths], { windowsHide: true, encoding: 'utf8' }).trim());
  } catch (error) {
    return error.status === 1 ? true : SIN_VERIFICAR;
  }
}

// El líder según Altum, guardado por "sn-sync lead" / "asegurar" (.sn/state/altum-lider.json).
function liderGuardado(root = '.') {
  try {
    const lider = JSON.parse(readFileSync(path.join(root, '.sn/state/altum-lider.json'), 'utf8'));
    const config = path.join(root, '.sn/connectors.json');
    const proyecto = existsSync(config) ? JSON.parse(leerTexto(config)).connectors?.find((c) => c.kind === 'altum' && c.enabled !== false)?.project_id : '';
    return proyecto && lider.project_id !== proyecto ? null : lider;
  } catch {
    return null;
  }
}


// Riesgo del ítem que usa este change (docs/items/*.md con "change: <nombre>").
function riesgoDelChange(change, root = '.') {
  const dir = path.join(root, 'docs/items');
  if (!change || !existsSync(dir)) return '';
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    const texto = leerTexto(path.join(dir, f));
    if (new RegExp(`^change:\\s*${change.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(texto)) {
      return texto.match(/^risk:\s*(R\d)/m)?.[1] || '';
    }
  }
  return '';
}

// ¿Este sello lo tiene que dar el líder? Plano R3–R4 y entrega R2+, o cuando se pidió su firma
// (hay una SOLICITUD). Un plano R0–R2 lo aprueba la propia persona, como dice el proceso.
function pideLider(entries, last, change) {
  if (entries.some((e) => e.type === 'SOLICITUD' && e.seal === last.seal)) return true;
  const nivel = Number((riesgoDelChange(change) || 'R0').slice(1));
  return last.seal === 'plano' ? nivel >= 3 : nivel >= 2;
}

export function statusOf(entries, change, lider = liderGuardado()) {
  if (!entries.length) return { status: 'sin validación' };
  const last = entries[entries.length - 1];
  const base = { seal: last.seal, by: last.fields.Pide || last.fields.Valida || '', date: last.date, notes: last.fields.Notas || '' };
  if (last.type === 'SOLICITUD') return { ...base, status: 'esperando validación', commit: commitOf(last) };
  // Solo el líder que dice Altum puede aprobar, pedir cambios o detener. Una decisión escrita por
  // cualquier otra persona no cuenta: el plano sigue esperando la firma.
  const firmante = identidadFirmante(last.fields.Valida);
  const hayFirmante = Boolean(firmante.correo || firmante.github);
  if (pideLider(entries, last, change) && (!(lider?.email || lider?.github) || !hayFirmante || !esElLider(lider, firmante))) {
    return {
      ...base,
      status: 'firma inválida',
      detail: `No se pudo verificar la firma de ${last.fields.Valida || 'un firmante sin identidad'} con el líder de Altum${lider?.name ? `: ${lider.name} (${comoSeIdentifica(lider)})` : '.'}.`
        + ' Si ese es su correo personal, que lo registre en Altum o que firme agregando su usuario de GitHub: "Nombre <correo> · GitHub @usuario".',
    };
  }
  if (last.type === 'CAMBIOS PEDIDOS') return { ...base, status: 'con correcciones' };
  if (last.type === 'RECHAZADO') return { ...base, status: 'detenido' };
  const commit = commitOf(last);
  const cambio = changedSince(commit, change, last.seal);
  return {
    ...base, commit,
    status: cambio === SIN_VERIFICAR ? 'sin commit verificable' : cambio ? 'validación vencida' : 'validado',
  };
}

function localStates() {
  if (!existsSync(CHANGES_DIR)) return [];
  return readdirSync(CHANGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive')
    .map((d) => {
      const file = path.join(CHANGES_DIR, d.name, 'validacion.md');
      const entries = existsSync(file) ? parseLog(leerTexto(file)) : [];
      return { change: d.name, ...statusOf(entries, d.name) };
    });
}

function pendingRemote() {
  git(['fetch', '--quiet', '--prune', 'origin']);
  const branches = git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])
    .split('\n').filter((b) => b && b !== 'origin' && !b.endsWith('/HEAD'));
  return branches.flatMap((ref) => {
    const files = git(['ls-tree', '-r', '--name-only', ref, '--', CHANGES_DIR])
      .split('\n').filter((f) => f.endsWith('/validacion.md') && !f.includes('/archive/'));
    return files.map((file) => {
      const entries = parseLog(git(['show', `${ref}:${file}`]));
      const last = entries[entries.length - 1];
      if (!last || last.type !== 'SOLICITUD') return null;
      return {
        branch: ref.replace(/^origin\//, ''), change: file.split('/')[2], seal: last.seal,
        by: last.fields.Pide || '', risk: (last.fields.Riesgo || '').split(' · ')[0], what: last.fields['Qué validar'] || '', date: last.date,
      };
    }).filter(Boolean);
  });
}

// ¿El plano tuvo su sello 1? Se mira solo lo del plano (una entrega posterior no lo tapa). Una firma
// "vencida" cuenta: marcar tareas en tasks.md cambia el plano y eso es normal mientras se construye.
// Lo que no cuenta: sin aprobación, esperando, con correcciones, detenido o firmado por quien no es el líder.
export function planoSellado(change, root = '.') {
  const file = path.join(root, CHANGES_DIR, change, 'validacion.md');
  const delPlano = (existsSync(file) ? parseLog(leerTexto(file)) : []).filter((e) => e.seal === 'plano');
  if (!delPlano.length) return false;
  // "sin commit verificable" NO cuenta: un sello con un commit inventado o inalcanzable no es un
  // sello de verdad, aunque el texto diga "APROBADO".
  const estado = statusOf(delPlano, change);
  if (estado.status !== 'validado') return false;
  // Avanzar las casillas de tasks.md es normal; cambiar el diseño o los escenarios exige otro sello.
  try {
    const scope = ['proposal.md', 'specs', 'design.md'].map((p) => path.join(CHANGES_DIR, change, p));
    execFileSync('git', ['diff', '--quiet', estado.commit, '--', ...scope], { windowsHide: true, stdio: 'ignore' });
    return !execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...scope], { windowsHide: true, encoding: 'utf8' }).trim();
  } catch { return false; }
}

export function validationFor(change, root = '.') {
  const file = path.join(root, CHANGES_DIR, change, 'validacion.md');
  return statusOf(existsSync(file) ? parseLog(leerTexto(file)) : [], change);
}

// fileURLToPath y no URL().pathname: una ruta con tildes o espacios ("/Volumes/Información/…")
// viaja codificada en la URL (Informaci%C3%B3n) y la comparación fallaba, así que el comando
// no imprimía nada y parecía que no había validaciones.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = process.argv.includes('--pending') ? pendingRemote() : localStates();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
