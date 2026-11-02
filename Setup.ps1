param([switch]$CheckOnly,[string]$DeviceId)
$ErrorActionPreference='Stop'
$nodeCommand=Get-Command node.exe -ErrorAction Stop
$setupArguments=@((Join-Path $PSScriptRoot 'setup.mjs'))
if($CheckOnly){$setupArguments+='--check'}
if($DeviceId){$setupArguments+=@('--device-id',$DeviceId)}
& $nodeCommand.Source @setupArguments
if($LASTEXITCODE -ne 0){throw 'Setup did not complete. See the message above.'}
