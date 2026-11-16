#!/usr/bin/env node
// 사내 MCP 개발 키트 — 개발 플러그인 스크립트(워크스페이스 폴더에서 실행)
//   (Node 가 없으면 먼저 scripts/node.ps1 · node.sh — 사내 Git 패키지 저장소(tools.json)의 휴대용 Node 를 받아 그 경로를 알려 준다)
//   login  [--check 1 | --signup 1] [--kit <주소>]          사내 Git 로그인 — check: 저장된 로그인 있나(창 없이) · signup: 가입 페이지를 브라우저로
//   setup  --kit <주소> [--name <MCP 이름>] [--desc <설명>]   워크스페이스에 goose·샌드박스·mcp-test 설치 + 사내 Git 저장소 연결
//   ci     [-m <커밋 메시지>]                                  commit·push → 사내 CI 결과를 기다려 통과/실패(실패 줄만) 보고
//   test   -t <질문> [--with-extension <명령>]                 CI 를 통과한 지금 코드만 goose(MXC 샌드박스)에서 시험
//   wait                                                     뒤에서 도는 시험의 남은 출력·끝을 기다림
//   deploy                                                   CI 를 통과한 커밋으로 배포 요청
//   mode   [deep|basic]                                      실행 모드 보기·바꾸기 — deep: 심화 검사(CI 전체 통과 커밋만 · 바깥 네트워크 열림)
//                                                            basic: 기본 검사(바뀐 파일 검사 통과 커밋만 · 관리자 허용 목록 네트워크만)
//   secret set <이름> | list                                 MCP 비밀값 — set: 이 PC 에 입력 창을 띄워 받은 값을 사내 키 저장소(이 저장소 비밀값)에 바로 넣는다
//                                                            (값은 Claude 대화·명령줄·파일에 남지 않음) · kit-mcp.json secrets 에 이름도 넣는다
//   status [<요청 번호>]                                      배포 요청 상태
// 키를 PC 에 새로 저장하지 않는다 — 사내 Git 자격 증명(Git Credential Manager 가 OS 저장소에 둔 것)을 그때그때 꺼내 쓴다.
import { spawnSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, openSync, closeSync, statSync } from "node:fs";
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
// --use-system-ca 가 없는 Node(22.15·23.8 전 — 2026-11-14 Azure 사용자 PC 22.12 실측)는 OS 신뢰 저장소(윈도우는 PEM 으로 내보내서)를 NODE_EXTRA_CA_CERTS 로
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
  } else {
    // 리눅스: 회사 CA 는 시스템 묶음에 들어 있다 — Node 내장 목록만 보면 사내 서버를 못 믿는다(2026-11-15 Azure 리눅스 PC · 휴대용 Node 22.12 실측)
    const sys = ["/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt"].find(existsSync);
    const prev = process.env.NODE_EXTRA_CA_CERTS;
    if (sys && prev !== sys) {
      if (prev && existsSync(prev)) {
        const pem = join(tmpdir(), `kitdev-os-ca-${process.getuid()}.pem`);
        writeFileSync(pem, readFileSync(sys, "utf8") + "\n" + readFileSync(prev, "utf8"));
        env.NODE_EXTRA_CA_CERTS = pem;
      } else env.NODE_EXTRA_CA_CERTS = sys;
    }
  }
  if (flags.length || env.NODE_EXTRA_CA_CERTS !== process.env.NODE_EXTRA_CA_CERTS) {
    const r = spawnSync(process.execPath, [...flags, ...process.argv.slice(1)], {stdio: "inherit", env});
    process.exit(r.status ?? 1);
  }
}

// 휴대용 Node(node.ps1 이 받은 것)로 돌 때도 설치 스크립트·자식 프로세스가 같은 node 를 찾게
{
  const bin = dirname(process.execPath), key = Object.keys(process.env).find(k => k.toUpperCase() === "PATH") || "PATH";
  if (!(process.env[key] || "").split(WIN ? ";" : ":").includes(bin)) process.env[key] = `${bin}${WIN ? ";" : ":"}${process.env[key] || ""}`;
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

// 리눅스 Git 에는 Git Credential Manager 가 없다 — 이 PC 에 쓸 자격 증명 도우미가 없으면 사내 Git 패키지 저장소에서 GCM 을 받아
// ~/.mcp-kit/gcm 에 두고 키트 주소에만 쓴다(관리자 권한 없음 · 저장은 데스크톱 키링 secretservice). 윈도우는 Git for Windows 에 든 GCM 그대로
async function ensureGcm(pub) {
  if (WIN) return;
  const origin = new URL(pub).origin, key = `credential.${origin}`;
  const exe = join(homedir(), ".mcp-kit", "gcm", "git-credential-manager");
  const mine = git("config", "--global", "--get-all", `${key}.helper`).out.split("\n").at(-1);
  if (mine === exe && existsSync(exe)) return;
  const have = git("config", "--get-urlmatch", "credential.helper", `${origin}/git`);
  if (have.ok && have.out && have.out !== exe) return;   // 회사·개발자가 이미 정해 둔 도우미
  if (!existsSync(exe)) await fetchTool(pub, "gcm/linux-x64", dirname(exe));
  git("config", "--global", "--unset-all", `${key}.helper`);
  mustGit("config", "--global", "--add", `${key}.helper`, "");
  mustGit("config", "--global", "--add", `${key}.helper`, exe);
  mustGit("config", "--global", `${key}.credentialStore`, "secretservice");
  say(`사내 Git 로그인 도우미(Git Credential Manager)를 사내 Git 패키지 저장소에서 받아 두었습니다 — ${exe} (키트 주소에만 · 키링에 저장)`);
}

// 플러그인 tools.json 의 도구 하나를 사내 Git 패키지 저장소에서 받아 sha256 을 맞춘 뒤 dest 에 푼다(unpack:false 면 파일 그대로 dest/<파일>)
async function fetchTool(pub, key, dest) {
  const t = readJson(join(dirname(fileURLToPath(import.meta.url)), "..", "tools.json"))?.tools?.[key];
  if (!t) die(`플러그인 tools.json 에 ${key} 가 없습니다 — 사내 마켓플레이스에서 플러그인을 다시 받으세요`);
  const url = `${pub.replace(/\/+$/, "")}/download/tools/${key.split("/")[0]}/${t.version}/${t.file}`;
  let buf;
  try {
    const r = await fetch(url);
    if (!r.ok) die(`${url} 을 받지 못했습니다(HTTP ${r.status}) — 관리자가 사내 Git 패키지 저장소에 올렸는지 확인하세요`);
    buf = Buffer.from(await r.arrayBuffer());
  } catch (e) { die(`${url} 에 닿지 않습니다: ${e.cause?.code || e.message}`); }
  if (createHash("sha256").update(buf).digest("hex") !== t.sha256) die(`받은 ${t.file} 의 sha256 이 tools.json 과 다릅니다`);
  if (t.unpack === false) {
    mkdirSync(dest, {recursive: true});
    writeFileSync(join(dest, t.file), buf);
    return join(dest, t.file);
  }
  const tmp = join(tmpdir(), `kitdev-${process.pid}-${t.file}`);
  writeFileSync(tmp, buf);
  rmSync(dest, {recursive: true, force: true});
  mkdirSync(dest, {recursive: true});
  const r = run("tar", ["xf", tmp, "-C", dest]);
  rmSync(tmp, {force: true});
  if (r.status !== 0) die(`${t.file} 을 풀지 못했습니다: ${(r.stderr || "").trim()}`);
}

// 사내 Git 자격 증명 — 처음이면 Git Credential Manager 가 로그인 창을 띄운다
function gitToken(pub) {
  const u = new URL(pub);
  const input = `protocol=${u.protocol.replace(":", "")}\nhost=${u.host}\npath=git\n\n`;
  const r = run("git", ["credential", "fill"], {input, env: credEnv()});
  const pw = /^password=(.*)$/m.exec(r.stdout || "");
  if (r.status !== 0 || !pw) die(`사내 Git(${u.host}) 로그인 정보를 얻지 못했습니다 — ${WIN ? "Git for Windows(Git Credential Manager)가 설치돼 있는지 확인하고, " : "이 PC 데스크톱 화면에서 실행 중인지 확인하고(로그인 창), "}로그인 창이 뜨면 로그인하세요. (${(r.stderr || "").trim().slice(0, 200)})`);
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

// 설치 스크립트에는 클라이언트·샌드박스 파일 해시가 들어 있다 — 지난번에 받은 것과 다르면 키트가 바뀐 것이니 다시 설치(setup·test 공용)
async function ensureKit(kit, force) {
  const script = join(KIT, WIN ? "install.ps1" : "install.sh");
  const body = await kit.must("GET", WIN ? "/download/install.ps1" : "/download/install.sh", null, {raw: true});
  const prev = existsSync(script) ? readFileSync(script, "utf8").replace(/^\uFEFF/, "") : null;
  if (!existsSync(join(KIT, "kit.json")) || force || prev !== body) {
    if (prev !== null && prev !== body) say("사내 키트가 바뀌어 goose 시험 환경을 새로 받습니다");
    say("goose·샌드박스를 받습니다(약 100 MB) — 네트워크 경로에 따라 몇 초에서 수십 분까지 걸립니다. 1분마다 '몇 % 완료되었습니다' 줄이 나오면 받는 중이니 끊지 말고 기다리세요");
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

function kitAddr(a) {
  const pub = (a.kit || readJson(CONF)?.public || readJson(PLUGIN_KIT)?.public || "").replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+/.test(pub)) die("사내 MCP 키트 주소가 필요합니다 — 예: mcp-setup --kit https://mcp.사내도메인");
  return pub;
}

function openBrowser(url) {
  const [cmd, argv] = WIN ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd, argv, {detached: true, stdio: "ignore"}).unref(); } catch { /* 못 열면 주소를 보고 직접 연다 */ }
}

// 환경 구성 첫 단계 — 계정이 있나부터. 없으면 가입 페이지, 있으면 Git Credential Manager 로그인 창
// 이 PC 저장소에 있는 사내 Git 자격 증명(창을 띄우지 않는다)
function storedCred(pub) {
  const u = new URL(pub);
  const r = run("git", ["credential", "fill"], {input: `protocol=${u.protocol.replace(":", "")}\nhost=${u.host}\npath=git\n\n`,
    // VS Code·Cursor 터미널의 GIT_ASKPASS 는 입력을 기다리며 멈춘다 — 확인할 때는 끈다
    env: {...process.env, GCM_INTERACTIVE: "never", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: ""}, timeout: 20000});
  if (r.status !== 0) return {};
  return {user: /^username=(.*)$/m.exec(r.stdout || "")?.[1], pw: /^password=(.*)$/m.exec(r.stdout || "")?.[1]};
}

// 로그인은 됐는데 저장이 안 되면 명령마다 창이 다시 뜬다 — 리눅스 키링이 없거나 잠긴 PC(xrdp 세션 등, 2026-11-15 Azure 실측: GCM 'Object does not exist at path')
function mustBeStored(pub) {
  if (WIN || storedCred(pub).pw) return;
  die("사내 Git 로그인은 됐지만 이 PC 키링에 저장하지 못했습니다 — 데스크톱 로그인 키링(gnome-keyring 'login')이 없거나 잠겨 있습니다. " +
      "데스크톱 화면에서 로그인한 세션인지 확인하고, 원격 데스크톱(xrdp) 세션이면 관리자에게 xrdp 로그인에도 pam_gnome_keyring 을 켜 달라고 하세요(관리자 가이드 '개발자 PC (리눅스)')");
}

async function login(a) {
  const pub = kitAddr(a);
  if (a.signup) {
    const url = `${pub}/git/user/sign_up`;
    openBrowser(url);
    say(`KITDEV-SIGNUP: 브라우저에 사내 Git 가입 페이지를 열었습니다 — ${url}`);
    say("가입을 마치면 알려 주세요. 그다음 로그인 창(Git Credential Manager)에 그 계정을 넣습니다.");
    return;
  }
  if (a.check) {
    // 창을 띄우지 않고 저장된 것만 본다 — 없거나 키트가 거절하면 '없음'
    const {user, pw} = storedCred(pub);
    let ok = false;
    if (user && pw) {
      try {
        const res = await fetch(`${pub}/api/download`, {headers: {Authorization: `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}`}, redirect: "manual"});
        ok = res.status === 200;
      } catch (e) { die(`${pub} 에 닿지 않습니다: ${e.cause?.code || e.message}`); }
    }
    say(ok ? `KITDEV-LOGIN: 로그인돼 있음 — 계정 ${user}` : "KITDEV-LOGIN: 저장된 로그인 없음 — 사용자에게 사내 Git 계정이 있는지 묻는다");
    return;
  }
  await ensureGcm(pub);
  const kit = new Kit(pub);
  await kit.must("GET", "/api/download");
  kit.cred.approve();
  mustBeStored(pub);
  say(`KITDEV-LOGIN: 로그인 확인 — 계정 ${kit.cred.user} (다음부터는 묻지 않습니다)`);
}

async function setup(a) {
  if (!WIN && process.platform !== "linux") die("사내 MCP 개발 키트는 윈도우 11 과 리눅스 개발자 PC 를 지원합니다(MXC 샌드박스)");
  const pub = kitAddr(a);
  if (run("git", ["--version"]).status !== 0) die("git 이 없습니다 — Git for Windows 를 설치하세요");
  mkdirSync(KIT, {recursive: true});
  await ensureGcm(pub);
  const kit = new Kit(pub);
  const me = await kit.must("GET", "/api/download");
  kit.cred.approve();
  say(`사내 키트 ${pub} 로그인 확인 · goose ${me.version}`);

  // 1) 워크스페이스에 goose · 샌드박스 · mcp-test (사내 설치 스크립트를 KIT_DIR 로)
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
  }
  // 시작 코드 받기 — 처음이든, 지난번에 받다 멈춘 폴더(원격만 연결되고 로컬 커밋이 없음)든
  if (!git("rev-parse", "--verify", "-q", "HEAD").ok) {
    mustGit("fetch", "-q", "origin");
    if (git("rev-parse", "--verify", "-q", "origin/main").ok) {
      mustGit("checkout", "-q", "-f", "-B", "main", "origin/main");
      mustGit("branch", "-q", "--set-upstream-to=origin/main", "main");
    }
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
  // 샌드박스는 MXC — 윈도우는 처음 한 번 준비가 없고, 리눅스는 관리자 준비(slirp4netns·AppArmor)가 없으면 install.sh 가 멈추고 알려 준다
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
  const mode = (await kit.must("GET", "/api/devkit/mode")).mode;
  mustGit("add", "-A");
  if (git("diff", "--cached", "--quiet").ok === false) mustGit("commit", "-q", "-m", a.m || `kit-dev ${new Date().toISOString().slice(0, 16)}`);
  const sha = mustGit("rev-parse", "HEAD");
  const tree = mustGit("rev-parse", "HEAD^{tree}");
  const prev = readJson(LAST);
  if (prev?.tree === tree && prev.ok && prev.mode === mode && git("rev-parse", "origin/main").out === sha) {
    say(`${mode === "basic" ? "기본" : "심화"} 검사 통과(이미 검사한 내용 — ${prev.sha.slice(0, 12)}) · 다시 돌리지 않습니다`);
    return;
  }
  kit.auth();
  const push = git("push", "-q", "origin", "HEAD:main");
  if (!push.ok) die(`push 실패: ${push.err}`);
  kit.cred.approve();
  if (mode === "basic") return basicCheck(kit, c, sha, tree);
  say(`올림 ${sha.slice(0, 12)} — 심화 검사(사내 CI 전체) 결과를 기다립니다`);
  await rerunIfStale(kit, c.repo, sha);
  const t0 = Date.now();
  const st = await ciResult(kit, c.repo, sha);
  const sec = Math.round((Date.now() - t0) / 1000);
  const ok = st.state === "success";
  writeFileSync(LAST, JSON.stringify({sha, tree, ok, mode: "deep", state: st.state, at: new Date().toISOString(), sec}, null, 1));
  if (ok) { say(`심화 검사 통과 ${sha.slice(0, 12)} (${sec}초) — 이제 mcp-run 의 시험(test)을 할 수 있습니다`); return; }
  say(`심화 검사 실패 ${sha.slice(0, 12)} (${sec}초, 상태 ${st.state})`);
  say(await failureLog(kit, c.repo, sha));
  process.exit(1);
}

// 기본 검사 — 마지막으로 통과한 커밋과 비교해 바뀐 파일만, 관리자가 고른 '기본' 감시자로(키트가 바로 돌려 준다)
async function basicCheck(kit, c, sha, tree) {
  say(`올림 ${sha.slice(0, 12)} — 기본 검사(바뀐 파일만)`);
  const t0 = Date.now();
  const r = await kit.must("POST", "/api/ci/basic", {repo: c.repo, sha});
  const sec = Math.round((Date.now() - t0) / 1000);
  const ok = r.verdict === "통과";
  writeFileSync(LAST, JSON.stringify({sha, tree, ok, mode: "basic", at: new Date().toISOString(), sec}, null, 1));
  say(`  비교 기준 ${r.base ? r.base.slice(0, 12) : "없음(처음 — 전체 파일)"} · 검사한 파일 ${r.files}개`);
  for (const st of r.steps || []) say(`  - ${st.name}: ${st.ok ? "통과" : "오류 " + (st.error || "")} (${st.sec}초, 걸린 것 ${st.findings ?? 0})`);
  for (const f of (r.findings || []).slice(0, 20)) say(`  [${f.severity}] ${f.title} — ${f.file || ""}${f.line ? ":" + f.line : ""}`);
  if (ok) { say(`기본 검사 통과 ${sha.slice(0, 12)} (위험 점수 ${r.risk_score ?? 0}/100, ${sec}초) — 이제 mcp-run 의 시험(test)을 할 수 있습니다`); return; }
  say(`KITCI-FAIL: 기본 검사 실패 — 위험 점수 ${r.risk_score ?? "?"}/100(51점 이상이거나 critical 이면 차단, 검사 단계 오류도 실패). 위 항목을 고친 뒤 다시 ci`);
  process.exit(1);
}

function venvPython() { return join(WS, ".venv", WIN ? "Scripts\\python.exe" : "bin/python"); }

// 가상환경은 pip 없이 만들고 pip 는 사내 Git 패키지 저장소의 단일 파일판(pip.pyz)으로 — Ubuntu 기본 Python 은 python3-venv(ensurepip)가
// 없어 'python3 -m venv' 가 실패한다(2026-11-15 Azure 리눅스 PC 실측). 회사 pip 설정(사내 미러)은 그대로 따른다
async function ensureVenv(c) {
  const marker = join(WS, ".venv", ".kitdev-installed");
  const sig = createHash("sha256").update(["requirements.txt", "pyproject.toml"].map(f => existsSync(join(WS, f)) ? readFileSync(join(WS, f)) : "").join("\0")).digest("hex");
  if (existsSync(marker) && readFileSync(marker, "utf8") === sig) return;
  if (!existsSync(venvPython())) {
    const r = WIN ? run("py", ["-m", "venv", "--without-pip", ".venv"], {stdio: "inherit"}) : run("python3", ["-m", "venv", "--without-pip", ".venv"], {stdio: "inherit"});
    if (r.status !== 0) die("가상환경(.venv)을 만들지 못했습니다 — 파이썬 3.11 이상이 필요합니다");
  }
  const t = readJson(join(dirname(fileURLToPath(import.meta.url)), "..", "tools.json"))?.tools?.["pip/any"];
  let pip = t && join(homedir(), ".mcp-kit", "pip", t.file);
  if (!pip || !existsSync(pip)) pip = await fetchTool(c.public, "pip/any", join(homedir(), ".mcp-kit", "pip"));
  const r = run(venvPython(), [pip, "install", "-q", "--disable-pip-version-check", "-e", "."], {stdio: "inherit"});
  if (r.status !== 0) die("이 PC 의 .venv 에 MCP 를 설치하지 못했습니다(위 출력 참고)");
  writeFileSync(marker, sig);
}

// 개발자 주간 LLM 한도(goose 시험 + 배포 검사) — 실행할 때마다 알린다
async function budgetLine(kit) {
  const r = await kit.call("GET", "/api/devkit/budget");
  if (!r.data) return;
  const b = r.data;
  // 1센트 아래도 0 으로 보이지 않게(시험 한 번은 보통 $0.00x)
  const usd = v => `$${v > 0 && v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
  const lim = b.limit_usd ? usd(b.limit_usd) : "무제한";
  say(`이번 주 LLM 사용 ${usd(b.spent_usd)} / 한도 ${lim}${b.left_usd != null ? ` (남은 ${usd(b.left_usd)})` : ""} — 월요일 0시에 다시 시작`);
  if (b.over) say("  한도를 다 써서 goose 시험의 LLM 호출과 배포 요청이 막힙니다 — 관리자에게 한도를 늘려 달라고 하세요");
}

async function test(a) {
  const c = conf();
  if (!a.t) die("시험 질문이 필요합니다 — test -t \"질문\"");
  const m = await new Kit(c.public).must("GET", "/api/devkit/mode");
  const name = m.mode === "basic" ? "기본" : "심화";
  if (git("status", "--porcelain").out) die(`${name} 검사 모드입니다 — 검사를 거치지 않은 변경이 있습니다. 먼저 ci 로 올려 통과시키세요`);
  const sha = mustGit("rev-parse", "HEAD");
  const last = readJson(LAST);
  if (!last || last.sha !== sha || !last.ok || (last.mode || "deep") !== m.mode) die(`${name} 검사 모드입니다 — 지금 코드(${sha.slice(0, 12)})는 ${name} 검사를 통과하지 않았습니다. 먼저 ci`);
  say(m.mode === "basic" ? `기본 검사 모드 — 바깥 네트워크는 관리자 허용 목록(${(m.whitelist || []).join(", ") || "사내 서버만"})으로만 나갑니다`
    : `심화 검사 모드 — 바깥 네트워크 열림(${(m.open || []).join(", ")})`);
  await ensureKit(new Kit(c.public));
  await budgetLine(new Kit(c.public));
  await ensureVenv(c);
  const entry = a["with-extension"] || readJson(join(WS, "kit-mcp.json"))?.entry || die("kit-mcp.json 에 entry 가 없습니다");
  say(`goose(샌드박스)로 시험 — MCP: ${entry}`);
  // mcp-test.cmd 를 shell 로 띄우면 Node 가 인자를 따옴표 없이 이어 붙여 공백 든 질문이 쪼개진다 — node 로 바로
  const argv = [join(KIT, "client", "mcp-test.mjs"), "run", "-t", a.t, "--with-extension", entry];
  if (process.stdin.isTTY) {
    const child = spawn(process.execPath, argv, {cwd: WS, stdio: "inherit", env: {...process.env, KIT_DIR: KIT}});
    child.on("exit", code => process.exit(code ?? 1));
    return;
  }
  // Claude 가 부른 시험 — 뒤에서 돌리고 출력을 이어서 보여 준다(Claude 의 명령 시간 제한에 걸리지 않게)
  rmSync(RUN, {recursive: true, force: true});
  mkdirSync(RUN, {recursive: true});
  writeFileSync(join(RUN, "run.json"), JSON.stringify({argv}));
  spawn(process.execPath, [SELF, "_bg"], {cwd: WS, detached: true, stdio: "ignore", windowsHide: true, env: {...process.env, KIT_DIR: KIT}}).unref();
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

// 새 출력을 보이고, 끝나면 멈춘다
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
    if (Date.now() - t0 > 20 * 60e3) { say("시험이 아직 진행 중입니다 — 이어서 보려면 wait"); process.exit(0); }
    await sleep(500);
  }
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
  if (want && !["deep", "basic"].includes(want)) die("mode deep(심화 검사) 또는 mode basic(기본 검사)");
  const m = want ? {...await kit.must("GET", "/api/devkit/mode"), ...await kit.must("POST", "/api/devkit/mode", {mode: want, via: "plugin"})}
    : await kit.must("GET", "/api/devkit/mode");
  say(`실행 모드: ${m.label}`);
  say(m.mode === "deep" ? `  바깥 네트워크: ${(m.open || []).join(", ")} · 시험 전 심화 검사(CI 전체) 통과 필요`
    : `  바깥 네트워크: ${(m.whitelist || []).join(", ") || "사내 서버만"} · 시험 전 기본 검사(바뀐 파일) 통과 필요`);
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
  // 사내 마켓플레이스 자동 갱신은 Claude 가 첫 메시지를 받은 뒤 최대 10분 안에 돌고 다음 실행부터 적용된다(Claude Code 문서 · 2026-11-15 Azure 확인)
  say(`  · 고친 판이 회사 Claude 에 닿는 때: 첫 메시지 뒤 최대 10분 안에 받아 그다음 실행부터. 바로 받으려면 claude plugin marketplace update ${d.market} && claude plugin update ${d.key}`);
}

async function status(a) {
  const c = conf();
  const kit = new Kit(c.public);
  const id = a._[1] || readJson(join(KIT, "last-request.json"))?.id || die("요청 번호가 없습니다 — status <요청 번호>");
  const r = await kit.must("GET", `/api/requests/${encodeURIComponent(id)}`);
  const v = r.result?.effective_verdict || r.result?.verdict;
  say(`요청 ${r.id} · ${r.name} · ${STATUS[r.status] || r.status}${v ? ` · 검사 판정 ${v}` : ""} · ${DECISION[r.decision] || r.decision}${r.reason ? ` · 사유: ${r.reason}` : ""}`);
  for (const f of (r.result?.findings || []).slice(0, 15)) {
    say(`  [${f.severity}${f.level ? " · " + f.level : ""}] ${f.title} — ${f.file || ""}${f.line ? ":" + f.line : ""}`);
    if (f.explain) say(`      설명: ${f.explain.slice(0, 600)}`);
    if (f.patch?.text) say(`      고치는 법: ${f.patch.text.slice(0, 600)}`);
  }
  deployGuide(r);
}

// 비밀값 입력 창 — 값은 이 프로세스 메모리로만 오고 바로 키트로 간다(Claude 가 보는 출력에 찍지 않는다)
async function askSecret(name) {
  const msg = `사내 MCP 비밀값 ${name} 을 넣어 주세요 — 사내 키 저장소에만 저장됩니다`;
  let r;
  if (WIN) {
    const ps = `$c = Get-Credential -UserName '${name}' -Message '${msg.replace(/'/g, "''")}'; if ($c) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Out.Write($c.GetNetworkCredential().Password) } else { exit 2 }`;
    r = spawnSync("powershell", ["-NoProfile", "-Command", ps], {encoding: "utf8"});
  } else if (process.platform === "darwin") {
    r = spawnSync("osascript", ["-e", `text returned of (display dialog "${msg}" default answer "" with hidden answer with title "사내 MCP 비밀값")`], {encoding: "utf8"});
  } else {
    r = spawnSync("zenity", ["--password", `--title=${msg}`], {encoding: "utf8"});
    if (r.error) r = spawnSync("kdialog", ["--title", "사내 MCP 비밀값", "--password", msg], {encoding: "utf8"});
    if (r.error) r = {status: 0, stdout: await askSecretInBrowser(name, msg)};
  }
  if (r.stdout && !WIN) r.stdout = r.stdout.replace(/\n$/, "");
  if (r.status !== 0 || !r.stdout) die(`${name} 입력을 취소했습니다`);
  return r.stdout;
}

// zenity·kdialog 가 없는 리눅스 — 이 PC 안(127.0.0.1)에만 열리는 한 번짜리 입력 페이지를 브라우저로 띄운다
function askSecretInBrowser(name, msg) {
  const token = randomBytes(16).toString("hex");
  // 비밀번호 칸·폼 전송을 쓰지 않는다 — 브라우저가 '비밀번호 저장?'으로 값을 제 저장소에 넣으려 하기 때문(2026-11-15 Azure 크롬 실측)
  const page = `<!doctype html><meta charset="utf-8"><title>사내 MCP 비밀값</title>
<body style="font:16px sans-serif;max-width:560px;margin:60px auto"><h3>${msg}</h3>
<input id="v" type="text" autofocus autocomplete="off" spellcheck="false" style="-webkit-text-security:disc;width:100%;font-size:16px;padding:8px">
<p><button id="ok">확인</button> <button id="no">취소</button></p>
<script>
const send = (cancel) => { const v = document.getElementById("v"); const body = new URLSearchParams(cancel ? {cancel: "1"} : {v: v.value});
  v.value = ""; document.body.innerHTML = "<p>" + (cancel ? "취소했습니다" : "넣었습니다") + " — 이 탭을 닫으세요</p>"; fetch(location.href, {method: "POST", body}); };
document.getElementById("ok").onclick = () => send(false); document.getElementById("no").onclick = () => send(true);
document.getElementById("v").onkeydown = (e) => { if (e.key === "Enter") send(false); };
</script>`;
  return new Promise(resolve => {
    const done = (v) => { clearTimeout(timer); srv.close(); resolve(v); };
    const srv = createServer((req, res) => {
      if (req.url !== `/${token}`) { res.writeHead(404); return res.end(); }
      const head = {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"};
      if (req.method === "GET") { res.writeHead(200, head); return res.end(page); }
      let body = "";
      req.on("data", d => { body += d; if (body.length > 65536) req.destroy(); });
      req.on("end", () => {
        const f = new URLSearchParams(body);
        res.writeHead(204); res.end();
        done(f.get("cancel") ? "" : f.get("v") || "");
      });
    });
    const timer = setTimeout(() => done(""), 600000);
    srv.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${srv.address().port}/${token}`;
      say(`브라우저에 입력 페이지를 엽니다(이 PC 안에서만 열림) — 안 열리면 이 주소를 여세요: ${url}`);
      const o = spawn("xdg-open", [url], {stdio: "ignore", detached: true});
      o.on("error", () => {}); o.unref();
    });
  });
}

async function secret(a) {
  const c = conf();
  const kit = new Kit(c.public);
  const [, sub, name] = a._;
  if (sub === "list") {
    const r = await kit.call("GET", `/repos/${c.repo}/actions/secrets`, null, {git: true});
    const have = (r.data || []).map(x => x.name);
    const want = readJson(join(WS, "kit-mcp.json"), {})?.secrets || [];
    say(`사내 키 저장소(${c.repo}) 비밀값: ${have.join(", ") || "없음"}`);
    const miss = want.filter(n => !have.includes(n.toUpperCase()));
    if (miss.length) say(`kit-mcp.json 에 적혔는데 아직 없는 것: ${miss.join(", ")} — secret set <이름>`);
    return;
  }
  if (sub !== "set" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name || "") || /^(GITEA|GITHUB)_/i.test(name)) die("사용: secret set <이름(영문·숫자·_ , GITEA_/GITHUB_ 로 시작 금지)> | secret list");
  say(`이 PC 에 ${name} 입력 창을 띄웁니다 — 값을 넣고 확인을 누르세요`);
  const value = await askSecret(name);
  const r = await kit.call("PUT", `/repos/${c.repo}/actions/secrets/${name.toUpperCase()}`, {data: value}, {git: true});
  if (r.error !== undefined && ![201, 204].includes(r.status)) die(`키 저장소에 넣지 못했습니다: ${r.error}`);
  const mf = join(WS, "kit-mcp.json"), m = readJson(mf);
  if (m && !(m.secrets || []).includes(name)) { m.secrets = [...(m.secrets || []), name]; writeFileSync(mf, JSON.stringify(m, null, 2) + "\n"); }
  say(`KITDEV-SECRET: ${name} 을 사내 키 저장소(${c.repo})에 넣었습니다 — 시험(goose)과 배포된 MCP 실행 때 환경 변수 ${name} 으로 들어갑니다`);
}

const a = args(process.argv.slice(2));
const CMDS = {login, secret, setup, ci, test, wait: follow, deploy, status, mode, _bg: bg};
(CMDS[a._[0]] || (() => die(`사용: kitdev ${Object.keys(CMDS).join("|")}`, 2)))(a);
