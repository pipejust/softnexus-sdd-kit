// Empezar a trabajar en un proyecto de Altum: "clóname el proyecto Altum".
// Altum guarda el repositorio de cada proyecto en repo_url; aquí se busca el proyecto por su nombre
// (sin tildes ni mayúsculas, por palabras sueltas) y se clona en una carpeta con su clave corta.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Clave corta y escribible del proyecto: "Medición de Afluencia" -> "medicion-de-afluencia".
export function projectKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Busca por clave exacta, luego por texto contenido y, si no, por palabras en común.
// Devuelve { match } si hay una sola, { candidates } si hay varias, {} si ninguna.
export function findProject(projects, query) {
  const wanted = projectKey(query);
  if (!wanted) return {};
  const conKey = projects.map((p) => ({ ...p, key: p.key || projectKey(p.name) }));
  const exacta = conKey.filter((p) => p.key === wanted);
  const contiene = conKey.filter((p) => p.key.includes(wanted) || wanted.includes(p.key));
  const palabras = wanted.split('-').filter((w) => w.length > 2);
  const porPalabra = conKey.filter((p) => palabras.some((w) => p.key.includes(w)));
  const lista = exacta.length ? exacta : contiene.length ? contiene : porPalabra;
  if (lista.length === 1) return { match: lista[0] };
  if (lista.length > 1) return { candidates: lista };
  return {};
}

// Carpeta donde quedaría el proyecto: <destino>/<clave>. Si ya existe con contenido, no se vuelve a clonar.
export function targetDir(project, parent = '..') {
  return path.resolve(parent, project.key || projectKey(project.name));
}

export function alreadyThere(dir) {
  return existsSync(dir) && readdirSync(dir).length > 0;
}

export function cloneProject(project, parent = '..') {
  const dir = targetDir(project, parent);
  if (!project.repo) throw new Error(`el proyecto "${project.name}" no tiene repositorio registrado en Altum: regístralo en su ficha ("Repositorio" → Registrar) y vuelve a intentar`);
  if (alreadyThere(dir)) return { dir, cloned: false };
  execFileSync('git', ['clone', project.repo, dir], { stdio: 'inherit' });
  return { dir, cloned: true };
}
