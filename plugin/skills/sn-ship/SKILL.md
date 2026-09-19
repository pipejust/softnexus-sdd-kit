---
name: sn-ship
description: Hace los commits y el Pull Request con el formato de Softnexus. Modo commit - guarda avances pequeños con mensajes convencionales ligados al change. Modo PR - sube la rama y abre el PR con delta spec, evidencia y checklist. Úsala al terminar tareas de construcción, cuando alguien diga "guarda", "haz commit", "sube", "abre el PR", "entregar".
---

# /sn-ship — commits y PR sin tener que saber git

## Reglas de git (siempre)
- Nunca trabajar ni hacer commit en `main`/`master`. Si estás ahí, crea la rama primero: `<tipo>/<id>-<slug>`.
- Nunca `--force`, nunca `reset --hard`, nunca `--no-verify`.
- Antes de cada commit: `git status` y `git diff --stat`. Si aparece un archivo que no tiene que ver con el change, **no lo incluyas**; pregunta.
- Nunca incluir `.env*`, credenciales, archivos generados (`dist/`, `.next/`, `node_modules/`), ni capturas pesadas fuera de la carpeta del change.

## Modo commit
Un commit por grupo de tareas terminado (idealmente cada 1–3 tareas de `tasks.md`), con tests en verde.

Formato (Conventional Commits, en español):
```
<tipo>(<área>): <qué cambió, en presente, ≤ 60 caracteres>

<por qué, 1–3 líneas si hace falta>

Change: openspec/changes/<nombre>
Tareas: <números de tasks.md>
Refs: <ID del ítem>   ← obligatorio: así cada commit queda ligado a su historia
```
Tipos: `feat` nueva funcionalidad · `fix` bug · `refactor` sin cambio de comportamiento · `test` · `docs` · `style` · `chore`.
Agrega solo archivos concretos (`git add <rutas>`), no `git add -A`.
Después del commit di en una línea qué quedó guardado.

## Modo PR
Requisito: existe `openspec/changes/<nombre>/evidencia.md` con todos los gates en verde. Si no, usa primero `sn-evidence`.

1. `git push -u origin <rama>`
2. Título: `<tipo>(<área>): <resumen>` — el mismo estilo del commit.
3. Cuerpo: llena `.github/pull_request_template.md` con:
   - enlace a `openspec/changes/<nombre>/` y el orden de lectura (proposal → delta spec → código),
   - tamaño, riesgo, ticket,
   - "Qué cambia" en lenguaje simple,
   - la evidencia copiada de `evidencia.md` (resumen de gates, tabla escenario→prueba, screenshots),
   - "Qué podría romperse".
4. Etiquetas: `riesgo:RN`, `tamaño:X`, `tipo:<tipo>` (créalas si no existen solo si la persona lo aprueba).
5. Riesgo R3+: abre el PR como borrador (`--draft`) y pide al líder técnico como revisor.
6. Crea el PR con `gh pr create`. **Muéstrale el título y cuerpo a la persona y pide confirmación antes de crearlo** (publicar es visible para otros).
7. Responde con el enlace y el siguiente paso: revisión en sesión nueva (`/code-review`), prueba en vista previa, y "cuando se una a main, `/sn` para cerrar".

## Atender comentarios de revisión
Si la persona trae comentarios del PR: lee con `gh pr view --comments`, clasifica cada uno (arreglar / discutir / no aplica con razón), arregla en commits nuevos con modo commit, vuelve a correr `sn-evidence` si cambió lógica, y responde en el PR solo con aprobación de la persona.
