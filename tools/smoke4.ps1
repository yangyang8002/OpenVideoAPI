$ErrorActionPreference = 'Continue'
$root = 'E:\github\OpenVideoAPI\OpenVideoAPI'
$data = Join-Path $env:TEMP ('ova-smoke-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $data | Out-Null
$env:OPENVIDEO_DATA_DIR = $data
$env:PORT = '3919'
$stdout = Join-Path $data 'out.log'; $stderr = Join-Path $data 'err.log'
$proc = Start-Process -FilePath node -ArgumentList 'server.js' -WorkingDirectory $root -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4
$base = 'http://127.0.0.1:3919'
function Probe($name, $method, $url, $body) {
  try {
    if ($method -eq 'GET') { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 }
    else { $r = Invoke-WebRequest -Uri $url -Method $method -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 10 }
    $snippet = $r.Content; if ($snippet.Length -gt 180) { $snippet = $snippet.Substring(0,180) }
    Write-Output ("{0}: {1} | {2}" -f $name, [int]$r.StatusCode, ($snippet -replace "`r?`n", ' '))
  } catch {
    $resp = $_.Exception.Response
    if ($resp) { Write-Output ("{0}: HTTP {1} (non-2xx handled)" -f $name, [int]$resp.StatusCode) }
    else { Write-Output ("{0}: FAILED {1}" -f $name, $_.Exception.Message) }
  }
}
Probe 'GET /healthz'      'GET'  "$base/healthz" $null
Probe 'GET /player/'      'GET'  "$base/player/" $null
Probe 'GET /admin/'       'GET'  "$base/admin/" $null
Probe 'GET /api/danmu/v3' 'GET'  "$base/api/danmu/v3/?id=test123" $null
Probe 'POST /api/video/resolve' 'POST' "$base/api/video/resolve" '{}'
Probe 'POST /api/admin/login'   'POST' "$base/api/admin/login" '{}'
Write-Output '--- boot log (first 40 lines) ---'
Get-Content $stdout -TotalCount 40 | ForEach-Object { $_ }
$err = Get-Content $stderr -ErrorAction SilentlyContinue
if ($err) { Write-Output '--- stderr ---'; $err | Select-Object -First 15 | ForEach-Object { $_ } }
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Write-Output ("PROC-STOPPED: " + ($proc.HasExited))
Write-Output ("DATA-DIR: " + $data)
