# dowhub-marketplace

스킬·플러그인·MCP 의 **정본**. 여기 있는 것만 배포되고, 여기 없는 것은 배포되지 않는다.

```
/plugin marketplace add https://github.com/arizona95/dowhub-marketplace.git
```

## 왜 저장소인가

전에는 카탈로그가 서버의 로컬 파일이었다. 누가 언제 무엇을 바꿨는지 남지 않았고, 검토도
없었고, 그 파일이 날아가면 목록이 통째로 사라졌다. 저장소로 옮기면 **모든 변경이 커밋이
되고, 모든 배포가 PR 을 거친다.**

## 업데이트 흐름

```
브랜치 → 수정 → PR → CI(3종) → 소유자 승인 → main 병합 → 배포
```

CI 가 통과하지 않으면 병합할 수 없고, `CODEOWNERS` 때문에 소유자 승인 없이도 병합할 수 없다.
**둘 다 통과해야** 사용자에게 나간다.

## 검증 태그

자산마다 **어떤 도구가 어느 버전으로** 검사했는지가 태그로 남는다. 도구가 올라가면 같은
코드에 대한 판정이 달라질 수 있으므로, 버전이 함께 있어야 나중에 재현이 된다.

| 등급 | 도구 | 무엇을 | 실패하면 |
|---|---|---|---|
| 기본 | `ruff` | 문법 오류·정의되지 않은 이름 | **병합 차단** |
| 기본 | `detect-secrets` | 자격증명 유출 | **병합 차단** |
| 기본 | `pip-audit` | OSV 취약점 + 버전 미고정 자동실행 런처 | **병합 차단** |
| 심화 | `black` | 코드 포맷 | 배포됨, 태그만 안 붙음 |
| 심화 | `skillspector` | 위협 패턴 561개 | 배포됨, 태그만 안 붙음 |

등급을 나눈 기준은 **실패의 뜻**이다. 기본에서 걸리는 건 깨진 배포물이라 내보내도 사용자
쪽에서 안 돌아간다. 심화는 판단이 섞이는 영역이라, 막기보다 "검증 안 된 상태로 보이게"
하는 편이 정직하다.

검증자를 추가할 때 워크플로는 안 고친다 — `.github/validators.json` 에 항목만 넣는다.

```json
{ "name": "mypy", "tier": "deep", "scope": "target",
  "cmd": ["mypy", "{target}"], "version_cmd": ["mypy", "--version"] }
```

## 변경된 것만 검사한다

매번 전 자산을 훑지 않는다. 손대지 않은 자산까지 다시 도는 건 낭비이기도 하지만, 무관한
자산 때문에 남의 PR 이 빨개지는 게 더 나쁘다. 단 `.github/` 가 바뀌면 판정 기준이 바뀐
것이므로 자동으로 전수로 올린다 — 옛 기준으로 받은 태그를 그대로 두면 안 된다.
주 1회 스케줄로도 전수를 돈다(도구·취약점DB 가 올라가면 판정이 달라지므로).

## 병합

```
브랜치 → 수정 → PR → 기본검증 → 자동 병합
```

기본검증이 초록불이 되면 GitHub 이 자동으로 병합한다(사람 승인 없음). 다만 **포크에서 온
PR 은 자동병합하지 않는다** — public 저장소라 누구나 PR 을 열 수 있고, 낯선 변경이 사람
눈 없이 배포되면 안 되기 때문이다.

## 로컬에서 미리 돌리기

```bash
python .github/scripts/secret_scan.py
python .github/scripts/sca_scan.py
python .github/scripts/sast_scan.py
python .github/scripts/validate_catalog.py
```

SAST 한도를 올릴 때는 `--update-baseline` 을 쓰되, **결과를 눈으로 확인한 뒤에만** 쓴다.
그 파일을 고치는 것이 곧 "이 위험을 승인한다"는 뜻이다.

## 구조

```
.claude-plugin/marketplace.json   정본 카탈로그
skills/                           스킬 원본
plugins/                          플러그인 원본
.github/scripts/                  CI 스캐너
.github/sast-baseline.json        승인된 SAST 한도
licenses/NOTICE.md                벤더링한 서드파티 출처
```

원격 MCP(`gmail_dowoo`·`test_dowoo`·`AARmcp`)는 소스가 아니라 엔드포인트라서 카탈로그에
카드로만 나열된다. 그 서버들은 각자 OAuth 로 자신을 보호한다.
