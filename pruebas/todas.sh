#!/usr/bin/env bash
# Corre las cinco pruebas del plugin y resume al final. Necesita node, git, python3 y curl.
#   bash pruebas/todas.sh
set -uo pipefail
T="$(cd "$(dirname "$0")" && pwd)"
total_ok=0; total_fallas=0
for prueba in run.sh altum-test.sh watch-test.sh proceso-test.sh guard-test.sh; do
  salida="$(bash "$T/$prueba" 2>&1)"
  linea="$(echo "$salida" | tail -1)"
  ok=$(echo "$linea" | sed -n 's/.*RESULTADO: \([0-9]*\) OK.*/\1/p')
  fallas=$(echo "$linea" | sed -n 's/.*· \([0-9]*\) fallas.*/\1/p')
  printf '%-18s %s\n' "$prueba" "$linea"
  [ -n "${fallas:-}" ] && [ "$fallas" != "0" ] && echo "$salida" | grep '^FALLA' | sed 's/^/    /'
  total_ok=$((total_ok + ${ok:-0})); total_fallas=$((total_fallas + ${fallas:-0}))
done
echo
echo "TOTAL: $total_ok OK · $total_fallas fallas"
[ "$total_fallas" = "0" ]
