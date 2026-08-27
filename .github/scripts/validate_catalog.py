#!/usr/bin/env python3
"""카탈로그 불변식 — marketplace.json 이 스스로 모순되지 않는지.

여기서 막는 건 "위험"이 아니라 "거짓말"이다. 카탈로그가 실재하지 않는 폴더를 가리키거나,
카드에 적힌 버전이 plugin.json 과 다르면, 사용자는 받은 것과 다른 것을 봤다고 믿게 된다.
그 어긋남은 보안 검사로는 안 잡힌다.

종료코드: 0 = 통과, 1 = 위반, 2 = 실행 오류
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

CATALOG = Path(".claude-plugin/marketplace.json")


def main() -> int:
    if not CATALOG.exists():
        print(f"{CATALOG} 가 없습니다.")
        return 2
    try:
        doc = json.loads(CATALOG.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"{CATALOG} 파싱 실패: {e}")
        return 1

    errors: list[str] = []
    for key in ("name", "owner", "plugins"):
        if key not in doc:
            errors.append(f"최상위 필수 키 없음: {key}")
    entries = doc.get("plugins", [])
    if not isinstance(entries, list):
        print("plugins 는 배열이어야 합니다.")
        return 1

    seen: set[str] = set()
    for e in entries:
        name = e.get("name", "")
        where = f"[{name or '이름없음'}]"
        if not name:
            errors.append(f"{where} name 이 비어 있습니다.")
        if name in seen:
            errors.append(f"{where} 이름이 중복됩니다.")
        seen.add(name)

        hub = e.get("hub") or {}
        etype = hub.get("type")
        if etype not in ("mcp", "skill", "plugin"):
            errors.append(f"{where} hub.type 이 mcp/skill/plugin 이 아닙니다: {etype!r}")

        src = e.get("source")
        if etype in ("skill", "plugin", "mcp"):
            if not src:
                errors.append(f"{where} {etype} 인데 source 가 없습니다 — 설치할 게 없습니다.")
            else:
                p = Path(str(src).lstrip("./"))
                if not p.is_dir():
                    errors.append(f"{where} source 폴더가 없습니다: {src}")
                elif etype == "plugin":
                    man = p / ".claude-plugin" / "plugin.json"
                    if not man.is_file():
                        errors.append(f"{where} plugin.json 이 없습니다: {man}")
                    else:
                        try:
                            mv = json.loads(man.read_text(encoding="utf-8")).get("version")
                        except json.JSONDecodeError:
                            errors.append(f"{where} plugin.json 파싱 실패")
                            mv = None
                        # 버전이 어긋나면 업데이트 판정이 틀어진다 — 배포 사고의 단골 원인.
                        if mv and e.get("version") and mv != e["version"]:
                            errors.append(f"{where} 버전 불일치: 카탈로그 {e['version']} "
                                          f"!= plugin.json {mv}")
                        if mv and hub.get("version") and mv != hub["version"]:
                            errors.append(f"{where} hub.version({hub['version']}) 이 "
                                          f"plugin.json({mv}) 과 다릅니다.")
                elif etype == "skill":
                    # 스킬은 SKILL.md 의 frontmatter 로 언제 쓸지가 정해진다.
                    if not (p / "SKILL.md").is_file():
                        errors.append(f"{where} SKILL.md 가 없습니다: {p}")
                elif etype == "mcp":
                    # MCP 는 원격 엔드포인트라 스킬 파일이 없다. 배포물은 클라이언트가
                    # 실제로 쓰는 연결 매니페스트다.
                    if not (p / ".mcp.json").is_file():
                        errors.append(f"{where} .mcp.json 이 없습니다: {p}")
        if etype == "mcp" and not hub.get("url"):
            errors.append(f"{where} mcp 인데 hub.url 이 없습니다.")

        # 외부 소스는 반드시 커밋으로 핀돼 있어야 한다. 핀이 없으면 upstream 이 언제든
        # 내용을 바꿀 수 있고, 그러면 이 저장소의 리뷰·CI 가 무의미해진다.
        if isinstance(src, dict):
            if not src.get("sha"):
                errors.append(f"{where} 외부 source 에 sha 핀이 없습니다.")

    print(f"항목 {len(entries)}개 검사")
    if errors:
        for x in errors:
            print(f"  위반: {x}")
        print(f"\n실패 — {len(errors)}건.")
        return 1
    print("통과 — 카탈로그와 실제 파일이 일치합니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
