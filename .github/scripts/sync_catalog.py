#!/usr/bin/env python3
"""카탈로그 카드를 진실원과 맞춘다 — 손으로 적은 값이 어긋나지 않게.

플러그인 버전은 두 군데에 있다: plugin.json(설치·업데이트를 결정하는 진짜 값)과
marketplace.json 카드(화면에 보이는 값). 손으로 맞추면 반드시 어긋난다 — 실제로
AARplugin 이 1.0.15 로 올라간 뒤에도 카드는 1.0.14 를 계속 보여줬다. 사용자는 받은 것과
다른 것을 봤다고 믿게 되는데, 이런 어긋남은 보안 검사로는 안 잡힌다.

그래서 카드 값을 사람이 적지 않고 plugin.json 에서 끌어온다. 진실원은 하나다.

  --check : 어긋나면 종료코드 1 (CI 용)
  --write : 카탈로그를 진실원에 맞춰 고친다

MCP 의 도구 목록은 여기서 다루지 않는다. 진실원이 이 저장소가 아니라 살아있는 서버라,
정적으로 맞출 수 없다(그 어긋남은 다른 방법으로 잡아야 한다).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

CATALOG = Path(".claude-plugin/marketplace.json")


def truth_version(entry: dict) -> str | None:
    """이 항목의 진짜 버전. 플러그인만 저장소 안에 진실원이 있다."""
    if (entry.get("hub") or {}).get("type") != "plugin":
        return None
    src = entry.get("source")
    if not isinstance(src, str):
        return None
    man = Path(src.lstrip("./")) / ".claude-plugin" / "plugin.json"
    if not man.is_file():
        return None
    try:
        return json.loads(man.read_text(encoding="utf-8")).get("version")
    except json.JSONDecodeError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    doc = json.loads(CATALOG.read_text(encoding="utf-8"))
    drift = []
    for e in doc.get("plugins", []):
        v = truth_version(e)
        if not v:
            continue
        hub = e.setdefault("hub", {})
        for holder, key in ((e, "version"), (hub, "version")):
            if holder.get(key) != v:
                drift.append(f"{e['name']}: {'hub.' if holder is hub else ''}version "
                             f"{holder.get(key)!r} != plugin.json {v!r}")
                holder[key] = v

    if not drift:
        print("일치 — 카탈로그가 plugin.json 과 같습니다.")
        return 0

    for d in drift:
        print(f"  어긋남: {d}")
    if args.write:
        CATALOG.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
        print(f"\n{len(drift)}건을 진실원에 맞춰 고쳤습니다: {CATALOG}")
        return 0
    print(f"\n실패 — {len(drift)}건 어긋났습니다."
          "\n고치려면: python .github/scripts/sync_catalog.py --write")
    return 1


if __name__ == "__main__":
    sys.exit(main())
