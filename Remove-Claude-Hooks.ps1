# Recovery when Cardea Deck was uninstalled before its Remove Claude hooks button was used.
# Only exact own Node hook commands are removed. Saved commands are never executed.
# -Group Status or -Group Approval removes one group; the default removes both.
param([ValidateSet('All','Status','Approval')][string]$Group='All')
$ErrorActionPreference='Stop'
$taskHome=[IO.Path]::GetFullPath($env:USERPROFILE)
function Assert-LocalPath([string]$Target){
 $absolute=[IO.Path]::GetFullPath($Target)
 if(-not $absolute.StartsWith($taskHome+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected settings path'}
 $current=$absolute
 while($true){
  if(Test-Path -LiteralPath $current){if((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked settings paths require manual removal'}}
  if($current -eq $taskHome){break};$current=[IO.Path]::GetDirectoryName($current);if(-not $current){throw 'Invalid settings path'}
 }
 return $absolute
}
function Own-Parts([string]$Node,[string]$Script,$HookEvent){
 if([IO.Path]::GetFileName($Node.Replace('/','\')) -notin @('node','node.exe')){return $false}
 $location=$Script.Replace('\','/')
 if($location -match '(?i)/de\.cardea\.(?:deck|kadeadeck)\.sdPlugin/hooks/statusline\.cjs\z'){return -not $HookEvent}
 if($location -notmatch '(?i)/de\.cardea\.(?:deck|kadeadeck)\.sdPlugin/hooks/bridge\.cjs\z'){return $false}
 return $HookEvent -cin @('SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','Notification','Stop','StopFailure','SessionEnd','SubagentStart','SubagentStop')
}
function Own-Command($Command){
 if($Command -isnot [string]){return $false}
 $parts=[regex]::Match($Command,'^"([^"\r\n]+)"\s+"([^"\r\n]+)"(?:\s+([A-Za-z]+))?\z')
 if(-not $parts.Success){$parts=[regex]::Match($Command,'^([^\s"]+)\s+([^\s"]+\.cjs)(?:\s+([A-Za-z]+))?\z')}
 if(-not $parts.Success){return $false}
 return Own-Parts $parts.Groups[1].Value $parts.Groups[2].Value $parts.Groups[3].Value
}
function Own-Hook($Hook){
 if($null -eq $Hook.args){return Own-Command $Hook.command}
 if($Hook.command -isnot [string]){return $false}
 $arguments=@($Hook.args)
 if($arguments.Count -lt 1 -or $arguments.Count -gt 2 -or @($arguments | Where-Object {$_ -isnot [string]}).Count){return $false}
 return Own-Parts $Hook.command $arguments[0] $(if($arguments.Count -eq 2){$arguments[1]}else{$null})
}
function Wanted-Hook($Hook){
 if(-not (Own-Hook $Hook)){return $false}
 if($Group -eq 'All'){return $true}
 $approval=("$($Hook.command)" -match '\sPermissionRequest\z') -or (@($Hook.args)[-1] -ceq 'PermissionRequest')
 return ($Group -eq 'Approval') -eq $approval
}
function Digest([byte[]]$Data){$algorithm=[Security.Cryptography.SHA256]::Create();try{return [Convert]::ToBase64String($algorithm.ComputeHash($Data))}finally{$algorithm.Dispose()}}
$settings=Assert-LocalPath (Join-Path $taskHome '.claude/settings.json')
$runtime=Assert-LocalPath (Join-Path $taskHome '.cardeadeck');$runtimeExisted=Test-Path -LiteralPath $runtime;[IO.Directory]::CreateDirectory($runtime) | Out-Null
# The backup holds the user's settings: a folder created here is private to this account.
if(-not $runtimeExisted){$identity=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetAccessRuleProtection($true,$false);$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')));[IO.Directory]::SetAccessControl($runtime,$acl)}
# Hooks gone means the recorded consent is gone too, even if the plugin is reinstalled later.
if($Group -ne 'Status'){$configFile=Assert-LocalPath (Join-Path $runtime 'config.json');if(Test-Path -LiteralPath $configFile){try{$config=[IO.File]::ReadAllText($configFile) | ConvertFrom-Json;$config | Add-Member -NotePropertyName approvalsEnabled -NotePropertyValue $false -Force;[IO.File]::WriteAllText($configFile,($config | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))}catch{Remove-Item -LiteralPath $configFile}}}
if(-not(Test-Path -LiteralPath $settings)){Write-Output 'No Claude settings file; nothing else to change.';exit 0}
if((Get-Item -LiteralPath $settings).Length -gt 2000000){throw 'Settings file is too large for automatic removal'}
$lock=Assert-LocalPath (Join-Path $runtime 'integrations.lock')
# A lock left behind by a process that no longer exists must not block recovery; the plugin handles it the same way.
if(Test-Path -LiteralPath $lock){$holder=$null;try{$holder=([IO.File]::ReadAllText($lock) | ConvertFrom-Json).pid}catch{};$old=((Get-Date)-(Get-Item -LiteralPath $lock).LastWriteTime).TotalMinutes -gt 10;if($old -or ($holder -is [int] -and -not (Get-Process -Id $holder -ErrorAction SilentlyContinue))){Remove-Item -LiteralPath $lock}}
$handle=[IO.File]::Open($lock,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
$temporary=$null
try{
 $lockBytes=[Text.Encoding]::UTF8.GetBytes((@{pid=$PID;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json -Compress));$handle.Write($lockBytes,0,$lockBytes.Length)
 $before=[IO.File]::ReadAllBytes($settings);$inputSettings=[Text.UTF8Encoding]::new($false,$true).GetString($before).TrimStart([char]0xFEFF) | ConvertFrom-Json
 if($inputSettings -isnot [pscustomobject]){throw 'Invalid Claude settings'}
 $changed=$false
 if($null -ne $inputSettings.hooks){
  if($inputSettings.hooks -isnot [pscustomobject]){throw 'Invalid Claude hooks'}
  foreach($property in @($inputSettings.hooks.PSObject.Properties)){
   if($property.Value -isnot [array]){throw 'Invalid hook groups'}
   $groups=@(foreach($hookGroup in $property.Value){
    if($hookGroup.hooks -isnot [array]){throw 'Invalid hook group'}
    $kept=@(foreach($hook in $hookGroup.hooks){if($hook.type -eq 'command' -and (Wanted-Hook $hook)){$changed=$true}else{$hook}})
    if($kept.Count){$hookGroup.hooks=$kept;$hookGroup}
   })
   if($groups.Count){$inputSettings.hooks.($property.Name)=$groups}else{$inputSettings.hooks.PSObject.Properties.Remove($property.Name)}
  }
  if(-not @($inputSettings.hooks.PSObject.Properties).Count){$inputSettings.PSObject.Properties.Remove('hooks')}
 }
 if($inputSettings.statusLine.type -eq 'command' -and (Wanted-Hook $inputSettings.statusLine)){$inputSettings.PSObject.Properties.Remove('statusLine');$changed=$true}
 if(-not $changed){Write-Output 'No Cardea Claude hooks found; nothing changed.';exit 0}
 $backup=Assert-LocalPath (Join-Path $runtime ('backups/hooks-removal-'+[guid]::NewGuid().ToString()));[IO.Directory]::CreateDirectory($backup) | Out-Null
 $temporary=Assert-LocalPath ($settings+'.cardea-'+[guid]::NewGuid().ToString()+'.tmp');[IO.File]::WriteAllText($temporary,($inputSettings | ConvertTo-Json -Depth 100 -WarningAction Stop)+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
 Assert-LocalPath $settings | Out-Null
 if((Digest ([IO.File]::ReadAllBytes($settings))) -ne (Digest $before)){throw 'Claude settings changed; retry removal'}
 [IO.File]::Replace($temporary,$settings,(Join-Path $backup 'settings.json'));$temporary=$null
 Write-Output 'Removed only Cardea Claude hooks. Existing settings were backed up; other hooks and status lines were preserved.'
}finally{if($temporary -and (Test-Path -LiteralPath $temporary)){Remove-Item -LiteralPath $temporary};$handle.Dispose();Remove-Item -LiteralPath $lock}
