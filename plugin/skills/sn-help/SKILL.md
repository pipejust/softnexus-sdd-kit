---
name: sn-help
description: Para cuando alguien no sabe qué hacer, no recuerda los comandos o es nuevo en Spec Driven. Mira el proyecto, el trabajo abierto y las validaciones pendientes, y responde en lenguaje simple qué puede hacer AHORA MISMO (1 a 3 opciones concretas con el comando exacto), más la chuleta corta de comandos. Úsala con /sn-help o cuando alguien diga "ayuda", "no sé qué hacer", "qué puedo hacer", "qué comandos hay", "soy nuevo", "cómo funciona esto".
---

# /sn-help — ¿qué puedo hacer ahora?

La persona puede no saber nada del proceso. No expliques la metodología: **dile qué hacer ahora**. Frases cortas, sin jerga.

## 1. Mirar (sin cambiar nada)
- ¿El proyecto está preparado? (`AGENTS.md` y `openspec/` existen)
- `git fetch --quiet` (si hay remoto) y `git status --short`, rama actual.
- Trabajo abierto: `openspec list --json` y la etapa de cada change (reglas de `sn-status`).
- Validaciones: `node "${CLAUDE_PLUGIN_ROOT}/scripts/validation-state.mjs"` (mis solicitudes y su estado) y, si soy líder técnico (mi nombre o correo de `git config` aparece como líder en `AGENTS.md`), `... --pending` (lo que me toca validar). Si la rama remota tiene commits nuevos, puede haber una respuesta: sugiere `git pull`.

## 2. Elegir 1 a 3 opciones, en este orden de prioridad
1. Proyecto sin preparar → `/sn-setup`.
2. Cambios sin guardar o estás en `main` → resolver eso primero (explica cómo en una línea).
3. Soy líder y hay validaciones pendientes → `/sn-validate`.
4. Me respondieron una validación → `git pull` y `/sn-status`.
5. Tengo un ítem a medias → el siguiente paso exacto de `sn-status`.
6. Estoy esperando validación → "espera; mientras, puedes tomar algo pequeño (texto, color) con `/sn`".
6b. **Tres frases sobre el plugin mismo** (el motor del plugin se llama con `node "${CLAUDE_PLUGIN_ROOT}/scripts/sn-sync.mjs" <comando>`):
   - **"deja el plugin general"** / "quítalo de todos los proyectos" → `limpiar-copias`. Quita el plugin de **todos** los proyectos de ese computador: las copias instaladas dentro de cada carpeta y la línea de su `.claude/settings.json` que las pedía. Después manda una sola, la del computador. Dile cuántas quitó.
   - Si el resumen dice que algún repositorio **pide el plugin en un `.claude/settings.json` versionado**, no lo edites tú: dentro de ese repo y en una rama, `… dejar-de-declarar` y que lo entregue en un PR (lo ve todo el equipo).
   - **"instálame el plugin general"** → `instalar-general`. Deja la copia del computador (la que sirve en todos los proyectos): refresca el catálogo —con el `git pull` primero si el catálogo es una carpeta local— e instala o deja al día esa copia. Si todavía quedan copias dentro de proyectos, el comando lo avisa y hay que correr `limpiar-copias`.
   - **"actualízame el plugin"** / "¿estoy al día?" → `actualizar` dice en qué versión está, cuál es la última y qué falta en **esa** máquina; con el "sí" de la persona, `actualizar --arreglar` lo hace todo de una.
   **Si la persona dice que en su computador esas frases no hacen nada**, es que su plugin es anterior a la 0.52: dale el arranque que no depende de la versión — `curl -fsSL https://raw.githubusercontent.com/pipejust/softnexus-sdd-kit/main/herramientas/plugin-general.sh -o /tmp/plugin-general.sh` y luego `bash /tmp/plugin-general.sh` — que pone al día la copia general y quita las de los proyectos.
   En las tres, termina recordándole en una línea que **cierre Claude Code y lo vuelva a abrir**: hasta entonces sigue corriendo la versión vieja.
7. No tengo nada abierto → si hay conector `altum`, muestra las 3 tareas pendientes de mayor prioridad **suyas o sin asignar** (`… backlog altum --json`, columna Responsable) como opciones ("`/sn ALT-77`"); las de otras personas no se proponen. Si es el líder y hay tareas sin responsable, ofrécele repartirlas (`… sin-asignar`, `… asignar <número> <nombre>`); si no, "`/sn` y cuéntame lo que tengas: una idea, un bug, un correo del cliente".

## 3. Responder con este formato
```
AHORA MISMO PUEDES:
1. <acción>  →  escribe: <comando exacto>
2. ...
(qué pasa después, en una línea)

COMANDOS DE SOFTNEXUS
  /sn            Tengo algo (idea, bug, error, pedido, pregunta)
  /sn-status     ¿En qué voy y qué sigue?
  /sn-help       No sé qué hacer (esto)
  /sn-request    Pedir la firma del líder
  /sn-validate   (líder) Validar lo que me pidieron
  /sn-items      Ver y copiar las historias (y todo lo que se hizo)
  /sn-connect    Conectar Altum, Matrix, GitHub/Orca (tareas al día solas)
                 "clóname el proyecto X" → lo trae a tu computador desde Altum
                 "¿quién soy en Altum?" → tu nombre y tus proyectos asignados
                 "guarda mi clave de Altum" → una vez; sin ella no ves proyectos
  /sn-explain    Explícame lo que se hizo
  /sn-learn      Otra vez el mismo error: que no se repita
  /sn-setup      Preparar un proyecto
  /sn-split      Partir un archivo gigante heredado (solo proyectos viejos)
  /code-review   Revisión en una sesión nueva
Guía con clics: página "¿Qué tienes?" del equipo.
```
La chuleta va siempre al final, pero corta. Las opciones de arriba son lo importante.

## 4. Si la persona pregunta "¿y esto para qué sirve?"
Responde en 2–3 frases con la metáfora de la obra: el robot construye rápido pero necesita un plano; los sellos son las firmas humanas; la foto es la prueba de que quedó bien. Luego vuelve a la opción concreta.
