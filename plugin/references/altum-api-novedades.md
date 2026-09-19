# API de tareas de Altum — qué tiene hoy

Para el equipo de cualquier empresa que se vaya a integrar con la creación/lectura de tareas de Altum por API. Todo lo de aquí ya está en producción.

## Autenticación — dos formas de conseguir la clave

- **Clave personal (la normal, la que usa cada empleado).** Cada persona la genera ella misma, sin pedirle nada a un administrador: Mi perfil → Mis datos → "Tu clave personal de API" → Regenerar. Nace con `tasks:read`, `tasks:write` y `projects:read`, y alcanza SOLO a los proyectos donde esa persona está asignada en Altum — si la asignan o la quitan de un proyecto, su acceso cambia al instante. Prefijo `sk_user_...`.
- **Clave de empresa (para CI, servidores, o algo que no es de una sola persona).** La crea un administrador en Configuración → Claves de API, eligiendo ahí mismo qué puede hacer. Ve todos los proyectos de la empresa. Prefijo `sk_live_...`.

Con cualquiera de las dos: header `X-API-Key`, límite de 120 peticiones/minuto **por clave** (no por IP ni por empresa).

```
GET /api/v1/api/me
```
Dice de quién es la clave que llamó: tipo (`user` o `company`), la empresa, la persona si aplica, y sus proyectos con su rol — para no tener que preguntar ni mapear nada a mano.

## Tareas

- `GET /projects` — los proyectos a los que alcanza la clave (asignados si es personal, todos si es de empresa).
- `GET /projects/{id}/config/estados` — los estados válidos de ESE proyecto (cada uno puede tener su propio workflow), con su `kind` (`open|in_progress|done|cancelled`).
- `GET /projects/{id}/config/campos` — los campos propios que ese proyecto definió, con tipo.
- `GET /tasks` — paginado (`page`/`limit`, máx. 200), filtrable por `project_id`, `state`, `external_ref`, `updated_since` (se filtra en el servidor, compara `>=`, UTC), y `include_deleted=true` para enterarse de las que se borraron de verdad.
- `GET /tasks/{id}` y `GET /tasks/{id}/dependencies`.
- `POST /tasks` — con `external_ref` (enlace firme con su lado, único por proyecto), `assignee_email` (alternativa a `assignee_id`; sin ninguno de los dos y con clave personal, el responsable por defecto es quien generó la clave), `custom_fields` (validados contra los campos del proyecto), y soporte de `Idempotency-Key` para que un reintento por corte de red no duplique la tarea.
- `PATCH /tasks/{id}` — valida el `state` contra el workflow real del proyecto; si intentan cerrar algo con un bloqueador todavía abierto, `409` con el detalle de qué lo bloquea.
- Con clave personal, tocar un proyecto donde esa persona no está asignada da `403 {"error": "No estás asignado a este proyecto"}`.
- Cada tarea trae `updated_by`: quién hizo el último cambio — la persona (`{"type":"user","id","name"}`) si fue con clave personal, la clave (`{"type":"api_key","id"}`) si fue de empresa, o `null` si fue a mano dentro de Altum sin ninguna clave de por medio. Sirve para no avisarle a nadie de sus propios cambios.

## Enterarse en tiempo real de lo que se hace a mano en Altum

Dos formas, no excluyentes:

1. **Sondeo periódico**: pedir `GET /tasks?updated_since=…` cada tanto. Ya alcanza para no perderse nada.
2. **Webhooks** (si además quieren avisos sin que nadie tenga una sesión de trabajo abierta): un administrador de Altum crea una regla de automatización con acción `webhook` hacia su URL. Disparadores disponibles: `created`, `updated`, `state_changed`, `assigned`, `priority_changed`, `deleted`. Cada evento trae `X-Altum-Event-Id` (para descartar duplicados) y va firmado (`X-Altum-Signature`, HMAC-SHA256 sobre `timestamp.cuerpo`).

## Lo que todavía no existe

- Reintento del webhook solo ante corte de red, no ante una respuesta que no sea `2xx` (no hay cola con reintentos programados).
- Comentarios o enlaces dentro de la tarea.
- Endpoint en lote para crear/actualizar varias tareas en una sola llamada.

## Documento de referencia

El contrato completo (endpoints, formatos, ejemplos de cada llamada) va aparte, junto con este resumen.
