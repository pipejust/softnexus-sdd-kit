// Mantenimiento de la instalación general y las copias de proyecto.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogo, comoActualizar, declaraElPlugin, dejarDeDeclarar, ejecutarPasos, esMasNueva, gitAtrasado, instalaciones, pasosInstalacionGeneral, pasosLimpieza, pasosParaActualizar, proyectosConCopia, ultimaPublicada, versionInstalada, versionPublicadaDeVerdad } from './version.mjs';
const SELF = fileURLToPath(new URL('../sn-sync.mjs', import.meta.url));
const flag = (name) => process.argv.slice(2).includes(name);

// actualizar: ¿está al día el plugin en ESTE computador? Cada máquina lo instaló distinto —desde
// GitHub o desde una carpeta clonada a mano, para el usuario o dentro de un proyecto— y por eso
// "ya estás en la última" a veces miente. Aquí se dice la verdad y qué correr, en orden.
export async function actualizar() {
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
  const conPr = [...new Set(hechos.filter((h) => h.paso?.pendientePr).map((h) => h.paso.pendientePr))];
  if (conPr.length) {
    console.log(`\n${conPr.length} repositorio(s) piden el plugin en un archivo VERSIONADO (.claude/settings.json).`
      + ' No lo toqué: es del equipo. Quien administre cada uno, dentro del repo y en una rama:');
    console.log('   node "' + SELF + '" dejar-de-declarar   y entregarlo en un PR');
    conPr.forEach((c) => console.log(`   · ${c}`));
  }
  const fallaron = hechos.filter((h) => !h.ok);
  if (!fallaron.length) return console.log(`\n${conPr.length ? 'Actualización terminada. Las copias de proyecto conservadas también quedaron al día; retirarlas requiere los PR indicados arriba.' : bien}`);
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
export function dejarDeDeclararAqui() {
  const carpeta = process.cwd();
  if (!declaraElPlugin(carpeta)) return console.log('Este repositorio no pide el plugin en .claude/settings.json: no hay nada que quitar.');
  dejarDeDeclarar(carpeta);
  console.log('Listo: .claude/settings.json ya no pide el plugin (el resto del archivo quedó igual).');
  console.log('Entrégalo en un PR: "chore: el plugin Softnexus se activa por usuario, no por proyecto".');
}

// limpiar-copias: quita el plugin de TODOS los proyectos de este computador (las copias instaladas
// dentro de cada carpeta y la línea que las pedía). Después manda una sola: la del computador.
export function limpiarCopias() {
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
export async function instalarGeneral() {
  const cat = catalogo();
  const installs = instalaciones();
  const hechos = ejecutarPasos(pasosInstalacionGeneral({ cat, installs }));
  const copias = proyectosConCopia(installs);
  resumen(hechos, 'Listo: el plugin queda instalado para todos tus proyectos.');
  if (copias.length) console.log(`OJO: ${copias.length} proyecto(s) todavía tienen copia propia y esa manda dentro de ellos. Quítalas con: limpiar-copias.`);
  if (!process.exitCode) console.log('AHORA SÍ: cierra Claude Code y vuélvelo a abrir.');
}

