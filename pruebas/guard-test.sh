#!/usr/bin/env bash
# Prueba del guard: cada caso dice qué comando y qué debe pasar (2 = bloquear, 0 = dejar pasar).
# Los casos viven en guard-cases.json; varios tienen saltos de línea (heredocs), por eso los corre node.
set -uo pipefail
export SN_MOTOR_PROPIO=1   # las pruebas usan ESTE motor, no el plugin instalado en el computador
T="$(cd "$(dirname "$0")" && pwd)"
GUARD="$(cd "$T/../plugin/hooks" && pwd)/guard.mjs"

# Repo chiquito para los casos de migraciones (necesitan git ls-files y archivos reales en disco):
# una migración YA guardada (versionada) y otra que el agente acaba de crear (sin commit todavía).
M="$T/tmp/guard-migraciones"; rm -rf "$M"; mkdir -p "$M/supabase/migrations"
(cd "$M" && git init -q -b main && git config user.email t@x && git config user.name t \
  && echo "create table x();" > supabase/migrations/001_vieja.sql && git add -A && git commit -qm base \
  && echo "create table y();" > supabase/migrations/002_nueva.sql)

node --input-type=module -e '
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const [casos, guard, migRepo] = process.argv.slice(1);
let ok = 0; let mal = 0;
for (const [cmd, esperado, desc] of JSON.parse(readFileSync(casos, "utf8"))) {
  // Un caso es un comando de Bash, o la llamada completa de otra herramienta (objeto), o null (payload vacío).
  let llamada = typeof cmd === "string" ? { tool_name: "Bash", tool_input: { command: cmd } } : cmd;
  if (llamada?.cwd === "<<M>>") llamada = { ...llamada, cwd: migRepo };
  const r = spawnSync(process.execPath, [guard], { input: JSON.stringify(llamada), encoding: "utf8" });
  if (r.status === esperado) { console.log(`OK    ${desc}`); ok += 1; } else { console.log(`FALLA ${desc} (esperaba ${esperado}, dio ${r.status}) ${r.stderr.split("\n")[0]}`); mal += 1; }
}
console.log(`\nRESULTADO: ${ok} OK · ${mal} fallas`);
' "$T/guard-cases.json" "$GUARD" "$M"
