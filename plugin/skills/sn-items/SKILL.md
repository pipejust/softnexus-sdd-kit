---
name: sn-items
description: Muestra dónde están las historias de usuario, bugs e incidentes del proyecto y las pone en pantalla listas para copiar y pegar en cualquier sistema de tareas, con toda su trazabilidad (commits, archivos tocados, firmas del líder, evidencia, PR). También exporta a CSV o JSON. No necesita conexión a ningún sistema externo. Úsala con /sn-items, o cuando alguien diga "dónde están las historias", "muéstrame la historia X", "qué se hizo en el bug Y", "exporta las historias", "pásame las tareas para Excel/Jira/Altum".
---

# /sn-items — ver, copiar y exportar las historias

Las historias viven como texto en el propio proyecto: `docs/items/<ID>.md` (un archivo por ítem). Esta skill las muestra; **no cambia nada**.

Motor: `node scripts/sn/sn-sync.mjs` si existe en el repo; si no, `node "${CLAUDE_PLUGIN_ROOT}/scripts/sn-sync.mjs"`. Ejecútalo siempre desde la raíz del proyecto.

## Qué hacer según lo que pida la persona
| Pide | Ejecuta | Muestra |
|---|---|---|
| "¿Dónde están?", "¿qué historias hay?" | `… list` | la tabla tal cual + "Cada historia está en `docs/items/`." |
| Una historia (`/sn-items CLI-0001`) | `… show <ID>` | la ficha completa en un bloque de código Markdown para copiar |
| Exportar | `… export --format csv --out docs/items/export.csv` (o `--format json`) | ruta del archivo y cuántos ítems |
| "¿Qué se hizo en X?" | `… show <ID>` | resume en 3 líneas y luego la ficha (commits, archivos, firmas, evidencia) |
| "¿Qué hay pendiente en Altum?" | `… backlog altum` (`--all` incluye terminadas) | tabla de tareas del proyecto y cuáles ya están en el repo |

## Reglas
- Muestra la ficha **dentro de un bloque de código** (```markdown … ```) para que se copie completa y sin formato roto.
- Si el ítem no existe, muestra la lista y pregunta cuál.
- Si el proyecto no tiene `docs/items/`, explica: "Las historias se crean solas cuando usas `/sn`. Este proyecto todavía no tiene ninguna."
- El archivo exportado no se versiona salvo que la persona lo pida (sugiere no hacer commit de `export.csv`).
- Si la persona quiere que las tareas se actualicen solas en otro sistema, menciona `/sn-connect`.
