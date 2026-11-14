#!/usr/bin/env node
// 사내 MCP 개발 키트 — 개발 플러그인 스크립트(워크스페이스 폴더에서 실행)
//   setup  --kit <주소> [--name <MCP 이름>] [--desc <설명>]   워크스페이스에 goose·srt·mcp-test 설치 + 사내 Git 저장소 연결
//   ci     [-m <커밋 메시지>]                                  commit·push → 사내 CI 결과를 기다려 통과/실패(실패 줄만) 보고
//   test   -t <질문> [--with-extension <명령>]                 CI 를 통과한 지금 코드만 goose(srt 샌드박스)에서 시험
//   approve <번호> [--deny 1]                                시험 중 툴 호출 승인 요청에 답하고 이어서 결과를 기다림
//   wait                                                     뒤에서 도는 시험의 다음 승인 요청·끝을 기다림
//   deploy                                                   CI 를 통과한 커밋으로 배포 요청
//   mode   [on|off]                                          실행 모드 보기·바꾸기 — on: CI 켬(통과 커밋만 · 바깥 네트워크 열림)
//                                                            off: CI 끔(검사 없이 바로 · 관리자 화이트리스트 네트워크만)
//   status [<요청 번호>]                                      배포 요청 상태
// 키를 PC 에 새로 저장하지 않는다 — 사내 Git 자격 증명(Git Credential Manager 가 OS 저장소에 둔 것)을 그때그때 꺼내 쓴다.
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, rmSync, openSync, closeSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";

const WIN = process.platform === "win32";
const WS = process.cwd();
const KIT = join(WS, ".kit");
const CONF = join(KIT, "workspace.json");
const LAST = join(KIT, "last-ci.json");
// 사내 마켓플레이스에서 받은 플러그인에는 그 회사 키트 주소가 들어 있다(kit.json)
const PLUGIN_KIT = join(dirname(fileURLToPath(import.meta.url)), "..", "kit.json");

// 사내 CA 는 회사 PC 의 OS 인증서 저장소에 있다 — Node 가 그것을 쓰게 한 번 다시 띄운다.
// --use-system-ca 가 없는 Node(22.15·23.8 전 — 2026-11-14 Azure 사용자 PC 22.12 실측)는 Windows 신뢰 저장소를 PEM 으로 내보내 NODE_EXTRA_CA_CERTS 로
if (!process.env.KITDEV_REEXEC) {
  const env = {...process.env, KITDEV_REEXEC: "1"};
  const flags = [];
  if (process.allowedNodeEnvironmentFlags.has("--use-system-ca")) flags.push("--use-system-ca");
  else if (WIN) {
    // 이미 있던 NODE_EXTRA_CA_CERTS(회사 TLS 검사 CA 등)는 덮어쓰지 않고 OS 저장소 PEM 뒤에 합친다
    const pem = join(tmpdir(), "kitdev-os-ca.pem");
    const ps = "$o=@(); foreach($s in 'Cert:\\LocalMachine\\Root','Cert:\\CurrentUser\\Root'){ foreach($c in Get-ChildItem $s){ " +
      "$o += '-----BEGIN CERTIFICATE-----'; $o += [Convert]::ToBase64String($c.RawData,'InsertLineBreaks'); $o += '-----END CERTIFICATE-----' } }; " +
      `[IO.File]::WriteAllLines('${pem}', $o)`;
    if (spawnSync("powershell", ["-NoProfile", "-Command", ps], {stdio: "ignore"}).status === 0 && existsSync(pem)) {
      const prev = process.env.NODE_EXTRA_CA_CERTS;
      if (prev && existsSync(prev)) writeFileSync(pem, readFileSync(pem, "utf8") + "\n" + readFileSync(prev, "utf8"));
      env.NODE_EXTRA_CA_CERTS = pem;
    }
  }
  if (flags.length || env.NODE_EXTRA_CA_CERTS !== process.env.NODE_EXTRA_CA_CERTS) {
    const r = spawnSync(process.execPath, [...flags, ...process.argv.slice(1)], {stdio: "inherit", env});
    process.exit(r.status ?? 1);
  }
}

const say = m => console.log(m);
function die(msg, code = 1) { console.log(`KITDEV-FAIL: ${msg}`); process.exit(code); }

function args(argv) {
  const out = {_: []};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
    else if (a === "-m" || a === "-t") out[a.slice(1)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

function run(cmd, argv, opt = {}) {
  const r = spawnSync(cmd, argv, {cwd: WS, encoding: "utf8", ...opt});
  if (r.error) die(`${cmd} 를 실행하지 못했습니다: ${r.error.message}`);
  return r;
}
function git(...a) {
  const r = run("git", a);
  return {ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim()};
}
function mustGit(...a) {
  const r = git(...a);
  if (!r.ok) die(`git ${a.join(" ")} 실패: ${r.err || r.out}`);
  return r.out;
}

const readJson = (f, d = null) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return d; } };
const conf = () => readJson(CONF) || die("이 워크스페이스는 아직 준비되지 않았습니다 — 먼저 mcp-setup 을 실행하세요");

// Git Credential Manager 로그인 창을 띄울 수 있게 — GIT_TERMINAL_PROMPT=0 이면 GCM 이 창까지 막는다
// ("Cannot prompt because user interactivity has been disabled" — 2026-11-14 Azure 사용자 PC 실측, Claude 의 Bash 에서 실행될 때)
function credEnv() {
  const env = {...process.env, GCM_INTERACTIVE: "always"};
  delete env.GIT_TERMINAL_PROMPT;
  return env;
}

// 사내 Git 자격 증명 — 처음이면 Git Credential Manager 가 브라우저 로그인을 띄운다
function gitToken(pub) {
  const u = new URL(pub);
  const input = `protocol=${u.protocol.replace(":", "")}\nhost=${u.host}\npath=git\n\n`;
  const r = run("git", ["credential", "fill"], {input, env: credEnv()});
  const pw = /^password=(.*)$/m.exec(r.stdout || "");
  if (r.status !== 0 || !pw) die(`사내 Git(${u.host}) 로그인 정보를 얻지 못했습니다 — Git for Windows(Git Credential Manager)가 설치돼 있는지 확인하고, 브라우저 로그인 창이 뜨면 로그인하세요. (${(r.stderr || "").trim().slice(0, 200)})`);
  const user = /^username=(.*)$/m.exec(r.stdout)?.[1] || "";
  const back = verb => () => run("git", ["credential", verb], {input: r.stdout});
  return {user, token: pw[1], approve: back("approve"), reject: back("reject")};
}

class Kit {
  constructor(pub) { this.pub = pub.replace(/\/+$/, ""); this.cred = null; }
  // 사내 Git 계정 하나로 — GCM 이 OAuth 토큰을 줬든 비밀번호 창에 넣은 비밀번호든 Basic <계정:값> 으로 키트·Gitea 둘 다 받는다
  auth() {
    this.cred ??= gitToken(this.pub);
    return `Basic ${Buffer.from(`${this.cred.user}:${this.cred.token}`).toString("base64")}`;
  }
  async call(method, path, body, {raw = false, git = false} = {}) {
    const url = git ? `${this.pub}/git/api/v1${path}` : `${this.pub}${path}`;
    let r;
    for (let i = 0; i < 2; i++) {
      const headers = {Authorization: this.auth(), ...(body ? {"Content-Type": "application/json"} : {})};
      try { r = await fetch(url, {method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual"}); }
      catch (e) { die(`${this.pub} 에 닿지 않습니다: ${e.cause?.code || e.message}`); }
      if (r.status !== 401) { if (!this.approved) { this.cred.approve(); this.approved = true; } break; }
      // 저장된 자격 증명이 낡았다(비밀번호 바뀜·지워진 토큰) — 지우고 GCM 로그인 창으로 한 번 다시 묻는다
      this.cred.reject();
      this.cred = null;
      if (i === 0) say("사내 Git 로그인이 거절됐습니다 — 저장된 자격 증명을 지우고 다시 묻습니다(로그인 창이 뜨면 사내 Git 계정으로 로그인하세요)");
    }
    if (r.status === 401) die("사내 서버가 로그인을 받아들이지 않았습니다 — 로그인 창에 사내 Git 계정·비밀번호를 넣었는지 확인하고 다시 실행하세요");
    const text = await r.text();
    if (!r.ok) return {status: r.status, error: (() => { try { return JSON.parse(text).detail || text; } catch { return text; } })().toString().slice(0, 600)};
    return {status: r.status, data: raw ? text : (text ? JSON.parse(text) : null)};
  }
  async must(method, path, body, opt) {
    const r = await this.call(method, path, body, opt);
    if (r.error !== undefined) die(`${method} ${path} → ${r.status}: ${r.error}`);
    return r.data;
  }
}

function ensureIgnore() {
  const f = join(WS, ".gitignore");
  const have = existsSync(f) ? readFileSync(f, "utf8") : "";
  const need = [".kit/", ".venv/", "__pycache__/"].filter(l => !have.split(/\r?\n/).includes(l));
  if (need.length) appendFileSync(f, (have && !have.endsWith("\n") ? "\n" : "") + need.join("\n") + "\n");
}

function writeBom(file, text) { writeFileSync(file, "﻿" + text, "utf8"); }

// 설치 스크립트에는 클라이언트·srt 파일 해시가 들어 있다 — 지난번에 받은 것과 다르면 키트가 바뀐 것이니 다시 설치(setup·test 공용)
async function ensureKit(kit, force) {
  const script = join(KIT, WIN ? "install.ps1" : "install.sh");
  const body = await kit.must("GET", WIN ? "/download/install.ps1" : "/download/install.sh", null, {raw: true});
  const prev = existsSync(script) ? readFileSync(script, "utf8").replace(/^\uFEFF/, "") : null;
  if (!existsSync(join(KIT, "kit.json")) || force || prev !== body) {
    if (prev !== null && prev !== body) say("사내 키트가 바뀌어 goose 시험 환경을 새로 받습니다");
    const code = (await kit.must("POST", "/api/dlcode")).code;
    const env = {...process.env, KIT_TOKEN: code, KIT_DIR: KIT};
    let r;
    if (WIN) {
      writeBom(script, body);
      r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {cwd: WS, env, stdio: "inherit"});
    } else {
      writeFileSync(script, body);
      r = spawnSync("sh", [script], {cwd: WS, env, stdio: "inherit"});
    }
    if (r.status !== 0) die("goose 시험 환경 설치가 실패했습니다(위 출력 참고)");
  } else say(`goose 시험 환경은 최신입니다 (${KIT})`);
}

async function setup(a) {
  const pub = (a.kit || readJson(CONF)?.public || readJson(PLUGIN_KIT)?.public || "").replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+/.test(pub)) die("사내 MCP 키트 주소가 필요합니다 — 예: mcp-setup --kit https://mcp.사내도메인");
  if (run("git", ["--version"]).status !== 0) die("git 이 없습니다 — Git for Windows 를 설치하세요");
  mkdirSync(KIT, {recursive: true});
  const kit = new Kit(pub);
  const me = await kit.must("GET", "/api/download");
  kit.cred.approve();
  say(`사내 키트 ${pub} 로그인 확인 · goose ${me.version}`);

  // 1) 워크스페이스에 goose · srt · mcp-test (사내 설치 스크립트를 KIT_DIR 로)
  await ensureKit(kit, a.reinstall);

  // 2) 사내 Git 저장소 연결
  let repo = readJson(CONF)?.repo;
  const origin = git("remote", "get-url", "origin");
  if (origin.ok && origin.out.startsWith(`${pub}/git/`)) {
    repo = origin.out.slice(`${pub}/git/`.length).replace(/\.git$/, "");
  } else if (origin.ok) {
    die(`이 폴더는 이미 다른 저장소(${origin.out})에 연결돼 있습니다 — 빈 폴더나 사내 Git 저장소에서 실행하세요`);
  } else {
    if (!a.name) die("새 MCP 이름이 필요합니다 — mcp-setup --kit <주소> --name <영문 소문자 이름> [--desc <설명>]");
    const p = await kit.call("POST", "/api/projects", {name: a.name, description: a.desc || ""});
    if (p.error !== undefined && p.status !== 409 && !/already|exist|이미/i.test(p.error)) die(`저장소를 만들지 못했습니다: ${p.error}`);
    repo = p.data?.repo || `${kit.cred.user}/${a.name}`;
    if (!existsSync(join(WS, ".git"))) mustGit("init", "-q", "-b", "main");
    mustGit("remote", "add", "origin", `${pub}/git/${repo}.git`);
    mustGit("fetch", "-q", "origin");
    if (git("rev-parse", "--verify", "-q", "origin/main").ok) mustGit("checkout", "-q", "-f", "-B", "main", "origin/main");
    mustGit("branch", "-q", "--set-upstream-to=origin/main", "main");
  }
  // 3) CI 워크플로(사내 기본값) — 없으면 넣는다
  const wf = join(WS, ".gitea", "workflows", "kit-ci.yml");
  if (!existsSync(wf)) {
    mkdirSync(join(WS, ".gitea", "workflows"), {recursive: true});
    writeFileSync(wf, await kit.must("GET", "/api/ci/workflow", null, {raw: true}));
    say("CI 워크플로(.gitea/workflows/kit-ci.yml)를 넣었습니다 — 다음 mcp-run 때 함께 올라갑니다");
  }
  ensureIgnore();
  if (!git("config", "user.email").ok) {
    mustGit("config", "user.name", me.name || kit.cred.user);
    mustGit("config", "user.email", `${kit.cred.user}@users.noreply`);
  }
  writeFileSync(CONF, JSON.stringify({public: pub, repo}, null, 1));
  say(`준비 끝 — 저장소 ${pub}/git/${repo} · 시험 도구 ${KIT}`);
  if (WIN) say(`처음 한 번만: 관리자 PowerShell 에서 샌드박스 준비 → node "${join(KIT, "srt-bundle", "node_modules", "@anthropic-ai", "sandbox-runtime", "dist", "cli.js")}" windows-install --proxy-port-range 60080-60143`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 실패 로그에서 Claude 가 볼 부분만 — KITCI-FAIL 줄과 그 앞 40줄
function failTail(log) {
  const lines = log.split(/\r?\n/).map(l => l.replace(/^\S+Z\s/, ""));
  const i = lines.findIndex(l => l.includes("KITCI-FAIL"));
  const end = i >= 0 ? i + 1 : lines.length;
  return lines.slice(Math.max(0, end - 40), end).join("\n");
}

async function ciResult(kit, repo, sha, quiet) {
  const t0 = Date.now();
  let last = "";
  for (;;) {
    const st = await kit.call("GET", `/repos/${repo}/commits/${sha}/status`, null, {git: true});
    const state = st.data?.state;
    const n = st.data?.statuses?.length || 0;
    if (n && state && state !== "pending") return st.data;
    const now = n ? "검사 중" : "CI 대기 중(러너 배정 전)";
    if (!quiet && now !== last) { say(`… ${now}`); last = now; }
    if (Date.now() - t0 > 20 * 60e3) die("CI 가 20분 안에 끝나지 않았습니다 — 사내 CI 러너 상태를 관리자에게 확인하세요");
    await sleep(3000);
  }
}

async function failureLog(kit, repo, sha) {
  const runs = await kit.call("GET", `/repos/${repo}/actions/runs?head_sha=${sha}&limit=5`, null, {git: true});
  const run1 = (runs.data?.workflow_runs || []).find(r => r.head_sha === sha);
  if (!run1) return "(실행 기록을 찾지 못했습니다)";
  const jobs = await kit.call("GET", `/repos/${repo}/actions/runs/${run1.id}/jobs`, null, {git: true});
  const bad = (jobs.data?.jobs || []).find(j => j.conclusion === "failure") || (jobs.data?.jobs || [])[0];
  if (!bad) return "(작업을 찾지 못했습니다)";
  const steps = (bad.steps || []).map(s => `${s.conclusion === "failure" ? "✗" : s.conclusion === "success" ? "✓" : "·"} ${s.name}`).join("\n");
  const log = await kit.call("GET", `/repos/${repo}/actions/jobs/${bad.id}/logs`, null, {git: true, raw: true});
  return `${steps}\n---\n${log.data ? failTail(log.data) : `(로그를 받지 못했습니다: ${log.error})`}\n---\n전체 로그: ${run1.html_url || ""}`;
}

// 같은 커밋을 다시 올리면 Gitea 는 CI 를 새로 돌리지 않는다 — 이미 실패로 끝난 결과가 있으면 그 실행을 다시 돌린다(서버 쪽이 고쳐진 경우)
async function rerunIfStale(kit, repo, sha) {
  const st = await kit.call("GET", `/repos/${repo}/commits/${sha}/status`, null, {git: true});
  if (!st.data?.statuses?.length || ["pending", "success"].includes(st.data.state)) return;
  const runs = await kit.call("GET", `/repos/${repo}/actions/runs?head_sha=${sha}&limit=5`, null, {git: true});
  const run1 = (runs.data?.workflow_runs || []).find(r => r.head_sha === sha);
  if (!run1) return;
  const r = await kit.call("POST", `/repos/${repo}/actions/runs/${run1.id}/rerun`, null, {git: true});
  if (r.error !== undefined) die(`이 커밋의 CI 를 다시 돌리지 못했습니다(${r.status}: ${r.error})`);
  say(`이 커밋은 전에 CI 가 ${st.data.state} 로 끝났습니다 — 다시 돌립니다(실행 #${run1.run_number || run1.id})`);
  for (let i = 0; i < 40; i++) {
    const now = await kit.call("GET", `/repos/${repo}/commits/${sha}/status`, null, {git: true});
    if (now.data?.state === "pending" || !now.data?.statuses?.length) return;
    await sleep(1500);
  }
  die("CI 를 다시 돌리라고 했지만 60초 안에 시작되지 않았습니다 — 사내 CI 러너 상태를 관리자에게 확인하세요");
}

async function ci(a) {
  const c = conf();
  const kit = new Kit(c.public);
  mustGit("add", "-A");
  if (git("diff", "--cached", "--quiet").ok === false) mustGit("commit", "-q", "-m", a.m || `kit-dev ${new Date().toISOString().slice(0, 16)}`);
  const sha = mustGit("rev-parse", "HEAD");
  const tree = mustGit("rev-parse", "HEAD^{tree}");
  const prev = readJson(LAST);
  if (prev?.tree === tree && prev.ok && git("rev-parse", "origin/main").out === sha) {
    say(`CI 통과(이미 검사한 내용 — ${prev.sha.slice(0, 12)}) · 다시 돌리지 않습니다`);
    return;
  }
  kit.auth();
  const push = git("push", "-q", "origin", "HEAD:main");
  if (!push.ok) die(`push 실패: ${push.err}`);
  kit.cred.approve();
  say(`올림 ${sha.slice(0, 12)} — 사내 CI 결과를 기다립니다`);
  await rerunIfStale(kit, c.repo, sha);
  const t0 = Date.now();
  const st = await ciResult(kit, c.repo, sha);
  const sec = Math.round((Date.now() - t0) / 1000);
  const ok = st.state === "success";
  writeFileSync(LAST, JSON.stringify({sha, tree, ok, state: st.state, at: new Date().toISOString(), sec}, null, 1));
  if (ok) { say(`CI 통과 ${sha.slice(0, 12)} (${sec}초) — 이제 mcp-run 의 시험(test)을 할 수 있습니다`); return; }
  say(`CI 실패 ${sha.slice(0, 12)} (${sec}초, 상태 ${st.state})`);
  say(await failureLog(kit, c.repo, sha));
  process.exit(1);
}

function venvPython() { return join(WS, ".venv", WIN ? "Scripts\\python.exe" : "bin/python"); }

function ensureVenv() {
  const marker = join(WS, ".venv", ".kitdev-installed");
  const sig = createHash("sha256").update(["requirements.txt", "pyproject.toml"].map(f => existsSync(join(WS, f)) ? readFileSync(join(WS, f)) : "").join("\0")).digest("hex");
  if (existsSync(marker) && readFileSync(marker, "utf8") === sig) return;
  if (!existsSync(venvPython())) {
    const r = WIN ? run("py", ["-m", "venv", ".venv"], {stdio: "inherit"}) : run("python3", ["-m", "venv", ".venv"], {stdio: "inherit"});
    if (r.status !== 0) die("가상환경(.venv)을 만들지 못했습니다 — 파이썬 3.11 이상이 필요합니다");
  }
  const r = run(venvPython(), ["-m", "pip", "install", "-q", "--disable-pip-version-check", "-e", "."], {stdio: "inherit"});
  if (r.status !== 0) die("이 PC 의 .venv 에 MCP 를 설치하지 못했습니다(위 출력 참고)");
  writeFileSync(marker, sig);
}

// 개발자 주간 LLM 한도(goose 시험 + 배포 검사) — 실행할 때마다 알린다
async function budgetLine(kit) {
  const r = await kit.call("GET", "/api/devkit/budget");
  if (!r.data) return;
  const b = r.data;
  const lim = b.limit_usd ? `$${b.limit_usd.toFixed(2)}` : "무제한";
  say(`이번 주 LLM 사용 $${b.spent_usd.toFixed(2)} / 한도 ${lim}${b.left_usd != null ? ` (남은 $${b.left_usd.toFixed(2)})` : ""} — 월요일 0시에 다시 시작`);
  if (b.over) say("  한도를 다 써서 goose 시험의 LLM 호출과 배포 요청이 막힙니다 — 관리자에게 한도를 늘려 달라고 하세요");
}

async function test(a) {
  const c = conf();
  if (!a.t) die("시험 질문이 필요합니다 — test -t \"질문\"");
  const m = await new Kit(c.public).must("GET", "/api/devkit/mode");
  if (m.mode === "ci") {
    if (git("status", "--porcelain").out) die("CI 켬 모드입니다 — CI 를 거치지 않은 변경이 있습니다. 먼저 ci 로 올려 통과시키세요(바로 시험하려면 mode off: 관리자 화이트리스트 네트워크만)");
    const sha = mustGit("rev-parse", "HEAD");
    const last = readJson(LAST);
    if (!last || last.sha !== sha || !last.ok) die(`CI 켬 모드입니다 — 지금 코드(${sha.slice(0, 12)})는 CI 를 통과하지 않았습니다. 먼저 ci (바로 시험하려면 mode off)`);
  } else say(`CI 끔 모드 — 검사 없이 바로 시험합니다. 바깥 네트워크는 관리자 화이트리스트(${(m.whitelist || []).join(", ") || "사내 서버만"})로만 나갑니다`);
  await ensureKit(new Kit(c.public));
  await budgetLine(new Kit(c.public));
  ensureVenv();
  const entry = a["with-extension"] || readJson(join(WS, "kit-mcp.json"))?.entry || die("kit-mcp.json 에 entry 가 없습니다");
  say(`goose(샌드박스)로 시험 — MCP: ${entry}`);
  // mcp-test.cmd 를 shell 로 띄우면 Node 가 인자를 따옴표 없이 이어 붙여 공백 든 질문이 쪼개진다 — node 로 바로
  const argv = [join(KIT, "client", "mcp-test.mjs"), "run", "-t", a.t, "--with-extension", entry];
  if (process.stdin.isTTY) {
    const child = spawn(process.execPath, argv, {cwd: WS, stdio: "inherit", env: {...process.env, KIT_DIR: KIT}});
    child.on("exit", code => process.exit(code ?? 1));
    return;
  }
  // Claude 가 부른 시험 — 사람이 답할 입력 창이 없다. 시험은 뒤에서 돌리고, 툴 호출 승인 요청이 오면 멈춰 Claude 에 돌려준다.
  // Claude 가 `approve <번호>` 를 실행하려 할 때 Claude Code 의 실행 허용 창이 사람의 승인이 된다(Claude 에 아무것도 등록하지 않음)
  rmSync(RUN, {recursive: true, force: true});
  mkdirSync(RUN, {recursive: true});
  writeFileSync(join(RUN, "run.json"), JSON.stringify({argv}));
  spawn(process.execPath, [SELF, "_bg"], {cwd: WS, detached: true, stdio: "ignore", windowsHide: true, env: {...process.env, KIT_DIR: KIT, KIT_APPROVE_DIR: RUN}}).unref();
  await follow();
}

const RUN = join(KIT, "run");
const SELF = fileURLToPath(import.meta.url);

// 뒤에서 도는 시험 — 출력은 run/log.txt, 끝나면 run/exit.json
function bg() {
  const {argv} = readJson(join(RUN, "run.json"));
  const fd = openSync(join(RUN, "log.txt"), "a");
  const child = spawn(process.execPath, argv, {cwd: WS, stdio: ["ignore", fd, fd], windowsHide: true, env: process.env});
  child.on("exit", code => { closeSync(fd); writeFileSync(join(RUN, "exit.json"), JSON.stringify({code: code ?? 1})); process.exit(0); });
}

// 새 출력을 보이고, 답 없는 승인 요청이나 끝을 만나면 멈춘다
async function follow() {
  if (!existsSync(join(RUN, "run.json"))) die("뒤에서 도는 시험이 없습니다 — 먼저 test");
  const st = readJson(join(RUN, "state.json"), {off: 0});
  const t0 = Date.now();
  for (;;) {
    const log = join(RUN, "log.txt");
    if (existsSync(log) && statSync(log).size > st.off) {
      const buf = readFileSync(log);
      process.stdout.write(buf.subarray(st.off));
      st.off = buf.length;
      writeFileSync(join(RUN, "state.json"), JSON.stringify(st));
    }
    const done = readJson(join(RUN, "exit.json"));
    if (done) { const c = readJson(CONF); if (c) await budgetLine(new Kit(c.public)); process.exit(done.code); }
    const req = readdirSync(RUN).filter(f => /^req-\d+\.json$/.test(f)).map(f => f.slice(4, -5))
      .find(n => !existsSync(join(RUN, `ans-${n}.json`)));
    if (req) {
      const r = readJson(join(RUN, `req-${req}.json`));
      // 승인은 사람이 프롬프트에서 `! node .kit/approve.mjs <번호>` 로 한다(Claude 가 대신 실행하지 않는다)
      // Claude Code 의 `!` 는 PC 에 따라 bash·PowerShell 로 돈다 — 백슬래시·.cmd 없이 node + 슬래시 경로면 어느 셸이든 같다
      writeFileSync(join(KIT, "approve.mjs"), `import { spawnSync } from "node:child_process";\nprocess.exit(spawnSync(process.execPath, [${JSON.stringify(SELF)}, "approve", ...process.argv.slice(2)], {stdio: "inherit"}).status ?? 1);\n`);
      const cmd = "node .kit/approve.mjs";
      say(`KITDEV-APPROVE ${req}: goose 가 툴 ${r.tool} 를 부르려 합니다 — 인자 ${JSON.stringify(r.args).slice(0, 300)}`);
      say(`  사람이 프롬프트에 입력 — 허용: ! ${cmd} ${req}    거부: ! ${cmd} ${req} --deny 1`);
      process.exit(0);
    }
    if (Date.now() - t0 > 20 * 60e3) { say("시험이 아직 진행 중입니다 — 이어서 보려면 wait"); process.exit(0); }
    await sleep(500);
  }
}

async function approve(a) {
  const n = a._[1];
  if (!/^\d+$/.test(n || "") || !existsSync(join(RUN, `req-${n}.json`))) die(`승인 요청 ${n} 이 없습니다`);
  writeFileSync(join(RUN, `ans-${n}.json`), JSON.stringify({allow: !a.deny}));
  say(`승인 요청 ${n}: ${a.deny ? "거부" : "허용"} — 이어서 시험 결과를 기다립니다`);
  await follow();
}

async function deploy() {
  const c = conf();
  const kit = new Kit(c.public);
  await budgetLine(kit);
  if (git("status", "--porcelain").out) die("올리지 않은 변경이 있습니다 — 먼저 ci 로 올려 통과시키세요");
  const sha = mustGit("rev-parse", "HEAD");
  git("fetch", "-q", "origin");
  if (git("rev-parse", "origin/main").out !== sha) die("사내 Git 의 main 이 지금 코드와 다릅니다 — 먼저 ci");
  const gate = await kit.must("GET", `/api/ci/gate?repo=${encodeURIComponent(c.repo)}&ref=main`);
  if (!gate.ok) die(`CI 를 통과하지 않은 커밋입니다(${gate.why.join(", ")}) — 먼저 ci`);
  const r = await kit.must("POST", "/api/requests", {repo: c.repo, ref: "main"});
  writeFileSync(join(KIT, "last-request.json"), JSON.stringify({id: r.id, sha}, null, 1));
  say(`배포 요청 ${r.id} 을 냈습니다 (커밋 ${sha.slice(0, 12)}) — 중앙 검사가 끝나면 관리자가 승인합니다`);
  say(`화면: ${c.public}/mcp  ·  상태 보기: status ${r.id}`);
}

async function mode(a) {
  const c = conf();
  const kit = new Kit(c.public);
  const want = a._[1];
  if (want && !["on", "off"].includes(want)) die("mode on 또는 mode off");
  const m = want ? {...await kit.must("GET", "/api/devkit/mode"), ...await kit.must("POST", "/api/devkit/mode", {mode: want === "on" ? "ci" : "restricted", via: "plugin"})}
    : await kit.must("GET", "/api/devkit/mode");
  say(`실행 모드: ${m.label}`);
  say(m.mode === "ci" ? `  바깥 네트워크: ${(m.open || []).join(", ")} · 시험 전 CI 통과 필요` : `  바깥 네트워크: ${(m.whitelist || []).join(", ") || "사내 서버만"} · CI 없이 바로 시험`);
}

const STATUS = {queued: "검사 대기", running: "검사 중", done: "검사 끝"};
const DECISION = {pending: "관리자 승인 대기", approved: "승인 — Claude 에 배포됨", rejected: "반려"};

// 승인된 MCP 가 이 PC 의 회사 Claude 에 들어왔는지 — 플러그인 설치 · 조직 허용 목록(이 PC 에 내려온 조직 설정 사본) 등록
function deployedHere(name) {
  const home = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const market = readJson(PLUGIN_KIT)?.marketplace || "sds-mcp";
  const key = `${name}@${market}`;
  const rec = [].concat(readJson(join(home, "plugins", "installed_plugins.json"), {})?.plugins?.[key] || [])[0];
  const srv = rec?.installPath ? readJson(join(rec.installPath, ".mcp.json"))?.mcpServers?.[name] : null;
  const cmd = srv ? JSON.stringify([srv.command, ...(srv.args || [])]) : null;
  const rs = readJson(join(home, "remote-settings.json")) || {};
  const listed = cmd && Array.isArray(rs.allowedMcpServers) ? rs.allowedMcpServers.some(e => JSON.stringify(e?.serverCommand) === cmd) : null;
  return {key, market, installed: !!rec, version: rec?.version, listed, onlyManaged: rs.allowManagedMcpServersOnly === true};
}

function deployGuide(r) {
  if (r.decision !== "approved") return;
  const d = deployedHere(r.name);
  say(`배포 확인 — ${r.name}`);
  say("  ✓ 관리자 승인됨 · 사내 마켓플레이스에 올라감");
  if (!d.installed) {
    say(`  ✗ 이 PC 의 Claude 에 아직 설치 안 됨 — 설치: claude plugin marketplace update ${d.market} && claude plugin install ${d.key}`);
    return;
  }
  say(`  ✓ 이 PC 에 플러그인 설치됨 (${d.key}${d.version ? " " + d.version : ""})`);
  if (d.onlyManaged && d.listed === false) {
    say("  ✗ 회사 Claude 허용 목록에 아직 없음 — 관리자가 Claude 관리자 설정에 등록해야 뜹니다(이 PC 의 조직 설정은 Claude 를 다시 켤 때 새로 받으니, 관리자 등록 뒤 다시 켜서 확인)");
    return;
  }
  say(`  ✓ 배포 완료 — Claude 를 다시 켜면(/exit 뒤 claude) MCP ${r.name} 를 쓸 수 있습니다`);
}

async function status(a) {
  const c = conf();
  const kit = new Kit(c.public);
  const id = a._[1] || readJson(join(KIT, "last-request.json"))?.id || die("요청 번호가 없습니다 — status <요청 번호>");
  const r = await kit.must("GET", `/api/requests/${encodeURIComponent(id)}`);
  const v = r.result?.effective_verdict || r.result?.verdict;
  say(`요청 ${r.id} · ${r.name} · ${STATUS[r.status] || r.status}${v ? ` · 검사 판정 ${v}` : ""} · ${DECISION[r.decision] || r.decision}${r.reason ? ` · 사유: ${r.reason}` : ""}`);
  for (const f of (r.result?.findings || []).slice(0, 15)) say(`  [${f.severity}] ${f.title} — ${f.file || ""}${f.line ? ":" + f.line : ""}`);
  deployGuide(r);
}

const a = args(process.argv.slice(2));
const CMDS = {setup, ci, test, approve, wait: follow, deploy, status, mode, _bg: bg};
(CMDS[a._[0]] || (() => die(`사용: kitdev ${Object.keys(CMDS).join("|")}`, 2)))(a);
