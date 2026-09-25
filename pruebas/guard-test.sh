#!/usr/bin/env bash
# Prueba del guard: cada caso dice qué comando y qué debe pasar (2 = bloquear, 0 = dejar pasar).
set -uo pipefail
T="$(cd "$(dirname "$0")" && pwd)"
W="$T/tmp"; mkdir -p "$W"   # todo lo que la prueba crea vive aquí (no se versiona)
GUARD="$(cd "$T/../plugin/hooks" && pwd)/guard.mjs"
pass=0; fail=0
while IFS=$'\t' read -r cmd esperado desc; do
  [ -z "$cmd" ] && continue
  printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$cmd")" \
    | node "$GUARD" >/dev/null 2>&1
  real=$?
  if [ "$real" = "$esperado" ]; then echo "OK    $desc"; pass=$((pass+1)); else echo "FALLA $desc (esperaba $esperado, dio $real)"; fail=$((fail+1)); fi
done < <(python3 -c '
import json
for c in json.load(open("'"$T"'/guard-cases.json")):
    print("\t".join([c[0], str(c[1]), c[2]]))
')
echo; echo "RESULTADO: $pass OK · $fail fallas"
