#!/usr/bin/env bash
# Deja el plugin Softnexus Spec Driven UNA sola vez en este computador.
#
# Sirve aunque tengas una versión vieja: no usa nada del plugin para arrancar, solo el comando
# "claude". Primero pone al día la copia general y, ya con la versión nueva, le pide a ella que
# quite las copias que vivan dentro de proyectos.
#
#   bash plugin-general.sh
#
# Al final hay que cerrar Claude Code y volver a abrirlo.
set -uo pipefail
PLUGIN="softnexus-sdd@softnexus"
REPO="pipejust/softnexus-sdd-kit"
CATALOGO="softnexus"

paso() { printf '\n→ %s\n' "$1"; }

# 1) El catálogo. Si en este computador quedó registrado como una CARPETA, "marketplace update" solo
#    la revalida: hay que traerla al día con git, o nunca verá las versiones nuevas.
carpeta=$(python3 - <<'PY' 2>/dev/null || true
import json, os
try:
    d = json.load(open(os.path.expanduser('~/.claude/plugins/known_marketplaces.json')))
    f = (d.get('softnexus') or {}).get('source') or {}
    print(f.get('path') or '' if f.get('source') in ('local', 'directory') else '')
except Exception:
    print('')
PY
)
if [ -n "${carpeta:-}" ] && [ -d "$carpeta/.git" ]; then
  paso "Tu catálogo es una carpeta de este computador: la traigo al día"
  git -C "$carpeta" pull --ff-only || echo "   (no se pudo; sigue)"
fi

if ! claude plugin marketplace list 2>/dev/null | grep -q "$CATALOGO"; then
  paso "Registro el catálogo de Softnexus"
  claude plugin marketplace add "$REPO" || true
fi

paso "Refresco el catálogo"
claude plugin marketplace update || true

# 2) La copia general: la del usuario, la que sirve en TODOS los proyectos.
if claude plugin list 2>/dev/null | grep -q "$PLUGIN"; then
  paso "Pongo al día la copia general"
  claude plugin update "$PLUGIN" || true
else
  paso "Instalo la copia general"
  claude plugin install "$PLUGIN" || true
fi

# 3) Ya con la versión nueva instalada, ella sabe quitar las copias que viven dentro de proyectos.
paso "Me aseguro de que quede encendida"
claude plugin enable "$PLUGIN" --scope user >/dev/null 2>&1 || true

motor=$(ls -d "$HOME/.claude/plugins/cache/$CATALOGO/softnexus-sdd"/*/scripts/sn-sync.mjs 2>/dev/null | sort -V | tail -1)
if [ -n "${motor:-}" ]; then
  paso "Quito las copias que vivan dentro de proyectos"
  node "$motor" limpiar-copias || true
fi

printf '\nListo. AHORA SÍ: cierra Claude Code y vuélvelo a abrir.\n'
printf 'Desde aquí, para actualizar basta con decirle al robot: "actualízame el plugin".\n'
