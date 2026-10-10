// Mensaje de validación para entregar al líder.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseLog } from '../validation-state.mjs';
import { leerTexto } from './texto.mjs';
import { projectLead } from './altum-backlog.mjs';
import { mensajeValidacion } from './validacion-mensaje.mjs';

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
export async function mensaje(config, { args, option, localActor, gitOut }) {
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

