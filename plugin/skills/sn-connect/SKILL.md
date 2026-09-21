---
name: sn-connect
description: Conecta el proyecto con sistemas de tareas y mensajería para que historias, bugs y estados se creen y actualicen solos en tiempo real mientras avanza el proceso Spec Driven - una API REST (Altum u otra), un webhook (n8n para traducir a cualquier sistema), GitHub Issues (lo que lee Orca) o una sala de Matrix/Element. Configura, prueba, activa la sincronización y muestra su estado. Úsala con /sn-connect, al instalar o actualizar el proyecto, o cuando alguien diga "conectar con Altum", "que las tareas se actualicen solas", "mandar avisos a Matrix", "ver las tareas en Orca", "estado de la sincronización".
---

# /sn-connect — tareas al día sin tocarlas

Contrato completo: `${CLAUDE_PLUGIN_ROOT}/references/integraciones.md`. Léelo antes de escribir la configuración.

## Antes de todo: ¿quién está conectando?
- **Cualquier persona del equipo (incluido el líder del proyecto):** lo único que necesita es su clave personal de Altum (`references/clave-altum.md`). Con eso conectas su parte (el proyecto de Altum en `.sn/connectors.json`, registrar el repositorio) y **sigue con su trabajo**. No le hables de claves de empresa, secretos, workflows, CI, protección de ramas ni tokens. Su sesión de GitHub o de Azure para subir su trabajo es suya y no es parte de este proceso.
- **La configuración del proyecto** (clave de Altum de la empresa en los secretos, las dos revisiones automáticas, `proteger-rama`) **solo la hace quien ADMINISTRA el repositorio**, porque GitHub solo deja poner secretos y proteger ramas a los administradores, y la clave de empresa solo la crea un administrador de Altum. Compruébalo con `node scripts/sn/sn-sync.mjs pedir-config`. Si la persona no es administradora, no hagas esa parte ni se la menciones.

## 0. Qué quiere la persona
- "Conectar" / "agregar" → pasos 1 a 6.
- "Estado" → `node scripts/sn/sn-sync.mjs status` y explica en simple (conectores, última sincronización, pendientes en cola).
- "Probar" → `node scripts/sn/sn-sync.mjs test [nombre]`.
- "Traer tareas nuevas de Altum" → `node scripts/sn/sn-sync.mjs pull altum` (muestra); con el "sí" de la persona, `… pull altum --apply` (crea los ítems) y commit con `sn-ship`.
- "Desconectar X" → pon `"enabled": false` en ese conector (no lo borres) y confirma.
Conectar es **R3** (envía datos del proyecto fuera del repositorio): confírmalo con la persona y, si no es el líder técnico, que lo apruebe el líder (`AGENTS.md` §1).

## 1. Elegir el tipo de conexión
| Si quiere… | Tipo | Datos que pides |
|---|---|---|
| **Altum** (tareas de la empresa) | `altum` | **Nada de `key_env`: una sola clave personal por persona (`SN_ALTUM_KEY`) sirve para todos sus proyectos.** Si la persona todavía no tiene el proyecto en su computador, tráelo con `… clone <nombre>`. Corre `node "${CLAUDE_PLUGIN_ROOT}/scripts/sn-sync.mjs" conectar` (funciona aunque el repo no esté preparado): reconoce el proyecto por el remoto `origin` y escribe `.sn/connectors.json` solo. Si varios proyectos usan el mismo repositorio, te los nombra: pregúntale a la persona **por el nombre** y corre `… conectar "<nombre>"`. Si ningún proyecto lo tiene, con el nombre que diga la persona lo conecta y además registra el repositorio en Altum. **Nunca le pidas a nadie una "clave del proyecto" ni un nombre corto**: el proyecto sale solo del repositorio. Si responde `403` al registrar, la clave de la persona es anterior al permiso `projects:write` y hay que regenerarla. **Este repositorio trabaja con un proyecto de Altum a la vez** (el que eligió la persona). Solo pon `key_env` si la persona trabaja con **varias empresas** que tienen su propio Altum (`SN_ALTUM_KEY_<EMPRESA>`). Luego muestra los estados del proyecto y acuerda el `status_map`; el responsable se asigna solo por el correo de git (`assignee_email`); `assignee_map` (correo → UUID) solo si el correo de git no es el de Altum. Riesgo, tamaño y etapa viajan como campos propios si el proyecto los tiene definidos en Altum (`riesgo`, `tamano`, `etapa`; otros nombres con `field_map`). Si la persona aún no tiene clave, guárdala primero (`references/clave-altum.md`). Detalle en la referencia §7a |
| Otra API propia que acepte el contrato genérico | `rest` | URL base, ruta de upsert (por defecto `/projects/{project}/items/{id}`), tipo de autenticación, nombre de la variable del token, mapa de estados |
| Un sistema de terceros sin el contrato (Jira, Trello, Linear, ClickUp…) | `webhook` hacia n8n | URL del webhook de n8n y nombre de la variable del secreto. En n8n se traduce el evento al API del sistema |
| Ver las tareas en Orca / GitHub | `github` | repositorio (`dueño/nombre`; se deduce del remoto) |
| Avisos al equipo en Matrix/Element | `matrix` | servidor (homeserver), id de la sala (`!…:dominio`), nombre de la variable del token del bot, qué eventos avisar |
Se pueden tener varios a la vez.

## 2. Secretos: nunca en el chat ni en el repo
- Pide **solo el nombre** de la variable (ej. `SN_ALTUM_TOKEN`). **Si la persona pega un token en el chat, dile que lo revoque y genere uno nuevo**: quedó expuesto.
- Explícale cómo definirla ella misma en su computador (fuera de esta conversación): agregar `export SN_ALTUM_TOKEN="…"` a su `~/.zshrc` (o variable de entorno de Windows) y abrir una terminal nueva.
- Para el CI: los mismos nombres en GitHub → Settings → Secrets and variables → Actions.
- Para `github` basta con la sesión que la persona ya tenga en `gh` (si no la tiene, no es asunto de este proceso: su trabajo en Altum sigue funcionando).
- **Altum: una sola clave personal, una sola vez, para todos sus proyectos** (paso a paso en `${CLAUDE_PLUGIN_ROOT}/references/clave-altum.md`). La persona la genera sola en Altum (**Mi perfil → Mis datos → "Tu clave personal de API" → Regenerar**; prefijo `sk_user_`, nace con `tasks:read`, `tasks:write`, `projects:read`) y la guarda con un comando que la pide sin mostrarla y la deja en el Llavero de macOS, exportada en esa terminal y en `~/.zshrc`: `source scripts/sn/sn-clave-altum.sh`. No hay que pedirle nada a un administrador ni repetirlo por proyecto. Si la regenera, vuelve a correr el comando. Esa clave alcanza **solo a los proyectos donde está asignada**: en otro, Altum responde `403 "No estás asignado a este proyecto"` y el líder la asigna en Altum (el acceso cambia al instante, sin regenerar nada).
- **CI y servidores (solo en la sesión del líder):** clave de empresa (`sk_live_`, la crea un administrador en Configuración → Claves de API) como secreto del repositorio: `gh secret set SN_ALTUM_KEY`.
- Cambios hechos a mano en Altum: **no hace falta n8n**. Con la clave definida, el plugin arranca solo un vigilante al abrir la sesión y avisa en el siguiente mensaje (y con notificación del sistema en macOS). Explícaselo a la persona. El webhook de Altum hacia un receptor propio es opcional (solo para avisos cuando nadie tiene la sesión abierta; referencia §7a).

## 3. Escribir la configuración
- Copia el motor al repositorio (el CI no tiene el plugin): `scripts/sn/` ← `${CLAUDE_PLUGIN_ROOT}/scripts/{sn-sync.mjs,validation-state.mjs,sn-clave-altum.sh,sync/}`. Si ya existe, reemplázalo por la versión del plugin (es código generado; no se edita a mano).
- Crea o actualiza `.sn/connectors.json` con el formato de la referencia (`project` = nombre corto del proyecto).
- Agrega `.sn/state/` a `.gitignore`.
- Copia `${CLAUDE_PLUGIN_ROOT}/plantillas/.github/workflows/sn-sync.yml` si el proyecto usa GitHub (cambiar CI es R4: muéstraselo al líder técnico). **Es lo que cierra la tarea en Altum en el momento en que se une el PR**, aunque nadie tenga la sesión abierta; necesita el secreto de la clave de la empresa con el nombre de `key_env`. Sin este CI, la tarea se cierra en el siguiente `git pull` de alguien del equipo (hook post-merge de `githooks`).
- **Solo el líder aprueba.** Copia también `${CLAUDE_PLUGIN_ROOT}/plantillas/.github/workflows/firma-lider.yml` (GitHub): en cada PR corre `verificar-firma`, que solo acepta la aprobación del líder que dice Altum. Para que **bloquee** el merge, vuélvela obligatoria con `node scripts/sn/sn-sync.mjs proteger-rama` (sin `--si` solo dice qué hará; es un ajuste del repositorio: muéstraselo al líder y, con su "sí", corre con `--si`; necesita permisos de administrador del repo). No reemplaza la protección que ya tenga la rama: le agrega esta verificación.
- **Repositorios de Azure DevOps**: en vez de los dos workflows de GitHub, copia `${CLAUDE_PLUGIN_ROOT}/plantillas/azure/azure-pipelines-sn.yml` a la raíz como `azure-pipelines.yml` (o súmalo al que ya exista). Hace las dos cosas: firma del líder en cada PR y sincronización con Altum al unir. Para que bloquee, el administrador lo agrega como **Build validation obligatoria** en la política de la rama principal (`proteger-rama` le explica dónde). Localmente, para leer los PR de Azure, cada persona guarda un token personal de Azure DevOps (solo lectura de código) como `SN_AZURE_PAT` en el Llavero, igual que la clave de Altum.
- Si falta `docs/items/`, créalo con `_plantilla.md` desde `${CLAUDE_PLUGIN_ROOT}/plantillas/docs/items/`.

## 4. Probar antes de activar
`node scripts/sn/sn-sync.mjs test` → cada conector debe decir `OK`. Si falla, traduce el error (variable no definida → `sn-clave-altum.sh`, URL mal escrita, 401 = clave inválida o revocada, 403 = sin alcances o no asignado al proyecto, 404 = ruta equivocada) y corrige. No sigas con fallas.

## 5. Activar el tiempo real
- `node scripts/sn/sn-sync.mjs githooks` (engancha commit, merge, checkout y rebase sin reemplazar hooks existentes). **Cada persona** lo corre una vez en su computador (lo hace `/sn-setup` o este comando).
- El hook del plugin ya sincroniza en segundo plano cada vez que el agente toca ítems o planos.
- **Si el proyecto de Altum ya tiene tareas:** `node scripts/sn/sn-sync.mjs backlog altum` muestra las pendientes. Antes de la primera carga, revisa con la persona cuáles corresponden a ítems que ya existen en el repo y enlázalas con `… link <ITEM> altum <id>` (así no se duplican). Las pendientes que no tengan ítem se traen con `… pull altum --apply` (solo abiertas; las terminadas se omiten).
- Primera carga: `node scripts/sn/sn-sync.mjs sync --dry-run` (muestra qué enviaría), y con el "sí" de la persona, `node scripts/sn/sn-sync.mjs sync`.

## 6. Entregar
Commit con `sn-ship`: `chore(sync): conectar <sistemas>` (incluye `scripts/sn/`, `.sn/connectors.json`, `.gitignore`, y el workflow si el líder lo aprobó). Resume en lenguaje simple: qué sistemas quedaron conectados, qué se actualiza solo y cuándo, y qué debe hacer cada compañero (definir sus variables y correr `githooks` una vez).
