param([Parameter(Mandatory=$true)][ValidateSet('Stop','Start')][string]$Mode)
$ErrorActionPreference='Stop'
$executable=Join-Path $env:ProgramFiles 'Elgato/StreamDeck/StreamDeck.exe'
if(-not (Test-Path -LiteralPath $executable)){throw 'Install Stream Deck in its standard Windows location first'}
if($Mode -eq 'Start') {Start-Process -FilePath $executable -WindowStyle Hidden;exit 0}
Get-Process -Name StreamDeck -ErrorAction SilentlyContinue | ForEach-Object {$_.CloseMainWindow() | Out-Null}
foreach($attempt in 1..30){if(-not (Get-Process -Name StreamDeck -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 100}
Stop-Process -Name StreamDeck -Force -ErrorAction SilentlyContinue
if(Get-Process -Name StreamDeck -ErrorAction SilentlyContinue){throw 'Close Stream Deck and retry setup'}
# This exact own SDK entry point may outlive its host. Agent apps remain running.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {([string]$_.CommandLine).Replace('\','/') -match 'de\.cardea\.kadeadeck\.sdPlugin/bin/plugin\.mjs'} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
