---
name: aar_review
description: |
  전수 보안 리뷰 — 새 SaaS 를 처음 마주했거나 대규모 업데이트 후, 이 env 에 **적용되는
  시나리오 전부**를 라이브로 돌려 보고서를 만든다. 시작 전에 커버리지 원장부터 만들어 적용
  대상을 못박고, 그 전수가 ✅/⛔ 되기 전엔 "완료"라고 못 한다. "S0~S3 보고서 써줘",
  "전수 리뷰", "새 제품 리뷰 돌려" 일 때.
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
> 🧭 **env 는 제품으로 찾는다** — 사용자가 제품만 말하면(예: "Claude Desktop app 에서 ~") `env("for_product", name=<제품>)` 로 그 제품에 연결된 env 들과 (계정, 플랜) 세트를 받는다. 요청에 플랜·계정이 나오면 거기서 고른다(로그인은 사람이 한다 — 비밀번호를 묻거나 적지 않는다). 하나면 그것, 여럿이면 요청 문맥(프록시 강제 exp-close / 직접 egress exp-open 등)으로 고르고 모호하면 후보를 보여주고 묻는다. `exists:false` 는 없어진 env 라 쓰지 않는다. stopped 면 `env("start", name)`. 연결된 env 가 없으면 이름으로 추정하지 말고 `env("list")` 를 보여주고 묻는다 — 새로 만들지 않는다.
> 🛡 **도구 통제** — S1-tool-control 을 실증하면 그 SaaS 에서 등록할 수 있는 도구(실체)마다 `tool_gov("entity_add", product, name=<그 SaaS 가 부르는 이름>, tags={kind…}, exists_evidence=[등록 예제 캡처 블록 rpt_…@n#<block_id>], exists_reason=완결 문장)` 으로 등록하고, 실증한 권한 사실마다 `tool_gov("fact_set", product, entity, fact, verdict, evidence=[캡처 블록], reason=완결 문장, actor=admin|member)` 로 기록한다(캡처 블록 목록 = `tool_gov("blocks", product, report=<rpt_…@n>)`). 근거 없는 O/X 는 저장되지 않는다. 정책은 `tool_gov("policy", product)`. 절차 정본 = S1-tool-control 지시문.
> 🎚 **판정 확실도(2026-10-23 사용자 결정)** — 판정은 O/X/-/? 넷 그대로. O·X·- 를 적을 때마다 확실도를 **같은 호출에** 함께 적는다(`tool_gov fact_set` · `monitor fact_set` · `net_control effect_set`): `certainty` = `high`(상 — 그 조건 그대로 실측했거나, Team 실측을 공식문서로 Enterprise 차이까지 닫아 다른 해석이 남지 않음) · `mid`(중 — 근거가 한쪽뿐: 공식문서만, 또는 문서 추적 없는 Team 실측만) · `low`(하 — 근거는 판정을 가리키지만 캡처에 근거가 있는 다른 해석이 남음), `certainty_why` = 낮춘 까닭 완결 문장(중·하 필수). ? 는 판정을 받치는 캡처가 전혀 없을 때만이고 확실도를 주지 않는다(서버가 거부). 판정을 바꾸면 확실도도 다시 적는다(안 주면 미평가). 화면: 상 실선 · 중 점선 · 하 회색.
> 🔗 **연결** — 같은 대상을 가리키는 트리 노드·메뉴 항목·도구 통제 실체는 `link("add", a, b, note)` 로 잇는다(주소 tree:<트리>:<경로> · item:<제품>:<키> · toolgov:<제품>:<실체 이름> · ck:<set>.<id> = 체크리스트 문항). 확인한 것만.
> 🔁 **다시 리뷰할 때** — `report("lines", product=<제품>)` 로 그 제품의 보고서 줄을 먼저 본다. 보고서 종류(kind)는 다섯이다 — **periodic(정기 업데이트)** 인 줄은 빠짐없이 같은 시나리오·같은 env 로 `html_report` 를 새로 내 새 버전을 만든다(이전 버전과의 diff 가 화면에 자동으로 남는다). required(필수)는 리뷰마다 한 번은 있어야 하고(없으면 만든다), next(다음 실험)는 다음 실험·미판정 칸을 적은 보고서, other(기타)는 필요할 때만, experiment(실험 보고서)는 판정 표를 채우는 실험 라운드다(판정을 바꾸거나 ? 를 채울 때 새 세션으로). 구분을 바꾸는 건 사용자가 시킨 때만(`report("kind", …)`).
> 🔄 **env 를 켜거나 끈 뒤(start/stop/create 완료 후)에는 콘솔을 Ctrl+Shift+R(강력 새로고침) 하고 접속하라.** 옛 연결을 물고 있으면 RDP·화면이 안 뜨는데, 그걸 env 고장으로 오판해 재시도(폴링)하지 마라.
> 🧸 **MenuToy 갱신은 리뷰 중에 바로.** 시나리오를 만들거나 리포트를 낼 때 그 시나리오가 다룬 항목을 aar-mcp `menutoy` 로 갱신한다 —
> `checklist_set`(판정·근거) · `popup_set`(메뉴 팝업 권고·위험 — `ck` 의 문항은 연결 Link 로 이어진다, 끊기는 `link("remove", item:…, ck:…)`) · `web_add`(문서 근거) · 새 제품이면 `toy_create`(세션 제품명과 toy 이름이 달라도 `menutoy("toys")` 의 sources[].hosts 로 같은 SaaS 를 찾아 그 toy 를 갱신; 어느 toy 에도 없을 때만 새로). 판정은 근거가 리포트에 있을 때만.

# 전수 시나리오 리뷰 (review-scenario)

이 env 에 **적용되는 시나리오 전부**를 라이브로 실증해 보고서를 낸다. 이 스킬은 **스코프를
임의로 줄이고 20%에서 "완료" 선언한 실사고(2026-08)의 재발을 막는 게 목적**이다.

## 🚨 이 스킬이 막는 3가지 실수 (전부 실제로 일어난 것)
1. **"대표 몇 개만" 해석 금지.** "S0~S3 써줘" = 적용 25~28개 전수를 돌려라는 뜻이다. **첫 턴에 원장(표)을 만들지 않으면 이 실수가 난다.** → 아래 Phase 0 강제.
2. **증적이 스코프를 정하게 두지 마라(역방향 금지).** "내 손에 있는 캡처에 맞는 시나리오"를 고르는 게 아니라, **시나리오가 요구하는 실험을 새로 실행**한다. 기존 캡처에 라벨만 붙이는 건 리뷰가 아니다.
3. **"정직한 미실시 표기"는 완료 조건이 아니다.** 안 한 걸 안 했다고 적는 건 최소 조건일 뿐. 미실시=⬜(할 일)이지 ✅가 아니다. ⬜를 남기고 "완료"라고 하면 이 스킬 실패다.

## Phase 0 — 커버리지 원장부터 (작업 전 필수)
- 🔁 **반복 실수부터**(2026-10-18 사용자 "실수반복같은거 자가피드백하고잇지?"): AgentReview 저장소가 있는 PC 면 `AgentReviewPlugin/vmscreen/vms-audit recall` — 지난 실행들의 호출 이력 점검에서 3번 이상 되풀이된 실수(원본 그림 열기·큰 Bash 출력 등)와 고칠 규칙이 나온다. 이번 작업에서 피한다(없는 PC 면 건너뜀).
**MCP 툴 `coverage_ledger(env, session)` 를 부른다.** (로컬 스크립트·localhost 아님 — 서버가 계산해 돌려준다. 이 스킬은 어느 PC 에 깔려도 MCP 로만 동작.)
- 반환 `table_md` = 이 env 에 **적용되는 시나리오 전수**(변형 exp-open/close·inline·llm 자동 계산)와 각 ✅/⬜.
- 이 표가 **이번 리뷰의 스코프 계약**이다. `rows` 중 status=`todo`(⬜) 전부가 대상 — 몇 개만 고르지 마라.
- 이 원장을 대화에 붙여두고 매 턴 대조한다(로컬 파일로 저장할 필요 없음 — 툴이 서버 상태로 다시 계산해준다).

## 🖥️ 브라우저·캡처 = **내 브라우저 하나** (제일 먼저)
모든 브라우징·캡처는 **내가 가진 브라우저 도구**로 한다 — 서버엔 브라우저가 없다(대신 열어주거나 대신 찍어주는 경로는 전부 폐기됐다). Claude 앱에선 보통 claude-for-chrome(`mcp__claude-in-chrome__*`)이 그 도구다. **브라우저 도구가 아예 없으면 라이브 리뷰는 불가 — 우회·날조 말고 사용자에게 알리고 중단하라.**
- **S0 (공개 문서 리서치)** = 내 브라우저로 공식문서·벤더 사이트를 직접 열고 스크롤해 **실제로 값을 확인**한다. 값 판독은 `get_page_text`(픽셀 눈으로 읽기보다 오독 없음).
- **S1~ (env 실증)** = 내 브라우저로 **콘솔만** 열어 env 트리→user-window-pc→RDP(canvas) 로드→그 PC 조작. 제품 트래픽은 그 env(프록시 뒤)를 지나므로 콘솔 flow 뷰로 확인.
- **캡처 = 내가 본 화면을 내가 떠서 서버로 POST.** 캡처 절차는 `refs/capture-and-workflow.md` 에 있다: RDP=canvas 크롭 1920px, 일반웹=chrome `computer(screenshot)`, 그 dataURL 을 `javascript_tool` fetch 로 POST. **서버가 대신 안 찍는다.**

## Phase 1~N — 시나리오별 (원장의 ⬜ 를 하나씩 ✅/⛔ 로)
1. 계획 단계에 `list_scenarios(include_instructions=True)` **한 번**으로 전체 instruction 을 받아 criterion(점검기준) 확인(N콜 낭비 금지).
2. `scenario_start(env, id)` — **모든 시나리오(S0 포함)** 의 시작시각 기록(그래야 소요시간이 남는다). S0 문서 리서치는 그 뒤 claude-for-chrome 로 바로.
3. 내 브라우저로 라이브 수행 → **내가 본 화면을 떠서 `/api/v1/evidence` 로 POST**(`refs/capture-and-workflow.md` 레시피대로). 값은 `get_page_text`. 🚨 과거 보고서·다른 세션 캡처 베끼기 금지 — 이번에 본 화면만.
4. 보고서 생성 — **먼저 항목에 관측·증거·판정을 기록**(`update_tree`·`shot_set`·`menutoy("checklist_set")` · 판정 표는 `tool_gov`·`monitor`·`net_control` 의 `fact_set`/`effect_set`)하고, 공식문서 근거는 칠하지 않은 캡처로 `quote_shot` 을 만들어 그 `doc_block` 을 doc 블록으로 넣고, **S0/S1/S2 는 `html_report(session, id, ...)`**(근거=POST 한 shot label 로 조립, `quality_ok` 통과해야 ✅). 보고서 본문은 **검토 범위·중요 변경·위험·미확인 항목의 요약**이고 각 블록을 `items=[<노드 id tnd_…>, <항목 id itm_…>]` 로 그 항목에 연결한다(`tree("get")`·항목 상세의 id; 옛 `tag` 경로도 받는다). **메뉴 전체 나열 금지** — 전체 목록이 필요하면 `appendix={"tree":…,"product":…}` 로 서버가 별첨을 만든다. 결과 `atom.unresolved_items` 가 비어야 한다. 📰 **사람이 읽는 본문은 `lead` 로 — 기술 블로그처럼(2026-10-20 사용자 "사람이 읽을만 한것만 남겨놓고 지금 좋아 앞으로도 이렇게 쓰도록" · 완성기준 RC-25)**: `plain_title`(무엇을 확인했나 한 문장 — 시나리오 id·라운드·칸 이름·캡처 번호 금지) · `summary_md`(확인한 것 한 줄 + **굵은 결론** + 핵심 2~3줄) · `scenes`(그림마다 앞 글 = 무엇을 보여 주는 그림인지·기대값, 뒤 글 = 읽을 것과 그 뜻, 장면 사이 이음 문장 — 맥락 없이 튀어나오는 그림 금지) · `conclusion`(그래서 할 일). 본문에 표 금지 — 근거 표·판정 칸·원문 캡션은 blocks 에 두면 책 보기가 접힌 부록으로 옮긴다. 새 세션 첫 발행 때 `session_title`("무엇을 확인한 실험인지 (날짜)"). lead 가 없거나 미달이면 draft(원장 미완) — 응답 `lead_check.problems` 를 고쳐 다시 발행. 🔗 **글 사이 작은 알약 링크(RC-26 — 사용자 "메뉴 그 사진 링크 … 자주자주 … 글 사이사이에 자그만 파형태의 링크 … 기본으로")**: 메뉴 위치는 '조직 설정 › 기능 › 웹 검색' 처럼 › 로 이어 적는다(책 보기가 그 메뉴에 📷 메뉴－화면·🌳 트리 알약을 단다) · 확실히 걸려면 `[[menu:경로|이름]]` · 다른 화면은 `[[tree:…]]` `[[photo:…]]` `[[tg:…]]` `[[nc:…]]` `[[rep:…]]` `[[doc:주소|이름]]` · 맨 주소 한 줄 금지. 예(통과한 첫 보고서): 제목 "직원이 관리자 배포 스킬·플러그인을 복제해서 다시 퍼뜨릴 수 있는가" · 그림 앞 "아래 화면은 그 스킬 상세 화면의 ⋮ 메뉴입니다. 직원이 원본을 그대로 퍼뜨릴 수 있다면 이 메뉴에 '공유'나 '조직에 게시'가 보여야 합니다." · 그림 뒤 "메뉴에는 '채팅에서 사용해보기 · 복제 · 다운로드 · 제거'만 있습니다." **S3 종합(S3-1·S3-2)은 문서 스킬대로 네가 docx 를 조판**한다 — 뼈대는 `skill("get", "aar_review/report-skills/S3-1")` 로 **원문 그대로** 받아 따르고(기억으로 재현 금지), 만든 뒤 **`upload_report_file(session, scenario, "report.docx")` 를 content_b64 없이 불러** 1회용 토큰·`curl` 명령을 받고, 그 명령을 Bash 로 실행해 파일을 직접 올린다(docx 는 MB 단위라 base64 를 도구 인자로 넣을 수 없다 — 2026-09-16 정식본 미업로드 사고). 응답의 `quality_ok`·`checks` 를 확인한다. 🚨 업로드 때 서버가 골격(별첨 5종·이미지·종결표기·분량)을 검사해 **미달본은 올리지 않는다** — 축약본 금지. 구성도·관계 그래프는 **사진이 아니라 Graph 데이터**로 — `report-skills/section2-arch-diagram` 대로 `graph("put")` 로 올리고, HTML 보고서엔 graph 블록, docx 엔 `graph("render", fmt="png")` 주소의 PNG 를 넣는다(그림 파일을 따로 그리거나 `upload_report_file` 로 올리지 않는다 — 2026-09-28).
5. 순서: **S0(문서) → S1(env 실증) → S2/C(비교) → S3(종합, 맨 마지막 — S3-1·S3-2 둘 다)**. S3 는 그 세션 S0/S1/S2 가 다 있어야 성립.

## ⛔ (막힘) 은 외부 사유가 있을 때만
- 관리자 콘솔 로그인 필요(비번 입력은 안 하는 동작) 같은 **내가 못 넘는 벽**만 ⛔. 사유를 원장·보고서에 명시하고 **사용자에게 그 로그인을 요청**한다.
- S2(비교)는 **두 env 변형이 같은 세션에 있어야** 성립 → env 하나뿐이면 ⛔(2nd env 필요) 또는 C- 커스텀 대체(사유 명시).
- "그냥 안 한 것"은 ⛔ 아니다. ⬜ 로 남기고 계속한다.
- ⛔ 남기기 = **서버 기록**으로만: `coverage_ledger(env, session, action="block", scenario=<id>, reason=<외부 사유 완결 문장(마침표)>, evidence=[evd_… | rpt_…@n](선택))` → 원장 행이 ⛔ blocked(사유 표시)로 바뀌고 todo 에서 빠진다(빈 사유 거부 · 보고서가 나중에 완료되면 ✅ 가 이긴다). 풀기 = `action="unblock", note=<까닭>`. 보고서·대화에 "⛔" 라고 적기만 한 것은 원장에 남지 않는다.

## 완료 게이트 (이거 통과 못 하면 "완료" 금지)
1. **다시 `coverage_ledger(env, session)` 를 불러** `todo` 가 0 인지 본다.
   - **적용 전수가 ✅ 또는 ⛔(외부사유 명시)** 여야 완료. `todo`(⬜)가 하나라도 있으면 **아직 안 끝났다** — Phase 1 로 돌아가 그걸 한다.
2. 🚨 **독립 검증 서브에이전트 `aar-reviewer` 를 반드시 부른다** — `Task(subagent_type="aar-reviewer", …)`. 프롬프트에 **이번 `session`·`env` + 이 리뷰의 배정 대상(target)과 tier 목표**(사용자 요청/env 에서 정한 것 — 있으면)를 넘겨라. 이 경로엔 operator verifier 가 없으니 **이 게이트가 유일한 독립 검증자**다.
   - 그 서브에이전트가 검사하는 것: ① **배정 대상에서 드리프트 안 했나**(다른 제품/표면으로 갈아타지 않았나 — 실사고) ② **tier 귀속이 정직한가**(확인한 tier 로 귀속, 배정 tier 목표와 어긋나지 않았나) ③ 커버리지 전수 ④ 증거 3종 세트 ⑤ 날조/베끼기/부정결론 회피.
   - **`PASS` 가 나와야만 "완료"** 라고 말한다. 결함 목록이 오면 **그 결함을 Phase 1~N 으로 돌아가 고친 뒤 다시 `aar-reviewer` 를 부른다**(PASS 까지 반복). 결함을 무시하고 완료 선언 금지.
   - 게이트 시작 때 aar-reviewer 가 `harness("digest")`(열린 개선)를 읽고 결함 목록과 함께 고칠 전략(묶음·순서)을 낸다 · 게이트 끝에 `harness("gate", …)` 로 회차 결과를 남긴다(하네스 탭 — 회차 추이). 결함을 고친 작업 단위가 끝나면 `harness("run", task, kind="fix", fixes=[<그 회차 hgr_…>], agents, calls)`.
   - 작업 중이나 끝에 실수·반복 실수·개선 방향이 보이면 보고서 끝에 쓰는 것과 별개로 `harness("improve", kind=token|accuracy|procedure|tool|instruction, text=<한두 문장>, where=<고칠 곳>)` 로 보낸다(MCP 가 없으면 AgentReview 저장소에서 `python -m aar_core.harness improve --kind … --text "…"`) — 같은 내용은 횟수가 쌓여 반복 실수가 드러난다.
3. **호출 이력 자기점검**(AgentReview 저장소가 있는 PC 만): 끝나면 `AgentReviewPlugin/vmscreen/vms-audit --self`(서브에이전트로 찍었으면 `-a <agentId>` 마다)를 돌려 위반·토큰 요약(출력 그대로 — 짧다)을 완료 보고에 붙인다. 위반은 실행마다 개선 접수함으로 한 건씩 간다(같은 내용 = 횟수 +1) — 다음 `recall` 의 근거.
4. 완료 보고에는 `coverage_ledger` 의 `table_md` 를 그대로 붙이고(✅/⛔/사유), **`aar-reviewer` 가 PASS 했다는 사실**도 적는다. 커버리지·미완료·검증결과를 숨기지 마라.
5. **하네스 끝 단계** — `skill("get", "_shared/refs/harness-end.md")`(플러그인 폴더에선 `skills/_shared/refs/harness-end.md`) 를 그대로 따른다(이번 대화에서 지적받은 실수·반복 실수를 규범에 반영 · 옛 `/aar_fix`).

> 🎯 **이 리뷰의 대상·tier 목표는 "무엇을 리뷰하라"는 요청·env 에서 온다(스킬이 특정 제품/tier 를 하드코딩하지 않는다).** 그 배정을 **첫 턴에 명확히 잡고** 모든 리포트의 주어를 그 대상으로 유지하라 — 그래야 `aar-reviewer` 의 드리프트/tier 게이트에 안 걸린다.

## 절대 규칙 (전부 MCP 로만 — 로컬 파일·localhost·스크립트 없음)
- **off-screen 금지.** 모든 캡처는 **내가 본 화면**을 떠서 `/api/v1/evidence` 로 POST. 서버 대리캡처·Xvfb·playwright 금지.
- **S0/S1/S2** 보고서는 `html_report`(MCP)가 서버 세션에 쓴다(로컬 폴더 생성·읽기 금지). **S3** 는 문서 스킬대로 조판한 docx 를 `upload_report_file`(content_b64 없이 → curl) 로 올린다(서버가 골격 검사). 과거 프리빌트 마스터 재사용 금지, 이번 세션 라이브 캡처만.
- 커버리지·완료 판정은 오직 `coverage_ledger`(MCP)로. 로컬에서 registry·세션폴더를 직접 읽으려 하지 마라(플러그인 PC 엔 없다).
