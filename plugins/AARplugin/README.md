# AARplugin — AgentAutoReview

AI 앱 **보안 리뷰 워크플로**를 Claude Code 플러그인 하나로. Atlassian 모델(`plugin.json` +
`.mcp.json` 리모트 MCP + `skills/`).

## 스킬 3종
- **`/aar_review`** — env 적용 시나리오 **전수** 라이브 실증. 커버리지 원장으로 스코프를 강제해,
  전부 ✅/⛔ 되기 전엔 "완료" 불가(20%-완료-선언 재발 차단). 새 SaaS·대규모 업데이트 시.
- **`/aar_update`** — 이 SaaS 를 **주기적(주 1회) 추적**. 지난번 대비 델타만 — 메뉴·세션·세팅·보존
  4트리와 영향 보고서를 갱신.
- **`/aar_fix`** — AAR 자기 점검·개편. 스킬·가이드·플레이북을 종합적으로 읽어 모순·노후·억지 tool화·
  반복 실수를 찾아 자기자신을 고친다(가이드는 `edit_guidance` 툴로).

## 리모트 MCP
- **.mcp.json** → **AARmcp**(`https://dowhub.org/AARmcp/`, OAuth). 설치 시 도구가 함께 붙고,
  **도구·로직은 서버측 자동 업데이트**.

## 설치
개별 저장소는 폐지됐다(2026-08-27). 스킬·플러그인·MCP 는 **마켓플레이스 하나**에서 나간다.
```
/plugin marketplace add https://github.com/arizona95/dowhub-marketplace.git
/plugin install AARplugin
```
> 예전 `arizona95/AARplugin.git` 으로 등록해 뒀다면 그 마켓플레이스는 더 이상 없다 —
> `/plugin marketplace remove aar-marketplace` 후 위 URL 로 다시 추가한다.

## 업데이트
- **AARmcp 도구/로직** → dowhub.org 서버만 갱신 = 전 사용자 자동 반영.
- **스킬 내용** → 마켓플레이스에 **브랜치로 올려 PR** → CI(기본검증 통과) + 소유자 승인 → main 병합.
  버전을 안 올리면 클라이언트가 "최신"으로 보고 안 당겨온다 — `plugin.json` 과 카탈로그의
  `version` 을 **같이** 올린다.
