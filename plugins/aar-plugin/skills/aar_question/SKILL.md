---
name: aar_question
version: 2.0.0
description: |
  AgentAutoReview 자료에 대한 **질문 → 답 + 공유 링크**. 웹 'AI에게 질문하기'와 **같은 라이브러리**(같은 규칙·읽기 도구·그림·구성도·답 마무리)를
  쓰고, 답을 쓰는 LLM 만 너(이 대화의 Claude)다. 링크를 열면 로그인 없이 그 질문·답(그림·구성도 포함)이 웹과 같은 모양으로 보인다.
  `/aar_question <질문>` — "원격 제어 설정 어디 있어?", "개인 MCP 막고 회사 stdio MCP 만 쓰게 하려면?", "외부 접점 구성도 그려줘" 처럼.
  (새로 조사·실험하는 건 `/aar_review`·`/aar_update` — 이건 **이미 있는 자료만** 읽고 답한다.)
---

# aar_question — 웹 'AI에게 질문하기'와 같은 길

도구는 aar-mcp 의 `question` 하나. 규칙·도구 목록·답 모양은 서버 라이브러리에 있다 — 여기에 다시 쓰지 않는다.

1. **규칙 받기(대화에서 처음 한 번)** — `question("guide")` → `rules`(웹 백그라운드 Claude 의 시스템 프롬프트 원문) · `schema`(답 모양) · `tools`.
   rules 의 'aar-read 도구' = `question("read", tool=…, args={…})`, 'StructuredOutput 으로 낸다' = `question("publish", …)`. **rules 를 그대로 따른다**(답 구성·그림 자리표 `[[fig:…]]`·구성도·남은 ?·단계 `[[step:N]]`).
2. **읽기** — `question("read", tool=<이름>, args={…})` 로 필요한 만큼만. 같은 도구·같은 인자를 두 번 부르지 않는다. 구성도는 rules 대로 `diagram_guide` → `draw_diagram`.
3. **내기** — `question("publish", question=<사용자 질문 그대로>, answer=<답 글>, steps=[…], gaps=[{gap, product}], product=<화면 맥락 — 없으면 빈 값>, conversation=<이어 묻기면 앞 응답의 conversation>, model=<너의 모델 id — 예 claude-opus-5-5>)`.
   `model` 은 '답한 모델'로 웹 대화·공유 화면에 그대로 표시된다(비우면 'MCP 호출 측(모델 미기재)').
   서버가 웹과 같은 마무리를 한다(단계 검증 · 그림 풀기 · 질문 공백 기록 · 대화 저장 · 공유). 응답 `dropped`·`figures[].missing` 이 답 글과 어긋나면 고쳐서 다시 publish.
   gaps 는 질문 공백(후보)으로 기록될 뿐이다 — **업데이트로 넘기는 것은 사람이 큰 창 답 아래 '📮 피드백 주기'로 만든 피드백 카드뿐**이고 `/aar_update` 는 피드백 창고(`feedback("list")`)만 본다(2026-10-23). 사용자가 "이거 업데이트 때 채워" 라고 하면 큰 창 링크에서 그 차례의 📮 피드백 주기를 누르라고 안내한다.
4. **사용자에게** — 응답 `answer`(그림 자리는 그림 이름으로) 와 **`share` 링크를 그대로** 준다(단계가 있으면 `guide` 링크도). 주소를 손으로 만들지 않는다.
   이 대화는 웹 '지난 대화'에 'MCP' 표시로 남는다. 다음 질문은 `conversation` 을 넘겨 이어 묻는다.

## 절대 규칙
- **읽기만** — 트리·판정·연결을 고치지 않는다(질문 공백 기록만 예외 — 답 못 한 부분을 후보로 남기는 것 · 피드백 카드는 사람이 만든다). 고쳐야 할 게 보이면 답 끝에 한 줄로 알린다.
- **날조 금지** — read 에 없는 경로·key·id·판정·그림 주소를 쓰지 않는다. 확인 못 한 것은 '?' 로 남기고 gaps 에 적는다.
- 질문 공백(후보) 손으로 넣기·닫기: `question("gap_add", product, question, gaps=[…])` · `question("gap_close", id, status, resolution, reports)`.
