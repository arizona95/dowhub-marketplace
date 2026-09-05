---
name: aas_scope
version: 0.1.0
description: |
  aas 의 **목표·범위 자체를 탐색해서 고친다.** 목표 = 지켜볼 SaaS/에이전트, 범위 = 목표마다 읽을 URL.
  ① 랭킹·목록 페이지를 훑어 새 SaaS 를 목표에 넣고 ② 리뷰한 SaaS 마다 업데이트 페이지·설정 레퍼런스를
  범위에 넣고 ③ 죽은 URL 을 뺀다. "추적 대상 늘려", "이 SaaS 도 지켜봐", "업데이트 페이지 찾아" 일 때.
  매일 cron 에선 aas_search 보다 먼저 돈다. (범위 안을 보는 건 aas_search.)
allowed-tools: [WebFetch, WebSearch, Read, Write, Bash]
---

# 목표·범위 탐색·갱신 (aas_scope)

`aas_search` 가 순찰할 **지도**를 그린다. 지도가 낡으면 순찰이 헛돈다.

## 0) 상태 파일 — `~/.aas/`
```
targets.json   { "<slug>": { "name", "vendor", "kind", "homepage", "status": "new|active|dropped",
                             "added": "YYYY-MM-DD", "reason", "last_review_session": "" } }
scope.json     { "_ranking": [ {url, added, reason} ],
                 "<slug>":   [ {url, kind: "release|changelog|settings|plan|docs", added, reason, alive} ] }
log.jsonl      한 줄 = { ts, skill:"aas_scope", op:"add_target|add_url|drop_url|drop_target", slug, url, reason }
```
없으면 만든다. **`_ranking` 이 비어 있으면 스스로 찾는다** — 사용자에게 묻지 마라(§0-1).

## 0-1) `_ranking` 채우기 — 랭킹·목록 페이지를 스스로 찾는다
`WebSearch` 로 "AI coding agent / AI agent tools ranking · directory · leaderboard · comparison 2026" 류를 검색해
**정기 갱신되는 목록 페이지**를 고른다. 고르는 기준:
- 이름이 **여러 개 나열**되고 날짜·순위·카테고리가 있다 (단일 제품 리뷰·광고 글 제외)
- 최근 갱신 흔적이 있다 (연·월 표기, "updated")
- 벤더 자신의 페이지가 아니다 (자기 제품만 실림)
3~6개면 충분하다. 각각 `WebFetch` 로 열어 실제로 목록인지 확인한 뒤 `_ranking` 에 넣고 `reason` 에 왜 골랐는지 적는다.
랭킹 페이지는 서드파티여도 된다 — **이름을 발견하는 용도**일 뿐이고, 그 이름의 근거·업데이트는 §2 에서 벤더 공식 URL 로만 잡는다.

## 1) 새 목표 찾기 — `_ranking` 순회
각 랭킹·목록 URL 을 `WebFetch` 로 읽어 이름을 뽑는다. **본 이름을 바로 넣지 않는다.** 하나씩 거른다:
- **에이전트/코딩·업무 도구인가** — 단순 챗봇·소비자 앱은 아님.
- **조직이 도입할 법한가** — 기업 플랜·관리자 기능이 있거나 있을 것으로 보이나.
- **이미 목표에 있나** — slug 로 대조. 별칭(제품명 바뀜)도 `name` 으로 대조.
통과하면 `targets.json` 에 `status:"new"` 로 넣고 `reason` 에 **어느 랭킹 페이지 몇 번째에서 봤고 왜 통과했나**를 적는다.
거른 것도 `log.jsonl` 에 `op:"skip"` 으로 사유와 함께 남긴다 — 다음 달 같은 이름을 또 거르지 않게.

## 2) 목표마다 범위 채우기
`targets.json` 의 각 목표(dropped 제외)에 대해 `scope.json` 에 아래 종류가 있나 본다. 없는 종류를 찾는다:
| kind | 무엇 | 찾는 법 |
|---|---|---|
| `release` | 릴리스 노트 / what's new / 체인지로그 | 벤더 문서 사이트에서 "release notes", "changelog", "what's new" 검색 |
| `settings` | 관리자 설정·정책 레퍼런스 | "admin settings", "managed settings", "enterprise policy" |
| `plan` | 플랜·가격 페이지 (Enterprise 여부·ZDR·약정) | pricing / enterprise |
| `docs` | 보안·프라이버시·데이터 처리 문서 | security / privacy / data retention / trust |

🚨 **벤더 공식 URL 만.** 서드파티 뉴스·블로그·요약 사이트는 범위가 아니다 — 거기 적힌 건 근거가 못 된다.
찾은 URL 은 `WebFetch` 로 한 번 열어 **실제로 그 내용인지** 확인한 뒤 넣는다(제목·첫 문단으로 판단). 못 찾으면 `kind` 옆에 `"missing": true` 로 남기고 다음 실행 때 다시 찾는다.

## 3) 죽은 URL 정리
`scope.json` 의 모든 URL 을 `WebFetch` 로 연다. 404·이동·빈 페이지면 `alive:false` 로 바꾸고 `log.jsonl` 에 `op:"drop_url"`.
바로 지우지 않는다 — 다음 실행에서 한 번 더 죽어 있으면 그때 제거. 이동(301)이면 새 URL 을 같은 kind 로 추가.

## 4) 출력 — 변경 요약만
```
[aas_scope YYYY-MM-DD]
목표: +N (new: a, b) · 유지 M · drop K
범위: +P URL (slug/kind …) · dead Q
비고: _ranking 없음 / 못 찾은 kind: slug/settings …
```
**변경이 없으면 한 줄 "변경 없음"** 으로 끝낸다. 매일 도는 것이라 조용해야 한다.

## 절대 규칙
- **URL 을 지어내지 마라.** 열어서 확인한 것만 넣는다.
- **목표·범위를 지우는 건 사람이 확인한 뒤** — 이 스킬은 `dropped`/`alive:false` 표시까지만.
- 제품 고유값을 스킬 본문에 박지 마라. 어느 SaaS 든 같은 절차다.
