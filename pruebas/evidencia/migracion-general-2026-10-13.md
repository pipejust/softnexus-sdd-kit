# Migración a instalación general — 13 de octubre de 2026

0.65.0 corrige la diferencia entre actualizar copias y migrar a una sola instalación.
Sin opciones, el descargable verifica primero user, respalda ajustes, retira project/local
con `claude plugin uninstall --keep-data` y elimina solo la declaración Softnexus.
Se comprueban el registro final, manifiesto, motor, habilitación de usuario y ausencia de
declaraciones particulares en proyectos conocidos y cwd. No se explora todo el disco.
`--conservar-proyectos` mantiene el comportamiento anterior como excepción explícita.

## Evidencia

- Suite completa: 559 OK, cero fallas. Los 20 casos del actualizador incluyen éxito aparente
  del CLI, registro/manifiesto distintos, proyecto atrasado, migración de project y local,
  ajustes sin registro, API y otros ajustes preservados, repetir el comando y disco ausente.
- Prueba real macOS: usuario pasó de 0.63 a 0.64, la publicada durante la prueba.
- Se instaló una copia project real en /private/tmp/sn-migracion-real; la inspección confirmó
  que era la única copia particular y el único ajuste afectado. La migración posterior
  guardó respaldo, retiró project y confirmó únicamente user 0.64 con GENERAL VERIFICADA.
- La revisión automática rechazó inicialmente esa prueba por alcance potencial; después
  de comprobar las rutas afectadas permitió la misma ejecución acotada al temporal.
- Se añadió CI del actualizador para Linux, macOS y Windows y comprobación sintáctica de PowerShell.
  La prueba real de Claude se hizo en macOS; las pruebas de CI usan un CLI simulado.
- Manual, Word y web actualizados. El descargable web y los dos archivos del kit son idénticos.
- No se modificaron credenciales, permisos de GitHub ni datos de Altum.

## Uso

La URL estable del equipo es https://sd.softnexus.io/actualizar.mjs. Requiere Node.js 18+
y Claude Code. Descargar de nuevo en cada actualización, desde la terminal. Cerrar las
sesiones de Claude y abrirlas después. Entregar mediante PR los cambios de ajustes versionados;
no borrar .claude, .sn ni scripts/sn completos. Motores de CI se actualizan en cada repositorio.
