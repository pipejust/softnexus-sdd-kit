# Actualización comprobada — 13 de octubre de 2026

Versión preparada: 0.64.0. El proceso anterior confiaba en la salida exitosa del CLI y
podía declarar éxito con usuario y proyectos todavía en versiones anteriores. Actualizar
solo el usuario tampoco comprobaba las copias compartidas de los proyectos.

## Nuevo procedimiento

`herramientas/actualizar-plugin.mjs` se descarga y ejecuta con Node desde cualquier carpeta.
No necesita SN instalado ni un modelo de IA. Requiere Node.js 18 o superior y el CLI `claude`.
El mismo archivo se distribuye como `plugin/scripts/sync/update-general.mjs`; las pruebas
exigen que ambas copias sean idénticas. El motor usa este código en `actualizar --general`,
`actualizar --arreglar` e `instalar-general`.

1. Consulta la versión publicada de GitHub sin usar caché como prueba de actualidad.
2. Refresca el catálogo; si era una carpeta local, primero hace git pull --ff-only.
3. Instala o actualiza explícitamente el ámbito de usuario.
4. Relee el registro y el manifiesto real del usuario y comprueba que exista el motor.
5. Actualiza cada copia de proyecto/local registrada, en su carpeta y con su ámbito explícito.
6. Relee todas las instalaciones. Exige versión igual o superior a la publicada y coincidencia
   entre registro y manifiesto. Solo entonces imprime VERIFICADO para cada copia y el final exitoso.

Se conservan las copias de proyecto y sus settings compartidos; no hay desinstalación ni limpieza
implícita. Una ruta inexistente, registro corrupto, ámbito administrado o fallo del CLI impide
confirmar el resultado. `--verificar` solo consulta y comprueba, sin modificar instalaciones.
Los wrappers de bash y PowerShell ejecutan una descarga nueva y propagan los errores.

## Pruebas

- 15 regresiones de actualización: éxito del CLI con archivos viejos; usuario nuevo/proyecto viejo;
  desacuerdos entre registro y manifiesto; ausencia de motor; error del CLI; sin red; catálogo
  local; instalación inicial; modo de solo lectura; estado ya habilitado y configuración conservada.
- Tres regresiones del wrapper: descarga nueva, salida de fallo propagada y descarga fallida.
- Comprobación real de solo lectura: GitHub publicó 0.63.0, mientras esta máquina tenía registro
  y archivos 0.62.0. El actualizador terminó con código 1 y ACTUALIZACIÓN NO CONFIRMADA, sin cambios.
- Actualización real posterior en este computador: el CLI pasó user de 0.62.0 a 0.63.0;
  el registro y el manifiesto coincidieron y el actualizador imprimió VERIFICADO: user 0.63.0.
  En esta máquina solo había copia de usuario; los proyectos atrasados se prueban con fixtures.
- Batería final completa: **554 OK · 0 fallas** (33 reglas, 15 actualización, 16 líderes, 24 auditoría, 3 wrapper, 92 motor, 195 Altum, 28 vigilante, 32 proceso y 116 guardas).
- DOCX íntegro, copias web iguales al original y PDF de la página de comandos revisado visualmente. Ejecución de las pruebas en macOS;
  la ruta de Windows y el wrapper PowerShell están preparados, sin prueba nativa en Windows.

## Distribución

Para usar el actualizador antes de unir los PR, descargar el archivo de la rama del PR.
Ese archivo consulta la versión de main: hoy puede llevar todas las copias a 0.63.0 aunque
su propio código se esté preparando para 0.64.0. No ejecuta el motor antiguo instalado.
Después de publicar, usar la URL de main del manual y reiniciar todas las sesiones.
Las claves API de Altum no cambian. Los motores `scripts/sn/` de CI se actualizan por PR aparte.
