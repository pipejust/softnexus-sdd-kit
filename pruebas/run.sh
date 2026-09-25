#!/usr/bin/env bash
# Prueba de punta a punta del motor sn-sync contra un servidor falso (REST, webhook, Matrix, GitHub Issues).
set -uo pipefail
T="$(cd "$(dirname "$0")" && pwd)"
W="$T/tmp"; mkdir -p "$W"   # todo lo que la prueba crea vive aquí (no se versiona)
PLUGIN="$(cd "$T/../plugin/scripts" && pwd)"
PORT=4599
LOG="$W/requests.jsonl"
export SN_GH_TOKEN=gh-token-test SN_ALTUM_TOKEN=token-rest-test SN_WEBHOOK_SECRET=webhook-secret-test SN_MATRIX_TOKEN=token-matrix-test SN_SYNC_NO_GH=1
pass=0; fail=0
check() { if eval "$2"; then echo "OK    $1"; pass=$((pass+1)); else echo "FALLA $1"; fail=$((fail+1)); fi; }
count() { grep -c "$1" "$LOG" 2>/dev/null || echo 0; }
start_mock() { node "$T/mock-server.mjs" $PORT "$LOG" >/dev/null 2>&1 & MOCK=$!; sleep 0.6; }
stop_mock() { kill $MOCK 2>/dev/null; wait $MOCK 2>/dev/null; }
sync() { node scripts/sn/sn-sync.mjs sync "$@"; }
gh_state() { curl -s "localhost:$PORT/gh-state"; }
py_assert() { gh_state | python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

rm -rf "$W/repo" "$LOG"; mkdir -p "$W/repo" && cd "$W/repo"
git init -q -b trunk && git config user.name "Laura Gómez" && git config user.email laura@x
mkdir -p scripts/sn .sn docs/items openspec/changes
cp -R "$PLUGIN/sn-sync.mjs" "$PLUGIN/validation-state.mjs" "$PLUGIN/sync" scripts/sn/
printf '.sn/state/\n' > .gitignore
cat > .sn/connectors.json <<JSON
{ "project": "clientes", "connectors": [
  { "name": "altum", "kind": "rest", "base_url": "http://localhost:$PORT/api", "auth": { "type": "bearer", "env": "SN_ALTUM_TOKEN" },
    "upsert": { "method": "PUT", "path": "/projects/{project}/items/{id}" }, "fetch": { "path": "/tasks/{id}" },
    "status_map": { "triaged": "Por hacer", "building": "En progreso", "done": "Hecho" }, "events": ["sn.item.*", "sn.validation.*"] },
  { "name": "n8n", "kind": "webhook", "url": "http://localhost:$PORT/hook", "secret_env": "SN_WEBHOOK_SECRET", "events": ["*"] },
  { "name": "equipo", "kind": "matrix", "homeserver": "http://localhost:$PORT", "room_id": "!sala:softnexus.co", "token_env": "SN_MATRIX_TOKEN",
    "events": ["sn.validation.*", "sn.item.created:bug"] },
  { "name": "github", "kind": "github", "repo": "softnexus/clientes", "api_url": "http://localhost:$PORT/gh", "token_env": "SN_GH_TOKEN", "events": ["sn.item.*"] }
] }
JSON
start_mock

echo "== 1. Nuevo bug (tarjeta)"
cat > docs/items/CLI-0001.md <<'MD'
---
id: CLI-0001
type: bug
title: El botón guardar no hace nada
risk: R2
size: XS
change: fix-guardar-cliente
branch: fix/CLI-0001-guardar
assignee: Laura Gómez <laura@x>
---
## Historia
Como vendedora quiero guardar un cliente nuevo.
MD
sync >/dev/null
check "REST recibe upsert con estado mapeado 'Por hacer'" "grep -q '\"status\":\"Por hacer\"' '$LOG'"
check "REST usa Bearer y ruta /projects/clientes/items/CLI-0001" "grep -q 'Bearer token-rest-test' '$LOG' && grep -q '/api/projects/clientes/items/CLI-0001' '$LOG'"
check "Webhook con firma HMAC válida" "grep -q '\"signature_ok\":true' '$LOG' && ! grep -q '\"signature_ok\":false' '$LOG'"
check "Matrix avisa bug nuevo en la sala" "grep -q 'rooms/!sala%3Asoftnexus.co/send/m.room.message' '$LOG' && grep -q 'Nuevo bug' '$LOG'"

echo "== 2. Sin cambios = sin eventos"
before=$(wc -l < "$LOG"); sync >/dev/null; after=$(wc -l < "$LOG")
check "Segunda sync sin cambios no envía nada" "[ $before -eq $after ]"

echo "== 3. Historia lista -> plano -> validación pedida"
printf '\n## Criterios de aceptación\n- Dado el formulario lleno, cuando guardo, entonces veo "Guardado".\n' >> docs/items/CLI-0001.md
sync >/dev/null
check "Etapa ready enviada" "grep -q '\"stage\":\"ready\"' '$LOG'"
C=openspec/changes/fix-guardar-cliente; mkdir -p $C/specs; echo "Qué" > $C/proposal.md; printf -- '- [ ] 1.1 test\n- [ ] 1.2 fix\n' > $C/tasks.md
git add -A && git commit -qm plan
H=$(git rev-parse --short HEAD)
printf -- "## 2026-09-19 10:40 · SOLICITUD · sello: plano\n- Pide: Laura Gómez <laura@x>\n- Rama: fix/CLI-0001-guardar · Commit: %s\n- Riesgo: R2\n" "$H" > $C/validacion.md
git add -A && git commit -qm solicitud
sync >/dev/null
check "Evento sn.validation.requested" "grep -q 'sn.validation.requested' '$LOG'"
check "Matrix: mensaje con /sn-validate y la rama" "grep -q 'sn-validate fix/CLI-0001-guardar' '$LOG'"

check "mensaje arma el texto para copiarle al líder, con rama, commit y el comando exacto" "out=\$(SN_SYNC_NO_GH=1 node scripts/sn/sn-sync.mjs mensaje 2>&1); echo \"\$out\" | grep -q 'Validación Softnexus' && echo \"\$out\" | grep -q 'sn-validate' && echo \"\$out\" | grep -q '$H'"
check "El mensaje dice el sello y el riesgo que pidió la solicitud" "SN_SYNC_NO_GH=1 node scripts/sn/sn-sync.mjs mensaje | grep -q 'sello de plano · riesgo R2'"
check "El mensaje le explica al líder cómo traer el proyecto si no lo tiene" "SN_SYNC_NO_GH=1 node scripts/sn/sn-sync.mjs mensaje | grep -q 'clóname el proyecto'"

echo "== 4. Líder aprueba -> construir -> evidencia"
V=$(git rev-parse --short HEAD)
printf -- "\n## 2026-09-19 15:02 · APROBADO · sello: plano\n- Valida: Felipe <f@x>\n- Commit validado: %s\n" "$V" >> $C/validacion.md
git add -A && git commit -qm aprobado
sync >/dev/null
check "Evento sn.validation.decided" "grep -q 'sn.validation.decided' '$LOG'"
check "Etapa plan_approved" "grep -q '\"stage\":\"plan_approved\"' '$LOG'"
printf -- '- [x] 1.1 test\n- [ ] 1.2 fix\n' > $C/tasks.md; sync >/dev/null
check "Etapa building con 'En progreso' y progreso 1/2" "grep -q '\"status\":\"En progreso\"' '$LOG' && grep -q '\"progress\":{\"done\":1,\"total\":2}' '$LOG'"
printf -- '- [x] 1.1 test\n- [x] 1.2 fix\n' > $C/tasks.md; echo ok > $C/evidencia.md; sync >/dev/null
check "Etapa verified" "grep -q '\"stage\":\"verified\"' '$LOG'"

echo "== 5. Sistema externo caído -> cola -> reintento"
stop_mock
sed -i '' 's/^title: .*/title: Guardar cliente falla sin ciudad/' docs/items/CLI-0001.md
out=$(sync)
check "Con el servidor caído, los envíos quedan en cola" "echo \"\$out\" | grep -q 'en cola' && [ -s .sn/state/outbox.jsonl ]"
start_mock
out=$(sync)
check "Al volver, la cola se reintenta y se vacía" "echo \"\$out\" | grep -qE 'reintentos ok [1-9]' && [ ! -s .sn/state/outbox.jsonl ]"
check "El título nuevo llegó al sistema externo" "grep -q 'Guardar cliente falla sin ciudad' '$LOG'"

echo "== 6. Terminado al archivar"
mkdir -p openspec/changes/archive && mv $C openspec/changes/archive/2026-09-19-fix-guardar-cliente
sync >/dev/null
check "Etapa done con estado 'Hecho'" "grep -q '\"status\":\"Hecho\"' '$LOG'"

echo "== 7. Upsert completo (modo CI) solo a REST y GitHub"
before_hook=$(count '/hook'); sync --upsert-only >/dev/null; after_hook=$(count '/hook')
check "upsert-only no dispara webhook ni Matrix" "[ $before_hook -eq $after_hook ]"

echo "== 8. Export, fetch, status, hooks de git"
node scripts/sn/sn-sync.mjs export --format csv --out items.csv >/dev/null
check "CSV exportado con encabezado y el ítem" "head -1 items.csv | grep -q '^id,type,title,stage' && grep -q 'CLI-0001,bug' items.csv"
check "fetch trae la tarea externa ALT-77" "node scripts/sn/sn-sync.mjs fetch altum ALT-77 | grep -q 'Exportar clientes a Excel'"
check "status lista 4 conectores" "[ \$(node scripts/sn/sn-sync.mjs status | grep -cE 'rest|webhook|matrix|github') -eq 4 ]"
printf '#!/bin/sh\necho hook-previo\n' > .git/hooks/post-commit; chmod +x .git/hooks/post-commit
node scripts/sn/sn-sync.mjs githooks >/dev/null; node scripts/sn/sn-sync.mjs githooks >/dev/null
check "Hook previo se conserva y la línea no se duplica" "grep -q hook-previo .git/hooks/post-commit && [ \$(grep -c softnexus-sync .git/hooks/post-commit) -eq 1 ]"
printf -- '---\nid: CLI-0002\ntype: feature\ntitle: Exportar a Excel\n---\n' > docs/items/CLI-0002.md
git add -A && git commit -qm "nuevo item" >/dev/null; sleep 5
check "Un commit dispara la sync en segundo plano (CLI-0002 llega solo)" "grep -q 'CLI-0002' '$LOG'"

echo "== 9. Proyecto sin conectores = no hace nada"
mv .sn/connectors.json .sn/c.bak; out=$(sync); mv .sn/c.bak .sn/connectors.json
check "Sin configuración, sync es silenciosa" "[ -z \"\$out\" ]"

echo "== 10. GitHub Issues (Orca) y trazabilidad"
check "Un issue por ítem, título [ID], sin duplicados" "py_assert 't=[i[\"title\"] for i in d]; assert any(x.startswith(\"[CLI-0001]\") for x in t) and len(t)==len(set(t)) and len(t)==2, t'"
check "El issue del ítem terminado quedó cerrado" "py_assert 'i=[x for x in d if x[\"title\"].startswith(\"[CLI-0001]\")][0]; assert i[\"state\"]==\"closed\", i[\"state\"]'"
check "Etiquetas de etapa y riesgo en el issue" "gh_state | grep -q 'sn:etapa:done' && gh_state | grep -q 'sn:riesgo:R2'"
echo "codigo" > app.js && git add app.js && git commit -qm "feat(ventas): exportar" -m "Refs: CLI-0002" && sleep 5
check "Un commit con Refs: CLI-0002 queda ligado al ítem (show)" "node scripts/sn/sn-sync.mjs show CLI-0002 | grep -q 'feat(ventas): exportar'"
check "show lista archivos de código tocados" "node scripts/sn/sn-sync.mjs show CLI-0002 | grep -q 'app.js'"
check "El commit nuevo actualizó el issue (cuerpo con el commit)" "gh_state | grep -q 'feat(ventas): exportar'"
check "show del ítem 1 muestra sus firmas" "node scripts/sn/sn-sync.mjs show CLI-0001 | grep -q 'APROBADO'"
check "list muestra tabla con tipo y etapa" "node scripts/sn/sn-sync.mjs list | grep -q '| CLI-0001 | Bug |'"

echo "== El motor del repositorio (copia del CI) frente al del plugin"
export CLAUDE_PLUGIN_ROOT="$PLUGIN/.."
plugmotor() { node "$PLUGIN/sn-sync.mjs" "$@"; }
check "Con la copia igual a la del plugin, motor lo dice" "plugmotor motor | grep -q 'igual que la del plugin'"
echo '// vieja' >> scripts/sn/sync/items.mjs
check "Si la copia quedó atrás, motor nombra los archivos y aclara que la sesión no se ve afectada" "plugmotor motor | grep -q 'sync/items.mjs' && plugmotor motor | grep -q 'los hooks del plugin ya usan el motor del plugin' -i"
check "motor --actualizar deja la copia igual" "plugmotor motor --actualizar | grep -q 'Motor actualizado' && plugmotor motor | grep -q 'igual que la del plugin'"
check "Los hooks ejecutan el motor del PLUGIN, no la copia del repositorio" "! grep -n \"spawn(process.execPath, \\[script\" $PLUGIN/../hooks/*.mjs | grep -q 'scripts/sn/sn-sync' && grep -q 'const script = MOTOR_DEL_PLUGIN' $PLUGIN/../hooks/altum-watch.mjs"
unset CLAUDE_PLUGIN_ROOT

echo "== Windows: clave del sistema y sin ventanas de consola"
cat > "$W/win.mjs" <<'JS'
Object.defineProperty(process, 'platform', { value: 'win32' });
process.env.LOCALAPPDATA = '/tmp/sn-no-existe-jamas';
delete process.env.SN_ALTUM_KEY;
const m = await import(process.env.SN_MOTOR + '/sync/altum.mjs');
const guardar = m.COMO_GUARDARLA;
const sinArchivo = m.fromKeychain('SN_ALTUM_KEY');
console.log(guardar.includes('sn-clave-altum.ps1') && sinArchivo === '' ? 'windows-ok' : `windows-mal ${guardar} ${sinArchivo}`);
JS
check "En Windows la clave se guarda con el asistente .ps1 y, si no está guardada, no revienta" "SN_MOTOR=$PLUGIN node \"$W/win.mjs\" | grep -q windows-ok"
cat > "$W/ventanas.mjs" <<'JS'
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
const archivos = globSync(`${process.env.SN_MOTOR}/*.mjs`).concat(
  globSync(`${process.env.SN_MOTOR}/sync/*.mjs`), globSync(`${process.env.SN_MOTOR}/../hooks/*.mjs`));
const malos = [];
for (const f of archivos) {
  const texto = readFileSync(f, 'utf8');
  for (const m of texto.matchAll(/\b(execFileSync|execSync|spawn)\(/g)) {
    if (!texto.slice(m.index, m.index + 400).includes('windowsHide')) malos.push(`${f}:${m[1]}`);
  }
}
console.log(malos.length ? `sin-hide ${malos.join(' ')}` : 'todos-ocultos');
JS
check "Ningún proceso se lanza sin windowsHide (nada de consolas parpadeando en Windows)" "SN_MOTOR=$PLUGIN node \"$W/ventanas.mjs\" | grep -q todos-ocultos"
check "Los procesos en segundo plano no usan detached fijo (en Windows abriría una consola)" "! grep -rn 'detached: true' $PLUGIN/*.mjs $PLUGIN/sync/*.mjs $PLUGIN/../hooks/*.mjs | grep -q ."

stop_mock
echo; echo "RESULTADO: $pass OK · $fail fallas"
