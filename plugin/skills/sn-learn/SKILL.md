---
name: sn-learn
description: Convierte un error, corrección o retrabajo en una mejora permanente del sistema (regla en AGENTS.md, regla en openspec/config.yaml, test, hook o cambio de skill) para que no dependa otra vez de que alguien lo recuerde. Úsala cuando un PR fue rechazado, el agente repitió un error, hubo un bug en producción, o alguien dice "otra vez lo mismo".
---

# sn-learn — cada error mejora el sistema

## 1. Diagnóstico (5 preguntas, respuestas cortas)
1. ¿Qué pasó? (hecho observable, no culpa)
2. ¿Dónde debió detectarse? (spec, plan, test, review, CI)
3. ¿Por qué no se detectó? (faltaba regla / faltaba test / la spec era ambigua / el agente ignoró contexto / nadie revisó)
4. ¿Se repetirá? Si es único y raro, dilo y no agregues nada.
5. ¿Cuál es el control **más barato y más determinista** que lo evita?

## 2. Elegir el control (prefiere de arriba hacia abajo)
| Control | Cuándo |
|---|---|
| Test automatizado | el error es de comportamiento |
| Hook / lint rule / CI check | debe cumplirse siempre, sin excepción |
| Regla en `openspec/config.yaml` | el problema nació en la spec, el diseño o las tareas |
| Línea en `AGENTS.md` §8 | el agente repite un error propio de este repo |
| Cambio en una skill `sn-*` | el proceso mismo tiene un hueco (proponlo al tech lead) |

No agregues reglas vagas ("ten cuidado con X"). Una regla debe poder verificarse.
`AGENTS.md` debe seguir corto: si una regla nueva no aplica a toda tarea, no va ahí.

## 3. Salida
- Implementa el control elegido en un change pequeño (o déjalo propuesto si es R3+ o toca CI).
- Añade una entrada a `docs/aprendizajes.md`: fecha · qué pasó · control agregado · enlace al PR.
- Si el aprendizaje sirve para todos los proyectos, márcalo `[GLOBAL]` para que el tech lead lo suba al plugin `softnexus-sdd`.
