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

fallos=0
BITACORA="${TMPDIR:-/tmp}/sn-plugin.txt"
: > "$BITACORA"
# Todo lo que sale por pantalla queda también en un archivo: así, si algo falla, se manda el archivo
# completo en vez de una foto cortada de la terminal.
exec > >(tee -a "$BITACORA") 2>&1

paso() { printf '\n→ %s\n' "$1"; }
# Corre el comando y, si falla, lo deja anotado en vez de disimularlo. Hay respuestas que parecen
# error pero son el resultado que queríamos ("ya está encendido", "no estaba instalado"): esas pasan.
intentar() {
  local salida
  if salida=$("$@" 2>&1); then
    [ -n "$salida" ] && printf '%s\n' "$salida"
    return 0
  fi
  printf '%s\n' "$salida"
  if printf '%s' "$salida" | grep -qiE 'already enabled|ya está (habilitado|activado|encendid)|not installed|no está instalad|installed in user scope|ya no existe|but not all|could not be refreshed'; then
    printf '   (ya estaba así: nada que hacer)\n'
    return 0
  fi
  # La línea que de verdad explica el fallo, para que se vea sin tener que subir en la terminal.
  local motivo
  motivo=$(printf '%s' "$salida" | grep -E '✘|✗|[Ee]rror|[Ff]ail|denied|ENOENT|EINVAL|EACCES' | grep -v 'NO SE PUDO: node' | tail -1 | sed 's/^ *//')
  printf '   ✗ NO SE PUDO: %s\n' "$*"
  [ -n "$motivo" ] && printf '     MOTIVO: %s\n' "$motivo"
  fallos=$((fallos + 1))
}

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
  intentar git -C "$carpeta" pull --ff-only
fi

if ! claude plugin marketplace list 2>/dev/null | grep -q "$CATALOGO"; then
  paso "Registro el catálogo de Softnexus"
  intentar claude plugin marketplace add "$REPO"
fi

paso "Refresco el catálogo de Softnexus"
intentar claude plugin marketplace update "$CATALOGO"

# 2) La copia general: la del usuario, la que sirve en TODOS los proyectos.
if claude plugin list 2>/dev/null | grep -q "$PLUGIN"; then
  paso "Pongo al día la copia general"
  intentar claude plugin update "$PLUGIN"
else
  paso "Instalo la copia general"
  intentar claude plugin install "$PLUGIN"
fi

# 3) Ya con la versión nueva instalada, ella sabe quitar las copias que viven dentro de proyectos.
paso "Me aseguro de que quede encendida"
intentar claude plugin enable "$PLUGIN" --scope user

motor=$(ls -d "$HOME/.claude/plugins/cache/$CATALOGO/softnexus-sdd"/*/scripts/sn-sync.mjs 2>/dev/null | sort -V | tail -1)
if [ -n "${motor:-}" ]; then
  paso "Quito las copias que vivan dentro de proyectos"
  intentar node "$motor" limpiar-copias
fi

if [ "$fallos" -gt 0 ]; then
  printf '\n⚠️  ATENCIÓN: %s paso(s) NO se pudieron hacer (están marcados con ✗ arriba).\n' "$fallos"
  printf 'NO quedó completo. Mándale al líder técnico este archivo, que tiene TODO:\n   %s\n' "$BITACORA"
  exit 1
fi

printf '\nListo. AHORA SÍ: cierra Claude Code y vuélvelo a abrir.\n'
printf 'Comprueba con: claude plugin list   (tiene que decir activo y la última versión)\n'
printf 'Desde aquí, para actualizar basta con decirle al robot: "actualízame el plugin".\n'
