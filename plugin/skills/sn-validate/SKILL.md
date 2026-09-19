---
name: sn-validate
description: Para el líder técnico - valida desde su propio computador un plano o una entrega que otra persona pidió con sn-request, sin haber estado en esa conversación y sin tocar su trabajo abierto. Trae la rama a una carpeta aparte, reconstruye todo el contexto desde los archivos del change, revisa según el riesgo y registra la decisión en git. Úsala cuando llegue un mensaje "[Validación Softnexus]", cuando alguien diga "valida la rama X", "qué tengo pendiente por validar", o con /sn-validate sin argumentos para ver la lista.
---

# /sn-validate — validar a distancia, sin contexto previo

Formato y reglas: `${CLAUDE_PLUGIN_ROOT}/references/validacion.md`. Léelo antes de escribir.
Quien valida **no estuvo** en la sesión de quien desarrolló. Todo lo que necesitas está en la rama: si algo importante no está en los archivos, eso es un hallazgo ("el plano no se explica solo"), no algo que debas adivinar.

## 0. ¿Qué hay pendiente?
- Con argumento (`/sn-validate feat/SN-42-...` o número de PR): ve al paso 1 con esa rama.
- Sin argumento: `node "${CLAUDE_PLUGIN_ROOT}/scripts/validation-state.mjs" --pending` (trae las ramas remotas y lista las solicitudes sin responder; funciona con o sin GitHub). Si hay GitHub, cruza con `gh pr list --label sn:needs-validation --json number,title,headRefName,url` para mostrar el enlace del PR.
  Muestra la lista (proyecto, rama, change, sello, riesgo, quién pide, hace cuánto) y pregunta cuál validar.

## 1. Traer la rama sin tocar tu trabajo
No cambies de rama en la carpeta del líder. Usa una carpeta aparte:
```
git fetch origin <rama>
git worktree add ../.sn-validar/<rama> origin/<rama>
```
Trabaja dentro de esa carpeta hasta el paso 5. Si el worktree ya existe, actualízalo (`git -C ../.sn-validar/<rama> pull`).

## 2. Reconstruir el contexto desde los archivos
Lee, en este orden: `AGENTS.md` (reglas y riesgo del proyecto), `openspec/changes/<change>/validacion.md` (qué piden y por qué), `proposal.md`, `specs/` (delta), `design.md`, `tasks.md`, y si el sello es **entrega**: `evidencia.md` y el diff contra la rama principal (`git diff origin/<main o master>...HEAD`).
Resume para el líder en lenguaje claro, máximo 10 líneas: qué problema resuelve, qué cambia, riesgo, qué NO se hace, cuántas tareas / archivos.

## 3. Revisar según el sello y el riesgo
**Sello plano:**
- ¿El problema y el alcance son correctos? ¿Falta algo en "fuera de alcance"?
- ¿Cada escenario es observable y medible? ¿Hay fallo y borde, no solo happy path?
- R3: permisos, autenticación, datos personales, pagos, migraciones: ¿hay escenarios negativos (quien NO debe poder, no puede)? ¿rollback descrito?
- ¿El diseño reutiliza patrones del repo y respeta el stack aprobado y el límite de tamaño de archivos?

**Sello entrega:**
- Corre los gates de `AGENTS.md` §3 en la carpeta aparte (instalar dependencias si hace falta). No confíes solo en `evidencia.md`: verifica.
- Trazabilidad escenario → prueba completa.
- Revisión independiente del diff (skill `/code-review`; R3+: también `security-review`).
- ¿El código hace lo que dice el plano, y nada más?

Presenta los hallazgos ordenados por gravedad y propone una decisión: **APROBADO**, **CAMBIOS PEDIDOS** (con lista concreta) o **RECHAZADO** (con motivo).

## 4. Registrar la decisión (la toma el líder, no tú)
Pregunta al líder la decisión y sus notas. Luego, en la carpeta aparte:
- Agrega la entrada al final de `validacion.md` (formato de la referencia; commit validado = `git rev-parse --short HEAD` de la rama antes de tu commit).
- Commit `docs(<change>): <aprobado|cambios pedidos|rechazado> <sello>` y `git push origin HEAD:<rama>`.
- Con GitHub: review en el PR (`gh pr review <n> --approve` o `--request-changes` con las mismas notas) y quita la etiqueta `sn:needs-validation`. Si es sello plano aprobado, el PR sigue en borrador (aún no hay código).
- Confirma al líder antes de publicar la review (es visible para el equipo).

## 5. Cerrar y avisar
- `git worktree remove ../.sn-validar/<rama>` (la carpeta del líder queda como estaba).
- Genera el mensaje de respuesta para el mensajero:
```
[Validación Softnexus] <proyecto> · <sello> · <DECISIÓN>
<change> — <1 línea con lo más importante de las notas>
Para seguir: git pull y /sn-status
```
- Si existe `SN_NOTIFY_WEBHOOK`, ofrece enviarlo (solo con confirmación).
