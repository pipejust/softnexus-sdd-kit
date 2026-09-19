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

Todas las llamadas van con la clave de API de esa empresa en el header `X-API-Key`. Se pide al administrador de esa empresa en Altum (Configuración → Claves de API) con los alcances `tasks:read` y `tasks:write`. Con esos dos alcances alcanza para TODO lo de este documento — incluido leer los estados de un proyecto (`/config/estados`), que antes exigía sesión de usuario y ya no.

```
X-API-Key: sk_live_<clave-de-la-empresa-A>
```

Límite: 120 peticiones por minuto por clave (configurable por el administrador). Si se supera, responde `429` con `Retry-After`.

## Endpoint base

Mismo para todas las empresas — lo que cambia es la clave, no la URL:

```
https://servicios.softnexus.io/api/v1/api
```

## 1. Dirección: ustedes → Altum (crear/leer/actualizar tareas)

### Listar proyectos

```
GET /projects
```

Devuelve `id`, `name`, `client_name`, `status` y los integrantes de cada proyecto (`employee_id`, `role`, `is_lead`, `allocation_pct`). Cada repositorio de código corresponde a uno de estos proyectos.

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

### Los campos propios de un proyecto (para `custom_fields`)

```
GET /projects/{project_id}/config/campos
```

```json
[{"key": "riesgo", "label": "Riesgo", "field_type": "select", "options": ["R0","R1","R2","R3","R4"], "required": false, "position": 0}]
```

`field_type` es uno de `text | number | date | select | checkbox`. Lo que se mande en `custom_fields` de una tarea se valida contra esto: si una llave tiene definición aquí, el tipo tiene que cumplirla, y si es `select`, el valor tiene que estar en `options`. Al **crear** (no al editar), además, los campos marcados `required` tienen que venir con valor o Altum responde `422`.

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
      "updated_by": {"type": "api_key", "id": "uuid"},
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

`updated_by` dice qué clave de API hizo el ÚLTIMO cambio (`{"type": "api_key", "id": "uuid"}`), o `null` si el último cambio fue a mano dentro de Altum. Sirve exactamente para lo que hace falta en un sondeo periódico: no avisarle a nadie de sus propios cambios. Hoy solo distingue "fue esta integración" de "no fue esta integración" — no dice cuál persona de Altum hizo un cambio a mano, si es que no fue la API.

### Tareas borradas de verdad

```
GET /tasks?include_deleted=true&updated_since=<opcional>
```

La respuesta trae, además de `items`, una lista `deleted`:

```json
"deleted": [{"id": "uuid", "project_id": "uuid", "number": 12, "title": "...", "deleted_at": "..."}]
```

Una tarea borrada en Altum simplemente deja de aparecer en `items` — esta lista aparte es la única forma de enterarse de que se borró de verdad (y no que se movió de estado o de proyecto), para poder desenlazar el ítem de su lado.

### El límite de peticiones, y varias claves por empresa

El límite de 120/min es **por clave**, no por IP ni por empresa — una oficina entera detrás de la misma salida a internet no lo comparte. No hay otro límite además de ese (ni diario ni por hora). Si van a tener varias personas o computadores trabajando a la vez, **pueden pedirle al administrador de la empresa varias claves** (Configuración → Claves de API → crear una por persona/equipo) — cada una se revoca por separado sin afectar a las demás, y reparte el límite entre varias en vez de compartir una sola ventana de 120/min.

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

`assignee_email` es la alternativa cuando no tienen el UUID a mano (el caso normal: un correo de git no trae el identificador de Altum) — si no hay nadie con ese correo en la empresa, `404`. Si mandan `Idempotency-Key` y la llamada se reintenta con la MISMA clave (por un corte de red, por ejemplo), Altum devuelve la respuesta que ya dio la primera vez, sin crear una segunda tarea. Si `external_ref` ya existe en ese proyecto, `409`.

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
