---
name: aar_review
description: |
  Path 보안 리뷰 — 새 SaaS 를 처음 마주했거나 대규모 업데이트 후, 그 제품의 화면 행위를
  **Path**(계획 → 걷기 → 부산물 계산)로 전부 수행해 보고서·판정을 낸다. 시작 전에 Path 나무로
  범위를 못박고, 계획된 Path 가 전부 걸리거나 까닭과 함께 거둬지기 전엔 "완료"라고 못 한다.
  "전수 리뷰", "새 제품 리뷰 돌려", "S0~S3 보고서 써줘" 일 때.
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
> 🧭 **env 는 제품으로 찾는다** — 사용자가 제품만 말하면 `env("for_product", name=<제품>)` 로 그 제품에 연결된 env 들과 (계정, 플랜) 세트·**실험 제약(constraints)** 을 받는다. 요청에 플랜·계정이 나오면 거기서 고른다(로그인은 사람이 한다 — 비밀번호를 묻거나 적지 않는다). 하나면 그것, 여럿이면 요청 문맥(프록시 강제 exp-close / 직접 egress exp-open 등)으로 고르고 모호하면 후보를 보여주고 묻는다. `exists:false` 는 없어진 env 라 쓰지 않는다. stopped 면 `env("start", name)`. 연결된 env 가 없으면 이름으로 추정하지 말고 `env("list")` 를 보여주고 묻는다 — 새로 만들지 않는다.
> 🎚 **판정 확실도 = 보고서 검증 하네스가 매긴다** — 판정은 O/X/-/? 넷 그대로. 판정 칸은 판정 Path 를 `path("project")` 할 때 그 Path 의 고리 사진을 근거로 적히고, 확실도(상·중·하 + 까닭)는 **검증 하네스**(독립 검사자가 검사표로 최대 4회차 · 닫히는 회차가 그 보고서가 받친 칸 확실도를 쓴다)가 정한다 — `skill("get", "_shared/refs/report-harness.md")`. ? 는 판정을 받치는 캡처가 전혀 없을 때만.
> 🔁 **다시 리뷰할 때** — `report("lines", product=<제품>)` 로 그 제품의 보고서 줄을 먼저 본다. 보고서 종류(kind)는 다섯이다 — **periodic(정기 업데이트)** 인 줄은 빠짐없이 같은 목적·같은 env 로 Path 를 새로 걷고 `path("project")` 로 새 버전을 만든다(이전 버전과의 diff 가 화면에 자동으로 남는다). required(필수)는 리뷰마다 한 번은 있어야 하고(없으면 만든다), next(다음 실험)는 다음 실험·미판정 칸을 적은 보고서, other(기타)는 필요할 때만, experiment(실험 보고서)는 판정 표를 채우는 실험 라운드다(판정을 바꾸거나 ? 를 채울 때 새 세션으로). 구분을 바꾸는 건 사용자가 시킨 때만(`report("kind", …)`).
> 🔄 **env 를 켜거나 끈 뒤(start/stop/create 완료 후)에는 콘솔을 Ctrl+Shift+R(강력 새로고침) 하고 접속하라.** 옛 연결을 물고 있으면 RDP·화면이 안 뜨는데, 그걸 env 고장으로 오판해 재시도(폴링)하지 마라.

# Path 리뷰 (aar_review)

제품의 화면 행위를 **Path** 로 계획하고, 걷고, 그 원자료에서 보고서·판정을 계산해 낸다. 이 스킬은 **범위를 임의로 줄이고 일부만 한 채 "완료"를
선언하는 것**과 **부산물을 손으로 적어 원자료와 어긋나게 만드는 것**을 막는다.

## 🧭 뼈대 — 적는 것은 Path 하나뿐
- **Path** = 실험 조건 7칸(plan·mdm·priv·role·session·version·region) + 고리(상태 → 판단·목적 → 행동 → 다음 상태)의 줄. 원자료는 걸음마다 덧붙기만 한다.
- **메뉴－화면 지도 · 트리 4종 · 연결 · 보고서 · 판정 표는 전부 Path 에서 계산되는 부산물**이다. 손으로 적지 않는다.
- 🚨 **부산물이 틀리면 부산물을 고치지 않는다 — Path 를 다시 찍거나(`path("plan")`→`path("walk")`) 계산 규칙을 고친다**(규칙 결함은 `harness("improve", kind="tool", …)` 로 보낸다).
  `tree("update")` · `link("add")` · `shot(…)` · `tool_gov`/`monitor`/`net_control` 의 `fact_set`/`effect_set` · `report("publish")` 를 화면 행위의 결과를 적으려고 직접 부르지 않는다 — 그건 `path("project")` 가 한다.
- 걷기는 **env 화면 하나에 하나**다. 다른 걷기가 화면을 쥐고 있으면 `path("walk")` 가 BUSY 를 돌려준다 — 기다리며 다시 부르지 말고(폴링) 쥔 걷기의 `path("status")` 를 한 번 보고 적는다.

## 🚨 이 스킬이 막는 실수 (전부 실제로 일어난 것)
1. **"대표 몇 개만" 금지.** 리뷰 범위 = 이 제품에 계획된 Path 전부다. **첫 턴에 `path("list")` 로 Path 나무를 대화에 붙이지 않으면 이 실수가 난다.**
2. **증적이 범위를 정하게 두지 마라.** 이미 있는 캡처에 맞는 목적을 고르는 게 아니라, 목적이 요구하는 Path 를 새로 걷는다.
3. **"정직한 미실시 표기"는 완료 조건이 아니다.** 계획됨(planned)으로 남은 Path 는 할 일이다. 걷거나, 까닭을 적어 `path("cancel")` 한다.
4. **부산물 손 편집.** 트리 노드·연결·판정 칸을 손으로 적으면 원자료에 없는 사실이 생긴다. 그 순간 다시 계산하면 사라지거나 어긋난다.
5. **감사를 안 읽고 걷기만 돌리기.** 걷기는 디버깅 모드로 돌고 감사자가 걸음 경계에서 세워 살핀다 — `path("get")` 의 `last_audit`(text·say·stop·fixed·next_min)을 읽지 않으면 헛걸음을 몇 시간 못 본다.

## Phase 0 — 제품·env·범위 (작업 전 필수)
1. 🔁 **반복 실수부터**: `memory("recall", <제품·주제>)` 와 `harness("digest")`(열린 개선·반복 실수). AgentReview 저장소가 있는 PC 면 `AgentReviewPlugin/vmscreen/vms-audit recall` 도 본다(없는 PC 면 건너뜀).
2. **제품** — `product("list")`. 없는 제품이면 `product("create", code, name, envs?)`(사용자가 새 제품 리뷰를 시킨 때만).
3. **env** — `env("for_product", name=<제품>)`. 돌아온 **`constraints`(실험 제약)를 먼저 읽고 그대로 따른다**(그 글이 허락한 조작은 다시 묻지 않는다 · 금지한 조작은 하지 않는다). `plans`·`accounts` 가 실험 조건 7칸의 재료다.
4. **범위** — `path("list", product)` 로 Path 나무(계획됨 포함)를 받아 대화에 붙인다. 이것이 이번 리뷰의 **범위 계약**이다.
   - 나무가 비었거나 요청한 목적이 없으면 `path("plan", product, kind, purpose, target?, expect?, why?, context?, parent?)` 로 목적마다 Path 하나를 계획한다(걷지 않음).
     kind = `discover`(지도 넓히기) · `judge`(판정 칸 채우기) · `use`(실제 사용 — 트래픽·모니터링) · `verify`(설정 하나 바꿔 보고 되돌림) · `research`(공식 문서 조사) · `scenario`(정해진 절차).
     `purpose` 는 "무엇을 확인하나" 한 문장, `expect` 는 기대 결과, `context` 는 7칸 전부(빈 값 없이 — 모르면 env 답에서 읽는다, 지어내지 않는다).
   - 판정 Path 는 지도에 있는 장소를 `target` 으로 잡는다(지도에 없는 장소는 먼저 `discover` Path 로 찍는다).

## Phase 1~N — Path 하나씩 (계획됨 → 걸음 → 부산물)
1. **걷기 시작** — `path("walk", product, walk=<wlk_…>, args={…})`. args 는 걷기 입구의 인자다:
   - 필수: `env` · `pc`(어느 PC 화면인가) · `session`(캡처가 올라갈 세션) · `brief`(이 제품·표면이 무엇인지 사실 한 단락) · `concept`(걷는 방식) · `entry_name`·`entry_steps`(표면에 들어가는 조작) · `leave_steps`(나오는 조작) · `scope`(표면 안/밖 경계) · `press_forms`(누를 수 있는 것의 모양) · `never`(절대 누르지 않을 것 — 결제·삭제·초대·로그아웃 등).
   - 자주 쓰는 선택: `mode`(기본 `debug` — 걸음마다 규칙 점검 · 다 되면 `run`) · `max_steps`(기본 100 — 처음엔 작게) · `context`(7칸) · `focus` · `route` · `resume`(멈춘 걷기 이어 걷기).
   - 🚨 인자 값은 **그 제품의 사실**(env 답·공식 문서·지난 Path 의 args)에서 가져온다. 다른 제품의 값을 옮겨 쓰지 않는다.
   - 돌아온 `exited` 가 숫자면 바로 끝난 것이다 — `log_tail` 을 읽고 원인(인자 오류·화면 잠금)을 고친다.
2. **기다림 = 폴링 금지.** 걷기는 서버에서 돈다. `path("status", product, walk)` 는 **필요할 때 한 번** 부른다 — `job.running` · `steps` · `last_audit` 를 읽는다.
   - `last_audit.next_min` 이 다음 감사까지의 분이다. 그 전에 다시 물을 까닭이 없다.
   - `last_audit.stop` 이 있으면 감사자가 걷기를 세운 것이다 — `text`·`say` 의 까닭을 읽고, 고칠 것(인자·계산 규칙·사람 몫의 벽)을 처리한 뒤 `resume` 으로 잇는다.
   - 내가 멈출 때는 `path("stop", product, walk)` — 그 걷기로 띄운 것만 멈춘다.
3. **부산물 계산** — 걷기가 끝나면 `path("project", product, walk, env?)`. 그 Path 의 보고서를 원자료에서 만들어 발행하고, 판정 Path 면 판정 탭(실체·사실)까지 적는다.
   - 응답의 `report_url` · `quality_ok` · `quality_warning` · `harness`(검증 하네스 회차·남은 실패)를 읽는다. 판정 Path 는 검증 하네스 회차가 확실도를 정한다 — `skill("get", "_shared/refs/report-harness.md")`.
   - `ok:false` 면 그 까닭("고리 없음" · "판정 결과 없음" · "env 를 모름")대로 처리한다 — 보고서를 손으로 대신 쓰지 않는다.
4. **틀린 Path 거두기** — 잘못 걸은 Path 는 `path("cancel", product, walk, why=<완결 문장>)`, 여러 개는 `path("retire", product, walks=[…], why)`. 원자료는 지우지 않고 옮기며 모든 탭이 다시 계산된다. 돌아온 batch(`rtb_…`)로 `path("restore", product, batch)` 하면 되살아난다.
5. **차례** — `research`(문서) → `discover`(지도) → `use`·`verify`(실험) → `judge`(판정) → 종합 문서. 판정 Path 는 지도에 그 장소가 있어야 고를 수 있다.

## 📄 사람이 쓰는 글 — 종합 문서(S3)와 문서 근거
- Path 보고서의 글·그림은 `path("project")` 가 고리 사진과 결과에서 만든다(지어낸 문장 없음). 내가 본문을 쓰는 건 **종합 문서**뿐이다.
- **종합(S3-1·S3-2)** 은 문서 스킬대로 docx 를 조판한다 — 뼈대는 `skill("get", "aar_review/report-skills/S3-1")` 로 **원문 그대로** 받아 따른다(기억으로 재현 금지). 🚨 종합은 판정 칸의 실측·문서 캡처를 다 채운 뒤 쓴다(? 가 수두룩한 채로 내지 않는다).
  만든 뒤 `report("upload", session, scenario, "report.docx")` 를 **content_b64 없이** 불러 1회용 토큰·`curl` 명령을 받고 그 명령을 Bash 로 실행한다. 응답의 `quality_ok`·`checks` 확인 — 서버가 골격을 검사해 미달본은 올리지 않는다.
- 구성도·관계 그래프는 사진이 아니라 Graph 데이터로 — `report-skills/section2-arch-diagram` 대로 `graph("put")`, docx 엔 `graph("render", fmt="png")` 주소의 PNG.
- 사람이 읽는 글을 쓸 때 규칙(완성기준 RC-25·RC-26): 제목은 무엇을 확인했나 한 문장(Path id·칸 이름·캡처 번호 금지) · 요약은 확인한 것 한 줄 + **굵은 결론** · 그림마다 앞 글(무엇을 보여 주는 그림인지·기대값)과 뒤 글(읽을 것과 그 뜻) · 메뉴 위치는 '상위 › 하위 › 항목' 처럼 › 로 잇고 다른 화면은 `[[menu:…]]` `[[tree:…]]` `[[photo:…]]` `[[tg:…]]` `[[nc:…]]` `[[rep:…]]` `[[doc:주소|이름]]` 알약으로 건다 · 맨 주소 한 줄 금지.

## ⛔ (막힘) 은 외부 사유가 있을 때만
- 로그인·2단계 인증·결제처럼 **내가 넘지 않는 벽**만 ⛔ 다. 묻기 전에 기록(env 답의 accounts·constraints · 지난 Path)을 먼저 본다 — 이미 된 로그인을 또 묻지 않는다.
- 막힌 Path 는 `path("cancel", product, walk, why=<외부 사유 완결 문장>)` 으로 남기고 사용자에게 그 사람 몫을 요청한다. 대화에 "⛔" 라고 적기만 한 것은 기록에 남지 않는다.
- 비교 Path 는 두 env 변형이 있어야 성립한다 — env 하나뿐이면 ⛔(둘째 env 필요). env 를 새로 만들지 않는다.
- "그냥 안 한 것"은 ⛔ 가 아니다. 계획됨으로 남기고 계속한다.

## 완료 게이트 (이거 통과 못 하면 "완료" 금지)
1. **다시 `path("list", product)`** — 계획됨(planned)으로 남은 Path 가 0 이어야 한다(전부 걸었거나, 까닭을 적어 거뒀거나). 걸은 Path 는 전부 `path("project")` 가 `ok` 로 끝났어야 한다.
2. 🚨 **독립 검증 서브에이전트 `aar-reviewer` 를 반드시 부른다** — `Task(subagent_type="aar-reviewer", …)`. 프롬프트에 **제품·env·세션 + 이 리뷰의 배정 대상(target)과 tier 목표**를 넘긴다.
   - `PASS` 가 나와야만 "완료"라고 말한다. 결함 목록이 오면 그 결함을 고친 뒤(Path 다시 찍기·계산 규칙 수정) 다시 부른다(PASS 까지).
   - 게이트 끝에 `harness("gate", …)` 로 회차 결과를 남기고, 결함을 고친 작업 단위가 끝나면 `harness("run", task, kind="fix", fixes=[<그 회차 hgr_…>], agents, calls)`.
   - 작업 중 실수·반복 실수·개선 방향이 보이면 `harness("improve", kind=token|accuracy|procedure|tool|instruction, text=<한두 문장>, where=<고칠 곳>)`.
3. **호출 이력 자기점검**(AgentReview 저장소가 있는 PC 만): `AgentReviewPlugin/vmscreen/vms-audit --self` 의 위반·토큰 요약을 완료 보고에 붙인다.
4. 완료 보고에는 `path("list")` 의 Path 나무(걸음 수·상태·거둔 까닭)와 각 `report_url`, **`aar-reviewer` 가 PASS 했다는 사실**을 적는다. 미완료·검증 결과를 숨기지 않는다.
5. **하네스 끝 단계** — `skill("get", "_shared/refs/harness-end.md")` 를 그대로 따른다.
6. 끝나면 **탭·브라우저를 닫는다**. env 정지는 자동 정지에 맡긴다(사용자가 끄라고 한 때만 `env("stop")`).

> 🎯 **이 리뷰의 대상·tier 목표는 "무엇을 리뷰하라"는 요청·env 에서 온다(스킬이 특정 제품/tier 를 하드코딩하지 않는다).** 그 배정을 **첫 턴에 명확히 잡고** Path 의 `purpose`·`context` 와 종합 문서의 주어를 그 대상으로 유지하라.

## 절대 규칙 (전부 MCP 로만 — 로컬 파일·localhost·스크립트 없음)
- **화면 행위의 기록 = Path.** 손으로 본 화면을 트리·연결·판정에 적지 않는다. 걷기 입구를 셸로 직접 띄우거나 저장소를 직접 고치지 않는다 — `path` 도구로만.
- **판정은 O / X / - / ? 넷**, 근거 캡처가 없으면 ?. 이유는 완결 문장(근거 → 판정). 확실도(상·중·하)는 검증 하네스가 정한다.
- **비밀번호·토큰을 묻거나 적지 않는다.** env 답에 접속 정보가 섞여 와도 대화·보고서에 옮기지 않는다.
- 범위·완료 판정은 오직 `path("list")` 와 `aar-reviewer` 로. 과거 보고서·다른 세션 캡처 재사용 금지 — 이번에 걸은 Path 만.
