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
const PLUGIN = 'softnexus-sdd@softnexus';
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

// Los proyectos de este computador que se guardaron su propia copia del plugin: los que lo tienen
// instalado por proyecto y los que lo declaran en su .claude/settings.json (de ahí sale la copia).
// La carpeta del usuario (C:\\Users\\x, /Users/x) NUNCA es un proyecto: ahí vive la configuración
// GENERAL. Tratarla como proyecto borraba el plugin de ~/.claude/settings.json y dejaba apagada la
// copia que acababa de instalarse.
export function esCarpetaDelUsuario(carpeta) {
  const casa = path.resolve(os.homedir());
  const c = path.resolve(carpeta || '');
  return c === casa || c === path.join(casa, '.claude');
}

export function proyectosConCopia(installs = instalaciones()) {
  const carpetas = new Set(installs.filter((i) => i.scope !== 'user' && i.proyecto && !esCarpetaDelUsuario(i.proyecto)).map((i) => i.proyecto));
  try {
    const abiertos = JSON.parse(readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')).projects || {};
    for (const carpeta of Object.keys(abiertos)) {
      if (!esCarpetaDelUsuario(carpeta) && declaraElPlugin(carpeta)) carpetas.add(carpeta);
    }
  } catch { /* sin lista de proyectos: basta con los instalados */ }
  return [...carpetas];
}

const AJUSTES = (carpeta) => path.join(carpeta, '.claude', 'settings.json');

export function declaraElPlugin(carpeta) {
  try {
    const d = JSON.parse(readFileSync(AJUSTES(carpeta), 'utf8'));
    return Boolean((d.enabledPlugins || {})[PLUGIN]);
  } catch {
    return false;
  }
}

// Quitar la línea que hace que ese proyecto se guarde su propia copia. Lo demás del archivo no se toca.
export function dejarDeDeclarar(carpeta) {
  if (esCarpetaDelUsuario(carpeta)) return false;   // esa es la configuración general: no se toca
  if (!declaraElPlugin(carpeta)) return false;
  const archivo = AJUSTES(carpeta);
  const d = JSON.parse(readFileSync(archivo, 'utf8'));
  delete d.enabledPlugins[PLUGIN];
  if (!Object.keys(d.enabledPlugins).length) delete d.enabledPlugins;
  writeFileSync(archivo, `${JSON.stringify(d, null, 2)}\n`);
  return true;
}

// 1) Quitar el plugin de TODOS los proyectos: las copias instaladas dentro de cada carpeta y la
// línea de su settings.json que las pedía. Después de esto manda una sola, la del computador.
export function pasosLimpieza({ installs = instalaciones() } = {}) {
  const pasos = [];
  for (const carpeta of proyectosConCopia(installs)) {
    // La carpeta pudo moverse o borrarse (pasa mucho con OneDrive o proyectos viejos). Entonces no
    // hay nada que limpiar ahí: intentarlo solo produce un error que no le sirve a nadie.
    if (!existsSync(carpeta)) {
      pasos.push({ fn: () => true, opcional: true, nota: `${path.basename(carpeta)} ya no existe en el disco: nada que limpiar` });
      continue;
    }
    pasos.push({
      cmd: 'claude', args: ['plugin', 'uninstall', PLUGIN, '--scope', 'project'], cwd: carpeta, opcional: true,
      nota: `quitar la copia de ${path.basename(carpeta)}`,
    });
    pasos.push({
      fn: () => dejarDeDeclarar(carpeta), opcional: true,
      nota: `que ${path.basename(carpeta)} deje de pedir su propia copia (.claude/settings.json)`,
    });
  }
  return pasos;
}

// 2) Instalar (o dejar al día) la copia general: la del usuario, que sirve en todos los proyectos.
export function pasosInstalacionGeneral({ cat = catalogo(), installs = instalaciones() } = {}) {
  const pasos = [];
  if (cat.tipo === 'carpeta' && cat.carpeta) {
    pasos.push({ cmd: 'git', args: ['-C', cat.carpeta, 'pull', '--ff-only'], nota: 'el catálogo es una carpeta de este computador: traerla al día' });
  }
  pasos.push({ cmd: 'claude', args: ['plugin', 'marketplace', 'update'], nota: 'refrescar el catálogo' });
  const tieneUsuario = installs.some((i) => i.scope === 'user');
  pasos.push(tieneUsuario
    ? { cmd: 'claude', args: ['plugin', 'update', PLUGIN], nota: 'dejar al día la copia general (la de tu usuario)' }
    : { cmd: 'claude', args: ['plugin', 'install', PLUGIN], nota: 'instalar la copia general, la que sirve para todos los proyectos' });
  // Por si quedó apagada (pasaba cuando la limpieza tocaba por error la configuración del usuario).
  pasos.push({ cmd: 'claude', args: ['plugin', 'enable', PLUGIN, '--scope', 'user'], opcional: true, nota: 'dejarla encendida' });
  return pasos;
}

// Las dos cosas de una: limpiar y dejar la general al día.
export function pasosGenerales(opciones = {}) {
  return [...pasosLimpieza(opciones), ...pasosInstalacionGeneral(opciones)];
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
// Hay "fallos" que en realidad son el resultado que queríamos: la copia ya estaba encendida, o el
// proyecto ya no tenía copia que quitar. No son problemas y no deben asustar a nadie.
export function esBenigno(motivo) {
  return /already enabled|ya está (habilitado|activado|encendid)|not installed|no está instalad|installed in user scope|not found|no such plugin|ya no existe|ENOENT/i.test(String(motivo || ''));
}

export function ejecutarPasos(pasos, { correr = ejecutar } = {}) {
  const resultados = [];
  for (const paso of pasos) {
    console.log(`\n→ ${paso.fn ? paso.nota : `${paso.cmd} ${paso.args.join(' ')}`}${paso.cwd ? `   (en ${paso.cwd})` : ''}`);
    try {
      correr(paso);
      resultados.push({ paso, ok: true });
    } catch (error) {
      const todo = String(error.todo || error.message || error);
      const motivo = (todo.split('\n').map((l) => l.trim()).filter(Boolean).find((l) => /✘|error|fail|no se|cannot/i.test(l))
        || String(error.message || error).split('\n')[0]).slice(0, 300);
      if (esBenigno(todo)) {
        console.log('   (ya estaba así: nada que hacer)');
        resultados.push({ paso, ok: true, yaEstaba: true });
        continue;
      }
      console.log(`   ✗ NO SE PUDO: ${motivo}`);
      resultados.push({ paso, ok: false, motivo });
    }
  }
  return resultados;
}

// En Windows, "claude" es claude.cmd y Node ya NO deja ejecutar archivos .cmd directamente (EINVAL,
// por seguridad): hay que pasar por el shell. Y al pasar por el shell, los argumentos no se escapan
// solos, así que las rutas con espacios ("C:\\Mis Proyectos\\x") se comillan aquí.
export function entrecomillar(argumento) {
  const a = String(argumento);
  return /[\s&|<>^()"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
}

// Se captura TODO lo que escribe el comando (salida y errores) y después se imprime. claude manda
// sus mensajes por la salida normal, no por la de errores: mirando solo "stderr" no había forma de
// distinguir un fallo de verdad de un "ya estaba así".
function ejecutar(paso) {
  if (paso.fn) return paso.fn();
  const opciones = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: paso.cwd || process.cwd(), timeout: 180000, windowsHide: true };
  try {
    const salida = process.platform === 'win32'
      ? execFileSync(paso.cmd, paso.args.map(entrecomillar), { ...opciones, shell: true, windowsHide: true })
      : execFileSync(paso.cmd, paso.args, { ...opciones, windowsHide: true });
    if (salida?.trim()) console.log(`   ${salida.trim().split('\n').join('\n   ')}`);
    return salida;
  } catch (error) {
    error.todo = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`;
    if (paso.cwd && !existsSync(paso.cwd)) error.todo += '\nesa carpeta ya no existe';
    throw error;
  }
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
