#!/bin/sh
# 사내 MCP 개발 키트 — kitdev.mjs 를 돌릴 Node 찾기(리눅스). PC 에 Node 22.12 이상이 있으면 그것, 없으면 사내 키트에서 휴대용 Node 를
# (사내 Git 패키지 저장소 — 플러그인 tools.json) 받아 ~/.mcp-kit/node 에 푼다(설치·관리자 권한 없음). 마지막 줄: KITDEV-NODE: <node 전체 경로>
set -eu
ok() { [ -x "$1" ] && "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a==22&&b>=12)?0:1)' 2>/dev/null; }
SYS=$(command -v node 2>/dev/null || true)
if [ -n "$SYS" ] && ok "$SYS"; then echo "KITDEV-NODE: $SYS"; exit 0; fi
DIR="$HOME/.mcp-kit/node"; EXE="$DIR/bin/node"
if ! ok "$EXE"; then
  HERE=$(cd "$(dirname "$0")" && pwd)
  PUB=$(sed -n 's/.*"public" *: *"\([^"]*\)".*/\1/p' "$HERE/../kit.json" 2>/dev/null | head -1)
  [ -n "$PUB" ] || PUB=$(sed -n 's/.*"public" *: *"\([^"]*\)".*/\1/p' .kit/workspace.json 2>/dev/null | head -1)
  [ -n "$PUB" ] || { echo "KITDEV-FAIL: 사내 MCP 키트 주소를 모릅니다 — 사내 마켓플레이스에서 플러그인을 다시 받으세요"; exit 1; }
  # 받을 판·파일·해시 = 플러그인 tools.json 의 "node/linux-x64" 줄(사내 Git 패키지 저장소에 있는 것)
  T=$(grep '"node/linux-x64"' "$HERE/../tools.json" 2>/dev/null || true)
  f() { printf '%s' "$T" | sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p"; }
  VER=$(f version); FILE=$(f file); SUM=$(f sha256)
  [ -n "$FILE" ] || { echo "KITDEV-FAIL: 플러그인 tools.json 에 node/linux-x64 가 없습니다 — 사내 마켓플레이스에서 플러그인을 다시 받으세요"; exit 1; }
  echo "Node 가 없어 사내 Git 패키지 저장소에서 휴대용 Node $VER 을 받습니다(약 30MB, 설치 없음) — $DIR"
  TMP=$(mktemp -d)
  curl -fsSL "${PUB%/}/download/tools/node/$VER/$FILE" -o "$TMP/node.tar.xz" || { echo "KITDEV-FAIL: 휴대용 Node 를 받지 못했습니다 — ${PUB%/}/download/tools/node/$VER/$FILE"; rm -rf "$TMP"; exit 1; }
  echo "$SUM  $TMP/node.tar.xz" | sha256sum -c - >/dev/null 2>&1 || { echo "KITDEV-FAIL: 받은 Node 의 sha256 이 tools.json 과 다릅니다"; rm -rf "$TMP"; exit 1; }
  mkdir -p "$TMP/x" && tar xJf "$TMP/node.tar.xz" -C "$TMP/x" --strip-components=1
  rm -rf "$DIR" && mkdir -p "$(dirname "$DIR")" && mv "$TMP/x" "$DIR"; rm -rf "$TMP"
  ok "$EXE" || { echo "KITDEV-FAIL: 받은 Node($EXE)가 실행되지 않습니다"; exit 1; }
fi
echo "KITDEV-NODE: $EXE"
