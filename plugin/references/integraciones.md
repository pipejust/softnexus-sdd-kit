# Integraciones — contrato "Softnexus Task Sync" v1

Fuente de verdad para `sn-connect`, `sn-items` y el motor `scripts/sn/sn-sync.mjs`.
Objetivo: que las historias, bugs e incidentes vivan **en el repositorio como texto** y, además, se reflejen **en tiempo real** en cualquier sistema de tareas (Altum, un tracker de terceros, n8n, Matrix/Element) sin que nadie actualice estados a mano.

## 1. Ítems en texto: `docs/items/<ID>.md`
Un archivo por ítem. La cabecera son datos; el cuerpo es la historia legible. **La etapa no se escribe aquí**: se deriva.

```markdown
---
id: CLI-260919-a3f2          # prefijo del proyecto + fecha + 4 caracteres; o el id del sistema externo si el ítem nació allá
type: bug                    # feature | improvement | bug | incident | content | chore
title: El botón guardar no hace nada
risk: R2                     # R0..R4
size: XS                     # XS | S | M | L
change: fix-guardar-cliente  # change de OpenSpec (vacío en el camino rápido XS+R0)
branch: fix/CLI-260919-a3f2-guardar
assignee: Laura Gómez <laura@softnexus.co>
origin: cliente              # persona | cliente | monitoreo | revision | aprendizaje
created: 2026-09-19T10:40:00-05:00
parent:                      # id del ítem padre si es una parte de uno L dividido
ext.altum:                   # solo si el sistema externo NO acepta nuestro id (se llena al crear)
---
## Historia
Como … quiero … para …
## Criterios de aceptación
- Dado …, cuando …, entonces …
## Fuera de alcance
## Preguntas abiertas
```
Plantilla: `plantillas/docs/items/_plantilla.md`. Los archivos que empiezan por `_` no son ítems.

## 2. Etapas (derivadas, nunca a mano)
| Clave (estable) | Etiqueta | Se cumple cuando |
|---|---|---|
| `triaged` | Tarjeta | existe el ítem |
| `ready` | Historia lista | tiene criterios Dado/Cuando/Entonces y sin preguntas abiertas |
| `planning` | Plano en curso | existe la carpeta del change |
| `plan_written` | Plano escrito | existen `proposal.md` y `tasks.md` |
| `plan_approved` | Plano aprobado | `validacion.md` dice *validado* para el sello plano |
| `building` / `built` | Construyendo / Construido | casillas de `tasks.md` parciales / todas |
| `verified` | Con evidencia | existe `evidencia.md` |
| `in_review` / `merged` | En revisión / Unido | PR abierto / unido (requiere GitHub CLI o CI con token) |
| `done` | Terminado | el change está archivado |

Marcas adicionales (`flag`): `awaiting_validation`, `changes_requested`, `blocked`, `validation_expired` (ver `validacion.md`).

## 3. Configuración: `.sn/connectors.json` (se versiona; **sin secretos**)
Para Altum usa el conector nativo de §7a (`"kind": "altum"`); el ejemplo `rest` de abajo es para cualquier otra API que implemente el contrato genérico.
```json
{
  "project": "clientes",
  "connectors": [
    { "name": "altum", "kind": "rest", "base_url": "https://altum.softnexus.co/api/v1",
      "auth": { "type": "bearer", "env": "SN_ALTUM_TOKEN" },
      "upsert": { "method": "PUT", "path": "/projects/{project}/items/{id}" },
      "fetch": { "path": "/tasks/{id}" },
      "status_map": { "triaged": "Por hacer", "building": "En progreso", "in_review": "En revisión", "done": "Hecho" },
      "events": ["sn.item.*", "sn.validation.*"] },
    { "name": "n8n", "kind": "webhook", "url": "https://n8n.softnexus.co/webhook/sn", "secret_env": "SN_WEBHOOK_SECRET", "events": ["*"] },
    { "name": "equipo", "kind": "matrix", "homeserver": "https://matrix.softnexus.co", "room_id": "!abc123:softnexus.co",
      "token_env": "SN_MATRIX_TOKEN", "events": ["sn.validation.*", "sn.item.created:incident", "sn.item.stage_changed:in_review"] }
  ]
}
```
- Los secretos van en **variables de entorno** cuyo nombre se declara (`env`, `secret_env`, `token_env`). Nunca en el repo, nunca en el chat.
- `events`: `*`, `sn.item.*`, un tipo exacto, o `tipo:filtro` donde el filtro es un tipo de ítem (`incident`) o una etapa (`in_review`).
- `enabled: false` desactiva un conector sin borrarlo.
- Matrix solo avisa desde el computador de quien hizo el cambio (`only_local_actor`, por defecto en Matrix) para no repetir el aviso en cada pull.

## 4. Eventos
| Tipo | Cuándo |
|---|---|
| `sn.item.created` | aparece un ítem nuevo |
| `sn.item.stage_changed` | cambia la etapa (`previous.stage`) |
| `sn.item.updated` | cambia título, tipo, riesgo, tamaño, responsable, rama, change, PR o avance (`changed: [...]`) |
| `sn.validation.requested` / `sn.validation.decided` | se pide / se responde una firma del líder |
| `sn.item.flag_changed` | otra marca (vencida, detenido) |
| `sn.item.upserted` | solo en modo CI `--upsert-only`: foto completa, idempotente |
| `sn.test` | prueba de conexión |

Sobre (estilo CloudEvents): `{ specversion, id, type, source, project, time, actor, item, previous?, changed? }`.
`id` es **determinista** (mismo cambio = mismo id): el receptor descarta duplicados con él.

## 5. Contrato REST (lo que implementa Altum o cualquier API propia)
`PUT {base_url}{upsert.path}` — crea o actualiza (upsert) por `external_key` = id del ítem.
Cabeceras: `Authorization`, `Content-Type: application/json`, `Idempotency-Key: <id del evento>`.
Cuerpo:
```json
{ "external_key": "CLI-260919-a3f2", "project": "clientes", "type": "bug", "title": "…",
  "status": "En progreso", "stage": "building", "stage_label": "Construyendo", "flag": null,
  "risk": "R2", "size": "XS", "assignee": "Laura Gómez <laura@…>", "story": "Como …",
  "progress": { "done": 3, "total": 7 },
  "commits": { "count": 12, "recent": [{ "short": "3f2a91c", "date": "…", "author": "…", "subject": "fix(clientes): …" }] },
  "links": { "file": "docs/items/CLI-….md", "branch": "fix/…", "change": "fix-…", "pr": "https://…", "repo": "git@…" },
  "updated_at": "2026-09-19T15:02:00Z", "event": { "id": "…", "type": "sn.item.stage_changed" } }
```
Respuesta esperada: `2xx`. Cualquier otra cosa = reintento (cola local, hasta 20 intentos).
Opcional `GET {base_url}{fetch.path}` → tarea externa en JSON, para que `/sn` arranque desde un id del sistema externo.

## 6. Webhook (para n8n o cualquier receptor)
`POST url` con el evento completo. Cabeceras `X-SN-Event`, `X-SN-Delivery` (id) y `X-SN-Signature: sha256=<HMAC-SHA256(cuerpo, secreto)>`. El receptor **debe** verificar la firma.
Uso típico: n8n traduce el evento al API de un sistema de terceros (Jira, Trello, Linear, etc.) sin tocar el plugin.

## 7. Matrix / Element
`PUT {homeserver}/_matrix/client/v3/rooms/{room_id}/send/m.room.message/sn-{id}` con token de un usuario-bot invitado a la sala. El id de transacción es el del evento: un reintento no duplica el mensaje.

## 7a. Altum (conector nativo `"kind": "altum"`)
Contrato vigente de Altum: `altum-api-contrato.md`; resumen de lo que ya está en producción (claves personales, `/me`): `altum-api-novedades.md` (ambos en esta carpeta). API de tareas de Altum: base `https://servicios.softnexus.io/api/v1/api`, **un contrato para todas las empresas**; lo único que cambia es la clave (`X-API-Key`), que dice a qué empresa pertenecen los datos. Cada empresa tiene sus propios `project_id` (UUID).

```json
{ "name": "altum", "kind": "altum", "project_id": "<uuid del proyecto en Altum>", "key_env": "SN_ALTUM_KEY",
  "status_map": { "in_review": "en_revision", "merged": "resolved" },
  "kind_map": { "feature": "historia" },
  "events": ["sn.item.*"] }
```
| Repo → Altum | Cómo |
|---|---|
| Crear | Al primer evento del ítem: `POST /tasks` (`project_id`, `title` = `[ID] título`, `kind`, `description` en texto plano (Altum no interpreta Markdown) con historia + trazabilidad, `priority`, `external_ref` = ID del ítem, cabecera `Idempotency-Key`). Responsable: `assignee_email` con el correo de git (o `assignee_id` si hay `assignee_map`); si el correo no existe en Altum (`404`), la tarea se crea sin responsable. El id que devuelve Altum se guarda en el ítem (`ext.altum`). |
| Actualizar | `PATCH /tasks/{id}` con título, descripción, prioridad y `state`. |
| Estados | `GET /projects/{id}/config/estados` (objetos con `key` y `kind` open/in_progress/done/cancelled; terminales = done y cancelled). Un estado del mapa que no exista en el proyecto **no se envía** (Altum respondería `422`). Por defecto: tarjeta/historia → `new`; plano, construcción, evidencia y revisión → `active`; unido → `resolved`; terminado → `closed`. |
| Campos propios | Se leen de `GET /projects/{id}/config/campos` y se envían en `custom_fields` solo los que el proyecto definió (texto o lista con valor permitido). Por defecto: `riesgo` ← R0–R4, `tamano` ← XS–L, `etapa` ← etapa del proceso (cambiable con `"field_map": { "risk": "…", "size": "…", "stage_label": "…" }`). Como en un `PATCH` el objeto se **reemplaza**, se mezcla con lo que la tarea ya tenía: un campo puesto a mano en Altum no se pierde. |
| Tipo | feature → `historia`, improvement → `requerimiento`, bug e incident → `bug`, content y chore → `tarea` (sobrescribible con `kind_map`). |
| Prioridad | incidente o R4 → 1, R3 → 2, R2 → 3, R0–R1 → 4. |
| Sin duplicados | Se busca `ext.altum` del ítem y luego `external_ref` (firme, único por proyecto; sirve desde cualquier computador aunque no haya hecho pull). La marca `<!-- sn-item:ID -->` solo se usa para tareas creadas antes de `external_ref`. Si el `POST` responde `409` por `external_ref` repetido, se reutiliza esa tarea. |
| Muchas tareas | `GET /tasks` se pide por páginas (`page`, `limit=200`) hasta traer el `total`. |
| `409` (bloqueadores) / `422` | Reglas de Altum: se avisa en pantalla diciendo qué tarea falta cerrar (`#12 "título" (estado)`) y **no** se reintenta. |
| `429` | Queda en la cola y se reintenta en la siguiente sincronización. |

| Altum → Repo | Cómo |
|---|---|
| Tareas creadas a mano en Altum | `sn-sync pull altum` las muestra; `--apply` crea `docs/items/ALT-<número>.md` con `ext.altum` y "Falta refinar": la persona las lleva por `/sn`. Usa `updated_since` (guarda la hora del último pull en `.sn/state/`). |
| Cambios hechos a mano sobre tareas enlazadas | Se **reportan** (estado, título, prioridad). No sobrescriben el repo: el estado del proceso se deriva del repo y viaja hacia Altum. |
| Tareas borradas en Altum | `pull` y el vigilante piden `include_deleted=true`: si una tarea enlazada se borró, avisan (`borrada en Altum  ID`) y la persona decide si descarta el ítem o lo vuelve a crear. |
| Una tarea concreta | `sn-sync fetch altum <id>` → `/sn` arranca desde ella y el ítem conserva el enlace. |
| Empezar en un proyecto | `sn-sync projects` lista lo que ve la clave con una **clave corta** por proyecto y marca los que no tienen repositorio registrado. `sn-sync clone <clave o nombre> [--in <carpeta>]` busca el proyecto (sin tildes ni mayúsculas; nombre exacto gana sobre parecidos, y si hay varios los muestra para elegir) y clona su `repo_url` en `<carpeta>/<clave>`. No clona encima de una carpeta que ya tenga contenido. Ambos funcionan **antes** de que el repositorio esté configurado. |
| Elegir el proyecto | `sn-sync whoami`: de quién es la clave, su empresa y los proyectos que tiene asignados, y si este repositorio es uno de ellos (`GET /me`). Sirve antes de conectar nada. `sn-sync projects altum`: proyectos que ve la clave con nombre, cliente, estado e integrantes (`GET /projects`; con clave personal, solo los asignados). **Un repositorio = un proyecto de Altum de una empresa.** |
| Tareas que ya existen | `sn-sync backlog altum [--all]`: pendientes del proyecto (estados terminales según el `kind` done/cancelled del workflow), prioridad, fecha objetivo y si ya tienen ítem en el repo. `/sn`, `/sn-help` y `/sn-status` lo leen para proponer qué hacer y evitar duplicados. |
| Enlazar a mano | `sn-sync link <ITEM> altum <id>`: un ítem existente queda unido a una tarea existente (no se crea otra). |
| Importar | `pull --apply` trae solo tareas **abiertas** sin ítem; `--include-closed` también las terminadas. |
| **Vigilante interno (tiempo real inverso, sin n8n)** | Al abrir la sesión de Claude Code, el hook del plugin arranca `sn-sync watch altum` en segundo plano. Cada ~60 s (mínimo 20) consulta `GET /tasks?updated_since=…` (una sola petición por ronda: los estados del proyecto se guardan 10 min en `.sn/state/altum-states.json`; 30 s de solapamiento y sin repetir avisos), ignora los cambios hechos desde ese computador (`updated_by` = su clave y coincide con su último envío; `updated_by: null` = cambio a mano, siempre avisa) y deja los avisos en `.sn/state/inbox.json`. En el siguiente mensaje de la persona, el hook los entrega al agente; en macOS además sale una notificación del sistema (`"notify": false` la apaga). Respeta `429 Retry-After` y se aleja si Altum falla. Se detiene al cerrar la sesión. `"watch": false` en el conector lo desactiva. |
| Webhook de Altum (opcional, para avisos aun sin sesión abierta) | Regla de automatización de Altum con acción `webhook` (triggers `created`, `updated`, `state_changed`, `assigned`, `priority_changed`, `deleted`; descartar repetidos por `X-Altum-Event-Id`) hacia un receptor del equipo (n8n). El receptor verifica `X-Altum-Signature` = HMAC-SHA256(secreto, `"{X-Altum-Timestamp}." + cuerpo`) y rechaza si el timestamp tiene más de 5 minutos; la función `verifyAltumSignature` de `sync/altum.mjs` hace exactamente eso. El secreto lo genera el equipo y se entrega una sola vez al admin de Altum. Altum aún no reintenta webhooks que respondan distinto de `2xx`: el vigilante y el `pull` cubren cualquier evento perdido. |

**Claves: una sola por persona, para todos sus proyectos** (autoservicio en producción desde el 19-sep-2026).
- **Personal (`sk_user_…`, lo normal):** la genera la propia persona en Altum → Mi perfil → Mis datos → "Tu clave personal de API" → Regenerar. Nace con `tasks:read`, `tasks:write` y `projects:read`, y alcanza **solo a los proyectos donde está asignada** (en otro: `403 "No estás asignado a este proyecto"`; asignarla o quitarla cambia su acceso al instante). Sus cambios quedan como `updated_by: {type:"user", …}`, así nadie recibe avisos de lo propio.
- **De empresa (`sk_live_…`):** la crea un administrador en Configuración → Claves de API eligiendo alcances; ve todos los proyectos. Para CI y servidores.
- **Variable:** `SN_ALTUM_KEY` para todo (el `key_env` del conector solo se usa si la persona trabaja con varias empresas con su propio Altum: `SN_ALTUM_KEY_<EMPRESA>`).
- **Dónde la busca el motor:** primero la variable de entorno; si no está (las apps de escritorio no leen `~/.zshrc`), en macOS la lee del **Llavero** con `security find-generic-password`. El valor se queda en memoria del proceso: nunca se imprime ni se escribe en disco.
- **Guardarla:** `bash scripts/sn/sn-clave-altum.sh` (la pide sin mostrarla, la deja en el Llavero de macOS y la carga en cada terminal). **Comprobarla:** `sn-sync whoami` — funciona aunque el repositorio no esté conectado y lista los proyectos asignados.
- Límite 120 peticiones/minuto **por clave** (no por IP), sin otro límite diario u horario; con una clave por persona, el límite no se comparte.

## 7b. GitHub Issues (Orca, GitHub Projects)
Conector `"kind": "github"` (`repo` opcional: se deduce del remoto; token de `gh auth login` o `GH_TOKEN`).
Un issue por ítem: título `[ID] título`, etiquetas `sn-item`, `sn:<tipo>`, `sn:etapa:<etapa>`, `sn:riesgo:<R>`; cuerpo con historia y trazabilidad (commits recientes) y una marca oculta `<!-- sn-item:ID -->` para encontrarlo sin guardar ids. Se cierra al llegar a `done` (configurable con `close_on`).
Orca lee los issues de GitHub de forma nativa: desde cada issue se abre un worktree con el agente que se quiera.

## 7c. Trazabilidad
Cada ítem reúne automáticamente: commits que mencionan su id (`Refs: <ID>`) o tocan su archivo o su plano, archivos de código tocados, firmas (`validacion.md`), evidencia, rama y PR. Se ve con `sn-sync show <ID>` (`/sn-items`) y viaja en `commits` del contrato REST y en el cuerpo del issue.

## 8. Cuándo se sincroniza (tiempo real)
| Disparador | Dónde | Qué cubre |
|---|---|---|
| Hook del plugin (PostToolUse) | computador de cada persona | cada vez que el agente toca `docs/items/`, `openspec/changes/` o corre git/gh/openspec |
| Hooks de git (`sn-sync githooks`) | computador de cada persona | commit, merge, checkout, rebase — también lo que se hace fuera de Claude |
| CI (`.github/workflows/sn-sync.yml`) | servidor | push a la rama principal y eventos de PR (unir, cerrar): lo que pasa en GitHub o en el computador del líder |

Todas las rutas usan el mismo motor copiado en el repo (`scripts/sn/`), con cola de reintentos y candado para no correr dos veces a la vez.
