// ¿Está al día este plugin? Cada computador lo instaló a su manera: unos desde GitHub, otros desde
// una carpeta clonada a mano. Cuando el catálogo es una carpeta local, "marketplace update" solo la
// revalida —no hace git pull—, así que la persona actualiza, le dice "ya estás en la última" y
// sigue con una versión vieja sin enterarse. Por eso el plugin comprueba por su cuenta y dice qué
// correr en ESA máquina.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = 'pipejust/softnexus-sdd-kit';
const MANIFIESTO = `https://raw.githubusercontent.com/${REPO}/main/plugin/.claude-plugin/plugin.json`;
const CADA = 12 * 60 * 60 * 1000;   // no se pregunta más de dos veces al día
const CACHE = path.join(os.homedir(), '.claude', 'sn-version.json');

export function versionInstalada(raizPlugin) {
  try {
    return JSON.parse(readFileSync(path.join(raizPlugin, '.claude-plugin', 'plugin.json'), 'utf8')).version || '';
  } catch {
    return '';
  }
}

// "0.49.0" > "0.38.1": se comparan los tres números, no el texto (si no, "0.9" ganaría a "0.10").
export function esMasNueva(a, b) {
  const n = (v) => String(v || '').split('.').map((x) => Number(x) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

function leerCache() {
  try {
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  } catch {
    return null;
  }
}

function guardarCache(valor) {
  try {
    mkdirSync(path.dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(valor));
  } catch { /* sin permiso de escritura: no es grave */ }
}

// La última versión publicada. Con {rapido:true} no sale a la red: usa lo último que se supo.
export async function ultimaPublicada({ rapido = false } = {}) {
  const cache = leerCache();
  if (rapido || (cache && Date.now() - cache.at < CADA)) return cache?.ultima || '';
  try {
    const r = await fetch(MANIFIESTO, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(String(r.status));
    const { version } = await r.json();
    guardarCache({ at: Date.now(), ultima: version });
    return version || '';
  } catch {
    guardarCache({ at: Date.now(), ultima: cache?.ultima || '' });  // sin red: se reintenta luego
    return cache?.ultima || '';
  }
}

// Cómo se registró el catálogo en ESTE computador: desde GitHub o desde una carpeta clonada a mano.
export function catalogo(nombre = 'softnexus') {
  try {
    const d = JSON.parse(readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'known_marketplaces.json'), 'utf8'));
    const fuente = d?.[nombre]?.source || {};
    const carpeta = fuente.source === 'local' || fuente.source === 'directory' ? (fuente.path || d[nombre].installLocation) : '';
    return { tipo: carpeta ? 'carpeta' : (fuente.source || 'desconocido'), carpeta, repo: fuente.repo || '' };
  } catch {
    return { tipo: 'desconocido', carpeta: '', repo: '' };
  }
}

// Dónde está instalado y en qué versión: la copia del proyecto gana sobre la del usuario.
export function instalaciones(plugin = 'softnexus-sdd@softnexus') {
  try {
    const d = JSON.parse(readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
    return (d?.plugins?.[plugin] || []).map((i) => ({ scope: i.scope, version: i.version, proyecto: i.projectPath || '' }));
  } catch {
    return [];
  }
}

// Las copias que de verdad mandan en ESTA sesión: la del usuario y, si existe, la del proyecto
// abierto (las de otros proyectos no estorban aquí y avisar por ellas sería ruido).
export function instalacionesDeAqui(carpeta, installs = instalaciones()) {
  const aqui = path.resolve(carpeta || process.cwd());
  return installs.filter((i) => i.scope === 'user'
    || (i.proyecto && (aqui === path.resolve(i.proyecto) || aqui.startsWith(`${path.resolve(i.proyecto)}${path.sep}`))));
}

// Todo lo que hay que correr en esta máquina, en orden y listo para ejecutar.
// Cada paso dice por qué está: así la persona ve lo mismo que se va a hacer.
export function pasosParaActualizar({ cat = catalogo(), installs = instalaciones() } = {}) {
  const pasos = [];
  if (cat.tipo === 'carpeta' && cat.carpeta) {
    pasos.push({
      cmd: 'git', args: ['-C', cat.carpeta, 'pull', '--ff-only'],
      nota: 'el catálogo de este computador es una carpeta, no GitHub: "marketplace update" no la trae al día',
    });
  }
  pasos.push({ cmd: 'claude', args: ['plugin', 'marketplace', 'update'], nota: 'refrescar el catálogo' });
  pasos.push({ cmd: 'claude', args: ['plugin', 'update', 'softnexus-sdd@softnexus'], nota: 'la copia de tu usuario' });
  for (const i of installs.filter((x) => x.scope !== 'user' && x.proyecto)) {
    pasos.push({
      cmd: 'claude', args: ['plugin', 'update', 'softnexus-sdd@softnexus', '--scope', 'project'], cwd: i.proyecto,
      nota: `la copia de ${path.basename(i.proyecto)} (${i.version}), que manda dentro de ese proyecto`,
    });
  }
  return pasos;
}

export function comoActualizar(opciones = {}) {
  return pasosParaActualizar(opciones).map((p) => `${p.cwd ? `cd "${p.cwd}" && ` : ''}${p.cmd} ${p.args.join(' ')}   # ${p.nota}`);
}

// Correrlos de una. Se muestra cada comando antes de ejecutarlo y, si uno falla, se sigue con los
// demás: que una carpeta borrada o un proyecto movido no deje el resto sin actualizar.
export function ejecutarPasos(pasos, { correr = ejecutar } = {}) {
  const resultados = [];
  for (const paso of pasos) {
    console.log(`\n→ ${paso.cmd} ${paso.args.join(' ')}${paso.cwd ? `   (en ${paso.cwd})` : ''}`);
    try {
      correr(paso);
      resultados.push({ paso, ok: true });
    } catch (error) {
      console.log(`   No se pudo: ${String(error.message || error).split('\n')[0]}`);
      resultados.push({ paso, ok: false });
    }
  }
  return resultados;
}

function ejecutar(paso) {
  execFileSync(paso.cmd, paso.args, { stdio: 'inherit', cwd: paso.cwd || process.cwd(), timeout: 180000, windowsHide: true });
}

export function gitAtrasado(carpeta) {
  if (!carpeta || !existsSync(path.join(carpeta, '.git'))) return 0;
  try {
    execFileSync('git', ['-C', carpeta, 'fetch', '-q', 'origin'], { stdio: 'ignore', timeout: 15000, windowsHide: true });
    const n = execFileSync('git', ['-C', carpeta, 'rev-list', '--count', 'HEAD..@{u}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, windowsHide: true });
    return Number(n.trim()) || 0;
  } catch {
    return 0;
  }
}
