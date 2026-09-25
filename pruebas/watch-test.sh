#!/usr/bin/env bash
# Prueba del vigilante interno de Altum (sin n8n).
set -uo pipefail
T="$(cd "$(dirname "$0")" && pwd)"
W="$T/tmp"; mkdir -p "$W"   # todo lo que la prueba crea vive aquí (no se versiona)
PLUGIN="$(cd "$T/../plugin" && pwd)"
PORT=4597; LOG="$W/watch.jsonl"; PROJECT=11111111-1111-1111-1111-111111111111
export SN_ALTUM_KEY_PRUEBA=sk_live_test_empresa_a SN_SYNC_NO_GH=1
pass=0; fail=0
check() { if eval "$2"; then echo "OK    $1"; pass=$((pass+1)); else echo "FALLA $1"; fail=$((fail+1)); fi; }
hook() { printf '{"hook_event_name":"%s","cwd":"%s"}' "$1" "$W/watch-repo" | node "$PLUGIN/hooks/altum-watch.mjs"; }
pkill -f "altum-mock.mjs $PORT" 2>/dev/null; sleep 0.3
rm -rf "$W/watch-repo" "$LOG"; mkdir -p "$W/watch-repo" && cd "$W/watch-repo"
git init -q -b trunk && git config user.name "Laura" && git config user.email l@x
mkdir -p scripts/sn .sn docs/items
cp -R "$PLUGIN/scripts/sn-sync.mjs" "$PLUGIN/scripts/validation-state.mjs" "$PLUGIN/scripts/sync" scripts/sn/
cat > .sn/connectors.json <<JSON
{ "project": "clientes", "connectors": [ { "name": "altum", "kind": "altum", "base_url": "http://localhost:$PORT/api/v1/api",
  "project_id": "$PROJECT", "key_env": "SN_ALTUM_KEY_PRUEBA", "notify": false, "events": ["sn.item.*"] } ] }
JSON
node "$T/altum-mock.mjs" $PORT "$LOG" >/dev/null 2>&1 & MOCK=$!; sleep 0.6
for n in 1 2 3; do printf -- "---\nid: CLI-000$n\ntype: bug\ntitle: Ítem $n\nrisk: R2\n---\n## Historia\nx\n" > docs/items/CLI-000$n.md; done
node scripts/sn/sn-sync.mjs sync >/dev/null

echo "== Sin clave: el sistema la pide solo"
rm -f .sn/state/altum-key-remind.json
out=$(printf '{"hook_event_name":"UserPromptSubmit","cwd":"%s"}' "$W/watch-repo" | env -u SN_ALTUM_KEY_PRUEBA node "$PLUGIN/hooks/altum-watch.mjs")
check "Sin clave, cualquier mensaje recuerda ofrecerle guardarla" "echo \"\$out\" | grep -q 'todavía no tiene guardada su clave' && echo \"\$out\" | grep -q 'clave-altum.md'"
out2=$(printf '{"hook_event_name":"UserPromptSubmit","cwd":"%s"}' "$W/watch-repo" | env -u SN_ALTUM_KEY_PRUEBA node "$PLUGIN/hooks/altum-watch.mjs")
check "No se insiste: el recordatorio no se repite en cada mensaje" "[ -z \"\$out2\" ]"
rm -f .sn/state/altum-key-remind.json

echo "== Sin repositorio registrado en Altum: el sistema lo pide primero"
rm -f .sn/state/altum-repo-remind.json
node scripts/sn/sn-sync.mjs repo-check >/dev/null 2>&1
check "repo-check detecta que el proyecto no tiene repositorio y lo deja anotado" "grep -q '\"missing\": *true' .sn/state/altum-repo.json"
out=$(hook UserPromptSubmit)
check "El aviso llega al agente antes de lo demás, con el comando para registrarlo" "echo \"\$out\" | grep -q 'no tiene registrado en Altum de dónde se clona' && echo \"\$out\" | grep -q 'set-repo'"
out2=$(hook UserPromptSubmit)
check "No se insiste: el aviso del repositorio no se repite en cada mensaje" "! echo \"\$out2\" | grep -q 'de dónde se clona'"

echo "== Arranque con la sesión"
hook SessionStart; sleep 1.5
check "SessionStart arranca el vigilante en segundo plano" "[ -f .sn/state/watch-altum.pid ] && kill -0 \$(cat .sn/state/watch-altum.pid) 2>/dev/null"
PID1=$(cat .sn/state/watch-altum.pid); hook SessionStart; sleep 1
check "Un segundo SessionStart no crea otro vigilante" "[ \"\$(cat .sn/state/watch-altum.pid)\" = \"$PID1\" ]"
hook SessionEnd; sleep 0.5
check "SessionEnd lo detiene" "[ ! -f .sn/state/watch-altum.pid ] && ! kill -0 $PID1 2>/dev/null"

echo "== Avisos (una ronda del vigilante, 20 s)"
rm -f .sn/state/watch-altum.json .sn/state/inbox.json
node scripts/sn/sn-sync.mjs watch altum --background --every 20 --no-notify; sleep 3
curl -s "localhost:$PORT/_create" >/dev/null
sed -i '' 's/^title: .*/title: Guardar falla sin ciudad/' docs/items/CLI-0001.md; node scripts/sn/sn-sync.mjs sync >/dev/null
curl -s "localhost:$PORT/_edit?ref=CLI-0002" >/dev/null   # alguien la cambia a mano segundos después de nuestro envío
curl -s "localhost:$PORT/_delete?ref=CLI-0003" >/dev/null
sleep 24
out=$(hook UserPromptSubmit)
check "Tarea creada a mano en Altum llega al agente en el siguiente mensaje" "echo \"\$out\" | grep -q 'Nueva tarea en Altum' && echo \"\$out\" | grep -q 'Error en login'"
check "El cambio hecho desde este computador NO genera aviso (updated_by = nuestra clave)" "! echo \"\$out\" | grep -q 'CLI-0001 cambió'"
check "Cambio a mano justo después de nuestro envío SÍ avisa (updated_by = null)" "echo \"\$out\" | grep -q 'CLI-0002 cambió en Altum: estado en_revision'"
check "Tarea enlazada borrada en Altum avisa (include_deleted)" "echo \"\$out\" | grep -q 'CLI-0003: su tarea #[0-9]* se borró en Altum'"
out2=$(hook UserPromptSubmit)
check "La bandeja se vacía: el aviso no se repite" "[ -z \"\$out2\" ]"
sleep 22; out3=$(node scripts/sn/sn-sync.mjs inbox --peek)
check "Rondas siguientes no repiten la misma tarea" "echo \"\$out3\" | grep -q 'Sin avisos'"
node scripts/sn/sn-sync.mjs watch-stop >/dev/null
check "Una consulta por ronda a /tasks (respeta el límite de Altum)" "[ \$(grep 'updated_since' '$LOG' | grep -c 'page=1') -le 4 ]"
check "Las rondas del vigilante no piden estados (quedan guardados 10 min): 1 petición por ronda" "[ \$(grep -c 'config/estados' '$LOG') -le 2 ]"

check "El aviso de una tarea nacida en reunión no dice #null" "node -e \"import('./scripts/sn/sync/altum-watch.mjs').then(m => { const t = m.describe({ kind: 'new', number: null, title: 'Acuerdo de la reunión', priority: null }); if (/#null|#undefined/.test(t) || !/reunión/.test(t)) process.exit(1); })\""

echo "== Carpeta nueva sin proyecto: el agente sabe que existe la metodología"
hookdir() { printf '{"hook_event_name":"%s","cwd":"%s"}' "$1" "$2" | node "$PLUGIN/hooks/altum-watch.mjs"; }
rm -rf "$W/carpeta-nueva"; mkdir -p "$W/carpeta-nueva"
out=$(hookdir SessionStart "$W/carpeta-nueva")
check "Al abrir una carpeta vacía se le dice al agente que use la skill sn para traer el proyecto" "echo \"\$out\" | grep -q 'skill .sn.' && echo \"\$out\" | grep -q 'NO busques repositorios a mano'"
check "El aviso trae el motor del plugin, que sirve sin proyecto preparado" "echo \"\$out\" | grep -q 'scripts/sn-sync.mjs'"
out=$(hookdir UserPromptSubmit "$W/carpeta-nueva")
check "En cada mensaje no se repite: solo al abrir la sesión" "[ -z \"\$out\" ]"
check "No se ensucia la carpeta de la persona (ningún archivo creado)" "[ -z \"\$(ls -A "$W/carpeta-nueva")\" ]"

rm -rf "$W/ya-clonado"; mkdir -p "$W/ya-clonado" && git -C "$W/ya-clonado" init -q && echo x > "$W/ya-clonado/app.js"
out=$(hookdir SessionStart "$W/ya-clonado")
check "Repo que la persona YA tenía clonado: NO propone clonar otra vez; se prepara y se adopta ahí mismo" "echo \"\$out\" | grep -q 'NO le propongas clonarlo de nuevo' && echo \"\$out\" | grep -q 'ADOPTA'"

kill $MOCK 2>/dev/null; wait $MOCK 2>/dev/null
echo; echo "RESULTADO: $pass OK · $fail fallas"
