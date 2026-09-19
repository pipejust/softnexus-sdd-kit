# Registro de validación a distancia — formato único

Fuente de verdad para `sn-request`, `sn-validate`, `sn-status` y `sn-help`.
La validación **viaja por git**: nadie comparte sesión ni carpeta. Quien pide y quien valida pueden estar en computadores distintos; basta con `git pull`.

## Dónde vive
`openspec/changes/<change>/validacion.md` — un archivo por change, **solo se agregan entradas al final** (nunca se edita ni se borra una entrada anterior).

## Entradas

```markdown
## 2026-09-19 10:40 · SOLICITUD · sello: plano
- Pide: Laura Gómez <laura@softnexus.co>
- Rama: feat/SN-42-buscar-por-cedula · Commit: 3f2a91c
- Riesgo: R3 · Tamaño: M
- Qué validar: el plano (proposal, specs, design, tasks) antes de construir.
- Por qué necesita validación: toca permisos de usuarios (R3).

## 2026-09-19 15:02 · APROBADO · sello: plano
- Valida: Felipe Cortés <felipe@softnexus.co>
- Commit validado: 3f2a91c
- Notas: incluir prueba de que un usuario sin rol admin recibe 403.
```

| Campo | Valores |
|---|---|
| Tipo de entrada | `SOLICITUD` · `APROBADO` · `CAMBIOS PEDIDOS` · `RECHAZADO` |
| Sello | `plano` (antes de construir, R3–R4 o cuando el líder lo pida) · `entrega` (PR listo, R2+) |
| Commit | hash corto de la rama en el momento de pedir / validar |

## Cómo se deduce el estado (nunca se escribe a mano)
Para el sello más reciente del change:

| Última entrada | Estado | Qué hace quien desarrolla |
|---|---|---|
| `SOLICITUD` sin respuesta | **Esperando validación** | Espera. Puede avanzar en otra cosa pequeña si el líder lo permite. |
| `APROBADO` y **no** hubo cambios en el plano después del commit validado | **Validado** | Continúa el camino. |
| `APROBADO` pero el plano cambió después (`git log <commit>..HEAD -- openspec/changes/<change>/{proposal.md,specs,design.md,tasks.md}` no está vacío) | **Validación vencida** | Pide validación de nuevo con `sn-request`. |
| `CAMBIOS PEDIDOS` | **Con correcciones** | Aplica las notas, luego `sn-request` otra vez. |
| `RECHAZADO` | **Detenido** | Habla con el líder; no se construye. |

Para el sello `entrega`, "cambió después" significa cualquier commit en la rama posterior al validado.

## Marcas visibles (además del archivo)
- Si hay GitHub: PR (borrador si el sello es `plano`) con la etiqueta `sn:needs-validation`. Al validar se quita la etiqueta y se deja una review (`approve` o `request-changes`) con las mismas notas.
- Sin GitHub: el archivo basta; `sn-validate` sin argumentos busca solicitudes pendientes en las ramas remotas.

## Mensaje para el mensajero institucional
`sn-request` genera este texto (la persona lo pega en Teams, Slack, Google Chat o el canal que use la empresa):

```
[Validación Softnexus] <proyecto> · <sello> · riesgo <RN>
<Nombre> necesita tu validación: <título del change>
Qué validar: <1 línea>
En tu computador, dentro del proyecto <repo>, abre Claude Code y escribe:
  /sn-validate <rama>
(No necesitas nada más: el comando trae la rama y todo el contexto.)
PR: <enlace, si existe>
```
Si el proyecto tiene la variable `SN_NOTIFY_WEBHOOK` (webhook entrante del canal del equipo), `sn-request` ofrece enviarlo directamente, **siempre con confirmación de la persona**.
