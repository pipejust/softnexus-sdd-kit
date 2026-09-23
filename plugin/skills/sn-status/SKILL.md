---
name: sn-status
description: Dice en qué punto del camino Spec Driven va cada ítem y cuál es el siguiente paso exacto. Úsala cuando alguien pregunte "¿dónde voy?", "¿qué sigue?", "¿qué me falta?", "me perdí", al volver de una pausa, o al abrir una sesión nueva en un proyecto con trabajo a medias.
---

# /sn-status — ¿dónde voy?

No guardes el estado en ningún archivo: **dedúcelo** de lo que existe. Así nunca se desactualiza.

## Antes del estado: el repositorio en Altum
Corre también `node "${CLAUDE_PLUGIN_ROOT}/scripts/sn-sync.mjs" motor`: si la copia del motor del repositorio (`scripts/sn`, la que usa el CI) quedó atrás del plugin, dilo en una línea y ofrece actualizarla (`… motor --actualizar` y entrega con `/sn-ship`). La sesión de la persona no se ve afectada: los hooks usan siempre el motor del plugin.

Si `node scripts/sn/sn-sync.mjs repo-check` dice que el proyecto no tiene registrado de dónde se clona, menciónalo en la primera línea y ofrece registrarlo (`… set-repo "<nombre>"`). Es lo que permite que cualquiera del equipo lo traiga por su nombre.

## Cómo deducir la etapa de cada change activo
Primero `git fetch --quiet` (si hay remoto): una validación hecha por el líder desde otro computador llega por git. Si la rama remota tiene commits nuevos, di "Hay novedades: haz `git pull`" antes de todo.
Corre `openspec list --json`, `git branch --show-current`, `git status --short` y, si hay remoto de GitHub, `gh pr list --head <rama> --json number,state,url,reviewDecision`.

Para cada change en `openspec/changes/` (excepto `archive/`), la etapa es la **primera** condición que se cumpla de abajo hacia arriba:

| # | Etapa | Se cumple si… | Siguiente paso |
|---|---|---|---|
| 9 | 🏁 Cerrado | está en `changes/archive/` | nada; `/sn` para algo nuevo |
| 8 | 🔀 Unido | PR `MERGED` y change aún no archivado | `/sn` → archivar + microlección |
| 7 | 👀 En revisión | PR abierto | sesión nueva `/code-review`; probar vista previa; atender comentarios |
| 6 | 📦 Con evidencia | existe `evidencia.md` y no hay PR | `/sn-ship` (PR) |
| 5 | 🔨 Construido | todas las casillas de `tasks.md` marcadas `[x]` | `/sn-evidence` |
| 4 | 🧱 Construyendo | alguna casilla `[x]` y alguna `[ ]` | continuar con `openspec-apply-change` |
| 3 | ✅ Plan aprobado | `tasks.md` existe, ninguna `[x]`, y: R0–R2 la persona aprobó (pregúntale si no sabes); R3–R4 `validacion.md` dice **Validado** para el sello plano | `openspec-apply-change` |
| 2 | 📝 Plan escrito | existen `proposal.md` y `tasks.md` | leer y aprobar el plan (checkpoint humano) |
| 1 | 🌱 Recién creado | solo existe la carpeta o `proposal.md` | completar con `openspec-propose` / `openspec-update-change` |

**Validación a distancia** (reglas en `${CLAUDE_PLUGIN_ROOT}/references/validacion.md`): calcula el estado con `node "${CLAUDE_PLUGIN_ROOT}/scripts/validation-state.mjs"` (no lo deduzcas leyendo a ojo) y muéstralo junto a la etapa — *Esperando validación* (no avanzar; recordar que el líder usa `/sn-validate`), *Validado* (seguir), *Validación vencida* (el plano cambió después: `/sn-request` otra vez), *Con correcciones* (aplicar notas y `/sn-request`), *Detenido* (hablar con el líder).

**Sincronización:** si existe `.sn/connectors.json`, agrega una línea con `node scripts/sn/sn-sync.mjs status` resumida (última sincronización y pendientes en cola). Si hay pendientes en cola, di que el sistema externo no respondió y que se reintenta solo. Si hay conector `altum`, agrega una línea con `… backlog altum --json` resumido: pendientes en el proyecto de Altum, cuántas no están en el repo y cambios hechos allá a mano.

Además revisa: cambios sin commit (`git status`), rama equivocada (trabajando en `main`), y changes con más de 3 días sin movimiento (`git log -1 --format=%cr -- openspec/changes/<nombre>`).

## Respuesta (corta, visual)
```
🗺️ PROYECTO <nombre> — rama <rama>
<emoji> <change>: etapa <n>/9 <nombre etapa>
   Tareas: <x>/<total> · PR: <#num o "no hay"> · Última actividad: <hace…>
⚠️ <alertas: cambios sin guardar, WIP>1, trabajo viejo, estás en main>
➡️ Siguiente: <una sola acción concreta>
```
Si hay más de un change activo de la misma persona, dilo como alerta: "Tienes 2 cosas abiertas; termina una antes de seguir".
