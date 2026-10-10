#!/usr/bin/env bash
# Rieles del proceso: siguiente paso determinista, candado del PR sin sello, dividir un plano,
# y que la firma propia de un plano R0–R2 siga valiendo.
set -uo pipefail
export SN_MOTOR_PROPIO=1   # las pruebas usan ESTE motor, no el plugin instalado en el computador
T="$(cd "$(dirname "$0")" && pwd)"
W="$T/tmp"; mkdir -p "$W"   # todo lo que la prueba crea vive aquí (no se versiona)
PLUGIN="$(cd "$T/../plugin" && pwd)"
export SN_SYNC_NO_GH=1
pass=0; fail=0
check() { if eval "$2"; then echo "OK    $1"; pass=$((pass+1)); else echo "FALLA $1"; fail=$((fail+1)); fi; }
rm -rf "$W/proc-repo"; mkdir -p "$W/proc-repo" && cd "$W/proc-repo"
git init -q -b main && git config user.name "Laura" && git config user.email laura@x
mkdir -p scripts/sn docs/items openspec/changes/add-saldo/specs
cp -R "$PLUGIN/scripts/sn-sync.mjs" "$PLUGIN/scripts/validation-state.mjs" "$PLUGIN/scripts/sync" scripts/sn/
sn() { node scripts/sn/sn-sync.mjs "$@"; }
guard() { printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"%s"}}' "$PWD" "$1" | node "$PLUGIN/hooks/guard.mjs" >/dev/null 2>"$W/guard.err"; }
git checkout -q -b feat/SAL-1-saldo
printf -- '---\nid: SAL-1\ntype: feature\ntitle: Ver saldo\nrisk: R1\nbranch: feat/SAL-1-saldo\nchange: add-saldo\n---\n## Historia\nx\n## Criterios\n- Dado x, cuando y, entonces z\n' > docs/items/SAL-1.md
echo "Qué" > openspec/changes/add-saldo/proposal.md
printf -- '- [ ] 1.1 test\n- [ ] 1.2 código\n- [ ] 1.3 estilos\n- [ ] 1.4 textos\n' > openspec/changes/add-saldo/tasks.md
git add -A && git commit -qm plano

echo "== Siguiente paso y sellos"
check "Plano escrito sin aprobar: el siguiente paso es el SELLO 1" "sn siguiente | grep -q 'SELLO 1'"
guard "gh pr create --fill"; code=$?
check "El guard NO deja abrir el PR sin el sello 1 del plano" "[ $code -eq 2 ] && grep -q 'no tiene su sello 1' '$W/guard.err'"
guard "git status"; check "Otros comandos no se bloquean" "[ \$? -eq 0 ]"
H=$(git rev-parse --short HEAD)
printf -- "## 2026-09-21 10:00 · APROBADO · sello: plano\n- Valida: Laura <laura@x>\n- Commit validado: %s\n" "$H" > openspec/changes/add-saldo/validacion.md
git add -A && git commit -qm aprobado
mkdir -p .sn/state && node -e 'require("fs").writeFileSync(".sn/state/altum-lider.json", JSON.stringify({at: Date.now(), name: "Marta Ríos", email: "marta@softnexus.co", github: "martarios"}))'
# El candado de "solo el líder une el PR" es de los proyectos unidos a Altum: por eso el conector.
printf '{"project":"saldo","connectors":[{"name":"altum","kind":"altum","base_url":"http://127.0.0.1:9/api","project_id":"p1","key_env":"SN_CLAVE_QUE_NO_EXISTE","events":["sn.item.*"]}]}' > .sn/connectors.json
check "Plano R1 aprobado por la propia persona: SÍ cuenta (no hace falta el líder en R0–R2)" "sn siguiente | grep -q 'Plano aprobado'"
sed -i '' 's/^risk: R1/risk: R3/' docs/items/SAL-1.md
check "El mismo plano pero R3 firmado por la persona: NO cuenta (lo firma el líder)" "sn siguiente | grep -q 'no es el líder'"
sed -i '' 's/^risk: R3/risk: R1/' docs/items/SAL-1.md

echo "== Dividir un plano a mitad de camino"
printf -- '- [x] 1.1 test\n- [x] 1.2 código\n- [ ] 1.3 estilos\n- [ ] 1.4 textos\n' > openspec/changes/add-saldo/tasks.md
check "Construyendo: el siguiente paso dice cuántas van y que se puede dividir" "sn siguiente | grep -q 'Construyendo (2/4)' && sn siguiente | grep -q 'dividir'"
guard "gh pr create --fill"; code=$?
check "El guard NO deja abrir el PR sin evidencia" "[ $code -eq 2 ] && grep -q 'evidencia' '$W/guard.err'"
out=$(sn dividir SAL-1)
NUEVO=$(ls docs/items | grep -v SAL-1.md | sed 's/.md$//')
check "dividir deja el plano con las 2 hechas y pasa las 2 pendientes a un ítem nuevo" "echo \"\$out\" | grep -q '2 tareas hechas' && ! grep -q '\\[ \\]' openspec/changes/add-saldo/tasks.md && grep -q 'estilos' docs/items/\$NUEVO.md && grep -q 'textos' docs/items/\$NUEVO.md"
check "El ítem nuevo queda enlazado al original (parent) y con el mismo riesgo" "grep -q '^parent: SAL-1' docs/items/\$NUEVO.md && grep -q '^risk: R1' docs/items/\$NUEVO.md"
check "El plano original queda completo: el siguiente paso es la evidencia" "sn siguiente SAL-1 | grep -q 'Construido'"
echo ok > openspec/changes/add-saldo/evidencia.md
guard "gh pr create --fill"; code=$?
check "Con sello 1 y evidencia, el PR sí se puede abrir" "[ $code -eq 0 ]"
mv openspec/changes/add-saldo/validacion.md "$W/validacion.bak"
guard "gh pr create --fill"; code=$?
check "Construido y con evidencia pero el plano NUNCA tuvo sello 1: el PR no se abre (marcar tareas no reemplaza la firma)" "[ $code -eq 2 ] && grep -q 'nunca tuvo su sello 1' '$W/guard.err'"
sed -i '' 's/^risk: R1/risk: R3/' docs/items/SAL-1.md
printf -- "## 2026-09-21 10:00 · APROBADO · sello: plano\n- Valida: Laura <laura@x>\n- Commit validado: %s\n" "$H" > openspec/changes/add-saldo/validacion.md
guard "gh pr create --fill"; code=$?
check "R3 con el plano firmado por quien NO es el líder: tampoco" "[ $code -eq 2 ]"
sed -i '' 's/^risk: R3/risk: R1/' docs/items/SAL-1.md; mv "$W/validacion.bak" openspec/changes/add-saldo/validacion.md

echo "== Recordatorio en cada mensaje"
out=$(printf '{"hook_event_name":"UserPromptSubmit","cwd":"%s"}' "$PWD" | SN_SYNC_NO_GH=1 node "$PLUGIN/hooks/proceso.mjs")
check "Cada mensaje trae el formato corto y el paso exacto del ítem de la rama" "echo \"\$out\" | grep -q 'Máximo 6 líneas' && echo \"\$out\" | grep -q 'SAL-1' && echo \"\$out\" | grep -q 'Siguiente según el proceso'"

echo "== CI sin la clave de la empresa: avisa, no falla"
run_de() { python3 -c "import yaml,sys; d=yaml.safe_load(open(sys.argv[1])); j=list(d['jobs'].values())[0]; print([s['run'] for s in j['steps'] if 'run' in s][-1])" "$1"; }
for wf in sn-sync firma-lider; do
  script=$(run_de "$PLUGIN/plantillas/.github/workflows/$wf.yml")
  out=$(env -u SN_ALTUM_KEY bash -c "$script" 2>&1); code=$?
  check "$wf.yml sin la clave: termina bien (sin cruz roja) y avisa que la configura el líder" "[ $code -eq 0 ] && echo \"\$out\" | grep -q 'configura el líder'"
done

echo "== El código de un PR sin aprobar nunca decide nada"
wf() { python3 -c "import yaml,sys,json; d=yaml.safe_load(open(sys.argv[1])); print(json.dumps(d, default=str))" "$PLUGIN/plantillas/$1"; }
check "sn-sync.yml solo corre al unir a la rama principal (nunca con la rama de un PR ni la clave de la empresa)" "wf .github/workflows/sn-sync.yml | python3 -c 'import json,sys; d=json.load(sys.stdin); on=d.get(\"on\", d.get(\"true\")); assert list(on)==[\"push\"], on; assert \"ref\" not in json.dumps(d[\"jobs\"]), d'"
check "firma-lider.yml verifica con el motor y la conexión de la rama principal (pull_request_target + base)" "wf .github/workflows/firma-lider.yml | python3 -c 'import json,sys; d=json.load(sys.stdin); on=d.get(\"on\", d.get(\"true\")); assert \"pull_request_target\" in on and \"pull_request\" not in on, on; assert \"pull_request.base.sha\" in json.dumps(d[\"jobs\"])'"
check "Azure: la firma usa el motor de la rama destino y la sincronización solo corre en la principal" "grep -q 'git checkout -q FETCH_HEAD -- scripts/sn .sn/connectors.json' '$PLUGIN/plantillas/azure/azure-pipelines-sn.yml' && grep -q \"in(variables\\['Build.SourceBranch'\\], 'refs/heads/main'\" '$PLUGIN/plantillas/azure/azure-pipelines-sn.yml'"

echo "== El aviso de cada mensaje: solo en proyectos Softnexus y sin esperar a GitHub"
proc() { printf '{"hook_event_name":"UserPromptSubmit","cwd":"%s"}' "$1" | env -u SN_SYNC_NO_GH node "$PLUGIN/hooks/proceso.mjs"; }
mkdir -p "$W/gh-lento" && printf '#!/bin/sh\necho "gh fue llamado" >> "$W/gh-llamado.txt"\nexit 1\n' > "$W/gh-lento/gh" && chmod +x "$W/gh-lento/gh"
: > "$W/gh-llamado.txt"
out=$(PATH="$W/gh-lento:$PATH" proc "$PWD")
check "En un proyecto Softnexus sí se recuerda el paso del proceso" "echo \"\$out\" | grep -q 'SAL-1'"
check "Y NO se le pregunta a GitHub en cada mensaje (eso hacía esperar antes de cada respuesta)" "[ ! -s \"$W/gh-llamado.txt\" ]"
rm -rf "$W/ajeno"; mkdir -p "$W/ajeno" && printf -- '# Instrucciones del repo\nUsa pnpm.\n' > "$W/ajeno/AGENTS.md"
check "Una carpeta ajena con AGENTS.md (lo tienen muchos repos) NO recibe el aviso del proceso" "[ -z \"$(proc \"$W/ajeno\")\" ]"
printf -- '# Proyecto\nTrabajamos con la metodología Spec Driven de Softnexus.\n' > "$W/ajeno/AGENTS.md"
check "Pero un AGENTS.md que dice que el proyecto es Spec Driven sí" "proc \"$W/ajeno\" | grep -q 'formato de respuesta'"

echo "== Solo el líder une el PR"
mkdir -p "$W/gh-quien" && printf '#!/bin/sh\n[ "$1 $2" = "api user" ] && echo "${QUIEN}"\n' > "$W/gh-quien/gh" && chmod +x "$W/gh-quien/gh"
printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"gh pr merge 7 --merge"}}' "$PWD" | PATH="$W/gh-quien:$PATH" QUIEN=laura node "$PLUGIN/hooks/guard.mjs" >/dev/null 2>"$W/guard.err"; code=$?
check "Alguien que no es el líder intenta unir el PR: bloqueado, con el nombre del líder" "[ $code -eq 2 ] && grep -q 'Solo el líder del proyecto (Marta Ríos, @martarios) une el PR' '$W/guard.err'"
printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"gh pr merge 7 --merge"}}' "$PWD" | PATH="$W/gh-quien:$PATH" QUIEN=martarios node "$PLUGIN/hooks/guard.mjs" >/dev/null 2>&1; code=$?
check "El líder de Altum sí puede unirlo" "[ $code -eq 0 ]"

# Falla CERRADO: si no se puede confirmar quién es quién, no se une (antes pasaba cualquiera).
mkdir -p "$W/gh-sin-sesion" && printf '#!/bin/sh\nexit 1\n' > "$W/gh-sin-sesion/gh" && chmod +x "$W/gh-sin-sesion/gh"
printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"gh pr merge 7 --merge"}}' "$PWD" | PATH="$W/gh-sin-sesion:$PATH" node "$PLUGIN/hooks/guard.mjs" >/dev/null 2>"$W/guard.err"; code=$?
check "Sin sesión de gh no se puede saber quién eres: NO se une, y se dice cómo arreglarlo" "[ $code -eq 2 ] && grep -q 'gh auth status' '$W/guard.err'"
mv .sn/state/altum-lider.json "$W/lider.bak"
printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"gh pr merge 7 --merge"}}' "$PWD" | PATH="$W/gh-quien:$PATH" QUIEN=laura node "$PLUGIN/hooks/guard.mjs" >/dev/null 2>"$W/guard.err"; code=$?
check "Sin poder preguntarle a Altum quién es el líder: NO se une" "[ $code -eq 2 ] && grep -q 'quién es el líder' '$W/guard.err'"
node -e 'require("fs").writeFileSync(".sn/state/altum-lider.json", JSON.stringify({at: Date.now(), name: "Marta Ríos", email: "marta@softnexus.co"}))'
printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"gh pr merge 7 --merge"}}' "$PWD" | PATH="$W/gh-quien:$PATH" QUIEN=laura node "$PLUGIN/hooks/guard.mjs" >/dev/null 2>"$W/guard.err"; code=$?
check "Líder sin usuario de GitHub en Altum: NO se une y se dice que lo registre" "[ $code -eq 2 ] && grep -q 'registre en Altum' '$W/guard.err'"
mv "$W/lider.bak" .sn/state/altum-lider.json
printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"gh api repos/x/y/pulls/7/merge -X PUT"}}' "$PWD" | PATH="$W/gh-quien:$PATH" QUIEN=laura node "$PLUGIN/hooks/guard.mjs" >/dev/null 2>&1; code=$?
check "Unir por la API de GitHub (gh api .../merge) también pasa por el candado" "[ $code -eq 2 ]"
printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"az repos pr update --id 7 --auto-complete true"}}' "$PWD" | PATH="$W/gh-quien:$PATH" QUIEN=laura node "$PLUGIN/hooks/guard.mjs" >/dev/null 2>&1; code=$?
check "Completar el PR en Azure DevOps (--auto-complete) también" "[ $code -eq 2 ]"
printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"gh -R owner/repo pr merge 7 --merge"}}' "$PWD" | PATH="$W/gh-quien:$PATH" QUIEN=laura node "$PLUGIN/hooks/guard.mjs" >/dev/null 2>&1; code=$?
check "Un -R antes de \"pr merge\" también pasa por el candado" "[ $code -eq 2 ]"
mv .sn/connectors.json "$W/conectores.bak"
printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"gh pr merge 7 --merge"}}' "$PWD" | PATH="$W/gh-quien:$PATH" QUIEN=laura node "$PLUGIN/hooks/guard.mjs" >/dev/null 2>&1; code=$?
check "Un repositorio que NO trabaja con Altum no tiene este candado" "[ $code -eq 0 ]"
mv "$W/conectores.bak" .sn/connectors.json

echo; echo "RESULTADO: $pass OK · $fail fallas"
