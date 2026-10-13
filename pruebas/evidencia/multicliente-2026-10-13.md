# Actualización por cliente — 13 de octubre de 2026

Versión 0.66.0. La distribución 0.65.1 solo actualizaba Claude Code. Ahora el descargable
selecciona adaptadores para Claude y el runtime Codex/ChatGPT de escritorio local. Un modelo
no determina el formato de instalación: Antigravity y Orca aún necesitan integración validada.

## Validación

- Suite completa local: **572 OK, cero fallas** (29 actualización, 120 guardas).
- Perfil temporal Codex separado: marketplace add, plugin add, marketplace upgrade y plugin add
  repetido; instalación general habilitada 0.65.1 (versión publicada durante la prueba).
  El adaptador comprobó el manifiesto físico y el registro, y guardó el recibo para el motor.
- El CLI nativo instalado en esta máquina reconoce el marketplace compatible .claude-plugin;
  no se necesita instalar Claude. Las operaciones se ejecutan en el directorio del usuario.
- Regresión: CLI exitoso con archivos viejos, cliente ausente, catálogo fallido, plugin deshabilitado,
  selección ChatGPT/auto y migración de skills y declaraciones manteniendo otros ajustes y CRLF.
- Codex emite apply_patch con tool_input.command: guardas para secretos, CI, identidad del líder
  y límite de tamaño; suma cambios sucesivos sobre el mismo archivo. Sincronización post-patch.
- Se mantiene CI del actualizador en macOS, Windows y Linux; el CLI se simula en esa batería.
  La instalación nativa se probó en macOS, no en Windows ni mediante una conversación de Work.
- Inspección de solo lectura del perfil real: no hay copias OpenAI antiguas que retirar en los
  proyectos conocidos; Claude solo tiene instalación de usuario.

## Límites que el mensaje debe conservar

GENERAL VERIFICADA confirma archivos e instalación; no concede confianza a hooks. Codex exige
revisión explícita en /hooks o la configuración. Nunca se usa bypass de confianza.
ChatGPT Work con orquestación cloud/web/móvil no se actualiza escribiendo en el disco local;
requiere distribución y controles de su cuenta/workspace. Los ejecutores futuros no se
presentan como ya compatibles. Los motores de CI por repositorio siguen actualizándose por PR.

## Fuentes oficiales revisadas

- https://developers.openai.com/plugins/build/plugins
- https://learn.chatgpt.com/docs/build-skills
- https://learn.chatgpt.com/docs/hooks
- https://learn.chatgpt.com/docs/plugins
