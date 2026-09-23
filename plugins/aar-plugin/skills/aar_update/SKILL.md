---
name: aar_update
description: |
  이 SaaS 를 **주기적으로(주 1회) 추적**하며 바뀐 것만 갱신한다 — 메뉴·세션·세팅·보존 4트리와
  해당 보고서를 **델타로** 업데이트. 전수 재캡처가 아니라 "지난번 이후 뭐가 달라졌나"를 찾아
  그 부분만. "주간 업데이트", "이 제품 추적", "바뀐 것만 갱신" 일 때. (처음/대규모 = aar_review 로 전수.)
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

> 🚨 **폴링 금지(절대).** env·VM·페이지·API 상태를 짧은 간격으로 반복 조회하며 기다리지 마라 — 열어둔 탭이 12일간 콘솔을 1~2초마다 조회해
> env 가 "활동 중"으로 잡혀 자동 정지가 안 걸리고 하루 종일 과금된 실사고(2026-09-15). 기다림은 **한 번 조회 → 아직이면 적고 넘어감**.
> 불가피하면 **총 30분 제한, 간격은 분 단위**, 30분 안에 안 되면 ⛔ 사유 보고. 작업이 끝나면 **탭·브라우저·프로세스를 닫는다**(열어둔 화면 = 폴링).
> 🧭 **env 는 제품으로 찾는다** — 사용자가 제품만 말하면(예: "Claude Desktop app 에서 ~") `env("for_product", name=<제품>)` 로 그 제품에 연결된 env 들과 (계정, 플랜) 세트를 받는다. 요청에 플랜·계정이 나오면 거기서 고른다(로그인은 사람이 한다 — 비밀번호를 묻거나 적지 않는다). 하나면 그것, 여럿이면 요청 문맥(프록시 강제 exp-close / 직접 egress exp-open 등)으로 고르고 모호하면 후보를 보여주고 묻는다. `exists:false` 는 없어진 env 라 쓰지 않는다. stopped 면 `env("start", name)`. 연결된 env 가 없으면 이름으로 추정하지 말고 `env("list")` 를 보여주고 묻는다 — 새로 만들지 않는다.
> 🛡 **도구 통제** — S1-governance 를 실증하면 셀마다 `tool_gov("set", product, artifact, creator, dist_action, …, evidence=[이 세션 보고서 rev], reason=완결 문장)` 로 기록한다. 근거 없는 O/X 는 저장되지 않는다. 정책은 `tool_gov("policy", product)`.
> 🔗 **연결** — 같은 대상을 가리키는 트리 노드·메뉴 항목·도구 통제 셀은 `link("add", a, b, note)` 로 잇는다(주소 tree:<트리>:<경로> · item:<제품>:<키> · toolgov:<제품>:<artifact>/<creator>/<action>). 확인한 것만.
> 🔁 **다시 리뷰할 때** — `report("lines", product=<제품>)` 로 그 제품의 보고서 줄을 먼저 본다. **kind=update(업데이트 문서)** 인 줄은 빠짐없이 같은 시나리오·같은 env 로 `html_report` 를 새로 내 새 버전을 만든다(이전 버전과의 diff 가 화면에 자동으로 남는다). kind=general(일반 문서)은 바뀐 게 있을 때만. 구분을 바꾸는 건 사용자가 시킨 때만(`report("kind", …)`).
> 🔄 **env 를 켜거나 끈 뒤(start/stop/create 완료 후)에는 콘솔을 Ctrl+Shift+R(강력 새로고침) 하고 접속하라.** 옛 연결을 물고 있으면 RDP·화면이 안 뜨는데, 그걸 env 고장으로 오판해 재시도(폴링)하지 마라.
> 🧸 **MenuToy 갱신은 리뷰 중에 바로.** 시나리오를 만들거나 리포트를 낼 때 그 시나리오가 다룬 항목을 aar-mcp `menutoy` 로 갱신한다 —
> `checklist_set`(판정·근거) · `popup_set`(메뉴 팝업 권고·위험·연결) · `web_add`(문서 근거) · 새 제품이면 `toy_create`(세션 제품명과 toy 이름이 달라도 `menutoy("toys")` 의 sources[].hosts 로 같은 SaaS 를 찾아 그 toy 를 갱신; 어느 toy 에도 없을 때만 새로). 판정은 근거가 리포트에 있을 때만.

# 주기적 SaaS 추적·업데이트 (aar_update)

한 번 전수(aar_review)한 SaaS 를 **시간을 두고 추적**한다. 매 실행은 **지난번 대비 델타**만:
바뀐 메뉴/세션/세팅/보존을 4트리에 반영하고, 그 변화가 건드리는 보고서를 갱신한다.

## 원칙 — 델타만 (전수 아님)
- **변화 없는 것 재캡처·재-desc 금지.** update_tree 는 added/removed/renamed/changed 만 events 로 잡는다. 같은 화면을 매주 다시 찍어 같은 설명을 반복하지 마라.
- 전수 재실행이 필요할 만큼 크게 바뀌었으면 → **aar_review 로 넘겨라**(이 스킬은 증분 추적).

## 절차
0. **갱신 대상 찾기(여기서 시작)** — `update_targets("list", product)`. 컨텐츠에 달린 `update` 속성(주기·방법)이 진실이다:
   due 인 것만 처리하고, 없는 것을 새로 만들지 마라. how 별로 —
   · `tree` = 그 제품 루트 아래를 화면으로 재검토해 **바뀐 것만** `update_tree`(아래 1~4)
   · `collect` = `menutoy("collect", product, source, url=<env>)` 잡 → `collect_status` → 파싱 오류면 파서 수정·`reparse`(2-1)
   · `web` = 그 문서 URL 을 실제로 열고 `menutoy("web_check", product, url=…, html=<연 본문>)` 로 **확인 사실**을 남긴다(같음이어도 남긴다 — 그래야 갱신 완료).
     내용이 바뀌었으면 이어서 `web_add` 로 카드 설명을 고친다. 못 열었으면 html 없이 불러 unreachable 로 남긴다(완료 아님).
   갱신 완료로 세는 것 = **succeeded 로 끝난 수집**(collect_status 의 status) · **web_check same|changed** · 트리 커밋. 시작만 한 수집·partial·failed 는 완료가 아니다.
   목록에 없는 새 컨텐츠를 추적하고 싶으면 `update_targets("set", ref, period)`(제품 전체는 `set_product`) — 사용자가 시킨 때만.
1. **기준선 읽기** — 4트리 각각 `tree("get", tree_id)` (menu·session·settings·retention). "지난번엔 뭐가 있었나".
2. **제품 재관찰** — 내 브라우저로 제품을 훑어 **바뀐 지점**을 찾는다(새 메뉴·사라진 항목·값 변경·새 세션형태·세팅 기본값 변경·보존정책 변경).
2-1. **MenuToy 수집(env 를 켠 김에)** — 제품마다 `/aar_menutoy` 의 1)~4) 를 그대로: `menutoy("collect", product, source, url=<env>)` 로 소스별 웹 메뉴를 다시 긁고
   → `menutoy("sources", product)` 로 파싱 오류 확인 → 깨졌으면 파서 수정·`reparse` → reparse 의 added/removed/changed 로 체크리스트 연결(`checklist_set`·`popup_set`·`web_add`) 갱신.
   toy 의 +/− 가 곧 "메뉴가 바뀌었다"는 증거이므로 3)·5) 의 델타 판단에 같이 쓴다. VM 브라우저 로그인이 풀려 있으면 ⛔ 사유(로그인은 사용자 몫).
3. **트리 델타 반영** — 바뀐 앵커에만 `update_tree(tree_id, node_path=[바뀐 지점], patch=[그 아래 현재])`. 삭제 판정은 앵커 서브트리 안에서만.
4. **무엇이 바뀌었나 기록** — `tree("changelog", tree_id, since=지난추적일)` 로 이번 델타를 시간축으로 확인(added/−removed/~changed).
5. **영향 보고서 갱신** — 그 변화가 통제/동작에 영향 있으면(예: 새 egress 경로, 새 관리자 토글, 보존기간 변경) **해당 시나리오만** 재실증(`scenario_start`→라이브 캡처→`html_report`) + 그 블록의 `items=[<그 노드 id>]` 로 보고서 재연결(옛 `tag` 도 받는다). 바뀐 것은 먼저 항목에(`update_tree`·`shot_set`·`checklist_set`) 남기고 보고서는 요약만 — 메뉴 전체 나열 금지. 변화 없는 시나리오는 건드리지 마라.
6. **추적 로그 남기기** — 이번에 무엇이 바뀌어 무엇을 갱신했는지 `memory_note(kind='note')`. 다음 추적이 이어받는다.
   끝에 `update_targets("list", product)` 를 다시 불러 due 가 남아 있으면 그 사유를 보고한다(마지막 갱신 시각은 자료에서 읽히므로 따로 적지 않는다).

## 무엇을 추적하나 (4트리 = 4관점)
- **menu** — 제품 UI 메뉴가 추가/삭제/개편됐나.
- **session** — 새 세션·환경 형태(새 클라·새 접속경로)가 생겼나.
- **settings** — 관리자 세팅 항목·기본값이 바뀌었나(통제 표면 변화).
- **retention** — 데이터 보존/삭제 정책이 바뀌었나.

## 절대 규칙
- off-screen 금지 — 내가 직접 열어 본 것만(추측 노드 금지). 캡처는 내 화면을 떠서 /api/v1/evidence 로 POST.
- 로그인 뒤 화면은 로그인 필요 → blocked + 사유, 사용자에게 요청.
- 신선도=내용(md5), mtime 아님. 갱신 보고서도 이번 라이브 캡처만.
