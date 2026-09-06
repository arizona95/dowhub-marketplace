"""aas_store 계약 테스트 — python3 test_aas_store.py"""
import json, os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); S = os.path.join(HERE, "aas_store.py")
_R = []
def check(n, ok, d=""):
    _R.append(bool(ok)); print(f"  {'PASS' if ok else 'FAIL'}  {n}" + (f" — {d}" if d and not ok else ""))
def run(home, *args):
    p = subprocess.run([sys.executable, S, *args], capture_output=True, text=True, env={**os.environ, "AAS_HOME": home})
    try: return p.returncode, json.loads(p.stdout.strip().splitlines()[-1])
    except Exception: return p.returncode, {"raw": p.stdout + p.stderr}

home = tempfile.mkdtemp()
rc, r = run(home, "init"); check("init", rc == 0 and r["ok"])
rc, r = run(home, "target", "add", "--slug", "acme", "--name", "Acme Agent", "--reason", "ranking#1"); check("target add", rc == 0 and r["status"] == "new")
rc, r = run(home, "target", "add", "--slug", "acme2", "--name", "acme agent"); check("같은 이름 목표 거부", rc == 1)
rc, r = run(home, "target", "set", "--slug", "acme", "--status", "active"); check("new→active 전이 거부", rc == 1)
rc, r = run(home, "url", "add", "--slug", "acme", "--url", "https://acme.example/changelog", "--kind", "release"); check("url add", rc == 0)
rc, r = run(home, "url", "add", "--slug", "acme", "--url", "ftp://x", "--kind", "release"); check("URL 형식 검증", rc == 1)
rc, r = run(home, "change", "add", "--slug", "acme", "--url", "https://other.example/x", "--date", "2026-09-07", "--title", "t", "--quote", "q"); check("범위 밖 URL 변화 거부", rc == 1 and "범위" in r.get("error", ""))
ids = []
for i in range(7):
    rc, r = run(home, "change", "add", "--slug", "acme", "--url", "https://acme.example/changelog", "--date", "2026-09-07", "--title", f"change {i}", "--quote", "orig text")
    ids.append(r["change_id"])
rc, r = run(home, "change", "add", "--slug", "acme", "--url", "https://acme.example/changelog", "--date", "2026-09-07", "--title", "change 0", "--quote", "orig text"); check("중복 change 는 existing", r.get("existing") is True)
rc, r = run(home, "watermark", "set", "--url", "https://acme.example/changelog", "--marker", '{"title":"change 6"}'); check("watermark set(범위 안)", rc == 0)
rc, r = run(home, "watermark", "set", "--url", "https://nope.example/", "--marker", '{}'); check("watermark 범위 밖 거부", rc == 1)
for cid in ids[:6]: run(home, "change", "select", "--id", cid, "--areas", "A1")
rc, r = run(home, "change", "skip", "--id", ids[6]); check("skip 은 reason 필수", rc != 0)
rc, r = run(home, "change", "skip", "--id", ids[6], "--reason", "무관"); check("skip ok", rc == 0)
body = "### [B] Acme · x\n기준: A1\n무엇이: a\n왜: b\nAAR: c\n"
f = os.path.join(home, "items.json")
json.dump({"changes": [{"change_id": c, "body_md": body} for c in ids[:6]], "new_target": None}, open(f, "w"))
rc, r = run(home, "request", "create", "--date", "2026-09-07", "--items-file", f); check("업데이트 6건은 한도 초과 거부", rc == 1 and "최대" in r.get("error", ""))
json.dump({"changes": [{"change_id": c, "body_md": body} for c in ids[:5]], "new_target": {"slug": "acme", "body_md": "### [A] Acme\n신규\n리뷰\n"}}, open(f, "w"))
rc, r = run(home, "request", "create", "--date", "2026-09-07", "--items-file", f); check("request create 6건", rc == 0 and r["count"] == 6 and r["request_id"] == "2026-09-07-1", str(r))
rid = r["request_id"]
rc, r2 = run(home, "request", "create", "--date", "2026-09-07", "--items-file", f); check("같은 항목 재실행 = 같은 request_id(멱등)", r2.get("existing") and r2["request_id"] == rid)
rc, r = run(home, "pending", "--state", "selected"); check("한도에 밀린 1건은 selected 로 남음(다음 날 후보)", r["count"] == 1 and r["changes"][0]["change_id"] == ids[5])
rc, r = run(home, "pending", "--state", "requested"); check("5건 requested + request_id", r["count"] == 5 and all(c["request_id"] == rid for c in r["changes"]))
rc, r = run(home, "target", "list", "--status", "review_requested"); check("목표 new→review_requested", len(r["targets"]) == 1 and r["targets"][0]["request_id"] == rid)
json.dump({"changes": [{"change_id": ids[0], "body_md": body}], "new_target": None}, open(f, "w"))
rc, r = run(home, "request", "create", "--date", "2026-09-08", "--items-file", f); check("이미 requested 인 change 재발행 거부", rc == 1 and "중복" in r.get("error", ""))
json.dump({"changes": [{"change_id": ids[5], "body_md": body}], "new_target": {"slug": "acme", "body_md": "x\ny\nz\n"}}, open(f, "w"))
rc, r = run(home, "request", "create", "--date", "2026-09-08", "--items-file", f); check("review_requested 목표는 다시 신규로 못 올림", rc == 1)
md = open(os.path.join(home, "requests", "2026-09-07.md"), encoding="utf-8").read()
check("요청서 md 렌더(신규 1 + 업데이트 5, 표 없음)", md.count("### [") == 6 and "|---" not in md)
# 크래시 복구: 저널만 남기고 죽은 상황 → 다음 명령이 되돌린다
tp = os.path.join(home, "targets.json"); orig = open(tp).read()
json.dump({"entries": [{"path": tp, "prev": orig}]}, open(os.path.join(home, ".journal"), "w"))
open(tp, "w").write("{broken")
rc, r = run(home, "target", "list"); check("저널 복구 후 정상 읽기", rc == 0 and len(r["targets"]) == 1)
open(tp, "w").write("{broken")
rc, r = run(home, "target", "list"); check("손상 JSON 은 빈값으로 덮지 않고 실패", rc == 1 and "손상" in r.get("error", ""))
open(tp, "w").write(orig)
# URL health
u = "https://acme.example/changelog"
for _ in range(3): run(home, "url", "health", "--url", u, "--status", "transient_error")
rc, r = run(home, "url", "list", "--slug", "acme"); check("transient 3회 → pending_removal(스크립트가 지우진 않음)", r["scope"]["acme"][0]["health"] == "pending_removal")
rc, r = run(home, "url", "health", "--url", u, "--status", "redirected", "--new-url", "https://acme.example/releases"); check("redirect 는 새 URL 추가", rc == 0)
rc, r = run(home, "url", "list", "--slug", "acme"); check("새 URL 이 범위에 들어감", any(e["url"].endswith("/releases") for e in r["scope"]["acme"]))
print(f"\n=== {sum(_R)}/{len(_R)} passed ==="); sys.exit(0 if all(_R) else 1)
