# aas-plugin — AgentAutoScreening

**무엇** — 대상 SaaS/에이전트의 공개 업데이트 페이지를 **매일** 읽어, 점검기준 33개에 걸리거나
보안상 중요한 변화를 잡아 **AAR 리뷰 요청서**를 만든다. 판정은 하지 않는다 — "이걸 다시 보라"까지.

**스킬 2개**
| 스킬 | 역할 |
|---|---|
| `/aas_scope` | 목표(어떤 SaaS)·범위(어떤 URL) **자체를 탐색해 갱신**. 랭킹 페이지에서 새 SaaS, 리뷰한 SaaS 마다 업데이트 페이지 |
| `/aas_search` | 주어진 목표·범위를 **서칭**. 변화 → 33개 매핑 + 보안 변화 → 요청서 |

scope 가 지도, search 가 순찰. 매일 cron 은 `scope → search` 순.

**상태** — `~/.aas/` (v0.1 로컬. cron 이 이 PC 에서 돌므로). 서버 이전은 추후.
```
~/.aas/targets.json     목표 목록
~/.aas/scope.json       목표별 범위 URL
~/.aas/seen/            URL 별 워터마크
~/.aas/requests/        생성된 요청서
~/.aas/log.jsonl        추가·제거·요청 이력
```

**기준 정본** — `aar-mcp` `list_guidance("점검기준")` §회사 체크리스트 코드 ↔ 점검영역. 사본 금지.
컨셉 문서: `SDSreviewBLUE/docs/11_aas_컨셉.md`.
