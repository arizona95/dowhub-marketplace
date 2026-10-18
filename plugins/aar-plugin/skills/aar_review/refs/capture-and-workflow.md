# 캡처·워크플로 참조 (툴에서 스킬로 이관 — 2026-08)

> 전엔 `save_evidence`·`review_playbook`·`scenario_start` 의 browser_gate 가 **MCP 툴이 문자열로
> 돌려주던 안내문**이었다. 부작용이 없는 순수 절차라 스킬(여기)로 옮겼다. **툴은 부작용만, 절차는 스킬.**

## 📸 증적 캡처 = 내가 본 화면을 내가 떠서 올린다
서버엔 브라우저가 없다 — 대신 열어주지도, 대신 찍어주지도 않는다. **두 경로뿐이고, 화면이 어디에
있느냐로 갈린다.** 둘 다 결과는 같다: 라벨이 붙은 캡처 한 장이 세션 증적 스토어에 쌓이고, 그 라벨을
리포트 블록의 `shot` 으로 쓴다.

**(A) 콘솔 안의 화면(RDP·프록시 뷰어) → 콘솔 캡처바의 📸 버튼**
콘솔이 이미 그 화면을 들고 있으므로 콘솔에게 저장시키는 게 정확하고, **페이지를 리로드하지 않아
RDP 가 재접속하지 않는다**. 상단 캡처바 라벨 칸에 라벨을 치고 `📸 증적저장` 클릭.
🚫 URL 에 `&capture=` 를 붙이지 마라 — 로드 순간 찍는 구조라 콘솔을 하드 로드해 RDP 를 끊고
검은 화면이 찍힌다.

**(B) 그 밖의 화면(공식문서 등) → 내가 떠서 POST** — 공식문서는 올린 뒤 `quote_shot(label, out_label, source_url, quotes=[{x,y,w,h,quote}], proves)` 로 문서 인용 세트를 만들고 응답의 `doc_block` 을 html_report 의 doc 블록에 넣는다. 🚫 캡처에 형광·빨간 네모를 칠해서 올리지 마라(좌표·인용문은 데이터로 — 공통수칙 §3-0-1).
- 올리는 곳: `POST https://dowmain.org/agentreview/api/v1/evidence` · body `{"label": "<라벨>", "image": "<dataURL>", "session": "<이번 세션명>", "env": "<env>", "scenario": "<시나리오 id>", "url": "<찍은 화면 URL>"}`
  🚨 **session 은 필수다(없으면 400).** 서버가 캡처를 그 세션에 귀속시켜(사이드카) 리포트 빌드 때 **같은 세션 증적만** 라벨로 고른다 —
  다른 세션의 동명 캡처는 섞이지 않는다. 응답의 `evidence_id` 를 받아 두면 `shot` 블록에 `evidence_id` 로 정확히 그 파일을 가리킬 수 있다(재촬영 시 새 id).
- 뜨는 법: 브라우저 스크린샷의 dataURL. RDP canvas 를 직접 떠야 하면 `toDataURL`(영역 크롭 1:1, 1920px).
- 값 판독은 **화면 텍스트 추출**로 — 픽셀을 눈으로 읽는 것보다 오독이 없다.

공통:
- 🚫 flow(질의/응답) 증적은 **L7-proxy 뷰어 화면**을 떠라 — raw API JSON(`/api/flows`)은 증적 무효.
- 🚫 서버 대리캡처·Xvfb·playwright·별도 브라우저 띄우기 금지(off-screen 금지 — 사람이 못 본다).
- 검정/백지 프레임은 증적이 아니다. 렌더 실패는 **도구 결함**이지 대상 제품의 결함이 아니다.

## 🖥️ 브라우저 = 내 브라우저 하나
- **S0(공개문서)** = 공식문서를 직접 열고 스크롤해 값을 확인 → 그 화면을 (B) 로 캡처.
- **S1~(env 실증)** = 콘솔을 열어 env 트리 → user-window-pc → RDP 로드 → 그 PC 조작 → (A) 로 캡처.
  제품 트래픽은 그 env(프록시 뒤)를 지나므로 **콘솔 flow 뷰**로 확인한다.

## 🎬 S1 라이브 실증 — 지킬 것 (옛 `scenario-capture` 스킬에서 옮김, 2026-10-18)
- 🚨 **명령은 RDP 화면 안 PowerShell 에서 직접 친다.** 헤드리스 실행 경로는 **없앴다** — az run-command 는 항상 SYSTEM 이라 유저 세션·per-user 앱·HKCU 를 못 봐 헛돌았다.
- 🚨 **창을 반드시 확인하고 쳐라** — 좌표로 포커스를 잘못 잡아 **명령이 대상 앱 입력창에 새어 들어간 사고**가 있었다(GPT 창에 PowerShell 을 친 것).
  ① 명령을 입력한 뒤 **터미널 화면 영역을 한 번 클릭해 포커스** ② **Enter 를 2~3번**(RDP/Guacamole 는 첫 Enter 가 씹히는 경우가 많다) ③ **스크린샷으로 프롬프트가 다음 줄로 넘어갔는지** 확인 ④ 오래 걸리면 **완료 전 다음 명령 금지**.
- 🚨🚨 **CLI형 SaaS(Claude CLI·Codex CLI·gemini-cli 등)는 터미널 자체가 피평가 앱이다** — 로그인·프롬프트 입력·응답 확인도 가시 RDP 터미널에서 한다. **shell/az 로 CLI 를 돌린 출력은 증적으로 절대 인정 못 받는다**(사용자가 로그인한 실제 세션이 아니라 "로그인 안 됨" 같은 거짓 실패가 뜬다 — 2026-07-23 실사고).
- 🚨🚨 **별도 관측주체(사내 프록시·OTel/Loki·Compliance)가 "봤다/기록했다"는 증적을 스크립트로 조회해 print 한 화면은 절대 금지**(2026-07 moncanary.py 사고). 프록시 관측 = 콘솔 L7-proxy 뷰어에 마커 필터→flow 클릭→요청/응답 detail 이 뜬 그 화면. OTel = log-server(Grafana/Loki Explore)에 쿼리→이벤트가 뜬 그 화면.
- 🚨 **콘솔 조작 = MCP 도구** — L7 정책 등록/삭제·flow 검색·clear/archive 는 `policy("create"|"list"|"delete", env, …)` · `clear_capture` · `archive_capture`. **모든 시나리오 끝에 archive_capture + cleanup(등록한 정책룰 `policy("delete", env, rule_id=…)`)을 try/finally 로 강제** — 다음 before 오염·사용자 세션 훼손 방지.
- 🖥️ **어느 PC 에서 할지** — user-window-pc(Windows) / user-linux-pc(Linux), 관리자 행위는 admin-window-pc. 대상이 한쪽 OS 에만 있으면 **반드시 그 PC**(미지원 OS 에 억지로 = 대상 결함이 아니라 PC 선택 오류).
- **부정(negative) 결론 전 체크리스트**: "안 보임 → 안 됨"으로 단정 금지. ① clear_capture 했나 ② 올바른 host/표면·flow 필터인가 ③ 충분히 기다렸나(설치·전파 지연) ④ 다른 채널(WS/SSE·다른 도메인·L4)로 나간 건 아닌가 — 넷 다 짚은 뒤에만 "미관측" 판정.
- **4단계 규율**: ① 실험(녹화 전 메커니즘이 진짜 되는지 하드증거로, 행동 전/후 *변화*를 둘 다 관측) ② 정리(실제로 본 것만 — 여기 없는 건 보고서에도 못 쓴다) ③ 라이브 캡처 ④ 보고서. **🚨 프레임 없으면 주장 없음.**

## 리뷰 워크플로 (요약)
1. 환경 확인/생성 → `env("get", name)` 의 `state` 가 **running** 이 될 때까지 대기(생성·기동은 수 분)
2. 대상 확정 → 적용 시나리오는 `coverage_ledger` 가 계산해준다(스코프 계약)
3. `scenario_start(env, id)` → 라이브 수행 → 캡처 POST
4. 리포트: S0/S1/S2 = `html_report`, S3 = 문서스킬로 조판 → `upload_report_file`(content_b64 없이 → curl 업로드, 서버가 골격 검사)
5. 확인: `report("list", session, env)` 의 실데이터로 보고(추측 금지)
