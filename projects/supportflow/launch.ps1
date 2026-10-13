param([int]$Port = 8765)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host "SupportFlow local demo: http://127.0.0.1:$Port"
Write-Host 'Press Ctrl+C to stop. No dependencies need to be installed.'
python server.py --port $Port
