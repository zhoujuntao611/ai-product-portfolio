param([int]$Port = 8766, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$serviceUrl = "http://127.0.0.1:$Port"
try {
    $existing = Invoke-RestMethod -Uri "$serviceUrl/api/health" -TimeoutSec 2
    if ($existing.app -eq 'MetricPilot' -and $existing.status -eq 'ok') {
        Write-Host "MetricPilot already running: $serviceUrl"
        if (-not $NoBrowser) { Start-Process $serviceUrl }
        exit 0
    }
    throw "Port $Port is used by a different application."
} catch {
    if ($_.Exception.Message -like '*different application*') { throw }
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $Port is occupied. Use -Port 8866, or stop your own existing service."
    }
}
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) { throw 'Python 3.10+ is required. Install it and add it to PATH.' }
$dataDir = Join-Path $projectDir 'data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$appPath = Join-Path $projectDir 'app.py'
$process = Start-Process -FilePath $pythonCommand.Source -ArgumentList @(('"' + $appPath + '"'), '--port', "$Port") -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataDir 'server.stdout.log') -RedirectStandardError (Join-Path $dataDir 'server.stderr.log') -PassThru
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 200
    if ($process.HasExited) { throw 'Service exited. Check data/server.stderr.log.' }
    try {
        $health = Invoke-RestMethod -Uri "$serviceUrl/api/health" -TimeoutSec 1
        if ($health.app -eq 'MetricPilot' -and $health.status -eq 'ok') { $ready = $true; break }
    } catch {}
}
if (-not $ready) { throw "Service not ready. Check data/server.stderr.log. PID: $($process.Id)" }
Write-Host "MetricPilot ready: $serviceUrl"
Write-Host "Service PID: $($process.Id). Stop with: Stop-Process -Id $($process.Id)"
if (-not $NoBrowser) { Start-Process $serviceUrl }
