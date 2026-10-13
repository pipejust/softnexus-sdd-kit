# Arranque verificado desde cualquier carpeta; no requiere SN instalado.
param([switch]$Verificar, [ValidateSet('auto','claude','codex','chatgpt','todos')][string]$Cliente='auto', [switch]$ConservarProyectos)
$ErrorActionPreference = 'Stop'
$archivo = Join-Path ([IO.Path]::GetTempPath()) ("sn-actualizar-" + [guid]::NewGuid().ToString() + '.mjs')
$codigo = 1
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Falta Node.js 18 o superior.' }
    Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/pipejust/softnexus-sdd-kit/main/herramientas/actualizar-plugin.mjs' -OutFile $archivo
    $snArgumentos = @($archivo, '--cliente', $Cliente)
    if ($Verificar) { $snArgumentos += '--verificar' }
    if ($ConservarProyectos) { $snArgumentos += '--conservar-proyectos' }
    & node @snArgumentos
    $codigo = $LASTEXITCODE
} catch { Write-Error -ErrorAction Continue $_; $codigo = 1 }
finally { if (Test-Path $archivo) { Remove-Item $archivo -Force } }
exit $codigo
