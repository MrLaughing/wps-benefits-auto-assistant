$ErrorActionPreference = "Stop"

$taskName = "WPS福利自动助手-打开页面"
$edgeCandidates = @(
  "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$edge = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $edge) {
  throw "未找到 Microsoft Edge。"
}

$benefitsUrl = "https://personal-act.wps.cn/rubik2/portal/HD2025031721339450/YM2025031721331326?position=android_aty_fl_grzx2002"
$taskUrl = "https://personal-act.wps.cn/rubik2/portal/HD2025031821201822/YM2025040908558269?position=pc_ysmb1003_pc_dzx_rwzx&hide-banner-userinfo=1"
$iamtxtUrl = "https://www.iamtxt.com/"
$arguments = "--profile-directory=Default `"$benefitsUrl`" `"$taskUrl`" `"$iamtxtUrl`""

$action = New-ScheduledTaskAction -Execute $edge -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At "09:48"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "每天 09:48 用默认 Edge 配置打开 WPS 任务中心、福利中心和 iamtxt 签到页。" `
  -Force | Out-Null

Write-Host "已创建计划任务：$taskName"
Write-Host "执行时间：每天 09:48"
Write-Host "Edge：$edge"
