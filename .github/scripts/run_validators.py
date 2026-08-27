#!/usr/bin/env python3
"""검증자를 돌려 자산별 태그(마크)를 계산한다.

태그는 이 마켓플레이스의 자격증이다. 5개가 다 붙은 자산은 문법·구조·유출·위협패턴·공급망을
전부 통과했다는 뜻이고, 카탈로그 카드에 그대로 보인다.

두 등급의 성격이 다르다:
  basic — 통과해야 병합된다. 실패하면 CI 가 빨간불이다. 여기서 막히는 건 '깨진 배포물'이라
          내보내면 사용자 쪽에서 그냥 안 돌아간다.
  deep  — 실패해도 CI 는 초록불이다. 대신 그 태그가 안 붙는다. 위협패턴·공급망은 판단이
          섞이는 영역이라 배포를 막기보다 '검증 안 된 상태로 보이게' 하는 편이 정직하다.

검증자를 추가할 때 이 파일은 안 고친다 — .github/validators.json 에 항목만 넣으면 된다.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REGISTRY = Path(".github/validators.json")
MARKS = Path(".github/marks.json")


def assets() -> list[str]:
    """검증 대상 = 이 저장소가 실제로 배포하는 것들."""
    out = []
    for base in ("skills", "plugins", "mcp"):
        out += [p.as_posix() for p in sorted(Path(base).glob("*")) if p.is_dir()]
    return out


def run(cmd: list[str], target: str) -> tuple[bool, str]:
    argv = [a.replace("{target}", target) for a in cmd]
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=900)
    except FileNotFoundError:
        # 검증자 실행파일이 없으면 '실패'가 아니라 '판정 불가'다. 없는 도구 때문에 태그를
        # 떼면, 도구를 지우는 것만으로 검증을 통과시킬 수 있다는 뜻이 되어 더 위험하다.
        return False, f"{argv[0]} 를 찾을 수 없습니다 (미설치)"
    except subprocess.TimeoutExpired:
        return False, "시간 초과"
    tail = (r.stdout + r.stderr).strip().splitlines()
    return r.returncode == 0, (tail[-1] if tail else "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", choices=["basic", "deep", "all"], default="all")
    ap.add_argument("--write", action="store_true", help="marks.json 갱신")
    args = ap.parse_args()

    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))["validators"]
    chosen = [v for v in reg if args.tier in ("all", v["tier"])]
    targets = assets()

    marks = json.loads(MARKS.read_text(encoding="utf-8")) if MARKS.exists() else {}
    failed_basic = []

    for t in targets:
        entry = marks.setdefault(t, {})
        print(f"\n{t}")
        for v in chosen:
            ok, msg = run(v["cmd"], t if v["scope"] == "target" else ".")
            entry[v["name"]] = ok
            icon = "O" if ok else "X"
            print(f"  [{icon}] {v['name']:14} ({v['tier']:5}) {msg[:88]}")
            if not ok and v["tier"] == "basic":
                failed_basic.append(f"{t}/{v['name']}")

    # 요약: 5개 다 붙은 자산이 '완전 검증'이다.
    total = len(reg)
    print("\n" + "=" * 60)
    for t in targets:
        got = sum(1 for v in reg if marks.get(t, {}).get(v["name"]))
        tags = " ".join(v["label"] for v in reg if marks.get(t, {}).get(v["name"]))
        print(f"  {t:34} {got}/{total}  {tags}")

    if args.write:
        MARKS.write_text(json.dumps(marks, ensure_ascii=False, indent=2) + "\n",
                         encoding="utf-8")
        print(f"\nmarks 기록: {MARKS}")

    if failed_basic:
        print(f"\n기본검증 실패: {', '.join(failed_basic)}")
        return 1
    if args.tier == "deep":
        # 심화는 떨어져도 CI 를 세우지 않는다. 태그가 안 붙는 것으로 충분히 드러난다.
        print("\n심화검증 완료 (실패해도 CI 는 통과 — 태그로만 반영됩니다).")
    else:
        print("\n기본검증 통과.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
