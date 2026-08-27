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

## CI 3종

| 검사 | 무엇을 | 한도 |
|---|---|---|
| **정보유출** `secret_scan.py` | 자격증명 형태(앱비번·토큰·개인키 등)가 들어왔는지 | **없음** — 1건이라도 실패 |
| **SCA** `sca_scan.py` | 버전이 고정되지 않은 자동실행 런처 + 알려진 취약점(OSV) | **없음** |
| **SAST** `sast_scan.py` | 스킬·플러그인 소스의 위협 패턴 561개 | baseline 대비 **증가분만** |

세 검사의 한도가 다른 데는 이유가 있다.

- **정보유출에 예외가 없는 이유**: 이 저장소는 public 이다. 한 번 push 된 비밀은 되돌려도
  GitHub 이벤트 API·포크·미러에 남는다. "나중에 지우면 된다"가 성립하지 않으므로 아예 못 들어오게 한다.
- **SCA 에 예외가 없는 이유**: `npx pkg@latest` 같은 부동 스펙은 세션 시작 시 레지스트리가
  그때 주는 코드를 실행한다. 카탈로그가 커밋을 핀해도 이건 안 고정된다 — 핀을 뚫는 구멍이라
  예외를 두면 핀 자체가 무의미해진다.
- **SAST 만 baseline 인 이유**: 스킬은 **원래** 코드를 실행하고 밖으로 나간다. `gmail_peek` 만
  해도 자격증명을 읽고 외부 호스트에 붙으므로 `credential_theft`·`data_exfiltration` 이 정직하게
  잡힌다. 절대 건수로 막으면 아무것도 배포하지 못한다. 그래서 각 자산이
  `.github/sast-baseline.json` 에 자기 몫을 선언하고, **그 선을 넘을 때만** 실패한다.
  선을 올리려면 baseline 을 고쳐야 하고, 그 diff 가 리뷰어에게 "위험이 늘었다"는 신호가 된다.

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
