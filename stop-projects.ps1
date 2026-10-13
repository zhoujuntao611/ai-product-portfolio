$ErrorActionPreference = 'Stop'
$processFile = Join-Path $PSScriptRoot '.local-runtime\owned-processes.json'
if (-not (Test-Path -LiteralPath $processFile)) { Write-Host 'No launcher-owned services are recorded.'; exit 0 }
$entries = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
foreach ($entry in $entries) {
    $process = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    $record = Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$entry.Id)
    if ($entry.StartTime -is [datetime]) { $expectedStart = $entry.StartTime.ToUniversalTime() }
    else { $expectedStart = [datetime]::Parse($entry.StartTime, $null, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime() }
    $sameProcess = [Math]::Abs(($process.StartTime.ToUniversalTime()-$expectedStart).TotalSeconds) -lt 2
    if ($sameProcess -and $record.CommandLine.Contains([string]$entry.Script)) { Stop-Process -Id $entry.Id; Write-Host ('Stopped local project service '+$entry.Id) }
}
