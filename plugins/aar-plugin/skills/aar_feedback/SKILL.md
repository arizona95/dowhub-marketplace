---
name: aar_feedback
description: |
  **피드백 창고 카드를 읽고 고쳐 해결 카드로 닫는다** — 사람이 AI 답 아래 '📮 피드백 주기'로 넘긴 카드(aar-mcp `feedback`).
  `/aar_feedback` = 열린 카드 전부 · `/aar_feedback fbk_…` = 그 카드만 · `/aar_feedback <검색어>` = 검색에 걸린 카드.
  자료 카드(실측·캡처·문서화·데이터 정리)는 보고서로, 프로그램 카드(UI·기능·버그)는 AAR 저장소 코드 수정·커밋으로 고친다.
  "피드백 처리해", "피드백 카드 고쳐", "창고 비워" 일 때.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Task
---

> 🚨 **폴링 금지(절대).** env·VM·페이지·API 상태를 짧은 간격으로 반복 조회하며 기다리지 마라 — 열어둔 탭이 12일간 콘솔을 1~2초마다 조회해
> env 가 "활동 중"으로 잡혀 자동 정지가 안 걸리고 하루 종일 과금된 실사고(2026-09-15). 기다림은 **한 번 조회 → 아직이면 적고 넘어감**.
> 불가피하면 **총 30분 제한, 간격은 분 단위**, 30분 안에 안 되면 ⛔ 사유 보고. 작업이 끝나면 **탭·브라우저·프로세스를 닫는다**(열어둔 화면 = 폴링).
> 🧭 **env 는 제품으로 찾는다** — `env("for_product", name=<제품>)` 로 그 제품에 연결된 env 와 (계정, 플랜) 세트를 받는다. 하나면 그것, 여럿이면 요청 문맥으로 고르고 모호하면 묻는다.
> `exists:false` 는 쓰지 않는다. stopped 면 `env("start", name)`. 연결된 env 가 없으면 추정하지 말고 `env("list")` 를 보여주고 묻는다 — 새로 만들지 않는다. 로그인은 사람이 한다(비밀번호를 묻거나 적지 않는다).

# 피드백 창고 처리 (aar_feedback)

사용자 원문(2026-10-23): "그냥 /aar_review /aar_update /aar_feedback 이렇게 3개 둘까"

## 0) 카드 고르기 — 인자로
- `/aar_feedback` → `feedback("list", status="open")` 의 카드 **전부**.
- `/aar_feedback fbk_…` → 그 카드 하나만(`feedback("get", id)`).
- `/aar_feedback <검색어>` → `feedback("list", status="open", q=<검색어>)` 에 걸린 카드(제목·gap·plan·태그·댓글·제품을 낱말 AND 로 찾는다).
- 제품을 주면(`product=`) 그 제품 카드 + 제품 없는 카드가 온다. 읽은 카드는 **전부 해결**하는 것이 목표다.

## 1) 카드마다
1. **읽기** — `feedback("get", id)` → 카드(제목 · gap = 자료에 없던 것·문제 · plan = 실측 계획(있으면 사람이 쓴 것 그대로 한다) · 태그 · 나온 대화)와 댓글. **사람 댓글(`human_comments`)을 먼저** 읽는다 — 계획을 고치거나 범위를 좁힌 말이 거기 있다.
2. **시작 댓글** — `feedback("comment", id, text=<무엇을 하려나 — 짧게>, model=<너의 모델 이름 — 예 "Claude Opus 5.5">)`. 막힐 때·한 단계 끝날 때도 같은 방법으로 남긴다(에이전트 댓글 — 사람이 창고에서 본다).
3. **일**
   - **자료 카드(실측·캡처 · 문서화 · 데이터 정리)** — 답이 화면에 있으면 그 확인을 목적으로 Path 를 계획해 걷는다(`skill("get", "aar_review")` Phase 1~N — `path("plan")` → `path("walk")` → `path("project")`). 트리 노드·판정 칸·연결·보고서 새 버전은 그 Path 에서 계산된다 — 손으로 넣지 않는다. 답이 공식 문서에 있으면 `kind="research"` Path 로 남긴다.
     🎚 **판정 확실도 = 보고서 검증 하네스가 매긴다** — 판정은 O/X/-/? 넷 그대로. 판정 칸은 판정 Path 를 `path("project")` 할 때 그 Path 의 고리 사진을 근거로 적히고, 확실도(상·중·하 + 까닭)는 **검증 하네스**(독립 검사자가 검사표로 최대 4회차 · 닫히는 회차가 그 보고서가 받친 칸 확실도를 쓴다)가 정한다 — `skill("get", "_shared/refs/report-harness.md")`. ? 는 판정을 받치는 캡처가 전혀 없을 때만.
     🔁 **검증 하네스**: 판정 Path 는 `path("project")` 가 발행 뒤 검사 회차까지 돈다(최대 4회차 · 4회차도 FAIL 이면 남은 실패가 보고서에 실린 채 닫힘 — 완료 보고에 그대로 적는다 · `_shared/refs/report-harness.md`).
   - **프로그램 카드(UI · 기능 · 버그)** — AAR 저장소(SDSreviewBLUE) 코드를 고치고 테스트한 뒤 커밋한다.
4. **닫기** — `feedback("resolve", id, reports=["rpt_…@n"] 와/또는 fix="<커밋 해시·링크·무엇을 바꿨나>", note=<어떻게 고쳤나 — 완결 문장>, model=<너의 모델 이름>, expected_rev=<get 의 rev>)` = 해결 카드(그 카드가 고른 질문 공백도 함께 닫힌다 · 카드 이력에 "🤖 <model> 가 해결로 바꿨습니다" 로 남는다).
   CONFLICT 면 사람이 그 사이 고친 것 — 다시 `get` 해서 계획·댓글을 읽고 따른다.
- **못 하는 카드**는 까닭을 `feedback("comment", id, text=<까닭 — 완결 문장>, model=…)` 로 남기고 열어 둔다 — 추측으로 닫지 않는다. 결과에 '막힘(사유)'.
- `feedback` 의 쓰기(comment · resolve · drop · reopen)에는 **매번 `model=`** 을 넘긴다.

## 2) 끝내기 전
- 보고서를 새로 낸 카드가 있으면 "완료"라고 말하기 전에 독립 검증 서브에이전트 `aar-reviewer` 를 부른다 — 프롬프트에 맡은 카드·해결/남긴 카드·낸 보고서 rev 를 넘긴다(PASS 까지).
- 결과: 맡은 카드 수 · 해결(카드마다 보고서 rev 또는 커밋) · 남긴 카드(까닭).
- **하네스 끝 단계** — `skill("get", "_shared/refs/harness-end.md")`(플러그인 폴더에선 `skills/_shared/refs/harness-end.md`) 를 그대로 따른다.

## 절대 규칙
- off-screen 금지 — 실제로 본 화면만. 화면 행위의 기록은 Path 로만 남긴다(손 캡처·손 판정 금지).
- 날조 금지 — 해결 카드의 note·reports·fix 는 이번에 실제로 한 것만. 고치지 못했으면 열어 둔다.
- 카드가 말하지 않은 일로 번지지 않는다 — 그 카드의 gap·plan·사람 댓글이 범위다.
