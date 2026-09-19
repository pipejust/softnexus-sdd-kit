---
name: sn-explain
description: Microlección de 5 minutos después de cada historia. Explica en lenguaje no técnico qué se cambió, qué archivos importan, cómo viaja la información y qué podría fallar, y hace 2 preguntas de comprobación. Úsala al cerrar un change, o cuando alguien pregunte "qué hiciste", "cómo funciona esto" o "no entiendo este código".
---

# sn-explain — aprender sobre el código real

Objetivo: que cada historia terminada deje a la persona entendiendo un poco más de desarrollo. Cien historias = cien lecciones sobre SU código.

## Formato (máx. ~300 palabras, sin jerga sin explicar)
1. **Qué cambió** — 2 frases, como se lo contarías al cliente.
2. **El viaje del dato** — un diagrama de texto del flujo real, p. ej.:
   `Botón "Guardar" (components/ClienteForm.tsx) → POST /api/clientes → valida con zod → inserta en tabla clientes (RLS: solo su entidad) → respuesta → la tabla se refresca`
3. **Los 3 archivos que importan** — ruta + una línea de qué hace cada uno.
4. **Concepto de la semana** — elige UNO que apareció en el cambio (request/response, estado, RLS, migración, variable de entorno, test E2E, autorización vs autenticación…) y explícalo con este mismo ejemplo.
5. **Qué podría romperse** — el fallo más probable y cómo se notaría.
6. **Dos preguntas** para la persona (no para ti). Espera sus respuestas y corrige con amabilidad.

Si la persona responde bien ambas, díselo. Si no, repite el concepto con otro ángulo, sin sermones.
