param([Parameter(Mandatory=$true)][ValidateSet('Stop','Start')][string]$Mode,[string]$PreviousPluginId)
$ErrorActionPreference='Stop'
$executable=Join-Path $env:ProgramFiles 'Elgato/StreamDeck/StreamDeck.exe'
if(-not (Test-Path -LiteralPath $executable)){throw 'Install Stream Deck in its standard Windows location first'}
if($Mode -eq 'Start') {Start-Process -FilePath $executable -ArgumentList '--runinbk';exit 0}
Get-Process -Name StreamDeck -ErrorAction SilentlyContinue | ForEach-Object {$_.CloseMainWindow() | Out-Null}
foreach($attempt in 1..30){if(-not (Get-Process -Name StreamDeck -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 100}
Stop-Process -Name StreamDeck -Force -ErrorAction SilentlyContinue
foreach($attempt in 1..50){if(-not (Get-Process -Name StreamDeck -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 100}
if(Get-Process -Name StreamDeck -ErrorAction SilentlyContinue){throw 'Close Stream Deck and retry setup'}
# This exact own SDK entry point may outlive its host. Agent apps remain running.
if($PreviousPluginId -and $PreviousPluginId -notmatch '^[a-z0-9]+(?:\.[a-z0-9]+)+$'){throw 'Invalid previous plugin identity'}
$pluginIds=@('de.cardea.deck');if($PreviousPluginId){$pluginIds+=,$PreviousPluginId}
$nodeProcesses=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'")
foreach($pluginId in $pluginIds){
 $folder=[regex]::Escape(($pluginId+'.sdPlugin'))
 $entry='(?i)(?:^|[/"\s])'+$folder+'/bin/plugin\.mjs(?=$|["\s])'
 $sdkProcesses=@($nodeProcesses | Where-Object {([string]$_.CommandLine).Replace('\','/') -match $entry})
 foreach($sdk in $sdkProcesses){
  $parentId=[int]$sdk.ProcessId
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$parentId" | Where-Object {$_.Name -ieq 'codex.exe' -and ([string]$_.ExecutablePath).Replace('\','/') -match '(?i)/codex\.exe$' -and ([string]$_.CommandLine).Replace('\','/') -match '(?i)codex\.exe"?\s+app-server(?:\s|$)'} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
  Stop-Process -Id $parentId -Force -ErrorAction SilentlyContinue
 }
}
