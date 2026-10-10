#!/usr/bin/env bash
# Corre las pruebas del plugin y resume al final. Necesita node, git, python3 y curl.
#   bash pruebas/todas.sh
set -uo pipefail
T="$(cd "$(dirname "$0")" && pwd)"
total_ok=0; total_fallas=0
for prueba in reglas-test.mjs auditoria-test.mjs instalador-test.sh run.sh altum-test.sh watch-test.sh proceso-test.sh guard-test.sh; do
  code=0
  if [ "${prueba##*.}" = mjs ]; then salida="$(node "$T/$prueba" 2>&1)" || code=$?; else salida="$(bash "$T/$prueba" 2>&1)" || code=$?; fi
  linea="$(echo "$salida" | tail -1)"
  ok=$(echo "$linea" | sed -n 's/.*RESULTADO: \([0-9]*\) OK.*/\1/p')
  fallas=$(echo "$linea" | sed -n 's/.*· \([0-9]*\) fallas.*/\1/p')
  if [ -z "$ok" ] || [ -z "$fallas" ]; then
    ok=0; fallas=1
    linea="FALLA: prueba sin resumen válido (salida $code): $linea"
  elif [ "$code" -ne 0 ] && [ "$fallas" -eq 0 ]; then
    fallas=1
    linea="FALLA: prueba terminó con salida $code aunque su resumen dice 0 fallas"
  fi
  printf '%-18s %s\n' "$prueba" "$linea"
  [ -n "${fallas:-}" ] && [ "$fallas" != "0" ] && echo "$salida" | grep '^FALLA' | sed 's/^/    /'
  total_ok=$((total_ok + ${ok:-0})); total_fallas=$((total_fallas + ${fallas:-0}))
done
echo
echo "TOTAL: $total_ok OK · $total_fallas fallas"
[ "$total_fallas" = "0" ]
