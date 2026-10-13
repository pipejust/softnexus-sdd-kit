# Actualización general de Spec Driven

Equipo: este actualizador sirve para **Claude Code, Codex y ChatGPT de escritorio con trabajo local**. Ejecuten el comando de su sistema desde cualquier carpeta de la terminal. Necesitan Node.js 18+ y su cliente actualizado; quienes usan Codex o ChatGPT no necesitan instalar Claude. La actualización es general por usuario y cliente, no por proyecto ni por chat.

**Mac:**
```bash
curl -fsSL https://sd.softnexus.io/actualizar.mjs -o /tmp/sn-actualizar.mjs && node /tmp/sn-actualizar.mjs
```

**Windows (PowerShell):**
```powershell
& {
  $ErrorActionPreference = 'Stop'
  $sn = Join-Path $env:TEMP 'sn-actualizar.mjs'
  Invoke-WebRequest -UseBasicParsing 'https://sd.softnexus.io/actualizar.mjs' -OutFile $sn
  node $sn
  if ($LASTEXITCODE -ne 0) { throw 'Actualización incompleta: revisa el error anterior.' }
}
```

Debe mostrar **VERIFICADO** para cada cliente detectado y terminar con **GENERAL VERIFICADA**, sin errores. Reinicien su aplicación. En Claude usen `/sn`; en Codex/ChatGPT seleccionen la skill `sn` dentro del proyecto y revisen/autoricen los hooks que solicite la aplicación.

Sus API de Altum siguen sirviendo. El proceso respalda y retira las copias particulares conocidas de Softnexus; si indica cambios versionados, entréguenlos mediante PR. No borren carpetas manualmente. Si falla, compartan el error.

Para actualizar solo una herramienta añadan `--cliente claude`, `--cliente codex` o `--cliente chatgpt` al comando de Node. Si falta el comando `codex`, actualicen la aplicación o instalen Codex CLI. Antigravity, Orca y ChatGPT web/nube requieren su propia integración; este comando no afirma actualizarlos.
