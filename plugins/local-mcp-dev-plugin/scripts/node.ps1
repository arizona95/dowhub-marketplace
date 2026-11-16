# 사내 MCP 개발 키트 — kitdev.mjs 를 돌릴 Node 찾기(윈도우)
# PC 에 Node 22.12 이상이 있으면 그것, 없으면 사내 Git 패키지 저장소(플러그인 tools.json)에서 휴대용 Node 를 받아 %USERPROFILE%\.mcp-kit\node 에 푼다(설치·관리자 권한 없음).
# 마지막 줄: KITDEV-NODE: <node.exe 전체 경로> — 이 세션의 kitdev 실행은 그 경로로 한다.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Ok($exe) {
  if (-not $exe -or -not (Test-Path $exe)) { return $false }
  & $exe -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a==22&&b>=12)?0:1)" 2>$null
  return $LASTEXITCODE -eq 0
}

$sys = (Get-Command node -ErrorAction SilentlyContinue).Source
if (Ok $sys) { Write-Output "KITDEV-NODE: $sys"; exit 0 }

# %LOCALAPPDATA% 는 안 쓴다 — Claude 데스크톱(MSIX 패키지 앱) 안에서 쓴 파일은 앱 전용 가상 폴더(Packages\Claude_…\LocalCache)로 옮겨져
# 앱 밖(관리자 PowerShell 의 샌드박스 준비 등)에서는 그 경로에 없다(2026-11-15 윈도우 개발자 PC 실측). 사용자 폴더 바로 아래는 가상화되지 않는다.
$dir = Join-Path $env:USERPROFILE '.mcp-kit\node'
$exe = Join-Path $dir 'node.exe'
if (-not (Ok $exe)) {
  # 키트 주소 — 사내 마켓플레이스 플러그인의 kit.json, 아니면 이 워크스페이스의 .kit\workspace.json
  $pub = $null
  foreach ($f in @((Join-Path $PSScriptRoot '..\kit.json'), (Join-Path (Get-Location) '.kit\workspace.json'))) {
    if (-not $pub -and (Test-Path $f)) { $pub = (Get-Content $f -Raw | ConvertFrom-Json).public }
  }
  if (-not $pub) { Write-Output 'KITDEV-FAIL: 사내 MCP 키트 주소를 모릅니다 — 사내 마켓플레이스에서 플러그인을 다시 받으세요'; exit 1 }
  # 받을 판·파일·해시 = 플러그인 tools.json 의 "node/win-x64"(사내 Git 패키지 저장소에 있는 것)
  $t = (Get-Content (Join-Path $PSScriptRoot '..\tools.json') -Raw | ConvertFrom-Json).tools.'node/win-x64'
  if (-not $t) { Write-Output 'KITDEV-FAIL: 플러그인 tools.json 에 node/win-x64 가 없습니다 — 사내 마켓플레이스에서 플러그인을 다시 받으세요'; exit 1 }
  $zip = Join-Path $env:TEMP 'mcp-kit-node.zip'
  $tmp = Join-Path $env:TEMP 'mcp-kit-node'
  $url = "$($pub.TrimEnd('/'))/download/tools/node/$($t.version)/$($t.file)"
  Write-Output "Node 가 없어 사내 Git 패키지 저장소에서 휴대용 Node $($t.version) 을 받습니다(약 30MB, 설치 없음) — $dir"
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
    if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne $t.sha256.ToUpper()) { throw "받은 Node 의 sha256 이 tools.json 과 다릅니다 ($url)" }
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
    New-Item -ItemType Directory -Force -Path (Split-Path $dir) | Out-Null
    Move-Item (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName $dir
  } catch {
    Write-Output "KITDEV-FAIL: 휴대용 Node 를 받지 못했습니다 — $($_.Exception.Message)"; exit 1
  } finally {
    Remove-Item -Force $zip -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
  if (-not (Ok $exe)) { Write-Output "KITDEV-FAIL: 받은 Node($exe)가 실행되지 않습니다"; exit 1 }
}
Write-Output "KITDEV-NODE: $exe"
