# Actualización general de Spec Driven

Equipo: cierren Claude Code y ejecuten el comando de su sistema en la terminal, desde cualquier carpeta. Requiere Claude Code y Node.js 18+ instalados. Es una actualización por computador, no por chat.

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

Debe terminar con **GENERAL VERIFICADA**. Después abran Claude Code y usen `/sn` dentro de su proyecto. El proceso deja una sola instalación general, retira las copias particulares de Softnexus de los proyectos conocidos y respalda los ajustes afectados. La API de Altum sigue sirviendo. Si indica cambios en ajustes versionados, entréguenlos mediante PR para que la declaración antigua no vuelva.

No borren carpetas del proyecto. Si falla, compartan el error; no den la actualización por terminada. Para conservar copias particulares voluntariamente, añadan `--conservar-proyectos` al comando de Node. Carpetas nunca registradas en Claude: ejecuten el mismo comando dentro de ellas.
