param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$portfolioRoot = $PSScriptRoot
$runtimeFolder = Join-Path $portfolioRoot '.local-runtime'
New-Item -ItemType Directory -Path $runtimeFolder -Force | Out-Null
$pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $pythonCommand) { throw 'Python 3.10 or later is required. Install Python and run this launcher again.' }
$pythonVersion = & $pythonCommand.Source -c 'import sys; print(sys.version_info.major,sys.version_info.minor)'
$versionParts = $pythonVersion.Trim().Split(' ')
if ([int]$versionParts[0] -ne 3 -or [int]$versionParts[1] -lt 10) { throw 'Python 3.10 or later is required.' }
$ownedProcesses = @()
$processFile = Join-Path $runtimeFolder 'owned-processes.json'
if (Test-Path -LiteralPath $processFile) {
    try {
        $loadedRecords = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
        foreach ($loadedRecord in $loadedRecords) {
            if ($loadedRecord.Id -isnot [array] -and (Get-Process -Id $loadedRecord.Id -ErrorAction SilentlyContinue)) { $ownedProcesses += $loadedRecord }
        }
    } catch { }
}
$apps = @(
    @{Name='SupportFlow'; Port=8765; Health='/api/health'; Script=(Join-Path $portfolioRoot 'projects\supportflow\server.py')},
    @{Name='MetricPilot'; Port=8766; Health='/api/meta'; Script=(Join-Path $portfolioRoot 'projects\metricpilot\app.py')}
)
foreach ($app in $apps) {
    $healthUrl = 'http://127.0.0.1:{0}{1}' -f $app.Port, $app.Health
    $alreadyRunning = $false
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        if ($health.app -eq $app.Name -or $health.name -eq $app.Name) { $alreadyRunning = $true }
        else { throw 'The port is already used by another service.' }
    } catch {
        $activePort = Get-NetTCPConnection -LocalPort $app.Port -State Listen -ErrorAction SilentlyContinue
        if ($activePort -and -not $alreadyRunning) { throw ('Port {0} is in use. Close the other service or launch each project on another port.' -f $app.Port) }
    }
    if (-not $alreadyRunning) {
        $arguments = '"{0}" --port {1}' -f $app.Script, $app.Port
        $process = Start-Process -FilePath $pythonCommand.Source -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $app.Script) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeFolder ($app.Name+'.out.log')) -RedirectStandardError (Join-Path $runtimeFolder ($app.Name+'.err.log'))
        $ownedProcesses += @{Id=$process.Id; Script=$app.Script; StartTime=$process.StartTime.ToUniversalTime().ToString('o')}
        ConvertTo-Json -InputObject @($ownedProcesses) | Set-Content -LiteralPath $processFile -Encoding UTF8
        $ready = $false
        for ($attempt=0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 300
            try { $check = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1; if ($check.app -eq $app.Name -or $check.name -eq $app.Name) { $ready = $true; break } } catch { }
        }
        if (-not $ready) { throw ($app.Name+' did not start. See .local-runtime logs.') }
    }
    Write-Host ($app.Name+' ready: http://127.0.0.1:'+$app.Port)
}
ConvertTo-Json -InputObject @($ownedProcesses) | Set-Content -LiteralPath $processFile -Encoding UTF8
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8765'; Start-Process 'http://127.0.0.1:8766' }
Write-Host 'Use stop-projects.cmd when finished.'
