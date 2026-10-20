// Pruebas de las skills que viajan en el plugin: lo que necesitan para cargar bien al actualizar
// (Claude y Codex leen el nombre y la descripción del encabezado) y la licencia de las de terceros.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../plugin/skills');
const LIMITE = 1000;
const REFRESCO = readFileSync(path.join(SKILLS, '../../herramientas/skills-terceros.sh'), 'utf8');
let ok = 0; let fallas = 0;
const check = (nombre, cond) => { if (cond) { ok += 1; console.log(`OK    ${nombre}`); } else { fallas += 1; console.log(`FALLA ${nombre}`); } };
const leer = (...p) => readFileSync(path.join(SKILLS, ...p), 'utf8');
const encabezado = (texto) => {
  const m = texto.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  return Object.fromEntries(m[1].split(/\r?\n/).map((l) => l.match(/^([a-z-]+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2]]));
};

const carpetas = readdirSync(SKILLS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const nombres = new Set();
for (const s of carpetas) {
  const tiene = existsSync(path.join(SKILLS, s, 'SKILL.md'));
  check(`${s}: tiene SKILL.md`, tiene);
  if (!tiene) continue;
  const h = encabezado(leer(s, 'SKILL.md'));
  check(`${s}: el nombre del encabezado es el de la carpeta`, h.name === s);
  check(`${s}: tiene descripción`, Boolean(h.description && h.description.length > 20));
  check(`${s}: nombre único en el plugin`, !nombres.has(h.name));
  nombres.add(h.name);
  for (const f of readdirSync(path.join(SKILLS, s)).filter((f) => f.endsWith('.md'))) {
    check(`${s}/${f}: no pasa de ${LIMITE} líneas`, leer(s, f).split('\n').length <= LIMITE);
  }
  const propia = s === 'sn' || s.startsWith('sn-');
  if (propia) {
    check(`${s}: propia de Softnexus, sin ORIGEN.md`, !existsSync(path.join(SKILLS, s, 'ORIGEN.md')));
  } else {
    const origen = existsSync(path.join(SKILLS, s, 'ORIGEN.md')) ? leer(s, 'ORIGEN.md') : '';
    check(`${s}: de terceros con ORIGEN.md (repositorio y commit fijo)`, /github\.com\/\S+/.test(origen) && /Commit: `[0-9a-f]{40}`/.test(origen));
    check(`${s}: de terceros con su licencia`, ['LICENSE', 'LICENSE.txt'].some((f) => existsSync(path.join(SKILLS, s, f))));
    check(`${s}: el refresco la conoce`, new RegExp(`[| ]${s}( |"|$)`, 'm').test(REFRESCO));
  }
}

// El camino de interfaz está conectado: sin esto la skill existe pero nadie la usa.
check('sn manda a sn-ui cuando el ítem cambia algo visible', leer('sn', 'SKILL.md').includes('`sn-ui`'));
check('sn-evidence pide la evidencia de interfaz de sn-ui', /`sn-ui` §5/.test(leer('sn-evidence', 'SKILL.md')));
for (const usada of ['frontend-design', 'prototype', 'break-ui', 'review-animations', 'animate', 'animation-performance', 'emil-design-eng', 'mobile-native']) {
  check(`sn-ui nombra una skill que sí viaja en el plugin: ${usada}`, leer('sn-ui', 'SKILL.md').includes(`\`${usada}\``) && carpetas.includes(usada));
}

console.log(`\nRESULTADO: ${ok} OK · ${fallas} fallas`);
process.exit(fallas ? 1 : 0);
