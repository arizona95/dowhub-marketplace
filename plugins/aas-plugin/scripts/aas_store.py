#!/usr/bin/env python3
"""aas 상태 저장 실행기 — 스킬(LLM)은 후보와 사유만 내고, **상태 변경은 전부 이 스크립트가 한다** (R19).

왜: 전엔 LLM 이 Read/Write 로 targets.json·pending.jsonl·requests/*.md 를 직접 고쳤다. 그러면
① 요청서를 쓴 뒤 워터마크를 올리기 전에 죽으면 다음 날 같은 변화가 또 발행되고,
② cron 이 겹치거나 scope/search 가 동시에 돌면 마지막 쓰기가 앞 쓰기를 덮고,
③ 손상 JSON·범위 밖 URL·잘못된 상태 전이를 막을 곳이 없었다.

여기서 보장하는 것 — 프로세스 간 락(`~/.aas/.lock`) · 원자 쓰기(고유 임시파일) · 다중 파일 저널 롤백 ·
스키마/ID/허용 URL/중복/상태 전이 검증 · 요청 생성 멱등성(같은 날 같은 항목 = 같은 request_id).

사용: python3 aas_store.py <명령> [옵션]   (출력은 JSON 한 덩어리, 실패는 exit 1 + {"ok":false,"error":…})
  init
  target add --slug S --name N [--vendor V --kind K --homepage H --reason R]
  target set --slug S --status new|review_requested|reviewing|active|dropped [--request-id ID] [--session SESS]
  target list [--status ST]
  url add --slug S|_ranking --url U --kind release|changelog|settings|plan|docs|ranking [--reason R]
  url health --url U --status healthy|redirected|transient_error|gone [--new-url U2]
  url list [--slug S]
  watermark get --url U
  watermark set --url U --marker '<json>'          (그 URL 의 변화가 전부 pending 에 들어간 직후에만)
  change add --slug S --url U --date D --title T --quote Q [--areas A1,B3] [--note N]
  change select --id ID [--areas A1] [--reason R]
  change skip --id ID --reason R
  pending [--state pending|selected|skipped|requested] [--limit N]
  request create --date YYYY-MM-DD --items-file F|-      (F 또는 stdin = {"changes":[{change_id, body_md}], "new_target": {slug, body_md}|null})
  request list [--date D]
  log --op OP [--slug S] [--url U] [--reason R]
환경변수 AAS_HOME 으로 저장 위치를 바꿀 수 있다(기본 ~/.aas). 테스트는 이걸 임시 폴더로 돌린다.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from datetime import date

HOME = os.environ.get("AAS_HOME") or os.path.join(os.path.expanduser("~"), ".aas")
TARGET_STATES = ("new", "review_requested", "reviewing", "active", "dropped")
TARGET_TRANSITIONS = {
    "new": {"review_requested", "dropped"},
    "review_requested": {"reviewing", "active", "new", "dropped"},
    "reviewing": {"active", "dropped"},
    "active": {"review_requested", "dropped"},
    "dropped": {"new"},
}
URL_KINDS = ("release", "changelog", "settings", "plan", "docs", "ranking")
HEALTH = ("healthy", "redirected", "transient_error", "gone", "pending_removal")
CHANGE_STATES = ("pending", "selected", "skipped", "requested")
MAX_UPDATES_PER_REQUEST = 5
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class StoreError(Exception):
    pass


# ── 파일 유틸 ────────────────────────────────────────────────────────────────
def _p(*parts):
    return os.path.join(HOME, *parts)


def atomic_write(path, text):
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_json(path, default):
    """손상 JSON 은 기본값으로 **덮지 않는다** — 명시적 실패(스킬 규칙: 멈추고 보고)."""
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    if not raw.strip():
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise StoreError(f"{os.path.relpath(path, HOME)} 손상(JSON 오류: {e}) — 사람이 고치기 전엔 진행 금지")


def read_jsonl(path):
    out = []
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as f:
        for i, ln in enumerate(f, 1):
            ln = ln.strip()
            if not ln:
                continue
            try:
                out.append(json.loads(ln))
            except json.JSONDecodeError as e:
                raise StoreError(f"{os.path.relpath(path, HOME)}:{i} 손상({e}) — 진행 금지")
    return out


def dump_jsonl(rows):
    return "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)


class Tx:
    """락 + 다중 파일 저널 트랜잭션. with Tx() as tx: tx.write(path, text) … 블록을 나갈 때 한꺼번에 반영."""
    def __init__(self):
        self.pending: dict[str, str] = {}
        self.fd = None

    def __enter__(self):
        os.makedirs(HOME, exist_ok=True)
        self.fd = os.open(_p(".lock"), os.O_RDWR | os.O_CREAT, 0o644)
        deadline = time.monotonic() + 30
        while True:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise StoreError("다른 aas 실행이 락을 30초 넘게 잡고 있다(중첩 실행?) — 이번 실행 중단")
                time.sleep(0.05)
        self._recover()
        return self

    def write(self, path, text):
        self.pending[path] = text

    def __exit__(self, et, ev, tb):
        try:
            if et is None and self.pending:
                self._commit()
        finally:
            fcntl.flock(self.fd, fcntl.LOCK_UN)
            os.close(self.fd)
        return False

    def _commit(self):
        entries = []
        for path in self.pending:
            prev = None
            if os.path.exists(path):
                with open(path, encoding="utf-8") as f:
                    prev = f.read()
            entries.append({"path": path, "prev": prev})
        atomic_write(_p(".journal"), json.dumps({"ts": time.time(), "entries": entries}, ensure_ascii=False))
        try:
            for path, text in self.pending.items():
                atomic_write(path, text)
        except Exception:
            self._rollback(entries)
            raise
        os.remove(_p(".journal"))

    def _recover(self):
        j = _p(".journal")
        if not os.path.exists(j):
            return
        try:
            with open(j, encoding="utf-8") as f:
                entries = json.load(f).get("entries") or []
        except Exception:
            entries = []
        self._rollback(entries)

    def _rollback(self, entries):
        for e in reversed(entries):
            try:
                if e.get("prev") is None:
                    if os.path.exists(e["path"]):
                        os.remove(e["path"])
                else:
                    atomic_write(e["path"], e["prev"])
            except Exception:
                pass
        try:
            os.remove(_p(".journal"))
        except FileNotFoundError:
            pass


# ── 검증 ───────────────────────────────────────────────────────────────────────
def _slug(s):
    if not s or not SLUG_RE.match(s) and s != "_ranking":
        raise StoreError(f"slug 형식 아님: {s!r} (소문자·숫자·._- 1~64자)")
    return s


def _url(u):
    if not u or not re.match(r"^https?://[^\s/]+", u or ""):
        raise StoreError(f"URL 형식 아님: {u!r}")
    if len(u) > 2000:
        raise StoreError("URL 너무 김")
    return u.strip()


def _date(d):
    if not d or not DATE_RE.match(d):
        raise StoreError(f"날짜는 YYYY-MM-DD: {d!r}")
    return d


def _url_hash(u):
    return hashlib.sha1(u.encode("utf-8")).hexdigest()


def _scope_urls(scope):
    return {e["url"] for lst in scope.values() for e in (lst or []) if isinstance(e, dict) and e.get("url")}


def _log(tx, **row):
    row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), **row}
    cur = ""
    if os.path.exists(_p("log.jsonl")):
        with open(_p("log.jsonl"), encoding="utf-8") as f:
            cur = f.read()
    tx.write(_p("log.jsonl"), cur + json.dumps(row, ensure_ascii=False) + "\n")


# ── 명령 ───────────────────────────────────────────────────────────────────────
def cmd_init(a):
    with Tx() as tx:
        for name, init in (("targets.json", {}), ("scope.json", {"_ranking": []})):
            if not os.path.exists(_p(name)):
                tx.write(_p(name), json.dumps(init, ensure_ascii=False, indent=1))
        os.makedirs(_p("seen"), exist_ok=True)
        os.makedirs(_p("requests"), exist_ok=True)
    return {"ok": True, "home": HOME}


def cmd_target_add(a):
    slug = _slug(a.slug)
    with Tx() as tx:
        t = read_json(_p("targets.json"), {})
        if slug in t:
            return {"ok": True, "slug": slug, "existing": True, "status": t[slug].get("status")}
        names = {v.get("name", "").lower() for v in t.values()}
        if a.name and a.name.lower() in names:
            raise StoreError(f"같은 이름의 목표가 이미 있다: {a.name!r} (별칭이면 기존 slug 를 써라)")
        t[slug] = {"name": a.name or slug, "vendor": a.vendor or "", "kind": a.kind or "", "homepage": a.homepage or "",
                   "status": "new", "added": date.today().isoformat(), "reason": a.reason or "",
                   "request_id": "", "last_review_session": ""}
        tx.write(_p("targets.json"), json.dumps(t, ensure_ascii=False, indent=1))
        _log(tx, skill="aas_scope", op="add_target", slug=slug, reason=a.reason or "")
    return {"ok": True, "slug": slug, "existing": False, "status": "new"}


def cmd_target_set(a):
    slug = _slug(a.slug)
    if a.status not in TARGET_STATES:
        raise StoreError(f"status 는 {TARGET_STATES}")
    with Tx() as tx:
        t = read_json(_p("targets.json"), {})
        if slug not in t:
            raise StoreError(f"목표 없음: {slug}")
        cur = t[slug].get("status", "new")
        if a.status != cur and a.status not in TARGET_TRANSITIONS.get(cur, set()):
            raise StoreError(f"허용되지 않는 전이: {cur} → {a.status}")
        t[slug]["status"] = a.status
        if a.request_id:
            t[slug]["request_id"] = a.request_id
        if a.session:
            t[slug]["last_review_session"] = a.session
        tx.write(_p("targets.json"), json.dumps(t, ensure_ascii=False, indent=1))
        _log(tx, skill="aas", op="target_state", slug=slug, reason=f"{cur}->{a.status}")
    return {"ok": True, "slug": slug, "from": cur, "to": a.status}


def cmd_target_list(a):
    t = read_json(_p("targets.json"), {})
    rows = [{"slug": k, **v} for k, v in t.items() if not a.status or v.get("status") == a.status]
    return {"ok": True, "targets": rows}


def cmd_url_add(a):
    slug = _slug(a.slug)
    url = _url(a.url)
    if a.kind not in URL_KINDS:
        raise StoreError(f"kind 는 {URL_KINDS}")
    with Tx() as tx:
        scope = read_json(_p("scope.json"), {"_ranking": []})
        if slug != "_ranking":
            t = read_json(_p("targets.json"), {})
            if slug not in t:
                raise StoreError(f"목표 없음: {slug} — target add 먼저")
        if url in _scope_urls(scope):
            return {"ok": True, "url": url, "existing": True}
        scope.setdefault(slug, []).append({"url": url, "kind": a.kind, "added": date.today().isoformat(),
                                           "reason": a.reason or "", "health": "healthy", "fails": 0})
        tx.write(_p("scope.json"), json.dumps(scope, ensure_ascii=False, indent=1))
        _log(tx, skill="aas_scope", op="add_url", slug=slug, url=url, reason=a.reason or "")
    return {"ok": True, "url": url, "existing": False}


def cmd_url_health(a):
    url = _url(a.url)
    if a.status not in ("healthy", "redirected", "transient_error", "gone"):
        raise StoreError("status 는 healthy|redirected|transient_error|gone (pending_removal 은 스크립트가 정한다)")
    with Tx() as tx:
        scope = read_json(_p("scope.json"), {"_ranking": []})
        hit = None
        for slug, lst in scope.items():
            for e in lst or []:
                if isinstance(e, dict) and e.get("url") == url:
                    hit = (slug, e)
        if not hit:
            raise StoreError(f"범위에 없는 URL: {url}")
        slug, e = hit
        before = e.get("health")
        if a.status == "healthy":
            e["health"], e["fails"] = "healthy", 0
        elif a.status == "transient_error":
            e["fails"] = int(e.get("fails") or 0) + 1
            e["health"] = "pending_removal" if e["fails"] >= 3 else "transient_error"
        elif a.status == "gone":
            e["health"] = "pending_removal"
        elif a.status == "redirected":
            e["health"] = "pending_removal"
            if a.new_url:
                nu = _url(a.new_url)
                if nu not in _scope_urls(scope):
                    scope[slug].append({"url": nu, "kind": e.get("kind", "docs"), "added": date.today().isoformat(),
                                        "reason": f"redirect from {url}", "health": "healthy", "fails": 0})
        tx.write(_p("scope.json"), json.dumps(scope, ensure_ascii=False, indent=1))
        _log(tx, skill="aas_scope", op="mark_url", slug=slug, url=url, reason=f"{before}->{e['health']}")
    return {"ok": True, "url": url, "health": e["health"], "fails": e.get("fails", 0)}


def cmd_url_list(a):
    scope = read_json(_p("scope.json"), {"_ranking": []})
    out = {k: v for k, v in scope.items() if not a.slug or k == a.slug}
    return {"ok": True, "scope": out}


def cmd_watermark_get(a):
    url = _url(a.url)
    return {"ok": True, "url": url, "marker": read_json(_p("seen", _url_hash(url) + ".json"), None)}


def cmd_watermark_set(a):
    url = _url(a.url)
    try:
        marker = json.loads(a.marker)
    except Exception as e:
        raise StoreError(f"marker 는 JSON: {e}")
    with Tx() as tx:
        scope = read_json(_p("scope.json"), {"_ranking": []})
        if url not in _scope_urls(scope):
            raise StoreError(f"범위에 없는 URL 의 워터마크는 올리지 않는다: {url}")
        tx.write(_p("seen", _url_hash(url) + ".json"),
                 json.dumps({"url": url, "marker": marker, "ts": time.strftime("%Y-%m-%dT%H:%M:%S")}, ensure_ascii=False, indent=1))
    return {"ok": True, "url": url}


def cmd_change_add(a):
    slug = _slug(a.slug); url = _url(a.url); d = _date(a.date)
    if not (a.title or "").strip() or not (a.quote or "").strip():
        raise StoreError("title 과 quote(원문 인용) 는 필수 — 인용할 문장이 없으면 변화가 아니다")
    cid = hashlib.sha1(f"{url}|{a.title.strip()}|{d}".encode("utf-8")).hexdigest()[:16]
    with Tx() as tx:
        scope = read_json(_p("scope.json"), {"_ranking": []})
        if url not in _scope_urls(scope):
            raise StoreError(f"범위(scope.json)에 없는 URL 에서 온 변화는 받지 않는다: {url}")
        rows = read_jsonl(_p("pending.jsonl"))
        if any(r.get("change_id") == cid for r in rows):
            return {"ok": True, "change_id": cid, "existing": True}
        rows.append({"change_id": cid, "slug": slug, "url": url, "date": d, "title": a.title.strip(),
                     "quote": a.quote.strip()[:2000], "areas": [x for x in (a.areas or "").split(",") if x],
                     "note": a.note or "", "state": "pending", "request_id": "",
                     "added": time.strftime("%Y-%m-%dT%H:%M:%S")})
        tx.write(_p("pending.jsonl"), dump_jsonl(rows))
    return {"ok": True, "change_id": cid, "existing": False}


def _set_change_state(cid, state, areas=None, reason=""):
    with Tx() as tx:
        rows = read_jsonl(_p("pending.jsonl"))
        hit = next((r for r in rows if r.get("change_id") == cid), None)
        if not hit:
            raise StoreError(f"change 없음: {cid}")
        if hit.get("state") == "requested":
            raise StoreError(f"{cid} 는 이미 요청서에 들어갔다(requested) — 바꿀 수 없다")
        hit["state"] = state
        if areas:
            hit["areas"] = [x for x in areas.split(",") if x]
        if reason:
            hit["reason"] = reason
        tx.write(_p("pending.jsonl"), dump_jsonl(rows))
        _log(tx, skill="aas_search", op="select" if state == "selected" else "skip", url=hit.get("url"), reason=reason or "")
    return {"ok": True, "change_id": cid, "state": state}


def cmd_change_select(a):
    return _set_change_state(a.id, "selected", a.areas, a.reason or "")


def cmd_change_skip(a):
    if not (a.reason or "").strip():
        raise StoreError("skip 에는 reason 필수 — 안 그러면 누락과 구분이 안 된다")
    return _set_change_state(a.id, "skipped", None, a.reason)


def cmd_pending(a):
    rows = read_jsonl(_p("pending.jsonl"))
    if a.state:
        rows = [r for r in rows if r.get("state") == a.state]
    if a.limit:
        rows = rows[: int(a.limit)]
    return {"ok": True, "count": len(rows), "changes": rows}


def cmd_request_create(a):
    d = _date(a.date)
    try:
        if a.items_file == "-":
            items = json.load(sys.stdin)          # 스킬은 파일을 쓸 권한 없이 heredoc 으로 넘긴다(권한 분리)
        else:
            with open(a.items_file, encoding="utf-8") as f:
                items = json.load(f)
    except Exception as e:
        raise StoreError(f"items-file 읽기 실패: {e}")
    changes = items.get("changes") or []
    new_target = items.get("new_target")
    if len(changes) > MAX_UPDATES_PER_REQUEST:
        raise StoreError(f"업데이트 항목은 하루 최대 {MAX_UPDATES_PER_REQUEST}건 — 나머지는 pending 에 남겨라(다음 날 후보)")
    for c in changes:
        if not c.get("change_id") or not (c.get("body_md") or "").strip():
            raise StoreError("changes[] 는 change_id 와 body_md(5~20줄) 필수")
        n = len([ln for ln in c["body_md"].strip().splitlines() if ln.strip()])
        if not 3 <= n <= 25:
            raise StoreError(f"{c['change_id']} body_md 줄수 {n} — 5~20줄 규격(허용 3~25)")
        if "|---" in c["body_md"]:
            raise StoreError(f"{c['change_id']} body_md 에 표가 있다 — 표 금지")
    if not changes and not new_target:
        return {"ok": True, "request_id": "", "count": 0, "note": "변화 없음 — 요청서 안 만듦"}
    with Tx() as tx:
        # 멱등성 먼저: 같은 날 같은 항목 집합이면(재실행·응답 유실 후 재시도) 기존 request_id 를 돌려준다
        key = hashlib.sha1(json.dumps({"d": d, "c": sorted(c["change_id"] for c in changes),
                                       "t": (new_target or {}).get("slug")}, sort_keys=True).encode()).hexdigest()[:12]
        os.makedirs(_p("requests"), exist_ok=True)
        existing = [fn for fn in os.listdir(_p("requests")) if fn.startswith(d + "-") and fn.endswith(".json")]
        for fn in existing:
            j = read_json(_p("requests", fn), {})
            if j.get("key") == key:
                return {"ok": True, "request_id": j.get("request_id"), "existing": True,
                        "count": len(changes) + (1 if new_target else 0), "file": _p("requests", d + ".md")}
        rows = read_jsonl(_p("pending.jsonl"))
        by_id = {r.get("change_id"): r for r in rows}
        for c in changes:
            r = by_id.get(c["change_id"])
            if not r:
                raise StoreError(f"change 없음: {c['change_id']}")
            if r.get("state") == "requested":
                raise StoreError(f"{c['change_id']} 는 이미 {r.get('request_id')} 에 발행됨 — 중복 발행 금지")
            if r.get("state") != "selected":
                raise StoreError(f"{c['change_id']} 는 selected 가 아니다({r.get('state')}) — change select 먼저")
        t = read_json(_p("targets.json"), {})
        if new_target:
            ts = new_target.get("slug")
            if ts not in t:
                raise StoreError(f"목표 없음: {ts}")
            if t[ts].get("status") != "new":
                raise StoreError(f"{ts} 는 new 가 아니다({t[ts].get('status')}) — 신규 요청 대상 아님")
            if not (new_target.get("body_md") or "").strip():
                raise StoreError("new_target.body_md 필수")
        n = len(existing) + 1
        rid = f"{d}-{n}"
        rec = {"request_id": rid, "date": d, "key": key, "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
               "changes": [{**{k: by_id[c["change_id"]].get(k) for k in ("change_id", "slug", "url", "title", "date", "areas")},
                            "body_md": c["body_md"].strip()} for c in changes],
               "new_target": ({"slug": new_target["slug"], "name": t[new_target["slug"]].get("name"),
                               "body_md": new_target["body_md"].strip()} if new_target else None)}
        for c in changes:
            by_id[c["change_id"]]["state"] = "requested"
            by_id[c["change_id"]]["request_id"] = rid
        if new_target:
            t[new_target["slug"]]["status"] = "review_requested"
            t[new_target["slug"]]["request_id"] = rid
            tx.write(_p("targets.json"), json.dumps(t, ensure_ascii=False, indent=1))
        tx.write(_p("pending.jsonl"), dump_jsonl(rows))
        tx.write(_p("requests", rid + ".json"), json.dumps(rec, ensure_ascii=False, indent=1))
        tx.write(_p("requests", d + ".md"), _render_day(d, [rec] + [read_json(_p("requests", fn), {}) for fn in existing]))
        _log(tx, skill="aas_search", op="request", reason=rid, url="", slug="",
             count=len(changes) + (1 if new_target else 0))
    return {"ok": True, "request_id": rid, "existing": False, "count": len(changes) + (1 if new_target else 0),
            "file": _p("requests", d + ".md")}


def _render_day(d, recs):
    recs = sorted(recs, key=lambda r: r.get("request_id", ""))
    out = [f"# AAR 리뷰 요청서 — {d}", ""]
    for r in recs:
        out.append(f"<!-- request_id: {r.get('request_id')} -->")
        if r.get("new_target"):
            out += [r["new_target"]["body_md"], ""]
        for c in r.get("changes") or []:
            out += [c["body_md"], f"근거: {c.get('url')}", ""]
    return "\n".join(out).rstrip() + "\n"


def cmd_request_list(a):
    d = _p("requests")
    if not os.path.isdir(d):
        return {"ok": True, "requests": []}
    out = []
    for fn in sorted(os.listdir(d)):
        if fn.endswith(".json") and (not a.date or fn.startswith(a.date)):
            j = read_json(os.path.join(d, fn), {})
            out.append({"request_id": j.get("request_id"), "date": j.get("date"), "changes": len(j.get("changes") or []),
                        "new_target": (j.get("new_target") or {}).get("slug")})
    return {"ok": True, "requests": out}


def cmd_log(a):
    with Tx() as tx:
        _log(tx, skill=a.skill or "aas", op=a.op, slug=a.slug or "", url=a.url or "", reason=a.reason or "")
    return {"ok": True}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="aas_store.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    p = sub.add_parser("target"); s = p.add_subparsers(dest="sub", required=True)
    q = s.add_parser("add"); q.add_argument("--slug", required=True); q.add_argument("--name"); q.add_argument("--vendor"); q.add_argument("--kind"); q.add_argument("--homepage"); q.add_argument("--reason")
    q = s.add_parser("set"); q.add_argument("--slug", required=True); q.add_argument("--status", required=True); q.add_argument("--request-id", dest="request_id"); q.add_argument("--session")
    q = s.add_parser("list"); q.add_argument("--status")
    p = sub.add_parser("url"); s = p.add_subparsers(dest="sub", required=True)
    q = s.add_parser("add"); q.add_argument("--slug", required=True); q.add_argument("--url", required=True); q.add_argument("--kind", required=True); q.add_argument("--reason")
    q = s.add_parser("health"); q.add_argument("--url", required=True); q.add_argument("--status", required=True); q.add_argument("--new-url", dest="new_url")
    q = s.add_parser("list"); q.add_argument("--slug")
    p = sub.add_parser("watermark"); s = p.add_subparsers(dest="sub", required=True)
    q = s.add_parser("get"); q.add_argument("--url", required=True)
    q = s.add_parser("set"); q.add_argument("--url", required=True); q.add_argument("--marker", required=True)
    p = sub.add_parser("change"); s = p.add_subparsers(dest="sub", required=True)
    q = s.add_parser("add"); [q.add_argument(f"--{k}", required=True) for k in ("slug", "url", "date", "title", "quote")]; q.add_argument("--areas"); q.add_argument("--note")
    q = s.add_parser("select"); q.add_argument("--id", required=True); q.add_argument("--areas"); q.add_argument("--reason")
    q = s.add_parser("skip"); q.add_argument("--id", required=True); q.add_argument("--reason", required=True)
    q = sub.add_parser("pending"); q.add_argument("--state"); q.add_argument("--limit")
    p = sub.add_parser("request"); s = p.add_subparsers(dest="sub", required=True)
    q = s.add_parser("create"); q.add_argument("--date", required=True); q.add_argument("--items-file", dest="items_file", required=True)
    q = s.add_parser("list"); q.add_argument("--date")
    q = sub.add_parser("log"); q.add_argument("--op", required=True); q.add_argument("--skill"); q.add_argument("--slug"); q.add_argument("--url"); q.add_argument("--reason")
    a = ap.parse_args(argv)
    fn = globals().get(f"cmd_{a.cmd}" + (f"_{a.sub}" if getattr(a, "sub", None) else ""))
    try:
        with Tx():          # 읽기 명령도 진입 시 저널 복구를 거친다(죽은 쓰기의 반쪽 상태를 읽지 않게)
            pass
        out = fn(a)
        print(json.dumps(out, ensure_ascii=False))
        return 0
    except StoreError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
