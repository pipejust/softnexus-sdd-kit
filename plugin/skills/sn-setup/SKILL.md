---
name: sn-setup
description: Prepara un proyecto (nuevo o existente) para trabajar Spec Driven - instala OpenSpec, crea AGENTS.md, CLAUDE.md, DESIGN.md, openspec/config.yaml, plantilla de PR y settings, llenándolos a partir de lo que dice el propio código. Úsala cuando un repo no tiene AGENTS.md u openspec/, o cuando alguien diga "prepara este proyecto", "configura el repo", "adopta la metodología aquí".
---

# /sn-setup — dejar un proyecto listo en ~30 minutos

Las plantillas están en `${CLAUDE_PLUGIN_ROOT}/plantillas/` (dentro del plugin instalado). Para encontrar la ruta real: `ls ~/.claude/plugins/cache/*/softnexus-sdd/*/plantillas`.

## 0. La clave de Altum de la persona (una sola vez en su computador)
Antes de nada, comprueba si ya la tiene: `node "${CLAUDE_PLUGIN_ROOT}/scripts/sn-sync.mjs" whoami`. Si falta, ofrécele guardarla siguiendo `${CLAUDE_PLUGIN_ROOT}/references/clave-altum.md` (la genera en su perfil de Altum y la pega en la terminal, nunca en el chat). Con la clave lista, el agente ya sabe quién es y qué proyectos tiene asignados. Si dice que no, sigue sin Altum.

## 0b. ¿La persona ya tiene el proyecto en su computador?
Si dice "no lo tengo", "clóname el proyecto X" o abrió una carpeta vacía, tráelo con `node "${CLAUDE_PLUGIN_ROOT}/scripts/sn-sync.mjs" clone <nombre o clave>`: lo busca en Altum por su nombre (sin importar tildes ni mayúsculas) y lo clona desde el repositorio que ese proyecto tiene registrado. Si hay varios parecidos, los muestra para elegir; si no tiene repositorio registrado, hay que registrarlo antes (`… set-repo <clave>`). Para ver todos: `… projects`.

**Antes de clonar, pregunta SIEMPRE dónde ponerlo.** El comando **se niega a clonar si no le das ruta** (no hay carpeta por defecto) y el guard bloquea `git clone` sin destino, así que no hay forma de saltarse este paso. Pregunta en una sola línea, con ejemplo:
"¿En qué carpeta lo dejo? Puedes darme una carpeta madre (ej. `~/Proyectos`) y yo creo adentro la del proyecto, o la ruta exacta donde quieres que quede el contenido (ej. `~/Proyectos/cursos`)."
- Carpeta madre → `… clone <nombre> --in ~/Proyectos` → queda en `~/Proyectos/<clave-del-proyecto>`.
- Ruta exacta → `… clone <nombre> --into ~/Proyectos/cursos` → el contenido del repositorio queda ahí, **sin otra carpeta dentro**.
- Aquí mismo → `… clone <nombre> --here` (solo si la carpeta actual está vacía).
- **Si el proyecto tiene varios repositorios**, el comando los lista y exige `--repo <nombre>`: pregúntale a la persona cuál quiere antes de seguir.
Si la carpeta madre ya se llama como el proyecto, no se crea otra igual adentro. Si la carpeta elegida ya tiene archivos, no se clona encima: se avisa y se elige otra. Luego abre esa carpeta y sigue desde el paso 1.

## 1. Revisar sin tocar
- ¿Es repo git? ¿Rama actual? ¿Hay cambios sin guardar? (si hay, detente y pregunta).
- Detecta el stack **leyendo el código**: `package.json` (scripts, dependencias), `pnpm-lock`/`yarn.lock`/`package-lock`, `tsconfig`, carpetas `supabase/`, `prisma/`, `app/`, `src/`, configuración de tests (vitest, jest, playwright), CI existente (`.github/workflows`), estilos (tailwind, tokens, fuentes).
- Identifica los comandos reales: instalar, dev, lint, typecheck, test, e2e, build. Si falta alguno (p. ej. no hay typecheck), anótalo como pendiente, no lo inventes.

## 2. Crear rama
`chore/adoptar-spec-driven`

## 3. Instalar OpenSpec
`openspec init --tools claude` (añade más herramientas si el equipo usa Codex/Cursor). Si el CLI no existe: `npm install -g @fission-ai/openspec@latest`.

## 4. Generar archivos desde el código
- `AGENTS.md`: usa la plantilla y llena §1 (qué es: deduce del README/código y pregunta lo que no esté). **Dos cosas que NO se preguntan:**
  - **Quién es el líder técnico:** lo dice Altum. Corre `node "${CLAUDE_PLUGIN_ROOT}/scripts/sn-sync.mjs" lead` (o el del repo) y copia su respuesta tal cual en §1. Trae nombre, correo y, si está registrado, su usuario de GitHub (útil para pedirle la revisión del PR). Solo si Altum dice que el proyecto **no tiene líder marcado**, pregúntale a la persona y avísale que hay que marcarlo en Altum.
  - **El riesgo del proyecto:** no existe. El riesgo es de cada ítem y se decide al recibirlo (`/sn`, paso 3). No preguntes "qué tan sensible es este proyecto" ni pongas un riesgo por defecto en `AGENTS.md`.
  Sigue con §2 stack aprobado (lo detectado), §3 comandos reales, §7 convenciones observadas (estructura de carpetas, patrón de fetch/estado, nombres) con **un archivo de ejemplo real** por convención. Deja §8 vacío.
- `CLAUDE.md`: solo `@AGENTS.md` y `@DESIGN.md`.
- `openspec/config.yaml`: plantilla + `context` con stack y usuarios del sistema.
- `DESIGN.md` (solo si hay UI): extrae colores, tipografías, espaciados, radios, sombras y componentes del código (tailwind config, CSS variables, componentes). Estructura: tema visual · paleta con roles · tipografía · componentes · layout · profundidad · reglas de sí/no · responsive. Si la marca del cliente está en una web, ofrece extraerla (Firecrawl) o partir de un `DESIGN.md` de referencia (colección awesome-design-md).
- `scripts/check-file-size.mjs`, `.sn-size-ignore` y `.github/workflows/calidad.yml` desde la plantilla (límite de 1000 líneas por archivo en local y en CI). Luego, según el tipo de proyecto:
  - **Proyecto nuevo (sin código aún o recién creado):** no se crea línea base. Desde el primer día ningún archivo puede pasar el límite; el plano de cada cambio define módulos pequeños.
  - **Proyecto existente:** corre `node scripts/check-file-size.mjs --write-baseline`. Los archivos que ya pasan el límite quedan en `.sn-size-baseline` como **deuda heredada** (se pueden tocar sin crecer). Anótalos en `AGENTS.md` §8 y crea un ítem de backlog por archivo para reducirlo con `sn-split`, del más tocado al menos tocado. No los dividas en este cambio.
- `.github/pull_request_template.md` y `.claude/settings.json` desde la plantilla (ajusta el gestor de paquetes en permisos y hooks: pnpm/npm/yarn).
- `docs/aprendizajes.md` vacío con encabezado.
- `docs/items/_plantilla.md` desde la plantilla (aquí vivirán las historias y bugs como texto).
- **Altum:** con la clave del paso 0, corre `node scripts/sn/sn-sync.mjs whoami`, muéstrale sus proyectos asignados, propón el que corresponde a este repositorio y conéctalo con `/sn-connect`. Pregunta también por mensajería (Matrix) o Orca/GitHub.

## 5. Primeras specs (opcional, recomendado)
No documentes todo el sistema. Pregunta: "¿Cuál es la parte más importante o más frágil del sistema?" y ofrece usar `openspec-explore` sobre esa área para dejar su spec base.

## 6. Verificar y entregar
- Corre los comandos detectados (lint, typecheck, test, build) y reporta cuáles funcionan hoy. Los que fallan antes de empezar son **deuda existente**: anótalos en `AGENTS.md` §8, no los arregles en este cambio.
- Commit con `sn-ship` (modo commit): `chore(repo): adoptar metodología spec driven`.
- Resumen final para el líder técnico (el que dijo Altum): qué se detectó y qué quedó pendiente de su revisión, sobre todo §5 reglas de `AGENTS.md`.
