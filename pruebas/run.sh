#!/usr/bin/env bash
# Prueba de punta a punta del motor sn-sync contra un servidor falso (REST, webhook, Matrix, GitHub Issues).
set -uo pipefail
export SN_MOTOR_PROPIO=1   # las pruebas usan ESTE motor, no el plugin instalado en el computador
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
mkdir -p .husky && printf '#!/bin/sh\nnpx lint-staged\n' > .husky/post-commit && git config core.hooksPath .husky
out=$(node scripts/sn/sn-sync.mjs githooks)
check "Ganchos versionados del equipo (.husky): no se tocan, se dice qué agregar en un PR" "! grep -q softnexus-sync .husky/post-commit && echo \"\$out\" | grep -q 'no los toco por mi cuenta'"
git config --unset core.hooksPath; rm -rf .husky
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

echo "== Avisar cuando el plugin de este computador está viejo"
CASA="$W/casa-falsa"; rm -rf "$CASA"; mkdir -p "$CASA/.claude/plugins"
cat > "$CASA/.claude/sn-version.json" <<JSON
{"at": $(node -e 'console.log(Date.now())'), "ultima": "9.9.9"}
JSON
cat > "$CASA/.claude/plugins/known_marketplaces.json" <<'JSON'
{"softnexus": {"source": {"source": "local", "path": "/Users/alguien/claude-skills/softnexus-sdd-kit"}, "installLocation": "/Users/alguien/claude-skills/softnexus-sdd-kit"}}
JSON
mkdir -p "$W/proyecto-de-otro/.claude"
cat > "$CASA/.claude/plugins/installed_plugins.json" <<JSON
{"version": 2, "plugins": {"softnexus-sdd@softnexus": [
  {"scope": "user", "version": "0.38.1"},
  {"scope": "project", "version": "0.31.0", "projectPath": "$W/proyecto-de-otro"}
]}}
JSON
ver() { HOME="$CASA" W_PROY="${W_PROY:-$W/proyecto-de-otro}" node --input-type=module -e "$1"; }
check "Compara versiones por número, no por texto (0.49.0 > 0.38.1 y 0.10 > 0.9)" "ver \"import {esMasNueva} from '$PLUGIN/sync/version.mjs'; process.exit(esMasNueva('0.49.0','0.38.1') && esMasNueva('0.10','0.9') && !esMasNueva('0.38.1','0.49.0') ? 0 : 1)\""
check "Si el catálogo es una carpeta local, el primer paso es traerla al día con git" "ver \"import {comoActualizar} from '$PLUGIN/sync/version.mjs'; const p=comoActualizar(); process.exit(p[0].startsWith('git -C') && p[0].includes('claude-skills/softnexus-sdd-kit') ? 0 : 1)\""
declara_otra_vez
check "Un solo comando hace todos los pasos: catálogo, usuario y cada proyecto" "W_PROY=\"$W/proyecto-de-otro\" ver \"import {pasosParaActualizar} from '$PLUGIN/sync/version.mjs'; const p=pasosParaActualizar(); const resumen=p.map(x=>x.cmd+' '+x.args.join(' ')).join(' | '); process.exit(p.length===4 && p[0].cmd==='git' && resumen.includes('marketplace update') && p[3].args.includes('--scope') && p[3].cwd===process.env.W_PROY ? 0 : 1)\""
mkdir -p "$W/proy-con-copia/.claude"
cat > "$W/proy-con-copia/.claude/settings.json" <<'JSON'
{"permissions": {"allow": []}, "enabledPlugins": {"softnexus-sdd@softnexus": true, "superpowers@claude-plugins-official": true}}
JSON
cat > "$CASA/.claude.json" <<JSON
{"projects": {"$W/proy-con-copia": {}}}
JSON
check "Encuentra los proyectos que se guardan su propia copia (instalados o declarados)" "ver \"import {proyectosConCopia} from '$PLUGIN/sync/version.mjs'; const p=proyectosConCopia(); process.exit(p.length===2 && p.some(x=>x.endsWith('proy-con-copia')) ? 0 : 1)\""
check "La carpeta del usuario NUNCA se trata como proyecto (en Windows borraba la copia general)" "ver \"import {esCarpetaDelUsuario, dejarDeDeclarar, proyectosConCopia} from '$PLUGIN/sync/version.mjs'; import os from 'node:os'; const casa=os.homedir(); process.exit(esCarpetaDelUsuario(casa) && esCarpetaDelUsuario(casa+'/.claude') && dejarDeDeclarar(casa)===false && !proyectosConCopia([{scope:'project',version:'1',proyecto:casa}]).includes(casa) ? 0 : 1)\""
check "instalar-general deja el plugin encendido al final" "ver \"import {pasosInstalacionGeneral} from '$PLUGIN/sync/version.mjs'; const p=pasosInstalacionGeneral(); process.exit(p[p.length-1].args.includes('enable') ? 0 : 1)\""
declara_otra_vez() { cat > "$W/proy-con-copia/.claude/settings.json" <<'JSON'
{"permissions": {"allow": []}, "enabledPlugins": {"softnexus-sdd@softnexus": true, "superpowers@claude-plugins-official": true}}
JSON
}
declara_otra_vez
check "Un proyecto cuya carpeta ya no existe no se intenta limpiar (ni cuenta como fallo)" "ver \"import {pasosLimpieza, ejecutarPasos} from '$PLUGIN/sync/version.mjs'; const p=pasosLimpieza({installs:[{scope:'project',version:'0.3',proyecto:'/tmp/no-existe-sn-xyz'}]}); const suyos=p.filter(x=>x.nota.includes('no-existe-sn-xyz')); const r=ejecutarPasos(suyos); process.exit(suyos.length===1 && suyos[0].nota.includes('ya no existe') && !suyos.some(x=>x.args) && r.every(x=>x.ok) ? 0 : 1)\""
declara_otra_vez
check "limpiar-copias: desinstala solo las copias instaladas (con su ámbito) y ajusta el settings no versionado que la pide" "ver \"import {pasosLimpieza} from '$PLUGIN/sync/version.mjs'; const p=pasosLimpieza(); const quita=p.filter(x=>x.args&&x.args.includes('uninstall')); const ajusta=p.filter(x=>x.fn&&!x.pendientePr).length; process.exit(quita.length===1 && quita[0].cwd.endsWith('proyecto-de-otro') && ajusta===1 ? 0 : 1)\""
check "instalar-general solo instala o actualiza la copia del computador" "ver \"import {pasosInstalacionGeneral} from '$PLUGIN/sync/version.mjs'; const p=pasosInstalacionGeneral(); const t=p.map(x=>x.args.join(' ')).join('|'); process.exit(!t.includes('uninstall') && t.includes('marketplace update') && /plugin (install|update) softnexus-sdd@softnexus/.test(t) ? 0 : 1)\""
check "Sin copia de usuario, instalar-general instala (no actualiza)" "ver \"import {pasosInstalacionGeneral} from '$PLUGIN/sync/version.mjs'; const p=pasosInstalacionGeneral({installs: []}); process.exit(p.some(x=>x.args.includes('install')) && !p.some(x=>x.args.includes('update') && x.args.includes('softnexus-sdd@softnexus')) ? 0 : 1)\""
declara_otra_vez
check "El comando general quita cada copia, ajusta solo lo no versionado y deja la de usuario al día" "W_PROY=\"$W/proyecto-de-otro\" ver \"import {pasosGenerales} from '$PLUGIN/sync/version.mjs'; const p=pasosGenerales(); const quita=p.filter(x=>x.args && x.args.includes('uninstall')).length; const ajusta=p.filter(x=>x.fn&&!x.pendientePr).length; const pasos=p.map(x=>x.args?x.args.join(' '):'ajuste'); process.exit(quita===1 && ajusta===1 && pasos.includes('plugin update softnexus-sdd@softnexus') ? 0 : 1)\""
declara_otra_vez
rm -rf "$W/repo-versionado" && mkdir -p "$W/repo-versionado/.claude" && (cd "$W/repo-versionado" && git init -q && printf '{"enabledPlugins": {"softnexus-sdd@softnexus": true}}\n' > .claude/settings.json && git add .claude/settings.json && git -c user.name=t -c user.email=t@x commit -qm base)
cat > "$CASA/.claude.json" <<JSON
{"projects": {"$W/proy-con-copia": {}, "$W/repo-versionado": {}}}
JSON
declara_otra_vez
check "Un .claude/settings.json VERSIONADO nunca se edita: se reporta para un PR" "ver \"import {pasosLimpieza, ejecutarPasos} from '$PLUGIN/sync/version.mjs'; import {readFileSync} from 'node:fs'; const antes=readFileSync('$W/repo-versionado/.claude/settings.json','utf8'); const p=pasosLimpieza().filter(x=>x.fn); ejecutarPasos(p); const despues=readFileSync('$W/repo-versionado/.claude/settings.json','utf8'); process.exit(antes===despues && p.some(x=>x.pendientePr && x.pendientePr.endsWith('repo-versionado')) ? 0 : 1)\""
check "Sin git en el PATH, un settings.json que SÍ está versionado se trata como del equipo (CRÍTICO: antes se podía editar en silencio)" "ver \"import {estaVersionado} from '$PLUGIN/sync/version.mjs'; process.exit(estaVersionado('$W/repo-versionado/.claude/settings.json')===true ? 0 : 1)\""
check "estaVersionado sin poder preguntar (sin git) da null, nunca false (false sería \"se puede editar\")" "ver \"process.env.PATH='/no/existe/git'; import {estaVersionado} from '$PLUGIN/sync/version.mjs'; process.exit(estaVersionado('$W/repo-versionado/.claude/settings.json')===null ? 0 : 1)\""
check "pasosLimpieza trata ese \"no se pudo preguntar\" como versionado: no corre uninstall --scope project" "ver \"process.env.PATH='/no/existe/git'; import {pasosLimpieza} from '$PLUGIN/sync/version.mjs'; const p=pasosLimpieza({installs:[{scope:'project',version:'0.3',proyecto:'$W/repo-versionado'}]}).filter(x=>x.nota.includes('repo-versionado')); process.exit(!p.some(x=>x.args) && p.some(x=>x.pendientePr) ? 0 : 1)\""
check "Copia de proyecto en un repo con settings VERSIONADO: no se corre \"uninstall --scope project\" (claude editaría ese archivo)" "ver \"import {pasosLimpieza} from '$PLUGIN/sync/version.mjs'; const p=pasosLimpieza({installs:[{scope:'project',version:'0.3',proyecto:'$W/repo-versionado'}]}).filter(x=>x.nota.includes('repo-versionado')); process.exit(!p.some(x=>x.args) && p.some(x=>x.pendientePr) ? 0 : 1)\""
check "Copias project y local en la misma carpeta: se quitan las dos, cada una con su ámbito" "ver \"import {pasosLimpieza} from '$PLUGIN/sync/version.mjs'; const p=pasosLimpieza({installs:[{scope:'project',version:'0.3',proyecto:'$W/proyecto-de-otro'},{scope:'local',version:'0.3',proyecto:'$W/proyecto-de-otro/'}]}).filter(x=>x.args); const a=p.map(x=>x.args[x.args.length-1]).sort().join(','); process.exit(a==='local,project' ? 0 : 1)\""
check "Y el repo no queda con cambios sin guardar" "[ -z \"\$(git -C \"$W/repo-versionado\" status --porcelain)\" ]"
cat > "$CASA/.claude.json" <<JSON
{"projects": {"$W/proy-con-copia": {}}}
JSON
declara_otra_vez
check "Deja de declararlo en el proyecto, sin tocar lo demás del archivo" "ver \"import {dejarDeDeclarar, declaraElPlugin} from '$PLUGIN/sync/version.mjs'; import {readFileSync} from 'node:fs'; const c='$W/proy-con-copia'; const cambio=dejarDeDeclarar(c); const d=JSON.parse(readFileSync(c+'/.claude/settings.json','utf8')); process.exit(cambio && !declaraElPlugin(c) && d.enabledPlugins['superpowers@claude-plugins-official'] && d.permissions ? 0 : 1)\""
check "Si un paso falla, los demás se siguen corriendo" "ver \"import {pasosParaActualizar, ejecutarPasos} from '$PLUGIN/sync/version.mjs'; let n=0; const r=ejecutarPasos(pasosParaActualizar(), { correr: (p) => { n+=1; if (n===1) throw new Error('carpeta borrada'); } }); process.exit(n===4 && r.filter(x=>x.ok).length===3 ? 0 : 1)\""
check "Las copias de OTROS proyectos no estorban en esta sesión" "ver \"import {instalacionesDeAqui} from '$PLUGIN/sync/version.mjs'; const i=instalacionesDeAqui('/tmp/otra-carpeta'); process.exit(i.length===1 && i[0].scope==='user' ? 0 : 1)\""
check "La copia del proyecto abierto sí cuenta" "W_PROY=\"$W/proyecto-de-otro\" ver \"import {instalacionesDeAqui} from '$PLUGIN/sync/version.mjs'; const i=instalacionesDeAqui(process.env.W_PROY+'/sub'); process.exit(i.length===2 ? 0 : 1)\""
out=$(HOME="$CASA" printf '{"hook_event_name":"SessionStart","cwd":"%s"}' "$W" | HOME="$CASA" node "$PLUGIN/../hooks/altum-watch.mjs" 2>/dev/null)
check "Al abrir sesión con una versión vieja, el aviso lo dice y manda al comando que da los pasos" "echo \"\$out\" | grep -q 'la última publicada es 9.9.9' && echo \"\$out\" | grep -q 'catálogo es una carpeta local' && echo \"\$out\" | grep -q 'actualizar'"
cat > "$CASA/.claude/sn-version.json" <<JSON
{"at": $(node -e 'console.log(Date.now())'), "ultima": "0.0.1"}
JSON
out2=$(HOME="$CASA" printf '{"hook_event_name":"SessionStart","cwd":"%s"}' "$W" | HOME="$CASA" node "$PLUGIN/../hooks/altum-watch.mjs" 2>/dev/null)
check "Y si está al día, no dice nada de versiones (no molesta)" "! echo \"\$out2\" | grep -q 'última publicada'"

cat > "$W/comillas.mjs" <<'JS'
const { entrecomillar } = await import(process.env.SN_VERSION_MJS);
const conEspacios = 'C:\\Mis Proyectos\\x';
console.log(entrecomillar(conEspacios) === `"${conEspacios}"` && entrecomillar('--scope') === '--scope' ? 'comillas-ok' : 'comillas-mal');
JS
check "\"Ya estaba encendido\" o \"no estaba instalado\" NO cuentan como fallo" "ver \"import {esBenigno} from '$PLUGIN/sync/version.mjs'; const si=['Plugin x is already enabled at user scope','is installed in user scope, not project']; const no=['Command failed: claude plugin update x','spawnSync claude.cmd EINVAL']; process.exit(si.every(esBenigno) && !no.some(esBenigno) ? 0 : 1)\""
cat > "$W/salida-normal.mjs" <<'JS'
const { ejecutarPasos } = await import(process.env.SN_VERSION_MJS);
// claude escribe sus mensajes por la salida NORMAL, no por la de errores
const ok = ejecutarPasos([{ cmd: 'sh', que: 'enable', args: ['-c', 'echo "Failed: is already enabled at user scope"; exit 1'], opcional: true, nota: 'x' }]);
const malo = ejecutarPasos([{ cmd: 'sh', args: ['-c', 'echo "Failed: disco lleno"; exit 1'], nota: 'y' }]);
console.log(ok[0].ok && ok[0].yaEstaba && !malo[0].ok && malo[0].motivo.includes('disco lleno') ? 'salida-ok' : 'salida-mal');
JS
cat > "$W/motivo.mjs" <<'JS'
const { ejecutarPasos } = await import(process.env.SN_VERSION_MJS);
// el fallo real viene anidado (un comando nuestro que por dentro corre otro)
const r = ejecutarPasos([{ cmd: 'sh', args: ['-c', 'echo "   ✗ NO SE PUDO: ✘ Failed to uninstall: permiso denegado"; exit 1'], nota: 'limpiar-copias' }]);
console.log(r[0].motivo === '✘ Failed to uninstall: permiso denegado' ? 'motivo-ok' : `motivo-mal: ${r[0].motivo}`);
JS
mkdir -p "$W/con tildes ñ/scripts"
cp -R "$PLUGIN/validation-state.mjs" "$PLUGIN/sync" "$W/con tildes ñ/scripts/"
check "Una ruta con tildes o espacios no rompe los comandos (se decodifica bien)" "(cd \"$W/con tildes ñ\" && node scripts/validation-state.mjs | grep -q '^\\[')"
cat > "$W/ambito.mjs" <<'JS'
const { ejecutarPasos, ambitoQuePide } = await import(process.env.SN_VERSION_MJS);
const intentos = [];
const r = ejecutarPasos([{ cmd: 'claude', args: ['plugin', 'uninstall', 'x', '--scope', 'project'], cwd: '/tmp', opcional: true, nota: 'quitar' }], {
  correr: (p) => {
    intentos.push(p.args.join(' '));
    if (p.args.includes('project')) { const e = new Error('falló'); e.todo = 'Plugin is installed in local scope, not project'; throw e; }
  },
});
const bien = ambitoQuePide('is installed in local scope, not project') === 'local'
  && intentos.length === 2 && intentos[1].includes('--scope local') && r.every((x) => x.ok);
console.log(bien ? 'ambito-ok' : `ambito-mal ${JSON.stringify(intentos)}`);
JS
check "Si la copia es de ámbito local, se desinstala con ese ámbito (no se da por fallida)" "SN_VERSION_MJS='$PLUGIN/sync/version.mjs' node \"$W/ambito.mjs\" 2>/dev/null | grep -q ambito-ok"
check "Solo se refresca NUESTRO catálogo (si otro ajeno falla, no es problema nuestro)" "ver \"import {pasosInstalacionGeneral} from '$PLUGIN/sync/version.mjs'; const p=pasosInstalacionGeneral(); const m=p.find(x=>x.args && x.args.includes('marketplace')); process.exit(m && m.args[m.args.length-1]==='softnexus' ? 0 : 1)\""
check "\"No está instalado\" es lo que se quería al desinstalar, pero al ACTUALIZAR es un fallo; y que no exista claude (ENOENT) nunca es \"ya estaba\"" "ver \"import {esBenigno} from '$PLUGIN/sync/version.mjs'; const u={cmd:'claude',args:['plugin','uninstall']}; const up={cmd:'claude',args:['plugin','update']}; process.exit(esBenigno('Plugin is not installed', u) && !esBenigno('Plugin is not installed at scope user', up) && !esBenigno('spawn claude ENOENT', up) && !esBenigno('spawn claude ENOENT') ? 0 : 1)\""
check "Y si aun así se queja de otros catálogos, no cuenta como fallo" "ver \"import {esBenigno} from '$PLUGIN/sync/version.mjs'; process.exit(esBenigno('✘ Updated 11 marketplaces, but not all') ? 0 : 1)\""
check "El script muestra el MOTIVO y guarda todo en un archivo" "grep -q 'MOTIVO' \"$T/../herramientas/plugin-general.sh\" && grep -q 'BITACORA' \"$T/../herramientas/plugin-general.sh\""
check "El motivo de verdad sube al resumen, no el genérico \"Command failed\"" "SN_VERSION_MJS='$PLUGIN/sync/version.mjs' node \"$W/motivo.mjs\" 2>/dev/null | grep -q motivo-ok"
check "Lo que el comando dice por la salida normal también cuenta para saber si fue un fallo" "SN_VERSION_MJS='$PLUGIN/sync/version.mjs' node \"$W/salida-normal.mjs\" 2>/dev/null | grep -q salida-ok"
check "Un paso que termina en \"ya estaba\" se cuenta como hecho" "ver \"import {ejecutarPasos} from '$PLUGIN/sync/version.mjs'; const r=ejecutarPasos([{cmd:'claude',args:['plugin','enable'],opcional:true,nota:'x'}], { correr: () => { const e=new Error('Failed to enable plugin: Plugin is already enabled at user scope'); throw e; } }); process.exit(r[0].ok && r[0].yaEstaba ? 0 : 1)\""
check "El script tampoco lo cuenta como fallo" "grep -q 'already enabled' \"$T/../herramientas/plugin-general.sh\""
check "Una ruta que termina en barra no se come la comilla de cierre en cmd.exe" "ver \"import {entrecomillar} from '$PLUGIN/sync/version.mjs'; process.exit(entrecomillar('C:\\\\\\\\Mis Proyectos\\\\\\\\')==='\\\"C:\\\\\\\\Mis Proyectos\\\\\\\\\\\\\\\\\\\"' ? 0 : 1)\""
check "Los pasos para Windows se pueden pegar en PowerShell (sin &&)" "ver \"import {comoActualizar} from '$PLUGIN/sync/version.mjs'; const p=comoActualizar({cat:{tipo:'github'},installs:[{scope:'user',version:'1'},{scope:'project',version:'1',proyecto:'$W/proyecto-de-otro'}]},'win32'); process.exit(p.some(l=>l.startsWith('cd \\\"$W/proyecto-de-otro\\\"; claude')) && !p.some(l=>l.includes('&&')) ? 0 : 1)\""
check "En Windows los argumentos se entrecomillan: una ruta con espacios no parte el comando" "SN_VERSION_MJS='$PLUGIN/sync/version.mjs' node \"$W/comillas.mjs\" | grep -q comillas-ok"
HOME="$CASA" node "$PLUGIN/sn-sync.mjs" actualizar --general >"$W/salida-general.txt" 2>&1; codigo=$?
check "Si un paso falla, el comando sale con error, lo dice y no invita a reiniciar como si nada" "[ \$codigo -ne 0 ] && grep -q 'NO SE PUDO' \"$W/salida-general.txt\" && grep -q 'ATENCIÓN' \"$W/salida-general.txt\" && ! grep -q 'AHORA SÍ' \"$W/salida-general.txt\""
# El script de verdad, con un "claude" falso que anota lo que le piden.
FALSO="$W/claude-falso"; rm -rf "$FALSO"; mkdir -p "$FALSO/bin" "$FALSO/casa/.claude/plugins"
cat > "$FALSO/bin/claude" <<'SH'
#!/bin/sh
echo "$*" >> "$FALSO_LOG"
case "$*" in
  "plugin marketplace list") echo "softnexus" ;;
  "plugin update softnexus-sdd@softnexus") [ -n "$FALLA_UPDATE" ] && { echo "✘ Plugin softnexus-sdd@softnexus is not installed at scope user"; exit 1; } ;;
esac
exit 0
SH
chmod +x "$FALSO/bin/claude"
printf '{"plugins":{"softnexus-sdd@softnexus":[{"scope":"project","version":"0.3","projectPath":"/x"}]}}' > "$FALSO/casa/.claude/plugins/installed_plugins.json"
FALSO_LOG="$FALSO/log" HOME="$FALSO/casa" TMPDIR="$FALSO" PATH="$FALSO/bin:$PATH" bash "$T/../herramientas/plugin-general.sh" >/dev/null 2>&1; codigo=$?
check "Solo con copias de proyecto (sin la general), el script INSTALA la general, no intenta actualizarla" "grep -qx 'plugin install softnexus-sdd@softnexus' '$FALSO/log' && ! grep -q '^plugin update' '$FALSO/log' && [ $codigo -eq 0 ]"
printf '{"plugins":{"softnexus-sdd@softnexus":[{"scope":"user","version":"0.3","installPath":"/no/existe"}]}}' > "$FALSO/casa/.claude/plugins/installed_plugins.json"
: > "$FALSO/log"; FALLA_UPDATE=1 FALSO_LOG="$FALSO/log" HOME="$FALSO/casa" TMPDIR="$FALSO" PATH="$FALSO/bin:$PATH" bash "$T/../herramientas/plugin-general.sh" >"$FALSO/salida" 2>&1; codigo=$?
check "Si actualizar falla con \"no está instalado\", es un fallo de verdad: lo dice con el motivo y sale con error" "[ $codigo -eq 1 ] && grep -q 'MOTIVO: ✘ Plugin softnexus-sdd@softnexus is not installed at scope user' '$FALSO/salida'"
check "El script tampoco esconde errores: cuenta los fallos y sale con error" "grep -q 'fallos + 1' \"$T/../herramientas/plugin-general.sh\" && grep -q 'exit 1' \"$T/../herramientas/plugin-general.sh\""

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

echo "== La copia del motor del repositorio (la del CI) se instala con su versión"
rm -rf "$W/nuevo-repo"; mkdir -p "$W/nuevo-repo" && (cd "$W/nuevo-repo" && git init -q)
check "motor sin la copia dice cómo instalarla" "(cd '$W/nuevo-repo' && CLAUDE_PLUGIN_ROOT='$PLUGIN/..' node '$PLUGIN/sn-sync.mjs' motor) | grep -q 'motor --actualizar'"
check "motor --actualizar la instala y anota de qué versión salió" "(cd '$W/nuevo-repo' && CLAUDE_PLUGIN_ROOT='$PLUGIN/..' node '$PLUGIN/sn-sync.mjs' motor --actualizar) >/dev/null && [ -f '$W/nuevo-repo/scripts/sn/sn-sync.mjs' ] && [ -f '$W/nuevo-repo/scripts/sn/sync/altum.mjs' ] && grep -qE '^[0-9]+\.[0-9]+' '$W/nuevo-repo/scripts/sn/.version'"

echo "== La copia del motor en el repositorio cede al plugin del computador"
CASA="$W/casa-falsa"; rm -rf "$CASA"; mkdir -p "$CASA/.claude/plugins" "$CASA/plug/scripts" "$CASA/plug/.claude-plugin"
echo '{"version":"9.9.9"}' > "$CASA/plug/.claude-plugin/plugin.json"
printf 'console.log("MOTOR DEL PLUGIN " + process.argv.slice(2).join(" "))\n' > "$CASA/plug/scripts/sn-sync.mjs"
printf '{"plugins":{"softnexus-sdd@softnexus":[{"scope":"user","installPath":"%s","version":"9.9.9"}]}}' "$CASA/plug" > "$CASA/.claude/plugins/installed_plugins.json"
cd "$W/repo"
check "Con el plugin general instalado, la copia del repositorio le pasa el trabajo (rama vieja = motor viejo)" "env -u SN_MOTOR_PROPIO HOME='$CASA' node scripts/sn/sn-sync.mjs status | grep -q 'MOTOR DEL PLUGIN status'"
echo 99.0.0 > scripts/sn/.version
check "Si la copia del repositorio es más nueva que el plugin, manda la copia" "env -u SN_MOTOR_PROPIO HOME='$CASA' node scripts/sn/sn-sync.mjs status | grep -q '^Proyecto:'"
rm -f scripts/sn/.version
check "Sin plugin instalado (el CI), sigue la copia del repositorio" "env -u SN_MOTOR_PROPIO HOME='$W/sin-casa' node scripts/sn/sn-sync.mjs status | grep -q '^Proyecto:'"

echo "== El orden de actualizar --general: primero instala, y si eso falla no toca los proyectos"
FALSO2="$W/claude-falso2"; rm -rf "$FALSO2"; mkdir -p "$FALSO2/bin" "$FALSO2/casa/.claude/plugins"
cp "$FALSO/bin/claude" "$FALSO2/bin/claude"
mkdir -p "$W/proyecto-con-copia2/.claude"
printf '{"plugins":{"softnexus-sdd@softnexus":[{"scope":"user","version":"0.3"},{"scope":"project","version":"0.3","projectPath":"$W/proyecto-con-copia2"}]}}' > "$FALSO2/casa/.claude/plugins/installed_plugins.json"
FALSO_LOG="$FALSO2/log" FALLA_UPDATE=1 HOME="$FALSO2/casa" TMPDIR="$FALSO2" PATH="$FALSO2/bin:$PATH" bash "$T/../herramientas/plugin-general.sh" >"$FALSO2/salida" 2>&1; codigo=$?
check "Si la copia general no se pudo poner al día, NO se intenta quitar la copia del proyecto (quedaría sin ningún plugin)" "[ $codigo -eq 1 ] && ! grep -q 'uninstall' '$FALSO2/log'"

check "esBenigno: \"not found\" SUELTO (catálogo desregistrado) es un fallo real al desinstalar, no \"ya estaba así\"" "ver \"import {esBenigno} from '$PLUGIN/sync/version.mjs'; const u={cmd:'claude',args:['plugin','uninstall']}; process.exit(!esBenigno('✘ Marketplace softnexus not found', u) ? 0 : 1)\""

check "pasosGenerales instala/actualiza la general ANTES de limpiar los proyectos (si falla, no deja el computador sin nada)" "ver \"import {pasosGenerales} from '$PLUGIN/sync/version.mjs'; const p=pasosGenerales({installs:[{scope:'project',version:'0.3',proyecto:'$W/proyecto-de-otro'}]}); const iu=p.findIndex(x=>x.args && (x.args[1]==='install'||x.args[1]==='update')); const un=p.findIndex(x=>x.args && x.args[1]==='uninstall'); process.exit(iu>=0 && un>=0 && iu<un ? 0 : 1)\""

check "pasosParaActualizar instala la copia de usuario si no existía (antes siempre intentaba \"update\", que falla)" "ver \"import {pasosParaActualizar} from '$PLUGIN/sync/version.mjs'; const p=pasosParaActualizar({installs:[]}); process.exit(p.some(x=>x.args && x.args[1]==='install') ? 0 : 1)\""

check "pasosParaActualizar salta un proyecto cuya carpeta ya no existe (no lo cuenta como fallo cada vez)" "ver \"import {pasosParaActualizar} from '$PLUGIN/sync/version.mjs'; const p=pasosParaActualizar({installs:[{scope:'user',version:'1'},{scope:'project',version:'0.3',proyecto:'/tmp/no-existe-sn-abc'}]}); const suyo=p.find(x=>x.nota && x.nota.includes('no-existe-sn-abc')); process.exit(suyo && suyo.fn && !suyo.args ? 0 : 1)\""

check "Sin \"node\" en el PATH, el script lo dice y sale con error (antes se saltaba pasos en silencio y decía \"Listo\")" "out=\$(PATH='/usr/bin:/bin' bash '$T/../herramientas/plugin-general.sh' 2>&1); codigo=\$?; [ \$codigo -eq 1 ] && echo \"\$out\" | grep -qi 'node' && ! echo \"\$out\" | grep -q 'Listo'"

stop_mock
echo; echo "RESULTADO: $pass OK · $fail fallas"
