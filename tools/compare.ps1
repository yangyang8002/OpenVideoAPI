$ErrorActionPreference = 'Continue'
$root = 'E:\github\OpenVideoAPI\OpenVideoAPI'
$d1 = Join-Path $env:TEMP ('ova-cmp-orig-' + [guid]::NewGuid().ToString('N').Substring(0,8))
$d2 = Join-Path $env:TEMP ('ova-cmp-new-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $d1, $d2 | Out-Null
cmd /c "git show HEAD:server.js > server-orig-tmp.js" | Out-Null
$o1 = Join-Path $d1 'out.log'; $o2 = Join-Path $d2 'out.log'
$env:OPENVIDEO_DATA_DIR = $d1; $env:PORT = '3920'
$p1 = Start-Process -FilePath node -ArgumentList 'server-orig-tmp.js' -WorkingDirectory $root -RedirectStandardOutput $o1 -RedirectStandardError (Join-Path $d1 'err.log') -PassThru -WindowStyle Hidden
$env:OPENVIDEO_DATA_DIR = $d2; $env:PORT = '3919'
$p2 = Start-Process -FilePath node -ArgumentList 'server.js' -WorkingDirectory $root -RedirectStandardOutput $o2 -RedirectStandardError (Join-Path $d2 'err.log') -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 5
Remove-Item Env:OPENVIDEO_DATA_DIR -ErrorAction SilentlyContinue
node tools\probe-compare.js http://127.0.0.1:3920 http://127.0.0.1:3919
Stop-Process -Id $p1.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $p2.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 600
Remove-Item (Join-Path $root 'server-orig-tmp.js') -Force -ErrorAction SilentlyContinue
Write-Output ('orig-exited=' + $p1.HasExited + ' new-exited=' + $p2.HasExited)
Write-Output ('orig-log: ' + (Get-Content $o1 -TotalCount 3 | ForEach-Object { $_ }) -join ' | ')
