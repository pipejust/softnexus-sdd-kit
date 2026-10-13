#!/usr/bin/env bash
# El wrapper solo ejecuta una descarga nueva y propaga el código del actualizador.
set -uo pipefail
T="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$T/tmp"
W=$(mktemp -d "$T/tmp/instalador.XXXXXX")
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin"
cat > "$W/bin/curl" <<'MOCK'
#!/usr/bin/env bash
if [ "${SN_DOWNLOAD_FAIL:-}" = 1 ]; then exit 22; fi
while [ "$#" -gt 0 ]; do
 if [ "$1" = -o ]; then shift; printf 'process.exit(Number(process.env.SN_UPDATE_EXIT || 0));\n' > "$1"; exit 0; fi
 shift
done
exit 1
MOCK
chmod +x "$W/bin/curl"
ok=0; fallas=0
PATH="$W/bin:$PATH" TMPDIR="$W" bash "$T/../herramientas/plugin-general.sh" > "$W/ok.txt" 2>&1; code=$?
if [ "$code" -eq 0 ]; then echo 'OK    Wrapper ejecuta una descarga nueva'; ok=$((ok+1)); else echo 'FALLA Wrapper no ejecutó la descarga'; fallas=$((fallas+1)); fi
SN_UPDATE_EXIT=1 PATH="$W/bin:$PATH" TMPDIR="$W" bash "$T/../herramientas/plugin-general.sh" > "$W/fail.txt" 2>&1; code=$?
if [ "$code" -eq 1 ]; then echo 'OK    Wrapper propaga una actualización no confirmada'; ok=$((ok+1)); else echo 'FALLA Wrapper ocultó el error'; fallas=$((fallas+1)); fi
SN_DOWNLOAD_FAIL=1 PATH="$W/bin:$PATH" TMPDIR="$W" bash "$T/../herramientas/plugin-general.sh" > "$W/download.txt" 2>&1; code=$?
if [ "$code" -ne 0 ]; then echo 'OK    Descarga fallida no ejecuta un archivo anterior'; ok=$((ok+1)); else echo 'FALLA Descarga fallida se presentó como éxito'; fallas=$((fallas+1)); fi
printf '\nRESULTADO: %s OK · %s fallas\n' "$ok" "$fallas"
[ "$fallas" -eq 0 ]
