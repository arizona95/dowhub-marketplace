---
name: aar_menutoy
description: |
  **MenuToy 갱신** — SaaS 의 웹 메뉴(관리자 콘솔·플랫폼 설정·문서)를 크롤러 코드로 그대로 재현해 git 이력에 쌓고,
  바뀐 메뉴에 맞춰 체크리스트 연결을 손본다. 주간 `/aar_update` 가 env 를 켠 김에 같이 돌린다.
  "menutoy 갱신", "메뉴 토이 수집", "조직설정 메뉴 다시 긁어" 일 때.
# 로컬 파일 도구는 쓰지 않는다 — 화면은 브라우저 도구로, 읽기·쓰기는 aar-mcp 툴(menutoy)로.
allowed-tools: []
---

> 🚨 **폴링 금지(절대).** 수집 스크립트는 페이지당 1회 전송하고 끝난다. 결과를 기다리며 반복 조회하지 마라 — `menutoy("sources")` 한 번.
> 🔄 env 를 켠 직후엔 콘솔을 Ctrl+Shift+R 하고 RDP 에 들어가라.

# MenuToy 갱신 (aar_menutoy)

toy = 제품(product = 센싱 slug = 트리 제품 노드, 예 `claude-app`) 하나. 그 아래 **소스**(source)가 여럿:
`kind=admin`(관리자 콘솔, 예 claude.ai 조직설정) · `platform`(플랫폼 설정 콘솔) · `web`(문서·약관 페이지).
소스마다 **정의**(urls·title)와 **파서**(`parse(html, url) → dict`, 서버에서 실행)가 있고, 둘 다 `menutoy` 툴로 네가 쓴다.
🚨 데이터는 **크롤러가 만든 것만** 쓴다. 예시 화면(menutoy.html)의 값을 옮겨 적는 것은 날조다.

## 0) 현황 — `menutoy("toys")` → `menutoy("sources", product)`
- toy 가 없으면 만든다: `menutoy("source_set", product, source, meta={kind, urls, title}, parser=<코드>, title=<제품 표시명>)`.
- 소스별 `parse_errors`·`raw_pages`·`parsed_at` 을 본다. errors 가 있으면 3) 부터.

## 1) 수집 — `menutoy("collect", product, source, url=<env 이름>)`
1. env 가 running 인지 `env("get")`. VM 의 브라우저(Edge)에 그 SaaS 가 **로그인돼 있어야** 한다(안 돼 있으면 ⛔ 사유: 로그인은 사용자 몫).
2. `menutoy("collect", product, source, url="claude-exp-close")` 한 번. 서버가 콘솔(RDP)을 통해 VM 의 **로그인된 실제 브라우저**에서
   소스에 등록된 URL 마다 탭을 열고 DOM 을 꺼내(클립보드 조각) 저장·파싱한다. 페이지당 정해진 횟수만 조작하고 끝난다 — 결과를 기다리며
   반복 호출하지 마라. 응답의 `pages[]`(ok·html_bytes·error) 와 `reparse` 를 그대로 보고에 쓴다.
3. 수집 중엔 VM 화면을 건드리지 마라(키 입력이 섞인다). 서버는 브라우저 창을 앞으로 올린 뒤 **활성 탭 주소창에 URL 을 쳐서** 이동하고, 조각 머리의 URL 이
   요청한 URL 과 다르면 "활성 탭이 요청한 페이지가 아니다" 로 실패시킨다(다른 페이지의 DOM 을 그 URL 로 저장하지 않는다). 실패한 URL 만 `meta={"urls":[…]}` 로 다시 한 번.
   (헤드리스 브라우저·PowerShell 스크립트 방식은 이 VM 들에서 안 된다 — 2026-09-16 실측. collect_cmd 는 남겨두었지만 쓰지 않는다.)

## 2) 파싱 확인 — `menutoy("sources", product)`
- `parse_errors` 비어 있고 `rows > 0` 이면 정상. `menutoy("get", product)` 로 ADMIN/PLATFORM/WEB 이 실제 화면과 같은지 **RDP 화면과 대조**한다
  (페이지·섹션·행 이름·값). 다르면 3).

## 3) 파서 고치기 — 화면이 바뀌어 깨졌을 때
1. `menutoy("source_get", product, source)` 로 파서 코드·raw 목록·오류를 본다. raw 는 서버에 있으니 **재수집 없이** 고친다.
2. 파서 규칙: `parse(html, url)` 는 kind 별 스키마(`schema` 필드에 적혀 있음)를 돌려준다. 행 `k`(키)는 **화면 위치가 아니라 의미**로
   안정되게(예 `org/sso`, `privacy/data-retention`) — 키가 바뀌면 diff 가 전부 +/− 로 보이고 체크리스트 연결이 끊긴다.
3. `menutoy("source_set", …, parser=<고친 코드>)` → `menutoy("reparse", product, source)` → errors 0 될 때까지. 커밋은 서버가 한다.

## 4) 체크리스트 연결 갱신
- reparse 결과 `detail.added/removed/changed` 의 키를 보고, 체크리스트 항목이 가리키던 메뉴 키가 **사라지거나 바뀌었으면** annotations 를 고친다:
  `menutoy("checklist_set", …)`·`menutoy("popup_set", …)`·`menutoy("web_add", …)` 로(원시 키를 직접 만지는 `annotation_set` 은 마지막 수단).
- 새로 생긴 메뉴(added)가 보안 항목이면 팝업 권고를 채운다(sev·adv·risk). 판정(O/X/-/?)은 **근거가 있을 때만**, 없으면 ?.

## 5) 보고
```
[aar_menutoy YYYY-MM-DD] <product> · 소스 N · 수집 <페이지수> · 파싱 오류 <n> · toy +a −r ✏c (커밋 <hash7>) · 체크리스트 연결 갱신 <n>건 · 막힘: <사유>
```
링크: `https://dowmain.org/agentautoreview/?m=menutoy&product=<product>` (관리자 로그인 필요).

## 절대 규칙
- 파서·정의 외에 서버 파일을 직접 만지지 않는다. 사람 데이터(annotations)는 4) 의 갱신 목적으로만.
- 로그인·자격증명 입력은 하지 않는다. 수집 스크립트 외의 방법(스크린샷을 읽어 값 적기)으로 toy 를 채우지 않는다.
