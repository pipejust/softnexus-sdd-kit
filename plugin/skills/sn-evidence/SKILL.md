---
name: sn-evidence
description: Genera el paquete de evidencia obligatorio antes de abrir un PR o declarar algo terminado. Corre los gates del proyecto (lint, typecheck, test, e2e, build), mapea cada escenario de la spec a su prueba, toma screenshots si cambió UI y redacta el resumen del PR. Úsala al terminar /opsx:apply, antes de decir "listo", "terminé" o "ya funciona".
---

**Entorno local:** compatible con Claude Code, Codex y ChatGPT Work local. La raíz del plugin se obtiene desde la carpeta que contiene este `SKILL.md`, subiendo `../..`. Sustituye `${CLAUDE_PLUGIN_ROOT}` en los comandos por esa ruta absoluta; no presupongas que existe la variable de entorno. En Codex/ChatGPT invoca esta skill desde el selector de skills. Los hooks requieren revisión y autorización de la aplicación.


# sn-evidence — Definition of Done con pruebas, no con frases

"Ya funciona" no cuenta. Solo cuenta lo que se puede mostrar.

## 1. Gates (usa los comandos de `AGENTS.md` §3, en este orden)
lint → typecheck → test → test:e2e (si toca un flujo de usuario) → build → `node scripts/check-file-size.mjs` (ningún archivo sobre 1000 líneas).
- Si uno falla: arréglalo y vuelve a correr desde ese gate. Máximo 3 intentos por gate; si sigue fallando, detente y reporta el error exacto.
- Prohibido: saltar, silenciar (`skip`, `only`, `@ts-ignore`, `eslint-disable`) o borrar tests para pasar.

## 2. Trazabilidad spec → prueba
Lee `openspec/changes/<change>/specs/`. Para cada escenario Given/When/Then, indica qué lo cubre:

| Escenario | Cubierto por | Estado |
|---|---|---|
| <nombre> | `tests/...spec.ts > "..."` o "verificación manual: <pasos>" | ✅ / ❌ |

Escenario sin cobertura = no está terminado.

## 3. UI (si cambió algo visible)
Sigue la skill `sn-ui` §5: levanta la app y toma capturas en escritorio (1440) y móvil (375) de cada estado, prueba el peor caso de datos con `break-ui`, revisa el movimiento con `review-animations` si cambió y compara contra la referencia (Figma/`DESIGN.md`/screenshot previo). Lista diferencias conocidas; no digas "quedó igual".

## 4. Autochequeo del diff
Revisa `git diff` buscando: secretos, `console.log`/`debugger`, paquetes nuevos (¿existen?, ¿están en el stack?), endpoints sin validación o sin autorización, archivos tocados fuera del alcance del change, código muerto.

## 5. Salida
Escribe `openspec/changes/<change>/evidencia.md` con: resultado de cada gate (resumen de la salida real), tabla de trazabilidad, screenshots (rutas), hallazgos del autochequeo, y la respuesta a **"¿qué es lo más probable que se rompa con este cambio?"**.
Después, redacta el cuerpo del PR usando `.github/pull_request_template.md`.

Termina recordando: la revisión la hace **otro contexto** (`/code-review` en sesión nueva o agente reviewer), no esta sesión.
