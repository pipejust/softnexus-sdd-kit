#!/usr/bin/env bash
# Guarda TU clave personal de Altum en el Llavero de macOS y la deja cargada en cada terminal nueva.
# La clave la generas tú en Altum: Mi perfil → Mis datos → "Tu clave personal de API" → Regenerar.
# Es UNA sola para todos tus proyectos de esa empresa; este comando se corre UNA vez.
#
#   bash scripts/sn/sn-clave-altum.sh              → la guarda como SN_ALTUM_KEY (lo normal)
#   bash scripts/sn/sn-clave-altum.sh <empresa>    → SN_ALTUM_KEY_<EMPRESA>, solo si trabajas con
#                                                    varias empresas que tienen su propio Altum
set -euo pipefail
[ "$(uname)" = "Darwin" ] || { echo "Este asistente usa el Llavero de macOS. En otro sistema, pide ayuda al líder técnico."; exit 1; }
EMPRESA_RAW="${1:-}"
if [ -n "$EMPRESA_RAW" ]; then
  SUFIJO="_$(printf '%s' "$EMPRESA_RAW" | tr '[:lower:]- ' '[:upper:]__' | tr -cd 'A-Z0-9_')"
  DE=" para ${EMPRESA_RAW}"
else
  SUFIJO=""; DE=""
fi
VAR="SN_ALTUM_KEY${SUFIJO}"

echo "Pega tu clave personal de Altum${DE} y presiona Enter (no se verá en pantalla):"
security add-generic-password -U -a "$USER" -s "$VAR" -w

LINE="export ${VAR}=\"\$(security find-generic-password -a \"\$USER\" -s ${VAR} -w 2>/dev/null)\""
touch ~/.zshrc
grep -qF "$LINE" ~/.zshrc || printf '\n# Clave personal de Altum%s, guardada en el Llavero\n%s\n' "$DE" "$LINE" >> ~/.zshrc

echo "Listo: la clave quedó en el Llavero como ${VAR} y se carga sola en cada terminal nueva."
echo "Reinicia Claude Code y pídele: \"¿quién soy en Altum?\" — te dirá tu nombre y todos tus proyectos."
