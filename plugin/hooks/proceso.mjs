#!/usr/bin/env node
// UserPromptSubmit: en cada mensaje, le recuerda al agente (1) el paso EXACTO del proceso en que va
// el ítem de esta rama, calculado desde el repositorio, y (2) el formato corto de respuesta.
// Así el agente no improvisa ("hagamos los PR y sigamos") ni entierra a la persona en texto.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const FORMATO = '[Softnexus · formato de respuesta] Máximo 6 líneas, salvo que la persona pida detalle. '
  + 'Estructura: "✅ <qué quedó hecho, 1 línea>" · "❓ <lo único que necesitas de la persona, si aplica>" · "➡️ Siguiente: <1 línea>". '
  + 'No narres cada comando ni listes todo lo que revisaste; si hay un problema, dilo en una línea con lo que se hace.';

function leer() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
  });
}

function esProyectoSoftnexus(cwd) {
  if (existsSync(`${cwd}/docs/items`) || existsSync(`${cwd}/.sn/connectors.json`) || existsSync(`${cwd}/scripts/sn/sn-sync.mjs`)) return true;
  try {
    return /Spec Driven|softnexus/i.test(readFileSync(`${cwd}/AGENTS.md`, 'utf8').slice(0, 4000));
  } catch {
    return false;
  }
}

try {
  const payload = JSON.parse(await leer());
  const cwd = payload.cwd || process.cwd();
  // Solo en proyectos que trabajan con la metodología. Un AGENTS.md a secas NO alcanza: lo usan
  // muchos repositorios ajenos, y el agente terminaba hablando de sellos y planos donde no existen.
  if (esProyectoSoftnexus(cwd)) {
    const partes = [FORMATO, '[Softnexus · regla] A una persona del equipo solo se le pide su clave personal de Altum. Nunca una "clave del proyecto" (el proyecto sale solo del repositorio con `conectar`; si varios proyectos lo usan, se pregunta por el nombre), ni claves de empresa, secretos, CI, protección de ramas ni tokens de GitHub/Azure: eso lo hace solo el administrador del repositorio.'];
    try {
      process.chdir(cwd);
      // En cada mensaje NO se le pregunta a GitHub por el PR de la rama: son 1-2 s de espera antes de
      // cada respuesta. El estado del PR lo trae la sincronización; aquí basta con lo que hay en el repo.
      process.env.SN_SYNC_NO_GH = '1';
      const rama = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const aqui = new URL('../scripts/sync/', import.meta.url);
      const { takeSnapshot } = await import(new URL('snapshot.mjs', aqui).href);
      const { siguientePaso } = await import(new URL('siguiente.mjs', aqui).href);
      const item = takeSnapshot('', { solo: (i) => i.branch && i.branch === rama }).items[0];
      if (item) {
        const { paso, siguiente, sello } = siguientePaso(item);
        partes.push(`[Softnexus · proceso] ${item.id} (${item.risk || 'sin riesgo'}) — paso actual: ${paso}. Siguiente según el proceso: ${siguiente}`
          + `${sello ? ' Hay un SELLO pendiente: ese es el siguiente paso; no propongas abrir PR, unir ni avanzar a otra cosa antes.' : ''}`
          + ' Si la persona pide saltarlo, explica en una línea por qué existe y ofrece el camino corto que lo respeta.');
      }
    } catch {
      // sin git o sin ítems: solo el formato
    }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: partes.join('\n') } }));
  }
} catch {
  // nunca bloquea la sesión
}
process.exit(0);
