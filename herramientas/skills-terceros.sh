#!/usr/bin/env bash
# Trae la última versión de las skills de terceros incluidas en el plugin.
# Solo reemplaza las carpetas de la lista; revisa el diff y entrégalo por PR.
#   bash herramientas/skills-terceros.sh
set -euo pipefail
DEST="$(cd "$(dirname "$0")/.." && pwd)/plugin/skills"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# repo | ruta dentro del repo | licencia | skills
LISTA=(
  "emilkowalski/skills|skills|MIT|emil-design-eng break-ui mobile-native review-animations animate animation-performance prototype"
  "anthropics/skills|skills|Apache-2.0|frontend-design"
)
for fila in "${LISTA[@]}"; do
  IFS='|' read -r repo base licencia skills <<<"$fila"
  dir="$TMP/${repo//\//_}"
  git clone -q --depth 1 "https://github.com/$repo.git" "$dir"
  commit="$(git -C "$dir" rev-parse HEAD)"
  for s in $skills; do
    [ -f "$dir/$base/$s/SKILL.md" ] || { echo "FALTA $repo/$base/$s"; exit 1; }
    rm -rf "${DEST:?}/$s"; cp -R "$dir/$base/$s" "$DEST/$s"
    [ -f "$DEST/$s/LICENSE.txt" ] || cp "$dir/LICENSE" "$DEST/$s/LICENSE"
    printf '# Origen\n\nSkill de terceros incluida sin cambios en el plugin Softnexus.\n\n- Repositorio: https://github.com/%s\n- Ruta: `%s`\n- Commit: `%s`\n- Licencia: %s (ver archivo de licencia en esta carpeta)\n\nPara traer una versión nueva: `bash herramientas/skills-terceros.sh`.\n' \
      "$repo" "$base/$s" "$commit" "$licencia" > "$DEST/$s/ORIGEN.md"
    echo "ok $s ($repo@${commit:0:7})"
  done
done
echo "Listo. Revisa 'git diff plugin/skills', corre 'bash pruebas/todas.sh' y sube la versión del plugin."
