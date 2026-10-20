---
name: sn-help
description: Para cuando alguien no sabe qué hacer, no recuerda los comandos o es nuevo en Spec Driven. Mira el proyecto, el trabajo abierto y las validaciones pendientes, y responde en lenguaje simple qué puede hacer AHORA MISMO (1 a 3 opciones concretas con el comando exacto), más la chuleta corta de comandos. Úsala con /sn-help o cuando alguien diga "ayuda", "no sé qué hacer", "qué puedo hacer", "qué comandos hay", "soy nuevo", "cómo funciona esto".
---

**Entorno local:** compatible con Claude Code, Codex y ChatGPT Work local. La raíz del plugin se obtiene desde la carpeta que contiene este `SKILL.md`, subiendo `../..`. Sustituye `${CLAUDE_PLUGIN_ROOT}` en los comandos por esa ruta absoluta; no presupongas que existe la variable de entorno. En Codex/ChatGPT invoca esta skill desde el selector de skills. Los hooks requieren revisión y autorización de la aplicación.


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
   - **"deja el plugin general"**, **"instálame el plugin general"**, **"actualízame el plugin"**: descarga de GitHub oficial `herramientas/actualizar-plugin.mjs` a una carpeta temporal y ejecútalo con Node. Es independiente de la versión cargada y funciona desde cualquier carpeta. No te limites a dos comandos del CLI ni ejecutes el motor viejo para migrar una instalación.
   - El actualizador detecta Claude Code y Codex/ChatGPT local, o acepta --cliente claude|codex|chatgpt. No requiere Claude para OpenAI. Verifica primero la instalación de usuario y migra las copias project/local a general. Respalda los ajustes y retira solo la entrada Softnexus; si quedan cambios versionados, entrégalos mediante PR. Nunca borres carpetas completas. Solo declara éxito con `GENERAL VERIFICADA` y salida cero. No regenera claves de Altum. `--conservar-proyectos` es una excepción explícita para quien quiera mantener copias particulares.
   - **"¿estoy al día?"**: el mismo descargable con `--verificar` solo consulta y comprueba; no actualiza ni edita.
   - En Mac/Linux: descarga con `curl -fsSL` y encadena la ejecución con `&& node`. En PowerShell: bloque con `$ErrorActionPreference = 'Stop'`, `Invoke-WebRequest`, `node` y comprobación de `$LASTEXITCODE`. No ejecutes el archivo si falló la descarga.
   - Desde 0.66.0 el motor instalado también soporta `actualizar --general` con las mismas comprobaciones. Para versiones anteriores usa siempre el descargable recién obtenido.
   La actualización es **una vez por computador**, no por chat. Recuerda **reiniciar el cliente utilizado y revisar los hooks que pida Codex/ChatGPT**. Los motores de CI (`scripts/sn/`) y CODEOWNERS se actualizan por proyecto mediante PR, no regenerando su API.
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
  /sn-ui         Diseñar o pulir una pantalla (dentro de /sn)
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
