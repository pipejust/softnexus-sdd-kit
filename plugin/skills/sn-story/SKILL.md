---
name: sn-story
description: Convierte un requerimiento vago ("crear pantalla de clientes", un correo del cliente, un acta) en una historia AI-ready con criterios Given/When/Then, estados de UI, casos borde, fuera de alcance y plan de prueba. Úsala cuando una historia no está Ready o cuando sn-arranque lo indique. Entrevista a la persona; no asume.
---

# sn-story — refinamiento de historias

La persona no tiene que saber qué preguntar. **Tú sí.**

## Proceso
1. Lee el requerimiento original y el contexto del repo (`AGENTS.md`, `openspec/specs/` del dominio afectado, código relevante). Explora antes de preguntar: no preguntes lo que el código ya responde.
2. Entrevista con **máximo 3 preguntas por ronda**, cada una con opciones concretas y tu recomendación. Prioriza:
   - ¿Quién lo usa y qué permiso necesita?
   - ¿Qué debe pasar cuando falla? (sin datos, error de red, sin permiso, duplicado)
   - ¿Qué queda fuera de este alcance?
   - ¿Hay referencia visual?
3. Cuando no queden preguntas abiertas, escribe la historia **dentro del ítem** `docs/items/<ID>.md` (secciones Historia, Criterios de aceptación, Estados de UI, Referencia visual, Fuera de alcance, Datos y permisos, Cómo se prueba) y deja vacía la sección Preguntas abiertas. Si el ítem no existe todavía, créalo desde `${CLAUDE_PLUGIN_ROOT}/plantillas/docs/items/_plantilla.md`.
4. Clasifica tamaño y riesgo. Si es L, propone la división en slices. Si es XL, la división es obligatoria.

## Calidad de criterios
- Observable: "la contraseña guardada empieza por `$2b$`", no "la contraseña es segura".
- Medible: "responde en < 2 s con 1.000 registros", no "carga rápido".
- Por requisito: al menos un happy path, un fallo, un borde.
- Estados de UI si hay pantalla: vacío, cargando, error, sin permiso, móvil.

## Plantilla de salida
```markdown
**ID:** <ID> · **Tamaño:** <XS–L> · **Riesgo:** <R0–R4>
## Historia
Como <rol> quiero <acción> para <beneficio>.
## Criterios de aceptación
### Happy path
- Dado ..., cuando ..., entonces ...
### Fallo
- ...
### Borde
- ...
## Estados de UI
## Referencia visual
## Fuera de alcance
## Datos y permisos
## Cómo se prueba
- Unit: ... · E2E: ... · Manual PO: ...
```

Cierra con: "Historia Ready. ➡️ Siguiente: escribir la spec" y regresa al paso 6 de la skill `sn` — o muestra la lista de preguntas que siguen abiertas.
