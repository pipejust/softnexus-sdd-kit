#!/usr/bin/env bash
# Prueba del conector nativo de Altum contra el contrato real (servidor falso).
set -uo pipefail
T="$(cd "$(dirname "$0")" && pwd)"
W="$T/tmp"; mkdir -p "$W"   # todo lo que la prueba crea vive aquí (no se versiona)
PLUGIN="$(cd "$T/../plugin/scripts" && pwd)"
PORT=4598
LOG="$W/altum.jsonl"
PROJECT=11111111-1111-1111-1111-111111111111
export SN_ALTUM_KEY_PRUEBA=sk_live_test_empresa_a SN_SYNC_NO_GH=1
pass=0; fail=0
check() { if eval "$2"; then echo "OK    $1"; pass=$((pass+1)); else echo "FALLA $1"; fail=$((fail+1)); fi; }
posts() { grep -c '"method":"POST","path":"/api/v1/api/tasks"' "$LOG" 2>/dev/null || echo 0; }
state() { curl -s "localhost:$PORT/_state"; }
sn() { node scripts/sn/sn-sync.mjs "$@"; }

rm -rf "$W/altum-repo" "$LOG"; mkdir -p "$W/altum-repo" && cd "$W/altum-repo"
git init -q -b trunk && git config user.name "Laura Gómez" && git config user.email laura@x
mkdir -p scripts/sn .sn docs/items openspec/changes
cp -R "$PLUGIN/sn-sync.mjs" "$PLUGIN/validation-state.mjs" "$PLUGIN/sync" scripts/sn/
cat > .sn/connectors.json <<JSON
{ "project": "clientes", "connectors": [
  { "name": "altum", "kind": "altum", "base_url": "http://localhost:$PORT/api/v1/api", "project_id": "$PROJECT",
    "key_env": "SN_ALTUM_KEY_PRUEBA", "status_map": { "building": "en_desarrollo", "in_review": "en_revision", "verified": "no_existe" },
    "events": ["sn.item.*"] }
] }
JSON
pkill -f "altum-mock.mjs $PORT" 2>/dev/null; sleep 0.3
rm -rf "$W/repo-origen" "$W/clonado"; mkdir -p "$W/repo-origen" && (cd "$W/repo-origen" && git init -q -b main && echo "# Clientes" > README.md && git add -A && git -c user.name=t -c user.email=t@x commit -qm inicial)
MOCK_REPO="$W/repo-origen" node "$T/altum-mock.mjs" $PORT "$LOG" >/dev/null 2>&1 & MOCK=$!; sleep 0.6

echo "== Conexión"
check "test con la clave correcta: OK" "sn test | grep -q '^OK'"
check "test con clave equivocada: FALLA 401" "(SN_ALTUM_KEY_PRUEBA=mala sn test || true) | grep -q 'FALLA.*401.*clave de API inválida'"
check "Sin clave: dice qué variable falta y cómo guardarla" "(env -u SN_ALTUM_KEY_PRUEBA node scripts/sn/sn-sync.mjs test || true) | grep -q 'sn-clave-altum.sh'"

echo "== Una clave por persona (GET /me): quién es, empresa y proyectos asignados"
check "whoami con la clave de la empresa: dice que es de la empresa y lista sus proyectos" "sn whoami altum | grep -q 'Clave de la empresa' && sn whoami altum | grep -q 'Proyectos de la empresa (2)'"
out=$(SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn whoami altum)
check "whoami con clave personal: persona, empresa, solo sus proyectos y si este repo está asignado" "echo \"\$out\" | grep -q 'Clave personal de Laura Gómez <laura@x>' && echo \"\$out\" | grep -q 'Empresa: Softnexus (softnexus)' && echo \"\$out\" | grep -q 'Proyectos asignados (1)' && echo \"\$out\" | grep -q 'asignado.' && ! echo \"\$out\" | grep -q 'Facturación'"
cp .sn/connectors.json .sn/connectors.orig.json
sed -i '' 's/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/' .sn/connectors.json
out=$(SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn test 2>&1 || true)
mv .sn/connectors.orig.json .sn/connectors.json
check "Clave personal en un proyecto no asignado: 403 que dice que no estás asignado" "echo \"\$out\" | grep -q 'estés asignado a ese proyecto'"
mv .sn/connectors.json .sn/apagado.json
out=$(SN_ALTUM_BASE_URL="http://localhost:$PORT/api/v1/api" SN_ALTUM_KEY=sk_user_test_laura node scripts/sn/sn-sync.mjs whoami 2>&1 || true)  # sin conector se usa el nombre por defecto
mv .sn/apagado.json .sn/connectors.json
check "whoami funciona sin conector configurado (una clave, todos sus proyectos) y propone conectar" "echo \"\$out\" | grep -q 'Clave personal de Laura' && echo \"\$out\" | grep -q 'todavía no está unido a un proyecto'"
check "projects con clave personal: solo los asignados" "SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn projects altum | grep -q Clientes && ! SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn projects altum | grep -q Facturación"

check "projects funciona en una carpeta sin proyecto (solo con la clave): así se listan desde una carpeta vacía" "mkdir -p '$W/vacia' && (cd '$W/vacia' && SN_ALTUM_BASE_URL=\"http://localhost:$PORT/api/v1/api\" SN_ALTUM_KEY=sk_user_test_laura node '$W/altum-repo/scripts/sn/sn-sync.mjs' projects) | grep -q Clientes"

echo "== Clonar un proyecto por su nombre (repo_url de Altum)"
check "projects lista por NOMBRE (sin claves de proyecto) y marca los que no tienen repositorio" "sn projects | grep -qE '^  Clientes' && ! sn projects | grep -qi 'clave' && sn projects | grep -q 'sin repositorio en Altum'"
check "clone de un proyecto sin repositorio: dice que hay que registrarlo en Altum" "(sn clone clientes-vip 2>&1 || true) | grep -q 'no tiene repositorio registrado en Altum'"
check "clone con nombre exacto gana sobre los parecidos (Clientes, no Clientes VIP)" "sn clone Clientes --in '$W/clonado' --dry-run | grep -q '/clonado/clientes$'"
check "clone con un nombre a medias: muestra los parecidos y no clona" "(sn clone cliente 2>&1 || true) | grep -q 'proyectos parecidos'"
check "clone escribe el comando real con --dry-run" "sn clone clientes --in '$W/clonado' --dry-run | grep -q 'git clone .* $W/clonado/clientes'"
sn clone clientes --in "$W/clonado" >/dev/null 2>&1
check "clone trae el proyecto a una carpeta con su clave" "[ -f '$W/clonado/clientes/README.md' ]"
check "clone otra vez no vuelve a clonar: avisa que ya está" "sn clone clientes --in '$W/clonado' | grep -q 'ya está en'"
check "clone sin ruta NO clona: exige preguntarle a la persona dónde" "(sn clone clientes 2>&1 || true) | grep -q 'no clono sin saber dónde'"
check "clone --into deja el contenido en la ruta exacta, sin otra carpeta dentro" "sn clone clientes --into '$W/exacta' >/dev/null 2>&1; [ -f '$W/exacta/README.md' ] && [ ! -d '$W/exacta/clientes' ]"
check "clone en una carpeta madre que ya se llama como el proyecto no anida otra igual" "sn clone clientes --in '$W/anidado/clientes' --dry-run | grep -q '$W/anidado/clientes$'"
check "clone --here usa la carpeta actual si está vacía" "mkdir -p '$W/aqui' && (cd '$W/aqui' && SN_ALTUM_BASE_URL=\"http://localhost:$PORT/api/v1/api\" SN_ALTUM_KEY=sk_user_test_laura node '$W/altum-repo/scripts/sn/sn-sync.mjs' clone clientes --here --dry-run) | grep -q '/aqui$'"
check "clone en una carpeta con archivos no pisa nada: avisa que ya está" "sn clone clientes --into '$W/exacta' | grep -q 'ya está en'"
check "clone de algo que no existe: manda a mirar la lista" "(sn clone inventado-xyz 2>&1 || true) | grep -q 'ninguno de tus proyectos se parece'"

echo "== El líder técnico lo dice Altum (nadie lo escribe a mano)"
check "lead lo lee del proyecto y, si la clave es de la líder, da nombre y correo" "SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn lead altum | grep -q 'Laura'"
check "Cuando el líder es otra persona, da su nombre, su correo y su usuario de GitHub" "sn lead altum | grep -q 'Marta Ríos' && sn lead altum | grep -q 'marta@softnexus.co' && sn lead altum | grep -q '@martarios'"

check "El mensaje para el líder trae a quién mandárselo (lo dice Altum)" "mkdir -p openspec/changes/fix-x && printf -- '## 2026-09-20 10:00 · SOLICITUD · sello: entrega\\n- Pide: Laura Gómez <laura@x>\\n- Rama: fix/CLI-0001 · Commit: abc1234\\n- Riesgo: R3\\n' > openspec/changes/fix-x/validacion.md; SN_SYNC_NO_GH=1 sn mensaje | grep -q 'Para: Marta Ríos <marta@softnexus.co>'"
check "Y trae el sello, el riesgo y el commit que se pidió validar" "SN_SYNC_NO_GH=1 sn mensaje | grep -q 'sello de entrega · riesgo R3' && SN_SYNC_NO_GH=1 sn mensaje | grep -q 'abc1234'"

echo "== Un proyecto puede tener varios repositorios"
check "repos lista los repositorios de un proyecto, con su proveedor" "sn repos tienda | grep -q 'empresa/app' && sn repos tienda | grep -q 'empresa/web' && sn repos tienda | grep -q '\\[azure_devops\\]'"
check "Un repositorio de Azure DevOps arma bien su dirección (organización/proyecto/repositorio)" "sn repos tienda | grep -q 'dev.azure.com/miorg/Mi%20Proyecto/_git/consola'"
check "projects avisa cuántos repositorios tiene" "sn projects | grep -qE 'Tienda .*3 repositorios'"
check "clone con varios repositorios NO elige solo: los muestra y pide --repo" "out=\$( (sn clone tienda --in '$W/multi' 2>&1 || true) ); echo \"\$out\" | grep -q '3 repositorios' && echo \"\$out\" | grep -q -- '--repo app' && [ ! -d '$W/multi' ]"
check "clone --repo elige uno y la carpeta se llama como ESE repositorio" "sn clone tienda --repo web --in '$W/multi' --dry-run | grep -q '$W/multi/web$'"
check "clone --repo con un nombre que no existe vuelve a mostrar las opciones" "(sn clone tienda --repo inventado --in '$W/multi' 2>&1 || true) | grep -q -- '--repo app'"
check "set-repo agrega a la lista sin pisar los que ya estaban" "SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn set-repo tienda https://github.com/empresa/panel | grep -q 'ya tenía: empresa/app, empresa/web' && sn repos tienda | grep -q 'empresa/panel'"
check "set-repo del mismo repositorio dos veces no duplica (409 de Altum)" "SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn set-repo tienda https://github.com/empresa/panel | grep -q 'ya tenía registrado'"

check "clone de un repositorio de Azure DevOps usa su dirección y su nombre de carpeta" "sn clone tienda --repo consola --in '$W/multi' --dry-run | grep -q 'dev.azure.com' && sn clone tienda --repo consola --in '$W/multi' --dry-run | grep -q '$W/multi/consola$'"
check "set-repo reconoce solo que es Azure DevOps por la dirección" "SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn set-repo tienda 'https://dev.azure.com/miorg/Otro%20Proyecto/_git/api' | grep -q 'azure_devops' && sn repos tienda | grep -q 'miorg/Otro Proyecto/api'"
check "quitar-repo sin --si no borra: dice qué haría" "out=\$( (SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn quitar-repo tienda api 2>&1 || true) ); echo \"\$out\" | grep -q 'Quitaría' && sn repos tienda | grep -q 'miorg/Otro Proyecto/api'"
check "quitar-repo --si lo saca del proyecto" "SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn quitar-repo tienda api --si | grep -q 'ya no figura' && ! sn repos tienda | grep -q 'Otro Proyecto'"
check "quitar-repo de algo que no está lo dice sin romperse" "(SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn quitar-repo tienda inventado --si 2>&1 || true) | grep -q 'Sus repositorios son'"

check "AGENTS.md con otro líder escrito a mano: lead lo corrige con lo que dice Altum" "printf -- '- Líder técnico (valida sellos): Andrés Felipe Cortés <pipemas@gmail.com> · usuario GitHub: @pipejust\n' > AGENTS.md; sn lead | grep -q 'Lo corregí' && grep -q 'Marta Ríos <marta@softnexus.co> · GitHub @martarios — según Altum' AGENTS.md && ! grep -q pipejust AGENTS.md"
check "Correrlo otra vez no cambia nada (ya coincide)" "! sn lead | grep -q 'Lo corregí'"
check "lead --github da el usuario del líder según Altum, no el de quien trabaja" "[ \"\$(sn lead --github)\" = martarios ]"
mkdir -p "$W/gh-lider" && printf '#!/bin/sh\n[ "$1 $2" = "api user" ] && echo martarios\n' > "$W/gh-lider/gh" && chmod +x "$W/gh-lider/gh"
check "Si el líder es la cuenta con la que trabajas, no se pide revisión a uno mismo: firma y une él" "(PATH=\"$W/gh-lider:\$PATH\" SN_SYNC_NO_GH= node scripts/sn/sn-sync.mjs lead --github 2>&1 || true) | grep -q 'lo unes tú'"
check "lead deja al líder de Altum como revisor automático de los PR (CODEOWNERS)" "grep -qx '\\* @martarios' .github/CODEOWNERS"
rm -f AGENTS.md
rm -rf .github/CODEOWNERS

check "pedir-config sin ser administrador del repositorio: nada que hacer (tampoco el líder)" "out=\$(SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn pedir-config); echo \"\$out\" | grep -q 'Nada que hacer de tu parte' && ! echo \"\$out\" | grep -qi 'sk_live'"
mkdir -p "$W/gh-admin" && printf '#!/bin/sh\n[ "$1" = "api" ] && echo true\n' > "$W/gh-admin/gh" && chmod +x "$W/gh-admin/gh"
check "pedir-config siendo administrador del repositorio: se le ofrece configurar" "PATH=\"$W/gh-admin:\$PATH\" SN_SYNC_NO_GH= node scripts/sn/sn-sync.mjs pedir-config | grep -q 'Eres administrador de este repositorio'"

rm -f .sn/state/altum-lider.json
mkdir -p "$W/gh-quien2" && printf '#!/bin/sh\n[ "$1 $2" = "api user" ] && echo laura\n' > "$W/gh-quien2/gh" && chmod +x "$W/gh-quien2/gh"
printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"gh pr merge 3 --merge"}}' "$PWD" | PATH="$W/gh-quien2:$PATH" SN_ALTUM_BASE_URL="http://localhost:$PORT/api/v1/api" node "$PLUGIN/../hooks/guard.mjs" >/dev/null 2>"$W/guard2.err"; code=$?
check "Sesión nueva sin el líder guardado: el candado pregunta a Altum y bloquea igual a quien no es el líder" "[ $code -eq 2 ] && grep -q 'Marta Ríos' '$W/guard2.err'"

echo "== Registrar el repositorio del proyecto en Altum (projects:write)"
check "whoami avisa cuando la clave es anterior a projects:write" "sn whoami | grep -q 'anterior al permiso'"
check "whoami con clave nueva no molesta con ese aviso" "! SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn whoami | grep -q 'anterior al permiso'"
check "set-repo con clave de empresa (sin projects:write): explica que hay que regenerar la clave" "(sn set-repo clientes-vip https://github.com/x/y 2>&1 || true) | grep -q 'projects:write'"
check "set-repo con clave personal registra el repositorio" "SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn set-repo clientes https://github.com/softnexus/clientes 2>&1 | grep -q 'se clona desde https://github.com/softnexus/clientes'"
check "después de registrarlo, projects ya no lo marca como sin repositorio" "SN_ALTUM_KEY_PRUEBA=sk_user_test_laura sn projects | grep -E '^  Clientes ' | grep -qv 'sin repositorio'"
check "Todos los proyectos se leen aunque vengan paginados" "sn projects | grep -c '  ' | grep -qE '^[4-9]|^[0-9]{2}'"

echo "== Crear tarea al crear el ítem"
cat > docs/items/CLI-0001.md <<'MD'
---
id: CLI-0001
type: bug
title: El botón guardar no hace nada
risk: R2
size: XS
change: fix-guardar
assignee: Laura Gómez <laura@x>
---
## Historia
Como vendedora quiero guardar un cliente.
MD
sn sync >/dev/null
check "POST /tasks con project_id, kind=bug, prioridad 3 (R2) y X-API-Key" "state | python3 -c 'import json,sys; t=[x for x in json.load(sys.stdin) if x[\"title\"].startswith(\"[CLI-0001]\")][0]; assert t[\"kind\"]==\"bug\" and t[\"priority\"]==3 and t[\"project_id\"]==\"$PROJECT\"'"
check "Descripción en texto plano (Altum no interpreta Markdown): historia y trazabilidad, sin ** ni marca oculta" "state | python3 -c 'import json,sys; d=[x for x in json.load(sys.stdin) if x[\"title\"].startswith(\"[CLI-0001]\")][0][\"description\"]; assert \"TRAZABILIDAD\" in d and \"HISTORIA\" in d and \"Commits (\" not in d and \"**\" not in d and \"<!--\" not in d and \"\x60\" not in d, d'"
check "El id de Altum quedó guardado en el ítem (ext.altum)" "grep -qE '^ext.altum: [0-9a-f-]{36}$' docs/items/CLI-0001.md"
check "POST con external_ref=CLI-0001 e Idempotency-Key (no duplica si la red falla)" "grep '\"method\":\"POST\"' '$LOG' | grep -q '\"external_ref\":\"CLI-0001\"' && grep '\"method\":\"POST\"' '$LOG' | grep -q '\"idem\":\"sn-$PROJECT-CLI-0001\"'"
check "Responsable por correo de git (assignee_email) sin mapear UUIDs" "state | python3 -c 'import json,sys; t=[x for x in json.load(sys.stdin) if x[\"title\"].startswith(\"[CLI-0001]\")][0]; assert t[\"assignee_id\"]==\"user-laura\", t[\"assignee_id\"]'"

check "Campos propios: riesgo y tamaño en custom_fields; etapa no se envía (el proyecto no la definió)" "state | python3 -c 'import json,sys; t=[x for x in json.load(sys.stdin) if x[\"title\"].startswith(\"[CLI-0001]\")][0]; cf=t[\"custom_fields\"]; assert cf.get(\"riesgo\")==\"R2\" and cf.get(\"tamano\")==\"XS\" and \"etapa\" not in cf, cf'"
curl -s "localhost:$PORT/_setfield?ref=CLI-0001" >/dev/null

echo "== Actualizar sin duplicar"
sed -i '' 's/^title: .*/title: Guardar falla sin ciudad/' docs/items/CLI-0001.md
sn sync >/dev/null
check "Un cambio hace PATCH, no un segundo POST" "[ \$(posts) -eq 1 ] && state | grep -q 'Guardar falla sin ciudad'"
check "Un campo puesto a mano en Altum (cliente_final) sobrevive al PATCH (se mezcla, no se pisa)" "state | python3 -c 'import json,sys; t=[x for x in json.load(sys.stdin) if x[\"title\"].startswith(\"[CLI-0001]\")][0]; cf=t[\"custom_fields\"]; assert cf.get(\"cliente_final\")==\"Almacenes Éxito\" and cf.get(\"riesgo\")==\"R2\", cf'"
sed -i '' '/^ext.altum:/d' docs/items/CLI-0001.md; rm -rf .sn/state
curl -s "localhost:$PORT/_stripmark" >/dev/null
sn sync >/dev/null
check "Otro computador sin ext.altum y con la marca borrada en Altum la encuentra por external_ref (sin duplicar)" "[ \$(posts) -eq 1 ]"
printf -- '---\nid: CLI-0004\ntype: chore\ntitle: Limpiar logs\nassignee: Pedro <pedro@x>\n---\n## Historia\nx\n' > docs/items/CLI-0004.md
sn sync >/dev/null
check "Correo que no existe en Altum (404): la tarea se crea igual, sin responsable" "state | grep -q 'CLI-0004' && [ ! -s .sn/state/outbox.jsonl ]"

echo "== Estados del proyecto"
mkdir -p openspec/changes/fix-guardar && echo p > openspec/changes/fix-guardar/proposal.md
printf -- '- [x] 1\n- [ ] 2\n' > openspec/changes/fix-guardar/tasks.md; sn sync >/dev/null
check "building -> en_desarrollo (estado propio del proyecto)" "state | grep -q '\"state\":\"en_desarrollo\"'"
printf -- '- [x] 1\n- [x] 2\n' > openspec/changes/fix-guardar/tasks.md; echo ok > openspec/changes/fix-guardar/evidencia.md; sn sync >/dev/null
check "Estado mapeado que no existe en el proyecto no se envía" "! grep -q 'no_existe' '$LOG'"

echo "== Terminado y bloqueos (409)"
mkdir -p openspec/changes/archive && mv openspec/changes/fix-guardar openspec/changes/archive/2026-09-19-fix-guardar
sn sync >/dev/null
check "done -> closed" "state | python3 -c 'import json,sys; t=[x for x in json.load(sys.stdin) if x[\"title\"].startswith(\"[CLI-0001]\")][0]; assert t[\"state\"]==\"closed\", t[\"state\"]'"
check "asegurar al terminar confirma que la tarea quedó cerrada en Altum" "sn asegurar CLI-0001 | grep -q 'Cerrada en Altum'"
check "Workflow propio sin 'closed': al terminar va al último estado de terminado (por kind)" "node -e \"import('./scripts/sn/sync/altum.mjs').then(m => { const e=[{key:'backlog',kind:'open'},{key:'haciendo',kind:'in_progress'},{key:'listo',kind:'done'},{key:'archivado',kind:'done'}]; process.exit(m.estadoPara('done',e)==='archivado' && m.estadoPara('merged',e)==='archivado' && m.estadoPara('building',e)==='haciendo' ? 0 : 1); })\""
printf -- '---\nid: CLI-0002\ntype: feature\ntitle: tarea bloqueada\nrisk: R1\nchange: add-x\n---\n## Historia\nx\n' > docs/items/CLI-0002.md
sn sync >/dev/null; mkdir -p openspec/changes/archive/2026-09-19-add-x
out=$(sn sync 2>&1)
check "409 por bloqueadores: dice cuál tarea falta cerrar y NO queda en cola de reintentos" "echo \"\$out\" | grep -q 'falta cerrar #12 \"Configurar pasarela\"' && [ ! -s .sn/state/outbox.jsonl ]"

check "Al cerrar una tarea bloqueada, asegurar dice cuál la bloquea (no la da por cerrada)" "(sn asegurar CLI-0002 2>&1 || true) | grep -q 'falta cerrar #12 \"Configurar pasarela\"'"

echo "== Al unir el PR la tarea se cierra sola (lo que hace el CI de GitHub)"
mkdir -p "$W/gh-falso" && printf '#!/bin/sh\n[ "$1 $2" = "pr view" ] && echo "{\\"state\\":\\"MERGED\\",\\"number\\":7,\\"url\\":\\"https://github.com/x/y/pull/7\\"}"\n' > "$W/gh-falso/gh" && chmod +x "$W/gh-falso/gh"
printf -- '---\nid: CLI-0010\ntype: feature\ntitle: Descargar reporte\nrisk: R1\nbranch: feat/CLI-0010-reporte\nchange: add-reporte\n---\n## Historia\nx\n' > docs/items/CLI-0010.md
mkdir -p openspec/changes/add-reporte && echo p > openspec/changes/add-reporte/proposal.md
sn sync >/dev/null 2>&1
PATH="$W/gh-falso:$PATH" SN_SYNC_NO_GH= node scripts/sn/sn-sync.mjs sync --upsert-only >/dev/null 2>&1
check "PR unido → la tarea queda CERRADA en Altum, sin que nadie escriba /sn ni archive" "state | python3 -c 'import json,sys; t=[x for x in json.load(sys.stdin) if x[\"title\"].startswith(\"[CLI-0010]\")][0]; assert t[\"state\"]==\"closed\", t[\"state\"]'"
check "asegurar lo confirma en ese punto (PR unido, plano aún sin archivar)" "PATH=\"$W/gh-falso:\$PATH\" SN_SYNC_NO_GH= node scripts/sn/sn-sync.mjs asegurar CLI-0010 | grep -q 'Cerrada en Altum'"

echo "== Historial limpio en Altum y commits que de verdad son del ítem"
patches() { grep -c '"method":"PATCH"' "$LOG"; }
sn sync >/dev/null 2>&1; p0=$(patches); sn sync >/dev/null 2>&1; sn sync >/dev/null 2>&1
check "Sincronizar sin cambios NO toca la tarea (no ensucia el historial de Altum)" "[ \$(patches) -eq $p0 ]"
printf -- '---\nid: CLI-0011\ntype: feature\ntitle: Tarea nueva limpia\nrisk: R1\n---\n## Historia\nComo cliente quiero ver mi saldo.\n### Contexto\nHoy no se ve.\n' > docs/items/CLI-0011.md
p0=$(patches); sn sync >/dev/null 2>&1
check "Crear una tarea es UNA entrada: POST y ningún PATCH detrás (antes salían dos)" "[ \$(patches) -eq $p0 ] && grep -q '\"external_ref\":\"CLI-0011\"' '$LOG'"
check "Los subtítulos ### de la historia salen como títulos, sin almohadillas" "state | python3 -c 'import json,sys; d=[x for x in json.load(sys.stdin) if x[\"title\"].startswith(\"[CLI-0011]\")][0][\"description\"]; assert \"CONTEXTO\" in d and \"###\" not in d, d'"
git add -A >/dev/null && git commit -qm "chore: otra cosa" -m "Se registra aparte CLI-0011 para después." && git commit -q --allow-empty -m "feat: saldo" -m "Refs: CLI-0011"
check "Solo cuentan los commits con Refs: <ID>, no los que apenas mencionan el id" "node -e \"import('./scripts/sn/sync/trace.mjs').then(m => { const s = m.commitsFor({ id: 'CLI-0011' }).map(c => c.subject); process.exit(s.includes('feat: saldo') && !s.includes('chore: otra cosa') ? 0 : 1); })\""
check "Cada petición a Altum dice quién escribe: Plugin Softnexus" "! grep '\"method\":\"PATCH\"\|\"method\":\"POST\"' '$LOG' | grep -v '\"cliente\":\"Plugin Softnexus\"' | grep -q ."
printf -- '---\nid: CLI-0012\ntype: bug\ntitle: html duplicado\nrisk: R2\ndescartado: se reescribe en Angular en la Fase 3\n---\n## Historia\nx\n' > docs/items/CLI-0012.md
sn sync >/dev/null 2>&1
check "Con el workflow de siempre, descartado va a 'removed' (cancelado)" "node -e \"import('./scripts/sn/sync/altum.mjs').then(m => process.exit(m.estadoPara('discarded',[{key:'new',kind:'open'},{key:'closed',kind:'done'},{key:'removed',kind:'cancelled'}])==='removed' ? 0 : 1))\""
check "Un ítem descartado deja la tarea terminada (este proyecto no tiene 'cancelado': va a closed) y con el motivo escrito" "state | python3 -c 'import json,sys; t=[x for x in json.load(sys.stdin) if x[\"title\"].startswith(\"[CLI-0012]\")][0]; assert t[\"state\"]==\"closed\" and \"DESCARTADO: se reescribe en Angular\" in t[\"description\"], t'"

echo "== PR de Azure DevOps y firma del líder (solo vale la aprobación del líder)"
sn lead >/dev/null 2>&1   # deja al líder (Marta) en caché para validar firmas sin red
git remote remove origin 2>/dev/null; git remote add origin 'https://dev.azure.com/miorg/Mi%20Proyecto/_git/app'
export SN_AZURE_BASE_URL="http://localhost:$PORT" SN_AZURE_PAT=pat-de-prueba
printf -- '---\nid: CLI-0020\ntype: feature\ntitle: Exportar en Azure\nrisk: R1\nbranch: feat/CLI-0020-azure\n---\n## Historia\nx\n' > docs/items/CLI-0020.md
sn sync >/dev/null 2>&1; SN_SYNC_NO_GH= sn sync --upsert-only >/dev/null 2>&1
check "Repo de Azure DevOps: lee su PR (completado = unido) y la tarea queda cerrada en Altum" "state | python3 -c 'import json,sys; t=[x for x in json.load(sys.stdin) if x[\"title\"].startswith(\"[CLI-0020]\")][0]; assert t[\"state\"]==\"closed\", t[\"state\"]'"
check "Azure: PR aprobado por el líder de Altum → FIRMA VÁLIDA" "sn verificar-firma 41 | grep -q 'FIRMA VÁLIDA'"
check "Azure: PR aprobado por otra persona → no vale, y lo dice" "(sn verificar-firma 42 2>&1 || true) | grep -q 'lo aprobó pedro@softnexus.co, pero solo vale la aprobación del líder (Marta Ríos'"
git remote remove origin; unset SN_AZURE_BASE_URL SN_AZURE_PAT
mkdir -p "$W/gh-rev" && cat > "$W/gh-rev/gh" <<'GH'
#!/bin/sh
case "$3" in
  7) echo '{"author":{"login":"laura"},"reviews":[{"author":{"login":"pedro"},"state":"APPROVED"}]}' ;;
  8) echo '{"author":{"login":"laura"},"reviews":[{"author":{"login":"martarios"},"state":"APPROVED"}]}' ;;
  9) echo '{"author":{"login":"laura"},"reviews":[{"author":{"login":"martarios"},"state":"APPROVED"},{"author":{"login":"martarios"},"state":"CHANGES_REQUESTED"}]}' ;;
  10) echo '{"author":{"login":"martarios"},"reviews":[{"author":{"login":"martarios"},"state":"APPROVED"}]}' ;;
  11) echo '{"author":{"login":"martarios"},"reviews":[]}' ;;
esac
GH
chmod +x "$W/gh-rev/gh"
firmaPr() { PATH="$W/gh-rev:$PATH" SN_SYNC_NO_GH= node scripts/sn/sn-sync.mjs verificar-firma "$1" 2>&1 || true; }
check "GitHub: aprobado solo por alguien que no es el líder → SIN FIRMA (el PR no se puede unir)" "firmaPr 7 | grep -q 'SIN FIRMA DEL LÍDER' && firmaPr 7 | grep -q 'lo aprobó pedro'"
check "GitHub: aprobado por el líder de Altum (@martarios) → FIRMA VÁLIDA" "firmaPr 8 | grep -q 'FIRMA VÁLIDA'"
check "GitHub: si el líder aprobó y después pidió cambios, cuenta lo último → SIN FIRMA" "firmaPr 9 | grep -q 'SIN FIRMA DEL LÍDER'"
check "GitHub: el PR que abre el propio líder ya cuenta como firmado (él decide en su proyecto)" "firmaPr 10 | grep -q 'FIRMA VÁLIDA' && firmaPr 10 | grep -q 'lo abrió el propio líder'"
check "GitHub: el PR del líder vale aunque GitHub no permita que se apruebe a sí mismo (sin revisiones)" "firmaPr 11 | grep -q 'FIRMA VÁLIDA'"
check "verificar-firma sale con error si no hay firma (así el CI bloquea el merge)" "! PATH=\"$W/gh-rev:\$PATH\" SN_SYNC_NO_GH= node scripts/sn/sn-sync.mjs verificar-firma 7 >/dev/null 2>&1"
mkdir -p openspec/changes/add-firma && printf -- "## 2026-09-21 10:00 · SOLICITUD · sello: plano\n- Pide: Laura Gómez <laura@x>\n- Rama: feat/x · Commit: abc1234\n\n## 2026-09-21 11:00 · APROBADO · sello: plano\n- Valida: Pedro <pedro@softnexus.co>\n- Commit validado: abc1234\n" > openspec/changes/add-firma/validacion.md
check "validacion.md aprobado por quien no es el líder: NO cuenta como validado (firma inválida)" "node scripts/sn/validation-state.mjs | python3 -c 'import json,sys; e=[x for x in json.load(sys.stdin) if x[\"change\"]==\"add-firma\"][0]; assert e[\"status\"]==\"firma inválida\", e'"
sed -i '' 's/Valida: Pedro <pedro@softnexus.co>/Valida: Marta Ríos <marta@softnexus.co>/' openspec/changes/add-firma/validacion.md
check "Firmado por el líder de Altum: sí cuenta" "node scripts/sn/validation-state.mjs | python3 -c 'import json,sys; e=[x for x in json.load(sys.stdin) if x[\"change\"]==\"add-firma\"][0]; assert e[\"status\"]!=\"firma inválida\", e'"
rm -rf openspec/changes/add-firma

echo "== Criterios de aceptación en los dos sentidos"
printf -- '---\nid: CLI-0030\ntype: feature\ntitle: Ver saldo del cliente\nrisk: R1\n---\n## Historia\nComo vendedor quiero ver el saldo.\n\n## Criterios de aceptación\n- Dado un cliente con deuda, cuando abro su ficha, entonces veo el saldo en rojo\n- Dado un cliente al día, entonces veo "Al día"\n' > docs/items/CLI-0030.md
sn sync >/dev/null 2>&1
tarea30() { state | python3 -c 'import json,sys; t=[x for x in json.load(sys.stdin) if x["title"].startswith("[CLI-0030]")][0]; print(t.get("acceptance_criteria") or "")'; }
check "La tarea nace en Altum con sus criterios de aceptación (campo propio, no en la descripción)" "tarea30 | grep -q 'saldo en rojo' && tarea30 | grep -q 'Al día' && ! state | python3 -c 'import json,sys; t=[x for x in json.load(sys.stdin) if x[\"title\"].startswith(\"[CLI-0030]\")][0]; sys.exit(0 if \"saldo en rojo\" in t[\"description\"] else 1)'"
check "Crear con criterios sigue siendo UNA entrada: el POST ya los lleva (ningún PATCH detrás)" "! grep '\"method\":\"PATCH\"' '$LOG' | grep -q 'saldo en rojo'"
sed -i '' 's/veo "Al día"$/veo "Al día" en verde/' docs/items/CLI-0030.md
sn sync >/dev/null 2>&1
check "Cambiar los criterios en el ítem los actualiza en Altum" "tarea30 | grep -q 'en verde'"
T30=$(state | python3 -c 'import json,sys; print([x for x in json.load(sys.stdin) if x["title"].startswith("[CLI-0030]")][0]["id"])')
api() { curl -s -H "X-API-Key: $SN_ALTUM_KEY_PRUEBA" -H 'Content-Type: application/json' "$@"; }
api -X PATCH "localhost:$PORT/api/v1/api/tasks/$T30" -d '{"acceptance_criteria":"<ul><li><strong>Dado</strong> un cliente con deuda, cuando abro su ficha, entonces veo el saldo en rojo</li><li>Dado un cliente al día, entonces veo &quot;Al día&quot; en verde</li></ul>"}' >/dev/null
p0=$(grep -c '"method":"PATCH"' "$LOG"); sn sync --upsert-only >/dev/null 2>&1
check "Si en Altum solo cambió el formato (HTML del editor), no se vuelve a escribir la tarea" "[ \$(grep '\"method\":\"PATCH\"' '$LOG' | grep -c \"$T30\") -eq \$(grep '\"method\":\"PATCH\"' '$LOG' | head -n $p0 | grep -c \"$T30\") ]"

sed -i '' 's/Como vendedor quiero ver el saldo./Como vendedor quiero ver el saldo actualizado./' docs/items/CLI-0030.md
sn sync >/dev/null 2>&1
check "Cambiar solo la historia del ítem también se lleva a Altum" "state | python3 -c 'import json,sys; t=[x for x in json.load(sys.stdin) if x[\"title\"].startswith(\"[CLI-0030]\")][0]; sys.exit(0 if \"saldo actualizado\" in t[\"description\"] else 1)'"

echo "== Altum -> repo (tareas creadas a mano)"
out=$(sn pull altum)
check "pull sin --apply solo muestra (no crea archivos)" "echo \"\$out\" | grep -q 'ALT-77' && [ ! -f docs/items/ALT-77.md ]"
sn pull altum --apply >/dev/null
check "La tarea cerrada (78) no se importa como trabajo pendiente" "! echo \"$out\" | grep -q ALT-78 && echo \"$out\" | grep -q '1 terminadas omitidas'"
check "pull --apply crea docs/items/ALT-77.md con ext.altum y tipo improvement" "grep -q '^ext.altum: ' docs/items/ALT-77.md && grep -q '^type: improvement' docs/items/ALT-77.md"
check "Importar una tarea de Altum trae sus criterios al ítem, en texto limpio (sin HTML)" "grep -q 'Dado un rango de fechas' docs/items/ALT-79.md && grep -q 'Nada en ese rango' docs/items/ALT-79.md && ! grep -q '<li>' docs/items/ALT-79.md"
out=$(sn pull altum)
check "Segundo pull (updated_since) no repite la tarea" "! echo \"\$out\" | grep -q 'nuevo'"
curl -s "localhost:$PORT/_edit" >/dev/null; out=$(sn pull altum)
check "Cambio manual en Altum sobre tarea enlazada se reporta" "echo \"\$out\" | grep -q 'cambió en Altum  ALT-77'"
sn sync >/dev/null
check "El ítem importado no crea una tarea duplicada en Altum" "[ \$(state | grep -o 'Exportar clientes a Excel' | wc -l | tr -d ' ') -eq 1 ]"

ALT_ID=$(grep '^ext.altum:' docs/items/ALT-77.md | cut -d' ' -f2)
check "fetch trae una tarea de Altum por su id (para arrancar /sn desde ella)" "sn fetch altum $ALT_ID | grep -q 'Exportar clientes a Excel'"

echo "== Un repo = un proyecto de una empresa: elegir y leer lo que ya existe"
out=$(sn projects altum)
check "projects: nombre y cliente de cada proyecto que ve la clave" "echo \"\$out\" | grep -qE '^  Clientes.*cliente: Almacenes Éxito' && echo \"\$out\" | grep -q 'Facturación'"
out=$(sn backlog altum)
check "backlog muestra pendientes del proyecto y cuáles faltan por traer" "echo \"\$out\" | grep -q 'Tareas en Altum' && echo \"\$out\" | grep -q 'sin traer'"
check "backlog no mezcla tareas de otro proyecto" "! echo \"\$out\" | grep -q 'Portal de facturación'"
check "backlog oculta las terminadas salvo con --all" "! echo \"\$out\" | grep -q 'Migrar servidor' && sn backlog altum --all | grep -q 'Migrar servidor'"
printf -- '---\nid: CLI-0003\ntype: feature\ntitle: Portal clientes\n---\n## Historia\nx\n' > docs/items/CLI-0003.md
curl -s "localhost:$PORT/_create" >/dev/null
TASK=$(sn backlog altum --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print([t["altum_id"] for t in d if t["open"] and not t["item"]][0] if any(t["open"] and not t["item"] for t in d) else "")')
before=$(posts)
sn link CLI-0003 altum "$TASK" >/dev/null
check "link enlaza un ítem con una tarea existente (sin crear otra)" "[ -n \"\$TASK\" ] && grep -q \"^ext.altum: \$TASK\" docs/items/CLI-0003.md && sn sync >/dev/null && [ \$(posts) -eq $before ]"

echo "== Tareas borradas en Altum"
sn pull altum --apply >/dev/null
curl -s "localhost:$PORT/_delete?number=77" >/dev/null
out=$(sn pull altum)
check "pull avisa que la tarea enlazada se borró en Altum (include_deleted)" "echo \"\$out\" | grep -q 'borrada en Altum  ALT-77'"

check "GET /tasks pide páginas (page/limit) hasta traerlas todas" "grep -q 'page=2' '$LOG'"

echo "== Tareas que vienen de reuniones (Acten): se ven, se traen y se les cambia lo que Acten permite"
api() { curl -s -H "X-API-Key: $SN_ALTUM_KEY_PRUEBA" -H 'Content-Type: application/json' "$@"; }
ACTEN="localhost:$PORT/api/v1/api/tasks/acten%3Aabc123"
backlogNode() { node -e "import('./scripts/sn/sync/altum-backlog.mjs').then(async m => { const c = JSON.parse(require('fs').readFileSync('.sn/connectors.json')).connectors[0]; const r = await m.readBacklog(c, '.', process.argv[1] || ''); const a = r.find(x => String(x.altum_id).startsWith('acten:')); console.log(JSON.stringify(a || null)); })" "${1:-}"; }
check "backlog la muestra marcada como nacida en una reunión" "sn backlog altum | grep -q 'Acuerdo de la reunión del lunes' && sn backlog altum | grep -q 'de una reunión'"
check "Con updated_since también aparece: el vigilante ya la ve" "[ \"\$(backlogNode 2026-09-19T00:00:00Z)\" != null ]"
rm -f .sn/state/pull-altum.json
check "pull la trae al repositorio con un id propio (ACT-…)" "out=\$(sn pull altum --apply 2>&1); echo \"\$out\" | grep -q 'ACT-abc123' && echo \"\$out\" | grep -q 'nacidas en reuniones' && [ -f docs/items/ACT-abc123.md ]"
check "link contra una tarea de reunión se acepta y avisa qué se le puede cambiar" "sn link CLI-0001 altum acten:abc123 | grep -q 'solo se le pueden cambiar estado'"
sn sync >/dev/null 2>&1
check "sync escribe título y descripción en la tarea de la reunión" "api \"\$ACTEN\" | grep -q 'ACT-abc123'"
check "El estado enviado es de Acten (pending|blocked|done|cancelled), no uno del proyecto" "api \"\$ACTEN\" | grep -qE '\"state\":\"(pending|blocked|done|cancelled)\"'"
check "No se le mandan campos prohibidos (prioridad, campos propios): ningún 422 en el registro" "! grep -q '\"path\":\"/api/v1/api/tasks/acten%3Aabc123\",\"status\":422' '$LOG'"
check "Altum rechaza con 422 un campo que Acten no acepta (el simulador copia la regla real)" "api -X PATCH \"\$ACTEN\" -d '{\"priority\":1}' | grep -q 'no se puede cambiar'"
api -X PATCH "$ACTEN" -d '{"state":"done"}' >/dev/null
check "Una tarea de reunión terminada no cuenta como pendiente" "backlogNode | grep -q '\"open\":false'"

check "La fecha sin zona de una tarea de reunión se lee como UTC, no como hora local" "node -e \"import('./scripts/sn/sync/altum.mjs').then(m => { const sinZona = m.fechaUtc('2026-09-20T06:38:42.102639'); const conZona = new Date('2026-09-20T06:38:42.102639Z'); process.exit(sinZona.getTime() === conZona.getTime() ? 0 : 1); })\""

echo "== Antes de construir: la tarea TIENE que existir en Altum"
printf -- '---\nid: CLI-0009\ntype: feature\ntitle: Exportar facturas\nrisk: R2\n---\n## Historia\nx\n' > docs/items/CLI-0009.md
before=$(posts)
out=$(sn asegurar CLI-0009 2>&1)
check "asegurar crea la tarea en primer plano si todavía no existe y dice su número" "echo \"\$out\" | grep -qE 'Tarea en Altum #[0-9]+: \\[CLI-0009\\] Exportar facturas' && [ \$(posts) -eq \$((before + 1)) ]"
check "El ítem queda enlazado con la tarea (ext.altum)" "grep -q '^ext.altum: ' docs/items/CLI-0009.md"
before=$(posts)
check "asegurar otra vez no duplica: confirma la que ya existe" "sn asegurar CLI-0009 | grep -q 'Ya se puede construir' && [ \$(posts) -eq $before ]"
curl -s "localhost:$PORT/_delete?ref=CLI-0009" >/dev/null
check "Si la tarea se borró en Altum, asegurar la vuelve a crear" "sn asegurar CLI-0009 | grep -qE 'Tarea en Altum #[0-9]+'"
mv .sn/connectors.json .sn/apagado.json
check "Sin proyecto de Altum conectado, asegurar lo dice en vez de callarse" "(sn asegurar CLI-0009 2>&1 || true) | grep -q 'no está unido a un proyecto de Altum'"
mv .sn/apagado.json .sn/connectors.json
check "Sin clave, asegurar dice exactamente cuál falta" "(env -u SN_ALTUM_KEY_PRUEBA node scripts/sn/sn-sync.mjs asegurar CLI-0009 2>&1 || true) | grep -q 'falta la clave de Altum (SN_ALTUM_KEY_PRUEBA)'"

echo "== conectar: el proyecto sale del repositorio, nunca se pide una clave de proyecto"
rm -rf "$W/conectar" && mkdir -p "$W/conectar" && cd "$W/conectar" && git init -q
C() { SN_ALTUM_BASE_URL="http://localhost:$PORT/api/v1/api" SN_ALTUM_KEY=sk_user_test_laura node "$PLUGIN/sn-sync.mjs" conectar "$@"; }
git remote add origin "$W/repo-origen"
out=$(C 2>&1)
check "Repositorio de un solo proyecto: se conecta solo, sin preguntar" "echo \"\$out\" | grep -q 'Conectado: este repositorio trabaja con \"Clientes\"' && grep -q '\"project_id\": \"$PROJECT\"' .sn/connectors.json"
check "Conectar otra vez no cambia nada" "C | grep -q 'ya está conectado con \"Clientes\"'"
rm -rf .sn && git remote set-url origin git@github.com:Empresa/App.git
out=$(C 2>&1 || true)
check "Repositorio compartido: pregunta por NOMBRE entre los proyectos que lo usan (ssh, mayúsculas da igual)" "echo \"\$out\" | grep -q 'lo usan 2 proyectos: Tienda, Outlet' && ! echo \"\$out\" | grep -qi 'clave' && [ ! -f .sn/connectors.json ]"
check "Con el nombre que dice la persona, se conecta a ese" "C outlet | grep -q 'trabaja con \"Outlet\"' && grep -q '\"project_id\": \"p5\"' .sn/connectors.json"
rm -rf .sn && git remote set-url origin https://github.com/empresa/nuevo.git
out=$(C 2>&1 || true)
check "Repositorio que ningún proyecto tiene: muestra sus proyectos por nombre" "echo \"\$out\" | grep -q '¿En cuál de tus proyectos' && echo \"\$out\" | grep -q 'Clientes VIP'"
check "Con el nombre: conecta y registra el repositorio en ese proyecto" "C 'clientes vip' | grep -q 'quedó registrado en Altum' && C 'clientes vip' | grep -q 'ya está conectado'"
cd "$W/altum-repo"

echo "== Firma de webhooks de Altum"
cat > /tmp/sn-verify-$$.mjs <<'JS'
import { createHmac } from 'node:crypto';
import { verifyAltumSignature } from './scripts/sn/sync/altum.mjs';
const secret = 's3cr3t'; const body = '{"event":"work_item.changed"}'; const ts = Math.floor(Date.now() / 1000);
const sig = 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
const ok = verifyAltumSignature({ secret, timestamp: ts, signature: sig, rawBody: body });
const tampered = verifyAltumSignature({ secret, timestamp: ts, signature: sig, rawBody: body + ' ' });
const old = verifyAltumSignature({ secret, timestamp: ts - 600, signature: 'sha256=' + createHmac('sha256', secret).update(`${ts - 600}.${body}`).digest('hex'), rawBody: body });
console.log(ok && !tampered && !old ? 'firma-ok' : `firma-mal ${ok} ${tampered} ${old}`);
JS
cp /tmp/sn-verify-$$.mjs ./verify.mjs
check "Firma válida se acepta; alterada o de hace >5 min se rechaza" "node verify.mjs | grep -q firma-ok"

kill $MOCK 2>/dev/null; wait $MOCK 2>/dev/null
echo; echo "RESULTADO: $pass OK · $fail fallas"
