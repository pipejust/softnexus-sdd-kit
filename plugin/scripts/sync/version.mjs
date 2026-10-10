// ¿Está al día este plugin? Cada computador lo instaló a su manera: unos desde GitHub, otros desde
// una carpeta clonada a mano. Cuando el catálogo es una carpeta local, "marketplace update" solo la
// revalida —no hace git pull—, así que la persona actualiza, le dice "ya estás en la última" y
// sigue con una versión vieja sin enterarse. Por eso el plugin comprueba por su cuenta y dice qué
// correr en ESA máquina.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { leerTexto } from './texto.mjs';

const REPO = 'pipejust/softnexus-sdd-kit';
const PLUGIN = 'softnexus-sdd@softnexus';
const CATALOGO = 'softnexus';
const MANIFIESTO = `https://raw.githubusercontent.com/${REPO}/main/plugin/.claude-plugin/plugin.json`;
const CADA = 12 * 60 * 60 * 1000;   // no se pregunta más de dos veces al día
const CACHE = path.join(os.homedir(), '.claude', 'sn-version.json');

// Los JSON de configuración se leen sin BOM: en Windows algunos editores lo agregan y JSON.parse falla
// (el proyecto parecía no declarar el plugin y la limpieza se lo saltaba).
const leerJson = (archivo) => JSON.parse(leerTexto(archivo));

export function versionInstalada(raizPlugin) {
  try {
    return leerJson(path.join(raizPlugin, '.claude-plugin', 'plugin.json')).version || '';
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
// Con {fresco:true} (lo pide una persona con "actualizar") siempre se pregunta: la caché de 12 h es
// para el hook, y decirle "ya estás al día" con un dato viejo era justo lo que confundía a la gente.
export async function ultimaPublicada({ rapido = false, fresco = false } = {}) {
  const cache = leerCache();
  if (rapido || (!fresco && cache && Date.now() - cache.at < CADA)) return cache?.ultima || '';
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

// Para cuando una PERSONA pide la verdad (no el hook en segundo plano, que usa ultimaPublicada de
// arriba): dice si de verdad se pudo preguntar, para no decir "Todo al día" con un dato de caché
// cuando en realidad no hay conexión en este momento.
export async function versionPublicadaDeVerdad() {
  try {
    const r = await fetch(MANIFIESTO, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(String(r.status));
    const { version } = await r.json();
    guardarCache({ at: Date.now(), ultima: version });
    return { ultima: version || '', red: true };
  } catch {
    return { ultima: leerCache()?.ultima || '', red: false };
  }
}

// Cómo se registró el catálogo en ESTE computador: desde GitHub o desde una carpeta clonada a mano.
export function catalogo(nombre = 'softnexus') {
  try {
    const d = leerJson(path.join(os.homedir(), '.claude', 'plugins', 'known_marketplaces.json'));
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
    const d = leerJson(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'));
    return (d?.plugins?.[plugin] || []).map((i) => ({ scope: i.scope, version: i.version, proyecto: i.projectPath || '', ruta: i.installPath || '' }));
  } catch {
    return [];
  }
}

// Las copias que de verdad mandan en ESTA sesión: la del usuario y, si existe, la del proyecto
// abierto (las de otros proyectos no estorban aquí y avisar por ellas sería ruido).
export function instalacionesDeAqui(carpeta, installs = instalaciones()) {
  const aqui = mismaCarpeta(carpeta || process.cwd());
  return installs.filter((i) => i.scope === 'user'
    || (i.proyecto && (aqui === mismaCarpeta(i.proyecto) || aqui.startsWith(`${mismaCarpeta(i.proyecto)}/`))));
}

// Los proyectos de este computador que se guardaron su propia copia del plugin: los que lo tienen
// instalado por proyecto y los que lo declaran en su .claude/settings.json (de ahí sale la copia).
// La carpeta del usuario (C:\\Users\\x, /Users/x) NUNCA es un proyecto: ahí vive la configuración
// GENERAL. Tratarla como proyecto borraba el plugin de ~/.claude/settings.json y dejaba apagada la
// copia que acababa de instalarse.
export function esCarpetaDelUsuario(carpeta) {
  const casa = mismaCarpeta(os.homedir());
  const c = mismaCarpeta(carpeta || '');
  return c === casa || c === mismaCarpeta(path.join(os.homedir(), '.claude'));
}

// Una misma carpeta puede venir escrita de dos formas (C:\\x\\y y C:/x/y, o con otras mayúsculas en
// Windows): para contarla una sola vez se compara normalizada.
export function mismaCarpeta(carpeta) {
  const crudo = String(carpeta || '');
  const c = path.resolve(crudo.replace(/\\/g, '/')).replace(/\\/g, '/').replace(/\/+$/, '');
  // Windows y macOS no distinguen mayúsculas en las rutas; Linux sí.
  return process.platform === 'win32' || process.platform === 'darwin' || /^[a-z]:/i.test(crudo) ? c.toLowerCase() : c;
}

export function proyectosConCopia(installs = instalaciones()) {
  const vistas = new Map();
  const agregar = (c) => { const clave = mismaCarpeta(c); if (!vistas.has(clave)) vistas.set(clave, c); };
  installs.filter((i) => i.scope !== 'user' && i.proyecto && !esCarpetaDelUsuario(i.proyecto)).forEach((i) => agregar(i.proyecto));
  const carpetas = { add: agregar };
  try {
    const abiertos = leerJson(path.join(os.homedir(), '.claude.json')).projects || {};
    for (const carpeta of Object.keys(abiertos)) {
      if (!esCarpetaDelUsuario(carpeta) && declaraElPlugin(carpeta)) carpetas.add(carpeta);
    }
  } catch { /* sin lista de proyectos: basta con los instalados */ }
  return [...vistas.values()];
}

const AJUSTES = (carpeta) => path.join(carpeta, '.claude', 'settings.json');

export function declaraElPlugin(carpeta) {
  try {
    const d = leerJson(AJUSTES(carpeta));
    return Boolean((d.enabledPlugins || {})[PLUGIN]);
  } catch {
    return false;
  }
}

// ¿Ese archivo está versionado en git? Un archivo versionado es del EQUIPO: si el plugin lo cambia
// por su cuenta, el repo queda con un cambio sin guardar en el computador de cada persona, y si alguien
// lo sube, le cambia la configuración a todos. Esos archivos solo se cambian con un PR.
// true si SE SABE que está versionado; false si SE SABE que no lo está; null si no se pudo preguntar
// (sin git en el PATH, timeout, repo con lock). Sin poder preguntar, nunca se trata como personal:
// eso dejaba editar en silencio el settings.json del equipo en una máquina sin git en el PATH.
export function estaVersionado(archivo) {
  try {
    execFileSync('git', ['-C', path.dirname(archivo), 'ls-files', '--error-unmatch', path.basename(archivo)],
      { stdio: 'ignore', timeout: 10000, windowsHide: true });
    return true;
  } catch (error) {
    // git sale EXACTAMENTE 1 cuando el archivo de verdad no está versionado (es el contrato de
    // --error-unmatch). Cualquier otro motivo para fallar (ENOENT: sin git en el PATH; timeout; una
    // señal) es "no se pudo preguntar", y eso nunca se trata como "no versionado": se tratarÍa como
    // personal un archivo que en realidad es del equipo, y se editaría sin que nadie lo pidiera.
    return error.status === 1 ? false : null;
  }
}

// Quitar la línea que hace que ese proyecto se guarde su propia copia. Lo demás del archivo no se toca.
export function dejarDeDeclarar(carpeta) {
  if (esCarpetaDelUsuario(carpeta)) return false;   // esa es la configuración general: no se toca
  if (!declaraElPlugin(carpeta)) return false;
  const archivo = AJUSTES(carpeta);
  const d = leerJson(archivo);
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
    // Una carpeta puede tener copia "project" (la pide su .claude/settings.json) y "local" (solo de esa
    // persona) a la vez: se quitan las dos, cada una con su ámbito (con el equivocado, claude falla).
    // "uninstall --scope project" lo hace claude EDITANDO .claude/settings.json: si ese archivo es del
    // equipo (versionado), no se corre; queda para un PR.
    // Sin poder preguntarle a git (sin git en el PATH, timeout, repo con lock) NUNCA se trata como
    // personal: se asume que SÍ es del equipo, para no terminar editando por error su settings.json.
    const versionado = existsSync(AJUSTES(carpeta)) && estaVersionado(AJUSTES(carpeta)) !== false;
    const ambitos = [...new Set(installs
      .filter((i) => i.scope !== 'user' && i.proyecto && mismaCarpeta(i.proyecto) === mismaCarpeta(carpeta))
      .map((i) => i.scope))];
    for (const ambito of ambitos) {
      if (ambito === 'project' && versionado) {
        pasos.push({ cmd: 'claude', args: ['plugin', 'update', PLUGIN, '--scope', 'project'], cwd: carpeta,
          pendientePr: carpeta, nota: `actualizar la copia de ${path.basename(carpeta)}; retirar su configuración versionada requiere PR` });
        continue;
      }
      pasos.push({
        cmd: 'claude', args: ['plugin', 'uninstall', PLUGIN, '--scope', ambito], cwd: carpeta, opcional: true,
        nota: `quitar la copia de ${path.basename(carpeta)} (ámbito ${ambito})`,
      });
    }
    if (!declaraElPlugin(carpeta)) continue;
    if (versionado) {
      // No se toca: es del equipo. Queda anotado para que lo quite quien administra el repo, con un PR.
      pasos.push({
        fn: () => true, opcional: true, pendientePr: carpeta,
        nota: `${path.basename(carpeta)} pide el plugin en su .claude/settings.json versionado: NO lo toco (va con un PR)`,
      });
      continue;
    }
    pasos.push({
      fn: () => dejarDeDeclarar(carpeta), opcional: true,
      nota: `que ${path.basename(carpeta)} deje de pedir su propia copia (.claude/settings.json local)`,
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
  pasos.push({ cmd: 'claude', args: ['plugin', 'marketplace', 'update', CATALOGO], nota: 'refrescar el catálogo de Softnexus' });
  const tieneUsuario = installs.some((i) => i.scope === 'user');
  pasos.push(tieneUsuario
    ? { cmd: 'claude', args: ['plugin', 'update', PLUGIN], nota: 'dejar al día la copia general (la de tu usuario)' }
    : { cmd: 'claude', args: ['plugin', 'install', PLUGIN], nota: 'instalar la copia general, la que sirve para todos los proyectos' });
  // Por si quedó apagada (pasaba cuando la limpieza tocaba por error la configuración del usuario).
  pasos.push({ cmd: 'claude', args: ['plugin', 'enable', PLUGIN, '--scope', 'user'], opcional: true, nota: 'dejarla encendida' });
  return pasos;
}

// Las dos cosas de una: limpiar y dejar la general al día.
// La general se instala PRIMERO: si algo sale mal ahí (sin red, catálogo movido) y se hubiera
// limpiado antes, el computador se queda sin ningún plugin, peor que al empezar.
export function pasosGenerales(opciones = {}) {
  return [...pasosInstalacionGeneral(opciones), ...pasosLimpieza(opciones)];
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
  pasos.push({ cmd: 'claude', args: ['plugin', 'marketplace', 'update', CATALOGO], nota: 'refrescar el catálogo de Softnexus' });
  // Si no hay copia de usuario todavía, "update" fallaría siempre ("not installed" cuenta como fallo
  // real al actualizar): se instala, igual que en pasosInstalacionGeneral.
  pasos.push(installs.some((i) => i.scope === 'user')
    ? { cmd: 'claude', args: ['plugin', 'update', 'softnexus-sdd@softnexus'], nota: 'la copia de tu usuario' }
    : { cmd: 'claude', args: ['plugin', 'install', 'softnexus-sdd@softnexus'], nota: 'instalar la copia de tu usuario (todavía no la tenías)' });
  for (const i of installs.filter((x) => x.scope !== 'user' && x.proyecto)) {
    if (!existsSync(i.proyecto)) {
      pasos.push({ fn: () => true, opcional: true, nota: `${path.basename(i.proyecto)} ya no existe en el disco: nada que actualizar ahí` });
      continue;
    }
    pasos.push({
      cmd: 'claude', args: ['plugin', 'update', 'softnexus-sdd@softnexus', '--scope', i.scope], cwd: i.proyecto,
      nota: `la copia de ${path.basename(i.proyecto)} (${i.version}), que manda dentro de ese proyecto`,
    });
  }
  return pasos;
}

// En Windows la gente pega esto en PowerShell, que (en la versión 5) no entiende "&&": se usa ";",
// que sirve igual en PowerShell y en bash.
export function comoActualizar(opciones = {}, plataforma = process.platform) {
  const y = plataforma === 'win32' ? '; ' : ' && ';
  // Entrecomillado SIEMPRE, no solo en Windows: una ruta de este mismo repositorio tiene acentos y
  // espacios, y sin comillas git la cortaba en el primer espacio con un error que no explicaba nada.
  // Los pasos "fn" (p. ej. "esa carpeta ya no existe") no tienen un comando que pegar: no se listan.
  return pasosParaActualizar(opciones).filter((p) => !p.fn).map((p) => `${p.cwd ? `cd "${p.cwd}"${y}` : ''}${p.cmd} ${p.args.map(entrecomillar).join(' ')}   # ${p.nota}`);
}

// Correrlos de una. Se muestra cada comando antes de ejecutarlo y, si uno falla, se sigue con los
// demás: que una carpeta borrada o un proyecto movido no deje el resto sin actualizar.
// Hay "fallos" que en realidad son el resultado que queríamos: la copia ya estaba encendida, o el
// proyecto ya no tenía copia que quitar. No son problemas y no deben asustar a nadie.
// Cuando claude dice "está instalado en X, no en Y", ahí mismo viene el ámbito correcto.
export function ambitoQuePide(texto) {
  return String(texto || '').match(/installed in (\w+) scope/i)?.[1] || '';
}

// Qué cuenta como "ya estaba así" depende del comando: "no está instalado" es lo que se quería al
// desinstalar, pero al ACTUALIZAR es un fallo de verdad. Y ENOENT (no se encontró "claude") nunca lo es.
const YA_ESTABA = {
  // "not found" SUELTO no vale: "Marketplace softnexus not found" (el catálogo se desregistró) es un
  // fallo de verdad, no "ya estaba desinstalado". Se exige la frase completa que usa claude.
  uninstall: /plugin .*(is )?not installed|no está instalad|installed in user scope|no such plugin|ya no existe/i,
  enable: /already enabled|ya está (habilitado|activado|encendid)/i,
  install: /already installed|ya está instalad/i,
};
export function esBenigno(motivo, paso = null) {
  if (typeof paso !== 'object') paso = null;   // también se usa como callback de .every/.some
  const que = paso ? paso.que || (paso.cmd === 'claude' ? paso.args?.[1] : '') : '';
  const listas = paso ? [YA_ESTABA[que]].filter(Boolean) : Object.values(YA_ESTABA);
  return listas.some((re) => re.test(String(motivo || '')));
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
      // El motivo de verdad: la última línea del comando que explica algo. Se buscan las dos cruces
      // (✘ la de claude, ✗ la nuestra cuando el que falló fue otro paso nuestro) y los errores comunes.
      // Solo lo que IMPRIMIÓ el comando, no el "Command failed: ..." que agrega Node y no explica nada.
      const impreso = `${error.stdout || ''}\n${error.stderr || ''}`;
      const pistas = impreso.split('\n').map((l) => l.trim()).filter(Boolean)
        .filter((l) => /✘|✗|error|fail|no se pudo|cannot|denied|ENOENT|EINVAL|EACCES|no se reconoce|is not recognized|not found/i.test(l));
      const motivo = (pistas[pistas.length - 1] || String(error.message || error).split('\n')[0])
        .replace(/^✗\s*NO SE PUDO:\s*/, '').slice(0, 300);
      // "está instalado en local, no en project": se reintenta con el ámbito que pide, una sola vez.
      const otroAmbito = ambitoQuePide(todo);
      if (otroAmbito && paso.args?.includes('uninstall') && !paso.reintentado && otroAmbito !== 'user') {
        if (otroAmbito === 'project' && existsSync(AJUSTES(paso.cwd)) && estaVersionado(AJUSTES(paso.cwd)) !== false) {
          resultados.push(...ejecutarPasos([{ cmd: 'claude', args: ['plugin', 'update', PLUGIN, '--scope', 'project'], cwd: paso.cwd,
            pendientePr: paso.cwd, nota: 'actualizar la copia sin editar la configuración del equipo' }], { correr }));
          continue;
        }
        const conOtro = { ...paso, reintentado: true, args: paso.args.map((a, i) => (paso.args[i - 1] === '--scope' ? otroAmbito : a)) };
        console.log(`   (esa copia es de ámbito ${otroAmbito}: lo intento así)`);
        resultados.push(...ejecutarPasos([conOtro], { correr }));
        continue;
      }
      if (esBenigno(todo, paso)) {
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
  // Una barra al final ("C:\\x\\") se duplica: si no, la \\ escapa la comilla de cierre y el argumento
  // se come lo que sigue.
  return /[\s&|<>^()"]/.test(a) ? `"${a.replace(/"/g, '""').replace(/(\\+)$/, '$1$1')}"` : a;
}

// Se captura TODO lo que escribe el comando (salida y errores) y después se imprime. claude manda
// sus mensajes por la salida normal, no por la de errores: mirando solo "stderr" no había forma de
// distinguir un fallo de verdad de un "ya estaba así".
// En Windows "claude" es claude.cmd, y Node no deja ejecutar .cmd directamente (EINVAL). Pasarle
// shell:true con una lista de argumentos funciona, pero Node lo marcó obsoleto (DEP0190) y en una
// versión futura será error. Se hace lo mismo que haría el shell, explícito: cmd.exe con UNA línea
// ya entrecomillada y sin que Node vuelva a escaparla.
export function lineaParaCmd(cmd, args) {
  return `"${[cmd, ...args].map(entrecomillar).join(' ')}"`;
}

function correrEnWindows(paso, opciones) {
  return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', lineaParaCmd(paso.cmd, paso.args)],
    { ...opciones, windowsVerbatimArguments: true, windowsHide: true });
}

function ejecutar(paso) {
  if (paso.fn) return paso.fn();
  const opciones = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: paso.cwd || process.cwd(), timeout: 180000, windowsHide: true };
  try {
    const salida = process.platform === 'win32'
      ? correrEnWindows(paso, opciones)
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
