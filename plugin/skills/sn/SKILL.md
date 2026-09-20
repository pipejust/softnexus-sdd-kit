---
name: sn
description: La puerta única de Softnexus. Úsala para CUALQUIER cosa que alguien traiga para un proyecto - una idea, una mejora, un bug, un error con captura, un correo o acta del cliente, un ticket, "hazme", "agrega", "arregla", "no funciona", "el cliente pide". Clasifica el ítem, decide tamaño y riesgo, y conduce paso a paso todo el camino Spec Driven (historia → spec → construcción → evidencia → commit → PR → archivo) deteniéndose en cada checkpoint humano.
---

# /sn — la puerta única

La persona que te habla puede no saber programar. No le pidas que elija comandos ni que sepa el proceso: **el proceso lo sabes tú**. Ella solo trae el ítem y responde preguntas. Habla simple, frases cortas, una decisión a la vez.

## Paso 0 — ¿Dónde estamos?
0. Si la persona no sabe qué quiere hacer o pregunta qué comandos hay, usa la skill `sn-help`.
1. Si el repo no tiene `AGENTS.md` o no tiene `openspec/` → di: "Este proyecto todavía no está preparado. Lo preparo primero." y usa la skill `sn-setup`. Luego vuelve aquí.
2. Corre `openspec list --json`. Si la persona ya tiene un change activo sin terminar, **no abras otro** (WIP = 1): muéstrale en qué va con `sn-status` y pregúntale si quiere terminarlo primero. Solo un urgente R3+ (producción caída) salta esta regla.
3. Rama actual: si está en `main`/`master`, no se construye ahí (se creará rama en el paso 5).
3a. **Si la persona no tiene el proyecto en su computador** ("no lo tengo", "clóname el proyecto X"): `node scripts/sn/sn-sync.mjs clone <nombre>` (o el del plugin si el repo no tiene el motor). Lo busca en Altum por nombre y lo clona; luego se trabaja ahí. **Antes de clonar, pregunta SIEMPRE dónde ponerlo** (una sola pregunta, con ejemplo): "¿En qué carpeta lo dejo? Puedes darme una carpeta madre (ej. `~/Proyectos`) y dentro creo la del proyecto, o la ruta exacta donde quieres que quede el contenido (ej. `~/Proyectos/cursos`)." - Carpeta madre → `… clone <nombre> --in ~/Proyectos` (queda en `~/Proyectos/<clave-del-proyecto>`). - Ruta exacta → `… clone <nombre> --into ~/Proyectos/cursos` (el contenido del repositorio queda ahí, sin otra carpeta dentro). - Aquí mismo → `… clone <nombre> --here` (solo si la carpeta actual está vacía). Si la carpeta madre ya se llama como el proyecto, no se crea otra igual adentro. Si la carpeta elegida ya tiene archivos, no se clona encima: te lo dice y se elige otra.
3b. **Si la persona todavía no tiene su clave de Altum** (el sistema te lo avisa al empezar): ofrécele en una línea guardarla siguiendo `${CLAUDE_PLUGIN_ROOT}/references/clave-altum.md` (un solo paso, sin escribirla en el chat). Si dice que no, sigue sin Altum.
3c. **Si el repo no tiene conector `altum` y la persona sí tiene su clave:** corre `node scripts/sn/sn-sync.mjs whoami` — dice quién es y **todos sus proyectos asignados**. Si alguno corresponde a este repositorio, ofrece unirlos ahí mismo con `sn-connect` (no hace falta pedir nada a un administrador: la clave es una sola para todos sus proyectos). Si el comando falla o no hay clave, sigue sin Altum.
3d. **Si el proyecto de Altum no tiene registrado su repositorio** (el sistema te lo avisa, o `node scripts/sn/sn-sync.mjs repo-check` lo dice): **dilo primero, antes de lo que traiga la persona**, en una línea: "Este proyecto no tiene guardado en Altum de dónde se clona; si lo registro, tus compañeros lo traen por el nombre. ¿Lo hago?". Con el sí: `node scripts/sn/sn-sync.mjs set-repo <clave del proyecto>` (usa el remoto `origin`). Si responde `403`, su clave es anterior al permiso `projects:write`: que la regenere en Altum. Si dice que no, sigue con lo suyo y no insistas en esta sesión.
4. Si hay un conector `altum`, corre `node scripts/sn/sn-sync.mjs backlog altum --json`: si hay tareas pendientes sin traer, menciónalas ("En Altum hay 2 tareas pendientes que no están en el proyecto") y ofrece traerlas con `… pull altum --apply`. Si la persona no trae nada nuevo y pregunta qué hacer, propón la pendiente de mayor prioridad.

## Paso 1 — Recibir el ítem
Acepta cualquier formato: texto, captura de pantalla, error pegado, enlace a ticket, correo. Si trae el id de una tarea de un sistema conectado (Altum u otro con `fetch` en `.sn/connectors.json`), tráela con `node scripts/sn/sn-sync.mjs fetch <conector> <id>` y úsala como entrada; el ítem conserva ese id.
Clasifica el **tipo**:

| Tipo | Señales | Prefijo |
|---|---|---|
| Funcionalidad nueva | "quiero que", "agregar", "nueva pantalla" | `feat` |
| Mejora | "que sea más", "cambiar cómo", "mejorar" | `feat` o `refactor` |
| Bug | "no funciona", "sale error", "antes funcionaba" | `fix` |
| Error de producción | usuarios afectados ahora | `fix` + urgente |
| Contenido / texto / estilo | "cambiar el texto", "color", "typo" | `style`/`docs` |
| Tarea técnica | actualizar librería, configurar algo | `chore` |
| Pregunta | "¿cómo funciona…?", "¿dónde está…?" | no es trabajo: responde con `openspec-explore` y termina |

## Paso 2 — Investigar el código ANTES de preguntar
Lee `AGENTS.md`, `DESIGN.md`, `openspec/specs/` del área y el código relacionado. Nunca preguntes algo que el código responde.
- **Bug**: intenta reproducirlo (correr la app, el test, leer logs). Anota: pasos, qué pasa, qué debería pasar, archivo/línea sospechoso. Si no se puede reproducir, dilo y pide exactamente el dato que falta.

## Paso 3 — Clasificar tamaño y riesgo
**Tamaño**: XS ≤2h · S 2–4h · M 4–8h · L 8–16h · XL >16h (prohibido, se divide).
**Riesgo**: R0 texto/CSS · R1 UI aislada · R2 API, lógica, tabla nueva · R3 login, permisos, pagos, datos personales, migraciones · R4 producción, infraestructura, borrar datos.
Ante la duda, sube el riesgo.

Muestra a la persona una **tarjeta** así y espera su "sí":
```
📋 ÍTEM: <título corto>
Tipo: <tipo> · Tamaño: <X> · Riesgo: <RN>
Lo que entendí: <2 frases, lenguaje simple>
Lo que encontré en el código: <1-3 bullets>
Camino: <los pasos que vienen, numerados>
¿Seguimos? (sí / corregir algo)
```
**Antes de crear el ítem, evita duplicados:** si hay conector `altum`, compara el pedido con las tareas pendientes del backlog (título y descripción). Si una parece ser lo mismo, pregunta: "¿Es la tarea #<número> de Altum, '<título>'?". Si sí, crea el ítem con `id: ALT-<número>` y `ext.altum: <id>` (o enlaza uno existente con `… link <ITEM> altum <id>`) en vez de crear una tarea nueva.
Con el "sí", **crea el ítem** en `docs/items/<ID>.md` desde la plantilla (`${CLAUDE_PLUGIN_ROOT}/plantillas/docs/items/_plantilla.md`): `id` = id externo si vino de otro sistema, si no `<PREFIJO>-<AAMMDD>-<4 caracteres al azar>` (prefijo: `AGENTS.md` §1 o las 3 primeras letras del proyecto en mayúsculas); `type` (feature, improvement, bug, incident, content, chore), `title`, `risk`, `size`, `assignee` (de `git config`), `origin`, `created`. Para un bug, la historia incluye pasos, qué pasa y qué debería pasar. Este archivo es la historia oficial: se puede copiar a cualquier sistema (`/sn-items`) y, si el proyecto está conectado (`/sn-connect`), se crea y actualiza solo en los sistemas externos.

## Paso 4 — Elegir camino
- **XS + R0** (texto, color, typo): sin OpenSpec. Crea rama, cambia, toma screenshot, corre lint → salta al paso 8.
- **R4**: detente. Redacta la propuesta y di: "Esto lo tiene que aprobar el líder técnico antes de tocar nada." No ejecutes.
- **L**: propone dividir en 2–5 partes que se puedan probar solas. Cada parte = un ítem. Arranca solo la primera.
- **Resto**: sigue.

## Paso 5 — Historia Ready
Si faltan datos (quién, qué debe pasar, qué NO, casos borde, referencia visual, fuera de alcance, cómo se prueba) → usa la skill `sn-story`. Si ya está todo claro, escríbela tú directamente.
Crea la rama: `<prefijo>/<ID del ítem>-<slug-corto>` (ej. `fix/CLI-260919-a3f2-login-bloqueado`) y anótala en `branch:` del ítem.

## Paso 6 — Spec (OpenSpec)
Usa la skill `openspec-propose` con un nombre kebab-case que empiece por el verbo (`add-…`, `fix-…`, `update-…`, `remove-…`), pasándole la historia completa del ítem. Anota el nombre en `change:` del ítem.
Para **bug**, la spec debe incluir un escenario que describa el comportamiento correcto que hoy falla.
Al terminar, **CHECKPOINT HUMANO 1** — muestra en lenguaje simple:
- Qué se va a construir (de `proposal.md`)
- Cómo sabremos que funciona (los escenarios, uno por línea)
- Qué NO se va a hacer
- Número de tareas
Pregunta: "¿Esto es lo que querías?". Si es R3, añade: "Como toca <tema sensible>, también lo tiene que firmar el líder técnico." y, con el "sí" de la persona, usa la skill `sn-request` (sello plano): deja el plano en git y prepara el mensaje para el líder, que valida desde su computador con `/sn-validate`. No construyas hasta que `validacion.md` diga *Validado*.
Si la persona corrige algo, usa `openspec-update-change` y vuelve a mostrar.
Cuando la persona apruebe (R0–R2), registra su aprobación al final de `openspec/changes/<nombre>/validacion.md` como entrada `APROBADO · sello: plano` con su nombre y el commit actual (formato en `${CLAUDE_PLUGIN_ROOT}/references/validacion.md`), y haz commit. Así la aprobación queda trazable y los sistemas conectados ven "Plano aprobado".

## Paso 7 — Construir
Solo con aprobación explícita. Usa la skill `openspec-apply-change`.
- Lógica nueva o bug → primero un test que falla, luego el código (skill `test-driven-development` si está disponible).
- Bug difícil → skill `systematic-debugging`.
- Si durante la construcción descubres que la spec estaba mal: para, explica, actualiza la spec, pide aprobación de nuevo.
- Mantén los archivos pequeños **sin que nadie lo pida**: lo sano es 200–400 líneas y el máximo 1000. Si un archivo que tocas se acerca a 800, pon el código nuevo en un módulo aparte con una responsabilidad clara en esa misma tarea. En código nuevo no se usa `sn-split`: el tamaño se cuida mientras se escribe.
- Haz commits pequeños mientras avanzas con la skill `sn-ship` (modo commit).

## Paso 8 — Evidencia
Usa la skill `sn-evidence`. Sin evidencia completa no se continúa.

## Paso 9 — Entregar
Usa la skill `sn-ship` (modo PR). Si el riesgo es R2 o más, usa después `sn-request` (sello entrega) para que el líder valide desde su computador. Luego di claramente:
"✅ Listo para revisión. Ahora: 1) abre una sesión NUEVA de Claude y escribe `/code-review` (el que construyó no se revisa a sí mismo); 2) prueba tú mismo en el enlace de vista previa; 3) cuando el PR se apruebe y se una a main, escribe `/sn` otra vez y te ayudo a cerrar."

## Paso 10 — Cerrar (cuando el PR ya está unido a main)
Si al entrar detectas un change cuyo PR ya está merged (`gh pr view --json state`): usa `openspec-archive-change`, luego `sn-explain` (microlección de 5 min). Si hubo retrabajo o errores en el camino, sugiere `sn-learn`.

## Reglas de conversación
- Una pregunta a la vez cuando la persona es nueva; máximo 3 por ronda.
- Siempre termina tu mensaje con **qué sigue** en una línea: `➡️ Siguiente: …`.
- Nunca digas "ya funciona" sin evidencia.
- Si la persona dice "solo hazlo" en algo R2+, explica en una frase por qué existe el paso y ofrece el camino más corto que lo respeta.
