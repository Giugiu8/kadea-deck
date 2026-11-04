# Recovery when Cardea Deck was uninstalled before its Remove Claude hooks button was used.
# Only exact own Node hook commands are removed. Saved commands are never executed.
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
function Own-Command($Command){
 if($Command -isnot [string]){return $false}
 $parts=[regex]::Match($Command,'^"([^"\r\n]+)"\s+"([^"\r\n]+)"(?:\s+([A-Za-z]+))?\z')
 if(-not $parts.Success){return $false}
 if([IO.Path]::GetFileName($parts.Groups[1].Value.Replace('/','\')) -notin @('node','node.exe')){return $false}
 $script=$parts.Groups[2].Value.Replace('\','/')
 if($script -match '(?i)/de\.cardea\.(?:deck|kadeadeck)\.sdPlugin/hooks/statusline\.cjs\z'){return -not $parts.Groups[3].Success}
 if($script -notmatch '(?i)/de\.cardea\.(?:deck|kadeadeck)\.sdPlugin/hooks/bridge\.cjs\z'){return $false}
 return $parts.Groups[3].Value -cin @('SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','Notification','Stop','StopFailure','SessionEnd','SubagentStart','SubagentStop')
}
function Digest([byte[]]$Data){$algorithm=[Security.Cryptography.SHA256]::Create();try{return [Convert]::ToBase64String($algorithm.ComputeHash($Data))}finally{$algorithm.Dispose()}}
$settings=Assert-LocalPath (Join-Path $taskHome '.claude/settings.json')
if(-not(Test-Path -LiteralPath $settings)){Write-Output 'No Claude settings file; nothing changed.';exit 0}
if((Get-Item -LiteralPath $settings).Length -gt 2000000){throw 'Settings file is too large for automatic removal'}
$runtime=Assert-LocalPath (Join-Path $taskHome '.cardeadeck');[IO.Directory]::CreateDirectory($runtime) | Out-Null
$lock=Assert-LocalPath (Join-Path $runtime 'integrations.lock');$handle=[IO.File]::Open($lock,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
$temporary=$null
try{
 $lockBytes=[Text.Encoding]::UTF8.GetBytes((@{pid=$PID;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json -Compress));$handle.Write($lockBytes,0,$lockBytes.Length)
 $before=[IO.File]::ReadAllBytes($settings);$inputSettings=[Text.Encoding]::UTF8.GetString($before).TrimStart([char]0xFEFF) | ConvertFrom-Json
 if($inputSettings -isnot [pscustomobject]){throw 'Invalid Claude settings'}
 $changed=$false
 if($null -ne $inputSettings.hooks){
  if($inputSettings.hooks -isnot [pscustomobject]){throw 'Invalid Claude hooks'}
  foreach($property in @($inputSettings.hooks.PSObject.Properties)){
   if($property.Value -isnot [array]){throw 'Invalid hook groups'}
   $groups=@(foreach($group in $property.Value){
    if($group.hooks -isnot [array]){throw 'Invalid hook group'}
    $kept=@(foreach($hook in $group.hooks){if($hook.type -eq 'command' -and (Own-Command $hook.command)){$changed=$true}else{$hook}})
    if($kept.Count){$group.hooks=$kept;$group}
   })
   if($groups.Count){$inputSettings.hooks.($property.Name)=$groups}else{$inputSettings.hooks.PSObject.Properties.Remove($property.Name)}
  }
  if(-not @($inputSettings.hooks.PSObject.Properties).Count){$inputSettings.PSObject.Properties.Remove('hooks')}
 }
 if($inputSettings.statusLine.type -eq 'command' -and (Own-Command $inputSettings.statusLine.command)){$inputSettings.PSObject.Properties.Remove('statusLine');$changed=$true}
 if(-not $changed){Write-Output 'No Cardea Claude hooks found; nothing changed.';exit 0}
 $backup=Assert-LocalPath (Join-Path $runtime ('backups/hooks-removal-'+[guid]::NewGuid().ToString()));[IO.Directory]::CreateDirectory($backup) | Out-Null
 $temporary=Assert-LocalPath ($settings+'.cardea-'+[guid]::NewGuid().ToString()+'.tmp');[IO.File]::WriteAllText($temporary,($inputSettings | ConvertTo-Json -Depth 100 -WarningAction Stop)+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
 Assert-LocalPath $settings | Out-Null
 if((Digest ([IO.File]::ReadAllBytes($settings))) -ne (Digest $before)){throw 'Claude settings changed; retry removal'}
 [IO.File]::Replace($temporary,$settings,(Join-Path $backup 'settings.json'));$temporary=$null
 Write-Output 'Removed only Cardea Claude hooks. Existing settings were backed up; other hooks and status lines were preserved.'
}finally{if($temporary -and (Test-Path -LiteralPath $temporary)){Remove-Item -LiteralPath $temporary};$handle.Dispose();Remove-Item -LiteralPath $lock}
