---
name: sn-split
description: Reduce la deuda heredada de tamaño en proyectos que YA existían antes de adoptar Spec Driven - divide un archivo de más de 1000 líneas registrado en .sn-size-baseline en módulos por responsabilidad, sin cambiar su comportamiento. Úsala cuando el hook o el CI digan "deuda heredada", cuando se planifique pagar esa deuda, o cuando alguien pida "divide este archivo viejo". NO es para código nuevo - en proyectos nuevos los archivos se mantienen pequeños desde el diseño.
---

# /sn-split — pagar la deuda de archivos grandes heredados

Regla de Softnexus: **ningún archivo supera 1000 líneas**; lo sano es 200–400.

**Cuándo se usa esta skill y cuándo no:**
- **Proyecto nuevo (desde cero con Spec Driven):** nunca. Los archivos nacen pequeños porque el plano define módulos y, si uno se acerca al límite, el agente pone el código nuevo en otro módulo dentro de la misma tarea. Si el hook bloquea en código nuevo, se resuelve ahí mismo extrayendo un módulo, sin esta skill.
- **Proyecto existente que adopta Spec Driven:** sí. Los archivos que ya pasaban el límite quedaron en `.sn-size-baseline` como deuda heredada (lo hizo `sn-setup`). Esta skill los reduce, de a uno, como ítems propios del backlog.

## 0. ¿Es deuda heredada, o una excepción?
- Confirma que el archivo está en `.sn-size-baseline`. Si no está y pasa el límite, no es deuda: es código nuevo que creció; extrae el módulo en la tarea actual en vez de usar esta skill.
- Si es **generado o de datos** (tipos generados, lockfiles, fixtures, traducciones, SQL de semilla): no se divide. Propón agregarlo a `.sn-size-ignore` y pide aprobación del líder técnico.
- Si es código escrito a mano: se divide. Es un cambio de riesgo **R1–R2** según lo que toque; si el archivo es de auth, permisos o pagos, es **R3**.

## 1. Red de seguridad primero
- Corre los tests del área. Si el archivo no tiene tests que cubran su comportamiento público, **escribe primero tests de caracterización** (lo que hace hoy, aunque sea raro). Sin red, no se divide.
- Anota las exportaciones públicas y quién las importa (`grep`/búsqueda de referencias). Esas firmas no cambian.

## 2. Mapa de responsabilidades
Lee el archivo y agrúpalo en bloques con **una razón de cambio** cada uno, por ejemplo:
- tipos e interfaces · constantes y configuración · utilidades puras · acceso a datos · lógica de negocio · componentes de UI pequeños · handlers.
Muestra el plan a la persona antes de mover nada:
```
ARCHIVO: src/clientes/ClientesPage.tsx (1.240 líneas)
Propuesta:
  clientes/types.ts            ~60   tipos
  clientes/api.ts              ~140  llamadas a la API
  clientes/useClientes.ts      ~180  estado y efectos
  clientes/ClientesTable.tsx   ~260  tabla
  clientes/ClientesFilters.tsx ~150  filtros
  clientes/ClientesPage.tsx    ~200  composición (queda el mismo import público)
¿Seguimos?
```

## 3. Mover, no reescribir
- Mueve bloques tal cual. **Cero cambios de lógica** en este cambio: nada de "de paso mejoro esto".
- Un bloque por paso; después de cada movimiento: typecheck + tests.
- Conserva la ruta pública: el archivo original re-exporta lo que otros importaban, para no tocar a los consumidores (o actualiza sus imports en el mismo cambio si son pocos).
- Evita dependencias circulares: los módulos nuevos no importan del archivo "padre".

## 4. Evidencia
- `node scripts/check-file-size.mjs <archivos tocados>` sin errores.
- Actualiza `.sn-size-baseline`: si el archivo quedó bajo 1000 líneas, borra su línea; si sigue sobre el límite (división parcial), baja el número al tamaño actual. La deuda solo puede bajar.
- Mismos tests en verde que antes (misma cantidad o más).
- `git diff --stat`: la suma de líneas debe ser parecida a la original (mover no agrega código).
- Commit con `sn-ship`: `refactor(<área>): dividir <archivo> por responsabilidad`.

## 5. Que no vuelva a crecer
Deja en `AGENTS.md` §7 dónde va cada tipo de código (con `sn-learn`), para que el código nuevo nunca vuelva a juntarse en un solo archivo.
