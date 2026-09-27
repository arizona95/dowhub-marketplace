# Architecture Diagram Function Skill — 구성도는 사진이 아니라 **Graph 데이터**

> **목적**: 검토 대상 SaaS 의 **서비스 구성도 / 형태별 관계 그래프** 를 **Graph 데이터**(영역·노드·흐름·간선)로 올리고, 서버가 그린 그림을 보고서·docx 에 쓴다.
> **산출물**: Graph 기록 1장 이상(`graph("put")` — rev 로 이력) · 보고서의 graph 블록 · docx 의 PNG(같은 데이터에서 서버가 그린 것).
> **사용처**: SaaS 보안검토 본 보고서의 **2. 서비스 구성**(kind `service_arch`) · **[별첨7] □ 서비스 개요** · S1-session-tree 의 형태별 관계 그래프(kind `session_flow`).
> 🚨 **HTML/SVG 를 손으로 그려 캡처하거나 PNG 를 `upload_report_file` 로 올리지 않는다**(2026-09-28 사용자 결정 — "그래프 그리는 게 지금 다 사진으로 되어 있는데,
> 그러지 말고 진짜 그래프 객체로 저장해줘"). 옛 사진 그래프는 모두 데이터로 옮겨졌다.

---

## 0. 트리거

- "서비스 구성도 그려줘" / "Architecture diagram" / "[본문 2. 서비스 구성] 작성" / "형태마다 관계 그래프"

---

## 1. 사전 준비

| 확인 사항 | 방법 |
|---|---|
| 검토 대상 SaaS 의 동작 흐름 파악 | 공식 문서 + 트래픽 캡처(프록시 flow) |
| 표시할 구성요소 5~10개 식별 | 사용자 PC / Proxy / IdP / SIEM / SaaS Server / 모델 / 외부 도구 등 — 이번에 확인한 것만 |
| 이미 있는 그래프 | `graph("list", product)` — 있으면 `graph("get", product, graph)` 의 body 를 고쳐 새 rev(새로 만들지 않는다) |
| 칸·어휘 | `graph("schema")` |

---

## 2. 절차

### Phase A — Graph 데이터 작성
1. 본문 = `{kind, title, subtitle?, basis, zones, nodes, flows, edges, remarks?, sources?, needs_review?, review_note?}`
   - `zones` = 신뢰경계 영역(열, 왼쪽 → 오른쪽): 예 사용자 단말(tone endpoint) · 사내망/경계 프록시(org) · 벤더 클라우드(vendor) · 제3자(third).
   - `nodes` = 박스(영역 안 위 → 아래). 첫 줄 `label`, 둘째 줄부터 `sub`. 이번에 관측하지 못한 구성요소는 `observed:false`(점선 상자).
   - `flows` = 흐름(행위) — 로그인 · 추론 요청·응답 · 로그 송신 등. `trigger` = 그 흐름을 유발한 실제 동작, 유발 못 했으면 `induced:false`.
   - `edges` = 화살표: `from`·`to`·`flow`·`hop`(①②③ — 모르면 '?')·`label`(무엇이 오가나 + 목적지 — 비면 거부)·`measured`(이번 실측 = 실선, 문서·미확인 = 점선)·
     `blocked`(시도했으나 막힘)·`evidence`(그 간선의 근거 — 같은 제품 보고서 캡처 블록 `rpt_…@n#<block_id>` · `label:<캡처 label>` · 문서 URL).
2. 🚨 **서버가 거부하는 것(날조 방지)**: 실측 간선에 근거 없음 · `basis:"docbased"` 인데 실측 간선이 있거나 `sources`(근거 URL)가 없음 · 유발 안 한 흐름의 간선이 실측 ·
   간선 라벨·홉 없음. 확인 못 한 것은 지어내지 말고 `needs_review:true` + `review_note`(사람이 무엇을 확인해야 하나) — 화면에 '사람 확인 필요' 로 드러난다.
3. 올리기: `graph("put", product, graph=<본문>, slug=<code 끝 — 서비스 구성도는 "service">, node=<트리 노드 — 서비스 구성도는 세션 트리 제품 루트, 형태 그래프는 그 형태 leaf>)`.
   두 종류가 필요하면 둘 다 데이터로:
   - **본문 2장용**(`slug:"service"`): 전체 관점(사용자 PC ↔ Proxy/IdP/SIEM ↔ SaaS Server ↔ 모델)
   - **별첨7 □ 서비스 개요용**(`slug:"service-flow"`): 설치/통신 흐름 관점(포트·도메인·예외 도메인 — 노드 sub 에)

### Phase B — 보고서에 넣기
4. **HTML 보고서**(html_report): 블록 `{"type":"graph","graph":"<그래프 code>","caption":…}` — 발행이 그 시점 rev 를 고정(ReportRef)하고 그림(svg)을 인라인한다.
5. **docx**(S3): `graph("render", product, graph, fmt="png")` 가 준 `url` 의 PNG 를 본문 2장 / 별첨7 자리에 넣는다(같은 데이터에서 그린 그림 — 따로 그리지 않는다).
   docx 를 `upload_report_file` 로 올릴 때 그림 파일을 따로 올리지 않는다.

---

## 3. 그림 규칙(서버가 그린다 — `aar_core/present_graph.py` 한 곳)

- 영역 = 점선 열(tone 색) · 노드 = 흰 상자(미관측은 점선) · 간선 = 흐름 색 곡선 + 화살촉 · 실선 = 실측 · 점선 = 문서·미확인 · 홉 알약(? = 미확인, × = 막힘).
- 간선 라벨은 곡선 위가 아니라 그림 아래 **간선 표**(홉 · 흐름 · 출발 → 도착 · 무엇이 오가나 · 구분 · 근거)에 전부 적힌다 — 글자가 겹치지 않는다.
- 범례(흐름 색·유발한 동작·선 모양)와 요약 줄(`remarks`)·근거 문서(`sources`)도 같은 그림에 들어간다.
- 너무 많은 요소: 본문 2장 = 핵심 5~7 노드, 별첨7 = 7~10 노드로 그래프를 나눈다.

---

## 4. 결과 판정

본 Function 자체는 결과 코드가 없다. Graph 가 올라가고(`graph("list")` 에 보임) 본문 2장 / 별첨7 / 형태 leaf 에 그 그림이 들어가면 됨.

---

## 5. 자주 만나는 이슈

| 증상 | 대처 |
|---|---|
| `graph put` 이 BAD_INPUT(problems) | problems 목록대로 — 실측 간선 근거·문서 URL·라벨·홉을 채우거나, 확인 못 했으면 needs_review + review_note |
| 같은 그래프를 다시 올리면 rev 가 안 오름 | 내용이 같으면 changed=false(정상) |
| CONFLICT | 그 사이 누가 고쳤다 — `graph("get")` 로 다시 읽고 고쳐 `expected_rev` 와 함께 put |
| 보고서에 그림이 안 보임 | 블록 `graph` 에 그래프 code(또는 grf_ id)를 넣었는지 — html_report 가 400 으로 까닭을 준다 |

---

## 6. 사용 예

```text
[대상] Claude Cowork 본문 2장 구성도
[graph put] product=claude-app, slug=service, kind=service_arch, basis=partial
  zones: 사용자 단말(endpoint) · 사내망(org) · Anthropic 클라우드(vendor)
  nodes: Cowork VM(Hyper-V) · 사내 Proxy · IdP · SIEM · Claude Server · 모델
  flows: 로그인 · 추론 · Audit 송신   edges: ①②③ + 라벨 + 근거 블록
[보고서] html_report blocks=[…, {"type":"graph","graph":"claude-app/arch/service","caption":…}]
[docx] graph("render", product="claude-app", graph="claude-app/arch/service", fmt="png") → url 의 PNG 를 2장에
```
