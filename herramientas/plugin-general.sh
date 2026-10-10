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

if ! command -v node >/dev/null 2>&1; then
  echo "No encuentro \"node\" en este computador. Instálalo (nodejs.org) y vuelve a correr este script." >&2
  exit 1
fi

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
  # Qué es "ya estaba así" depende del comando (YA_ESTABA lo dice cada llamada): "no está instalado"
  # al ACTUALIZAR es un fallo de verdad, no algo que se pueda dejar pasar.
  if [ -n "${YA_ESTABA:-}" ] && printf '%s' "$salida" | grep -qiE "$YA_ESTABA"; then
    printf '   (ya estaba así: nada que hacer)\n'
    return 0
  fi
  # La línea que de verdad explica el fallo, para que se vea sin tener que subir en la terminal.
  local motivo
  motivo=$(printf '%s' "$salida" | grep -E '✘|✗|[Ee]rror|[Ff]ail|denied|ENOENT|EINVAL|EACCES|not found|no se reconoce|is not recognized' | grep -v 'NO SE PUDO: node' | tail -1 | sed 's/^ *//')
  printf '   ✗ NO SE PUDO: %s\n' "$*"
  [ -n "$motivo" ] && printf '     MOTIVO: %s\n' "$motivo"
  fallos=$((fallos + 1))
}

# 1) El catálogo. Si en este computador quedó registrado como una CARPETA, "marketplace update" solo
#    la revalida: hay que traerla al día con git, o nunca verá las versiones nuevas.
carpeta=$(node -e '
try {
  const t = require("fs").readFileSync(require("path").join(require("os").homedir(), ".claude/plugins/known_marketplaces.json"), "utf8").replace(/^\uFEFF/, "");
  const f = (JSON.parse(t).softnexus || {}).source || {};
  process.stdout.write(["local", "directory"].includes(f.source) ? (f.path || "") : "");
} catch {}
' 2>/dev/null || true)
if [ -n "${carpeta:-}" ] && [ -d "$carpeta/.git" ]; then
  paso "Tu catálogo es una carpeta de este computador: la traigo al día"
  intentar git -C "$carpeta" pull --ff-only
fi

if ! claude plugin marketplace list 2>/dev/null | grep -q "$CATALOGO"; then
  paso "Registro el catálogo de Softnexus"
  intentar claude plugin marketplace add "$REPO"
fi

paso "Refresco el catálogo de Softnexus"
YA_ESTABA='but not all|could not be refreshed' intentar claude plugin marketplace update "$CATALOGO"

# 2) La copia general: la del usuario, la que sirve en TODOS los proyectos. Se mira si existe la de
#    USUARIO (no cualquiera: "claude plugin list" también muestra las de proyectos, y entonces se
#    intentaba actualizar una copia general que no existía).
general() {
  node -e '
try {
  const t = require("fs").readFileSync(require("path").join(require("os").homedir(), ".claude/plugins/installed_plugins.json"), "utf8").replace(/^\uFEFF/, "");
  const u = ((JSON.parse(t).plugins || {})[process.argv[1]] || []).find((i) => i.scope === "user");
  process.stdout.write(u ? (process.argv[2] === "ruta" ? u.installPath || "" : "si") : "");
} catch {}
' "$PLUGIN" "${1:-}" 2>/dev/null || true
}
if [ -n "$(general)" ]; then
  paso "Pongo al día la copia general"
  intentar claude plugin update "$PLUGIN"
else
  paso "Instalo la copia general"
  YA_ESTABA='already installed|ya está instalad' intentar claude plugin install "$PLUGIN"
fi

# 3) Ya con la versión nueva instalada, ella sabe quitar las copias que viven dentro de proyectos.
paso "Me aseguro de que quede encendida"
YA_ESTABA='already enabled|ya está (habilitado|activado|encendid)' intentar claude plugin enable "$PLUGIN" --scope user

ruta=$(general ruta)
motor="${ruta:+$ruta/scripts/sn-sync.mjs}"
if [ "$fallos" -eq 0 ] && [ -n "${motor:-}" ] && [ -f "$motor" ]; then
  paso "Quito las copias que vivan dentro de proyectos"
  intentar node "$motor" limpiar-copias
elif [ "$fallos" -gt 0 ]; then
  echo "Conservo las copias de los proyectos: la instalación general no quedó confirmada."
fi

if [ "$fallos" -gt 0 ]; then
  printf '\n⚠️  ATENCIÓN: %s paso(s) NO se pudieron hacer (están marcados con ✗ arriba).\n' "$fallos"
  printf 'NO quedó completo. Mándale al líder técnico este archivo, que tiene TODO:\n   %s\n' "$BITACORA"
  exit 1
fi

printf '\nListo. AHORA SÍ: cierra Claude Code y vuélvelo a abrir.\n'
printf 'Comprueba con: claude plugin list   (tiene que decir activo y la última versión)\n'
printf 'Desde aquí, para actualizar basta con decirle al robot: "actualízame el plugin".\n'
