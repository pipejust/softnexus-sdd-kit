#!/usr/bin/env bash
# Arranque verificado desde cualquier carpeta; no requiere SN instalado.
set -euo pipefail
command -v node >/dev/null || { echo 'Falta node (Node.js 18 o superior).' >&2; exit 1; }
command -v curl >/dev/null || { echo 'Falta curl.' >&2; exit 1; }
SN_UPDATE_TEMP=$(mktemp -d "${TMPDIR:-/tmp}/sn-actualizar.XXXXXX")
trap 'rm -rf "$SN_UPDATE_TEMP"' EXIT
BITACORA="${TMPDIR:-/tmp}/sn-plugin.txt"
# Si la descarga falla, no se ejecuta un archivo viejo que haya quedado en /tmp.
curl -fsSL https://raw.githubusercontent.com/pipejust/softnexus-sdd-kit/main/herramientas/actualizar-plugin.mjs -o "$SN_UPDATE_TEMP/actualizar-plugin.mjs"
node "$SN_UPDATE_TEMP/actualizar-plugin.mjs" "$@" 2>&1 | tee "$BITACORA"
