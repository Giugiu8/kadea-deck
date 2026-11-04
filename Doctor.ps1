$ErrorActionPreference='Stop'
$runtime=Join-Path $env:USERPROFILE '.cardeadeck'
$installed=Join-Path $env:APPDATA 'Elgato/StreamDeck/Plugins/de.cardea.deck.sdPlugin/manifest.json'
$result=[ordered]@{pluginInstalled=(Test-Path -LiteralPath $installed);streamDeckRunning=[bool](Get-Process StreamDeck -ErrorAction SilentlyContinue);nodeAvailable=[bool](Get-Command node.exe -ErrorAction SilentlyContinue);receiverHealthy=$false;receiverAuthenticated=$false}
if($result.pluginInstalled){$result.version=(Get-Content -LiteralPath $installed -Raw | ConvertFrom-Json).Version}
try{
 if($result.nodeAvailable){
  $diagnostic=(& node.exe (Join-Path $PSScriptRoot 'doctor.mjs') | Out-String | ConvertFrom-Json)
  foreach($name in @('receiverHealthy','receiverAuthenticated','claudeHasEvents','codexConnected','codexKnown','codexLive')){if($diagnostic.PSObject.Properties.Name -contains $name){$result[$name]=$diagnostic.$name}}
 }
}catch{$result.receiverHealthy=$false}
# No connection token, thread IDs, project names or credentials in this report.
$result | ConvertTo-Json
