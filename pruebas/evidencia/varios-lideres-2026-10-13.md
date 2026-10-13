# Varios líderes de Altum — 13 de octubre de 2026

Versión preparada: 0.63.0. El original del dispositivo coincidía con los 87 archivos
publicados del kit 0.62.0 antes de incorporar esta corrección.

## Causa y corrección

La lectura de Altum seleccionaba el primer `members.is_lead`. Si `/me` indicaba que
la persona actual también era líder, combinaba su nombre con el correo y GitHub del primero.

Ahora se conserva la lista completa de líderes y la identidad de cada uno por separado.
Cualquiera puede firmar los planos y las entregas, aprobar PRs y unir su propio trabajo.
El guard comprueba el GitHub activo contra todos los líderes. Una persona ajena sigue bloqueada.
La aprobación automática del PR propio se reconoce para cualquiera de los líderes.
CODEOWNERS conserva las reglas específicas y enumera todos sus usuarios de GitHub.
La caché incluye la lista y una versión de formato: una caché antigua se refresca antes de merge.

## Comprobaciones

543 comprobaciones correctas y 0 fallos: 527 anteriores y 16 nuevas.
Las nuevas incluyen dos líderes, aprobación y autoría de cada uno, firma de planos,
rechazo de desarrolladores, identidades no mezcladas, CODEOWNERS y el guard real de merge.
Las pruebas usan datos y servidores simulados: no se modificaron tareas ni miembros en Altum.
El módulo principal mantiene 999 líneas, dentro del límite de 1000.

## Aplicación

Publicar los PR del kit y la documentación; actualizar el plugin general y reiniciar Claude Code.
Cada líder debe tener registrada su propia cuenta de GitHub en Altum y usar esa sesión.
Los motores `scripts/sn/` versionados de los proyectos, sus CODEOWNERS y la línea de AGENTS.md
se actualizan mediante PR (`motor --actualizar` y `lead --escribir`). La actualización personal
no sustituye la copia que ejecuta el CI ni cambia las políticas de permisos del proveedor Git.
