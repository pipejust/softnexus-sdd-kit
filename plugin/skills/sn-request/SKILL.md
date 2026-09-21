---
name: sn-request
description: Pide la validación del líder técnico cuando el camino Spec Driven llega a un sello que la persona no puede aprobar sola (plano de riesgo R3-R4, entrega R2+, o cuando el líder lo exigió). Sube la rama, deja la solicitud registrada en git, marca el PR y prepara el mensaje para el mensajero institucional, para que el líder valide desde su propio computador sin compartir contexto. Úsala cuando /sn lo indique, o cuando alguien diga "necesito que el líder apruebe", "pedir validación", "mandar a revisar al líder".
---

# /sn-request — pedir la firma del líder a distancia

Formato y reglas: `${CLAUDE_PLUGIN_ROOT}/references/validacion.md`. Léelo antes de escribir.

## 1. ¿Qué sello se pide?
Deduce con `sn-status`:
- Plano escrito y no construido → sello **plano**.
- Evidencia completa (`evidencia.md` en verde) → sello **entrega**.
Si no se cumple ninguno, di qué falta y no pidas nada todavía. Pedir validación de algo incompleto le hace perder tiempo al líder.

## 2. Dejarlo todo en git (el líder no verá tu sesión)
El líder solo va a ver lo que esté **en la rama remota**. Antes de pedir:
- Todo commiteado (`git status` limpio) con `sn-ship` (modo commit).
- Para sello **plano**: el plano debe explicarse solo. Revisa que `proposal.md` diga qué, por qué, riesgo y fuera de alcance, y que cada escenario sea entendible sin haber estado en la conversación. Si algo quedó solo "en el chat", pásalo al plano.
- Agrega al final de `openspec/changes/<change>/validacion.md` la entrada `SOLICITUD` con el formato de la referencia (nombre y correo salen de `git config user.name` / `user.email`; commit = `git rev-parse --short HEAD`). Commit: `docs(<change>): solicitar validación del <sello>`.
- `git push -u origin <rama>`.

## 3. Marca visible (si hay GitHub)
- Sello **plano**: si no existe PR, crea uno en **borrador** con título `plan(<área>): <change>` y cuerpo = resumen del proposal + enlace a la carpeta del change.
- Sello **entrega**: usa el PR existente (o créalo con `sn-ship` modo PR).
- **Quién firma lo dice Altum, nunca `AGENTS.md` ni la cuenta de GitHub con la que estás trabajando.** Corre `node scripts/sn/sn-sync.mjs lead`: dice el líder del proyecto y, si `AGENTS.md` tenía otro escrito a mano, lo corrige solo (inclúyelo en el commit). No le preguntes a la persona quién es el líder.
- Revisor del PR: `node scripts/sn/sn-sync.mjs lead --github` devuelve el usuario de GitHub del líder según Altum → `gh pr edit <pr> --add-reviewer <usuario>`. Si falla (sin usuario en Altum, o es tu propia cuenta), **no pidas revisor**: sigue, el mensaje del paso 4 es el aviso.
- Etiqueta: `gh label create sn:needs-validation --color FBCA04 --description "Esperando la firma del líder técnico" --force` (la crea si falta; no preguntes, es parte del proceso) y ponla en el PR.
**Muestra a la persona lo que vas a publicar y pide confirmación antes** (es visible para otros).

## 4. Mensaje para el líder (SIEMPRE, es el último paso visible)
**No lo redactes tú.** Córrelo: `node scripts/sn/sn-sync.mjs mensaje` (o el del plugin si el repo no tiene el motor). Lo arma el motor con el proyecto y **el líder que dice Altum**, la rama, el commit exacto que hay que validar, el sello, el riesgo y el enlace del PR.
**Muéstraselo a la persona en un bloque de código, tal cual, y dile en una línea:** "Cópialo y mándaselo a <líder> por donde hablen (Teams, WhatsApp, correo). Con eso él ya puede validar desde su computador; no necesita nada más."
Todavía no hay mensajería conectada, así que **ese texto es el canal**: si no se lo muestras, nadie se entera de que hay algo esperando. Si Altum no dice quién es el líder, el comando lo avisa: pregúntale a la persona a quién mandárselo.
Si existe `SN_NOTIFY_WEBHOOK`, pregunta: "¿Lo envío al canal del equipo?". Solo con un "sí" explícito, envíalo:
`curl -sS -X POST -H 'Content-Type: application/json' -d '{"text": "<mensaje>"}' "$SN_NOTIFY_WEBHOOK"`
y confirma si respondió bien. Nunca imprimas el valor del webhook.

Verifica con `node "${CLAUDE_PLUGIN_ROOT}/scripts/validation-state.mjs"` que el estado quedó en *esperando validación*.

## 5. Mientras esperas
Di claramente: "Quedó pedido. Cuando el líder valide, haz `git pull` y escribe `/sn-status`: te dirá si puedes seguir". No sigas construyendo sobre lo que está en validación. Si la espera se alarga, la persona puede tomar un ítem XS/R0 en otra rama, nunca otro ítem grande.

➡️ Siguiente: esperar la validación.
