# API de tareas de Altum — contrato para integración bidireccional

Para la plataforma que va a crear/leer tareas por API y que necesita quedar sincronizada con lo que se cree o edite manualmente dentro de Altum.

**Un solo contrato para todas las empresas.** Endpoint, campos, reglas — todo igual sin importar cuál empresa. Lo único que cambia de una a otra es la clave de API: cada empresa tiene la suya, y esa clave es la que le dice a Altum de cuál empresa son los datos. No hay que tocar el resto de la integración para sumar una empresa nueva, solo pedir su clave y guardarla aparte.

```
Empresa       | X-API-Key
--------------|----------------------------------------
Empresa A     | sk_live_<clave-de-la-empresa-A>
Empresa B     | sk_live_<clave-de-la-empresa-B>
```

Cada fila de esa tabla, en su lado, guarda también los `project_id` de esa empresa — son UUID propios de cada una, no se repiten ni se comparten entre empresas.

## Autenticación

Todas las llamadas van con una clave de API en el header `X-API-Key`. Hay dos formas de conseguirla, y **la normal es la primera**:

- **Clave personal (la que usa cada empleado, siempre que se pueda).** Cada persona la genera ella misma, sin pedirle nada a nadie: Mi perfil → Mis datos → "Tu clave personal de API" → Regenerar. Nace con `tasks:read`, `tasks:write`, `projects:read` y `projects:write`, y alcanza SOLO a los proyectos donde esa persona está asignada en Altum — si la asignan o la quitan de un proyecto, su acceso cambia al instante, sin tocar la clave. Prefijo `sk_user_...`. **Regenerar revoca la anterior de inmediato** — solo hay una vigente por persona; si la regeneraron sin querer o alguien más lo hizo por ustedes, esa misma pantalla ahora dice "tu clave 'X' fue revocada el ..." en vez de "nunca tuviste una", justo para que esto se detecte rápido.
- **Clave de empresa (opcional — para CI, servidores, o integraciones que no son de una persona).** La crea un administrador en Configuración → Claves de API, eligiendo sus alcances ahí mismo. Ve TODOS los proyectos de la empresa, sin excepción. Prefijo `sk_live_...`.

Con cualquiera de las dos alcanza para todo lo de este documento — incluido leer los estados de un proyecto (`/config/estados`), que antes exigía sesión de usuario y ya no.

```
X-API-Key: sk_user_<clave-personal>
```

```
GET /api/v1/api/me
```
Con cualquier clave, dice de quién es: tipo (`user` o `company`), la empresa, la persona (si es personal) y sus proyectos con su rol — así el plugin no tiene que preguntar ni mapear nada a mano.

Límite: 120 peticiones por minuto **por clave** (no por IP ni por empresa), configurable por el administrador. Si se supera, responde `429` con `Retry-After`.

## Endpoint base

Mismo para todas las empresas — lo que cambia es la clave, no la URL:

```
https://servicios.softnexus.io/api/v1/api
```

## 1. Dirección: ustedes → Altum (crear/leer/actualizar tareas)

### Listar proyectos

```
GET /projects?page=1&limit=50
```

```json
{"items": [{"id": "...", "name": "...", "client_name": "...", "status": "...", "repo_url": "... o null", "members": [...]}], "total": 24, "page": 1, "limit": 50}
```

Devuelve, por proyecto: `id`, `name`, `client_name`, `status`, `repo_url` (de dónde se clona, `null` si nadie lo registró — ver más abajo) y los integrantes (`employee_id`, `role`, `is_lead`, `allocation_pct`). Paginado igual que `GET /tasks` (`page`/`limit`, máximo 200).

Con clave personal, solo trae los proyectos donde esa persona está asignada — no todos los de la empresa. Con clave de empresa, todos. Lo mismo aplica a `GET/POST/PATCH /tasks` y `/tasks/{id}/dependencies`: tocar un proyecto ajeno con clave personal da `403`:

```json
{"error": "No estás asignado a este proyecto"}
```

**Nota sobre la envoltura de las respuestas — no es uniforme, y no lo va a ser:** `GET /projects` y `GET /tasks` devuelven `{"items": [...], "total": ...}`. `GET /projects/{id}/config/estados` y `GET /projects/{id}/config/campos` devuelven una lista suelta, sin envoltura. Es así por cómo se fue construyendo cada uno, y no se homologa para no romper a quien ya se adaptó a la forma actual — lean el tipo de cada respuesta antes de asumir `items`.

### Registrar el repositorio de un proyecto (para "clóname el proyecto X")

```
PUT /projects/{project_id}/repo
Content-Type: application/json

{"repo_url": "https://github.com/empresa/el-repo"}
```

Cualquiera cuya clave alcance a ese proyecto puede registrarlo o cambiarlo — con clave personal, si el proyecto está entre los asignados; con clave de empresa, cualquiera. `repo_url` es texto libre: Altum no valida que exista de verdad ni se conecta con GitHub. `null` lo borra. No hay endpoint en lote — hay que llamarlo una vez por proyecto.

### Los campos propios de un proyecto (para `custom_fields`)

```
GET /projects/{project_id}/config/campos
```

```json
[{"key": "riesgo", "label": "Riesgo", "field_type": "select", "options": ["R0","R1","R2","R3","R4"], "required": false, "position": 0}]
```

`field_type` es uno de `text | number | date | select | checkbox`. Lo que se mande en `custom_fields` de una tarea se valida contra esto: si una llave tiene definición aquí, el tipo tiene que cumplirla, y si es `select`, el valor tiene que estar en `options`. Al **crear** (no al editar), además, los campos marcados `required` tienen que venir con valor o Altum responde `422`.

### Los estados válidos de un proyecto

```
GET /projects/{project_id}/config/estados
```

```json
[
  {"key": "new", "label": "Nuevo", "color": "#94a3b8", "kind": "open", "position": 0},
  {"key": "active", "label": "En progreso", "color": "#3b82f6", "kind": "in_progress", "position": 10},
  {"key": "resolved", "label": "Resuelto", "color": "#22c55e", "kind": "done", "position": 20},
  {"key": "closed", "label": "Cerrado", "color": "#8b5cf6", "kind": "done", "position": 30},
  {"key": "removed", "label": "Retirado", "color": "#ef4444", "kind": "cancelled", "position": 40}
]
```

Siempre objetos, nunca solo texto. `kind` es lo que importa para decidir qué hacer con un estado — vale `open`, `in_progress`, `done` o `cancelled`. Un proyecto que nunca definió workflow propio devuelve exactamente esos cinco; uno con workflow propio devuelve el suyo, con sus propias llaves (`key`) y sus propios `kind`. **Consulten esto antes de escribir un `state`**: mandar `"resolved"` a un proyecto que ya no lo tiene entre sus estados da `422`.

### Listar tareas

```
GET /tasks?project_id=<uuid opcional>&state=<opcional>&external_ref=<opcional>&updated_since=<ISO opcional>&page=1&limit=50
```

```json
{
  "items": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "number": 42,
      "kind": "tarea",
      "title": "...",
      "description": "...",
      "state": "new",
      "assignee_id": "uuid o null",
      "priority": 1,
      "tags": ["..."],
      "external_ref": "el id que ustedes le pusieron, o null",
      "custom_fields": {"riesgo": "R2"},
      "updated_by": {"type": "user", "id": "uuid", "name": "..."},
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "total": 134,
  "page": 1,
  "limit": 50
}
```

`total` es cuántas hay EN TOTAL, no cuántas trae esta página — para pedir la siguiente, suban `page`. `limit` máximo: 200. `updated_since` se filtra en el servidor (Altum no descarga todo para comparar del otro lado), compara con `>=`, acepta ISO 8601 con zona (`2026-09-19T14:05:00Z` o con offset), y `updated_at` siempre viaja en UTC. Detecta cualquier cambio (título, descripción, estado, responsable, prioridad, campos propios...) porque `updated_at` se actualiza ante cualquier edición, sin excepción, y el orden de la lista es por `updated_at`.

`updated_by` dice quién hizo el ÚLTIMO cambio. Con clave personal: `{"type": "user", "id": "uuid", "name": "..."}` — la persona misma, con su nombre. Con clave de empresa: `{"type": "api_key", "id": "uuid"}`. `null` si el último cambio fue a mano dentro de Altum sin ninguna clave de por medio. Sirve para lo que hace falta en un sondeo periódico: no avisarle a nadie de sus propios cambios.

### Tareas que vienen de reuniones de Acten

Un proyecto puede tener tareas que nunca se crean en Altum directamente: nacen de reuniones gestionadas por Acten (otra plataforma, conectada por proyecto) y se ven mezcladas con las nativas en la pantalla del proyecto dentro de Altum. `GET /tasks` ahora las incluye también, para que el conteo que ven por API coincida con el que ven en pantalla.

Se distinguen por `"source"`, que aparece en TODAS las tareas del listado:

```json
{"id": "acten:abc123", "project_id": "uuid", "source": "acten", "title": "...", "state": "...", "assignee_id": "uuid o null", "due_date": "... o null", "number": null, "description": null, "priority": null, "tags": null, "external_ref": null, "custom_fields": {}, "updated_by": null, "created_at": null, "updated_at": null}
```

`"source": "altum"` en las nativas, `"source": "acten"` en estas. Una tarea de Acten trae `id` con prefijo `acten:` (no es un UUID de Altum, no intenten tratarlo como tal), y los campos que no le aplican viajan en `null` — mismo shape que una tarea nativa, para no obligarlos a ramificar el parseo por `source` salvo que les importe el origen.

**`updated_since` ya las incluye.** Acten expone `updated_at` en cada tarea (con backfill de las que no lo tenían), así que se filtran igual que las nativas — ya no quedan fuera de un sondeo periódico. `include_deleted` no les aplica: una tarea de Acten borrada allá simplemente deja de aparecer, no genera entrada en `deleted`.

**Ojo con la zona horaria de este `updated_at` en particular:** es UTC, igual que el de las nativas, pero Acten lo manda SIN `Z` ni offset (`2026-09-20T06:38:42.102639`, no `...102639Z`). Quien lo lea al pie de la letra y asuma hora local se equivoca de zona. Altum ya lo interpreta como UTC de todos modos al filtrar por `updated_since`; si ustedes lo parsean directo, traten cualquier `updated_at` de una tarea con `"source": "acten"` sin sufijo de zona como UTC, no como hora local.

### Actualizar una tarea de Acten

```
PATCH /tasks/acten:<id>
Content-Type: application/json

{ "state": "done", "assignee_id": "uuid del empleado en Altum" }
```

Mismo endpoint que las nativas, mismo verbo — el `id` con prefijo `acten:` es lo que lo distingue. Solo estos campos tienen equivalente limpio del lado de Acten y son los únicos que se dejan cambiar; cualquier otro (`priority`, `tags`, `custom_fields`, `external_ref`, `kind`) responde `422` en vez de ignorarse en silencio:

| Campo | Nota |
|---|---|
| `state` | uno de `pending`, `blocked`, `done`, `cancelled` — no son los mismos que `/config/estados` de un proyecto nativo, son fijos y de Acten. `422` si no es uno de esos cuatro. La transición en sí (p. ej. que `cancelled` no admite volver atrás) la valida Acten: su `409` se reenvía tal cual. |
| `assignee_id` | UUID de un empleado de Altum — se traduce al dueño de la tarea del lado de Acten. `null` desasigna. |
| `assignee_email` | alternativa si no tienen el UUID — se manda tal cual a Acten, que la resuelve de su lado (no pasa por el directorio de empleados de Altum). Se ignora si además mandan `assignee_id`. |
| `title`, `description` | tal cual. |

No hay `dependencies` para una tarea de Acten (no hay bloqueadores de reuniones) — `GET /tasks/{id}/dependencies` no aplica a un `id` con prefijo `acten:`.

### Tareas borradas de verdad

```
GET /tasks?include_deleted=true&updated_since=<opcional>
```

La respuesta trae, además de `items`, una lista `deleted`:

```json
"deleted": [{"id": "uuid", "project_id": "uuid", "number": 12, "title": "...", "deleted_at": "..."}]
```

Una tarea borrada en Altum simplemente deja de aparecer en `items` — esta lista aparte es la única forma de enterarse de que se borró de verdad (y no que se movió de estado o de proyecto), para poder desenlazar el ítem de su lado.

### El límite de peticiones, con varias personas trabajando a la vez

El límite de 120/min es por clave, no por IP ni por empresa. No hay otro límite además de ese (ni diario ni por hora). Como cada persona ya tiene su propia clave personal, esto prácticamente se resuelve solo: diez personas trabajando a la vez son diez ventanas de 120/min, no una compartida.

### Leer una tarea

```
GET /tasks/{id}
```

### Qué bloquea a una tarea

```
GET /tasks/{id}/dependencies
```

```json
{"items": [{"id": "uuid", "number": 12, "title": "...", "state": "active"}]}
```

Lista los bloqueadores de esa tarea, estén o no ya resueltos — para avisar de un posible bloqueo antes de intentar cerrar, no solo al recibir el `409`.

### Crear una tarea

```
POST /tasks
Content-Type: application/json
Idempotency-Key: un-id-que-ustedes-generen   ← opcional, pero recomendado

{
  "project_id": "uuid",       // obligatorio — el proyecto de Altum donde nace
  "title": "...",             // obligatorio
  "kind": "tarea",            // epica|feature|historia|requerimiento|tarea|bug|pendiente
  "description": "...",
  "assignee_id": "uuid",      // o, si no lo tienen, assignee_email
  "assignee_email": "correo@empresa.com",
  "priority": 1,              // 1 (más urgente) a 4
  "tags": ["..."],
  "external_ref": "el id de su lado — único por proyecto",
  "custom_fields": {"riesgo": "R2", "tamano": "M"}
}
```

`assignee_email` es la alternativa cuando no tienen el UUID a mano (el caso normal: un correo de git no trae el identificador de Altum) — si no hay nadie con ese correo en la empresa, `404`. Si no mandan ni `assignee_id` ni `assignee_email` y están usando una clave PERSONAL, el responsable por defecto queda siendo la persona dueña de la clave. Si mandan `Idempotency-Key` y la llamada se reintenta con la MISMA clave (por un corte de red, por ejemplo), Altum devuelve la respuesta que ya dio la primera vez, sin crear una segunda tarea. Si `external_ref` ya existe en ese proyecto, `409`.

### Actualizar una tarea

```
PATCH /tasks/{id}
Content-Type: application/json

{ "state": "resolved", "priority": 2, "custom_fields": {"riesgo": "R3"}, ... }  // solo los campos que cambian
```

`custom_fields` en un `PATCH` REEMPLAZA el objeto completo, no lo mezcla con lo que ya había — manden el objeto entero si solo quieren cambiar una llave.

**Estados**: no asuman que siempre son `new/active/resolved/closed/removed` — consulten `/config/estados` primero (arriba). Si el `state` que mandan no es uno de los válidos de ese proyecto, `422`.

**Dependencias**: si el `state` que mandan tiene `kind: done` o `kind: cancelled` en el workflow de ese proyecto, y la tarea tiene un bloqueador todavía abierto, Altum responde:

```json
HTTP 409
{
  "error": "Hay bloqueadores sin resolver",
  "bloqueadores": [
    {"id": "uuid", "number": 12, "title": "El que bloquea", "state": "active"}
  ]
}
```

Con eso alcanza para decirle a la persona exactamente qué tarea falta por cerrar, sin tener que adivinar a partir de un mensaje de texto.

## 2. Dirección: Altum → ustedes (opcional — solo si además quieren avisos sin sesión abierta)

Con `updated_since` (sección 1) y un sondeo periódico ya se enteran de lo que cambió a mano en Altum sin necesitar nada de esta sección — es lo que hace un vigilante que pregunta cada tanto mientras alguien trabaja. Esto de aquí solo hace falta si ADEMÁS quieren un aviso cuando nadie tiene una sesión de trabajo abierta.

Altum tiene un **motor de reglas de automatización**. La forma más simple de lograrlo: pídanle al administrador de Altum que cree una regla con acción `webhook` apuntando a una URL de ustedes. No necesitan escribir ningún código de sincronización aparte del que ya reciba el webhook. Dicho esto: la automatización corre igual sea cual sea el origen del cambio (a mano o por esta misma API), así que si configuran la regla, también les llegará el eco de sus propios cambios — usen `event_id`/`updated_by` para descartarlo si no les sirve.

### Cómo se ve la regla (la crea un admin de Altum, vía `POST /automation-rules`)

```json
{
  "name": "Avisar a [su plataforma] cuando cambia una tarea",
  "project_id": "uuid o null (null = toda la empresa)",
  "trigger_type": "state_changed",
  "actions": [
    {
      "type": "webhook",
      "url": "https://su-plataforma.com/webhooks/altum",
      "secret": "un secreto que ustedes generen"
    }
  ]
}
```

`trigger_type` puede ser `created`, `updated` (cambió título o descripción), `state_changed`, `assigned`, `priority_changed` o `deleted`. Si quieren enterarse de TODO, pídanles que configuren una regla por cada uno de los seis (las seis apuntando a la misma URL).

### Qué van a recibir

```
POST https://su-plataforma.com/webhooks/altum
Content-Type: application/json
X-Altum-Event-Id: uuid
X-Altum-Timestamp: 1758300000
X-Altum-Signature: sha256=<firma>

{
  "event": "work_item.changed",   // o "work_item.deleted"
  "event_id": "el mismo uuid de X-Altum-Event-Id",
  "task": {
    "id": "uuid",
    "project_id": "uuid",
    "number": 42,
    "kind": "tarea",
    "title": "...",
    "description": "...",
    "state": "resolved",
    "assignee_id": "uuid o null",
    "priority": 1,
    "tags": ["..."],
    "target_date": "2026-09-20 o null"
  }
}
```

Guarden `event_id` (o `X-Altum-Event-Id`, es el mismo valor en los dos lados) y descarten cualquier reenvío que traiga uno que ya procesaron.

### Cómo verificar la firma

Igual que Altum ya verifica los webhooks que ustedes (o Acten) le mandan a ella — mismo esquema, solo que ahora es Altum quien firma:

```
firma_esperada = HMAC-SHA256(secreto, "{timestamp}." + cuerpo_crudo_en_bytes)
```

Comparen `firma_esperada` (en hexadecimal) contra lo que llega después de `sha256=` en `X-Altum-Signature`, con una comparación en tiempo constante. Rechacen si `X-Altum-Timestamp` tiene más de 5 minutos de diferencia con su propio reloj — evita que alguien reenvíe un evento capturado.

### El secreto

Lo genera y lo tiene solo su plataforma. Se lo dan al administrador de Altum una única vez al crear la regla — Altum lo guarda cifrado y **nunca lo vuelve a mostrar**, ni siquiera a quien lo configuró. Si lo pierden, hay que generar uno nuevo y volver a configurar la regla.

## Resumen de lo que hace esto bidireccional

- **Ustedes crean/editan una tarea** → llaman a `POST/PATCH /api/tasks` → aparece en el tablero, calendario y reportes de Altum, como cualquier otra, Y dispara las mismas reglas de automatización que dispararía alguien editando a mano.
- **Alguien edita a mano dentro de Altum** → si hay una regla de automatización con acción `webhook` apuntando a ustedes → les llega el evento firmado, con su `event_id` → actualizan su lado.

No hay que preguntar constantemente ni sondear (`polling`) — la regla dispara sola en el momento del cambio.

## Lo que todavía no existe (para no asumirlo)

- **Reintento del webhook**: hoy Altum reintenta UNA vez, de inmediato, si hay un corte de red al mandarlo — no si su endpoint responde algo distinto de `2xx` (eso se registra en una bitácora interna, pero no se vuelve a intentar). Una cola con reintentos programados y backoff todavía no existe.
- **Comentarios o enlaces** en la tarea (para que el PR, la rama o los commits se vean como referencias reales) — no existen todavía.
- **Endpoint en lote** (`PATCH /tasks/batch`) para sincronizar un proyecto grande de una sola vez — no existe; con el límite de 120/min y paginación en `GET /tasks` debería alcanzar, pero si no, pídanle al administrador que suba el límite de su clave.
