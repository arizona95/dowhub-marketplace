---
name: aar_menutoy
description: |
  **MenuToy 갱신** — SaaS 의 웹 메뉴(관리자 콘솔·플랫폼 설정·문서)를 크롤러 코드로 그대로 재현해 git 이력에 쌓고,
  바뀐 메뉴에 맞춰 체크리스트 연결을 손본다. 주간 `/aar_update` 가 env 를 켠 김에 같이 돌린다.
  "menutoy 갱신", "메뉴 토이 수집", "조직설정 메뉴 다시 긁어" 일 때.
# 로컬 파일 도구는 쓰지 않는다 — 화면은 브라우저 도구로, 읽기·쓰기는 aar-mcp 툴(menutoy)로.
allowed-tools: []
---

> 🚨 **폴링 금지(절대).** 수집 잡 상태는 `collect_status`(서버가 80초 대기) 를 **최대 25번(≈30분)** 까지만. 그 밖의 상태 조회는 한 번.
> 🧭 **env 는 제품으로 찾는다** — 사용자가 제품만 말하면(예: "Claude Desktop app 에서 ~") `env("for_product", name=<제품>)` 로 그 제품에 연결된 env 들을 받는다. 하나면 그것, 여럿이면 요청 문맥(프록시 강제 exp-close / 직접 egress exp-open 등)으로 고르고 모호하면 후보를 보여주고 묻는다. `exists:false` 는 없어진 env 라 쓰지 않는다. stopped 면 `env("start", name)`. 연결된 env 가 없으면 이름으로 추정하지 말고 `env("list")` 를 보여주고 묻는다 — 새로 만들지 않는다.
> 🔄 env 를 켠 직후엔 콘솔을 Ctrl+Shift+R 하고 RDP 에 들어가라.

# MenuToy 갱신 (aar_menutoy)

toy = 제품(product = 센싱 slug = 트리 제품 노드, 예 `claude-app`) 하나. 그 아래 **소스**(source)가 여럿:
`kind=admin`(관리자 콘솔, 예 claude.ai 조직설정) · `platform`(플랫폼 설정 콘솔) · `web`(문서·약관 페이지).
소스마다 **정의**(urls·title)와 **파서**(`parse(html, url) → dict`, 서버에서 실행)가 있고, 둘 다 `menutoy` 툴로 네가 쓴다.
🚨 데이터는 **크롤러가 만든 것만** 쓴다. 예시 화면(menutoy.html)의 값을 옮겨 적는 것은 날조다.

## 0) 현황 — `menutoy("toys")` → `menutoy("sources", product)`
- toy 는 **SaaS 하나에 하나**, 표면(관리자 콘솔·플랫폼 콘솔·문서)은 그 아래 소스. 세션 제품명과 toy 이름이 달라도 `toys` 의 `sources[].hosts` 로 같은 SaaS 를 찾아 그 toy 를 쓴다(예: platform.claude.com 세션 → `claude-app`/`claude-platform`). 어느 toy 에도 그 호스트가 없을 때만 새로 만든다.
- toy 가 없으면 만든다: `menutoy("source_set", product, source, meta={kind, urls, title}, parser=<코드>, title=<제품 표시명>)`.
- 제품(toy)을 없애려면 `menutoy("toy_delete", product)` — 사용자가 명시적으로 지시했을 때만. toys 목록·트리에서 사라지고 수집·판정·보고서 이력은 DB 에 남는다. 되돌리기 없음(같은 이름으로 다시 만들면 새 제품).
- 소스별 `parse_errors`·`raw_pages`·`parsed_at` 을 본다. errors 가 있으면 3) 부터.

## 1) 수집 — 잡으로 시작하고 상태를 받는다
1. env 가 running 인지 `env("get")`. VM 의 브라우저(Edge)에 그 SaaS 가 **로그인돼 있어야** 한다(안 돼 있으면 ⛔ 사유: 로그인은 사용자 몫).
2. `menutoy("collect", product, source, url="claude-exp-close")` → 즉시 `{job, pages, eta_min}`. 서버가 콘솔(RDP)을 통해 VM 의 **로그인된 실제 브라우저**
   활성 탭에 URL 을 쳐서 열고 DOM 을 꺼내(클립보드 조각) 저장·파싱한다. 페이지당 1분쯤. (한 요청으로 끝까지 기다리는 방식은 원격 MCP 경로가 100초에 끊어 폐기 — 2026-09-16.)
3. `menutoy("collect_status", key=<job>, at="80")` — 서버가 80초까지 기다렸다가 답한다. `status` 가 running 이면 다시 부른다.
   **한도: 최대 25번(≈30분).** 그 안에 done 이 안 오면 ⛔ 사유 보고하고 멈춘다(그 이상은 폴링). done 이면 `result.pages[]`(ok·html_bytes·error) 와 `result.reparse` 를 그대로 보고에 쓴다.
4. 수집 중엔 VM 화면을 건드리지 마라(키 입력이 섞인다). 서버는 조각 머리의 URL 이 요청한 URL 과 다르면 "활성 탭이 요청한 페이지가 아니다" 로 실패시키고
   이동을 몇 번 다시 한다(다른 페이지의 DOM 을 그 URL 로 저장하지 않는다). 그래도 실패한 URL 만 `meta={"urls":[…]}` 로 잡을 한 번 더 시작한다.
   같은 VM 에 잡이 도는 중이면 BUSY(409) — 그 잡의 상태를 받아라.

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
  메뉴 항목 ↔ 체크리스트 문항 연결의 정본은 **연결 Link** — `popup_set(ck="@genai.x.y.Z")`·`link("add", a="item:<제품>:<키>", b="ck:genai.x.y.Z")` 로 잇고,
  사라진 메뉴의 연결은 `link("remove", …, reason=…)` 로 끊는다(팝업 ck 에서 지워도 끊기지 않는다).
- 새로 생긴 메뉴(added)가 보안 항목이면 팝업 권고를 채운다(sev·adv·risk). 판정(O/X/-/?)은 **근거가 있을 때만**, 없으면 ?.

## 5) 웹 근거 카드 — 메뉴가 아니라 문서로 확인하는 항목
- 인증(SOC 2·ISO)·약관(학습 미사용)·보존/삭제·하위처리자·암호화·침해 대응처럼 **문서로 확인하는 체크리스트 항목**은 웹페이지 카드로 근거를 단다.
  특히 검토 결과가 사전검토(pre)인데 연결 링크가 0개인 항목(화면에서 빨간 테두리)이 대상.
- 그 SaaS 의 공식 페이지를 **직접 열어 본문을 읽고**(브라우저·WebFetch), 해당 문장이 실제로 있는 페이지만:
  `menutoy("web_add", product, title="<제목 — 무엇을 증명하나>", url=<연 URL 그대로>, note="<해당 문장 요지 + 확인일>", ck="@genai.x.y.Z …", cert=True|False)`.
  cert=True 는 인증 페이지만. 열지 않은 URL·기억으로 아는 내용은 날조다 — 넣지 마라. 페이지가 사라지거나 내용이 바뀌었으면 카드를 `web_remove` 하거나 note 를 갱신한다.

## 6) 보고
```
[aar_menutoy YYYY-MM-DD] <product> · 소스 N · 수집 <페이지수> · 파싱 오류 <n> · toy +a −r ✏c (커밋 <hash7>) · 체크리스트 연결 갱신 <n>건 · 막힘: <사유>
```
링크: 메뉴 재현 `https://dowmain.org/agentautoreview/?p=<product>&v=toy` (누구나 — 비관리자에게는 체크리스트·이메일이 가려진다) · 체크리스트 `…&v=checklist` (관리자 로그인 필요).

## 절대 규칙
- 파서·정의 외에 서버 파일을 직접 만지지 않는다. 사람 데이터(annotations)는 4) 의 갱신 목적으로만.
- 로그인·자격증명 입력은 하지 않는다. 수집 스크립트 외의 방법(스크린샷을 읽어 값 적기)으로 toy 를 채우지 않는다.
