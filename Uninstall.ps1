$ErrorActionPreference='Stop'
$nodeCommand=Get-Command node.exe -ErrorAction Stop
& $nodeCommand.Source (Join-Path $PSScriptRoot 'setup.mjs') --uninstall
if($LASTEXITCODE -ne 0){throw 'Uninstall did not complete. See the message above.'}
