# Historia AI-ready — plantilla

> Una historia no entra a desarrollo (no está "Ready") hasta que todos los campos obligatorios (*) están llenos.
> No hace falta llenarla a mano: `/sn-story "<texto vago>"` entrevista a la persona y la completa.

**ID:** SN-___  **Proyecto:** ___  **Tamaño*:** XS/S/M/L  **Riesgo*:** R0–R4

## Historia*
Como **<rol>** quiero **<acción>** para **<beneficio>**.

## Contexto
Por qué ahora, de dónde viene la solicitud, enlaces (acta, correo, ticket del cliente).

## Criterios de aceptación* (Given / When / Then)
**Happy path**
- Dado <estado inicial>, cuando <acción>, entonces <resultado observable>.

**Fallo**
- Dado ..., cuando <algo sale mal>, entonces <mensaje/estado esperado>.

**Borde**
- Dado <límite: vacío, máximo, duplicado, sin permisos, sesión expirada>, cuando ..., entonces ...

## Estados de UI (si aplica)
- Vacío: ___  - Cargando: ___  - Error: ___  - Sin permiso: ___  - Móvil: ___

## Referencia visual
Figma / screenshot / página de referencia / sección de `DESIGN.md`.

## Fuera de alcance*
- ___

## Datos y permisos
Qué tablas/APIs toca. Quién puede ver/hacer qué.

## Cómo se prueba*
- Unit: ___
- E2E (Playwright): "entra, busca, abre, edita, guarda, recarga, verifica"
- Manual por el PO: ___

## Preguntas abiertas
- ___ (si hay alguna, la historia NO está Ready)
