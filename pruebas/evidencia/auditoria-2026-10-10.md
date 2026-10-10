# Auditoría del kit y la web — 10 de octubre de 2026

Versión preparada: **0.62.0**. Revisión del código propio del motor, conectores, hooks,
instalación, validaciones, plantillas, pruebas y web. Las bibliotecas de terceros no se auditan aquí.

## Fallos corregidos

| Caso reproducido o comprobado en el flujo | Corrección |
|---|---|
| `sync --dry-run` procesaba la cola antes de simular | La simulación se resuelve antes del candado, la cola y cualquier entrega; también con `--background`. |
| Altum rechazaba un campo y luego otro: se perdía el resto del PATCH | Reintentos acotados por los campos restantes; se conserva `state`, se registra cada rechazo y no se adivinan campos desconocidos. |
| Una dependencia fallaba temporalmente y quedaba recordada como declarada | Los fallos temporales se propagan para reintentar; no se registran como declaración terminada. |
| `git push origin :main` podía borrar una rama protegida | Se comprueba el destino del refspec, incluidos `refs/heads/`. |
| `bash -lc` y `sh -ec` ocultaban comandos | Se reconocen las opciones combinadas del shell. |
| Crear o unir un PR dentro de `bash -c` evitaba comprobar sellos o líder | La detección de PR recorre los comandos anidados. |
| Una tubería anidada hacia `cat` se trataba como sumidero seguro | Se exige un sumidero permitido; las variables del script anidado se analizan en su contexto. |
| Una consulta fallida reutilizaba un líder vencido | La vigencia se comprueba también después del intento de refrescar. |
| Cambiar de proyecto reutilizaba el líder del anterior | La caché incluye `project_id`; el guard y las validaciones comprueban el proyecto. |
| Una firma solicitada sin identidad o sin líder conocido podía pasar | La firma se rechaza hasta poder comprobarla contra el líder de Altum. |
| Un commit existente en otra rama contaba como verificable | Se exige que sea ancestro de HEAD. |
| Cambiar el diseño sin commit conservaba el sello | Se compara el árbol de trabajo y los archivos nuevos; las casillas de progreso se permiten, cambiar el alcance exige otra aprobación. La división reconocida conserva las tareas originales en una ficha enlazada. |
| Un PR con correcciones pedidas o detenido podía abrirse | Ambos estados bloquean la apertura. |
| Fallar al actualizar el catálogo podía presentarse como éxito | Se eliminan esas respuestas de la lista de errores benignos. |
| El instalador no encontraba un motor y aun así decía “Listo” | Sin motor confirmado, conserva copias y termina con error. |
| La limpieza conservaba una copia compartida antigua | Se actualiza esa copia; se conserva el archivo del equipo. Un reintento que cambia de ámbito tampoco puede desinstalar sobre un settings versionado. |
| Una prueba abortaba sin resumen y el total podía quedar verde | Se comprueban la salida del proceso y el resumen; ambos fallos tienen regresiones propias. |
| Un timestamp no numérico podía superar la verificación de webhook | Se exige un timestamp finito antes de comprobar antigüedad y HMAC. |

Se extrajeron el mantenimiento y el mensaje de validación del comando principal para cumplir
el límite de 1000 líneas. El comprobador conserva avisos de tamaño en `sn-sync.mjs` y `altum.mjs`;
ningún módulo del motor o de los hooks supera el límite.

## Validación

- Batería completa: `bash pruebas/todas.sh`: **527 OK · 0 fallas** (33 reglas, 24 auditoría, 4 instalador, 95 motor, 195 Altum, 28 vigilante, 32 proceso y 116 guardas).
- Sintaxis: 35 módulos `.mjs`, 12 archivos `.js`, 11 scripts `.sh` y 11 JSON: sin errores.
- Simulaciones locales con claves falsas; no se lee ni cambia la instalación personal de Claude.
- DOCX generado desde el manual, ZIP íntegro y contenido de actualización comprobado.
- Conversión a PDF y revisión visual de la página de actualización general.
- Copias del manual y del Word de la web idénticas a los originales.

### Sandbox real de Altum

Proyecto: **Sandbox Spec Driven**, `40840a6b-01ac-4799-9428-e340099118f1`.
Solo se escribieron dos tareas nuevas de esta prueba:

| Tarea | ID | Estado final |
|---|---|---|
| #3, `SN-AUDIT-261010-062-PADRE` | `a1b20d85-b0d6-4aa6-8698-b1f6932b4481` | `closed` |
| #4, `SN-AUDIT-261010-062-HIJA` | `9b9f44e9-159c-4401-b7fc-b2519c18215e` | `closed`, sin padre |

Seis comprobaciones pasaron: creación sin duplicados, 422 real por jerarquía,
reintento sin `parent_id` que conserva el cierre, segunda sincronización con cero PATCH,
ficha atrasada que no reabre la tarea y ambas tareas cerradas al terminar.
El rechazo consecutivo de dos campos y el fallo temporal de dependencias se comprobaron
con servidor local; no se atribuyen esos casos a la API real.

## Límites y publicación

Esto verifica los casos descritos y las regresiones conocidas; no garantiza ausencia de cualquier
fallo futuro. Windows tiene pruebas de sus comandos y reglas, pero esta auditoría se ejecutó en macOS.
El motor de CI que está versionado en cada repositorio sigue requiriendo su actualización mediante PR.
La instalación general cubre las sesiones personales después de reiniciar Claude Code.

**Publicar primero los PR de 0.62.0 y después enviar el aviso de actualización.**
