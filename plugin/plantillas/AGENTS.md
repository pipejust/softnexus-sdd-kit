# AGENTS.md — <NOMBRE DEL PROYECTO>

> Fuente única de contexto para cualquier agente (Claude Code, Codex, Cursor, Copilot).
> `CLAUDE.md` solo importa este archivo. Máximo ~150 líneas: lo que no aplica a TODA tarea va en una skill o en `openspec/specs/`.
> Dueño: <tech lead>. Cambios a este archivo = PR revisado por el tech lead.

## 1. Qué es este proyecto
- Producto: <una frase: quién lo usa y para qué>
- Cliente / contrato: <entidad, número de contrato si aplica>
- Líder técnico (valida sellos a distancia con `/sn-validate`): <lo dice Altum — `sn-sync lead`; nadie lo escribe a mano>
- Prefijo de ítems: <CLI>  (historias y bugs en `docs/items/`, ids tipo CLI-260919-a3f2)

## 2. Stack aprobado (no agregar dependencias fuera de esta lista sin aprobación)
- Frontend: <ej. Next.js 15 + React 19 + Tailwind 4 + shadcn/ui>
- Backend: <ej. Supabase (Postgres + RLS) / Node + Hono>
- Tests: <ej. Vitest (unit) + Playwright (E2E)>
- Deploy: <ej. Vercel (preview por PR) → producción desde `main`>

## 3. Comandos (el agente DEBE usar estos, no inventar otros)
```bash
<pm> install          # instalar
<pm> dev              # desarrollo local
<pm> lint             # lint
<pm> typecheck        # tipos
<pm> test             # unit
<pm> test:e2e         # Playwright
<pm> build            # build de producción
node scripts/check-file-size.mjs   # ningún archivo > 1000 líneas
```

## 4. Flujo obligatorio: Spec Driven (OpenSpec)
Todo trabajo entra por **`/sn`** (idea, bug, error, mejora, correo del cliente). `/sn` conduce el camino:
ítem → tarjeta (tipo, tamaño, riesgo) → historia Ready (`sn-story`) → spec (`openspec-propose`) → **SELLO: aprobación humana** → construir (`openspec-apply-change`, TDD) → evidencia (`sn-evidence`) → commits y PR (`sn-ship`) → **SELLO: revisión en sesión nueva + prueba humana** → merge → archivar (`openspec-archive-change`) → microlección (`sn-explain`).
`/sn-status` dice en qué etapa va cada ítem y qué sigue. `/sn-help` dice qué hacer si no sabes. Cuando un sello necesita al líder (R3–R4 plano, R2+ entrega): `/sn-request` lo pide por git y el líder valida desde su computador con `/sn-validate`. `/sn-learn` convierte errores repetidos en reglas. Cada ítem vive en `docs/items/<ID>.md` y cada commit lleva `Refs: <ID>`; `/sn-items` los muestra con su trazabilidad y `/sn-connect` los mantiene al día en sistemas externos.
Ninguna línea de código de producto sin un change aprobado en `openspec/changes/`. Única excepción: XS + R0 (texto, color, typo), que igual lleva evidencia.

## 5. Reglas que nunca se negocian
- Nunca secretos en código, commits, logs ni prompts. Solo variables de entorno; `.env*` nunca se lee ni se versiona.
- Nunca escribir en base de datos de producción desde un agente. MCPs de producción: solo lectura.
- Nunca borrar ni editar migraciones ya aplicadas; siempre crear una nueva.
- Nunca desactivar tests, lint, tipos o RLS para "hacer que pase".
- Nunca agregar un paquete sin verificar que existe en el registro y está en el stack aprobado (evita paquetes alucinados).
- Todo endpoint nuevo valida entrada y verifica autorización. Nada de `// TODO auth`.
- Cambios mínimos: tocar solo lo que la tarea exige. Sin refactors "de paso". La mejor línea es la que no se escribe (skill `ponytail`).
- Ningún archivo de código supera **1000 líneas** (aviso desde 800; lo sano es 200–400). El código nuevo nace en módulos pequeños: si un archivo se acerca al límite, lo nuevo va en otro módulo en la misma tarea. Los archivos heredados que ya pasaban el límite están en `.sn-size-baseline`: no pueden crecer y se reducen con `sn-split`. Hay un hook que bloquea y un chequeo en CI.
- "Funciona" no es evidencia. Evidencia = salida de comandos + screenshot + test.
- El agente que escribió el código no aprueba el código.

## 6. Matriz de riesgo (se aplica ÍTEM POR ÍTEM, no al proyecto entero)
| Nivel | Ejemplos | Revisión mínima |
|---|---|---|
| R0 | texto, CSS, contenido | agente + screenshot |
| R1 | componente UI aislado | agente reviewer + prueba funcional |
| R2 | API, lógica de negocio, tabla nueva | reviewer + tests + humano |
| R3 | auth, permisos, pagos, datos personales, migraciones | tech lead + security review |
| R4 | producción, infraestructura, borrado masivo | aprobación explícita del tech lead antes de empezar |

Un proyecto no tiene un nivel de riesgo: lo tiene cada cambio. Un texto es R0 aunque el sistema maneje pagos, y una migración es R3 aunque el proyecto sea pequeño. El riesgo se decide al recibir el ítem (`/sn`, paso 3).

## 7. Convenciones del código
- <estructura de carpetas y dónde va cada cosa>
- <patrón de fetch/estado>
- <nombres>
- Diseño visual: seguir `DESIGN.md`. No inventar colores, tipografías ni espaciados.

## 8. Cosas que el agente suele hacer mal en ESTE repo
<!-- Se alimenta con /sn-learn. Una línea por lección, con fecha. -->
- 
