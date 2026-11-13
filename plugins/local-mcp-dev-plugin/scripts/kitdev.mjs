#!/usr/bin/env node
// 사내 MCP 개발 키트 — 개발 플러그인 스크립트(워크스페이스 폴더에서 실행)
//   setup  --kit <주소> [--name <MCP 이름>] [--desc <설명>]   워크스페이스에 goose·srt·mcp-test 설치 + 사내 Git 저장소 연결
//   ci     [-m <커밋 메시지>]                                  commit·push → 사내 CI 결과를 기다려 통과/실패(실패 줄만) 보고
//   test   -t <질문> [--with-extension <명령>]                 CI 를 통과한 지금 코드만 goose(srt 샌드박스)에서 시험
//   deploy                                                   CI 를 통과한 커밋으로 배포 요청
//   mode   [on|off]                                          실행 모드 보기·바꾸기 — on: CI 켬(통과 커밋만 · 바깥 네트워크 열림)
//                                                            off: CI 끔(검사 없이 바로 · 관리자 화이트리스트 네트워크만)
//   status [<요청 번호>]                                      배포 요청 상태
// 키를 PC 에 새로 저장하지 않는다 — 사내 Git 자격 증명(Git Credential Manager 가 OS 저장소에 둔 것)을 그때그때 꺼내 쓴다.
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WIN = process.platform === "win32";
const WS = process.cwd();
const KIT = join(WS, ".kit");
const CONF = join(KIT, "workspace.json");
const LAST = join(KIT, "last-ci.json");
// 사내 마켓플레이스에서 받은 플러그인에는 그 회사 키트 주소가 들어 있다(kit.json)
const PLUGIN_KIT = join(dirname(fileURLToPath(import.meta.url)), "..", "kit.json");

// 사내 CA 는 회사 PC 의 OS 인증서 저장소에 있다 — Node 가 그것을 쓰게 한 번 다시 띄운다
if (!process.env.KITDEV_REEXEC && process.allowedNodeEnvironmentFlags.has("--use-system-ca")) {
  const r = spawnSync(process.execPath, ["--use-system-ca", ...process.argv.slice(1)], {stdio: "inherit", env: {...process.env, KITDEV_REEXEC: "1"}});
  process.exit(r.status ?? 1);
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

// 사내 Git 자격 증명 — 처음이면 Git Credential Manager 가 브라우저 로그인을 띄운다
function gitToken(pub) {
  const u = new URL(pub);
  const input = `protocol=${u.protocol.replace(":", "")}\nhost=${u.host}\npath=git\n\n`;
  const r = run("git", ["credential", "fill"], {input, env: {...process.env, GIT_TERMINAL_PROMPT: "0"}});
  const pw = /^password=(.*)$/m.exec(r.stdout || "");
  if (r.status !== 0 || !pw) die(`사내 Git(${u.host}) 로그인 정보를 얻지 못했습니다 — Git for Windows(Git Credential Manager)가 설치돼 있는지 확인하고, 브라우저 로그인 창이 뜨면 로그인하세요. (${(r.stderr || "").trim().slice(0, 200)})`);
  const user = /^username=(.*)$/m.exec(r.stdout)?.[1] || "";
  return {user, token: pw[1], approve: () => run("git", ["credential", "approve"], {input: r.stdout})};
}

class Kit {
  constructor(pub) { this.pub = pub.replace(/\/+$/, ""); this.cred = null; }
  auth() { this.cred ??= gitToken(this.pub); return `Bearer ${this.cred.token}`; }
  async call(method, path, body, {raw = false, git = false} = {}) {
    const url = git ? `${this.pub}/git/api/v1${path}` : `${this.pub}${path}`;
    const headers = {Authorization: git ? `token ${this.auth().slice(7)}` : this.auth(), ...(body ? {"Content-Type": "application/json"} : {})};
    let r;
    try { r = await fetch(url, {method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual"}); }
    catch (e) { die(`${this.pub} 에 닿지 않습니다: ${e.cause?.code || e.message}`); }
    if (r.status === 401) die("사내 서버가 로그인을 받아들이지 않았습니다 — 사내 Git 비밀번호/토큰이 바뀌었으면 'git credential reject' 후 다시 실행하세요");
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
  if (!existsSync(join(KIT, "kit.json")) || a.reinstall) {
    const code = (await kit.must("POST", "/api/dlcode")).code;
    const env = {...process.env, KIT_TOKEN: code, KIT_DIR: KIT};
    let r;
    if (WIN) {
      writeBom(join(KIT, "install.ps1"), await kit.must("GET", "/download/install.ps1", null, {raw: true}));
      r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(KIT, "install.ps1")], {cwd: WS, env, stdio: "inherit"});
    } else {
      writeFileSync(join(KIT, "install.sh"), await kit.must("GET", "/download/install.sh", null, {raw: true}));
      r = spawnSync("sh", [join(KIT, "install.sh")], {cwd: WS, env, stdio: "inherit"});
    }
    if (r.status !== 0) die("goose 시험 환경 설치가 실패했습니다(위 출력 참고)");
  } else say(`goose 시험 환경은 이미 ${KIT} 에 있습니다 (다시 받으려면 --reinstall 1)`);

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
  ensureVenv();
  const entry = a["with-extension"] || readJson(join(WS, "kit-mcp.json"))?.entry || die("kit-mcp.json 에 entry 가 없습니다");
  const cmd = join(KIT, WIN ? "mcp-test.cmd" : "mcp-test");
  say(`goose(샌드박스)로 시험 — MCP: ${entry}`);
  const child = spawn(cmd, ["run", "-t", a.t, "--with-extension", entry], {cwd: WS, stdio: "inherit", shell: WIN, env: {...process.env, KIT_DIR: KIT}});
  child.on("exit", code => process.exit(code ?? 1));
}

async function deploy() {
  const c = conf();
  const kit = new Kit(c.public);
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

async function status(a) {
  const c = conf();
  const kit = new Kit(c.public);
  const id = a._[1] || readJson(join(KIT, "last-request.json"))?.id || die("요청 번호가 없습니다 — status <요청 번호>");
  const r = await kit.must("GET", `/api/requests/${encodeURIComponent(id)}`);
  const v = r.result?.effective_verdict || r.result?.verdict;
  say(`요청 ${r.id} · ${r.name} · ${STATUS[r.status] || r.status}${v ? ` · 검사 판정 ${v}` : ""} · ${DECISION[r.decision] || r.decision}${r.reason ? ` · 사유: ${r.reason}` : ""}`);
  for (const f of (r.result?.findings || []).slice(0, 15)) say(`  [${f.severity}] ${f.title} — ${f.file || ""}${f.line ? ":" + f.line : ""}`);
}

const a = args(process.argv.slice(2));
const CMDS = {setup, ci, test, deploy, status, mode};
(CMDS[a._[0]] || (() => die(`사용: kitdev ${Object.keys(CMDS).join("|")}`, 2)))(a);
