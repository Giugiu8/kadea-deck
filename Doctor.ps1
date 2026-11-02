$ErrorActionPreference='Stop'
$runtime=Join-Path $env:USERPROFILE '.kadeadeck'
$installed=Join-Path $env:APPDATA 'Elgato/StreamDeck/Plugins/de.cardea.kadeadeck.sdPlugin/manifest.json'
$result=[ordered]@{pluginInstalled=(Test-Path -LiteralPath $installed);streamDeckRunning=[bool](Get-Process StreamDeck -ErrorAction SilentlyContinue);nodeAvailable=[bool](Get-Command node.exe -ErrorAction SilentlyContinue);receiverHealthy=$false}
if($result.pluginInstalled){$result.version=(Get-Content -LiteralPath $installed -Raw | ConvertFrom-Json).Version}
try{
 $connection=Get-Content -LiteralPath (Join-Path $runtime 'connection.json') -Raw | ConvertFrom-Json
 if($connection.schema -ne 1 -or $connection.port -lt 1 -or $connection.port -gt 65535 -or $connection.token -notmatch '^[a-f0-9]{64}$'){throw 'Invalid connection metadata'}
 $status=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$connection.port+'/status') -Headers @{'X-Kadea-Token'=$connection.token} -TimeoutSec 3
 $result.receiverHealthy=$status.schema -eq 1 -and $status.persistenceOk
 $result.claudeHasEvents=$status.sourceHasEvents
 $result.codexConnected=$status.codex.connected
 $result.codexKnown=$status.codex.known
 $result.codexLive=$status.codex.live
}catch{$result.receiverHealthy=$false}
# No connection token, thread IDs, project names or credentials in this report.
$result | ConvertTo-Json
