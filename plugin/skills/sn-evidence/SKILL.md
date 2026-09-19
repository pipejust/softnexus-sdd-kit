---
name: sn-evidence
description: Genera el paquete de evidencia obligatorio antes de abrir un PR o declarar algo terminado. Corre los gates del proyecto (lint, typecheck, test, e2e, build), mapea cada escenario de la spec a su prueba, toma screenshots si cambió UI y redacta el resumen del PR. Úsala al terminar /opsx:apply, antes de decir "listo", "terminé" o "ya funciona".
---

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
- Levanta la app, abre la página, toma screenshot en escritorio (1440) y móvil (375).
- Compara contra la referencia (Figma/`DESIGN.md`/screenshot previo). Lista diferencias conocidas; no digas "quedó igual".

## 4. Autochequeo del diff
Revisa `git diff` buscando: secretos, `console.log`/`debugger`, paquetes nuevos (¿existen?, ¿están en el stack?), endpoints sin validación o sin autorización, archivos tocados fuera del alcance del change, código muerto.

## 5. Salida
Escribe `openspec/changes/<change>/evidencia.md` con: resultado de cada gate (resumen de la salida real), tabla de trazabilidad, screenshots (rutas), hallazgos del autochequeo, y la respuesta a **"¿qué es lo más probable que se rompa con este cambio?"**.
Después, redacta el cuerpo del PR usando `.github/pull_request_template.md`.

Termina recordando: la revisión la hace **otro contexto** (`/code-review` en sesión nueva o agente reviewer), no esta sesión.
