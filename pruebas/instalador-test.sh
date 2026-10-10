#!/usr/bin/env bash
# No usa Claude ni el almacén del usuario: dobles de los dos comandos externos.
set -uo pipefail
T="$(cd "$(dirname "$0")" && pwd)"
W=$(mktemp -d "$T/tmp/instalador.XXXXXX")
mkdir -p "$W/bin" "$W/plugin/scripts"
touch "$W/plugin/scripts/sn-sync.mjs"
cat > "$W/bin/node" <<'MOCK'
#!/usr/bin/env bash
if [[ "$*" == *limpiar-copias* ]]; then
  echo limpiar-copias >> "$SN_INSTALL_TEST_DIR/log"
else
  echo "$SN_INSTALL_TEST_DIR/${SN_INSTALL_TEST_MOTOR:-plugin}"
fi
MOCK
cat > "$W/bin/claude" <<'MOCK'
#!/usr/bin/env bash
case "$*" in
  'plugin marketplace list') echo softnexus ;;
  'plugin marketplace update softnexus')
    if [ "${SN_INSTALL_TEST_CATALOGO:-}" = 1 ]; then echo 'Marketplaces could not be refreshed'; exit 1; fi ;;
  'plugin update softnexus-sdd@softnexus')
    if [ "${SN_INSTALL_TEST_FAIL:-}" = 1 ]; then echo 'Error: actualización fallida'; exit 1; fi ;;
esac
MOCK
chmod +x "$W/bin/node" "$W/bin/claude"
ok=0; fallas=0
SN_INSTALL_TEST_DIR="$W" SN_INSTALL_TEST_FAIL=1 TMPDIR="$W" PATH="$W/bin:$PATH" bash "$T/../herramientas/plugin-general.sh" > "$W/fallo.txt" 2>&1
code=$?
if [ "$code" -eq 1 ] && [ ! -f "$W/log" ]; then
  echo 'OK    Con motor anterior presente, una actualización fallida no ejecuta limpiar-copias'; ok=$((ok+1))
else echo 'FALLA Actualización fallida limpió copias o escondió el error'; fallas=$((fallas+1)); fi
SN_INSTALL_TEST_DIR="$W" TMPDIR="$W" PATH="$W/bin:$PATH" bash "$T/../herramientas/plugin-general.sh" > "$W/exito.txt" 2>&1
code=$?
if [ "$code" -eq 0 ] && [ "$(cat "$W/log" 2>/dev/null)" = limpiar-copias ]; then
  echo 'OK    Instalación confirmada sí limpia las copias'; ok=$((ok+1))
else echo 'FALLA Instalación confirmada no terminó correctamente'; fallas=$((fallas+1)); fi
rm -f "$W/log"
SN_INSTALL_TEST_DIR="$W" SN_INSTALL_TEST_CATALOGO=1 TMPDIR="$W" PATH="$W/bin:$PATH" bash "$T/../herramientas/plugin-general.sh" > "$W/catalogo.txt" 2>&1
code=$?
if [ "$code" -eq 1 ] && [ ! -f "$W/log" ]; then
  echo 'OK    Catálogo fallido no se trata como éxito ni limpia copias'; ok=$((ok+1))
else echo 'FALLA Catálogo fallido se presentó como éxito'; fallas=$((fallas+1)); fi
SN_INSTALL_TEST_DIR="$W" SN_INSTALL_TEST_MOTOR=inexistente TMPDIR="$W" PATH="$W/bin:$PATH" bash "$T/../herramientas/plugin-general.sh" > "$W/motor.txt" 2>&1
code=$?
if [ "$code" -eq 1 ] && [ ! -f "$W/log" ]; then
  echo 'OK    Sin motor confirmado no se declara instalación completa'; ok=$((ok+1))
else echo 'FALLA Motor inexistente se presentó como instalado'; fallas=$((fallas+1)); fi
printf '\nRESULTADO: %s OK · %s fallas\n' "$ok" "$fallas"
[ "$fallas" -eq 0 ]
