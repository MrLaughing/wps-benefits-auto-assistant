$ErrorActionPreference = "Stop"
$taskName = "WPS福利自动助手-打开页面"

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "已删除计划任务：$taskName"
} else {
  Write-Host "计划任务不存在：$taskName"
}
