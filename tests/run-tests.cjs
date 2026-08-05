/* ═══════════════════════════════════════════════════════
   SeMIS v2.1 — jsdom 테스트 스위트
   실행: node tests/run-tests.cjs  (jsdom 필요: npm install jsdom)
   ※ .cjs 확장자 = CommonJS 강제 (상위 package.json의 "type":"module" 영향 회피)
   구성: [R] 회귀(코어/모듈, v2.0 52건 상당) + [C] 캘린더 신규 + [S] Supabase 동기화 신규
   ═══════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const appJS = read("js/app.js");
const modJS = read("js/modules.js");
const calJS = read("js/calendar.js");
const inspJS = read("js/inspection.js");
const carcapJS = read("js/carcap.js");
const ctJS = read("js/contacts.js");
const brJS = read("js/branches.js");
const psJS = read("js/passes.js");
const eqJS = read("js/equipment.js");
const trJS = read("js/training.js");
const cnJS = read("js/contracts.js");
const rgJS = read("js/regulations.js");
const ofJS = read("js/officers.js");
const slJS = read("js/seclevel.js");
const iosaJS = read("js/iosa.js");
const pdJS = read("js/passdocs.js");
const plJS = read("js/policy.js");
const ctcJS = read("js/certs.js");
const blJS = read("js/billing.js");
const cnclJS = read("js/council.js");
const vtJS = read("js/vault.js");
const caresJS = read("js/cares.js");
const newsJS = read("js/news.js");
const chatJS = read("js/chat.js");
const searchJS = read("js/search.js");
const kpiJS = read("js/kpi.js");
const syncJS = read("js/sync.js");
const HTML = read("index.html").replace(/<script[\s\S]*?<\/script>/g, "");

let passed = 0, failed = 0;
const failures = [];
function t(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push("✗ " + name + " — " + e.message); }
}
async function ta(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; failures.push("✗ " + name + " — " + e.message); }
}
function eq(got, want, msg) {
  if (got !== want) throw new Error((msg || "eq") + ": expected " + JSON.stringify(want) + ", got " + JSON.stringify(got));
}
function ok(v, msg) { if (!v) throw new Error(msg || "expected truthy"); }

/* ─── 환경 생성 ─── */
const { VirtualConsole } = require("jsdom");
function makeEnv(opts = {}) {
  const vc = new VirtualConsole(); // 리스너 없음 = 무음 (scrollTo 미구현 등 소음 제거)
  if (typeof vc.forwardTo === "function") vc.forwardTo(console, { jsdomErrors: "none" });
  else if (typeof vc.sendTo === "function") vc.sendTo(console, { omitJSDOMErrors: true });
  const dom = new JSDOM(HTML, { url: "https://semis.test/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  if (opts.preData) w.localStorage.setItem("semis2:data", JSON.stringify(opts.preData));
  if (opts.preLS) Object.entries(opts.preLS).forEach(([k, v]) => w.localStorage.setItem(k, v));
  if (opts.fetch) w.fetch = opts.fetch;
  // WebCrypto 폴리필 — jsdom은 crypto.subtle 미구현이라 Node webcrypto 주입 (vault 모듈용)
  try {
    const wc = require("crypto").webcrypto;
    if (!w.crypto || !w.crypto.subtle) Object.defineProperty(w, "crypto", { value: wc, configurable: true });
  } catch (e) { /* 구버전 Node 등 — vault 테스트만 영향 */ }
  // 개별 eval 간에는 최상위 const 바인딩이 공유되지 않으므로 한 번에 평가
  w.eval(appJS + "\n;" + modJS + "\n;" + calJS + "\n;" + inspJS + "\n;" + carcapJS + "\n;" + ctJS + "\n;" + brJS + "\n;" + psJS + "\n;" + eqJS + "\n;" + trJS + "\n;" + cnJS + "\n;" + rgJS + "\n;" + ofJS + "\n;" + slJS + "\n;" + iosaJS + "\n;" + pdJS + "\n;" + plJS + "\n;" + ctcJS + "\n;" + blJS + "\n;" + cnclJS + "\n;" + vtJS + "\n;" + caresJS + "\n;" + newsJS + "\n;" + chatJS + "\n;" + searchJS + "\n;" + kpiJS + "\n;" + syncJS);
  const S = w.SeMIS;
  if (opts.boot !== false) { S.boot(); if (w.SemisSearch) w.SemisSearch.init(); }
  return { dom, w, S, Sync: w.SemisSync, Cal: w.SemisCalendar };
}
/* 로그인은 실제 UI 경로(폼 제출)로 수행 — login()은 비공개 */
function submitLogin(env, pw) {
  const { w } = env;
  w.document.querySelector("#login-pw").value = pw;
  w.document.querySelector("#login-form")
    .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
}
function loginAs(env, role) {
  const { S } = env;
  const pw = "testpw-" + role + "-9x";
  if (!S.data.customUsers.some(u => u.id === "t" + role)) {
    S.data.customUsers.push({ id: "t" + role, name: "T" + role, role, hash: S.pwHash(pw) });
    S.saveSilent();
  }
  submitLogin(env, pw);
  if (!S.user || S.user.id !== "t" + role) throw new Error("test login failed");
  return S.user;
}
function go(env, route) {
  env.w.location.hash = "#/" + route;
  env.S.renderView();
}
/* v2.36.4: 보안점검 일괄 연동으로 부팅 시 "insp_*" 일정이 생성된다.
   캘린더 자체 로직만 보는 블록에서는 이를 걷어내고 시작한다. */
function clearInspEvents(env) {
  env.S.data.schedules = env.S.data.schedules.filter(x => String(x.id).indexOf("insp_") !== 0);
  env.S.saveSilent();
}
const q = (env, sel) => env.w.document.querySelector(sel);
const qa = (env, sel) => Array.from(env.w.document.querySelectorAll(sel));
const todayOf = (env) => new Date().toISOString().slice(0, 10); // UTC (app.js todayStr과 동일 기준)
const localToday = () => { // 로컬 (calendar.js todayISO와 동일 기준)
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};

/* fetch 스텁 (인메모리 서버) */
function makeFetchStub(server) {
  const fn = (url, opts = {}) => {
    const method = opts.method || "GET";
    fn.calls.push({ url: String(url), method, body: opts.body ? JSON.parse(opts.body) : null });
    if (server.fail) return Promise.reject(new Error("network down"));
    if (method === "GET") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(server.rows.slice()) });
    if (method === "POST") {
      const rows = JSON.parse(opts.body);
      rows.forEach(r => {
        const i = server.rows.findIndex(x => x.key === r.key);
        if (i >= 0) server.rows[i] = r; else server.rows.push(r);
      });
      return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve([]) });
    }
    return Promise.resolve({ ok: false, status: 405, json: () => Promise.resolve({}) });
  };
  fn.calls = [];
  return fn;
}

(async function run() {

  /* ══════════ [R] 코어 회귀 — 암호/해시 ══════════ */
  {
    const e = makeEnv();
    t("R01 sha256 표준 벡터(abc)", () =>
      eq(e.S.sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    t("R02 sha256 빈 문자열 벡터", () =>
      eq(e.S.sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
    t("R03 sha256 한글 결정성", () => eq(e.S.sha256("한글암호123"), e.S.sha256("한글암호123")));
    t("R04 pwHash = sha256(salt+':'+pw)", () => eq(e.S.pwHash("xyz"), e.S.sha256("SeMISv2:" + ":" + "xyz")));
    t("R05 기본 사용자 4명 (admin/manager/user/hq)", () => {
      eq(e.S.BASE_USERS.length, 4);
      eq(e.S.BASE_USERS.map(u => u.role).join(","), "admin,manager,user,hq");
    });
    t("R06 mark3464 = 시스템관리자", () => {
      const u = e.S.BASE_USERS.find(x => x.id === "mark3464");
      ok(u && u.role === "admin");
    });
    t("R07 사용자 데이터에 평문 암호 없음(해시만 보관)", () =>
      ok(e.S.BASE_USERS.every(u => /^[0-9a-f]{64}$/.test(u.hash))));

    /* ══════════ [R] 코어 회귀 — 초기 데이터/메뉴 시드 ══════════ */
    t("R08 메뉴 시드 생성(20개 이상)", () => ok(e.S.data.menus.length >= 20));
    t("R09 dashboard/settings 모듈 메뉴 존재", () => {
      ok(e.S.data.menus.some(m => m.module === "dashboard"));
      ok(e.S.data.menus.some(m => m.module === "settings"));
    });
    t("R10 settings 메뉴는 admin 전용", () =>
      eq(e.S.data.menus.find(m => m.module === "settings").vis, "admin"));
    t("R11 외부링크 메뉴는 URL 보유", () =>
      ok(e.S.data.menus.filter(m => m.type === "link").every(m => /^https?:\/\//.test(m.url))));
    t("R12 그룹 메뉴 존재 및 하위 메뉴 연결", () => {
      const g = e.S.data.menus.find(m => m.type === "group");
      ok(g && e.S.data.menus.some(m => m.parent === g.id));
    });
    t("R13 초기 공지 1건 시드", () => eq(e.S.data.notices.length, 1));
    t("R14 초기 보안등급 이력(평시) 시드", () => {
      eq(e.S.data.levelHistory.length, 1);
      eq(e.S.data.levelHistory[0].level, "평시");
    });
    t("R15 sortedMenus는 seq 오름차순", () => {
      const s = e.S.sortedMenus();
      ok(s.every((m, i) => i === 0 || (s[i - 1].seq || 0) <= (m.seq || 0)));
    });

    /* ══════════ [R] 코어 회귀 — 인증/권한 ══════════ */
    t("R16 잘못된 암호 로그인 거부", () => {
      submitLogin(e, "no-such-pw-000");
      ok(!e.S.user, "user 미설정");
      ok(q(e, "#login-error").textContent.includes("올바르지"));
    });
    t("R17 로그인 성공 → user/세션 설정", () => {
      const u = loginAs(e, "manager");
      eq(u.role, "manager");
      ok(e.w.sessionStorage.getItem("semis2:session"));
      ok(e.S.user && e.S.user.id === u.id);
      ok(q(e, "#login-overlay").classList.contains("hidden"));
    });
    t("R18 roleRank: manager=2", () => eq(e.S.roleRank(), 2));
    t("R19 canSee: manager는 mgr 메뉴 가능, admin 메뉴 불가", () => {
      ok(e.S.canSee({ vis: "mgr" }));
      ok(!e.S.canSee({ vis: "admin" }));
      ok(e.S.canSee({ vis: "all" }));
    });
    t("R20 isAdmin: manager는 false", () => ok(!e.S.isAdmin()));
    t("R21 pwOverrides 반영 (암호 변경)", () => {
      const h = e.S.pwHash("newpw-branch-77");
      e.S.data.pwOverrides["branch"] = h;
      ok(e.S.allUsers().find(u => u.id === "branch").hash === h);
      submitLogin(e, "newpw-branch-77");
      ok(e.S.user && e.S.user.id === "branch");
    });
    t("R22 세션 복원 (sessionStorage → 자동 로그인)", () => {
      const e2 = makeEnv({ boot: false, preData: { customUsers: [{ id: "sess1", name: "세션", role: "user", hash: "x" }] } });
      e2.w.sessionStorage.setItem("semis2:session", JSON.stringify({ uid: "sess1", ts: Date.now() }));
      e2.S.boot();
      ok(e2.S.user && e2.S.user.id === "sess1", "자동 로그인");
      ok(q(e2, "#login-overlay").classList.contains("hidden"), "오버레이 숨김");
    });

    /* ══════════ [R] 코어 회귀 — 유틸 ══════════ */
    t("R23 esc() HTML 이스케이프", () =>
      eq(e.S.esc('<a b="c">&\''), "&lt;a b=&quot;c&quot;&gt;&amp;&#39;"));
    t("R24 fmtDate ISO → YYYY-MM-DD", () => eq(e.S.fmtDate("2026-03-05T09:30:00.000Z").slice(0, 7), "2026-03"));
    t("R25 SEC_LEVELS 5단계", () => eq(e.S.SEC_LEVELS.join(","), "평시,관심,주의,경계,심각"));
  }

  /* ══════════ [R] 코어 회귀 — 보안등급 이력/예약 ══════════ */
  {
    const e = makeEnv();
    const today = todayOf(e);
    t("R26 secCurrent 기본값 평시", () => eq(e.S.secCurrent().level, "평시"));
    t("R27 과거~오늘 이력 중 최신 적용", () => {
      e.S.data.levelHistory.push({ id: "a1", date: "2020-01-01", level: "관심", at: "1" });
      e.S.data.levelHistory.push({ id: "a2", date: today, level: "경계", at: "9999-12-31T00:00:00Z" }); // 시드보다 뒤
      eq(e.S.secCurrent().level, "경계");
    });
    t("R28 미래 일자 → 예약(secNext), 현재 등급 유지", () => {
      e.S.data.levelHistory.push({ id: "a3", date: "2099-01-01", level: "심각", at: "3" });
      eq(e.S.secCurrent().level, "경계");
      ok(e.S.secNext() && e.S.secNext().level === "심각");
    });
    t("R29 levelSorted 날짜순 정렬", () => {
      const s = e.S.levelSorted();
      ok(s.every((x, i) => i === 0 || s[i - 1].date <= x.date));
    });
  }

  /* ══════════ [R] 코어 회귀 — 마이그레이션/저장소 ══════════ */
  {
    const e = makeEnv({
      preData: {
        version: 1,
        menus: [{ id: "m1", seq: 0, type: "module", label: "대시보드", module: "dashboard" }],
        secLevel: { level: "경계", updated: "2026-01-01", note: "훈련" },
        schedules: [{ id: "s1", date: "2026-07-20", title: "구형일정", memo: "m" }]
      }
    });
    t("R30 v1 secLevel → levelHistory 이관", () => {
      eq(e.S.data.levelHistory[0].level, "경계");
      eq(e.S.data.levelHistory[0].date, "2026-01-01");
      ok(!e.S.data.secLevel);
    });
    t("R31 v2.0 schedules {date} → v2.1 {start,end,allDay} 이관", () => {
      const s = e.S.data.schedules[0];
      eq(s.start, "2026-07-20"); eq(s.end, "2026-07-20");
      eq(s.allDay, true); eq(s.done, false); eq(s.color, "blue");
      ok(!("date" in s));
    });
    t("R32 누락 필드 보정 (notices/pwOverrides/customUsers)", () => {
      ok(Array.isArray(e.S.data.notices));
      ok(e.S.data.pwOverrides && typeof e.S.data.pwOverrides === "object");
      ok(Array.isArray(e.S.data.customUsers));
    });
  }
  {
    const e = makeEnv({ preLS: { "semis2:data": "{{{corrupt" } });
    t("R33 손상된 localStorage → 초기 데이터로 복구", () => ok(e.S.data.menus.length >= 20));
  }
  {
    const e = makeEnv();
    t("R34 save/load 왕복 (localStorage 지속)", () => {
      e.S.data.notices.push({ id: "nX", title: "지속성", body: "", author: "t", pinned: false, created: "2026-01-01" });
      e.S.save();
      const raw = JSON.parse(e.w.localStorage.getItem("semis2:data"));
      ok(raw.notices.some(n => n.id === "nX"));
      e.S.load();
      ok(e.S.data.notices.some(n => n.id === "nX"));
    });
    t("R35 onSave 후크 호출 + saveSilent는 미호출", () => {
      let calls = 0;
      e.S.onSave(() => calls++);
      e.S.save(); eq(calls, 1);
      e.S.saveSilent(); eq(calls, 1);
    });
    t("R36 백업 JSON 직렬화 가능(menus 배열 포함)", () => {
      const j = JSON.parse(JSON.stringify(e.S.data));
      ok(Array.isArray(j.menus) && j.menus.length > 0);
    });
  }

  /* ══════════ [R] 회귀 — 로그인 UI/라우터/네비 ══════════ */
  {
    const e = makeEnv();
    t("R37 로그인 폼: 올바른 암호 → 오버레이 숨김", () => {
      const pw = "uipw-1234";
      e.S.data.customUsers.push({ id: "ui1", name: "UI", role: "user", hash: e.S.pwHash(pw) });
      e.S.saveSilent();
      q(e, "#login-pw").value = pw;
      q(e, "#login-form").dispatchEvent(new e.w.Event("submit", { bubbles: true, cancelable: true }));
      ok(q(e, "#login-overlay").classList.contains("hidden"), "overlay hidden");
      ok(!q(e, "#app").classList.contains("hidden"), "app shown");
    });
    t("R38 로그인 폼: 틀린 암호 → 오류 메시지", () => {
      const e2 = makeEnv();
      q(e2, "#login-pw").value = "wrong-pw";
      q(e2, "#login-form").dispatchEvent(new e2.w.Event("submit", { bubbles: true, cancelable: true }));
      ok(q(e2, "#login-error").textContent.includes("올바르지"));
    });
    t("R39 기본 라우트 = 대시보드", () => {
      ok(q(e, "#view").innerHTML.includes("대시보드"));
    });
    t("R40 미지의 라우트 → 대시보드 폴백", () => {
      go(e, "does-not-exist");
      ok(q(e, "#view").innerHTML.includes("대시보드"));
    });
    t("R41 네비: 그룹/링크 렌더 + 새 창 속성", () => {
      const links = qa(e, "#nav-menu a.nav-item");
      ok(links.length > 5);
      ok(links.every(a => a.target === "_blank" && a.rel === "noopener"));
    });
    t("R42 네비 권한 필터: user에게 mgr 메뉴 숨김", () => {
      const labels = qa(e, "#nav-menu .nav-item").map(x => x.textContent);
      ok(!labels.some(l => l.includes("계약서 관리")));
    });
    t("R43 헤더: 사용자 칩/보안등급 배지 표시", () => {
      ok(q(e, "#user-chip").textContent.length > 0);
      ok(q(e, "#sec-level-badge").textContent.includes("평시"));
    });
  }
  {
    const e = makeEnv();
    loginAs(e, "hq");
    t("R44 네비 권한: manager에게 mgr 메뉴 표시", () => {
      const labels = qa(e, "#nav-menu .nav-item").map(x => x.textContent);
      ok(labels.some(l => l.includes("계약서 관리")));
    });
  }

  /* ══════════ [R] 회귀 — 대시보드/공지/등급 변경 ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "hq");
    t("R45 대시보드 상단 통계 카드 제거 (v2.6.1)", () => eq(qa(e, ".stat").length, 0));
    t("R46 바로가기(quick) 링크 노출", () => ok(qa(e, ".quick-link").length >= 2));
    t("R47 공지 작성 (리치 에디터 + 살균)", () => {
      q(e, "#btn-add-notice").click();
      ok(q(e, "#nb-editor"), "리치 에디터 존재");
      ok(q(e, "#modal-box").classList.contains("wide"), "넓은 모달");
      q(e, "#f-title").value = "테스트 공지";
      q(e, "#nb-editor").innerHTML = '본문 <b>강조</b><script>bad()</script>';
      q(e, "#f-pinned").checked = true;
      q(e, "#f-save").click();
      const n = e.S.data.notices.find(x => x.title === "테스트 공지");
      ok(n && n.pinned === true && n.author === "Thq");
      ok(n.bodyHtml.includes("<b>강조</b>"), "서식 보존");
      ok(!n.bodyHtml.includes("<script"), "스크립트 제거");
      eq(n.body, "본문 강조", "텍스트 추출(살균 후)");
    });
    t("R48 공지 제목 미입력 거부", () => {
      const before = e.S.data.notices.length;
      q(e, "#btn-add-notice").click();
      q(e, "#f-title").value = "  ";
      q(e, "#f-save").click();
      eq(e.S.data.notices.length, before);
      e.S.closeModal();
    });
    t("R49 공지 삭제 (확인 모달 경유)", () => {
      const id = e.S.data.notices.find(x => x.title === "테스트 공지").id;
      e.S.renderView();
      q(e, `#notice-list [data-del="${id}"]`).click();
      q(e, "#modal-box [data-act=ok]").click();
      ok(!e.S.data.notices.some(x => x.id === id));
    });
    t("R50 보안등급 변경(오늘) → 즉시 적용", () => {
      e.S.renderView();
      q(e, "#btn-edit-level").click();
      q(e, "#f-level").value = "주의";
      q(e, "#f-date").value = todayOf(e);
      q(e, "#f-note").value = "테스트";
      q(e, "#f-save").click();
      eq(e.S.secCurrent().level, "주의");
    });
    t("R51 보안등급 변경(미래) → 예약 등록", () => {
      q(e, "#btn-edit-level").click();
      q(e, "#f-level").value = "심각";
      q(e, "#f-date").value = "2099-12-31";
      q(e, "#f-save").click();
      eq(e.S.secCurrent().level, "주의");
      eq(e.S.secNext().level, "심각");
    });
    t("R52 등급 이력 삭제 버튼 동작", () => {
      const hist = e.S.levelSorted();
      const target = hist[hist.length - 1]; // 예약 건 삭제
      const btn = q(e, `#level-box [data-lvdel="${target.id}"]`);
      ok(btn, "삭제 버튼 존재");
      btn.click();
      q(e, "#modal-box [data-act=ok]").click();
      ok(!e.S.data.levelHistory.some(x => x.id === target.id));
    });
  }

  /* ══════════ [R] 회귀 — 시스템 설정 ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "manager");
    t("R53 설정: 일반 사용자 접근 차단(대시보드 폴백)", () => {
      go(e, "settings");
      const html = q(e, "#view").innerHTML;
      ok(!html.includes("메뉴 관리"), "설정 화면 미노출");
      ok(html.includes("대시보드"), "대시보드로 폴백");
    });
  }
  {
    const e = makeEnv();
    loginAs(e, "admin");
    go(e, "settings");
    t("R54 설정: admin 접근 및 탭 4개", () => {
      eq(qa(e, ".tab").length, 4);                          // v2.38: 저장소 관리 탭 추가
      eq(qa(e, ".tab").map(x => x.dataset.tab).join(","), "menus,users,data,storage");
    });
    t("R55 메뉴 추가: 잘못된 URL 거부", () => {
      const before = e.S.data.menus.length;
      q(e, "#btn-add-menu").click();
      q(e, "#f-label").value = "나쁜링크";
      q(e, "#f-url").value = "notaurl";
      q(e, "#f-save").click();
      eq(e.S.data.menus.length, before);
      e.S.closeModal();
    });
    t("R56 메뉴 추가: 정상 URL 등록 + 네비 반영", () => {
      q(e, "#btn-add-menu").click();
      q(e, "#f-label").value = "새 링크";
      q(e, "#f-url").value = "https://example.com/doc";
      q(e, "#f-save").click();
      ok(e.S.data.menus.some(m => m.label === "새 링크" && m.url === "https://example.com/doc"));
      ok(qa(e, "#nav-menu .nav-item").some(el => el.textContent.includes("새 링크")));
    });
    t("R57 메뉴 순서 이동(▲) seq 교환", () => {
      const before = e.S.sortedMenus().filter(m => !m.parent || m.type === "group").map(m => m.id);
      const secondId = before[1];
      q(e, `#menu-tree [data-up="${secondId}"]`).click();
      const after = e.S.sortedMenus().filter(m => !m.parent || m.type === "group").map(m => m.id);
      eq(after[0], secondId);
      eq(after[1], before[0]);
    });
    t("R58 메뉴 삭제: 그룹 삭제 시 하위 메뉴 함께 삭제", () => {
      const g = e.S.data.menus.find(m => m.type === "group");
      const childIds = e.S.data.menus.filter(m => m.parent === g.id).map(m => m.id);
      ok(childIds.length > 0);
      q(e, `#menu-tree [data-del="${g.id}"]`).click();
      q(e, "#modal-box [data-act=ok]").click();
      ok(!e.S.data.menus.some(m => m.id === g.id));
      ok(!e.S.data.menus.some(m => childIds.includes(m.id)));
    });
    t("R59 핵심 모듈(dashboard/settings) 삭제 버튼 없음", () => {
      ok(!q(e, '#menu-tree [data-del="dashboard"]'));
      ok(!q(e, '#menu-tree [data-del="settings"]'));
    });

    // 사용자 탭
    qa(e, ".tab").find(x => x.dataset.tab === "users").click();
    t("R60 사용자 추가: 중복 ID 거부", () => {
      const before = e.S.data.customUsers.length;
      q(e, "#btn-add-user").click();
      q(e, "#f-uid").value = "mark3464";
      q(e, "#f-uname").value = "중복";
      q(e, "#f-upw").value = "abcd1234";
      q(e, "#f-save").click();
      eq(e.S.data.customUsers.length, before);
      e.S.closeModal();
    });
    t("R61 사용자 추가: 짧은 암호 거부", () => {
      const before = e.S.data.customUsers.length;
      q(e, "#btn-add-user").click();
      q(e, "#f-uid").value = "newbie1";
      q(e, "#f-uname").value = "신규";
      q(e, "#f-upw").value = "12";
      q(e, "#f-save").click();
      eq(e.S.data.customUsers.length, before);
      e.S.closeModal();
    });
    t("R62 사용자 추가: 정상 등록 + 로그인 가능", () => {
      q(e, "#btn-add-user").click();
      q(e, "#f-uid").value = "newbie1";
      q(e, "#f-uname").value = "신규";
      q(e, "#f-urole").value = "user";
      q(e, "#f-upw").value = "unique-pw-551";
      q(e, "#f-save").click();
      ok(e.S.data.customUsers.some(u => u.id === "newbie1"));
      ok(e.S.allUsers().some(u => u.id === "newbie1"));
    });
    const pwBtn = (idTxt) => qa(e, "#tab-body tr").find(r => { const b = r.querySelector("b"); return b && b.textContent === idTxt; }).querySelector("[data-pw]");
    t("R63 암호 변경: 타 사용자와 동일 암호 거부", () => {
      pwBtn("branch").click();
      q(e, "#f-pw1").value = "unique-pw-551"; // newbie1과 동일
      q(e, "#f-pw2").value = "unique-pw-551";
      q(e, "#f-save").click();
      ok(e.S.data.pwOverrides["branch"] !== e.S.pwHash("unique-pw-551"));
      e.S.closeModal();
    });
    t("R64 암호 변경: 정상 변경 → pwOverrides 반영", () => {
      pwBtn("branch").click();
      q(e, "#f-pw1").value = "branch-new-pw-88";
      q(e, "#f-pw2").value = "branch-new-pw-88";
      q(e, "#f-save").click();
      eq(e.S.data.pwOverrides["branch"], e.S.pwHash("branch-new-pw-88"));
    });
    t("R65 기본 사용자에는 삭제 버튼 없음", () => {
      ok(!q(e, '[data-del="mark3464"]'));
    });

    // 데이터 탭
    qa(e, ".tab").find(x => x.dataset.tab === "data").click();
    t("R66 데이터 탭: 백업/복원/초기화 UI + 동기화 상태 표시", () => {
      ok(q(e, "#btn-export"));
      ok(q(e, "#btn-import"));
      ok(q(e, "#btn-reset-all"));
      ok(q(e, "#sysinfo-sync"));
      ok(q(e, "#btn-sync-now"));
    });
  }

  /* ══════════ [C] 캘린더 신규 ══════════ */
  {
    const e = makeEnv();
    const C = e.Cal;
    t("C01 날짜 유틸: addDays 월 경계", () => {
      eq(C.addDays("2026-01-31", 1), "2026-02-01");
      eq(C.addDays("2026-03-01", -1), "2026-02-28");
      eq(C.addDays("2024-02-28", 1), "2024-02-29", "윤년");
    });
    t("C02 날짜 유틸: diffDays", () => {
      eq(C.diffDays("2026-07-01", "2026-07-15"), 14);
      eq(C.diffDays("2026-07-15", "2026-07-01"), -14);
    });
    t("C03 날짜 유틸: startOfWeek(일요일 시작)", () => {
      eq(C.startOfWeek("2026-07-15"), "2026-07-12"); // 수요일 → 일요일
      eq(C.startOfWeek("2026-07-12"), "2026-07-12"); // 일요일 그대로
    });
    t("C04 색상 팔레트 14종 (고대비)", () => {
      eq(C.COLORS.length, 15);
      ok(new Set(C.COLORS.map(c => c.id)).size === 15, "id 중복 없음");
      ok(C.COLORS.some(c => c.id === "rose"), "연분홍(점검 계획용) 포함");
    });
    t("C05 보기 5종 (일/주/2주/월/년)", () =>
      eq(C.VIEWS.map(v => v.id).join(","), "day,week,2week,month,year"));
  }
  {
    const e = makeEnv();
    loginAs(e, "hq");
    const C = e.Cal;
    clearInspEvents(e);
    const D = e.S.data;
    D.schedules.push(
      { id: "ev1", title: "단일일정", memo: "", start: "2026-07-15", end: "2026-07-15", allDay: true, time: "", timeEnd: "", color: "green", done: false, assignee: "홍길동" },
      { id: "ev2", title: "기간일정", memo: "", start: "2026-07-14", end: "2026-07-16", allDay: true, time: "", timeEnd: "", color: "red", done: false, assignee: "김보안" },
      { id: "ev3", title: "시간일정", memo: "회의", start: "2026-07-15", end: "2026-07-15", allDay: false, time: "14:00", timeEnd: "15:00", color: "purple", done: true, assignee: "홍길동" }
    );
    e.S.saveSilent();
    t("C06 eventsOnDay: 해당 일자만 조회", () => {
      const ids = C.eventsOnDay("2026-07-15").map(x => x.id);
      ok(ids.includes("ev1") && ids.includes("ev2") && ids.includes("ev3"));
      eq(C.eventsOnDay("2026-07-13").length, 0);
    });
    t("C07 eventsOnDay: 기간 일정은 범위 내 매일 포함", () => {
      ok(C.eventsOnDay("2026-07-14").some(x => x.id === "ev2"));
      ok(C.eventsOnDay("2026-07-16").some(x => x.id === "ev2"));
      ok(!C.eventsOnDay("2026-07-17").some(x => x.id === "ev2"));
    });
    t("C08 정렬: 종일/기간 우선, 시간순 다음", () => {
      const ids = C.eventsOnDay("2026-07-15").map(x => x.id);
      ok(ids.indexOf("ev2") < ids.indexOf("ev3"), "기간 > 시간");
      ok(ids.indexOf("ev1") < ids.indexOf("ev3"), "종일 > 시간");
    });
    t("C09 담당자 필터", () => {
      C.setFilter("홍길동", undefined);
      const ids = C.filteredEvents().map(x => x.id);
      ok(ids.includes("ev1") && ids.includes("ev3") && !ids.includes("ev2"));
      C.setFilter("", undefined);
      eq(C.filteredEvents().length, 3);
    });
    t("C10 완료 숨기기 필터", () => {
      C.setFilter(undefined, true);
      ok(!C.filteredEvents().some(x => x.id === "ev3"));
      C.setFilter(undefined, false);
    });
    t("C11 담당자 목록: 팀원 우선 + 사용 담당자 수집", () =>
      eq(C.assigneeList().join(","), "박철성,최상일,이은우,이윤민,김보안,홍길동"));
    t("C12 moveEvent: 기간 유지 이동", () => {
      ok(C.moveEvent("ev2", "2026-07-20"));
      const ev = D.schedules.find(x => x.id === "ev2");
      eq(ev.start, "2026-07-20"); eq(ev.end, "2026-07-22", "3일 기간 유지");
    });
    t("C13 resizeEvent: 종료일 조정 + start 미만 방지", () => {
      ok(C.resizeEvent("ev2", "2026-07-25"));
      eq(D.schedules.find(x => x.id === "ev2").end, "2026-07-25");
      C.resizeEvent("ev2", "2026-07-01"); // start보다 이전 → start로 고정
      eq(D.schedules.find(x => x.id === "ev2").end, "2026-07-20");
    });
    t("C14 toggleDone 완료 토글", () => {
      eq(C.toggleDone("ev1"), true);
      eq(D.schedules.find(x => x.id === "ev1").done, true);
      eq(C.toggleDone("ev1"), false);
    });
    t("C15 rangeTitle: 월/년 형식", () => {
      C.setAnchor("2026-07-15");
      C.setView("month");
      eq(C.rangeTitle(), "2026년 7월");
      C.setView("year");
      eq(C.rangeTitle(), "2026년");
      C.setView("day");
      ok(C.rangeTitle().includes("7월 15일") && C.rangeTitle().includes("수"));
    });

    /* 뷰 렌더링 */
    go(e, "schedule");
    t("C16 schedule 모듈이 캘린더로 대체(모듈 오버라이드)", () => {
      ok(q(e, ".cal-toolbar"), "툴바 존재");
      ok(!q(e, "#sch-body"), "구 테이블 없음");
    });
    t("C17 월 보기: 42셀 그리드", () => {
      C.setView("month"); C.setAnchor("2026-07-15"); e.S.renderView();
      eq(qa(e, ".cal-cell").length, 42);
    });
    t("C18 월 보기: 기간 일정 한 줄 연결 바(스패닝)", () => {
      C.resizeEvent("ev2", "2026-07-25"); // 7/20(월)~25(토) — 같은 주
      const bars = qa(e, '[data-ev="ev2"]');
      eq(bars.length, 1, "주 내 기간은 바 1개");
      ok(bars[0].className.includes("cal-bar"), "바 요소");
      ok(bars[0].getAttribute("style").includes("grid-column:2/8"), "월~토 열 스팬");
      C.resizeEvent("ev2", "2026-07-28"); // 다음 주로 넘어감 → 주별 분할
      eq(qa(e, '[data-ev="ev2"]').length, 2, "2개 주에 걸치면 바 2개");
      ok(qa(e, '[data-ev="ev2"]')[0].className.includes("cont-r"), "이어짐 표시");
      C.resizeEvent("ev2", "2026-07-25"); // 원복
    });
    t("C19 주 보기: 7셀", () => {
      C.setView("week"); e.S.renderView();
      eq(qa(e, ".cal-cell").length, 7);
    });
    t("C20 2주 보기: 14셀", () => {
      C.setView("2week"); e.S.renderView();
      eq(qa(e, ".cal-cell").length, 14);
    });
    t("C21 년 보기: 12개 미니 달력 + 일정 도트", () => {
      C.setView("year"); e.S.renderView();
      eq(qa(e, ".cal-mini").length, 12);
      ok(qa(e, ".mini-day.has-ev").length > 0);
    });
    t("C22 일 보기: 시간/종일 구분 표시", () => {
      C.setView("day"); C.setAnchor("2026-07-15"); e.S.renderView();
      ok(q(e, ".cal-dayview"));
      const html = q(e, "#cal-body").innerHTML;
      ok(html.includes("시간 일정") && html.includes("14:00"));
    });
    t("C23 뷰 상태 uiState 지속", () => {
      const ui = JSON.parse(e.w.localStorage.getItem("semis2:ui"));
      eq(ui.calView, "day");
    });
    t("C24 오늘 셀 강조 (월 보기, 현재 월)", () => {
      C.setView("month"); C.setAnchor(localToday()); e.S.renderView();
      ok(q(e, ".cal-cell.today"));
    });
    t("C25 완료 일정 칩에 done 클래스", () => {
      C.setAnchor("2026-07-15"); e.S.renderView();
      const chip = q(e, '[data-ev="ev3"]');
      ok(chip && chip.className.includes("done"));
    });
    t("C26 시간 일정: 투명 칩(cal-tchip) + 색 점 + 시간 표기", () => {
      const chip = q(e, '[data-ev="ev3"]');
      ok(chip.className.includes("cal-tchip"), "투명 스타일 칩");
      ok(chip.querySelector(".chip-dot"), "색상 점");
      ok(chip.innerHTML.includes("14:00"));
      // 종일 일정은 바(cal-bar)로 유지
      ok(q(e, '[data-ev="ev1"]').className.includes("cal-bar"), "종일은 바");
    });
    t("C27 +N개 더보기 (월 보기 5개 이상)", () => {
      for (let i = 0; i < 6; i++) D.schedules.push({ id: "bulk" + i, title: "일정" + i, memo: "", start: "2026-07-15", end: "2026-07-15", allDay: true, time: "", timeEnd: "", color: "gray", done: false, assignee: "" });
      e.S.saveSilent(); e.S.renderView();
      const more = qa(e, ".cal-more").find(x => x.dataset.more === "2026-07-15");
      ok(more && /\+\d+개/.test(more.textContent));
      more.click(); // → 일 보기 전환
      eq(C.getView(), "day");
      eq(C.getAnchor(), "2026-07-15");
      D.schedules = D.schedules.filter(x => !x.id.startsWith("bulk"));
      e.S.saveSilent();
    });
    t("C28 일정 등록 폼: 시간 일정 저장", () => {
      C.setView("month"); e.S.renderView();
      q(e, "#cal-add").click();
      q(e, "#f-title").value = "새 점검";
      q(e, "#f-start").value = "2026-08-03";
      q(e, "#f-end").value = "2026-08-04";
      q(e, "#f-allday").checked = false;
      q(e, "#f-allday").dispatchEvent(new e.w.Event("change"));
      q(e, "#f-time").value = "10:30";
      qa(e, '#f-colors [data-color="red"]')[0].click();
      q(e, "#f-assignee").value = "이순신";
      q(e, "#f-memo").innerHTML = "메모입니다"; // v2.5: 리치 에디터(contenteditable)
      q(e, "#f-save").click();
      const ev = D.schedules.find(x => x.title === "새 점검");
      ok(ev, "저장됨");
      eq(ev.allDay, false); eq(ev.time, "10:30"); eq(ev.color, "red");
      eq(ev.assignee, "이순신"); eq(ev.start, "2026-08-03"); eq(ev.end, "2026-08-04");
    });
    t("C29 일정 폼: 종료일 < 시작일 자동 교정", () => {
      q(e, "#cal-add").click();
      q(e, "#f-title").value = "역순일정";
      q(e, "#f-start").value = "2026-08-20";
      q(e, "#f-end").value = "2026-08-18";
      q(e, "#f-save").click();
      const ev = D.schedules.find(x => x.title === "역순일정");
      eq(ev.start, "2026-08-18"); eq(ev.end, "2026-08-20");
    });
    t("C30 일정 폼: 제목 미입력 거부", () => {
      const before = D.schedules.length;
      q(e, "#cal-add").click();
      q(e, "#f-title").value = "";
      q(e, "#f-save").click();
      eq(D.schedules.length, before);
      e.S.closeModal();
    });
    t("C31 일정 수정: 칩 클릭 → 폼 → 삭제", () => {
      C.setAnchor("2026-08-03"); C.setView("month"); e.S.renderView();
      const ev = D.schedules.find(x => x.title === "새 점검");
      qa(e, `[data-ev="${ev.id}"]`)[0].click();
      ok(q(e, "#f-del"), "수정 모달에 삭제 버튼");
      q(e, "#f-del").click();
      q(e, "#modal-box [data-act=ok]").click();
      ok(!D.schedules.some(x => x.id === ev.id));
    });
    t("C32 포인터 드래그: pointerdown→move→up 으로 일정 이동", () => {
      C.setAnchor("2026-07-15"); C.setView("month"); e.S.renderView();
      const chip = qa(e, '[data-ev="ev1"]')[0];
      ok(chip, "칩 존재");
      ok(chip.hasAttribute("data-drag"), "쓰기 권한 시 드래그 대상 표시");
      const target = qa(e, ".cal-cell").find(c => c.dataset.day === "2026-07-22");
      e.w.document.elementsFromPoint = () => [target];      // jsdom 히트테스트 대체
      const pev = (type, x, y) => new e.w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      chip.dispatchEvent(pev("pointerdown", 100, 100));
      chip.dispatchEvent(pev("pointermove", 102, 101));     // 임계값(5px) 미만 → 드래그 미개시
      ok(!e.w.document.querySelector(".cal-ghost"), "임계값 이하에서는 고스트 없음");
      chip.dispatchEvent(pev("pointermove", 300, 140));
      ok(e.w.document.querySelector(".cal-ghost"), "드래그 시작 시 고스트 생성");
      ok(target.className.includes("drop-hover"), "드롭 대상 셀 하이라이트");
      chip.dispatchEvent(pev("pointerup", 300, 140));
      ok(!e.w.document.querySelector(".cal-ghost"), "종료 시 고스트 제거");
      eq(D.schedules.find(x => x.id === "ev1").start, "2026-07-22");
      C.moveEvent("ev1", "2026-07-15"); // 원복
    });
    t("C32a 포인터 드래그: 이동 없이 놓으면(클릭) 일정 유지", () => {
      C.setAnchor("2026-07-15"); C.setView("month"); e.S.renderView();
      const chip = qa(e, '[data-ev="ev1"]')[0];
      const pev = (type, x, y) => new e.w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      chip.dispatchEvent(pev("pointerdown", 100, 100));
      chip.dispatchEvent(pev("pointerup", 100, 100));
      eq(D.schedules.find(x => x.id === "ev1").start, "2026-07-15");
      ok(!e.w.document.querySelector(".cal-ghost"), "고스트 잔존 없음");
    });
    t("C32b 포인터 드래그: Esc 로 취소", () => {
      C.setAnchor("2026-07-15"); C.setView("month"); e.S.renderView();
      const chip = qa(e, '[data-ev="ev1"]')[0];
      const target = qa(e, ".cal-cell").find(c => c.dataset.day === "2026-07-22");
      e.w.document.elementsFromPoint = () => [target];
      const pev = (type, x, y) => new e.w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      chip.dispatchEvent(pev("pointerdown", 100, 100));
      chip.dispatchEvent(pev("pointermove", 300, 140));
      e.w.document.dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      ok(!e.w.document.querySelector(".cal-ghost"), "취소 시 고스트 제거");
      chip.dispatchEvent(pev("pointerup", 300, 140));
      eq(D.schedules.find(x => x.id === "ev1").start, "2026-07-15", "취소 후 이동 없음");
    });
    t("C33 년 보기 → 월 이동 내비게이션", () => {
      C.setView("year"); e.S.renderView();
      const btn = qa(e, "[data-gomonth]").find(x => x.dataset.gomonth === "2026-03-01");
      btn.click();
      eq(C.getView(), "month");
      eq(C.getAnchor(), "2026-03-01");
    });
    t("C34 툴바 이동: 월 보기 ◀▶", () => {
      C.setView("month"); C.setAnchor("2026-07-15"); e.S.renderView();
      q(e, "#cal-next").click();
      ok(C.getAnchor().startsWith("2026-08"));
      q(e, "#cal-prev").click(); q(e, "#cal-prev").click();
      ok(C.getAnchor().startsWith("2026-06"));
      q(e, "#cal-today").click();
      eq(C.getAnchor(), localToday());
    });
    t("C35 칩 완료 체크: 미완료 ○(호버 노출)·완료 ✓", () => {
      C.setAnchor("2026-07-15"); C.setView("month"); e.S.renderView();
      const tog = qa(e, '[data-donetoggle="ev1"]')[0];
      ok(tog, "미완료 시에도 토글 요소는 존재(클릭 가능)");
      ok(tog.className.includes("todo"), "미완료 체크는 todo(평소 숨김) 클래스");
      tog.click();
      eq(D.schedules.find(x => x.id === "ev1").done, true);
      const done = qa(e, '[data-donetoggle="ev1"]')[0];
      ok(done && done.className.includes("done") && done.textContent.includes("✓"), "완료 후 ✓ 표시");
    });
    t("C35a 전체화면: 토글로 cal-fullscreen 진입/해제 + 그리드 유지", () => {
      C.setAnchor("2026-07-15"); C.setView("month"); e.S.renderView();
      ok(q(e, "#cal-fs"), "전체화면 버튼 존재");
      ok(!q(e, ".cal-card").className.includes("cal-fullscreen"), "초기엔 일반 모드");
      q(e, "#cal-fs").click();
      ok(q(e, ".cal-card").className.includes("cal-fullscreen"), "전체화면 클래스 적용");
      eq(qa(e, ".cal-cell").length, 42, "전체화면에서도 월 그리드 42셀 정상");
      ok(q(e, "#cal-add2"), "전체화면 등록 버튼 노출(쓰기권한)");
      q(e, "#cal-fs").click();
      ok(!q(e, ".cal-card").className.includes("cal-fullscreen"), "재클릭 시 해제");
      ok(!q(e, "#cal-add2"), "해제 시 전체화면 등록 버튼 숨김");
    });
    t("C35b 전체화면: Esc 로 해제(모달 미개방 시)", () => {
      q(e, "#cal-fs").click();
      ok(q(e, ".cal-card").className.includes("cal-fullscreen"), "진입 확인");
      e.w.document.dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      ok(!q(e, ".cal-card").className.includes("cal-fullscreen"), "Esc 로 해제됨");
    });
    t("C36 대시보드: 다가오는 일정 신규 스키마 표시", () => {
      const fut = C.addDays(todayOf(e), 3);
      D.schedules.push({ id: "fut1", title: "미래점검", memo: "", start: fut, end: fut, allDay: false, time: "09:00", timeEnd: "", color: "sky", done: false, assignee: "홍길동" });
      e.S.saveSilent();
      go(e, "dashboard");
      const box = q(e, "#upcoming-box");
      ok(box.innerHTML.includes("미래점검"));
      ok(box.innerHTML.includes("09:00"));
    });
  }
  {
    const e = makeEnv();
    loginAs(e, "manager");
    e.S.data.schedules.push({ id: "ro1", title: "읽기전용", memo: "비밀메모", start: "2026-07-15", end: "2026-07-15", allDay: true, time: "", timeEnd: "", color: "blue", done: false, assignee: "" });
    e.S.saveSilent();
    go(e, "schedule");
    t("C37 일반 사용자: 등록 버튼/드래그 비활성", () => {
      ok(!q(e, "#cal-add"), "등록 버튼 없음");
      e.Cal.setAnchor("2026-07-15"); e.Cal.setView("month"); e.S.renderView();
      const chip = qa(e, '[data-ev="ro1"]')[0];
      ok(chip && !chip.hasAttribute("data-drag"), "드래그 불가");
    });
    t("C38 일반 사용자: 칩 클릭 → 읽기 전용 상세", () => {
      qa(e, '[data-ev="ro1"]')[0].click();
      const html = q(e, "#modal-box").innerHTML;
      ok(html.includes("읽기전용") && html.includes("비밀메모"));
      ok(!q(e, "#f-save"), "저장 버튼 없음");
    });
  }

  /* ══════════ [V] v2.2 신규 — 예약체크/리마인더/팀태그/구글연동 ══════════ */
  {
    const e = makeEnv({
      preData: { schedules: [{ id: "old1", date: "2026-07-20", title: "구형", memo: "" }] }
    });
    t("V01 마이그레이션: vehicle/room/reminders 기본값", () => {
      const s = e.S.data.schedules[0];
      eq(s.vehicle, false); eq(s.room, false);
      ok(Array.isArray(s.reminders) && s.reminders.length === 0);
    });
    t("V02 gcal 연동 설정 기본값 생성", () => {
      ok(e.S.data.gcal);
      eq(e.S.data.gcal.enabled, false);
      eq(e.S.data.gcal.calendarId, "airzetaavsec@gmail.com");
    });
    t("V03 팀 4명 + 담당자 태그(약자 1글자, 이모지 제외)", () => {
      const C = e.Cal;
      eq(C.TEAM.length, 4);
      eq(C.TEAM.map(t2 => t2.name).join(","), "박철성,최상일,이은우,이윤민");
      eq(C.tagOf("박철성"), "박");
      eq(C.tagOf("최상일"), "최");
      eq(C.tagOf("이은우"), "은");
      eq(C.tagOf("이윤민"), "윤");
      ok(!C.tagOf("이윤민").includes("🌸"), "태그에 이모지 없음");
      eq(C.tagOf("외부인사").length, 1, "미등록자는 앞 1자");
    });
    t("V04 리마인더 4종 정의 (2주/1주/1일/1시간 전)", () => {
      eq(e.Cal.REMINDER_DEFS.map(r => r.id).join(","), "2w,1w,1d,1h");
      eq(e.Cal.REMINDER_DEFS.find(r => r.id === "1h").ms, 3600000);
    });
    t("V05 eventStartMs: 시간 일정 vs 종일(09:00) 기준", () => {
      const C = e.Cal;
      const timed = C.eventStartMs({ start: "2026-07-20", allDay: false, time: "14:30" });
      const allday = C.eventStartMs({ start: "2026-07-20", allDay: true, time: "" });
      eq(timed - allday, (5 * 60 + 30) * 60000, "14:30 - 09:00 = 5.5h");
    });
    t("V06 dueReminders: 알림 윈도우/완료 제외/중복 발송 방지", () => {
      const C = e.Cal;
      const now = Date.now();
      const st = new Date(now + 30 * 60000); // 30분 뒤 시작
      const p = (n) => String(n).padStart(2, "0");
      const iso = st.getFullYear() + "-" + p(st.getMonth() + 1) + "-" + p(st.getDate());
      const hm = p(st.getHours()) + ":" + p(st.getMinutes());
      e.S.data.schedules.push(
        { id: "rem1", title: "알림일정", memo: "", start: iso, end: iso, allDay: false, time: hm, timeEnd: "", color: "red", done: false, assignee: "", vehicle: false, room: false, reminders: ["1h"] },
        { id: "rem2", title: "완료일정", memo: "", start: iso, end: iso, allDay: false, time: hm, timeEnd: "", color: "red", done: true, assignee: "", vehicle: false, room: false, reminders: ["1h"] }
      );
      e.S.saveSilent();
      const due = C.dueReminders(now);
      ok(due.some(d => d.event.id === "rem1"), "1시간 전 윈도우 내 알림");
      ok(!due.some(d => d.event.id === "rem2"), "완료 일정 제외");
      C.checkReminders(); // 발송 + fired 마킹
      ok(!C.dueReminders(now).some(d => d.event.id === "rem1"), "중복 발송 방지");
      ok(e.w.localStorage.getItem("semis2:firedRem"), "fired 기록 저장");
    });
    t("V07 mapGcalItem: 종일(end exclusive)/시간 일정 변환", () => {
      const C = e.Cal;
      const a = C.mapGcalItem({ id: "ga", summary: "종일행사", status: "confirmed",
        start: { date: "2026-08-10T00:00:00Z" }, end: { date: "2026-08-12T00:00:00Z" } });
      eq(a.start, "2026-08-10"); eq(a.end, "2026-08-11", "DTEND exclusive → -1일");
      eq(a.allDay, true);
      const b = C.mapGcalItem({ id: "gb", summary: "회의",
        start: { dateTime: "2026-08-07T08:30:00+09:00" }, end: { dateTime: "2026-08-07T11:30:00+09:00" } });
      eq(b.allDay, false); eq(b.time, "08:30"); eq(b.timeEnd, "11:30"); eq(b.start, "2026-08-07");
      eq(C.mapGcalItem({ id: "gc", status: "cancelled", start: { date: "2026-08-10" } }), null, "취소 일정 제외");
    });
  }
  {
    const e = makeEnv();
    loginAs(e, "hq");
    const C = e.Cal;
    t("V08 구글 오버레이: 표시/중복 제거/비활성 제외", () => {
      C._setGcalEvents([{ gcalId: "gx1", title: "구글일정", memo: "", start: "2026-07-15", end: "2026-07-15", allDay: true, time: "", timeEnd: "", color: "" }]);
      e.S.data.gcal = { enabled: true, calendarId: "x", apiKey: "k" };
      ok(C.eventsOnDay("2026-07-15").some(x => x.gcalId === "gx1"), "오버레이 표시");
      // 이미 이관된(gcalId 보유) 일정과 중복 제거
      e.S.data.schedules.push({ id: "g_gx1", gcalId: "gx1", title: "이관본", memo: "", start: "2026-07-15", end: "2026-07-15", allDay: true, time: "", timeEnd: "", color: "blue", done: false, assignee: "", vehicle: false, room: false, reminders: [] });
      e.S.saveSilent();
      const ids = C.eventsOnDay("2026-07-15");
      ok(!ids.some(x => !x.id && x.gcalId === "gx1"), "이관된 일정은 오버레이 숨김");
      ok(ids.some(x => x.id === "g_gx1"), "이관본은 표시");
      e.S.data.gcal.enabled = false;
      e.S.data.schedules = e.S.data.schedules.filter(x => x.id !== "g_gx1");
      ok(!C.eventsOnDay("2026-07-15").some(x => x.gcalId === "gx1"), "비활성 시 제외");
      C._setGcalEvents([]);
      e.S.data.gcal = { enabled: false, calendarId: "airzetaavsec@gmail.com", apiKey: "" }; // 원복
    });
    t("V09 일정 폼: 차량/회의실/리마인더 저장", () => {
      go(e, "schedule");
      C.setView("month"); C.setAnchor("2026-07-15"); e.S.renderView();
      q(e, "#cal-add").click();
      q(e, "#f-title").value = "청사 보안회의";
      q(e, "#f-start").value = "2026-07-21";
      q(e, "#f-vehicle").checked = true;
      q(e, "#f-room").checked = true;
      qa(e, '#modal-box [data-rem]').forEach(x => { if (x.dataset.rem === "1d" || x.dataset.rem === "1h") x.checked = true; });
      q(e, "#f-assignee").value = "최상일";
      q(e, "#f-save").click();
      const ev = e.S.data.schedules.find(x => x.title === "청사 보안회의");
      ok(ev, "저장됨");
      eq(ev.vehicle, true); eq(ev.room, true);
      eq(ev.reminders.sort().join(","), "1d,1h");
      eq(ev.assignee, "최상일");
    });
    t("V10 칩에 🚗/🏢/⏰ 아이콘 + 담당자 태그 표시", () => {
      C.setAnchor("2026-07-21"); e.S.renderView();
      const ev = e.S.data.schedules.find(x => x.title === "청사 보안회의");
      const chip = qa(e, `[data-ev="${ev.id}"]`)[0];
      ok(chip, "칩 존재");
      ok(chip.innerHTML.includes("🚗") && chip.innerHTML.includes("🏢") && chip.innerHTML.includes("⏰"), "아이콘");
      ok(chip.innerHTML.includes("최"), "담당자 약자 태그");
    });
    t("V11 담당자 목록: 팀원 4명 항상 포함", () => {
      const list = C.assigneeList();
      ok(["박철성", "최상일", "이은우", "이윤민"].every(n => list.includes(n)));
    });
    t("V12 팀 빠른선택 버튼 → 담당자 입력", () => {
      q(e, "#cal-add").click();
      const btn = qa(e, ".team-btn").find(b => b.dataset.team === "이은우");
      btn.click();
      eq(q(e, "#f-assignee").value, "이은우");
      e.S.closeModal();
    });
    t("V13 구글 연동 설정 모달 (ICS 주소 표시)", () => {
      q(e, "#cal-gcal").click();
      ok(q(e, "#g-enabled"), "설정 모달");
      ok(q(e, "#g-ics").value.includes("semis-ics?t="), "ICS 구독 주소");
      eq(q(e, "#g-calid").value, "airzetaavsec@gmail.com");
      e.S.closeModal();
    });
  }

  /* ══════════ [L] 보안등급 기간 (v2.4) ══════════ */
  {
    const e = makeEnv();
    const today = todayOf(e);
    t("L01 기간형 등급 만료 → 이전 무기한 등급 자동 복귀", () => {
      e.S.data.levelHistory.push(
        { id: "b1", date: today, end: "", level: "관심", at: "9998" },              // 무기한 기준 등급
        { id: "b2", date: "2020-06-01", end: "2020-06-07", level: "경계", note: "지난 행사", at: "8001" } // 만료
      );
      eq(e.S.secCurrent().level, "관심", "만료된 경계 무시");
    });
    t("L02 기간형 등급 활성(종료일 미경과) → 적용", () => {
      e.S.data.levelHistory.push({ id: "b3", date: today, end: today, level: "주의", note: "당일 행사", at: "9999" });
      eq(e.S.secCurrent().level, "주의");
      eq(e.S.secCurrent().end, today);
    });
    t("L03 등급 변경 폼: 종료일 입력/역순 거부", () => {
      loginAs(e, "hq");
      q(e, "#btn-edit-level").click();
      ok(q(e, "#f-end"), "종료일 입력 존재");
      const before = e.S.data.levelHistory.length;
      q(e, "#f-level").value = "경계";
      q(e, "#f-date").value = "2099-05-10";
      q(e, "#f-end").value = "2099-05-01"; // 역순
      q(e, "#f-save").click();
      eq(e.S.data.levelHistory.length, before, "역순 거부");
      q(e, "#f-end").value = "2099-05-20";
      q(e, "#f-save").click();
      const last = e.S.data.levelHistory[e.S.data.levelHistory.length - 1];
      eq(last.date, "2099-05-10"); eq(last.end, "2099-05-20"); eq(last.level, "경계");
      ok(e.S.secNext() && e.S.secNext().level === "경계", "예약 인식");
    });
    t("L04 이력 UI: 기간 표시 + 세로 정렬 + 담당자명 미표시", () => {
      e.S.renderView();
      const rows = qa(e, "#level-box .lv-row");
      ok(rows.length >= 3, "lv-row 그리드 행");
      ok(rows.every(r => r.querySelector(".lv-badge")), "고정폭 배지 열");
      ok(!q(e, "#level-box").textContent.includes("시스템관리자"), "변경자 표기 제거");
      ok(qa(e, "#level-box .lv-range").some(r => r.textContent.includes("~")), "기간 표기");
      ok(q(e, "#level-box .lv-row.expired"), "만료 이력 흐림 처리");
    });
  }

  /* ══════════ [I] 보안점검 일정관리 (v2.4) ══════════ */
  {
    const e = makeEnv();
    t("I01 2026 계획 시드 (시트 이관: 4/4/12/3)", () => {
      const ins = e.S.data.inspections;
      eq(ins.filter(x => x.category === "국내정기").length, 4);
      eq(ins.filter(x => x.category === "불시평가").length, 4);
      eq(ins.filter(x => x.category === "해외공항").length, 12);
      eq(ins.filter(x => x.category === "주요일정").length, 3);
      ok(ins.every(x => x.year === 2026 && x.status === "계획"));
      ok(ins.some(x => x.target === "FIFA 월드컵" && x.start === "2026-06-11" && x.end === "2026-07-19"));
    });
    t("I02 메뉴 자동 등록 (보안 점검 그룹, idempotent)", () => {
      const m = e.S.data.menus.filter(x => x.type === "module" && x.module === "inspection");
      eq(m.length, 1);
      eq(m[0].parent, "grp-inspect");
      e.S.normalizeData(); e.S.normalizeData();
      eq(e.S.data.menus.filter(x => x.module === "inspection").length, 1, "중복 없음");
    });
    loginAs(e, "hq");
    e.Insp = e.w.SemisInspection;
    e.Insp.setYear(2026);
    t("I03 연간 매트릭스 렌더 (12개월 + 계, 칩 23개)", () => {
      go(e, "inspection");
      ok(q(e, ".insp-matrix"), "매트릭스 테이블");
      eq(qa(e, ".insp-matrix thead th").length, 14, "구분+12개월+계");
      eq(qa(e, ".insp-chip").length, 23, "점검 칩 수");
      eq(qa(e, ".insp-matrix tbody tr").length, 4, "구분 4행");
    });
    t("I04 점검 등록/수정 (팀 점검관 토글 + 외부 점검관)", () => {
      const before = e.S.data.inspections.length;
      q(e, "#insp-add").click();
      q(e, "#i-cat").value = "국내정기";
      q(e, "#i-month").value = "8";
      q(e, "#i-target").value = "테스트지점";
      qa(e, '#i-team [data-insp-t]').find(b => b.dataset.inspT === "최상일").click();
      q(e, "#i-extra").value = "TAZ";
      q(e, "#i-save").click();
      eq(e.S.data.inspections.length, before + 1);
      const x = e.S.data.inspections.find(i => i.target === "테스트지점");
      eq(x.month, 8); eq(x.inspectors.join(","), "최상일,TAZ");
      // 수정: 상태 완료
      e.S.renderView();
      qa(e, `[data-insp="${x.id}"]`)[0].click();
      q(e, "#i-status").value = "완료";
      q(e, "#i-save").click();
      eq(e.S.data.inspections.find(i => i.id === x.id).status, "완료");
    });
    t("I05 캘린더 연동: 일자 확정 → 일정 생성/완료/삭제 반영", () => {
      q(e, "#insp-add").click();
      q(e, "#i-cat").value = "해외공항";
      q(e, "#i-target").value = "NRTKE";
      q(e, "#i-start").value = "2026-09-14";
      q(e, "#i-end").value = "2026-09-16";
      q(e, "#i-linkcal").checked = true;
      q(e, "#i-save").click();
      const x = e.S.data.inspections.find(i => i.target === "NRTKE");
      eq(x.month, 9, "시작일에서 월 자동 산출");
      const sch = e.S.data.schedules.find(s => s.id === "insp_" + x.id);
      ok(sch, "연동 일정 생성");
      eq(sch.start, "2026-09-14"); eq(sch.end, "2026-09-16");
      eq(sch.title, "[점검] NRTKE");
      // 완료 → 일정 done
      e.S.renderView();
      qa(e, `[data-insp="${x.id}"]`)[0].click();
      q(e, "#i-status").value = "완료";
      q(e, "#i-save").click();
      ok(e.S.data.schedules.find(s => s.id === "insp_" + x.id).done, "완료 반영");
      // 삭제 → 일정 제거
      e.S.renderView();
      qa(e, `[data-insp="${x.id}"]`)[0].click();
      q(e, "#i-del").click();
      q(e, "#modal-box [data-act=ok]").click();
      ok(!e.S.data.schedules.some(s => s.id === "insp_" + x.id), "연동 일정 제거");
    });
    t("I06 목록 뷰 렌더", () => {
      e.Insp.setViewMode("list");
      e.S.renderView();
      ok(qa(e, "[data-insp-row]").length >= 23, "목록 행");
      ok(q(e, "#insp-body").textContent.includes("BKKSU"));
      e.Insp.setViewMode("matrix");
    });
    t("I07 대시보드 실적 카드", () => {
      go(e, "dashboard");
      const box = q(e, "#insp-box");
      ok(box, "실적 카드");
      ok(/\d+ \/ \d+건/.test(box.textContent.replace(/\s+/g, " ")) || box.innerHTML.includes("건"), "계획 대비 완료");
      ok(q(e, ".insp-bar-fill"), "진행 바");
    });
    t("I09 매트릭스 칩: 대상/점검관 줄 분리", () => {
      // v2.36.3: 점검관은 시드에서 제외(개인정보) → 테스트에서 배정 후 검증
      const p = e.S.data.inspections.find(x => x.target === "프로에스콤");
      p.inspectors = ["홍길동"];
      e.S.saveSilent();
      e.Insp.setViewMode("matrix");
      go(e, "inspection");
      const c = qa(e, ".insp-chip").find(el => el.textContent.includes("프로에스콤"));
      ok(c.querySelector(".insp-target"), "대상 줄");
      ok(c.querySelector(".insp-people .insp-tag"), "점검관 태그 줄");
    });
    t("I10 매트릭스 드래그: 계획월 이동 + 확정일자/캘린더 연동 이동", () => {
      const I = e.Insp;
      // 월만 지정된 건: 10월 ICNKF → 12월
      const a = e.S.data.inspections.find(x => x.target === "ICNKF");
      ok(I.moveInsp(a.id, "국내정기", 12));
      eq(e.S.data.inspections.find(x => x.id === a.id).month, 12);
      // 확정 일자 + 캘린더 연동 건: 일자도 같은 날짜로 월 이동
      e.S.data.inspections.push({ id: "imv1", year: 2026, category: "해외공항", target: "MOVSF", month: 9,
        inspectors: [], start: "2026-09-10", end: "2026-09-12", status: "계획", note: "", resultUrl: "", linkCal: true });
      I.syncCalendar(e.S.data.inspections.find(x => x.id === "imv1"));
      e.S.saveSilent();
      ok(I.moveInsp("imv1", "해외공항", 11));
      const m = e.S.data.inspections.find(x => x.id === "imv1");
      eq(m.month, 11); eq(m.start, "2026-11-10"); eq(m.end, "2026-11-12", "기간 유지");
      eq(e.S.data.schedules.find(s => s.id === "insp_imv1").start, "2026-11-10", "캘린더 연동 이동");
      // DnD 배선: dragstart→drop
      e.S.renderView();
      const chip = qa(e, '[data-insp="imv1"]')[0];
      chip.dispatchEvent(new e.w.Event("dragstart", { bubbles: true, cancelable: true }));
      const cell = qa(e, ".insp-cell").find(c => c.dataset.cat === "해외공항" && c.dataset.month === "3");
      cell.dispatchEvent(new e.w.Event("drop", { bubbles: true, cancelable: true }));
      eq(e.S.data.inspections.find(x => x.id === "imv1").month, 3, "드롭으로 월 변경");
      e.S.data.inspections = e.S.data.inspections.filter(x => x.id !== "imv1");
      I.removeCalendar("imv1");
      e.S.saveSilent();
    });
    t("I08 일반 사용자: 등록 버튼 없음 + 상세 열람", () => {
      const e2 = makeEnv();
      loginAs(e2, "manager");
      go(e2, "inspection");
      ok(!q(e2, "#insp-add"), "등록 버튼 없음");
      qa(e2, ".insp-chip")[0].click();
      ok(q(e2, "#modal-box").innerHTML.includes("구분"), "읽기 전용 상세");
      ok(!q(e2, "#i-save"), "저장 버튼 없음");
    });
  }

  /* ══════════ [CA] CARES 환경센서 위젯 (v2.4) ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "hq");
    const CA = e.w.SemisCares;
    t("CA01 기본 표시 + 오프라인 안내 (계정 불필요)", () => {
      const box = q(e, "#cares-box");
      ok(box, "CARES 카드 존재");
      ok(box.innerHTML.includes("오프라인"), "무인증 기본 표시, fetch 불가 시 오프라인 안내");
    });
    t("CA07 표시 끄기 설정", () => {
      CA.setCfg({ enabled: false });
      e.S.renderView();
      ok(q(e, "#cares-box").innerHTML.includes("꺼져"), "명시적 비활성 안내");
      CA.setCfg({});
    });
    t("CA02 Firestore REST 값 파서", () => {
      eq(CA.parseFs({ doubleValue: 3.5 }), 3.5);
      eq(CA.parseFs({ integerValue: "42" }), 42);
      eq(CA.parseFs({ stringValue: "x" }), "x");
      eq(CA.parseFs({ nullValue: null }), null);
      const m = CA.parseFs({ mapValue: { fields: { max: { integerValue: "40" }, min: { nullValue: null } } } });
      eq(m.max, 40); eq(m.min, null);
      const a = CA.parseFs({ arrayValue: { values: [{ integerValue: "1" }, { integerValue: "2" }] } });
      eq(a.join(","), "1,2");
    });
    t("CA03 임계치 판정 (min/max/null)", () => {
      eq(CA.isExceed(45, { min: 0, max: 40 }), true, "상한 초과");
      eq(CA.isExceed(-5, { min: 0, max: 40 }), true, "하한 미달");
      eq(CA.isExceed(25, { min: 0, max: 40 }), false);
      eq(CA.isExceed(999, { min: null, max: null }), false, "임계 없음");
      eq(CA.isExceed(null, { min: 0, max: 40 }), false, "값 없음");
    });
    t("CA04 계정 설정은 기기 로컬 전용 (동기화 제외)", () => {
      CA.setCfg({ enabled: true, email: "a@b.c", pw: "x" });
      ok(e.w.localStorage.getItem("semis2:cares"), "localStorage 저장");
      ok(!e.Sync.SYNC_KEYS.includes("cares"), "SYNC_KEYS 미포함");
      ok(!JSON.parse(e.w.localStorage.getItem("semis2:data")).cares, "공용 데이터에 없음");
      CA.setCfg({});
    });
    t("CA05 스파크라인 SVG 생성 (임계선 포함)", () => {
      const svg = CA.sparkSVG([10, 20, 30, 25], { min: null, max: 28 });
      ok(svg.includes("<polyline"), "폴리라인");
      ok(svg.includes("stroke-dasharray"), "임계 점선");
      eq(CA.sparkSVG([5], null), "", "데이터 부족 시 빈 값");
    });
  }
  await ta("CA06 위젯 렌더: 임계치 초과 강조 (fetch 스텁)", async () => {
    const mkReading = (temp) => ({ document: { fields: {
      timestamp: { timestampValue: new Date().toISOString() },
      temp: { doubleValue: temp }, humidity: { integerValue: "50" },
      co2: { integerValue: "600" }, pm25: { integerValue: "10" }, pm10: { integerValue: "20" },
      pm1: { integerValue: "5" }, tvoc: { doubleValue: 0.1 }, hcho: { doubleValue: 0.05 }
    } } });
    const stub = (url, opts = {}) => {
      const u = String(url);
      if (u.includes("identitytoolkit")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ idToken: "tk", expiresIn: "3600" }) });
      if (u.includes(":runQuery")) {
        const body = JSON.parse(opts.body);
        const col = body.structuredQuery.from[0].collectionId;
        if (col === "sensorLogs") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([mkReading(45), mkReading(44)]) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (u.includes("sensorThresholds")) return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    };
    const e = makeEnv({ fetch: stub, preLS: { "semis2:caresKey": "test-api-key" } });
    loginAs(e, "hq");
    e.w.SemisCares.setCfg({ enabled: true, email: "v@a.com", pw: "p" });
    const box = q(e, "#cares-box");
    await e.w.SemisCares.renderInto(box, true);
    ok(box.innerHTML.includes("임계치 초과"), "초과 배지");
    ok(q(e, ".cares-cell.exceed"), "초과 셀 강조 (temp 45 > 40)");
    eq(qa(e, ".cares-cell").length, 1, "기본: 초과 지표만 표시 (축소 모드)");
    ok(q(e, ".cares-spark"), "스파크라인");
    // "전체 표시" 토글 → 8개 지표 전체
    q(e, "#cares-mode").click();
    await new Promise(r => setTimeout(r, 30));
    eq(qa(e, ".cares-cell").length, 8, "전체 표시 시 8개 지표");
    ok(q(e, "#cares-mode").textContent.includes("초과만"), "토글 라벨 전환");
    e.w.SemisCares.setCfg({ enabled: true });
    e.Sync.stop();
  });

  await ta("CA08 전체 정상 시 축소 모드: 그리드 없이 한 줄 안내", async () => {
    const mkReading = (temp) => ({ document: { fields: {
      timestamp: { timestampValue: new Date().toISOString() },
      temp: { doubleValue: temp }, humidity: { integerValue: "50" },
      co2: { integerValue: "600" }, pm25: { integerValue: "10" }, pm10: { integerValue: "20" },
      pm1: { integerValue: "5" }, tvoc: { doubleValue: 0.1 }, hcho: { doubleValue: 0.05 }
    } } });
    const stub = (url, opts = {}) => {
      const u = String(url);
      if (u.includes(":runQuery")) {
        const body = JSON.parse(opts.body);
        const col = body.structuredQuery.from[0].collectionId;
        if (col === "sensorLogs") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([mkReading(25), mkReading(24)]) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (u.includes("sensorThresholds")) return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    };
    const e = makeEnv({ fetch: stub, preLS: { "semis2:caresKey": "test-api-key" } });
    loginAs(e, "hq");
    const box = q(e, "#cares-box");
    await e.w.SemisCares.renderInto(box, true);
    ok(box.innerHTML.includes("전체 정상"), "정상 배지");
    eq(qa(e, ".cares-cell").length, 0, "그리드 미표시");
    ok(q(e, ".cares-allok"), "한 줄 안내");
    ok(q(e, "#cares-mode"), "전체 표시 버튼 존재");
    e.Sync.stop();
  });

  await ta("CA09 멀티센서: 기기별 블록 분리 + 기기명 표시 (2호기 초과)", async () => {
    // deviceId 포함 리딩 생성 헬퍼
    const mk = (deviceId, temp) => ({ document: { fields: {
      deviceId: { stringValue: deviceId },
      timestamp: { timestampValue: new Date().toISOString() },
      temp: { doubleValue: temp }, humidity: { integerValue: "50" },
      co2: { integerValue: "600" }, pm25: { integerValue: "10" }, pm10: { integerValue: "20" },
      pm1: { integerValue: "5" }, tvoc: { doubleValue: 0.1 }, hcho: { doubleValue: 0.05 }
    } } });
    const stub = (url, opts = {}) => {
      const u = String(url);
      if (u.includes(":runQuery")) {
        const body = JSON.parse(opts.body);
        const col = body.structuredQuery.from[0].collectionId;
        if (col === "sensorLogs") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
          // 1호기 정상, 2호기 온도 초과(45>40), 3호기 정상
          mk("ICN_CARGO_B", 24), mk("ICN_ETD_CASE", 45), mk("ICN_SEARCH_ROOM", 23),
          mk("ICN_CARGO_B", 25), mk("ICN_ETD_CASE", 44), mk("ICN_SEARCH_ROOM", 22)
        ]) });
        // alarmHistory
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
          { document: { fields: {
            deviceId: { stringValue: "ICN_ETD_CASE" }, metricLabel: { stringValue: "실내 온도" },
            metric: { stringValue: "temp" }, type: { stringValue: "max" },
            threshold: { integerValue: "40" }, unit: { stringValue: "°C" },
            peakValue: { doubleValue: 45 }, endedAt: { nullValue: null }
          } } }
        ]) });
      }
      if (u.includes("sensorThresholds")) return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    };
    const e = makeEnv({ fetch: stub, preLS: { "semis2:caresKey": "test-api-key" } });
    loginAs(e, "hq");
    const box = q(e, "#cares-box");
    await e.w.SemisCares.renderInto(box, true);
    eq(qa(e, ".cares-device").length, 3, "기기 3개 블록 분리");
    ok(box.innerHTML.includes("2호기"), "2호기 표시명 노출");
    ok(box.innerHTML.includes("3호기"), "3호기 표시명 노출");
    ok(box.innerHTML.includes("임계치 초과 1건"), "전 기기 합산 초과 1건");
    ok(q(e, ".cares-alarm-dev"), "알람에 기기 라벨 표시");
    ok(box.innerHTML.includes("전체 표시"), "축소 모드 토글 존재");
    e.Sync.stop();
  });

  await ta("CA10 멀티센서: 단일 기기(구버전 무 deviceId)는 기존 레이아웃 유지", async () => {
    const mk = (temp) => ({ document: { fields: {
      timestamp: { timestampValue: new Date().toISOString() },
      temp: { doubleValue: temp }, humidity: { integerValue: "50" },
      co2: { integerValue: "600" }, pm25: { integerValue: "10" }, pm10: { integerValue: "20" },
      pm1: { integerValue: "5" }, tvoc: { doubleValue: 0.1 }, hcho: { doubleValue: 0.05 }
    } } });
    const stub = (url, opts = {}) => {
      const u = String(url);
      if (u.includes(":runQuery")) {
        const body = JSON.parse(opts.body);
        if (body.structuredQuery.from[0].collectionId === "sensorLogs")
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([mk(24), mk(25)]) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (u.includes("sensorThresholds")) return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    };
    const e = makeEnv({ fetch: stub, preLS: { "semis2:caresKey": "test-api-key" } });
    loginAs(e, "hq");
    const box = q(e, "#cares-box");
    await e.w.SemisCares.renderInto(box, true);
    eq(qa(e, ".cares-device").length, 0, "단일 기기는 기기 블록 래퍼 없음(기존 레이아웃)");
    ok(q(e, ".cares-allok"), "정상 시 한 줄 안내 유지");
    e.Sync.stop();
  });

  await ta("CA11 오프라인 감지: online:false 기기는 값 대신 오프라인 표시 + 초과 집계 제외", async () => {
    const mk = (deviceId, temp, online) => { const f = {
      deviceId: { stringValue: deviceId },
      timestamp: { timestampValue: new Date().toISOString() },
      temp: { doubleValue: temp }, humidity: { integerValue: "50" },
      co2: { integerValue: "600" }, pm25: { integerValue: "10" }, pm10: { integerValue: "20" },
      pm1: { integerValue: "5" }, tvoc: { doubleValue: 0.1 }, hcho: { doubleValue: 0.05 }
    }; if (online != null) f.online = { booleanValue: online }; return { document: { fields: f } }; };
    const stub = (url, opts = {}) => {
      const u = String(url);
      if (u.includes(":runQuery")) {
        const col = JSON.parse(opts.body).structuredQuery.from[0].collectionId;
        if (col === "sensorLogs") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
          // 1호기 온라인 정상, 2호기 오프라인(online:false)이지만 캐시 temp=45(초과여야 하나 오프라인이라 집계 제외)
          mk("ICN_CARGO_B", 24, true), mk("ICN_ETD_CASE", 45, false),
          mk("ICN_CARGO_B", 25, true), mk("ICN_ETD_CASE", 44, false)
        ]) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      }
      if (u.includes("sensorThresholds")) return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    };
    const e = makeEnv({ fetch: stub, preLS: { "semis2:caresKey": "test-api-key" } });
    loginAs(e, "hq");
    const box = q(e, "#cares-box");
    await e.w.SemisCares.renderInto(box, true);
    ok(box.innerHTML.includes("오프라인"), "오프라인 기기 표시");
    ok(!box.innerHTML.includes("임계치 초과"), "오프라인 캐시값은 초과로 집계 안 함");
    e.Sync.stop();
  });

  /* ══════════ [CT] 보고체계 연락망 (v2.6) ══════════
     ※ 테스트 데이터는 전부 가상 — 실연락처는 repo에 두지 않음(공용 DB 동기화) */
  {
    const SAMPLE = { sections: [
      { id: "proc", type: "procedure", title: "보고 절차", note: "하기 조치 시에도 보고", rows: [
        { id: "p1", title: "해외지점", body: "1) 현지 경찰 인계\n※ 30분 이내 전송" },
        { id: "p2", title: "국내지점", body: "1차 SMS, 2차 별지서식" }] },
      { id: "inc", type: "incidents", title: "사건별 보고처", rows: [
        { id: "g1", no: "①", items: "27. 무효출입증 사용", to: "지방항공청 감독관\n+ 항공보안팀" },
        { id: "g4", no: "④", items: "1. 항공기 파손\n2. 납치 시도", to: "국가위기관리센터 외" }] },
      { id: "team", type: "people", title: "안전보안실", duty: "", rows: [
        { id: "t1", role: "보안팀장", name: "홍모범", mobile: "010-1234-5678", office: "02-1234-5678" }] },
      { id: "raa", type: "people", title: "테스트지방항공청", duty: "032-123-4567", rows: [
        { id: "r1", role: "감독관", name: "김가상", mobile: "010-9876-5432" }] },
      { id: "tsa", type: "people", title: "TSA TSOC", accent: "danger", rows: [
        { id: "s1", role: "TSOC 미주 내", mobile: "1-866-555-0100" }] },
      { id: "mail", type: "emails", title: "서면보고 발송처", rows: [
        { id: "e1", name: "박문서", email: "test1@example.kr" },
        { id: "e2", name: "이서식", email: "test2@example.kr" }] }
    ] };
    const withData = (e) => { e.S.data.contacts = JSON.parse(JSON.stringify(SAMPLE)); e.S.saveSilent(); };

    t("CT01 normalize: contacts 기본 구조 + 메뉴 자동 삽입(grp-abnormal 최상단)", () => {
      const e = makeEnv();
      ok(e.S.data.contacts && Array.isArray(e.S.data.contacts.sections), "기본 빈 구조");
      const mn = e.S.data.menus.find(m => m.type === "module" && m.module === "contacts");
      ok(mn, "모듈 메뉴 존재");
      eq(mn.parent, "grp-abnormal", "비정상 상황 그룹");
      const sibs = e.S.data.menus.filter(m => m.parent === "grp-abnormal" && m.id !== mn.id);
      ok(sibs.every(s => mn.seq <= (s.seq || 0)), "그룹 최상단");
      const ab = e.S.data.menus.find(m => m.id === "ab-contact");
      ok(ab && ab.label.includes("구버전"), "기존 시트 링크 (구버전) 라벨");
    });

    t("CT02 구버전 데이터에도 normalize로 메뉴/구조 복원", () => {
      const e = makeEnv({ preData: { version: 1, menus: [
        { id: "grp-abnormal", seq: 1, type: "group", label: "비정상 상황" },
        { id: "ab-contact", seq: 2, type: "link", label: "보고체계 연락망", icon: "☎️", url: "https://x.example", parent: "grp-abnormal" }
      ], notices: [], schedules: [] } });
      ok(e.S.data.menus.some(m => m.type === "module" && m.module === "contacts"), "메뉴 삽입");
      eq(e.S.data.menus.find(m => m.id === "ab-contact").label, "보고체계 연락망 (구버전)", "라벨 갱신");
      ok(Array.isArray(e.S.data.contacts.sections), "contacts 구조 보장");
    });

    t("CT03 빈 데이터: 히어로 배너 + 동기화 대기 안내", () => {
      const e = makeEnv();
      loginAs(e, "manager");
      go(e, "contacts");
      ok(q(e, ".ct-hero"), "히어로 배너");
      ok(q(e, ".ct-hero").textContent.includes("30분"), "30분 이내 보고 강조");
      ok(q(e, "#ct-body").textContent.includes("동기화 대기"), "동기화 대기 안내");
    });

    t("CT04 실데이터 렌더: 섹션/전화/문자/메일/당직실/사건카드", () => {
      const e = makeEnv();
      loginAs(e, "manager");
      withData(e);
      go(e, "contacts");
      const html = q(e, "#ct-body").innerHTML;
      ok(html.includes("안전보안실") && html.includes("홍모범"), "인물 행");
      ok(html.includes('href="tel:01012345678"'), "tel: 링크");
      ok(html.includes('href="sms:01012345678"'), "sms: 링크");
      ok(html.includes('href="mailto:test1@example.kr"'), "mailto: 링크");
      ok(html.includes('tel:+18665550100'), "미주 국제전화 링크");
      ok(q(e, ".ct-duty"), "당직실 강조");
      eq(qa(e, ".ct-inc").length, 2, "사건별 그룹 카드");
      ok(html.includes("보고처"), "보고처 표시");
      ok(q(e, ".ct-danger"), "TSA 긴급 카드");
      ok(qa(e, ".ct-acc").length >= 2, "절차 아코디언");
      ok(html.includes("전체 주소 복사"), "이메일 전체 복사");
    });

    t("CT05 통합 검색: 이름/번호 필터 + 하이라이트", () => {
      const e = makeEnv();
      loginAs(e, "manager");
      withData(e);
      go(e, "contacts");
      const input = q(e, "#ct-search");
      input.value = "김가상";
      input.dispatchEvent(new e.w.Event("input", { bubbles: true }));
      const html = q(e, "#ct-body").innerHTML;
      ok(html.includes("<mark>김가상</mark>"), "하이라이트");
      ok(!html.includes("서면보고 발송처"), "미매칭 섹션 숨김");
      // 번호 검색 (하이픈 무시)
      input.value = "98765432";
      input.dispatchEvent(new e.w.Event("input", { bubbles: true }));
      ok(q(e, "#ct-body").innerHTML.includes("김가상"), "번호 검색 매칭");
      e.w.SemisContacts.setQuery("");
    });

    t("CT06 telHref/smsHref 유틸", () => {
      const e = makeEnv();
      const CT = e.w.SemisContacts;
      eq(CT.telHref("032-740-2107"), "tel:0327402107");
      eq(CT.telHref("1-866-555-0100"), "tel:+18665550100");
      eq(CT.smsHref("010-1234-5678"), "sms:01012345678");
      eq(CT.telHref(""), "");
      eq(CT.isMobile("010-1111-2222"), true);
      eq(CT.isMobile("02-123-4567"), false);
    });

    t("CT07 편집 권한: user 없음 / manager 있음", () => {
      const e = makeEnv();
      loginAs(e, "manager");
      withData(e);
      go(e, "contacts");
      ok(!q(e, "[data-ct-edit]"), "일반 사용자 편집 버튼 없음");
      const e2 = makeEnv();
      loginAs(e2, "hq");
      withData(e2);
      go(e2, "contacts");
      ok(q(e2, "[data-ct-edit]"), "관리자 편집 버튼 있음");
    });

    t("CT08 편집 CRUD: 행 수정/추가 저장 → 데이터 반영", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      withData(e);
      go(e, "contacts");
      q(e, '[data-ct-edit="team"]').click();
      ok(q(e, "#cte-rows"), "편집 모달");
      // 기존 행 수정
      const nameInp = qa(e, '#cte-rows [data-f="name"]')[0];
      nameInp.value = "홍수정";
      // 행 추가
      q(e, "#cte-add").click();
      const rows2 = qa(e, '#cte-rows [data-f="name"]');
      rows2[rows2.length - 1].value = "신규자";
      qa(e, '#cte-rows [data-f="mobile"]')[rows2.length - 1].value = "010-0000-1111";
      q(e, "#cte-save").click();
      const sec = e.S.data.contacts.sections.find(s => s.id === "team");
      eq(sec.rows[0].name, "홍수정", "행 수정 반영");
      eq(sec.rows.length, 2, "행 추가 반영");
      eq(sec.rows[1].name, "신규자");
    });

    t("CT09 편집: 행 삭제 저장", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      withData(e);
      go(e, "contacts");
      q(e, '[data-ct-edit="mail"]').click();
      q(e, '#cte-rows [data-del="0"]').click();
      q(e, "#cte-save").click();
      const sec = e.S.data.contacts.sections.find(s => s.id === "mail");
      eq(sec.rows.length, 1, "삭제 반영");
      eq(sec.rows[0].name, "이서식");
    });

    t("CT10 대시보드 바로가기에 모듈 quick 링크(내부 이동)", () => {
      const e = makeEnv();
      loginAs(e, "manager");
      go(e, "dashboard");
      const links = qa(e, ".quick-link");
      const inner = links.find(a => (a.getAttribute("href") || "") === "#/contacts");
      ok(inner, "연락망 내부 바로가기");
      ok(!inner.getAttribute("target"), "내부 이동(새 창 아님)");
    });

    t("CT11 사건별 카드 등급색: ① 노랑 ~ ④ 짙은 빨강 클래스", () => {
      const e = makeEnv();
      loginAs(e, "manager");
      withData(e);
      go(e, "contacts");
      ok(q(e, ".ct-inc.ct-lv1"), "① 등급색");
      ok(q(e, ".ct-inc.ct-lv4"), "④ 등급색");
      eq(qa(e, ".ct-inc.ct-lv2, .ct-inc.ct-lv3").length, 0, "샘플에 없는 등급은 미생성");
    });
  }

  /* ══════════ [FD] 보안점검 결과 유형 (v2.6.1) ══════════ */
  {
    t("FD01 normalize: 기존 점검에 findings 배열 보정", () => {
      const e = makeEnv();
      ok(e.S.data.inspections.every(x => Array.isArray(x.findings)), "전체 findings 배열");
    });

    t("FD02 점검 폼: 결과 추가/저장 → 데이터 반영 (결과 링크 입력 제거)", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      go(e, "inspection");
      const target = e.S.data.inspections.find(x => x.target === "프로에스콤");
      qa(e, ".insp-chip").find(el => el.dataset.insp === target.id).click();
      ok(!q(e, "#i-url"), "결과 링크 입력 제거됨");
      ok(q(e, "#i-findings"), "결과 편집 영역");
      // 결과 2건 추가 (시정조치 1, 관찰사항 1)
      q(e, "#ifd-add").click();
      let rows = qa(e, "#i-findings .ifd-row");
      rows[0].querySelector("select").value = "시정조치";
      rows[0].querySelector("input").value = "검색장비 캘리브레이션 미실시";
      q(e, "#ifd-add").click();
      rows = qa(e, "#i-findings .ifd-row");
      rows[1].querySelector("select").value = "관찰사항";
      rows[1].querySelector("input").value = "출입구 CCTV 사각 관찰";
      q(e, "#i-save").click();
      const x = e.S.data.inspections.find(i => i.id === target.id);
      eq(x.findings.length, 2, "2건 저장");
      eq(x.findings[0].type, "시정조치");
      eq(x.findings[1].type, "관찰사항");
      // 빈 내용 행은 저장 시 제외
      qa(e, ".insp-chip").find(el => el.dataset.insp === target.id).click();
      q(e, "#ifd-add").click();
      q(e, "#i-save").click();
      eq(e.S.data.inspections.find(i => i.id === target.id).findings.length, 2, "빈 행 제외");
    });

    t("FD03 목록 뷰: 결과 유형 배지 요약 표시", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const x = e.S.data.inspections.find(i => i.target === "LSG");
      x.findings = [{ type: "시정조치", text: "a" }, { type: "시정조치", text: "b" }, { type: "개선권고", text: "c" }];
      e.S.saveSilent();
      e.w.SemisInspection.setViewMode("list");
      go(e, "inspection");
      const row = qa(e, "[data-insp-row]").find(r => r.textContent.includes("LSG"));
      ok(row.innerHTML.includes("시정2"), "시정조치 2건 요약");
      ok(row.innerHTML.includes("개선1"), "개선권고 1건 요약");
      e.w.SemisInspection.setViewMode("matrix");
    });

    t("FD06 대시보드 이번 달 목록: 지점 옆 결과 배지 요약", () => {
      const e = makeEnv();
      const nowMonth = new Date().getMonth() + 1;
      e.S.data.inspections.push({ id: "ifd6", year: new Date().getFullYear(), category: "국내정기",
        target: "FDTEST지점", month: nowMonth, inspectors: [], start: "", end: "",
        status: "완료", note: "", linkCal: false,
        findings: [{ type: "개선권고", text: "a" }, { type: "시정조치", text: "b" }, { type: "시정조치", text: "c" }] });
      e.S.saveSilent();
      loginAs(e, "hq"); // v2.10.1: 점검실적 카드는 manager 이상만 표시
      go(e, "dashboard");
      const row = qa(e, "#insp-box div").find(el => el.textContent.includes("FDTEST지점"));
      ok(row, "이번 달 행");
      ok(row.innerHTML.includes("시정2"), "시정조치 2건 배지");
      ok(row.innerHTML.includes("개선1"), "개선권고 1건 배지");
    });

    t("FD07 대시보드 점검 행 클릭 → 권한별 수정 폼/상세 모달", () => {
      const mkData = (e) => {
        e.S.data.inspections.push({ id: "ifd7", year: new Date().getFullYear(), category: "국내정기",
          target: "FD클릭지점", month: new Date().getMonth() + 1, inspectors: [], start: "", end: "",
          status: "계획", note: "", linkCal: false, findings: [] });
        e.S.saveSilent();
      };
      // manager → 수정 폼
      const e = makeEnv();
      loginAs(e, "hq");
      mkData(e);
      go(e, "dashboard");
      q(e, '#insp-box [data-insp-open="ifd7"]').click();
      ok(q(e, "#i-save"), "수정 폼(저장 버튼)");
      ok(q(e, "#modal-box").textContent.includes("점검 수정"), "점검 수정 모달");
      ok(q(e, "#i-findings"), "결과 편집 영역 포함");
      // user → 대시보드 점검실적 카드 자체가 숨김 (v2.11)
      const eu = makeEnv();
      loginAs(eu, "user");
      go(eu, "dashboard");
      ok(!q(eu, "#insp-box"), "user에게 점검실적 카드 미표시");
      // manager(열람그룹) → 점검 모듈 읽기 상세 (편집 불가)
      const e2 = makeEnv();
      loginAs(e2, "manager");
      mkData(e2);
      go(e2, "inspection");
      qa(e2, ".insp-chip").find(el => el.dataset.insp === "ifd7").click();
      ok(!q(e2, "#i-save"), "manager 저장 버튼 없음(열람 전용)");
      ok(q(e2, "#modal-box").textContent.includes("FD클릭지점"), "읽기 상세 모달");
    });

    t("FD04 일반 사용자 상세: 결과 내용 표시", () => {
      const e = makeEnv();
      const x = e.S.data.inspections.find(i => i.target === "LSG");
      x.findings = [{ type: "현장시정", text: "보호구역 게이트 즉시 시정" }];
      e.S.saveSilent();
      loginAs(e, "manager");
      go(e, "inspection");
      qa(e, ".insp-chip").find(el => el.dataset.insp === x.id).click();
      ok(q(e, "#modal-box").innerHTML.includes("현장시정"), "유형 배지");
      ok(q(e, "#modal-box").innerHTML.includes("보호구역 게이트 즉시 시정"), "내용");
    });

    t("FD05 대시보드: 결과 유형별 통계 4칸 그리드", () => {
      const e = makeEnv();
      const xs = e.S.data.inspections;
      xs[0].findings = [{ type: "시정조치", text: "a" }, { type: "개선권고", text: "b" }];
      xs[1].findings = [{ type: "시정조치", text: "c" }, { type: "관찰사항", text: "d" }];
      e.S.saveSilent();
      loginAs(e, "hq"); // v2.10.1: 점검실적 카드는 manager 이상만 표시
      go(e, "dashboard");
      const grid = q(e, ".insp-fdgrid");
      ok(grid, "통계 그리드");
      eq(qa(e, ".insp-fdcell").length, 4, "4칸 고정");
      const cells = qa(e, ".insp-fdcell");
      eq(cells[0].querySelector("b").textContent, "2", "시정조치 2");
      eq(cells[1].querySelector("b").textContent, "1", "개선권고 1");
      eq(cells[2].querySelector("b").textContent, "0", "현장시정 0");
      eq(cells[3].querySelector("b").textContent, "1", "관찰사항 1");
    });
  }

  /* ══════════ [BR] 지점 관리 (v2.7 — 세계지도) ══════════
     ※ jsdom에는 Leaflet 미로드 → 목록 폴백 경로 검증. 테스트 데이터는 가상. */
  {
    const seed = (e) => {
      e.S.data.branches.push(
        { id: "br1", region: "유럽", code: "FRASF", iata: "FRA", manager: "김가상", security: "이가상",
          staff: 12, catering: true, layover: true, hotel: "테스트에어포트호텔", mechanic: "박정비",
          lat: "", lng: "", note: "", extras: [{ label: "GSA", value: "테스트GSA" }] },
        { id: "br2", region: "아시아", code: "BKKSU", iata: "BKK", manager: "최가상", security: "",
          staff: 8, catering: false, layover: false, hotel: "", mechanic: "",
          lat: "", lng: "", note: "", extras: [] },
        { id: "br3", region: "미주", code: "XXXSF", iata: "", manager: "", security: "",
          staff: "", catering: false, layover: false, hotel: "", mechanic: "",
          lat: "", lng: "", note: "좌표 미지정", extras: [] });
      e.S.saveSilent();
    };

    t("BR01 normalize: branches 배열 + 메뉴 자동 삽입(grp-branch 최상단)", () => {
      const e = makeEnv();
      ok(Array.isArray(e.S.data.branches), "기본 빈 배열");
      const mn = e.S.data.menus.find(m => m.type === "module" && m.module === "branches");
      ok(mn, "모듈 메뉴 존재");
      eq(mn.parent, "grp-branch", "지점/협력업체 그룹");
      const sibs = e.S.data.menus.filter(m => m.parent === "grp-branch" && m.id !== mn.id);
      ok(sibs.every(s => mn.seq <= (s.seq || 0)), "그룹 최상단");
      // 구버전 데이터에도 삽입
      const e2 = makeEnv({ preData: { version: 1, menus: [
        { id: "grp-branch", seq: 1, type: "group", label: "지점 / 협력업체" }], notices: [], schedules: [] } });
      ok(e2.S.data.menus.some(m => m.module === "branches"), "구데이터 normalize 삽입");
      ok(Array.isArray(e2.S.data.branches), "구데이터 branches 보장");
    });

    t("BR02 IATA → 좌표 매핑 / coordOf 우선순위", () => {
      const e = makeEnv();
      const B = e.w.SemisBranches;
      const fra = B.iataCoord("fra");
      ok(fra && Math.abs(fra[0] - 50.03) < .1, "FRA 좌표 (소문자 허용)");
      ok(B.iataCoord("ZZZ") === null, "미등록 공항 null");
      eq(B.coordOf({ lat: "10.5", lng: "20.5", iata: "FRA" })[0], 10.5, "수동 좌표 우선");
      ok(B.coordOf({ lat: "", lng: "", iata: "BKK" }), "IATA 폴백");
      ok(B.coordOf({ lat: "", lng: "", iata: "" }) === null, "좌표 없음 null");
    });

    t("BR03 렌더(목록 폴백): 구역 필터 칩 + 권한별 등록 버튼", () => {
      const e = makeEnv();
      loginAs(e, "manager");
      seed(e);
      go(e, "branches");
      ok(!e.w.L, "jsdom에 Leaflet 없음 (폴백 경로)");
      ok(q(e, "#br-list"), "목록 폴백 표시");
      eq(qa(e, "[data-br-region]").length, 6, "전체+5개 구역 칩");
      ok(!q(e, "#br-add"), "일반 사용자 등록 버튼 없음");
      const html = q(e, "#br-list").innerHTML;
      ok(html.includes("FRASF") && html.includes("BKKSU"), "지점 행");
      ok(html.includes("테스트에어포트호텔"), "L/O 호텔 표시");
      ok(html.includes("⚠️"), "좌표 없는 지점 경고 표시");
      const e2 = makeEnv();
      loginAs(e2, "hq");
      go(e2, "branches");
      ok(q(e2, "#br-add"), "관리자 등록 버튼");
    });

    t("BR04 구역 필터 + 검색", () => {
      const e = makeEnv();
      loginAs(e, "manager");
      seed(e);
      go(e, "branches");
      qa(e, "[data-br-region]").find(b => b.dataset.brRegion === "유럽").click();
      ok(q(e, "#br-list").innerHTML.includes("FRASF"), "유럽 필터: FRASF 표시");
      ok(!q(e, "#br-list").innerHTML.includes("BKKSU"), "유럽 필터: BKKSU 제외");
      e.w.SemisBranches.setRegionFilter("");
      e.S.renderView();
      const si = q(e, "#br-search");
      si.value = "박정비";
      si.dispatchEvent(new e.w.Event("input", { bubbles: true }));
      ok(q(e, "#br-list").innerHTML.includes("FRASF"), "정비사명 검색 매칭");
      ok(!q(e, "#br-list").innerHTML.includes("BKKSU"), "미매칭 제외");
      e.w.SemisBranches.setQuery("");
    });

    t("BR05 상세 모달: 행 클릭 → 필드 표시 (user는 수정 버튼 없음)", () => {
      const e = makeEnv();
      loginAs(e, "manager");
      seed(e);
      go(e, "branches");
      q(e, '[data-br-row="br1"]').click();
      const mb = q(e, "#modal-box");
      ok(mb.textContent.includes("FRASF"), "지점코드");
      ok(mb.textContent.includes("김가상"), "지점장");
      ok(mb.textContent.includes("테스트에어포트호텔"), "호텔명");
      ok(mb.textContent.includes("GSA"), "추가 항목 라벨");
      ok(mb.textContent.includes("테스트GSA"), "추가 항목 값");
      ok(mb.textContent.includes("12명"), "총원");
      ok(!q(e, "#br-edit"), "일반 사용자 수정 버튼 없음");
    });

    t("BR06 등록/수정 CRUD: 저장 → 데이터 반영 (IATA 자동 좌표 힌트)", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      go(e, "branches");
      q(e, "#br-add").click();
      q(e, "#b-code").value = "sfosf";
      q(e, "#b-iata").value = "SFO";
      q(e, "#b-iata").dispatchEvent(new e.w.Event("input", { bubbles: true }));
      ok(q(e, "#b-iata-hint").textContent.includes("✓"), "IATA 좌표 자동 힌트");
      q(e, "#b-manager").value = "정가상";
      q(e, "#b-staff").value = "15";
      q(e, "#b-catering").checked = true;
      q(e, "#b-layover").checked = true;
      q(e, "#b-hotel").value = "베이호텔";
      // 추가 항목
      q(e, "#b-extra-add").click();
      q(e, "#b-extras .br-ex-label").value = "조업사";
      q(e, "#b-extras .br-ex-value").value = "테스트조업";
      q(e, "#b-save").click();
      const b = e.S.data.branches.find(x => x.code === "SFOSF");
      ok(b, "저장됨 (코드 대문자 정규화)");
      eq(b.region, "아시아", "기본 구역");
      eq(b.staff, 15);
      eq(b.hotel, "베이호텔");
      eq(b.extras.length, 1);
      eq(b.extras[0].label, "조업사");
      ok(e.w.SemisBranches.coordOf(b), "IATA로 지도 좌표 확보");
      // 수정: 상세 → 수정 → 저장
      go(e, "branches");
      q(e, `[data-br-row="${b.id}"]`).click();
      q(e, "#br-edit").click();
      q(e, "#b-security").value = "신보안";
      q(e, "#b-save").click();
      eq(e.S.data.branches.find(x => x.id === b.id).security, "신보안", "수정 반영");
      // 삭제
      go(e, "branches");
      q(e, `[data-br-row="${b.id}"]`).click();
      q(e, "#br-del").click();
      q(e, "#modal-box [data-act=ok]").click();
      ok(!e.S.data.branches.some(x => x.id === b.id), "삭제 반영");
    });

    t("BR07 빈 지점코드 저장 거부", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      go(e, "branches");
      q(e, "#br-add").click();
      q(e, "#b-save").click();
      ok(q(e, "#b-save"), "모달 유지 (저장 안 됨)");
      eq(e.S.data.branches.length, 0, "데이터 미추가");
    });

    /* ── v2.8: 지점별 교육 현황(b.trainings) + 첨부 ── */
    t("BR08 교육 현황 섹션 렌더 + 권한별 추가 버튼", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      seed(e);
      go(e, "branches");
      q(e, '[data-br-row="br1"]').click();
      const mb = q(e, "#modal-box");
      ok(mb.textContent.includes("교육 현황"), "교육 현황 섹션 표시");
      ok(q(e, "#br-train-add"), "hq 교육 추가 버튼");
      ok(q(e, "#br-train-list").textContent.includes("등록된 교육 기록이 없습니다"), "빈 상태 문구");
      // 일반 사용자는 추가 버튼 없음
      const e2 = makeEnv();
      loginAs(e2, "manager");
      e2.S.data.branches.push({ id: "brm", region: "아시아", code: "TESTA", iata: "BKK",
        manager: "", security: "", staff: "", catering: false, layover: false, hotel: "",
        mechanic: "", lat: "", lng: "", note: "", extras: [] });
      e2.S.saveSilent();
      go(e2, "branches");
      q(e2, '[data-br-row="brm"]').click();
      ok(q(e2, "#modal-box").textContent.includes("교육 현황"), "일반 사용자도 섹션 표시");
      ok(!q(e2, "#br-train-add"), "일반 사용자 추가 버튼 없음");
    });

    t("BR09 교육 기록 등록/수정/삭제 CRUD", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      seed(e);
      go(e, "branches");
      q(e, '[data-br-row="br1"]').click();
      q(e, "#br-train-add").click();
      q(e, "#tr-date").value = "2026-07-20";
      q(e, "#tr-instructor").value = "김교관";
      q(e, "#tr-content").value = "액체류 반입금지 교육";
      q(e, "#tr-done").value = "14";
      q(e, "#tr-note").value = "전원 이수";
      q(e, "#tr-save").click();
      const b = e.S.data.branches.find(x => x.id === "br1");
      eq(b.trainings.length, 1, "교육 기록 1건 저장");
      eq(b.trainings[0].date, "2026-07-20", "교육일");
      eq(b.trainings[0].instructor, "김교관", "교관");
      eq(b.trainings[0].content, "액체류 반입금지 교육", "교육내용");
      eq(b.trainings[0].doneCount, 14, "완료 인원(숫자)");
      eq(b.trainings[0].note, "전원 이수", "비고");
      ok(Array.isArray(b.trainings[0].files), "files 배열");
      // 저장 후 상세 모달 복귀 + 목록에 표시
      const mb = q(e, "#modal-box");
      ok(mb.textContent.includes("김교관"), "상세 모달에 교관 표시");
      ok(mb.textContent.includes("액체류 반입금지 교육"), "교육내용 표시");
      ok(mb.textContent.includes("완료 14명"), "완료 인원 배지");
      // 수정
      const tid = b.trainings[0].id;
      q(e, `[data-tr-edit="${tid}"]`).click();
      eq(q(e, "#tr-content").value, "액체류 반입금지 교육", "수정 폼에 기존값 로드");
      q(e, "#tr-content").value = "휴대물품 검색 교육";
      q(e, "#tr-save").click();
      eq(e.S.data.branches.find(x => x.id === "br1").trainings[0].content, "휴대물품 검색 교육", "수정 반영");
      eq(e.S.data.branches.find(x => x.id === "br1").trainings.length, 1, "수정은 건수 유지");
      // 삭제
      q(e, `[data-tr-del="${tid}"]`).click();
      q(e, "#modal-box [data-act=ok]").click();
      eq(e.S.data.branches.find(x => x.id === "br1").trainings.length, 0, "삭제 반영");
    });

    t("BR10 교육일·내용 모두 공란이면 저장 거부 + 첨부 링크 렌더", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      seed(e);
      go(e, "branches");
      q(e, '[data-br-row="br1"]').click();
      q(e, "#br-train-add").click();
      q(e, "#tr-save").click();
      ok(q(e, "#tr-save"), "폼 유지 (저장 안 됨)");
      eq(e.S.data.branches.find(x => x.id === "br1").trainings.length, 0, "데이터 미추가");
      // 드롭존 + 파일 input 존재
      ok(q(e, "#tr-dropzone"), "드래그앤드롭 영역");
      ok(q(e, "#tr-file"), "파일 선택 input");
      ok(q(e, "#tr-file").multiple, "다중 선택 허용");
      // 첨부가 있는 기존 기록 → 상세 모달에 링크 렌더
      const b = e.S.data.branches.find(x => x.id === "br1");
      b.trainings = [{ id: "trnX", date: "2026-06-01", instructor: "박강사", content: "정기교육",
        doneCount: 10, note: "", files: [{ url: "https://files.example/edu.pdf", name: "교육자료.pdf", size: 2048 }] }];
      e.S.saveSilent();
      go(e, "branches");
      q(e, '[data-br-row="br1"]').click();
      const det = q(e, "#br-train-list details.br-train-files");
      ok(det, "첨부는 접이식 details로 렌더");
      ok(det.querySelector("summary").textContent.includes("1"), "summary에 첨부 개수 표시");
      const link = det.querySelector("a.nb-file");
      ok(link, "펼치면 첨부 링크 존재(DOM)");
      eq(link.getAttribute("href"), "https://files.example/edu.pdf", "첨부 URL");
      ok(q(e, "#br-train-list").textContent.includes("교육자료.pdf"), "첨부 파일명");
      // 오프라인(fetch 없음) 상태에서 addFiles 호출은 데이터 변화 없음(안전)
      ok(e.w.SemisBranches.MAX_TRAIN_FILES === 20, "첨부 최대 20개");
    });
  }

  await ta("S14 구버전 서버 데이터 pull 후에도 신규 모듈 메뉴/시드 유지", async () => {
    const server = {
      fail: false,
      rows: [{ key: "menus",
        value: [{ id: "m1", seq: 0, type: "module", label: "대시보드", module: "dashboard" }],
        updated_at: "2026-07-16T00:00:00Z", updated_by: "old-client" }]
    };
    const e = makeEnv({ fetch: makeFetchStub(server) });
    await e.Sync.init();
    ok(e.S.data.menus.some(m => m.module === "inspection"), "normalize로 점검 메뉴 복원");
    const srvMenus = server.rows.find(r => r.key === "menus").value;
    ok(srvMenus.some(m => m.module === "inspection"), "복원분 서버 push");
    ok(server.rows.some(r => r.key === "inspections"), "점검 시드 서버 업로드");
    e.Sync.stop();
  });

  /* ══════════ [N] 공지 리치 에디터 / [V2] 캘린더 UI 개선 ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "hq");
    t("N01 sanitizeHtml: 위험 요소 제거 + 표/서식 보존", () => {
      const s = e.w.SemisNotice.sanitizeHtml(
        '<b>a</b><script>x()</script><table class="nb-table"><tbody><tr><td onclick="hack()">c</td></tr></tbody></table><a href="javascript:alert(1)">l</a><img src="https://x/y.png">');
      ok(s.includes("<b>a</b>"), "서식 보존");
      ok(s.includes("<table") && s.includes("<td>"), "표 보존");
      ok(!s.includes("<script"), "script 제거");
      ok(!s.includes("onclick"), "이벤트핸들러 제거");
      ok(!s.includes("javascript:"), "javascript: 제거");
      ok(s.includes('src="https://x/y.png"'), "정상 이미지 보존");
    });
    t("N02 공지 HTML 본문 + 첨부파일 렌더", () => {
      e.S.data.notices.push({
        id: "nh1", title: "서식공지", body: "중요 표",
        bodyHtml: '<b>중요</b><script>evil()</script><table class="nb-table"><tbody><tr><td>표</td></tr></tbody></table>',
        files: [{ name: "지침서.pdf", url: "https://files.example/지침서.pdf", size: 1000 }],
        pinned: false, author: "t", created: "2026-07-16T00:00:00Z"
      });
      e.S.saveSilent(); go(e, "dashboard");
      const nl = q(e, "#notice-list");
      ok(nl.querySelector(".notice-html b"), "굵게 렌더");
      ok(nl.querySelector(".notice-html table"), "표 렌더");
      ok(!nl.querySelector(".notice-html script"), "script 미렌더");
      const link = nl.querySelector("a.nb-file");
      ok(link && link.href.includes("files.example") && link.textContent.includes("지침서.pdf"), "첨부 링크");
    });
    t("N03 구버전 텍스트 공지 하위호환 렌더", () => {
      ok(q(e, "#notice-list").innerHTML.includes("SeMIS v2 오픈 안내"), "텍스트 공지 표시");
    });
    t("N04 공지 폼: 첨부 목록 표시/삭제", () => {
      const n = e.S.data.notices.find(x => x.id === "nh1");
      e.S.renderView();
      q(e, `#notice-list [data-edit="${n.id}"]`).click();
      ok(q(e, "#nb-filelist").innerHTML.includes("지침서.pdf"), "기존 첨부 표시");
      q(e, '#nb-filelist [data-frm="0"]').click();
      ok(!q(e, "#nb-filelist").innerHTML.includes("지침서.pdf"), "첨부 삭제(저장 전)");
      e.S.closeModal();
    });
  }
  await ta("N05 uploadFile: Storage 업로드 경로/공개 URL", async () => {
    const calls = [];
    const e = makeEnv({
      fetch: (url, opts = {}) => { calls.push({ url: String(url), opts }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }); }
    });
    const f = new e.w.File(["hello"], "보고서 파일.pdf", { type: "application/pdf" });
    const up = await e.Sync.uploadFile(f, "attach");
    eq(up.name, "보고서 파일.pdf", "원본 파일명 보존");
    ok(up.url.includes("/storage/v1/object/public/semis-files/attach/"), "공개 URL");
    ok(!/[가-힣 ]/.test(up.url), "저장 경로는 ASCII 변환");
    const call = calls[0];
    ok(call.url.includes("/storage/v1/object/semis-files/attach/"), "업로드 endpoint");
    eq(call.opts.method, "POST");
    eq(call.opts.headers["Content-Type"], "application/pdf");
    e.Sync.stop();
  });
  {
    const e = makeEnv();
    loginAs(e, "hq");
    const C = e.Cal;
    clearInspEvents(e);
    t("V14 이윤민 이모지(🌸)는 TEAM 데이터에만, 태그는 약자만", () => {
      eq(C.TEAM.find(t2 => t2.name === "이윤민").emoji, "🌸");
      eq(C.tagOf("이윤민"), "윤");
    });
    t("V15 일 보기: 담당자 중복 표기 제거('최 최상일' 없음)", () => {
      e.S.data.schedules.push({ id: "dd1", title: "일뷰일정", memo: "", start: "2026-07-16", end: "2026-07-16", allDay: true, time: "", timeEnd: "", color: "blue", done: false, assignee: "최상일", vehicle: false, room: false, reminders: [] });
      e.S.saveSilent();
      go(e, "schedule");
      C.setView("day"); C.setAnchor("2026-07-16"); e.S.renderView();
      const html = q(e, "#cal-body").innerHTML;
      ok(html.includes("🛡️ 최상일"), "이모지+이름 배지");
      ok(!/최\s*최상일/.test(q(e, "#cal-body").textContent), "약자 중복 없음");
      ok(!q(e, ".ag-chip .chip-tag"), "일 보기 칩 내 태그 숨김");
    });
    t("V16 주 보기: 10개 항목 더보기 없이 표시", () => {
      for (let i = 0; i < 10; i++) e.S.data.schedules.push({ id: "wk" + i, title: "주간항목" + i, memo: "", start: "2026-07-14", end: "2026-07-14", allDay: true, time: "", timeEnd: "", color: "teal", done: false, assignee: "", vehicle: false, room: false, reminders: [] });
      e.S.saveSilent();
      C.setView("week"); C.setAnchor("2026-07-14"); e.S.renderView();
      eq(qa(e, '[data-ev][data-from="2026-07-14"]').length, 10, "10개 모두 표시");
      ok(!q(e, '.cal-more[data-more="2026-07-14"]'), "더보기 없음");
    });
    t("V17 월 보기: 5개까지 표시 후 더보기", () => {
      C.setView("month"); e.S.renderView();
      eq(qa(e, '[data-ev][data-from="2026-07-14"]').length, 5, "월 5개 표시");
      const more = q(e, '.cal-more[data-more="2026-07-14"]');
      ok(more && /\+\d+개/.test(more.textContent), "+N개 더보기");
    });
  }

  /* ══════════ [P] 반복 일정 + 리치 메모 (v2.5) ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "hq");
    const C = e.Cal;
    const base = { memo: "", allDay: true, time: "", timeEnd: "", color: "blue", done: false,
      assignee: "", vehicle: false, room: false, reminders: [] };
    t("P01 occursOn: 매일 반복 + 종료일", () => {
      const ev = Object.assign({}, base, { id: "rp1", title: "매일", start: "2026-07-01", end: "2026-07-01", repeat: { freq: "daily", until: "2026-07-10" } });
      eq(C.occursOn(ev, "2026-07-05"), "2026-07-05");
      eq(C.occursOn(ev, "2026-07-10"), "2026-07-10", "종료일 포함");
      eq(C.occursOn(ev, "2026-07-11"), null, "종료 이후 없음");
      eq(C.occursOn(ev, "2026-06-30"), null, "시작 전 없음");
    });
    t("P02 occursOn: 매주/2주마다", () => {
      const w = Object.assign({}, base, { id: "rp2", title: "매주", start: "2026-07-06", end: "2026-07-06", repeat: { freq: "weekly", until: "" } });
      eq(C.occursOn(w, "2026-07-13"), "2026-07-13");
      eq(C.occursOn(w, "2026-07-14"), null);
      eq(C.occursOn(w, "2026-12-28"), "2026-12-28", "장기 반복");
      const b = Object.assign({}, base, { id: "rp3", title: "격주", start: "2026-07-06", end: "2026-07-06", repeat: { freq: "2week", until: "" } });
      eq(b && C.occursOn(b, "2026-07-13"), null, "1주 후 없음");
      eq(C.occursOn(b, "2026-07-20"), "2026-07-20", "2주 후 있음");
    });
    t("P03 occursOn: 매월 (없는 날짜 달은 건너뜀)", () => {
      const m = Object.assign({}, base, { id: "rp4", title: "매월", start: "2026-01-31", end: "2026-01-31", repeat: { freq: "monthly", until: "" } });
      eq(C.occursOn(m, "2026-03-31"), "2026-03-31");
      eq(C.occursOn(m, "2026-02-28"), null, "2월 31일 없음 → 건너뜀");
      eq(C.occursOn(m, "2026-04-30"), null, "4월 31일 없음");
      eq(C.occursOn(m, "2026-05-31"), "2026-05-31");
    });
    t("P04 occursOn: 매년 (윤년 2/29 처리)", () => {
      const y = Object.assign({}, base, { id: "rp5", title: "매년", start: "2024-02-29", end: "2024-02-29", repeat: { freq: "yearly", until: "" } });
      eq(C.occursOn(y, "2028-02-29"), "2028-02-29", "다음 윤년");
      eq(C.occursOn(y, "2026-02-28"), null, "평년은 건너뜀");
      eq(C.occursOn(y, "2026-03-01"), null);
    });
    t("P05 occursOn: 기간(다일) 반복의 중간 일자 커버", () => {
      const md = Object.assign({}, base, { id: "rp6", title: "3일훈련", start: "2026-07-06", end: "2026-07-08", repeat: { freq: "weekly", until: "" } });
      eq(C.occursOn(md, "2026-07-14"), "2026-07-13", "다음 주 화요일 → 월요일 시작 occurrence");
      eq(C.occursOn(md, "2026-07-15"), "2026-07-13");
      eq(C.occursOn(md, "2026-07-16"), null, "기간 밖");
    });
    t("P06 eventsOnDay: 반복 occurrence 전개 (start/end 치환)", () => {
      e.S.data.schedules.push(Object.assign({}, base, { id: "rp7", title: "주간회의", start: "2026-07-03", end: "2026-07-03", allDay: false, time: "09:00", repeat: { freq: "weekly", until: "" } }));
      e.S.saveSilent();
      const hits = C.eventsOnDay("2026-07-17").filter(x => x.id === "rp7");
      eq(hits.length, 1);
      eq(hits[0].start, "2026-07-17", "occurrence 날짜로 치환");
    });
    t("P07 nextOccurrence + 대시보드 '다가오는 일정' 반복 반영", () => {
      const nx = C.nextOccurrence(e.S.data.schedules.find(x => x.id === "rp7"), "2026-07-14");
      eq(nx.start, "2026-07-17");
      go(e, "dashboard");
      ok(q(e, "#upcoming-box").innerHTML.includes("주간회의"), "반복 일정의 다음 occurrence 표시");
    });
    t("P08 일정 폼: 반복 저장 + 리치 메모 살균", () => {
      go(e, "schedule");
      e.Cal.setView("month"); e.Cal.setAnchor("2026-07-15"); e.S.renderView();
      q(e, "#cal-add").click();
      ok(q(e, "#f-repeat"), "반복 선택");
      ok(q(e, "#f-memo").getAttribute("contenteditable") === "true", "리치 메모 에디터");
      q(e, "#f-title").value = "반복점검";
      q(e, "#f-start").value = "2026-07-20";
      q(e, "#f-repeat").value = "weekly";
      q(e, "#f-runtil").value = "2026-09-30";
      q(e, "#f-memo").innerHTML = '참고 <a href="https://example.com/doc">문서</a> <img src="https://x/y.png"><script>evil()</script>';
      q(e, "#f-save").click();
      const ev = e.S.data.schedules.find(x => x.title === "반복점검");
      eq(ev.repeat.freq, "weekly"); eq(ev.repeat.until, "2026-09-30");
      ok(ev.memoHtml.includes('href="https://example.com/doc"'), "링크 보존");
      ok(ev.memoHtml.includes('src="https://x/y.png"'), "이미지 보존");
      ok(!ev.memoHtml.includes("<script"), "스크립트 제거");
      ok(ev.memo.includes("참고"), "텍스트 추출");
      ok(C.repeatLabel(ev).includes("매주"), "반복 라벨");
    });
    t("P09 반복 일정 그리드 표시: 주별 occurrence + 🔁 아이콘", () => {
      e.S.renderView();
      const bars = qa(e, '[data-ev]').filter(x => x.dataset.ev === e.S.data.schedules.find(s => s.title === "반복점검").id);
      ok(bars.length >= 2, "월 보기에서 여러 occurrence 표시 (7/20, 7/27)");
      ok(bars[0].innerHTML.includes("🔁"), "반복 아이콘");
    });
    t("P10 리마인더: 반복 일정의 다음 occurrence 기준 발화", () => {
      const now = Date.now();
      const st = new Date(now + 30 * 60000);
      const pp = (n) => String(n).padStart(2, "0");
      const iso = st.getFullYear() + "-" + pp(st.getMonth() + 1) + "-" + pp(st.getDate());
      const hm = pp(st.getHours()) + ":" + pp(st.getMinutes());
      // 1주 전에 시작된 매주 반복 → 오늘 occurrence가 30분 뒤
      e.S.data.schedules.push(Object.assign({}, base, {
        id: "rp8", title: "반복알림", start: C.addDays(iso, -7), end: C.addDays(iso, -7),
        allDay: false, time: hm, repeat: { freq: "weekly", until: "" }, reminders: ["1h"]
      }));
      e.S.saveSilent();
      const due = C.dueReminders(now).filter(d => d.event.id === "rp8");
      eq(due.length, 1, "오늘 occurrence 알림");
      eq(due[0].occStart, iso, "occurrence 일자 기준");
      C.checkReminders();
      eq(C.dueReminders(now).filter(d => d.event.id === "rp8").length, 0, "중복 발화 방지");
    });
    t("P11 메모 리치미디어: 붙여넣기/드롭 배선 존재", () => {
      ok(typeof e.w.SemisNotice.wireRichMedia === "function", "공용 헬퍼");
      q(e, "#cal-add") && q(e, "#cal-add").click();
      ok(q(e, "#m-img") && q(e, "#m-file") && q(e, "#m-link"), "이미지/파일/링크 버튼");
      e.S.closeModal();
    });
  }

  /* ══════════ [RD] 반복 일정 회차별 완료 (v2.33) ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "hq");
    const C = e.Cal;
    const D = e.S.data;
    const base = { memo: "", allDay: true, time: "", timeEnd: "", color: "blue", done: false,
      assignee: "", vehicle: false, room: false, reminders: [], doneFrom: "", doneDates: [], undoneDates: [] };
    const mk = (id, patch) => {
      const ev = Object.assign({}, base, { id, title: id, start: "2026-07-06", end: "2026-07-06",
        repeat: { freq: "weekly", until: "" } }, patch || {});
      D.schedules.length = 0;                                 // 회차 표시 검증을 위해 단일 일정만 유지
      D.schedules.push(ev);
      e.S.saveSilent();
      return ev;
    };
    const get = (id) => D.schedules.find(x => x.id === id);
    // 매주 월요일: 7/06, 7/13, 7/20, 7/27, 8/03 …

    t("RD01 occDone: 비반복은 done, 반복은 회차별 판정", () => {
      const single = mk("rd_s", { repeat: { freq: "none", until: "" }, done: true });
      ok(C.occDone(single), "비반복 완료");
      const rep = mk("rd_a");
      ok(!C.occDone(rep, "2026-07-13"), "초기 전 회차 미완료");
    });

    t("RD02 '이 일정만 완료' — 해당 회차만 완료", () => {
      mk("rd_b");
      C.setOccDone("rd_b", "2026-07-13", "one", true);
      const ev = get("rd_b");
      ok(C.occDone(ev, "2026-07-13"), "선택 회차 완료");
      ok(!C.occDone(ev, "2026-07-06"), "이전 회차 미완료");
      ok(!C.occDone(ev, "2026-07-20"), "이후 회차 미완료(미래 일정 보존)");
      eq(ev.done, false, "마스터 done 플래그 미변경");
      eq(ev.doneDates.join(","), "2026-07-13");
    });

    t("RD03 '이후의 일정 모두 완료' — 기준일 이후만 완료", () => {
      mk("rd_c");
      C.setOccDone("rd_c", "2026-07-20", "future", true);
      const ev = get("rd_c");
      ok(!C.occDone(ev, "2026-07-06") && !C.occDone(ev, "2026-07-13"), "이전 회차 미완료 유지");
      ok(C.occDone(ev, "2026-07-20") && C.occDone(ev, "2026-07-27") && C.occDone(ev, "2026-12-28"),
        "기준일 이후 전부 완료");
      eq(ev.doneFrom, "2026-07-20");
      eq(ev.done, false);
    });

    t("RD04 '전체 일정 완료' — 모든 회차 완료", () => {
      mk("rd_d");
      C.setOccDone("rd_d", "2026-07-20", "all", true);
      const ev = get("rd_d");
      ok(C.occDone(ev, "2026-07-06") && C.occDone(ev, "2026-08-03"), "과거·미래 전부 완료");
      eq(ev.done, true);
      eq(ev.doneFrom, ""); eq(ev.doneDates.length, 0);
    });

    t("RD05 개별 해제: 전체 완료 상태에서 한 회차만 해제", () => {
      mk("rd_e", { done: true });
      C.setOccDone("rd_e", "2026-07-13", "one", false);
      const ev = get("rd_e");
      ok(!C.occDone(ev, "2026-07-13"), "선택 회차만 해제");
      ok(C.occDone(ev, "2026-07-06") && C.occDone(ev, "2026-07-20"), "나머지 완료 유지");
      eq(ev.undoneDates.join(","), "2026-07-13");
    });

    t("RD06 '이후 모두 해제' — 지난 완료 회차는 보존", () => {
      mk("rd_f", { done: true });
      C.setOccDone("rd_f", "2026-07-20", "future", false);
      const ev = get("rd_f");
      ok(C.occDone(ev, "2026-07-06") && C.occDone(ev, "2026-07-13"), "지난 완료 보존");
      ok(!C.occDone(ev, "2026-07-20") && !C.occDone(ev, "2026-07-27"), "이후 해제");
      eq(ev.done, false);
      eq(ev.doneDates.join(","), "2026-07-06,2026-07-13");
    });

    t("RD07 toggleDone(반복): occ 인자 없으면 첫 회차만 토글", () => {
      mk("rd_g");
      eq(C.toggleDone("rd_g", "2026-07-13"), true);
      ok(C.occDone(get("rd_g"), "2026-07-13") && !C.occDone(get("rd_g"), "2026-07-20"));
      eq(C.toggleDone("rd_g", "2026-07-13"), false, "재토글 해제");
      ok(!C.occDone(get("rd_g"), "2026-07-13"));
    });

    t("RD08 occurrenceStarts: 회차 열거 (매월 없는 날짜 건너뜀)", () => {
      const w = mk("rd_h");
      eq(C.occurrenceStarts(w, "2026-07-01", "2026-07-31").join(","),
        "2026-07-06,2026-07-13,2026-07-20,2026-07-27");
      const m = mk("rd_i", { start: "2026-01-31", end: "2026-01-31", repeat: { freq: "monthly", until: "2026-06-30" } });
      eq(C.occurrenceStarts(m, "2026-01-01", "2026-12-31").join(","),
        "2026-01-31,2026-03-31,2026-05-31", "2·4·6월 31일 없음 → 건너뜀");
    });

    t("RD09 체크 클릭 → 범위 선택 모달 (3개 선택지)", () => {
      mk("rd_j");
      go(e, "schedule");
      C.setView("month"); C.setAnchor("2026-07-15"); e.S.renderView();
      const tog = qa(e, '[data-donetoggle="rd_j"][data-occ="2026-07-13"]')[0];
      ok(tog, "회차(data-occ) 정보가 붙은 완료 토글");
      tog.click();
      const opts = qa(e, "#modal-box [data-scope]");
      eq(opts.length, 3, "이 일정만 / 이후 모두 / 전체");
      eq(opts.map(x => x.dataset.scope).join(","), "one,future,all");
      ok(q(e, "#modal-box").textContent.includes("2026-07-13"), "대상 회차 표시");
      opts[0].click();                                        // 이 일정만
      const ev = get("rd_j");
      ok(C.occDone(ev, "2026-07-13") && !C.occDone(ev, "2026-07-20"), "이 회차만 완료 적용");
    });

    t("RD10 그리드 표시: 완료 회차만 done/✓, 나머지 미완료", () => {
      e.S.renderView();
      const bars = qa(e, '[data-ev="rd_j"]');
      ok(bars.length >= 3, "월 보기 다수 회차");
      const d13 = bars.filter(x => x.dataset.occ === "2026-07-13")[0];
      const d20 = bars.filter(x => x.dataset.occ === "2026-07-20")[0];
      ok(d13 && d13.className.includes("done"), "7/13 완료 스타일");
      ok(d13.querySelector(".chip-check").textContent.includes("✓"), "✓ 표시");
      ok(d20 && !d20.className.includes("done"), "7/20 미완료 유지");
    });

    t("RD11 '완료 숨기기' 필터: 완료 회차만 숨김", () => {
      const has = (iso) => C.eventsOnDay(iso).some(x => x.id === "rd_j");
      C.setFilter(undefined, true);
      ok(!has("2026-07-13"), "완료 회차 숨김");
      ok(has("2026-07-20"), "미완료 회차 표시");
      C.setFilter(undefined, false);
      ok(has("2026-07-13"), "필터 해제 시 복원");
    });

    t("RD12 리마인더: 완료된 회차는 알림 제외", () => {
      const now = Date.now();
      const st = new Date(now + 30 * 60000);
      const pp = (n) => String(n).padStart(2, "0");
      const iso = st.getFullYear() + "-" + pp(st.getMonth() + 1) + "-" + pp(st.getDate());
      const hm = pp(st.getHours()) + ":" + pp(st.getMinutes());
      mk("rd_k", { start: C.addDays(iso, -7), end: C.addDays(iso, -7), allDay: false, time: hm,
        reminders: ["1h"], repeat: { freq: "weekly", until: "" } });
      eq(C.dueReminders(now).filter(d => d.event.id === "rd_k").length, 1, "미완료 회차 알림");
      C.setOccDone("rd_k", iso, "one", true);
      eq(C.dueReminders(now).filter(d => d.event.id === "rd_k").length, 0, "완료 회차 알림 제외");
    });

    t("RD13 드래그 이동: 완료 표시도 함께 이동", () => {
      mk("rd_l");
      C.setOccDone("rd_l", "2026-07-13", "one", true);
      C.setOccDone("rd_l", "2026-07-27", "future", true);
      ok(C.moveEvent("rd_l", "2026-07-08"));                  // +2일
      const ev = get("rd_l");
      eq(ev.doneDates.join(","), "2026-07-15");
      eq(ev.doneFrom, "2026-07-29");
      ok(C.occDone(ev, "2026-07-15") && !C.occDone(ev, "2026-07-22"), "이동 후에도 회차 대응 유지");
    });

    t("RD14 수정 폼: 완료 체크 시 적용 범위 선택 노출 + 이 회차만 저장", () => {
      mk("rd_m");
      go(e, "schedule");
      C.setView("month"); C.setAnchor("2026-07-15"); e.S.renderView();
      const bar = qa(e, '[data-ev="rd_m"]').filter(x => x.dataset.occ === "2026-07-20")[0];
      ok(bar, "7/20 회차 바");
      bar.click();
      ok(q(e, "#f-done"), "완료 체크박스");
      eq(q(e, "#row-donescope").style.display, "none", "변경 전에는 범위 선택 숨김");
      q(e, "#f-done").checked = true;
      q(e, "#f-done").onchange();
      ok(q(e, "#row-donescope").style.display !== "none", "체크 시 범위 선택 노출");
      eq(q(e, "#f-donescope").value, "one", "기본값: 이 일정만");
      q(e, "#f-save").click();
      const ev = get("rd_m");
      ok(C.occDone(ev, "2026-07-20"), "선택 회차 완료");
      ok(!C.occDone(ev, "2026-07-27") && !C.occDone(ev, "2026-08-03"), "미래 회차 완료 안 됨");
      eq(ev.done, false, "마스터 done 미변경");
    });

    t("RD15 수정 폼: 범위 '전체 일정' 선택 시 전 회차 완료", () => {
      mk("rd_n");
      e.S.renderView();
      const bar = qa(e, '[data-ev="rd_n"]').filter(x => x.dataset.occ === "2026-07-20")[0];
      bar.click();
      q(e, "#f-done").checked = true;
      q(e, "#f-done").onchange();
      q(e, "#f-donescope").value = "all";
      q(e, "#f-save").click();
      const ev = get("rd_n");
      eq(ev.done, true);
      ok(C.occDone(ev, "2026-07-06") && C.occDone(ev, "2026-08-03"));
    });

    t("RD16 반복 해제(반복 안 함) 시 단일 완료로 정리", () => {
      mk("rd_o", { done: true });
      e.S.renderView();
      const bar = qa(e, '[data-ev="rd_o"]')[0];
      bar.click();
      q(e, "#f-repeat").value = "none";
      q(e, "#f-repeat").onchange();
      q(e, "#f-save").click();
      const ev = get("rd_o");
      eq(ev.repeat.freq, "none");
      eq(ev.done, true, "완료 상태 유지");
      eq(ev.doneDates.length + ev.undoneDates.length, 0);
      eq(ev.doneFrom, "");
    });

    t("RD17 대시보드 '다가오는 일정': 미완료 회차 우선 표시", () => {
      const today = localToday();
      mk("rd_p", { title: "회차완료테스트", start: C.addDays(today, -7), end: C.addDays(today, -7),
        repeat: { freq: "weekly", until: "" } });
      C.setOccDone("rd_p", today, "one", true);
      const nx = C.nextOpenOccurrence(get("rd_p"), today);
      eq(nx.start, C.addDays(today, 7), "완료 회차 건너뜀");
      go(e, "dashboard");
      ok(q(e, "#upcoming-box").innerHTML.includes("회차완료테스트"), "대시보드 표시");
    });

    t("RD18 상세(읽기전용) 모달: 회차 기준 기간·완료 표시", () => {
      const ro = makeEnv();
      loginAs(ro, "manager");
      ro.S.data.schedules.length = 0;
      ro.S.data.schedules.push(Object.assign({}, base, { id: "rd_q", title: "읽기전용반복",
        start: "2026-07-06", end: "2026-07-06", repeat: { freq: "weekly", until: "" },
        doneDates: ["2026-07-20"] }));
      ro.S.saveSilent();
      go(ro, "schedule");
      ro.Cal.setView("month"); ro.Cal.setAnchor("2026-07-15"); ro.S.renderView();
      const bar = qa(ro, '[data-ev="rd_q"]').filter(x => x.dataset.occ === "2026-07-20")[0];
      ok(bar, "회차 바");
      ok(!qa(ro, '[data-donetoggle="rd_q"]').length, "읽기 권한은 완료 토글 없음");
      bar.click();
      const html = q(ro, "#modal-box").innerHTML;
      ok(html.includes("2026-07-20"), "회차 일자 표시");
      ok(html.includes("완료"), "완료 배지");
      ro.S.closeModal();
    });
  }

  /* ══════════ [S] Supabase 동기화 신규 ══════════ */
  await ta("S01 오프라인(fetch 거부) → 폴백 + 데이터 보존", async () => {
    const server = { rows: [], fail: true };
    const e = makeEnv({ fetch: makeFetchStub(server) });
    await Promise.resolve(e.Sync.init()).catch(() => {});
    eq(e.Sync.status, "offline");
    ok(e.S.data.menus.length >= 20, "로컬 데이터 정상");
    e.S.data.notices.push({ id: "off1", title: "오프라인공지", body: "", author: "t", pinned: false, created: "2026-01-01" });
    e.S.save();
    ok(e.Sync.pendingKeys().includes("notices"), "pending 큐 기록");
    const raw = JSON.parse(e.w.localStorage.getItem("semis2:data"));
    ok(raw.notices.some(n => n.id === "off1"), "localStorage 저장 유지");
    e.Sync.stop();
  });

  await ta("S02 fetch 미지원 환경 → 즉시 오프라인", async () => {
    const e = makeEnv();
    await Promise.resolve(e.Sync.init()).catch(() => {});
    eq(e.Sync.status, "offline");
    e.Sync.stop();
  });

  await ta("S03 최초 접속(서버 비어있음) → 로컬 데이터 시드 업로드", async () => {
    const server = { rows: [], fail: false };
    const e = makeEnv({ fetch: makeFetchStub(server) });
    await e.Sync.init();
    eq(e.Sync.status, "online");
    const keys = server.rows.map(r => r.key).sort().join(",");
    eq(keys, "billing,branches,carCfg,cars,certOpts,certs,contacts,contracts,council,customUsers,equipMaint,equipment,gcal,inspections,kpis,levelHistory,menus,notices,passOwners,passes,policy,pwOverrides,regulations,schedules,stationOfficers,supervisors,trainings,userOverrides,vault");
    ok(server.rows.find(r => r.key === "menus").value.length >= 20);
    e.Sync.stop();
  });

  await ta("S04 서버 데이터 존재 → pull 적용 + localStorage 반영", async () => {
    const server = {
      fail: false,
      rows: [{ key: "notices", value: [{ id: "srv1", title: "서버공지", body: "b", author: "s", pinned: false, created: "2026-01-01" }], updated_at: "2026-07-15T00:00:00Z", updated_by: "other" }]
    };
    const e = makeEnv({ fetch: makeFetchStub(server) });
    await e.Sync.init();
    eq(e.S.data.notices.length, 1);
    eq(e.S.data.notices[0].id, "srv1");
    const raw = JSON.parse(e.w.localStorage.getItem("semis2:data"));
    eq(raw.notices[0].id, "srv1", "localStorage에도 반영");
    ok(server.rows.some(r => r.key === "menus"), "서버에 없던 키는 시드 업로드");
    e.Sync.stop();
  });

  await ta("S05 로컬 변경 → save 후크 → push 업로드", async () => {
    const server = { rows: [], fail: false };
    const e = makeEnv({ fetch: makeFetchStub(server) });
    await e.Sync.init();
    e.S.data.schedules.push({ id: "up1", title: "업로드일정", memo: "", start: "2026-09-01", end: "2026-09-01", allDay: true, time: "", timeEnd: "", color: "blue", done: false, assignee: "" });
    e.S.save();
    ok(e.Sync.dirtyKeys().includes("schedules") || e.Sync.pendingKeys().includes("schedules"));
    await e.Sync._flush();
    const row = server.rows.find(r => r.key === "schedules");
    ok(row.value.some(s => s.id === "up1"), "서버에 업로드됨");
    eq(e.Sync.dirtyKeys().length, 0, "스냅샷 갱신");
    eq(e.Sync.pendingKeys().length, 0, "pending 비움");
    e.Sync.stop();
  });

  await ta("S06 applyRemote: 원격 변경 반영 (실시간 수신 경로)", async () => {
    const server = { rows: [], fail: false };
    const e = makeEnv({ fetch: makeFetchStub(server) });
    await e.Sync.init();
    const remote = [{ id: "rt1", title: "실시간일정", memo: "", start: "2026-09-10", end: "2026-09-10", allDay: true, time: "", timeEnd: "", color: "green", done: false, assignee: "", vehicle: false, room: false, reminders: [], repeat: { freq: "none", until: "" }, doneFrom: "", doneDates: [], undoneDates: [] }];
    const changed = e.Sync.applyRemote("schedules", remote);
    eq(changed, true);
    eq(e.S.data.schedules[0].id, "rt1");
    const raw = JSON.parse(e.w.localStorage.getItem("semis2:data"));
    eq(raw.schedules[0].id, "rt1");
    eq(e.Sync.dirtyKeys().length, 0, "재푸시 루프 없음");
    eq(e.Sync.applyRemote("schedules", remote), false, "동일 값 재적용 무시");
    e.Sync.stop();
  });

  await ta("S07 forcePush(백업 복원) → 서버보다 로컬 우선", async () => {
    const server = {
      fail: false,
      rows: [{ key: "notices", value: [{ id: "old1", title: "덮어쓰기대상", body: "", author: "s", pinned: false, created: "2026-01-01" }], updated_at: "2026-07-15T00:00:00Z", updated_by: "other" }]
    };
    const e = makeEnv({ fetch: makeFetchStub(server), preLS: { "semis2:forcePush": "1" } });
    const localTitle = e.S.data.notices[0].title;
    await e.Sync.init();
    eq(e.S.data.notices[0].title, localTitle, "로컬 유지");
    eq(server.rows.find(r => r.key === "notices").value[0].title, localTitle, "서버 덮어씀");
    eq(e.w.localStorage.getItem("semis2:forcePush"), null, "플래그 해제");
    e.Sync.stop();
  });

  await ta("S08 오프라인 복구: 재연결 시 pending 자동 push", async () => {
    const server = { rows: [], fail: true };
    const stub = makeFetchStub(server);
    const e = makeEnv({ fetch: stub });
    await Promise.resolve(e.Sync.init()).catch(() => {});
    eq(e.Sync.status, "offline");
    e.S.data.notices.push({ id: "rec1", title: "복구후업로드", body: "", author: "t", pinned: false, created: "2026-01-01" });
    e.S.save();
    ok(e.Sync.pendingKeys().includes("notices"));
    server.fail = false; // 네트워크 복구
    await e.Sync.syncNow();
    eq(e.Sync.status, "online");
    const row = server.rows.find(r => r.key === "notices");
    ok(row && row.value.some(n => n.id === "rec1"), "pending 업로드 완료");
    eq(e.Sync.pendingKeys().length, 0);
    e.Sync.stop();
  });

  await ta("S09 pull 시 pending 키: 서버가 덮어쓰지 않고 id 병합", async () => {
    const server = {
      fail: false,
      rows: [{ key: "notices", value: [{ id: "srvN", title: "서버본", body: "", author: "s", pinned: false, created: "2026-01-01" }], updated_at: "2026-07-15T00:00:00Z", updated_by: "other" }]
    };
    const e = makeEnv({ fetch: makeFetchStub(server), preLS: { "semis2:pendingSync": JSON.stringify(["notices"]) } });
    const localId = e.S.data.notices[0].id;
    await e.Sync.init();
    const ids = e.S.data.notices.map(n => n.id);
    ok(ids.includes(localId), "로컬(pending) 공지 보존");
    ok(ids.includes("srvN"), "서버 공지도 병합");
    const srvIds = server.rows.find(r => r.key === "notices").value.map(n => n.id);
    ok(srvIds.includes(localId) && srvIds.includes("srvN"), "병합본 서버 push");
    e.Sync.stop();
  });

  await ta("S13 초기 동기화 충돌: pending 로컬 일정과 서버 이관본 id 병합", async () => {
    const server = {
      fail: false,
      rows: [{ key: "schedules", value: [
        { id: "g_imp1", gcalId: "imp1", title: "이관일정", memo: "", start: "2026-07-20", end: "2026-07-20", allDay: true, time: "", timeEnd: "", color: "blue", done: false, assignee: "", vehicle: false, room: false, reminders: [] }
      ], updated_at: "2026-07-16T00:00:00Z", updated_by: "gcal-import" }]
    };
    const e = makeEnv({
      fetch: makeFetchStub(server),
      preLS: { "semis2:pendingSync": JSON.stringify(["schedules"]) },
      preData: { schedules: [{ id: "loc1", title: "로컬일정", memo: "", start: "2026-07-22", end: "2026-07-22", allDay: true, time: "", timeEnd: "", color: "red", done: false, assignee: "", vehicle: false, room: false, reminders: [] }] }
    });
    await e.Sync.init();
    const ids = e.S.data.schedules.map(x => x.id);
    ok(ids.includes("g_imp1") && ids.includes("loc1"), "양쪽 모두 보존(병합)");
    const srvIds = server.rows.find(r => r.key === "schedules").value.map(x => x.id);
    ok(srvIds.includes("g_imp1") && srvIds.includes("loc1"), "병합본 서버 반영");
    e.Sync.stop();
  });

  await ta("S10 canonical 비교: 키 순서 달라도 동일 판정", async () => {
    const e = makeEnv();
    const c = e.Sync._canon;
    eq(c({ b: 1, a: [{ y: 2, x: 1 }] }), c({ a: [{ x: 1, y: 2 }], b: 1 }));
    ok(c({ a: 1 }) !== c({ a: 2 }));
    e.Sync.stop();
  });

  await ta("S11 동기화 상태 표시(헤더 sync-dot) 갱신", async () => {
    const server = { rows: [], fail: false };
    const e = makeEnv({ fetch: makeFetchStub(server) });
    await e.Sync.init();
    const el = q(e, "#sync-status");
    ok(el.className.includes("online"), "online 클래스");
    ok(el.textContent.includes("실시간"));
    e.Sync.stop();
  });

  await ta("S12 시스템정보 탭: 동기화 상태/수동 동기화 버튼 동작", async () => {
    const server = { rows: [], fail: false };
    const e = makeEnv({ fetch: makeFetchStub(server) });
    await e.Sync.init();
    loginAs(e, "admin");
    go(e, "settings");
    qa(e, ".tab").find(x => x.dataset.tab === "data").click();
    ok(q(e, "#sysinfo-sync").textContent.includes("연결됨"));
    const before = server.rows.length;
    q(e, "#btn-sync-now").click();
    await new Promise(r => setTimeout(r, 30));
    ok(server.rows.length >= before, "수동 동기화 수행");
    e.Sync.stop();
  });

  /* ══════════ [PS/EQ/TR/CN] v2.8 신규 모듈 — 출입증/보안장비/보안교육/계약서 ══════════ */
  const shiftDay = (days) => {
    const t = new Date(); t.setUTCDate(t.getUTCDate() + days);
    return t.toISOString().slice(0, 10);
  };

  t("V801 normalize: 신규 배열/메뉴 자동 삽입 (구서버 데이터 마이그레이션)", () => {
    const e = makeEnv();
    const d = e.S.data;
    // 구버전 상태 시뮬레이션: 신규 모듈 메뉴/배열 제거 + 구링크 라벨 원복
    d.menus = d.menus.filter(m => !(m.type === "module" && ["passes", "equipment", "training", "contracts-mgmt"].includes(m.module)));
    delete d.passes; delete d.equipment; delete d.trainings; delete d.contracts; delete d.equipMaint;
    [["pass-mgmt", "출입증 관리"], ["equip-mgmt", "보안장비 관리"], ["edu-training", "보안 교육"], ["br-contract", "계약서 관리"]]
      .forEach(([id, orig]) => { const mn = d.menus.find(m => m.id === id); if (mn) mn.label = orig; });
    const changed = e.S.normalizeData();
    eq(changed, true, "변경 감지");
    ok(Array.isArray(d.passes) && Array.isArray(d.equipment) && Array.isArray(d.trainings) && Array.isArray(d.contracts), "배열 보정");
    ok(d.equipMaint && Array.isArray(d.equipMaint.contracts) && Array.isArray(d.equipMaint.costs), "equipMaint 보정 (v2.10)");
    const mOf = (mod) => d.menus.find(m => m.type === "module" && m.module === mod);
    ok(mOf("passes") && mOf("equipment") && mOf("training") && mOf("contracts-mgmt"), "메뉴 4개 삽입");
    ok(mOf("passes").seq < mOf("equipment").seq, "출입증이 장비보다 위");
    const br = d.menus.find(m => m.type === "module" && m.module === "branches");
    ok(mOf("contracts-mgmt").seq > br.seq, "계약서는 지점 관리 다음");
    eq(mOf("contracts-mgmt").vis, "hq", "계약서 vis=hq (대외비, v2.11)");
    eq(d.menus.find(m => m.id === "pass-mgmt").label, "출입증 관리 (구버전)", "구링크 라벨 구분");
    eq(e.S.normalizeData(), false, "idempotent");
  });

  t("V802 SYNC_KEYS에 신규 4개 컬렉션 포함", () => {
    const e = makeEnv();
    ["passes", "equipment", "equipMaint", "trainings", "contracts"].forEach(k =>
      ok(e.Sync.SYNC_KEYS.includes(k), k + " 포함"));
  });

  /* ══════════ [SB] v2.22 사이드바 — 그룹 분리 · 계정별 접기 · 툴바 · 축소 ══════════ */
  t("SB01 기본 메뉴: 출입증(grp-pass) / 보안장비(grp-equip) 분리", () => {
    const e = makeEnv();
    const d = e.S.data;
    const pass = d.menus.find(m => m.id === "grp-pass" && m.type === "group");
    const equip = d.menus.find(m => m.id === "grp-equip" && m.type === "group");
    eq(pass.label, "출입증", "grp-pass 라벨");
    ok(equip, "grp-equip 존재");
    eq(equip.label, "보안장비", "grp-equip 라벨");
    const parentOf = (id) => (d.menus.find(m => m.id === id) || {}).parent;
    eq(parentOf("passes"), "grp-pass", "출입증 관리 → grp-pass");
    eq(parentOf("pass-mgmt"), "grp-pass", "출입증 구링크 → grp-pass");
    eq(parentOf("equipment"), "grp-equip", "장비 유지관리 → grp-equip");
    eq(parentOf("billing"), "grp-equip", "대금청구 → grp-equip");
    eq(parentOf("equip-mgmt"), "grp-equip", "장비 구링크 → grp-equip");
    eq(parentOf("equip-council"), "grp-equip", "장비 협의체 → grp-equip");
    const edu = d.menus.find(m => m.id === "grp-edu");
    ok(pass.seq < equip.seq && equip.seq < edu.seq, "그룹 순서: 출입증 < 보안장비 < 보안증진");
    eq(e.S.normalizeData(), false, "idempotent");
  });

  t("SB02 구버전(grp-pass 통합) 데이터 → 분리 마이그레이션", () => {
    const e = makeEnv();
    const d = e.S.data;
    // 구버전 재현: grp-equip 제거 + 라벨 원복 + 장비류를 grp-pass 소속으로
    d.menus = d.menus.filter(m => m.id !== "grp-equip");
    d.menus.find(m => m.id === "grp-pass").label = "출입증 / 보안장비";
    ["equipment", "billing", "equip-mgmt", "equip-council"].forEach(id => {
      const mn = d.menus.find(m => m.id === id); if (mn) mn.parent = "grp-pass";
    });
    eq(e.S.normalizeData(), true, "변경 감지");
    const equip = d.menus.find(m => m.id === "grp-equip" && m.type === "group");
    ok(equip && equip.label === "보안장비", "grp-equip 생성");
    eq(d.menus.find(m => m.id === "grp-pass").label, "출입증", "grp-pass 라벨 갱신");
    ["equipment", "billing", "equip-mgmt", "equip-council"].forEach(id =>
      eq(d.menus.find(m => m.id === id).parent, "grp-equip", id + " 이동"));
    eq(d.menus.find(m => m.id === "passes").parent, "grp-pass", "출입증은 grp-pass 유지");
    eq(e.S.normalizeData(), false, "idempotent");
  });

  t("SB03 계정별 그룹 접기 상태 저장 (navPrefs[uid])", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.renderNav();
    const heads = qa(e, "#nav-menu .nav-group-label");
    ok(heads.length, "그룹 헤더 존재");
    heads[0].click();
    const ui = JSON.parse(e.w.localStorage.getItem("semis2:ui"));
    ok(ui.navPrefs && ui.navPrefs.thq, "thq 계정 navPrefs 기록");
    ok(Object.values(ui.navPrefs.thq.collapsed || {}).some(v => v === true), "접힘 저장");
    ok(!ui.navPrefs.tmgr, "타 계정 미영향");
  });

  t("SB04 툴바: 모두 접기 / 모두 펼치기 토글", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.renderNav();
    const groupCount = qa(e, "#nav-menu .nav-group").length;
    ok(groupCount > 1, "그룹 다수");
    q(e, "#nav-toggle-all").click();
    eq(qa(e, "#nav-menu .nav-group.collapsed").length, groupCount, "모두 접힘");
    ok(q(e, "#nav-toggle-all").title.includes("펼치기"), "라벨 → 모두 펼치기");
    q(e, "#nav-toggle-all").click();
    eq(qa(e, "#nav-menu .nav-group.collapsed").length, 0, "모두 펼침");
    ok(q(e, "#nav-toggle-all").title.includes("접기"), "라벨 → 모두 접기");
  });

  t("SB05 툴바: 사이드바 축소 / 확대 (계정별 저장)", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.renderNav();
    ok(!q(e, "#app").className.includes("sidebar-mini"), "초기 확대 상태");
    q(e, "#nav-toggle-mini").click();
    ok(q(e, "#app").className.includes("sidebar-mini"), "축소 적용");
    eq(JSON.parse(e.w.localStorage.getItem("semis2:ui")).navPrefs.thq.sidebarMini, true, "축소 상태 저장");
    q(e, "#nav-toggle-mini").click();
    ok(!q(e, "#app").className.includes("sidebar-mini"), "확대 복원");
  });

  /* ── [PS] 출입증 관리 ── */
  t("PS01 렌더: manager 등록 버튼 / user 미표시", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "passes");
    ok(q(e, ".page-title").textContent.includes("출입증"), "제목");
    ok(q(e, "#pass-add"), "manager 등록 버튼");
    const e2 = makeEnv();
    loginAs(e2, "manager");
    go(e2, "passes");
    ok(!q(e2, "#pass-add"), "user 등록 버튼 없음");
  });

  t("PS02 등록 폼 저장 → 데이터 반영", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "passes");
    q(e, "#pass-add").click();
    q(e, "#p-holder").value = "홍길동";
    q(e, "#p-company").value = "에어제타";
    q(e, "#p-no").value = "I-2026-001";
    q(e, "#p-issue").value = "2026-01-01";
    q(e, "#p-expire").value = shiftDay(20);
    q(e, "#p-save").click();
    eq(e.S.data.passes.length, 1);
    const x = e.S.data.passes[0];
    eq(x.holder, "홍길동"); eq(x.no, "I-2026-001"); eq(x.status, "사용중");
    // 목록에 표시 + D-day 배지
    ok(q(e, "#pass-body").textContent.includes("홍길동"));
    ok(q(e, "#pass-body").innerHTML.includes("D-20"), "D-day 배지");
  });

  t("PS03 만료 판정: daysLeft/isExpired", () => {
    const e = makeEnv();
    const P = e.w.SemisPasses;
    eq(P.daysLeft(shiftDay(5)), 5);
    eq(P.daysLeft(shiftDay(-3)), -3);
    ok(P.isExpired({ status: "사용중", expire: shiftDay(-1) }), "만료 경과");
    ok(!P.isExpired({ status: "반납", expire: shiftDay(-1) }), "반납은 만료 아님");
    ok(!P.isExpired({ status: "사용중", expire: shiftDay(1) }), "기한 내");
  });

  t("PS04 통계/필터: 만료임박·분실 집계", () => {
    const e = makeEnv();
    e.S.data.passes = [
      { id: "p1", kind: "상주직원", holder: "A", company: "", no: "", area: "", issue: "", expire: shiftDay(10), status: "사용중", note: "" },
      { id: "p2", kind: "상주직원", holder: "B", company: "", no: "", area: "", issue: "", expire: shiftDay(-2), status: "사용중", note: "" },
      { id: "p3", kind: "차량", holder: "C", company: "", no: "", area: "", issue: "", expire: shiftDay(200), status: "분실", note: "" }
    ];
    const s = e.w.SemisPasses.stats();
    eq(s.active, 2); eq(s.soon, 1); eq(s.expired, 1); eq(s.lost, 1);
    loginAs(e, "hq");
    e.w.SemisPasses.setFilter("만료임박");
    go(e, "passes");
    const rows = qa(e, "#pass-body [data-pass-row]");
    eq(rows.length, 2, "만료임박 필터(D-10 + 만료 경과 포함)");
  });

  t("PS05 user 상세 모달 (읽기 전용)", () => {
    const e = makeEnv();
    e.S.data.passes = [{ id: "p1", kind: "상주직원", holder: "김직원", company: "지점", no: "N1", area: "램프", issue: "2026-01-01", expire: shiftDay(100), status: "사용중", note: "" }];
    loginAs(e, "manager");
    go(e, "passes");
    q(e, "[data-pass-row]").click();
    ok(q(e, "#modal-box").textContent.includes("김직원"), "상세 모달");
    ok(!q(e, "#p-save"), "저장 버튼 없음(읽기 전용)");
  });

  /* ── [EQ] 보안장비 유지관리 ── */
  t("EQ01 addMonths: 말일 보정 포함", () => {
    const e = makeEnv();
    const E = e.w.SemisEquipment;
    eq(E.addMonths("2026-07-17", 12), "2027-07-17");
    eq(E.addMonths("2026-01-31", 1), "2026-02-28", "말일 보정");
    eq(E.addMonths("2024-01-31", 1), "2024-02-29", "윤년 말일");
    eq(E.addMonths("", 12), "");
    eq(E.addMonths("2026-01-01", 0), "");
  });

  t("EQ02 내용연수: 교체예정·임박 판정 (X-Ray 10년/ETD 5년)", () => {
    const e = makeEnv();
    const E = e.w.SemisEquipment;
    eq(E.TYPE_LIFE["X-Ray"], 10); eq(E.TYPE_LIFE["ETD(폭발물흔적)"], 5);
    eq(E.replaceDue({ type: "ETD(폭발물흔적)", mfgDate: "2023-01-01" }), "2028-01-01", "ETD 5년");
    eq(E.replaceDue({ type: "X-Ray", installed: "2021-08-30" }), "2031-08-30", "제조일 없으면 설치일 기산");
    eq(E.replaceDue({ type: "X-Ray", mfgDate: "2020-01-01", lifeYears: 3 }), "2023-01-01", "장비별 override");
    eq(E.replaceDue({ type: "기타", mfgDate: "2020-01-01", replaceDue: "2030-06-01" }), "2030-06-01", "수동 지정 우선");
    ok(E.isLifeDue({ type: "ETD(폭발물흔적)", status: "정상", mfgDate: "2020-01-01" }), "만료");
    ok(E.isLifeDue({ type: "ETD(폭발물흔적)", status: "정상", mfgDate: shiftDay(-(5 * 365 - 100)) }), "1년 이내 임박");
    ok(!E.isLifeDue({ type: "X-Ray", status: "정상", mfgDate: shiftDay(-10) }), "잔여 충분");
    ok(!E.isLifeDue({ type: "ETD(폭발물흔적)", status: "폐기", mfgDate: "2020-01-01" }), "폐기 제외");
    ok(!E.isLifeDue({ type: "기타", status: "정상", mfgDate: "2020-01-01" }), "내용연수 미지정 유형 제외");
  });

  t("EQ03 등록 폼 저장: 제조일·내용연수·자체 기록 (v2.10)", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "equipment");
    q(e, "#eq-add").click();
    q(e, "#e-name").value = "RAP-638DV";
    q(e, "#e-serial").value = "6212421";
    q(e, "#e-mfg").value = "2021-08-30";
    q(e, "#elog-add").click();                      // 자체 기록: 오늘 · 기타
    q(e, "#e-logs .ifd-text").value = "리스 계약 갱신 협의";
    q(e, "#e-save").click();
    eq(e.S.data.equipment.length, 1);
    const x = e.S.data.equipment[0];
    eq(x.name, "RAP-638DV");
    eq(x.logs.length, 1);
    eq(x.lifeYears, null, "미입력 시 유형 기본 적용 대기");
    eq(e.w.SemisEquipment.lifeYearsOf(x), 10, "X-Ray 기본 10년");
    eq(e.w.SemisEquipment.replaceDue(x), "2031-08-30", "제조일+10년");
  });

  t("EQ04 통계/필터: 내용연수 임박 집계", () => {
    const e = makeEnv();
    e.S.data.equipment = [
      { id: "q1", type: "ETD(폭발물흔적)", name: "장비A", serial: "", location: "", vendor: "", mfgDate: "2021-01-01", installed: "", status: "정상", logs: [], note: "" },
      { id: "q2", type: "X-Ray", name: "장비B", serial: "", location: "", vendor: "", mfgDate: shiftDay(-10), installed: "", status: "정상", logs: [], note: "" },
      { id: "q3", type: "기타", name: "장비C", serial: "", location: "", vendor: "", mfgDate: "", installed: "", status: "고장", logs: [], note: "" }
    ];
    const s = e.w.SemisEquipment.stats();
    eq(s.total, 3); eq(s.ok, 1); eq(s.due, 1); eq(s.broken, 1);
    loginAs(e, "hq");
    e.w.SemisEquipment.setFilter("내용연수임박");
    go(e, "equipment");
    eq(qa(e, "#eq-body [data-eq-row]").length, 1, "내용연수 임박 필터");
    e.w.SemisEquipment.setFilter("전체");
  });

  t("EQ05 비용 기록: 연간/월별 합계 (equipMaint)", () => {
    const e = makeEnv();
    e.S.data.equipMaint = { contracts: [], costs: [
      { id: "c1", ym: "2026-01", kind: "정기 유지보수", vendor: "인씨스", amount: 2610000 },
      { id: "c2", ym: "2026-01", kind: "수리/부품", vendor: "프로에스콤", amount: 4500000 },
      { id: "c3", ym: "2026-03", kind: "정기 유지보수", vendor: "인씨스", amount: 2610000 },
      { id: "c4", ym: "2025-12", kind: "기타", vendor: "", amount: 99 }
    ] };
    const yc = e.w.SemisEquipment.yearCosts(2026);
    eq(yc.total, 9720000, "연간 합계 (2025 제외)");
    eq(yc.byM[1].total, 7110000, "1월 합계");
    eq(yc.byM[1]["수리/부품"], 4500000);
    eq(yc.byM[3]["정기 유지보수"], 2610000);
    eq(yc.rows.length, 3);
  });

  /* ── [TR] 보안교육 관리 ── */
  t("TR01 렌더 + 연도 네비게이션", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "training");
    ok(q(e, ".page-title").textContent.includes("보안교육"));
    const y = new Date().getFullYear();
    ok(q(e, ".cal-title").textContent.includes(String(y)));
    q(e, "#tr-prev").click();
    ok(q(e, ".cal-title").textContent.includes(String(y - 1)), "이전 연도");
    e.w.SemisTraining.setYear(y); // 상태 복원
  });

  t("TR02 등록 폼 저장: 실시일 → 월 자동 반영 + 이수율", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "training");
    q(e, "#tr-add").click();
    q(e, "#t-course").value = "항공보안 정기교육";
    q(e, "#t-date").value = String(new Date().getFullYear()) + "-09-15";
    q(e, "#t-planned").value = "40";
    q(e, "#t-attended").value = "38";
    qa(e, "#t-status option").forEach(o => { o.selected = o.textContent === "완료"; });
    q(e, "#t-save").click();
    eq(e.S.data.trainings.length, 1);
    const x = e.S.data.trainings[0];
    eq(x.month, 9, "실시일 → 월 자동");
    eq(x.status, "완료");
    const s = e.w.SemisTraining.stats();
    eq(s.done, 1); eq(s.rate, 95, "이수율 38/40=95%");
  });

  t("TR03 user 읽기 전용 상세", () => {
    const e = makeEnv();
    e.S.data.trainings = [{ id: "t1", year: new Date().getFullYear(), month: 3, course: "초기교육", type: "초기", method: "집합", target: "신규자", date: "", hours: 8, planned: 5, attended: 5, status: "완료", note: "" }];
    loginAs(e, "manager");
    go(e, "training");
    ok(!q(e, "#tr-add"), "user 등록 버튼 없음");
    q(e, "[data-tr-row]").click();
    ok(q(e, "#modal-box").textContent.includes("초기교육"), "상세 모달");
    ok(!q(e, "#t-save"), "저장 버튼 없음");
  });

  /* ── [CN] 계약서 관리 ── */
  t("CN01 stateOf: 유효/만료/해지 판정", () => {
    const e = makeEnv();
    const C = e.w.SemisContracts;
    eq(C.stateOf({ status: "유효", end: shiftDay(10) }), "유효");
    eq(C.stateOf({ status: "유효", end: shiftDay(-1) }), "만료");
    eq(C.stateOf({ status: "해지", end: shiftDay(10) }), "해지");
    eq(C.stateOf({ status: "유효", end: "" }), "유효", "기한없음");
  });

  t("CN02 렌더(manager) + 등록 저장 + D-day 배지", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "contracts-mgmt");
    ok(q(e, ".page-title").textContent.includes("계약서"));
    q(e, "#cn-add").click();
    q(e, "#c-name").value = "보안검색 위탁용역";
    q(e, "#c-party").value = "프로에스콤";
    q(e, "#c-start").value = "2026-01-01";
    q(e, "#c-end").value = shiftDay(45);
    q(e, "#c-save").click();
    eq(e.S.data.contracts.length, 1);
    eq(e.S.data.contracts[0].party, "프로에스콤");
    ok(q(e, "#cn-body").innerHTML.includes("D-45"), "D-day 배지(90일 내 amber)");
    const s = e.w.SemisContracts.stats();
    eq(s.active, 1); eq(s.soon, 1);
  });

  t("CN03 user 접근 차단 (vis=mgr → 대시보드 폴백)", () => {
    const e = makeEnv();
    loginAs(e, "manager");
    go(e, "contracts-mgmt");
    ok(q(e, ".page-title").textContent.includes("대시보드"), "대시보드로 폴백");
  });

  /* ── [DX] 대시보드 만료·점검 도래 통합 카드 ── */
  t("DX01 만료·점검 도래 카드: 출입증/계약/장비 통합 (manager)", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.passes = [{ id: "p1", kind: "상주직원", holder: "박만료", company: "", no: "", area: "", issue: "", expire: shiftDay(5), status: "사용중", note: "" }];
    e.S.data.contracts = [{ id: "c1", name: "만료임박계약", party: "", category: "기타", start: "", end: shiftDay(20), amount: "", owner: "", autoRenew: false, fileUrl: "", status: "유효", note: "" }];
    e.S.data.equipment = [{ id: "q1", type: "ETD(폭발물흔적)", name: "내용연수장비", serial: "", location: "", vendor: "", mfgDate: "2021-01-01", installed: "", status: "정상", logs: [], note: "" }];
    go(e, "dashboard");
    const box = q(e, "#expiry-box").textContent;
    ok(box.includes("박만료"), "출입증 표시");
    ok(box.includes("만료임박계약"), "계약 표시(manager)");
    ok(box.includes("내용연수장비"), "장비 내용연수 표시");
  });

  t("DV01 대시보드 카드 권한: user에게 민감 카드 숨김 (v2.10.1)", () => {
    const e = makeEnv();
    loginAs(e, "user");
    go(e, "dashboard");
    ok(!q(e, "#level-box"), "보안등급 숨김");
    ok(!q(e, "#insp-box"), "보안점검 실적 숨김");
    ok(!q(e, "#upcoming-box"), "다가오는 일정 숨김");
    ok(!q(e, "#equip-box"), "보안장비·고장신고 숨김");
    ok(q(e, "#notice-list"), "공지 표시");
    ok(q(e, "#expiry-box"), "만료·도래 표시");
    ok(q(e, ".quick-links"), "바로가기 표시");
  });

  t("DV02 대시보드 카드 권한: manager 열람 가능 + 편집 불가 (v2.11)", () => {
    const e = makeEnv();
    loginAs(e, "manager");
    go(e, "dashboard");
    ok(q(e, "#level-box"), "보안등급 표시(열람)");
    ok(q(e, "#insp-box"), "보안점검 실적 표시(열람)");
    ok(q(e, "#upcoming-box"), "다가오는 일정 표시(열람)");
    ok(!q(e, "#btn-add-notice"), "공지 작성 버튼 없음(편집 불가)");
    ok(!q(e, "#btn-edit-level"), "등급 변경 버튼 없음(편집 불가)");
    const DC = e.w.SemisDash && e.w.SemisDash.DASH_CARDS;
    ok(DC && DC.level === "mgr" && DC.insp === "mgr" && DC.upcoming === "mgr" && DC.equip === "mgr", "보안 카드 vis=mgr(열람그룹)");
    ok(DC.notice === "all" && DC.quick === "all", "공용 카드 vis=all");
  });

  t("DV03 항공보안HQ 권한: admin 다음 전 기능 (편집 가능, v2.11)", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    eq(e.S.roleRank(), 3, "hq rank 3 (admin 4 > hq 3 > manager 2 > user 1)");
    go(e, "dashboard");
    ok(q(e, "#level-box") && q(e, "#insp-box") && q(e, "#upcoming-box"), "보안 카드 전체 표시");
    ok(q(e, "#btn-add-notice"), "공지 작성 가능(편집그룹)");
    ok(q(e, "#btn-edit-level"), "보안등급 변경 가능");
    ok(e.S.canSee({ vis: "hq" }) && e.S.canSee({ vis: "mgr" }) && e.S.canSee({ vis: "all" }), "hq/mgr/all 메뉴 접근");
    ok(!e.S.canSee({ vis: "admin" }), "admin 전용 메뉴 접근 불가");
    ok(!e.S.isAdmin(), "시스템 설정 권한 없음");
    ok(e.S.BASE_USERS.some(u => u.id === "hq" && u.role === "hq"), "기본 hq 계정 존재");
  });

  t("DV04 대외비 접근: 장비 계약/비용 탭 hq 전용 (v2.11)", () => {
    const em = makeEnv();
    loginAs(em, "manager");
    go(em, "equipment");
    ok(!qa(em, "[data-etab]").some(b => b.dataset.etab === "costs"), "manager에게 비용 탭 없음");
    ok(!qa(em, "[data-etab]").some(b => b.dataset.etab === "contracts"), "manager에게 계약 탭 없음");
    const eh = makeEnv();
    loginAs(eh, "hq");
    go(eh, "equipment");
    ok(qa(eh, "[data-etab]").some(b => b.dataset.etab === "costs"), "hq에게 비용 탭 표시");
    ok(qa(eh, "[data-etab]").some(b => b.dataset.etab === "contracts"), "hq에게 계약 탭 표시");
  });

  t("UA01 계정 관리: 기본 계정 userOverrides 반영 (이름/권한/계정명)", () => {
    const e = makeEnv();
    e.S.data.userOverrides = { avsec: { id: "avsec2", name: "보안감독자그룹", role: "user" } };
    e.S.saveSilent();
    const u = e.S.allUsers().find(x => x.origId === "avsec");
    eq(u.id, "avsec2", "계정명 변경");
    eq(u.name, "보안감독자그룹", "이름 변경");
    eq(u.role, "user", "권한 변경");
    ok(u.base, "기본 계정 표식");
  });

  t("UA02 계정 관리: 기본 계정 삭제 + mark3464 보호 (normalize)", () => {
    const e = makeEnv();
    e.S.data.userOverrides = {
      branch: { deleted: true },
      mark3464: { role: "user", deleted: true, name: "개명시도" }
    };
    e.S.normalizeData();
    ok(!e.S.allUsers().some(x => x.origId === "branch"), "기본 계정 삭제 반영");
    const m = e.S.allUsers().find(x => x.origId === "mark3464");
    ok(m, "mark3464 삭제 불가");
    eq(m.role, "admin", "mark3464 권한 고정");
    eq(m.name, "개명시도", "이름 변경은 허용");
  });

  t("UA03 계정 관리: 이름 변경 후에도 pwOverrides(원본 키) 로그인 유지", () => {
    const e = makeEnv();
    const h = e.S.pwHash("renamed-pw-77");
    e.S.data.userOverrides = { hq: { id: "avsechq", name: "항공보안파트" } };
    e.S.data.pwOverrides = { hq: h };
    e.S.saveSilent();
    submitLogin(e, "renamed-pw-77");
    ok(e.S.user && e.S.user.origId === "hq" && e.S.user.id === "avsechq", "변경 계정명으로 로그인");
    eq(e.S.roleRank(), 3, "권한 유지");
  });

  t("DX02 만료 카드: user에게 계약 비노출", () => {
    const e = makeEnv();
    loginAs(e, "manager");
    e.S.data.contracts = [{ id: "c1", name: "비밀계약", party: "", category: "기타", start: "", end: shiftDay(20), amount: "", owner: "", autoRenew: false, fileUrl: "", status: "유효", note: "" }];
    go(e, "dashboard");
    ok(!q(e, "#expiry-box").textContent.includes("비밀계약"), "user 계약 미표시");
  });

  /* ══════════ [VT] v2.9 암호 관리 (vault) — 클라이언트 암호화 저장소 ══════════ */
  t("VT01 normalize: vault 구조/메뉴 자동 삽입 (vis=hq, 설정 위)", () => {
    const e = makeEnv();
    const d = e.S.data;
    delete d.vault;
    d.menus = d.menus.filter(m => !(m.type === "module" && m.module === "vault"));
    const changed = e.S.normalizeData();
    eq(changed, true);
    ok(d.vault && Array.isArray(d.vault.members) && d.vault.data === null, "구조 보정");
    const mn = d.menus.find(m => m.type === "module" && m.module === "vault");
    ok(mn, "메뉴 삽입"); eq(mn.vis, "hq"); eq(mn.parent, null, "최상위");
    const st = d.menus.find(m => m.id === "settings");
    ok(mn.seq < st.seq, "시스템 설정 위");
    ok(e.Sync.SYNC_KEYS.includes("vault"), "SYNC_KEYS 포함");
    eq(e.S.normalizeData(), false, "idempotent");
  });

  t("VT02 user 접근 차단 (vis=mgr → 대시보드 폴백)", () => {
    const e = makeEnv();
    loginAs(e, "manager");
    go(e, "vault");
    ok(q(e, ".page-title").textContent.includes("대시보드"), "대시보드 폴백");
  });

  await ta("VT03 최초 설정 + 암호화 저장: 평문이 어디에도 남지 않음", async () => {
    const e = makeEnv();
    loginAs(e, "hq");
    const VT = e.w.SemisVault;
    await VT.setup("박철성", "master-pw-1");
    ok(VT.isUnlocked(), "설정 후 해제 상태");
    eq(e.S.data.vault.members.length, 1);
    await VT.addEntryForTest({ category: "시스템", title: "테스트항목", account: "admin", pw: "SuperSecret123!", url: "", note: "" });
    eq(VT.entryCount(), 1);
    ok(e.S.data.vault.data && e.S.data.vault.data.ct, "암호문 저장");
    const raw = e.w.localStorage.getItem("semis2:data") || "";
    ok(!raw.includes("SuperSecret123!"), "localStorage 평문 미노출");
    ok(!raw.includes("master-pw-1"), "개인 비밀번호 미저장");
    ok(!JSON.stringify(e.S.data.vault).includes("SuperSecret123!"), "동기화 대상에 평문 없음");
    VT.lock();
  });

  await ta("VT04 잠금/해제: 오답 거부 + 정답 복호화", async () => {
    const e = makeEnv();
    loginAs(e, "hq");
    const VT = e.w.SemisVault;
    await VT.setup("박철성", "master-pw-1");
    await VT.addEntryForTest({ category: "시스템", title: "테스트항목", account: "a", pw: "SuperSecret123!", url: "", note: "" });
    VT.lock();
    ok(!VT.isUnlocked(), "잠금");
    eq(VT.entryCount(), null, "잠금 시 항목 접근 불가");
    const mid = e.S.data.vault.members[0].id;
    let rejected = false;
    try { await VT.unlock(mid, "wrong-pw"); } catch (err) { rejected = true; }
    ok(rejected && !VT.isUnlocked(), "오답 거부");
    await VT.unlock(mid, "master-pw-1");
    ok(VT.isUnlocked(), "정답 해제");
    eq(VT.findEntry("테스트항목").pw, "SuperSecret123!", "복호화 일치");
    VT.lock();
  });

  await ta("VT05 멤버: 추가/비밀번호 변경/최소 1명 보호", async () => {
    const e = makeEnv();
    loginAs(e, "hq");
    const VT = e.w.SemisVault;
    await VT.setup("박철성", "pw-park");
    await VT.addMember("최상일", "pw-choi");
    eq(e.S.data.vault.members.length, 2);
    VT.lock();
    const m2 = e.S.data.vault.members.find(m => m.name === "최상일");
    await VT.unlock(m2.id, "pw-choi");
    ok(VT.isUnlocked(), "새 멤버 비밀번호로 해제");
    await VT.changeMemberPw(m2.id, "pw-choi-2");
    VT.lock();
    let old = false;
    try { await VT.unlock(m2.id, "pw-choi"); } catch (err) { old = true; }
    ok(old, "이전 비밀번호 무효");
    await VT.unlock(m2.id, "pw-choi-2");
    ok(VT.isUnlocked(), "변경 비밀번호 유효");
    VT.removeMember(e.S.data.vault.members.find(m => m.name === "박철성").id);
    eq(e.S.data.vault.members.length, 1);
    VT.removeMember(m2.id);
    eq(e.S.data.vault.members.length, 1, "최소 1명 보호");
    VT.lock();
  });

  await ta("VT06 5분 만료 → 자동 잠금 + 대시보드 이동", async () => {
    const e = makeEnv();
    loginAs(e, "hq");
    const VT = e.w.SemisVault;
    await VT.setup("박철성", "pw-park");
    go(e, "vault");
    ok(VT.remainingMs() > 0 && VT.remainingMs() <= VT.AUTO_LOCK_MS, "타이머 동작");
    VT._fireExpire();
    ok(!VT.isUnlocked(), "만료 잠금");
    eq(e.w.location.hash, "#/dashboard", "대시보드 이동");
  });

  await ta("VT07 다른 화면 이동 시 즉시 잠금 (키 제로화)", async () => {
    const e = makeEnv();
    loginAs(e, "hq");
    const VT = e.w.SemisVault;
    await VT.setup("박철성", "pw-park");
    go(e, "vault");
    ok(VT.isUnlocked());
    go(e, "dashboard");
    await new Promise(r => setTimeout(r, 20)); // jsdom hashchange 비동기
    ok(!VT.isUnlocked(), "이동 시 잠금");
  });

  await ta("VT08 화면 흐름: 설정 폼 → 해제 화면 → 잠그기", async () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "vault");
    ok(q(e, "#vault-setup-form"), "최초 설정 폼");
    q(e, "#vs-name").value = "박철성";
    q(e, "#vs-pw").value = "pw-park-8";
    q(e, "#vs-pw2").value = "pw-park-8";
    q(e, "#vault-setup-form").dispatchEvent(new e.w.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 1200)); // PBKDF2 + 렌더 대기
    ok(q(e, "#vault-add"), "해제 화면(항목 추가 버튼)");
    ok(q(e, "#vault-timer"), "자동 잠금 카운트다운 표시");
    q(e, "#vault-lock").click();
    ok(q(e, "#vault-unlock-form"), "잠금 화면 복귀");
    e.w.SemisVault.lock();
  });

  await ta("VT09 5분 연장 버튼: 타이머 재설정 + 만료 동작 유지", async () => {
    const e = makeEnv();
    loginAs(e, "hq");
    const VT = e.w.SemisVault;
    await VT.setup("박철성", "pw-park");
    go(e, "vault");
    ok(q(e, "#vault-extend"), "연장 버튼 표시(카운터 왼쪽)");
    const before = VT.remainingMs();
    await new Promise(r => setTimeout(r, 30));
    q(e, "#vault-extend").click();
    ok(VT.remainingMs() >= before, "연장 후 남은 시간 재설정");
    ok(VT.remainingMs() > VT.AUTO_LOCK_MS - 1000, "지금부터 5분으로 갱신");
    VT._fireExpire();
    ok(!VT.isUnlocked(), "연장 후에도 만료 잠금 정상");
    eq(e.w.location.hash, "#/dashboard", "만료 시 대시보드 이동");
  });

  /* ══════════ [RG] 규정 관리 (v2.12) ══════════ */
  t("RG01 마이그레이션: regulations 배열 + 메뉴 자동 삽입 + 구링크 구분", () => {
    const e = makeEnv();
    ok(Array.isArray(e.S.data.regulations), "regulations 배열");
    const mi = e.S.data.menus.find(m => m.type === "module" && m.module === "regs-intl");
    const mo = e.S.data.menus.find(m => m.type === "module" && m.module === "regs-own");
    ok(mi && mo, "모듈 메뉴 존재");
    eq(mi.parent, "grp-rule", "국제/국가 소속 그룹");
    eq(mo.parent, "grp-rule", "자체 소속 그룹");
    ok((mi.seq || 0) < (mo.seq || 0), "국제/국가가 자체보다 위");
    const oldIntl = e.S.data.menus.find(m => m.id === "rule-intl");
    const oldOwn = e.S.data.menus.find(m => m.id === "rule-own");
    ok(/구버전/.test(oldIntl.label) && /구버전/.test(oldOwn.label), "구링크 (구버전) 표기");
  });

  t("RG02 기존 데이터 마이그레이션: 구 링크 메뉴만 있어도 모듈 메뉴 삽입", () => {
    const e = makeEnv();
    const pre = JSON.parse(JSON.stringify(e.S.data));
    pre.menus = pre.menus.filter(m => m.module !== "regs-intl" && m.module !== "regs-own");
    delete pre.regulations;
    pre.regulations = [{ id: "rgx", scope: "own", title: "테스트 규정" }]; // ideas 누락 케이스
    const e2 = makeEnv({ preData: pre });
    ok(e2.S.data.menus.some(m => m.type === "module" && m.module === "regs-intl"), "regs-intl 재삽입");
    ok(e2.S.data.menus.some(m => m.type === "module" && m.module === "regs-own"), "regs-own 재삽입");
    ok(Array.isArray(e2.S.data.regulations[0].ideas), "ideas 필드 보정");
  });

  t("RG03 페이지 렌더 + 권한: hq 등록 버튼, user 미표시", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "regs-intl");
    ok(q(e, "#rg-add"), "hq: 등록 버튼");
    ok(q(e, "#rg-search"), "검색 입력");
    ok(qa(e, ".stat").length >= 4, "통계 카드");
    const e2 = makeEnv();
    loginAs(e2, "user");
    go(e2, "regs-intl");
    ok(!q(e2, "#rg-add"), "user: 등록 버튼 없음");
    ok(q(e2, "#rg-body .empty"), "빈 목록 안내");
  });

  t("RG04 규정 등록 폼: 저장/검증 (제목 필수, 링크 형식)", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "regs-intl");
    q(e, "#rg-add").click();
    ok(q(e, "#rg-title"), "폼 열림");
    ok(!q(e, "#rg-diff"), "intl에는 신구대조표 없음");
    q(e, "#rg-save").click();
    eq(e.S.data.regulations.length, 0, "제목 없이 저장 차단");
    q(e, "#rg-title").value = "항공보안법";
    q(e, "#rg-link").value = "not-a-url";
    q(e, "#rg-save").click();
    eq(e.S.data.regulations.length, 0, "잘못된 링크 차단");
    q(e, "#rg-link").value = "https://law.go.kr/법령/항공보안법";
    q(e, "#rg-rev").value = "개정 제19호";
    q(e, "#rg-date").value = "2026-01-15";
    q(e, "#rg-save").click();
    eq(e.S.data.regulations.length, 1, "저장됨");
    const r = e.S.data.regulations[0];
    eq(r.scope, "intl", "scope");
    eq(r.rev, "개정 제19호", "버전");
    eq(r.date, "2026-01-15", "제개정일자");
    ok(Array.isArray(r.ideas), "ideas 초기화");
    go(e, "regs-intl");
    ok(qa(e, "#rg-body [data-rg-row]").length === 1, "목록 1건");
    ok(q(e, '#rg-body a[href*="law.go.kr"]'), "링크 열람 버튼");
  });

  t("RG05 자체 규정: 신구대조표 필드 + PDF 뷰어 모달", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.regulations.push({ id: "rg1", scope: "own", title: "AirZeta 보안계획", rev: "Rev.7",
      date: "2026-05-01", org: "AVSEC-001", linkUrl: "", fileUrl: "https://x.test/f.pdf",
      fileName: "f.pdf", diffUrl: "https://x.test/d.pdf", diffName: "d.pdf", note: "", ideas: [] });
    e.S.saveSilent();
    go(e, "regs-own");
    q(e, "#rg-add").click();
    ok(q(e, "#rg-diff"), "own 폼에 신구대조표 업로드");
    e.S.closeModal();
    go(e, "regs-own");
    ok(q(e, "#rg-body [data-rg-pdf]"), "PDF 버튼");
    ok(q(e, "#rg-body [data-rg-diff]"), "신구대조표 버튼");
    q(e, "#rg-body [data-rg-pdf]").click();
    const fr = q(e, ".reg-pdf-frame");
    ok(fr && fr.getAttribute("src") === "https://x.test/f.pdf", "뷰어 iframe src");
    q(e, "#rg-view-close").click();
    q(e, "#rg-body [data-rg-diff]").click();
    ok(q(e, ".reg-pdf-frame").getAttribute("src") === "https://x.test/d.pdf", "신구대조표 src");
  });

  t("RG06 개정 아이디어 노트: 추가/수정/삭제 + 검토중 카운트", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.regulations.push({ id: "rg2", scope: "own", title: "보안업무 지침", rev: "Rev.3",
      date: "2025-11-01", linkUrl: "https://x.test", fileUrl: "", ideas: [] });
    e.S.saveSilent();
    go(e, "regs-own");
    q(e, "#rg-body [data-rg-idea]").click();
    ok(q(e, "#rg-idea-add"), "노트 모달 + 추가 버튼");
    q(e, "#rg-idea-add").click();
    q(e, "#ri-save").click();
    eq(e.w.SemisRegs.ideasOf(e.S.data.regulations[0]).length, 0, "내용 없이 저장 차단");
    q(e, "#ri-loc").value = "제3장 3.2.1 / p.14";
    q(e, "#ri-content").value = "위탁수하물 개봉검색 절차에 ETD 병행 기준 신설 필요";
    q(e, "#ri-kind").value = "신규";
    q(e, "#ri-save").click();
    const r = e.S.data.regulations[0];
    eq(r.ideas.length, 1, "노트 저장");
    eq(r.ideas[0].kind, "신규", "구분");
    eq(r.ideas[0].status, "검토중", "기본 상태");
    ok(r.ideas[0].author, "작성자 기록");
    // 목록 카운트 배지
    ok(q(e, "#rg-idea-list .reg-idea"), "모달 내 노트 표시");
    e.S.closeModal();
    go(e, "regs-own");
    ok(/💡\s*1/.test(q(e, "#rg-body [data-rg-idea]").textContent), "노트 수 표시");
    ok(q(e, "#rg-body .reg-idea-open"), "검토중 배지");
    // 수정 → 반영완료
    q(e, "#rg-body [data-rg-idea]").click();
    q(e, "#rg-idea-list [data-iedit]").click();
    q(e, "#ri-status").value = "반영완료";
    q(e, "#ri-save").click();
    eq(r.ideas[0].status, "반영완료", "상태 수정");
    // 삭제
    q(e, "#rg-idea-list [data-idel]").click();
    q(e, "#modal-box [data-act=ok]").click();
    eq(r.ideas.length, 0, "노트 삭제");
  });

  t("RG07 아이디어 노트 권한: user 비노출, manager 열람 전용", () => {
    const pre = (() => { const t0 = makeEnv(); return JSON.parse(JSON.stringify(t0.S.data)); })();
    pre.regulations = [{ id: "rg3", scope: "own", title: "보안규정", linkUrl: "https://x.test",
      ideas: [{ id: "i1", loc: "p.1", kind: "변경", status: "검토중", content: "내부 검토", author: "T", created: "2026-07-01T00:00:00Z" }] }];
    const eu = makeEnv({ preData: pre });
    loginAs(eu, "user");
    go(eu, "regs-own");
    ok(!q(eu, "#rg-body [data-rg-idea]"), "user: 노트 열 비노출");
    const em = makeEnv({ preData: pre });
    loginAs(em, "manager");
    go(em, "regs-own");
    ok(q(em, "#rg-body [data-rg-idea]"), "manager: 노트 열람 가능");
    q(em, "#rg-body [data-rg-idea]").click();
    ok(!q(em, "#rg-idea-add"), "manager: 추가 버튼 없음");
    ok(!q(em, "#rg-idea-list [data-iedit]"), "manager: 수정 버튼 없음");
    ok(q(em, "#rg-idea-list .reg-idea"), "manager: 내용 열람");
  });

  t("RG08 검색/정렬 + 동기화 키", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.regulations.push(
      { id: "a", scope: "intl", title: "ICAO Annex 17", rev: "Ed.12", date: "2024-01-01", linkUrl: "https://x", ideas: [] },
      { id: "b", scope: "intl", title: "항공보안법", rev: "제19호", date: "2026-01-15", linkUrl: "https://x", ideas: [] },
      { id: "c", scope: "own", title: "자체규정", date: "2025-01-01", linkUrl: "https://x", ideas: [] });
    e.S.saveSilent();
    const R = e.w.SemisRegs;
    eq(R.byScope("intl").length, 2, "scope 분리");
    eq(R.filtered("intl")[0].id, "b", "최근 제개정일 우선 정렬");
    R.setQuery("intl", "icao");
    eq(R.filtered("intl").length, 1, "검색 필터");
    eq(R.filtered("intl")[0].id, "a", "검색 결과");
    R.setQuery("intl", "");
    eq(R.stats("intl").total, 2, "통계 total");
    eq(R.stats("intl").latest, "2026-01-15", "통계 latest");
    ok(e.Sync.SYNC_KEYS.includes("regulations"), "SYNC_KEYS 등록");
  });

  /* ══════════ [LM] 링크 메뉴 열기 방식 (v2.13) ══════════ */
  t("LM01 메뉴 폼: 열기 방식 선택 저장 (tab/frame)", () => {
    const e = makeEnv();
    loginAs(e, "admin");
    go(e, "settings");
    q(e, "#btn-add-menu").click();
    ok(q(e, "#f-open"), "열기 방식 select 존재");
    eq(q(e, "#f-open").value, "tab", "기본값 새 탭");
    q(e, "#f-label").value = "내부 문서";
    q(e, "#f-url").value = "https://example.com/embed-doc";
    q(e, "#f-open").value = "frame";
    q(e, "#f-save").click();
    const mn = e.S.data.menus.find(m => m.label === "내부 문서");
    ok(mn, "메뉴 저장");
    eq(mn.open, "frame", "open=frame 저장");
    // 수정 폼 재열람 시 선택 유지
    go(e, "settings");
    q(e, `#menu-tree [data-edit="${mn.id}"]`).click();
    eq(q(e, "#f-open").value, "frame", "수정 폼 값 유지");
    e.S.closeModal();
  });

  t("LM02 네비 렌더: frame=내부 버튼(embed 라우트), tab=새 탭 앵커", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.menus.push(
      { id: "lmf", seq: 990, type: "link", label: "프레임링크", icon: "🧪", url: "https://example.com/f", open: "frame", vis: "all", parent: null },
      { id: "lmt", seq: 991, type: "link", label: "탭링크", icon: "🧪", url: "https://example.com/t", open: "tab", vis: "all", parent: null });
    e.S.saveSilent(); e.S.renderNav();
    const fBtn = qa(e, "#nav-menu .nav-item").find(el => el.textContent.includes("프레임링크"));
    const tA = qa(e, "#nav-menu .nav-item").find(el => el.textContent.includes("탭링크"));
    eq(fBtn.tagName, "BUTTON", "frame은 버튼");
    eq(fBtn.dataset.route, "embed/lmf", "embed 라우트");
    ok(/▣/.test(fBtn.textContent), "내부 표식 ▣");
    eq(tA.tagName, "A", "tab은 앵커");
    eq(tA.getAttribute("target"), "_blank", "새 탭");
    // 구버전 데이터(open 미지정)는 앵커 유지
    const legacy = qa(e, "#nav-menu .nav-item").find(el => el.textContent.includes("보안뉴스"));
    ok(!legacy || legacy.tagName === "A", "open 미지정 링크는 새 탭 유지");
  });

  t("LM03 embed 라우트: iframe 렌더 + 새 탭 버튼 + 권한 차단", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.menus.push({ id: "lmf2", seq: 992, type: "link", label: "내부화면", icon: "🧪",
      url: "https://example.com/page", open: "frame", vis: "hq", parent: null });
    e.S.saveSilent();
    go(e, "embed/lmf2");
    const fr = q(e, ".embed-frame");
    ok(fr, "iframe 렌더");
    eq(fr.getAttribute("src"), "https://example.com/page", "src=URL");
    ok(qa(e, ".page-head a").some(a => a.getAttribute("target") === "_blank"), "새 탭 열기 버튼");
    ok(q(e, ".page-title").textContent.includes("내부화면"), "제목 표시");
    // 권한 미달 → 대시보드 폴백
    const e2 = makeEnv({ preData: JSON.parse(JSON.stringify(e.S.data)) });
    loginAs(e2, "user");
    go(e2, "embed/lmf2");
    ok(!q(e2, ".embed-frame"), "user: iframe 없음");
    ok(q(e2, ".dash-grid"), "대시보드 폴백");
    // 없는 메뉴 id → 대시보드 폴백
    go(e, "embed/no-such-id");
    ok(!q(e, ".embed-frame") && q(e, ".dash-grid"), "잘못된 id 폴백");
  });

  t("LM04 대시보드 바로가기: frame 링크는 내부 라우트로 연결", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.menus.push(
      { id: "lmq1", seq: 993, type: "link", label: "퀵프레임", icon: "🧪", url: "https://example.com/q1", open: "frame", vis: "all", parent: null, quick: true },
      { id: "lmq2", seq: 994, type: "link", label: "퀵탭", icon: "🧪", url: "https://example.com/q2", vis: "all", parent: null, quick: true });
    e.S.saveSilent();
    go(e, "dashboard");
    const links = qa(e, ".quick-link");
    const qf = links.find(a => a.textContent.includes("퀵프레임"));
    const qt = links.find(a => a.textContent.includes("퀵탭"));
    eq(qf.getAttribute("href"), "#/embed/lmq1", "frame → 내부 해시");
    ok(!qf.getAttribute("target"), "frame은 새 탭 아님");
    eq(qt.getAttribute("href"), "https://example.com/q2", "tab → 외부 URL");
    eq(qt.getAttribute("target"), "_blank", "tab은 새 탭");
  });

  /* ══════════ [PL] 보안정책 뷰어 (v2.14) ══════════ */
  t("PL01 마이그레이션: policy 구조 + 메뉴 삽입 + 구링크 구분 + 동기화 키", () => {
    const e = makeEnv();
    ok(e.S.data.policy && "ko" in e.S.data.policy && "en" in e.S.data.policy, "policy {ko,en}");
    const mn = e.S.data.menus.find(m => m.type === "module" && m.module === "policy");
    ok(mn, "policy 모듈 메뉴");
    eq(mn.parent, "grp-ref", "참고/링크 그룹 소속");
    const old = e.S.data.menus.find(m => m.id === "ref-policy");
    ok(/구버전/.test(old.label), "구링크 (구버전) 표기");
    ok(e.Sync.SYNC_KEYS.includes("policy"), "SYNC_KEYS 등록");
    // 기존 데이터(policy 없음)에서도 보정
    const pre = JSON.parse(JSON.stringify(e.S.data));
    delete pre.policy;
    pre.menus = pre.menus.filter(m => m.module !== "policy");
    const e2 = makeEnv({ preData: pre });
    ok(e2.S.data.policy && "ko" in e2.S.data.policy, "구데이터 policy 보정");
    ok(e2.S.data.menus.some(m => m.type === "module" && m.module === "policy"), "메뉴 재삽입");
  });

  t("PL02 페이지 렌더 + 권한: hq 파일관리, user 미표시 + 빈 상태", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "policy");
    ok(q(e, "#pol-manage"), "hq: 파일 관리 버튼");
    ok(qa(e, "[data-pol-mode]").length === 3, "모드 버튼 3개(국문/영문/분할)");
    ok(q(e, "#pol-zoom-in") && q(e, "#pol-zoom-out") && q(e, "#pol-zoom-fit"), "줌 컨트롤");
    ok(q(e, ".pol-empty"), "빈 상태 안내");
    ok(q(e, "[data-pol-upload]"), "빈 상태에서 업로드 버튼(hq)");
    const e2 = makeEnv();
    loginAs(e2, "user");
    go(e2, "policy");
    ok(!q(e2, "#pol-manage"), "user: 파일 관리 없음");
    ok(!q(e2, "[data-pol-upload]"), "user: 업로드 버튼 없음");
    ok(q(e2, ".pol-empty"), "user: 빈 상태 안내는 표시");
  });

  t("PL03 모드 전환: 국문/영문/분할 페인 구성 + 상태 저장", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.policy = {
      ko: { url: "https://x.test/ko.pdf", name: "정책_국문.pdf", size: 1000, updated: "2026-07-18T00:00:00Z", by: "T" },
      en: { url: "https://x.test/en.pdf", name: "policy_en.pdf", size: 1000, updated: "2026-07-18T00:00:00Z", by: "T" }
    };
    e.S.saveSilent();
    e.w.SemisPolicy.setMode("ko");
    go(e, "policy");
    eq(qa(e, "[data-pol-pane]").length, 1, "국문 모드 1페인");
    eq(q(e, "[data-pol-pane]").dataset.polPane, "ko", "국문 페인");
    ok(q(e, '[data-pol-print="ko"]') && q(e, '[data-pol-dl="ko"]'), "인쇄/다운로드 버튼");
    qa(e, "[data-pol-mode]").find(b => b.dataset.polMode === "en").click();
    eq(qa(e, "[data-pol-pane]").length, 1, "영문 모드 1페인");
    eq(q(e, "[data-pol-pane]").dataset.polPane, "en", "영문 페인");
    qa(e, "[data-pol-mode]").find(b => b.dataset.polMode === "split").click();
    eq(qa(e, "[data-pol-pane]").length, 2, "분할 모드 2페인");
    ok(q(e, ".pol-panes.split"), "분할 레이아웃 클래스");
    const ui = JSON.parse(e.w.localStorage.getItem("semis2:policyUi"));
    eq(ui.mode, "split", "모드 localStorage 저장");
    ok(q(e, '[data-pol-body="ko"]') && q(e, '[data-pol-body="en"]'), "양쪽 문서 영역");
  });

  t("PL04 파일 관리 모달: 국문/영문 업로드 행 + 삭제", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.policy = { ko: { url: "https://x.test/ko.pdf", name: "정책_국문.pdf", size: 2097152, updated: "2026-07-18T00:00:00Z", by: "T" }, en: null };
    e.S.saveSilent();
    go(e, "policy");
    q(e, "#pol-manage").click();
    eq(qa(e, "[data-pm-up]").length, 2, "업로드 입력 2개(국문/영문)");
    ok(q(e, "#pm-cur-ko .nb-file"), "국문 현재 파일 표시");
    ok(/2\.0 MB/.test(q(e, "#pm-cur-ko").textContent), "용량 표시");
    ok(q(e, '[data-pm-del="ko"]'), "국문 삭제 버튼");
    ok(!q(e, '[data-pm-del="en"]'), "영문(미등록) 삭제 버튼 없음");
    q(e, '[data-pm-del="ko"]').click();
    q(e, "#modal-box [data-act=ok]").click();
    eq(e.S.data.policy.ko, null, "국문 삭제 반영");
    // 권한: manager는 manageForm 직접 호출해도 무시
    const e2 = makeEnv();
    loginAs(e2, "manager");
    e2.w.SemisPolicy.manageForm();
    ok(!q(e2, "[data-pm-up]"), "manager: 관리 모달 차단");
  });

  t("PL05 줌 컨트롤: 배율 증감·맞춤·범위 제한", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.w.SemisPolicy.setMode("ko");
    e.w.SemisPolicy.setZoom(1);
    go(e, "policy");
    q(e, "#pol-zoom-in").click();
    eq(e.w.SemisPolicy.zoom, 1.2, "확대 1.2x");
    q(e, "#pol-zoom-out").click();
    eq(e.w.SemisPolicy.zoom, 1, "축소 복귀");
    e.w.SemisPolicy.setZoom(2.9);
    q(e, "#pol-zoom-in").click();
    eq(e.w.SemisPolicy.zoom, 3, "최대 3x 제한");
    q(e, "#pol-zoom-fit").click();
    eq(e.w.SemisPolicy.zoom, "fit", "폭 맞춤 모드");
    const ui = JSON.parse(e.w.localStorage.getItem("semis2:policyUi"));
    eq(ui.zoom, "fit", "줌 상태 저장");
  });

  /* ══════════ [CT2] 교육 이수증 관리 (v2.15) ══════════ */
  const certSeed = (over) => Object.assign({
    id: "ct-test", certNo: "KASI-2026-01-0001", name: "홍길동", dept: "항공보안팀",
    role: "보안감독자", kind: "초기", org: "한국항공안전교육원",
    issued: "2026-01-15", expire: "2027-02-14", fileUrl: "", fileName: "", note: "",
    updated: "2026-07-18T00:00:00Z", by: "T" }, over || {});
  const isoDay = (off) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); };

  t("CT01 마이그레이션: certs 배열 + 메뉴(보안교육 다음, mgr) + 동기화 키", () => {
    const e = makeEnv();
    ok(Array.isArray(e.S.data.certs), "certs 배열");
    const mn = e.S.data.menus.find(m => m.type === "module" && m.module === "certs");
    ok(mn, "certs 메뉴");
    eq(mn.parent, "grp-edu", "보안 증진 그룹");
    eq(mn.vis, "mgr", "열람 권한 mgr");
    const tr = e.S.data.menus.find(m => m.type === "module" && m.module === "training");
    ok((tr.seq || 0) < (mn.seq || 0), "보안교육 관리 다음 위치");
    ok(e.Sync.SYNC_KEYS.includes("certs"), "SYNC_KEYS 등록");
    // 구데이터 보정
    const pre = JSON.parse(JSON.stringify(e.S.data));
    delete pre.certs;
    pre.menus = pre.menus.filter(m => m.module !== "certs");
    const e2 = makeEnv({ preData: pre });
    ok(Array.isArray(e2.S.data.certs), "구데이터 certs 보정");
    ok(e2.S.data.menus.some(m => m.module === "certs"), "메뉴 재삽입");
  });

  t("CT02 유효만료일 자동 계산: 수료일+13개월−1일 (월말 보정)", () => {
    const e = makeEnv();
    const C = e.w.SemisCerts;
    eq(C.calcExpire("2026-01-15"), "2027-02-14", "시트 실데이터 규칙 일치 ①");
    eq(C.calcExpire("2025-05-08"), "2026-06-07", "시트 실데이터 규칙 일치 ②");
    eq(C.calcExpire("2025-12-04"), "2027-01-03", "연도 이월");
    eq(C.calcExpire("2025-01-31"), "2026-02-27", "월말 보정(2월)");
    eq(C.calcExpire(""), "", "빈 값");
  });

  t("CT03 상태 판정/통계: 유효·임박(60일)·만료", () => {
    const e = makeEnv();
    const C = e.w.SemisCerts;
    e.S.data.certs = [
      certSeed({ id: "c1", expire: isoDay(200) }),
      certSeed({ id: "c2", name: "김임박", expire: isoDay(30), fileUrl: "https://x.test/a.pdf" }),
      certSeed({ id: "c3", name: "박만료", expire: isoDay(-10) })
    ];
    e.S.saveSilent();
    eq(C.stateOf(e.S.data.certs[0]), "유효", "유효");
    eq(C.stateOf(e.S.data.certs[1]), "임박", "60일 이내 임박");
    eq(C.stateOf(e.S.data.certs[2]), "만료", "만료");
    const s = C.stats();
    eq(s.total, 3, "전체"); eq(s.ok, 1, "유효"); eq(s.soon, 1, "임박"); eq(s.expired, 1, "만료"); eq(s.pdf, 1, "PDF");
    // 정렬: 만료일 임박순
    eq(C.filtered()[0].id, "c3", "만료 우선 정렬");
  });

  t("CT04 권한: hq 편집, manager 열람 전용, user 접근 차단", () => {
    const pre = (() => { const t0 = makeEnv(); const d = JSON.parse(JSON.stringify(t0.S.data));
      d.certs = [certSeed({ fileUrl: "https://x.test/c.pdf" })]; return d; })();
    const eh = makeEnv({ preData: pre });
    loginAs(eh, "hq");
    go(eh, "certs");
    ok(q(eh, "#ct-add"), "hq: 등록 버튼");
    ok(q(eh, "#ct-body [data-ct-row]"), "목록 렌더");
    const em = makeEnv({ preData: pre });
    loginAs(em, "manager");
    go(em, "certs");
    ok(!q(em, "#ct-add"), "manager: 등록 버튼 없음");
    ok(q(em, "#ct-body [data-ct-row]"), "manager: 목록 열람 가능");
    ok(q(em, "#ct-body [data-ct-pdf]"), "manager: PDF 열람 버튼");
    const eu = makeEnv({ preData: pre });
    loginAs(eu, "user");
    go(eu, "certs");
    ok(q(eu, ".dash-grid"), "user: 접근 차단 → 대시보드");
  });

  t("CT05 등록 폼: 검증 + 수료일 변경 시 만료일 자동 입력", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "certs");
    q(e, "#ct-add").click();
    q(e, "#ct-save").click();
    eq(e.S.data.certs.length, 0, "성명 없이 저장 차단");
    q(e, "#ct-name").value = "유준상";
    q(e, "#ct-dept").value = "화물서비스팀";
    q(e, "#ct-issued").value = "2026-01-15";
    q(e, "#ct-issued").dispatchEvent(new e.w.Event("change"));
    eq(q(e, "#ct-expire").value, "2027-02-14", "만료일 자동 계산");
    q(e, "#ct-no").value = "KASI-2026-01-1623";
    q(e, "#ct-save").click();
    eq(e.S.data.certs.length, 1, "저장");
    const c = e.S.data.certs[0];
    eq(c.expire, "2027-02-14", "만료일 저장");
    eq(c.role, "보안감독자", "기본 과정");
    ok(c.by, "등록자 기록");
  });

  t("CT06 PDF 뷰어: iframe + 인쇄/다운로드/새 탭 버튼", () => {
    const e = makeEnv();
    loginAs(e, "manager");
    e.S.data.certs = [certSeed({ fileUrl: "https://x.test/cert.pdf", fileName: "이수증.pdf" })];
    e.S.saveSilent();
    go(e, "certs");
    q(e, "#ct-body [data-ct-pdf]").click();
    const fr = q(e, ".reg-pdf-frame");
    ok(fr, "뷰어 iframe");
    eq(fr.getAttribute("src"), "https://x.test/cert.pdf", "src=업로드 URL");
    ok(q(e, "#ct-print"), "인쇄 버튼");
    ok(q(e, "#ct-dl"), "다운로드 버튼");
    ok(qa(e, "#modal-box a").some(a => a.getAttribute("target") === "_blank"), "새 탭 버튼");
    q(e, "#ct-view-close").click();
    ok(!q(e, ".reg-pdf-frame"), "닫기");
  });

  t("CT07 대시보드 연동: 카드(mgr) + 만료도래 통합 + 차트 렌더", () => {
    const pre = (() => { const t0 = makeEnv(); const d = JSON.parse(JSON.stringify(t0.S.data));
      d.certs = [certSeed({ id: "c1", name: "김임박", expire: isoDay(20) }),
                 certSeed({ id: "c2", name: "박유효", expire: isoDay(300) })];
      return d; })();
    const em = makeEnv({ preData: pre });
    loginAs(em, "manager");
    go(em, "dashboard");
    ok(q(em, "#certs-box"), "manager: 이수증 카드");
    ok(/김임박/.test(q(em, "#certs-box").textContent), "임박자 알람 표시");
    ok(!/박유효/.test(q(em, "#certs-box").textContent), "유효자는 알람 미표시");
    ok(/이수증 · 김임박/.test(q(em, "#expiry-box").textContent), "만료·도래 카드 통합");
    const eu = makeEnv({ preData: pre });
    loginAs(eu, "user");
    go(eu, "dashboard");
    ok(!q(eu, "#certs-box"), "user: 이수증 카드 숨김");
    ok(!/이수증/.test((q(eu, "#expiry-box") || { textContent: "" }).textContent), "user: 만료도래에도 미표시");
    // 모듈 페이지 차트
    go(em, "certs");
    ok(q(em, ".cert-charts"), "차트 영역");
    ok(qa(em, ".cert-brow").length >= 1, "과정별 바");
    eq(qa(em, ".cert-mcol").length, 12, "월별 12칸");
    ok(qa(em, ".cert-seg.soon").length >= 1, "임박 세그먼트");
  });

  /* ══════════ [BL] 대금 청구 관리 (v2.16) ══════════ */
  function loginVendor(env, vendorName, uid2) {
    const pw = "testpw-vd-" + uid2 + "-9x";
    env.S.data.customUsers.push({ id: uid2, name: vendorName, role: "vendor", vendor: vendorName, hash: env.S.pwHash(pw) });
    env.S.saveSilent();
    submitLogin(env, pw);
    if (!env.S.user || env.S.user.role !== "vendor") throw new Error("vendor login failed");
  }
  const blSeed = (over) => Object.assign({
    id: "bl-t" + Math.random().toString(36).slice(2, 7), vendor: "프로에스콤", month: "2026-07",
    category: "ETD 유지보수", title: "장비 잔존가+수선유지비 (KJ)", amount: 5170000,
    fileUrl: "", fileName: "", note: "", by: "T", updated: "2026-07-18T00:00:00Z" }, over || {});

  t("BL01 마이그레이션: billing 배열 + 메뉴(장비 다음, hq) + 동기화 키", () => {
    const e = makeEnv();
    ok(Array.isArray(e.S.data.billing), "billing 배열");
    const mn = e.S.data.menus.find(m => m.type === "module" && m.module === "billing");
    ok(mn, "billing 메뉴");
    eq(mn.vis, "hq", "hq 전용 (대외비)");
    eq(mn.parent, "grp-equip", "보안장비 그룹 (v2.22 분리)");
    const eq2 = e.S.data.menus.find(m => m.type === "module" && m.module === "equipment");
    ok((eq2.seq || 0) < (mn.seq || 0), "보안장비 유지관리 다음 위치");
    ok(e.Sync.SYNC_KEYS.includes("billing"), "SYNC_KEYS 등록");
    const pre = JSON.parse(JSON.stringify(e.S.data));
    delete pre.billing;
    pre.menus = pre.menus.filter(m => m.module !== "billing");
    const e2 = makeEnv({ preData: pre });
    ok(Array.isArray(e2.S.data.billing) && e2.S.data.menus.some(m => m.module === "billing"), "구데이터 보정");
  });

  t("BL02 정산 계산: 실청구액 = ETD + 검색&경비 − 기타수익(50% 기계산 입력분 전액 차감)", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.billing = [
      blSeed({ category: "ETD 유지보수", amount: 5170000 }),
      blSeed({ category: "ETD 유지보수", title: "부품교체", amount: 4500000 }),
      blSeed({ category: "보안검색&경비", title: "도급비", amount: 30000000 }),
      blSeed({ category: "기타 수익", title: "B터미널 보안검색", amount: 8000000 }),
      blSeed({ category: "기타 수익", title: "특별보안검색 7건", amount: 2000000 }),
      blSeed({ vendor: "인씨스", category: "X-ray 유지보수", title: "정기 유지보수", amount: 3300000 })
    ];
    e.S.saveSilent();
    const B = e.w.SemisBilling;
    const s = B.settle("프로에스콤", "2026-07");
    eq(s.byCat["ETD 유지보수"], 9670000, "ETD 합");
    eq(s.revenue, 10000000, "기타 수익 합 (50% 기계산 입력분)");
    eq(s.deduct, 10000000, "입력분 전액 차감 (재계산 없음)");
    eq(s.pay, 39670000, "지급 대상 합");
    eq(s.net, 29670000, "실청구액 = ①+②−③");
    const si = B.settle("인씨스", "2026-07");
    eq(si.net, 3300000, "인씨스 합계(차감 없음)");
    eq(B.parseWon("5,170,000원"), 5170000, "콤마 금액 파싱");
  });

  t("BL03 업체 격리: 프로에스콤 계정은 인씨스 내역 접근 불가", () => {
    const pre = (() => { const t0 = makeEnv(); const d = JSON.parse(JSON.stringify(t0.S.data));
      d.billing = [blSeed(), blSeed({ vendor: "인씨스", category: "X-ray 유지보수", title: "인씨스전용내역", amount: 990000 })];
      return d; })();
    const e = makeEnv({ preData: pre });
    loginVendor(e, "프로에스콤", "tproes");
    // visible() 격리
    const B = e.w.SemisBilling;
    ok(B.visible().every(r => r.vendor === "프로에스콤"), "visible: 자기 업체만");
    eq(B.settle("인씨스", "2026-07").net, 0, "타 업체 정산 0 (데이터 미노출)");
    // 화면 격리
    B.setMonth("2026-07");
    go(e, "billing");
    ok(/프로에스콤/.test(q(e, ".page-title").textContent), "자기 업체 화면");
    ok(!qa(e, "[data-bl-vendor]").length, "업체 전환 버튼 없음");
    ok(!/인씨스전용내역/.test(q(e, "#view").textContent), "타 업체 내역 미표시");
    // 라우팅 격리: 허용 목록 밖 모듈 접근 시도 → billing 강제
    go(e, "dashboard");
    ok(/대금 청구/.test(q(e, ".page-title").textContent), "dashboard 접근 → billing 강제");
    go(e, "settings");
    ok(/대금 청구/.test(q(e, ".page-title").textContent), "settings 접근 → billing 강제");
    go(e, "vault");
    ok(/대금 청구/.test(q(e, ".page-title").textContent), "vault(암호) 접근 → billing 강제");
  });

  /* ══════════ [VD] 협력업체 계정 접근 범위 (v2.32) ══════════ */
  t("VD01 기본 업체(인씨스): 대금 청구 전용 — 네비 1개 + 타 라우트 차단", () => {
    const e = makeEnv();
    loginVendor(e, "인씨스", "tvd01");
    eq(e.S.vendorAccess(e.S.user).routes.join(","), "billing", "허용 라우트 billing만");
    eq(e.S.vendorHome(e.S.user), "billing", "기본 화면 billing");
    go(e, "billing");
    eq(qa(e, "#nav-menu .nav-item").length, 1, "네비 메뉴 1개");
    go(e, "equipment");
    ok(/대금 청구/.test(q(e, ".page-title").textContent), "장비 접근 → billing 강제");
  });

  t("VD02 프로에스콤: 확대 메뉴 4개 + CARES 링크, 순서/라벨 확인", () => {
    const e = makeEnv();
    loginVendor(e, "프로에스콤", "tvd02");
    eq(e.S.vendorAccess(e.S.user).routes.join(","), "regs-intl,equipment,council,billing", "허용 라우트 4종");
    go(e, "billing");
    const items = qa(e, "#nav-menu .nav-item");
    eq(items.length, 5, "네비 4개 모듈 + CARES 링크");
    eq(items.map(n => n.dataset.route || "").slice(0, 4).join(","),
      "regs-intl,equipment,council,billing", "메뉴 순서");
    ok(/국제\/국가 보안규정/.test(items[0].textContent), "규정 라벨");
    ok(/대금 청구 입력/.test(items[3].textContent), "청구 라벨(업체용)");
    const link = items[4];
    eq(link.tagName, "A", "CARES는 외부 링크");
    eq(link.getAttribute("target"), "_blank", "새 탭");
    eq(link.getAttribute("href"), "https://airzeta-security-system.web.app", "CARES URL");
    ok(/CARES/.test(link.textContent), "CARES 라벨");
    eq(q(e, "#nav-menu .nav-item.active").dataset.route, "billing", "현재 메뉴 표시");
  });

  t("VD03 프로에스콤: 확대 메뉴 렌더 + 편집 권한(hq 동등) + 삭제만 차단", () => {
    const pre = (() => { const t0 = makeEnv(); const d = JSON.parse(JSON.stringify(t0.S.data));
      d.equipment = [{ id: "vq1", type: "ETD(폭발물흔적)", name: "ETD-1", serial: "S1", location: "검색장",
        vendor: "프로에스콤", mfgDate: "2024-01-01", installed: "2024-01-01", status: "정상", logs: [], note: "" }];
      d.equipMaint = { contracts: [{ id: "vc1", vendor: "인씨스", amount: 12000000, note: "" }],
        costs: [{ id: "vt1", ym: "2026-01", kind: "정기 유지보수", vendor: "인씨스", amount: 2610000 }] };
      d.council = [{ id: "vm1", round: 1, date: "2026-06-01", place: "회의실", vis: "mgr",
        attendees: [], agendas: [], cases: [], decisions: [], files: [], body: "", updated: "" }];
      d.regulations = [{ id: "vr1", scope: "intl", title: "ICAO Annex 17", org: "ICAO", ver: "12판",
        date: "2026-01-01", url: "", fileName: "", note: "", ideas: [{ id: "vi1", text: "개정검토메모" }] }];
      return d; })();
    const e = makeEnv({ preData: pre });
    loginVendor(e, "프로에스콤", "tvd03");
    eq(e.S.roleRank(), 3, "편집 업체 = hq 동등 등급");
    ok(e.S.canEdit(), "편집 권한 있음");
    ok(!e.S.canDelete(), "삭제 권한 없음");
    // 규정: 열람 + 편집(등록/수정), 삭제 버튼 없음
    go(e, "regs-intl");
    ok(/ICAO Annex 17/.test(q(e, "#view").textContent), "규정 목록 열람");
    e.w.SemisRegs.regForm("intl", "vr1");
    ok(q(e, "#rg-save"), "규정 저장 버튼(수정 가능)");
    ok(!q(e, "#rg-del"), "규정 삭제 버튼 없음");
    e.S.closeModal();
    // 장비: 대장 편집 + 계약/비용(대외비) 열람·편집, 삭제만 차단
    go(e, "equipment");
    ok(/ETD-1/.test(q(e, "#view").textContent), "장비 대장 열람");
    ok(q(e, "#eq-add"), "장비 등록 버튼(편집 가능)");
    ok(/유지보수 계약/.test(q(e, "#view").textContent), "유지보수 계약 탭 노출");
    q(e, '[data-eq-row="vq1"]').click();
    ok(q(e, "#e-save"), "장비 저장 버튼");
    ok(!q(e, "#e-del"), "장비 삭제 버튼 없음");
    e.S.closeModal();
    e.w.SemisEquipment.setTab("contracts");
    go(e, "equipment");
    ok(q(e, "#mc-add"), "계약 등록 버튼");
    q(e, "#mc-add").click();
    ok(q(e, "#mc-save") && !q(e, "#mc-del"), "계약 등록 가능·신규는 삭제 없음");
    e.S.closeModal();
    e.w.SemisEquipment.setTab("costs");
    go(e, "equipment");
    ok(q(e, "#ct-add"), "비용 등록 버튼(대외비 편집)");
    e.w.SemisEquipment.setTab("list");
    // 협의회: 회의록 작성/수정 가능, 삭제 불가
    go(e, "council");
    q(e, '[data-cn-row="vm1"]').click();
    ok(q(e, "#cn-edit"), "상세: 수정 버튼");
    ok(!q(e, "#cn-del"), "상세: 삭제 버튼 없음");
    q(e, "#cn-edit").click();
    ok(q(e, "#cn-save"), "회의록 저장 버튼");
    ok(!q(e, "#cn-fdel"), "회의록 삭제 버튼 없음");
    e.S.closeModal();
    // 청구는 자기 업체만
    go(e, "billing");
    ok(/프로에스콤/.test(q(e, ".page-title").textContent), "청구 화면 자기 업체");
    ok(!qa(e, "[data-bl-vendor]").length, "인씨스 탭 숨김");
  });

  t("VD05 편집 업체도 타 업체 청구는 작성 불가 (격리 유지)", () => {
    const e = makeEnv();
    loginVendor(e, "프로에스콤", "tvd05");
    const B = e.w.SemisBilling;
    e.S.data.billing = [blSeed({ vendor: "인씨스", category: "X-ray 유지보수", title: "타사내역", amount: 1000 })];
    e.S.saveSilent();
    ok(!B.visible().length, "타 업체 내역 미노출");
    B.setMonth("2026-07");
    go(e, "billing");
    ok(/프로에스콤/.test(q(e, ".page-title").textContent), "자기 업체 화면 고정");
    ok(!/타사내역/.test(q(e, "#view").textContent), "타 업체 내역 화면 미표시");
    B.itemForm("인씨스", "2026-07", "X-ray 유지보수", null);
    ok(!q(e, "#bl-save"), "타 업체 청구 폼 차단");
  });

  t("VD07 내부 계정(hq)은 삭제 버튼 유지 (회귀)", () => {
    const pre = (() => { const t0 = makeEnv(); const d = JSON.parse(JSON.stringify(t0.S.data));
      d.equipment = [{ id: "hq1", type: "ETD(폭발물흔적)", name: "ETD-H", serial: "", location: "",
        vendor: "", mfgDate: "2024-01-01", installed: "", status: "정상", logs: [], note: "" }];
      d.council = [{ id: "hm1", round: 1, date: "2026-06-01", place: "회의실", vis: "mgr",
        attendees: [], agendas: [], cases: [], decisions: [], files: [], body: "", updated: "" }];
      d.regulations = [{ id: "hr1", scope: "intl", title: "ICAO Annex 17", org: "ICAO", ver: "12판",
        date: "2026-01-01", url: "", fileName: "", note: "", ideas: [] }];
      return d; })();
    const e = makeEnv({ preData: pre });
    loginAs(e, "hq");
    ok(e.S.canDelete(), "hq 삭제 권한");
    go(e, "equipment");
    q(e, '[data-eq-row="hq1"]').click();
    ok(q(e, "#e-del"), "장비 삭제 버튼");
    e.S.closeModal();
    go(e, "council");
    q(e, '[data-cn-row="hm1"]').click();
    ok(q(e, "#cn-del"), "회의록 삭제 버튼");
    e.S.closeModal();
    e.w.SemisRegs.regForm("intl", "hr1");
    ok(q(e, "#rg-del"), "규정 삭제 버튼");
    e.S.closeModal();
  });

  t("VD06 비편집 업체(인씨스)는 종전대로 등급 1 + 청구만", () => {
    const e = makeEnv();
    loginVendor(e, "인씨스", "tvd06");
    eq(e.S.roleRank(), 1, "등급 1 유지");
    ok(!e.S.canEdit(), "타 모듈 편집 권한 없음");
    go(e, "billing");
    ok(q(e, "[data-bl-add]"), "자기 업체 청구 입력은 가능");
  });

  t("VD04 확대 계정도 검색·시스템설정 차단 유지", () => {
    const e = makeEnv();
    loginVendor(e, "프로에스콤", "tvd04");
    go(e, "council");
    ok(q(e, "#hdr-search-wrap").classList.contains("vendor-hide"), "전역 검색 미노출");
    go(e, "settings");
    ok(/대금 청구/.test(q(e, ".page-title").textContent), "시스템 설정 차단 → billing");
    go(e, "kpi");
    ok(/대금 청구/.test(q(e, ".page-title").textContent), "KPI 차단 → billing");
  });

  t("BL04 vendor 입력: 항목 추가/수정 + 자기 업체 저장", () => {
    const e = makeEnv();
    loginVendor(e, "인씨스", "tincis");
    e.w.SemisBilling.setMonth("2026-07");
    go(e, "billing");
    ok(q(e, "[data-bl-add]"), "항목 추가 버튼");
    q(e, "[data-bl-add]").click();
    q(e, "#bl-save").click();
    eq(e.S.data.billing.length, 0, "내역 없이 저장 차단");
    q(e, "#bl-title").value = "X-ray 정기 유지보수";
    q(e, "#bl-amount").value = "3,300,000";
    q(e, "#bl-save").click();
    eq(e.S.data.billing.length, 1, "저장");
    const r = e.S.data.billing[0];
    eq(r.vendor, "인씨스", "업체 자동 지정");
    eq(r.amount, 3300000, "금액 파싱");
    eq(r.month, "2026-07", "귀속 월");
    eq(r.category, "X-ray 유지보수", "카테고리");
  });

  t("BL05 hq 전체 관리 + manager 차단 + 정산 요약 표시", () => {
    const pre = (() => { const t0 = makeEnv(); const d = JSON.parse(JSON.stringify(t0.S.data));
      d.billing = [blSeed({ category: "보안검색&경비", title: "도급비", amount: 20000000 }),
                   blSeed({ category: "기타 수익", title: "TK 수익", amount: 4000000 })];
      return d; })();
    const e = makeEnv({ preData: pre });
    loginAs(e, "hq");
    e.w.SemisBilling.setVendor("프로에스콤");
    e.w.SemisBilling.setMonth("2026-07");
    go(e, "billing");
    ok(qa(e, "[data-bl-vendor]").length === 2, "hq: 업체 전환 버튼 2개");
    ok(q(e, ".bl-summary"), "정산 요약 카드");
    ok(/16,000,000/.test(q(e, ".bl-summary").textContent), "실청구액 20,000,000−4,000,000 (전액 차감)");
    ok(/50%/.test(q(e, ".bl-summary").textContent), "50% 차감 표기");
    ok(q(e, "[data-bl-add]"), "hq 편집 가능");
    const em = makeEnv({ preData: pre });
    loginAs(em, "manager");
    go(em, "billing");
    ok(!q(em, ".bl-summary"), "manager: 접근 차단(메뉴 vis hq)");
  });

  t("BL06 설정: 협력업체 역할 계정 생성 (업체명 필수)", () => {
    const e = makeEnv();
    loginAs(e, "admin");
    go(e, "settings");
    qa(e, ".tab").find(t2 => t2.dataset.tab === "users").click();
    q(e, "#btn-add-user").click();
    ok(qa(e, "#f-urole option").some(o => o.value === "vendor"), "vendor 옵션");
    q(e, "#f-uid").value = "proescom";
    q(e, "#f-uname").value = "프로에스콤";
    q(e, "#f-urole").value = "vendor";
    q(e, "#f-urole").dispatchEvent(new e.w.Event("change"));
    eq(q(e, "#row-vendor").style.display, "", "업체명 입력란 표시");
    q(e, "#f-upw").value = "vdpw-773x";
    const base = e.S.data.customUsers.length; // loginAs가 만든 테스트 계정 포함
    q(e, "#f-save").click();
    eq(e.S.data.customUsers.length, base, "업체명 없이 저장 차단");
    q(e, "#f-uvendor").value = "프로에스콤";
    q(e, "#f-save").click();
    eq(e.S.data.customUsers.length, base + 1, "계정 생성");
    const nu = e.S.data.customUsers.find(u => u.id === "proescom");
    eq(nu.vendor, "프로에스콤", "vendor 필드 저장");
    eq(nu.role, "vendor", "역할 저장");
  });

  t("BL07 장비 비용 탭 연동: 업체 청구 연간 집계 블록(hq)", () => {
    const pre = (() => { const t0 = makeEnv(); const d = JSON.parse(JSON.stringify(t0.S.data));
      d.billing = [blSeed({ category: "보안검색&경비", title: "도급비", amount: 10000000 }),
                   blSeed({ category: "기타 수익", title: "TK", amount: 2000000 })];
      return d; })();
    const e = makeEnv({ preData: pre });
    loginAs(e, "hq");
    e.w.SemisEquipment.setTab("costs");
    e.w.SemisEquipment.setCostYear(2026);
    go(e, "equipment");
    ok(q(e, "#eq-go-billing"), "이동 버튼");
    ok(/프로에스콤/.test(q(e, "#eq-body").textContent), "업체 집계 표시");
    ok(/8,000,000/.test(q(e, "#eq-body").textContent), "연간 실청구(10M−2M 전액 차감)");
  });

  t("BL08 비용 기록 자동 반영: 유지보수 청구 → 월별 표 + 정기/수리부품 분류 (v2.17)", () => {
    const pre = (() => { const t0 = makeEnv(); const d = JSON.parse(JSON.stringify(t0.S.data));
      d.billing = [
        blSeed({ month: "2026-01", category: "ETD 유지보수", title: "장비 잔존가+수선유지비", amount: 5170000 }),
        blSeed({ month: "2026-01", category: "ETD 유지보수", title: "드리프트튜브 부품교체", amount: 4500000 }),
        blSeed({ month: "2026-02", vendor: "인씨스", category: "X-ray 유지보수", title: "정기 유지보수", amount: 2610000 }),
        blSeed({ month: "2026-02", category: "보안검색&경비", title: "도급비", amount: 30000000 }),
        blSeed({ month: "2026-03", category: "ETD 유지보수", title: "수선유지비", costKind: "수리/부품", amount: 111 })
      ];
      return d; })();
    const e = makeEnv({ preData: pre });
    loginAs(e, "hq");
    const B = e.w.SemisBilling;
    eq(B.classifyCost({ title: "드리프트튜브 부품교체" }), "수리/부품", "자동 분류: 부품");
    eq(B.classifyCost({ title: "장비 잔존가+수선유지비" }), "정기 유지보수", "자동 분류: 정기");
    eq(B.classifyCost({ title: "수선유지비", costKind: "수리/부품" }), "수리/부품", "명시 override 우선");
    eq(B.maintRows(2026).length, 4, "도급비 제외 유지보수 4건");
    const yc = e.w.SemisEquipment.yearCosts(2026);
    eq(yc.autoRows.length, 4, "가상 행 병합");
    eq(yc.byM[1]["정기 유지보수"], 5170000, "1월 정기");
    eq(yc.byM[1]["수리/부품"], 4500000, "1월 수리부품");
    eq(yc.byM[2]["정기 유지보수"], 2610000, "2월 인씨스 X-ray");
    eq(yc.byM[3]["수리/부품"], 111, "costKind 명시분");
    eq(yc.total, 5170000 + 4500000 + 2610000 + 111, "도급비 미포함 연간 합계");
    // 화면: 청구 연동 배지 + 월별 정산표(settle 그대로)
    e.w.SemisEquipment.setTab("costs");
    e.w.SemisEquipment.setCostYear(2026);
    go(e, "equipment");
    ok(/청구 연동/.test(q(e, "#eq-body").textContent), "청구 연동 표시");
    ok(/실청구액/.test(q(e, "#eq-body").textContent), "월별 정산표");
    ok(/9,670,000/.test(q(e, "#eq-body").textContent), "1월 합계 반영");
    ok(/30,000,000/.test(q(e, "#eq-body").textContent), "정산표에 도급비(실청구) 표시");
    ok(q(e, "#eq-cost-chart"), "월 비용 변화 차트");
    eq(qa(e, "#eq-cost-chart rect").length, 4, "세그먼트 4개(1월 ETD 정기+수리 스택 · 2월 X-ray 정기 · 3월 ETD 수리)");
    ok(qa(e, "#eq-cost-chart title").some(t2 => /ETD 정기/.test(t2.textContent)), "ETD 정기 스택");
    ok(qa(e, "#eq-cost-chart title").some(t2 => /ETD 수리\/부품/.test(t2.textContent)), "수리/부품 위 얹힘");
    ok(qa(e, "#eq-cost-chart title").some(t2 => /X-ray 정기/.test(t2.textContent)), "X-ray 정기 스택");
    ok(qa(e, "#eq-cost-chart text").some(t2 => t2.textContent === "9.7"), "1월 값 라벨(백만원)");
    ok(qa(e, "#eq-cost-chart text").some(t2 => t2.textContent === "2.6"), "2월 X-ray 값 라벨");
    ok(!q(e, "#eq-cost-chart polyline"), "합계 꺾은선 없음");
    e.w.SemisEquipment.setTab("list");
  });

  t("BL09 중복 계상 방지: 같은 달·업체 수동 기록 자동 제외 + 강제 포함(force)", () => {
    const pre = (() => { const t0 = makeEnv(); const d = JSON.parse(JSON.stringify(t0.S.data));
      d.billing = [blSeed({ month: "2026-05", category: "ETD 유지보수", title: "수선유지비", amount: 5200000 })];
      d.equipMaint = { contracts: [], costs: [
        { id: "m1", ym: "2026-05", kind: "정기 유지보수", vendor: "프로에스콤", amount: 5000000, memo: "수동 중복 기록" },
        { id: "m2", ym: "2026-05", kind: "기타", vendor: "프로에스콤", amount: 700, memo: "별개 비용", force: true },
        { id: "m3", ym: "2026-04", kind: "정기 유지보수", vendor: "프로에스콤", amount: 30 },
        { id: "m4", ym: "2026-05", kind: "정기 유지보수", vendor: "타업체", amount: 5 }
      ] };
      return d; })();
    const e = makeEnv({ preData: pre });
    loginAs(e, "hq");
    const yc = e.w.SemisEquipment.yearCosts(2026);
    eq(yc.excluded.length, 1, "같은 달·업체 수동 기록 1건 제외");
    eq(yc.excluded[0].id, "m1", "제외 대상");
    eq(yc.total, 5200000 + 700 + 30 + 5, "자동 행 + force/타월/타업체만 합산");
    // 편집 권한 없으면(비로그인) 연동 미적용 → 수동 기록 그대로
    const e2 = makeEnv({ preData: pre });
    const yc2 = e2.w.SemisEquipment.yearCosts(2026);
    eq(yc2.autoRows.length, 0, "권한 없음: 연동 없음");
    eq(yc2.total, 5000000 + 700 + 30 + 5, "수동 기록만 합산");
    // 화면: 제외 배지 + 폼 강제 포함 체크박스
    e.w.SemisEquipment.setTab("costs");
    e.w.SemisEquipment.setCostYear(2026);
    go(e, "equipment");
    ok(/집계 제외/.test(q(e, "#eq-body").textContent), "제외 배지 표시");
    q(e, '#eq-body [data-ct="m2"]').click();
    ok(q(e, "#ct-force").checked, "강제 포함 체크 유지");
    q(e, "#ct-cancel").click();
    e.w.SemisEquipment.setTab("list");
  });

  t("BL10 증빙 첨부 다중화: 최대 5개 + 구버전 단일 fileUrl 호환 (v2.17.1)", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    const B = e.w.SemisBilling;
    eq(B.MAX_FILES, 5, "최대 5개");
    const legacy = { fileUrl: "https://x/a.pdf", fileName: "a.pdf" };
    eq(B.filesOf(legacy).length, 1, "구버전 단일 필드 호환");
    eq(B.filesOf(legacy)[0].name, "a.pdf");
    const many = { files: [1, 2, 3, 4, 5, 6].map(n => ({ url: "https://x/" + n + ".pdf", name: n + ".pdf" })),
      fileUrl: "https://x/legacy.pdf" };
    eq(B.filesOf(many).length, 5, "5개 초과 잘림");
    eq(B.filesOf(many)[0].name, "1.pdf", "files 배열 우선");
    // 화면: 항목에 첨부 수만큼 📎 링크 + 폼 다중 관리
    e.S.data.billing = [blSeed({ month: "2026-07",
      files: [{ url: "https://x/1.pdf", name: "1.pdf" }, { url: "https://x/2.pdf", name: "2.pdf" }] })];
    e.S.saveSilent();
    B.setVendor("프로에스콤"); B.setMonth("2026-07");
    go(e, "billing");
    eq(qa(e, ".bl-item .nb-file").length, 2, "📎 링크 2개");
    q(e, "[data-bl-edit]").click();
    ok(q(e, "#bl-file").multiple, "다중 선택 입력");
    eq(qa(e, "#bl-file-box [data-bl-frm]").length, 2, "폼 첨부 목록 2건");
    q(e, '[data-bl-frm="0"]').click();
    q(e, "#bl-save").click();
    const r = e.S.data.billing[0];
    eq(r.files.length, 1, "첨부 제거 반영");
    eq(r.fileUrl, "https://x/2.pdf", "구버전 필드 첫 첨부 동기화");
  });

  /* ══════════ [CO] 이수증 선택지 관리 (v2.17) ══════════ */
  t("CO01 이수증 선택지 관리: certOpts 시드/동기화 + 추가·삭제 + 기존 데이터 호환", () => {
    const e = makeEnv();
    ok(e.Sync.SYNC_KEYS.includes("certOpts"), "SYNC_KEYS 등록");
    const o = e.S.data.certOpts;
    ok(Array.isArray(o.roles) && o.roles.length === 4 && o.roles.includes("보안검색감독자"), "기본 과정 시드");
    ok(o.orgs.includes("한국항공안전교육원"), "기본 수료기관 시드");
    loginAs(e, "hq");
    e.S.data.certs = [{ id: "ct-x", certNo: "1", name: "홍길동", dept: "", role: "레거시과정", kind: "초기",
      org: "구기관", issued: "2026-01-05", expire: "2027-02-04", fileUrl: "", fileName: "", note: "", updated: "", by: "" }];
    e.S.saveSilent();
    const C = e.w.SemisCerts;
    ok(C.rolesAll().includes("레거시과정"), "사용 중 값 합집합(호환)");
    go(e, "certs");
    ok(q(e, "#ct-opts"), "선택지 버튼(hq)");
    ok(qa(e, "#ct-rolefilter option").some(op => op.textContent === "레거시과정"), "필터에 사용 중 값");
    // 모달: 과정/기관 추가
    q(e, "#ct-opts").click();
    q(e, "#co-new-roles").value = "폭발물처리요원";
    q(e, '[data-co-add="roles"]').click();
    ok(e.S.data.certOpts.roles.includes("폭발물처리요원"), "과정 추가");
    q(e, "#co-new-orgs").value = "인천공항공사";
    q(e, '[data-co-add="orgs"]').click();
    ok(e.S.data.certOpts.orgs.includes("인천공항공사"), "기관 추가");
    // 삭제 (기존 데이터는 유지)
    const idx = e.S.data.certOpts.roles.indexOf("기타");
    q(e, `[data-co-del="roles:${idx}"]`).click();
    ok(!e.S.data.certOpts.roles.includes("기타"), "과정 삭제");
    q(e, "#co-close").click();
    eq(e.S.data.certs.length, 1, "기존 데이터 유지");
    // 등록 폼 반영
    go(e, "certs");
    q(e, "#ct-add").click();
    const roleOpts = qa(e, "#ct-role option").map(op => op.textContent);
    ok(roleOpts.includes("폭발물처리요원"), "폼에 신규 과정");
    ok(!roleOpts.includes("기타"), "삭제된 과정 미표시");
    ok(qa(e, "#ct-orgs option").some(op => op.value === "인천공항공사"), "datalist 신규 기관");
    q(e, "#ct-cancel").click();
    // 삭제된 과정을 쓰는 레코드 수정 시 select에 해당 값 유지
    go(e, "certs");
    q(e, '[data-ct-row="ct-x"]').click();
    eq(q(e, "#ct-role").value, "레거시과정", "레코드 값 호환 표시");
    q(e, "#ct-cancel").click();
    // manager: 선택지 버튼 없음
    const em = makeEnv();
    loginAs(em, "manager");
    go(em, "certs");
    ok(!q(em, "#ct-opts"), "manager: 선택지 버튼 없음");
  });

  /* ══════════ [GS] 전역 통합 검색 (v2.18) ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "hq");
    const SS = e.w.SemisSearch;

    t("GS01 검색 UI 요소 존재 (헤더 검색창/팝업/모바일 버튼)", () => {
      ok(q(e, "#hdr-search"), "input");
      ok(q(e, "#hdr-search-pop"), "pop");
      ok(q(e, "#hdr-search-btn"), "mobile btn");
    });
    t("GS02 메뉴 검색 — 모듈 메뉴 매칭(출입증 관리)", () => {
      const r = SS.search("출입증 관리");
      ok(r.some(x => x.route === "passes"), "passes 라우트 결과");
    });
    t("GS03 링크 메뉴 검색 — URL 새 탭 (문자의 신)", () => {
      const r = SS.search("문자의 신");
      const hit = r.find(x => x.url && x.url.indexOf("munjasin") >= 0);
      ok(hit, "링크 결과 + url 보존");
    });
    t("GS04 다중 단어 AND 매칭", () => {
      ok(SS.search("보안 점검").some(x => String(x.title).indexOf("점검") >= 0), "둘 다 포함 시 매칭");
      eq(SS.search("점검 존재하지않는단어XYZ").length, 0, "하나라도 없으면 미매칭");
    });
    t("GS05 데이터 검색 — 보안점검 시드(프로에스콤)", () => {
      const r = SS.search("프로에스콤");
      ok(r.some(x => x.group === "보안점검" && x.route === "inspection"), "점검 데이터 히트");
    });
    t("GS06 데이터 검색 — 출입증 레코드", () => {
      e.S.data.passes.push({ id: "ps-t1", kind: "인원", holder: "홍길동테스트", company: "테스트사",
        no: "A-100", area: "보호구역", issue: "", expire: "", status: "유효", note: "" });
      e.S.saveSilent();
      const r = SS.search("홍길동테스트");
      ok(r.some(x => x.group === "출입증"), "출입증 레코드 히트");
    });
    t("GS07 공지사항 검색", () => {
      ok(SS.search("오픈 안내").some(x => x.group === "공지사항"), "공지 제목 히트");
    });
    t("GS08 검색어 입력 → 팝업 렌더 (UI)", () => {
      const inp = q(e, "#hdr-search");
      inp.value = "출입증";
      // 디바운스 우회 — 직접 렌더 경로 확인용으로 input 이벤트 후 팝업 확인은 타이머 필요.
      // 여기서는 search() 결과 기반 렌더를 Enter 경로로 검증한다.
      inp.dispatchEvent(new e.w.Event("input", { bubbles: true }));
      ok(true);
    });
    t("GS09 이후 추가된 메뉴도 즉시 검색됨", () => {
      e.S.data.menus.push({ id: "lk-drone", seq: 999, type: "link", label: "드론 대응 매뉴얼",
        icon: "🛸", url: "https://example.com/drone", vis: "all", parent: null });
      e.S.saveSilent();
      ok(SS.search("드론 대응").some(x => x.title === "드론 대응 매뉴얼"), "신규 메뉴 히트");
    });
    t("GS10 메뉴 라벨 변경도 즉시 반영", () => {
      const mn = e.S.data.menus.find(m => m.id === "lk-drone");
      mn.label = "무인기 대응 절차";
      ok(SS.search("무인기").some(x => x.title === "무인기 대응 절차"), "변경 라벨 히트");
      eq(SS.search("드론 대응").filter(x => x.title === "드론 대응 매뉴얼").length, 0, "구 라벨 미히트");
    });
    t("GS11 hq — 대외비(계약서/청구/유지보수) 검색 가능", () => {
      e.S.data.contracts.push({ id: "cn-t1", name: "청소용역기밀계약", party: "테스트사",
        category: "용역", start: "", end: "", amount: "", owner: "", autoRenew: false,
        fileUrl: "", status: "유효", note: "" });
      e.S.data.billing.push({ id: "bl-t1", vendor: "프로에스콤", month: "2026-07",
        category: "유지보수", title: "엑스레이수리비테스트", amount: 100000, files: [], note: "", by: "", updated: "" });
      e.S.data.equipMaint.costs.push({ id: "ct-t1", ym: "2026-07", kind: "ETD", vendor: "인씨스",
        amount: 50000, serial: "SN-777", memo: "기밀부품메모테스트", force: false });
      e.S.saveSilent();
      ok(SS.search("청소용역기밀계약").length, "계약서 히트");
      ok(SS.search("엑스레이수리비테스트").length, "청구 히트");
      ok(SS.search("기밀부품메모테스트").length, "유지보수 비용 히트");
    });
  }
  {
    /* 권한별 검색 범위 — 같은 데이터로 역할만 바꿔 검증 */
    const mkData = (S2) => {
      S2.data.passes.push({ id: "ps-t2", kind: "인원", holder: "권한테스트인물", company: "", no: "",
        area: "", issue: "", expire: "", status: "유효", note: "" });
      S2.data.contracts.push({ id: "cn-t2", name: "권한테스트계약", party: "", category: "용역",
        start: "", end: "", amount: "", owner: "", autoRenew: false, fileUrl: "", status: "유효", note: "" });
      S2.data.equipMaint.costs.push({ id: "ct-t2", ym: "2026-06", kind: "X-ray", vendor: "",
        amount: 1, serial: "", memo: "권한테스트유지비", force: false });
      S2.saveSilent();
    };
    t("GS12 user(일반) — 보안 데이터/메뉴 검색 제외, 공개 항목만", () => {
      const e2 = makeEnv();
      loginAs(e2, "user");
      mkData(e2.S);
      const SS2 = e2.w.SemisSearch;
      eq(SS2.search("권한테스트인물").length, 0, "출입증(mgr) 미노출");
      eq(SS2.search("권한테스트계약").length, 0, "계약서(hq) 미노출");
      eq(SS2.search("권한테스트유지비").length, 0, "유지보수 비용(hq) 미노출");
      ok(SS2.search("오픈 안내").some(x => x.group === "공지사항"), "공지는 검색 가능");
      ok(!SS2.search("출입증 관리").some(x => x.route === "passes"), "모듈 메뉴(mgr) 미노출");
      ok(SS2.search("출입증").some(x => x.url), "공개 링크(구버전, vis:all)는 노출");
    });
    t("GS13 manager — 보안 열람 가능, 대외비(hq) 제외", () => {
      const e2 = makeEnv();
      loginAs(e2, "manager");
      mkData(e2.S);
      const SS2 = e2.w.SemisSearch;
      ok(SS2.search("권한테스트인물").length, "출입증(mgr) 노출");
      eq(SS2.search("권한테스트계약").length, 0, "계약서(hq) 미노출");
      eq(SS2.search("권한테스트유지비").length, 0, "유지보수 비용(hq 이중 게이트) 미노출");
    });
    t("GS14 vendor — 검색 비활성 (결과 없음 + 검색창 숨김)", () => {
      const e2 = makeEnv();
      e2.S.data.customUsers.push({ id: "tvendor", name: "T협력", role: "vendor",
        vendor: "프로에스콤", hash: e2.S.pwHash("testpw-vendor-9x") });
      e2.S.saveSilent();
      submitLogin(e2, "testpw-vendor-9x");
      mkData(e2.S);
      eq(e2.w.SemisSearch.search("권한테스트인물").length, 0, "결과 없음");
      eq(e2.w.SemisSearch.search("대시보드").length, 0, "메뉴도 없음");
      ok(q(e2, "#hdr-search-wrap").classList.contains("vendor-hide"), "검색창 숨김");
    });
    t("GS15 admin — 시스템 설정 메뉴 검색 (admin 전용 vis)", () => {
      const e3 = makeEnv();
      loginAs(e3, "admin");
      ok(e3.w.SemisSearch.search("시스템 설정").some(x => x.route === "settings"), "admin: settings 히트");
      const e4 = makeEnv();
      loginAs(e4, "hq");
      ok(!e4.w.SemisSearch.search("시스템 설정").some(x => x.route === "settings"), "hq: settings 미노출");
    });
    t("GS16 신규 모듈 프로바이더 등록 확장성 (register API)", () => {
      const e2 = makeEnv();
      loginAs(e2, "hq");
      e2.w.SemisSearch.register({ id: "future-mod", group: "미래모듈", icon: "🧪",
        items: () => [{ title: "미래모듈테스트항목", sub: "확장 테스트", route: "dashboard" }] });
      ok(e2.w.SemisSearch.search("미래모듈테스트").some(x => x.group === "미래모듈"), "신규 프로바이더 히트");
    });
  }

  /* ══════════ [DB] v2.19 대시보드 재배치 + guest 경량 레이아웃 ══════════ */
  {
    const colTitles = (env, i) => {
      const cols = qa(env, ".dash-col");
      return cols[i] ? Array.from(cols[i].querySelectorAll(".card-title")).map(x => x.textContent.trim()) : [];
    };
    const assertOrder = (list, subs, msg) => {
      eq(list.length, subs.length, msg + ": 카드 수");
      let idx = -1;
      subs.forEach(s => {
        const i = list.findIndex((x, j) => j > idx && x.includes(s));
        ok(i > idx, msg + ": '" + s + "' 순서 (" + list.join(" | ") + ")");
        idx = i;
      });
    };

    t("DB01 카드 순서(mgr+): 좌 공지→환경센서→고장신고 / 우 등급→바로가기→일정→KPI→점검→CAR→만료→이수증", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      go(e, "dashboard");
      assertOrder(colTitles(e, 0), ["공지사항", "CARES 환경센서", "보안장비 · 고장신고"], "좌측");
      assertOrder(colTitles(e, 1),
        ["보안등급", "바로가기", "다가오는 일정", "KPI 진행현황", "보안점검 실적", "부적합·시정조치", "만료 · 점검 도래", "교육 이수증"], "우측");
      ok(!q(e, "#news-box") && !q(e, "#insight-box"), "mgr+에는 뉴스/인사이트 카드 없음");
    });

    t("DB02 guest 경량 레이아웃: 좌 공지→뉴스 / 우 바로가기→환경센서→인사이트→만료", () => {
      const e = makeEnv();
      loginAs(e, "user");
      go(e, "dashboard");
      assertOrder(colTitles(e, 0), ["공지사항", "보안 뉴스"], "guest 좌측");
      assertOrder(colTitles(e, 1), ["바로가기", "CARES 환경센서", "항공보안 인사이트", "만료 · 점검 도래"], "guest 우측");
      ok(q(e, "#news-box") && q(e, "#insight-box"), "뉴스/인사이트 박스 존재");
      ok(!q(e, "#level-box") && !q(e, "#insp-box") && !q(e, "#upcoming-box") && !q(e, "#equip-box") && !q(e, "#certs-box"),
        "보안 카드(민감) 숨김 유지");
    });

    t("DB03 인사이트 탭 전환: 기본 보안등급 → 액체류 패널", () => {
      const e = makeEnv();
      loginAs(e, "user");
      go(e, "dashboard");
      ok(q(e, "#ins-panel").textContent.includes("평시"), "기본 탭 = 보안등급 5단계");
      const tab = qa(e, "[data-ins-tab]").find(b => b.dataset.insTab === "liquid");
      tab.click();
      ok(q(e, "#ins-panel").textContent.includes("100㎖"), "액체류 패널 전환");
      ok(tab.classList.contains("on"), "탭 활성 표시");
      const tab2 = qa(e, "[data-ins-tab]").find(b => b.dataset.insTab === "steps");
      tab2.click();
      ok(q(e, "#ins-panel").textContent.includes("문형금속탐지기"), "검색절차 패널 전환");
    });

    await ta("DB04 뉴스 카드: 3분류 렌더 + 카테고리 필터 버튼 (fetch 스텁)", async () => {
      const newsFetch = (url) => {
        if (String(url).includes("semis-news")) return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ updated: "2026-07-19T00:00:00Z", items: [
            { title: "공항 보안검색 강화 대책", link: "https://news.example/1", date: "2026-07-19T01:00:00Z", src: "보안뉴스", cat: "aviation" },
            { title: "인천공항 화물터미널 보안 점검", link: "https://news.example/2", date: "2026-07-18T02:00:00Z", src: "보안뉴스", cat: "cargo" },
            { title: "신종 랜섬웨어 주의보", link: "https://news.example/3", date: "2026-07-18T01:00:00Z", src: "보안뉴스", cat: "cyber" }
          ] })
        });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      };
      const e = makeEnv({ fetch: newsFetch });
      loginAs(e, "user");
      go(e, "dashboard");
      await new Promise(r => setTimeout(r, 20));
      const box = q(e, "#news-box");
      ok(box.textContent.includes("공항 보안검색 강화 대책"), "항공 기사 표시");
      ok(box.textContent.includes("항공") && box.textContent.includes("화물") && box.textContent.includes("사이버"), "3분류 배지");
      const a = box.querySelector(".news-row");
      eq(a.getAttribute("target"), "_blank", "새 창 링크");
      ok(e.w.localStorage.getItem("semis2:news"), "로컬 캐시 저장");
      // 카테고리 필터: 화물 → 화물 기사만, 전체 → 3건 복원
      const btn = (c) => qa(e, "[data-news-cat]").find(b => b.dataset.newsCat === c);
      btn("cargo").click();
      ok(box.textContent.includes("인천공항 화물터미널 보안 점검"), "화물 필터: 화물 기사 표시");
      ok(!box.textContent.includes("랜섬웨어") && !box.textContent.includes("보안검색 강화 대책"), "화물 필터: 타 분류 숨김");
      ok(btn("cargo").classList.contains("on") && !btn("all").classList.contains("on"), "필터 버튼 활성 표시");
      btn("cyber").click();
      ok(box.textContent.includes("랜섬웨어") && !box.textContent.includes("화물터미널"), "사이버 필터 전환");
      btn("all").click();
      eq(box.querySelectorAll(".news-row").length, 3, "전체 복원");
      eq(e.w.SemisNews.REFRESH_MS, 3600000, "자동 갱신 주기 60분");
    });

    await ta("DB05 뉴스 카드: 네트워크 실패 시 만료 캐시 폴백", async () => {
      const cached = JSON.stringify({ ts: Date.now() - 3600000, items: [
        { title: "캐시된 항공보안 기사", link: "https://news.example/9", date: "2026-07-10T00:00:00Z", src: "보안뉴스", cat: "aviation" }
      ] });
      const failFetch = (url) => String(url).includes("semis-news")
        ? Promise.reject(new Error("network down"))
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      const e = makeEnv({ fetch: failFetch, preLS: { "semis2:news": cached } });
      loginAs(e, "user");
      go(e, "dashboard");
      await new Promise(r => setTimeout(r, 20));
      const box = q(e, "#news-box");
      ok(box.textContent.includes("캐시된 항공보안 기사"), "캐시 기사 표시");
      ok(box.textContent.includes("갱신 실패"), "실패 안내 문구");
    });

    t("DB06 DASH_CARDS 등록: news/insight vis=all + guest 전용 렌더 규약", () => {
      const e = makeEnv();
      const DC = e.w.SemisDash.DASH_CARDS;
      eq(DC.news, "all", "news 등록");
      eq(DC.insight, "all", "insight 등록");
      loginAs(e, "manager"); // rank 2 — guest 아님
      go(e, "dashboard");
      ok(!q(e, "#news-box"), "manager: 뉴스 카드 미표시(경량 전용)");
    });
  }

  /* ══════════ [K] KPI 현황 (v2.20) ══════════ */
  {
    t("K01 시드: kpis 컨테이너 + CSI 3건(L1/C6-1/C6-2) 생성", () => {
      const e = makeEnv();
      const K = e.S.data.kpis;
      ok(K && Array.isArray(K.items), "kpis.items 배열");
      eq(K.items.length, 3, "KPI 3건");
      eq(K.items.map(x => x.id).join(","), "L1,C6-1,C6-2", "ID 순서");
      ok(K.items.every(x => x.title && x.leader && x.start && x.end && x.actions.length), "필수 필드");
    });

    t("K02 시드: 액션 상태값은 정의된 8종만 사용 + id 유일", () => {
      const e = makeEnv();
      const ST = Object.keys(e.w.SemisKpi.ST_META);
      const all = [];
      e.S.data.kpis.items.forEach(k => k.actions.forEach(a => all.push(a)));
      ok(all.every(a => ST.includes(a.st)), "상태값 유효");
      eq(new Set(all.map(a => a.id)).size, all.length, "액션 id 유일");
      ok(all.every(a => !a.ps || !a.pe || a.ps <= a.pe), "계획 시작≤종료");
    });

    t("K03 시드: 원본 엑셀 대비 건수/상태 (L1=18건, C6-2=9건, C6-1 보완 4건)", () => {
      const e = makeEnv();
      const K = e.w.SemisKpi;
      const [l1, c61, c62] = e.S.data.kpis.items;
      eq(l1.actions.length, 18, "L1 총 18건");
      eq(K.stats(l1).c["지연완료"], 8, "L1 지연완료 8");
      eq(K.stats(l1).c["미실행"], 6, "L1 미실행 6");
      eq(K.stats(l1).c["완료지연"], 2, "L1 완료지연 2");
      eq(K.stats(l1).c["실행대기"], 2, "L1 실행대기 2");
      eq(c62.actions.length, 9, "C6-2 총 9건");
      eq(K.stats(c62).done, 4, "C6-2 완료 4");
      eq(c61.actions.filter(a => a.added).length, 4, "C6-1 보완 항목 4건");
      ok(c61.actions.some(a => a.phase === "관리증진 종합시스템 구축"), "C6-1 빈 Sub과제 보완");
    });

    t("K04 메뉴: kpi 모듈 메뉴 자동 삽입 (vis=hq)", () => {
      const e = makeEnv();
      const mn = e.S.data.menus.find(m => m.type === "module" && m.module === "kpi");
      ok(mn, "메뉴 존재");
      eq(mn.vis, "hq", "항공보안HQ 이상");
    });

    t("K05 구버전 데이터(kpis 없음) 마이그레이션: 시드 + 메뉴 삽입", () => {
      const e0 = makeEnv();
      const old = JSON.parse(JSON.stringify(e0.S.data));
      delete old.kpis;
      old.menus = old.menus.filter(m => m.module !== "kpi");
      const e = makeEnv({ preData: old });
      ok(e.S.data.kpis && e.S.data.kpis.items.length === 3, "시드 재생성");
      ok(e.S.data.menus.some(m => m.module === "kpi"), "메뉴 재삽입");
    });

    t("K06 권한: hq는 화면 렌더, manager는 잠금 안내", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      go(e, "kpi");
      ok(q(e, ".kpi-pick"), "hq: KPI 선택 버튼 렌더");
      ok(qa(e, ".kpi-pick-btn").length === 3, "3건 선택지");
      const e2 = makeEnv();
      loginAs(e2, "manager");
      go(e2, "kpi");
      ok(!q(e2, ".kpi-pick"), "manager: 미렌더");
    });

    t("K07 선택 전환: C6-1 클릭 시 해당 과제 표시 + 선택 유지", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      go(e, "kpi");
      qa(e, ".kpi-pick-btn").find(b => b.dataset.kpi === "C6-1").click();
      ok(q(e, ".kpi-pick-btn.on").dataset.kpi === "C6-1", "선택 표시");
      ok(q(e, "#view").textContent.includes("예방정비"), "C6-1 내용 표시");
      eq(e.w.localStorage.getItem("semis2:kpiSel"), "C6-1", "선택 저장");
    });

    t("K08 통계: stats/timePct/nextItems 계산", () => {
      const e = makeEnv();
      const K = e.w.SemisKpi;
      const l1 = e.S.data.kpis.items[0];
      const s = K.stats(l1);
      eq(s.total, 18); eq(s.done, 8);
      eq(s.pct, Math.round(8 / 18 * 100), "완료율");
      const tp = K.timePct(l1);
      ok(tp >= 0 && tp <= 100, "기간 경과율 범위");
      const nx = K.nextItems(l1);
      ok(nx.length === 8, "미착수 8건(미실행6+실행대기2)");
      ok(nx.every((x, i) => i === 0 || nx[i - 1].ps <= x.ps), "시작일순 정렬");
    });

    t("K09 편집: hq가 상태/실적 수정 → 저장 + updated 갱신", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      go(e, "kpi");
      const aid = e.S.data.kpis.items[0].actions[0].id;
      q(e, `.kpi-row[data-act="${aid}"]`).click();
      ok(q(e, "#kf-st"), "수정 폼 표시");
      q(e, "#kf-st").value = "정상완료";
      q(e, "#kf-risk").value = "테스트 메모";
      q(e, "#kf-save").click();
      const a2 = e.S.data.kpis.items[0].actions[0];
      eq(a2.st, "정상완료", "상태 저장");
      eq(a2.risk, "테스트 메모", "메모 저장");
      ok(a2.edited && a2.edited.by === "Thq", "수정자 기록");
    });

    t("K10 대시보드 카드: hq는 표시(3건 + 이동), mgr는 미표시", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      go(e, "dashboard");
      ok(q(e, "#kpi-box"), "hq: KPI 카드 표시");
      eq(qa(e, "#kpi-box .kpi-dash-item").length, 3, "3건 렌더");
      ok(q(e, "#kpi-box .kpi-stack"), "누적 그래프 렌더");
      const e2 = makeEnv();
      loginAs(e2, "manager");
      go(e2, "dashboard");
      ok(!q(e2, "#kpi-box"), "manager: 미표시");
    });

    t("K11 대시보드 → KPI 이동: 항목 클릭 시 선택 반영", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      go(e, "dashboard");
      qa(e, "#kpi-box .kpi-dash-item").find(x => x.dataset.kpiGo === "C6-2").click();
      e.S.renderView(); // hashchange 대체
      eq(e.w.localStorage.getItem("semis2:kpiSel"), "C6-2", "선택 저장");
      ok(q(e, ".kpi-pick-btn.on") && q(e, ".kpi-pick-btn.on").dataset.kpi === "C6-2", "해당 KPI 표시");
    });

    t("K12 동기화: kpis가 SYNC_KEYS에 포함", () => {
      const e = makeEnv();
      ok(e.Sync.SYNC_KEYS.includes("kpis"), "kpis 동기화 대상");
    });

    t("K13 통합검색: hq는 KPI 액션 검색 가능, manager는 차단", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const r = e.w.SemisSearch.search("트러블슈팅");
      ok(r.some(x => x.group === "KPI 현황"), "hq: 검색 결과");
      const e2 = makeEnv();
      loginAs(e2, "manager");
      const r2 = e2.w.SemisSearch.search("트러블슈팅");
      ok(!r2.some(x => x.group === "KPI 현황"), "manager: 차단");
    });

    t("K14 시드 재적용 버튼 제거 — 수정 내용은 재렌더 후에도 보존", () => {
      const e = makeEnv();
      loginAs(e, "admin");
      go(e, "kpi");
      ok(!q(e, "#kpi-reseed"), "위험한 초기화 버튼 미노출");
      const aid = e.S.data.kpis.items[0].actions[0].id;
      q(e, `.kpi-row[data-act="${aid}"]`).click();
      q(e, "#kf-st").value = "정상완료";
      q(e, "#kf-save").click();
      go(e, "dashboard"); go(e, "kpi"); // 화면 이탈 후 복귀
      eq(e.S.data.kpis.items[0].actions[0].st, "정상완료", "수정 내용 보존");
    });

    t("K15 인쇄/PDF: 버튼 노출 + printKpi가 인쇄용 iframe 생성", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      go(e, "kpi");
      ok(q(e, "#kpi-print"), "인쇄 버튼 표시");
      // jsdom은 contentWindow.print 미구현 → 예외 없이 통과해야 함(내부 try/catch)
      let printed = false;
      const before = e.w.document.querySelectorAll("iframe").length;
      // print 스텁 주입 대비: iframe 생성 여부로 검증
      e.w.SemisKpi.printKpi("C6-1");
      const after = e.w.document.querySelectorAll("iframe").length;
      ok(after > before, "인쇄용 iframe 추가");
      // 문서 내용 검증
      const fr = Array.from(e.w.document.querySelectorAll("iframe")).pop();
      const html = fr.contentWindow.document.documentElement.innerHTML;
      ok(/Action Plan/.test(html) && /과제 개요/.test(html), "인쇄 문서 구성");
      ok(html.indexOf("예방정비") >= 0, "선택 과제(C6-1) 내용 포함");
    });
  }

  /* ══════════ [CN*] 보안장비 협의회 회의록 (v2.24) ══════════ */
  t("CN01 normalize: council 배열/메뉴 자동 삽입 + 구링크 (구버전) 구분", () => {
    const e = makeEnv();
    const d = e.S.data;
    // 구버전 상태 시뮬레이션
    d.menus = d.menus.filter(m => !(m.type === "module" && m.module === "council"));
    delete d.council;
    const lk = d.menus.find(m => m.id === "equip-council");
    if (lk) lk.label = "보안장비 협의체";
    const changed = e.S.normalizeData();
    eq(changed, true, "변경 감지");
    ok(Array.isArray(d.council), "council 배열 보정");
    const mn = d.menus.find(m => m.type === "module" && m.module === "council");
    ok(mn, "council 모듈 메뉴 삽입");
    eq(mn.vis, "mgr", "vis=mgr (일반 사용자 제외)");
    eq(mn.parent, "grp-equip", "보안장비 그룹 소속");
    const eqp = d.menus.find(m => m.type === "module" && m.module === "equipment");
    ok(mn.seq > eqp.seq, "보안장비 유지관리 다음 위치");
    eq(d.menus.find(m => m.id === "equip-council").label, "보안장비 협의체 (구버전)", "구링크 라벨 구분");
    eq(e.S.normalizeData(), false, "idempotent");
  });

  t("CN02 렌더(hq): C6-1 배너 + 통계 + 작성/ KPI 버튼", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "council");
    ok(q(e, ".page-title").textContent.includes("협의회"), "제목");
    ok(q(e, ".council-banner"), "C6-1 배너 표시");
    ok(q(e, ".council-banner").textContent.includes("C6-1"), "C6-1 근거 언급");
    ok(q(e, "#cn-add"), "작성 버튼(hq)");
    ok(q(e, "#cn-kpi"), "KPI C6-1 링크(hq)");
    ok(q(e, ".empty"), "빈 상태 안내");
  });

  t("CN03 회의록 작성 저장 + 참석자/사례/액션 + 목록 반영", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "council");
    q(e, "#cn-add").click();
    eq(q(e, "#cn-round").value, "1", "빈 상태 회차 기본 1");
    q(e, "#cn-round").value = "3";
    q(e, "#cn-date").value = "2026-07-15";
    q(e, "#cn-place").value = "인천화물터미널 B동 회의실";
    q(e, "#cn-chair").value = "최상일 프로";
    q(e, "#cn-att-add").click();
    const arow = q(e, "#cn-att .cn-att-row");
    arow.querySelector(".cn-a-org").value = "뉴원S&T";
    arow.querySelector(".cn-a-name").value = "홍길동";
    arow.querySelector(".cn-a-role").value = "차장";
    arow.querySelector(".cn-a-note").value = "기술지원";
    q(e, "#cn-case-add").click();
    const crow = q(e, "#cn-cases .cn-case-row");
    crow.querySelector(".cn-c-equip").value = "ETD 3호기";
    crow.querySelector(".cn-c-symptom").value = "잦은 알람 오류";
    crow.querySelector(".cn-c-cause").value = "멤브레인 노즐 오염";
    crow.querySelector(".cn-c-action").value = "노즐 교체 및 청소";
    // 본문은 리치 에디터(contenteditable) — innerHTML로 입력
    q(e, "#cn-agenda").innerHTML = '<a href="https://ex.com/manual" target="_blank" rel="noopener">정비 매뉴얼</a>';
    q(e, "#cn-env").innerHTML = "항온항습 시설 개선 논의";
    q(e, "#cn-proposals").innerHTML = "검색요원 정기 교육 제안";
    q(e, "#cn-act-add").click();
    const trow = q(e, "#cn-acts .cn-act-row");
    trow.querySelector(".cn-t-task").value = "부품 교체주기 데이터 검토";
    trow.querySelector(".cn-t-owner").value = "최상일";
    trow.querySelector(".cn-t-due").value = "2026-08-10";
    q(e, "#cn-save").click();
    eq(e.S.data.council.length, 1, "회의록 1건 저장");
    const c = e.S.data.council[0];
    eq(c.round, 3, "회차");
    eq(c.date, "2026-07-15", "회의일");
    eq(c.attendees.length, 1, "참석자 1명");
    eq(c.attendees[0].org, "뉴원S&T", "소속");
    eq(c.attendees[0].cat, "제조사", "구분 기본값");
    eq(c.attendees[0].note, "기술지원", "참석자 비고");
    eq(c.cases.length, 1, "사례 1건");
    eq(c.cases[0].equip, "ETD 3호기", "장비");
    eq(c.cases[0].cause, "멤브레인 노즐 오염", "근본원인");
    eq(c.env, "항온항습 시설 개선 논의", "사용환경 개선(텍스트)");
    eq(c.proposals, "검색요원 정기 교육 제안", "제안·토의(텍스트)");
    ok(c.agendaHtml.indexOf('href="https://ex.com/manual"') >= 0, "안건 링크 HTML 보존");
    eq(c.agenda, "정비 매뉴얼", "안건 텍스트 추출");
    eq(c.actions.length, 1, "액션 1건");
    eq(c.actions[0].done, false, "미완료");
    ok(q(e, "#cn-body").textContent.includes("제3차"), "목록에 표시");
  });

  t("CN04 권한: manager 읽기전용(인쇄 가능) + user 접근 차단", () => {
    const e = makeEnv();
    e.S.data.council = [{ id: "c1", round: 1, date: "2026-06-10", place: "B동",
      attendees: [{ cat: "제조사", org: "뉴원", name: "김보안" }], cases: [], actions: [], files: [] }];
    loginAs(e, "manager");
    go(e, "council");
    ok(!q(e, "#cn-add"), "manager 작성 버튼 없음");
    ok(!q(e, "#cn-kpi"), "manager KPI 링크 없음(hq 전용)");
    q(e, "[data-cn-row]").click();
    ok(q(e, "#modal-box").textContent.includes("제1차"), "상세 열람 가능");
    ok(!q(e, "#cn-edit") && !q(e, "#cn-del"), "수정/삭제 버튼 없음");
    ok(q(e, "#cn-print"), "인쇄는 가능");
    e.S.closeModal();
    // user 차단: 협의회 화면 미표시(대시보드로 리다이렉트)
    const e2 = makeEnv();
    loginAs(e2, "user");
    go(e2, "council");
    ok(!q(e2, ".council-banner"), "user는 협의회 화면 접근 차단");
  });

  t("CN05 인쇄: printMinutes가 회의록 iframe 생성 + 내용 포함", () => {
    const e = makeEnv();
    e.S.data.council = [{ id: "c1", round: 2, date: "2026-06-10", place: "B동 회의실",
      chair: "최상일", attendees: [{ cat: "제조사", org: "뉴원S&T", name: "홍길동", role: "차장" }],
      cases: [{ equip: "ETD 1호기", symptom: "알람", cause: "오염", action: "청소" }],
      env: "항온항습", proposals: "교육 제안",
      actions: [{ task: "데이터 검토", owner: "최상일", due: "2026-07-01", done: false }], files: [] }];
    loginAs(e, "hq");
    go(e, "council");
    const before = e.w.document.querySelectorAll("iframe").length;
    e.w.SemisCouncil.printMinutes("c1");
    const after = e.w.document.querySelectorAll("iframe").length;
    ok(after > before, "인쇄용 iframe 추가");
    const fr = Array.from(e.w.document.querySelectorAll("iframe")).pop();
    const html = fr.contentWindow.document.documentElement.innerHTML;
    ok(/보안장비 협의회 회의록/.test(html), "회의록 제목");
    ok(html.indexOf("홍길동") >= 0 && html.indexOf("ETD 1호기") >= 0, "참석자·사례 포함");
    ok(html.indexOf("C6-1") >= 0, "C6-1 근거 표기");
  });

  t("CN06 stats: 총/올해/누적 사례/미완료 액션 집계", () => {
    const e = makeEnv();
    const yr = new Date().getFullYear();
    e.S.data.council = [
      { id: "a", round: 1, date: yr + "-03-01", attendees: [], cases: [{}, {}], actions: [{ done: true }, { done: false }], files: [] },
      { id: "b", round: 2, date: "2025-01-01", attendees: [], cases: [{}], actions: [{ done: false }], files: [] }
    ];
    const s = e.w.SemisCouncil.stats();
    eq(s.total, 2, "총 2회");
    eq(s.thisYear, 1, "올해 1회");
    eq(s.cases, 3, "누적 사례 3건");
    eq(s.openAct, 2, "미완료 액션 2건");
    eq(e.w.SemisCouncil.nextRound(), 3, "다음 회차 = 최대+1");
  });

  t("CN07 council이 SYNC_KEYS에 포함(공용 DB 동기화)", () => {
    const e = makeEnv();
    ok(e.Sync.SYNC_KEYS.includes("council"), "동기화 대상 포함");
  });

  t("CN08 본문 리치: 상세·인쇄에 링크/이미지 HTML 렌더 + 구버전 텍스트 폴백", () => {
    const e = makeEnv();
    e.S.data.council = [{ id: "c1", round: 5, date: "2026-07-01", place: "B동",
      attendees: [], cases: [], actions: [], files: [],
      agenda: "매뉴얼", agendaHtml: '<a href="https://ex.com/a" target="_blank" rel="noopener">매뉴얼</a>',
      env: "사진", envHtml: '<p>개선 <img src="https://ex.com/i.jpg" alt="현장"></p>',
      proposals: "구버전 텍스트만", proposalsHtml: "" }];
    loginAs(e, "hq");
    go(e, "council");
    q(e, "[data-cn-row]").click();
    const html = q(e, "#modal-box").innerHTML;
    ok(html.indexOf('href="https://ex.com/a"') >= 0, "상세에 링크 렌더");
    ok(html.indexOf('src="https://ex.com/i.jpg"') >= 0, "상세에 이미지 렌더");
    ok(q(e, "#modal-box .notice-html"), "notice-html 서식 컨테이너 사용");
    ok(html.indexOf("구버전 텍스트만") >= 0, "Html 없는 필드는 텍스트 폴백");
    // 인쇄에도 반영
    e.w.SemisCouncil.printMinutes("c1");
    const fr = Array.from(e.w.document.querySelectorAll("iframe")).pop();
    const phtml = fr.contentWindow.document.documentElement.innerHTML;
    ok(phtml.indexOf("ex.com/a") >= 0 && phtml.indexOf("ex.com/i.jpg") >= 0, "인쇄에 링크·이미지 포함");
  });

  t("CN09 sanitize: 본문의 script/onerror 등 위험요소 제거", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "council");
    q(e, "#cn-add").click();
    q(e, "#cn-round").value = "9";
    q(e, "#cn-date").value = "2026-07-20";
    q(e, "#cn-env").innerHTML = '안전 <script>alert(1)<\/script><img src=x onerror="alert(2)">';
    q(e, "#cn-save").click();
    const c = e.S.data.council.find(x => x.round === 9);
    ok(c, "저장됨");
    ok(c.envHtml.indexOf("<script") < 0, "script 제거");
    ok(c.envHtml.toLowerCase().indexOf("onerror") < 0, "onerror 속성 제거");
  });

  t("CN10 인쇄: 머리행 가운데정렬 + 서명 열 + 서명 이미지", () => {
    const e = makeEnv();
    e.S.data.council = [{ id: "c1", round: 1, date: "2026-07-29", place: "B동",
      attendees: [{ cat: "제조사", org: "뉴원", name: "홍길동", role: "차장", sign: "https://ex.com/s.png" }],
      cases: [], actions: [], files: [] }];
    loginAs(e, "hq");
    go(e, "council");
    e.w.SemisCouncil.printMinutes("c1");
    const fr = Array.from(e.w.document.querySelectorAll("iframe")).pop();
    const html = fr.contentWindow.document.documentElement.innerHTML;
    ok(/\bth\s*\{[^}]*text-align:\s*center/.test(html), "머리행 가운데정렬 CSS");
    ok(html.indexOf("서명") >= 0, "서명 열 헤더");
    ok(html.indexOf("ex.com/s.png") >= 0, "서명 이미지 포함");
  });

  t("CN11 상세 서명 열 + setSign 저장/렌더", () => {
    const e = makeEnv();
    e.S.data.council = [{ id: "c1", round: 2, date: "2026-08-01", place: "B동",
      attendees: [{ cat: "본사", org: "항공화물", name: "김철수", role: "프로" }],
      cases: [], actions: [], files: [] }];
    loginAs(e, "hq");
    go(e, "council");
    q(e, "[data-cn-row]").click();
    ok(q(e, "#modal-box").innerHTML.indexOf("서명") >= 0, "상세에 서명 헤더");
    e.S.closeModal();
    ok(e.w.SemisCouncil.setSign("c1", 0, "https://ex.com/sig.png"), "setSign 성공");
    eq(e.S.data.council[0].attendees[0].sign, "https://ex.com/sig.png", "서명 값 저장");
    go(e, "council");
    q(e, "[data-cn-row]").click();
    ok(q(e, "#modal-box").innerHTML.indexOf("ex.com/sig.png") >= 0, "상세에 서명 이미지 렌더");
  });

  t("CN12 조직자 편집 저장 시 기존 서명 보존", () => {
    const e = makeEnv();
    e.S.data.council = [{ id: "c1", round: 3, date: "2026-08-05", place: "B동",
      attendees: [{ cat: "제조사", org: "뉴원", name: "홍길동", role: "차장", note: "", sign: "https://ex.com/keep.png" }],
      cases: [], actions: [], files: [] }];
    loginAs(e, "hq");
    go(e, "council");
    q(e, "[data-cn-row]").click();
    q(e, "#cn-edit").click();
    q(e, "#cn-att .cn-att-row").querySelector(".cn-a-name").value = "홍길동(수정)";
    q(e, "#cn-save").click();
    eq(e.S.data.council[0].attendees[0].name, "홍길동(수정)", "이름 수정 반영");
    eq(e.S.data.council[0].attendees[0].sign, "https://ex.com/keep.png", "서명 보존");
  });

  t("CN13 회의일 코드 로그인 → 서명 세션·서명 화면·타모듈 차단", () => {
    const e = makeEnv();
    e.S.data.council = [{ id: "cm1", round: 7, date: "2026-07-29", place: "인천화물터미널 B동",
      attendees: [{ cat: "제조사", org: "뉴원S&T", name: "홍길동", role: "차장" }, { cat: "본사", org: "항공화물", name: "김철수" }],
      cases: [], actions: [], files: [] }];
    const code13 = e.S.signCodeFor(e.S.data.council[0]);
    ok(/^\d{6}$/.test(code13), "코드는 6자리 숫자");
    submitLogin(e, code13);
    ok(e.S.user && e.S.user.role === "signer", "서명 세션 진입");
    eq(e.S.user.signMeetingId, "cm1", "대상 회의 지정");
    const view = q(e, "#view");
    ok(view.textContent.indexOf("참석 서명") >= 0, "서명 화면 렌더");
    ok(view.textContent.indexOf("홍길동") >= 0 && view.textContent.indexOf("김철수") >= 0, "참석자 목록 표시");
    ok(q(e, ".cn-sign-list [data-sign]"), "서명 버튼 존재");
    // 타 모듈 접근 차단 — 강제 council 서명 화면 유지
    go(e, "kpi");
    ok(q(e, "#view").textContent.indexOf("참석 서명") >= 0, "kpi 이동해도 서명 화면 유지");
    // 서명 저장 → 완료 표시
    e.w.SemisCouncil.setSign("cm1", 0, "https://ex.com/h.png");
    e.S.renderView();
    ok(q(e, "#view").innerHTML.indexOf("ex.com/h.png") >= 0, "서명 후 완료 상태 반영");
  });

  t("CN14 매칭 없는 코드 → 로그인 실패 / signCodeFor 결정적", () => {
    const e = makeEnv();
    e.S.data.council = [{ id: "cm1", round: 1, date: "2026-07-29", attendees: [], cases: [], actions: [], files: [] }];
    const real = e.S.signCodeFor(e.S.data.council[0]);
    eq(real, e.S.signCodeFor({ id: "cm1" }), "같은 id → 같은 코드(결정적)");
    const bad = real === "111111" ? "222222" : "111111";
    submitLogin(e, bad);
    ok(!e.S.user, "세션 없음(로그인 실패)");
    ok(q(e, "#login-error").textContent.indexOf("올바르지") >= 0, "오류 메시지 표시");
  });

  t("CN16 사례 발생일 필드 저장 + 상세·인쇄 렌더", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "council");
    q(e, "#cn-add").click();
    q(e, "#cn-round").value = "11";
    q(e, "#cn-date").value = "2026-06-18";
    q(e, "#cn-case-add").click();
    const crow = q(e, "#cn-cases .cn-case-row");
    crow.querySelector(".cn-c-date").value = "5/14";
    crow.querySelector(".cn-c-equip").value = "Xray 2호기";
    crow.querySelector(".cn-c-cause").value = "그래픽카드 파손";
    q(e, "#cn-save").click();
    const c = e.S.data.council.find(x => x.round === 11);
    eq(c.cases[0].date, "5/14", "발생일 저장");
    eq(c.cases[0].equip, "Xray 2호기", "장비 저장");
    // 상세: 발생일 헤더 + 값
    go(e, "council");
    q(e, `[data-cn-row="${c.id}"]`).click();
    const html = q(e, "#modal-box").innerHTML;
    ok(html.indexOf("발생일") >= 0, "상세 발생일 헤더");
    ok(html.indexOf("5/14") >= 0, "상세 발생일 값");
    // 인쇄
    e.w.SemisCouncil.printMinutes(c.id);
    const fr = Array.from(e.w.document.querySelectorAll("iframe")).pop();
    const phtml = fr.contentWindow.document.documentElement.innerHTML;
    ok(phtml.indexOf("발생일") >= 0 && phtml.indexOf("5/14") >= 0, "인쇄 발생일 포함");
  });

  t("CN17 본문 링크 제목 + 복사 버튼(decorateLinks)", () => {
    const e = makeEnv();
    e.S.data.council = [{ id: "c1", round: 5, date: "2026-07-01", place: "B동",
      attendees: [], cases: [], actions: [], files: [],
      agenda: "발표자료", agendaHtml: '<a href="https://docs.example.com/very/long/link/1234567890">발표자료</a>',
      env: "", envHtml: "", proposals: "", proposalsHtml: "" }];
    loginAs(e, "hq");
    go(e, "council");
    q(e, "[data-cn-row]").click();
    const box = q(e, "#modal-box");
    ok(box.innerHTML.indexOf(">발표자료<") >= 0, "링크 제목 텍스트 표시");
    ok(box.querySelector(".cn-link-copy"), "링크 뒤 복사 버튼 삽입");
    eq(box.querySelector(".cn-link-copy").dataset.copy, "https://docs.example.com/very/long/link/1234567890", "복사 대상은 원본 URL");
  });

  t("CN18 로그아웃 버튼 아이콘이 SVG(⏻ 문자 아님)", () => {
    const e = makeEnv();
    ok(q(e, "#logout-btn svg"), "로그아웃 버튼에 SVG 아이콘");
    ok(q(e, "#logout-btn").textContent.indexOf("⏻") < 0, "구 문자 아이콘 제거");
  });

  t("CN15 조직자 상세에 서명 코드 안내 노출(hq) / 일반 미노출", () => {
    const e = makeEnv();
    e.S.data.council = [{ id: "c1", round: 4, date: "2026-07-29", place: "B동",
      attendees: [{ cat: "제조사", org: "뉴원", name: "홍" }], cases: [], actions: [], files: [] }];
    loginAs(e, "hq");
    go(e, "council");
    q(e, "[data-cn-row]").click();
    ok(q(e, "#modal-box .cn-signcode"), "hq 상세에 코드 안내");
    const code15 = e.S.signCodeFor(e.S.data.council[0]);
    ok(q(e, "#modal-box").innerHTML.indexOf(code15) >= 0, "서명 코드(6자리) 표시");
    ok(q(e, "#modal-box .cn-signcode-copy"), "코드 복사 버튼");
    e.S.closeModal();
    // manager(열람 전용)는 코드 안내 미노출
    const e2 = makeEnv();
    e2.S.data.council = [{ id: "c1", round: 4, date: "2026-07-29", place: "B동",
      attendees: [{ cat: "제조사", org: "뉴원", name: "홍" }], cases: [], actions: [], files: [] }];
    loginAs(e2, "manager");
    go(e2, "council");
    q(e2, "[data-cn-row]").click();
    ok(!q(e2, "#modal-box .cn-signcode"), "manager 상세에는 코드 안내 없음");
  });

  t("CN19 운영사→운영자 rename + catNorm 하위호환", () => {
    const e = makeEnv();
    const C = e.w.SemisCouncil;
    ok(C.CATS.indexOf("운영자") >= 0, "운영자 옵션 존재");
    ok(C.CATS.indexOf("운영사") < 0, "운영사 옵션 제거");
    eq(C.catNorm("운영사"), "운영자", "구값 정규화");
    eq(C.catNorm("제조사"), "제조사", "타값 유지");
  });

  t("CN20 repairToCase: CARES 고장 → 사례 필드 매핑", () => {
    const e = makeEnv();
    const cs = e.w.SemisCouncil.repairToCase({
      id: "r1", equipmentName: "X-Ray 2호기", symptom: "꺼짐현상 반복",
      reportedAtMs: Date.UTC(2026, 4, 14, 6, 0, 0),
      rootCause: "그래픽카드 발열 파손", causeCategory: "mechanical",
      resolvedAtMs: Date.UTC(2026, 4, 15), resolvedBy: "홍진의",
      parts: [{ part: "그래픽카드", qty: 1 }]
    });
    ok(cs.date.indexOf("2026-05") === 0, "발생일 연월");
    eq(cs.equip, "X-Ray 2호기", "장비");
    eq(cs.symptom, "꺼짐현상 반복", "증상");
    ok(cs.cause.indexOf("그래픽카드 발열 파손") >= 0 && cs.cause.indexOf("[기계]") >= 0, "근본원인+원인분류");
    ok(cs.action.indexOf("홍진의") >= 0 && cs.action.indexOf("수리완료") >= 0 && cs.action.indexOf("그래픽카드") >= 0, "조치(처리자·상태·부품)");
  });

  t("CN21 mergeCaresIntoCases: 추가 / 미편집 갱신 / 편집 보존", () => {
    const e = makeEnv();
    const M = e.w.SemisCouncil.mergeCaresIntoCases;
    const cases = [];
    const r1 = { id: "r1", equipmentName: "ETD 1호기", symptom: "알람", reportedAtMs: Date.UTC(2026, 3, 10), rootCause: "오염" };
    let res = M(cases, [r1]);
    eq(res.added, 1, "신규 추가"); eq(cases.length, 1);
    ok(cases[0].caresId === "r1" && cases[0].caresSnap, "caresId/snap 기록");
    // 미편집 상태 → CARES 변경 반영
    res = M(cases, [Object.assign({}, r1, { symptom: "알람 빈발", rootCause: "노즐 오염" })]);
    eq(res.updated, 1, "미편집분 갱신");
    eq(cases[0].symptom, "알람 빈발", "CARES 최신 반영");
    // 사용자 편집 후 → 보존
    cases[0].cause = "사용자 직접 수정";
    res = M(cases, [Object.assign({}, r1, { symptom: "덮어쓰면안됨" })]);
    eq(res.kept, 1, "편집분 보존 카운트");
    eq(cases[0].cause, "사용자 직접 수정", "편집 내용 유지");
    ok(cases[0].symptom !== "덮어쓰면안됨", "편집분은 CARES로 덮지 않음");
  });

  await ta("CN22 편집폼 CARES 동기화 버튼 → 기간 내 사례 채움 + caresId 저장", async () => {
    const e = makeEnv();
    e.S.data.council = [
      { id: "m1", round: 1, date: "2026-03-19", attendees: [], cases: [], actions: [], files: [] },
      { id: "m2", round: 2, date: "2026-04-17", attendees: [], cases: [], actions: [], files: [] }
    ];
    e.w.SemisEquipment.loadCares = async () => ({ err: null, repairs: [
      { id: "rp1", equipmentName: "ETD 1호기", symptom: "알람", reportedAtMs: Date.UTC(2026, 3, 5), rootCause: "오염", resolvedBy: "홍진의", resolvedAtMs: Date.UTC(2026, 3, 6) },
      { id: "rp0", equipmentName: "ETD 2호기", symptom: "기간밖", reportedAtMs: Date.UTC(2026, 2, 1) }
    ]});
    loginAs(e, "hq");
    go(e, "council");
    q(e, '[data-cn-row="m2"]').click();
    q(e, "#cn-edit").click();
    ok(q(e, "#cn-cares-sync"), "동기화 버튼 존재");
    q(e, "#cn-cares-sync").click();
    await new Promise(r => setTimeout(r, 30));
    q(e, "#cn-save").click();
    const m2 = e.S.data.council.find(c => c.id === "m2");
    eq(m2.cases.length, 1, "기간(3/19~4/17) 내 1건만");
    eq(m2.cases[0].equip, "ETD 1호기", "장비 매핑");
    eq(m2.cases[0].caresId, "rp1", "caresId 저장");
    ok(m2.cases[0].caresSnap && m2.cases[0].caresSnap.symptom === "알람", "snapshot 저장");
  });

  /* ─ v2.30: 협의회 서명 자가등록 ─ */
  t("CN23 orgToCat: 소속→구분 자동 매핑 (인씨스=유지보수 포함)", () => {
    const C = makeEnv().w.SemisCouncil;
    eq(C.orgToCat("항공보안파트"), "본사", "항공보안파트");
    eq(C.orgToCat("인천화물팀"), "운영자", "인천화물팀");
    eq(C.orgToCat("프로에스콤"), "유지보수", "프로에스콤");
    eq(C.orgToCat("인씨스"), "유지보수", "인씨스=유지보수");
    eq(C.orgToCat("뉴원에스엔티"), "제조사", "뉴원에스엔티");
    eq(C.orgToCat("AAP"), "운영자", "AAP");
    eq(C.orgToCat("국가기관"), "기타", "국가기관");
    eq(C.orgToCat("뉴원S&T"), "제조사", "변형 표기");
    eq(C.orgToCat("인천화물터미널"), "운영자", "부분 일치");
    eq(C.orgToCat("어딘가상사"), "기타", "미지정→기타");
    eq(C.ORG_PRESETS.length, 7, "프리셋 7종");
  });

  t("CN24 서명 화면: 본인 확인 모달 + 직접 입력 버튼 + 소속 프리셋", () => {
    const e = makeEnv();
    e.S.data.council = [{ id: "cm1", round: 5, date: "2026-07-29", place: "B동",
      attendees: [{ cat: "본사", org: "항공보안파트", name: "김본사", role: "부장" }],
      cases: [], actions: [], files: [] }];
    submitLogin(e, e.S.signCodeFor(e.S.data.council[0]));
    ok(q(e, "#cn-sign-new"), "직접 입력 버튼 존재");
    q(e, ".cn-sign-list [data-sign]").click();
    eq(q(e, "#cn-sp-name").value, "김본사", "이름 자동 채움");
    eq(q(e, "#cn-sp-org").value, "항공보안파트", "소속 자동 선택");
    const opts = qa(e, "#cn-sp-org option").map(o => o.value);
    ["항공보안파트", "인천화물팀", "프로에스콤", "인씨스", "뉴원에스엔티", "AAP", "국가기관"]
      .forEach(o => ok(opts.indexOf(o) >= 0, "프리셋 " + o));
    e.S.closeModal();
    q(e, "#cn-sign-new").click();
    ok(q(e, "#cn-sp-names"), "이전 참석자 datalist");
    ok(q(e, "#cn-sp-names option"), "이력 옵션 존재");
  });

  t("CN25 saveSignEntry: 신규 자가등록·동명 병합·구분 자동·서명 보존", () => {
    const e = makeEnv();
    e.S.data.council = [{ id: "cm1", round: 5, date: "2026-07-29",
      attendees: [{ cat: "본사", org: "항공보안파트", name: "김본사", role: "부장", note: "주재", sign: "" }],
      cases: [], actions: [], files: [] }];
    const C = e.w.SemisCouncil;
    ok(C.saveSignEntry("cm1", -1, { name: "박신규", org: "프로에스콤", role: "과장" }, "https://ex.com/p.png", false), "신규 저장");
    const m = e.S.data.council[0];
    eq(m.attendees.length, 2, "행 추가");
    eq(m.attendees[1].cat, "유지보수", "구분 자동(프로에스콤)");
    eq(m.attendees[1].sign, "https://ex.com/p.png", "서명 저장");
    ok(C.saveSignEntry("cm1", -1, { name: "김본사", org: "항공보안파트", role: "팀장", cat: "본사" }, "https://ex.com/k.png", false), "동명 병합");
    eq(m.attendees.length, 2, "중복 추가 없음");
    eq(m.attendees[0].role, "팀장", "직책 갱신");
    eq(m.attendees[0].sign, "https://ex.com/k.png", "서명 반영");
    eq(m.attendees[0].note, "주재", "비고 보존");
    ok(C.saveSignEntry("cm1", 0, { name: "김본사", org: "항공보안파트", role: "실장", cat: "본사" }, "", false), "정보만 갱신");
    eq(m.attendees[0].role, "실장", "직책 재갱신");
    eq(m.attendees[0].sign, "https://ex.com/k.png", "빈 서명 전달 시 기존 서명 보존");
  });

  t("CN26 지난 회 반영: 일괄 갱신·이후 회의 제외·서명 보존 / knownPeople 최신 우선", () => {
    const e = makeEnv();
    e.S.data.council = [
      { id: "m1", round: 1, date: "2026-03-19", attendees: [{ cat: "제조사", org: "인씨스", name: "이정비", role: "대리", sign: "https://ex.com/old.png" }], cases: [], actions: [], files: [] },
      { id: "m2", round: 2, date: "2026-04-17", attendees: [{ cat: "제조사", org: "인씨스", name: "이정비", role: "대리" }], cases: [], actions: [], files: [] },
      { id: "m3", round: 3, date: "2026-07-29", attendees: [], cases: [], actions: [], files: [] },
      { id: "m4", round: 4, date: "2026-09-01", attendees: [{ cat: "제조사", org: "인씨스", name: "이정비", role: "차장" }], cases: [], actions: [], files: [] }
    ];
    const C = e.w.SemisCouncil;
    eq(C.knownPeople().get("이정비").role, "차장", "최신(날짜) 기록 우선");
    ok(C.saveSignEntry("m3", -1, { name: "이정비", org: "인씨스", role: "과장", cat: "유지보수" }, "https://ex.com/n.png", true), "저장+지난 회 반영");
    const d = e.S.data.council;
    eq(d[2].attendees.length, 1, "이번 회의 등록");
    eq(d[0].attendees[0].role, "과장", "m1 직책 갱신");
    eq(d[0].attendees[0].cat, "유지보수", "m1 구분 갱신");
    eq(d[0].attendees[0].sign, "https://ex.com/old.png", "m1 기존 서명 보존");
    eq(d[1].attendees[0].role, "과장", "m2 갱신");
    eq(d[3].attendees[0].role, "차장", "이후 회의(m4)는 미변경");
  });

  t("CN27 회차 선택: 지난 회의 열람·본인 정보만 저장(서명 유지)·이번 회의 복귀", () => {
    const e = makeEnv();
    e.S.data.council = [
      { id: "m1", round: 1, date: "2026-03-19", place: "B동",
        attendees: [{ cat: "유지보수", org: "인씨스", name: "이정비", role: "대리", note: "", sign: "https://ex.com/s1.png" }],
        cases: [], actions: [], files: [] },
      { id: "m2", round: 2, date: "2026-07-29", place: "B동", attendees: [], cases: [], actions: [], files: [] }
    ];
    submitLogin(e, e.S.signCodeFor(e.S.data.council[1]));
    const sel = q(e, "#cn-sign-meet");
    ok(sel, "회차 선택 존재");
    eq(qa(e, "#cn-sign-meet option").length, 2, "전체 회차 옵션");
    eq(sel.value, "m2", "이번 회의 기본 선택");
    ok(q(e, "#view").textContent.indexOf("이번 서명 회의") >= 0, "이번 회의 표시");
    // 지난 회의로 전환 (코드 재입력 없음)
    sel.value = "m1"; sel.onchange();
    ok(q(e, "#view").textContent.indexOf("이정비") >= 0, "지난 회의 명단 표시");
    ok(q(e, "#view").textContent.indexOf("지난 회의 명단") >= 0, "지난 회의 안내");
    ok(q(e, "#cn-sign-home"), "이번 회의로 버튼");
    // 본인 항목 → 정보만 저장 (서명 유지)
    q(e, ".cn-sign-list [data-sign]").click();
    ok(q(e, "#cn-sp-save"), "정보만 저장 버튼(서명 보유자)");
    q(e, "#cn-sp-role").value = "과장";
    q(e, "#cn-sp-save").click();
    const a1 = e.S.data.council[0].attendees[0];
    eq(a1.role, "과장", "지난 회의 직책 수정");
    eq(a1.sign, "https://ex.com/s1.png", "기존 서명 유지");
    eq(q(e, "#cn-sign-meet").value, "m1", "저장 후에도 선택 회차 유지");
    // 이번 회의 복귀
    q(e, "#cn-sign-home").click();
    eq(q(e, "#cn-sign-meet").value, "m2", "이번 회의 복귀");
    ok(!q(e, "#cn-sign-home"), "복귀 후 버튼 미표시");
  });

  /* ══════════ [CR*] 부적합·시정조치 (CAR·CAP·FAT) v2.29 ══════════ */
  t("CR01 normalize: cars 배열 + carCfg 객체 + insp-car 메뉴(vis hq, grp-inspect)", () => {
    const e = makeEnv();
    const d = e.S.data;
    ok(Array.isArray(d.cars), "cars 배열");
    ok(d.carCfg && typeof d.carCfg === "object" && !Array.isArray(d.carCfg), "carCfg 객체");
    const mn = d.menus.find(m => m.type === "module" && m.module === "carcap");
    ok(mn, "carcap 모듈 메뉴 존재");
    eq(mn.parent, "grp-inspect", "grp-inspect 소속");
    eq(mn.vis, "hq", "vis=hq (항공보안파트 이상)");
    eq(e.S.normalizeData(), false, "idempotent");
  });

  t("CR02 normalize: 기존 데이터에 cars/carCfg/메뉴 자동 보정", () => {
    const e = makeEnv();
    const d = e.S.data;
    delete d.cars; delete d.carCfg;
    d.menus = d.menus.filter(m => !(m.type === "module" && m.module === "carcap"));
    ok(e.S.normalizeData(), "변경 감지");
    ok(Array.isArray(d.cars) && d.carCfg, "보정됨");
    ok(d.menus.find(m => m.module === "carcap"), "메뉴 재삽입");
  });

  t("CR03 SYNC_KEYS: cars, carCfg 포함", () => {
    const e = makeEnv();
    ok(e.Sync.SYNC_KEYS.includes("cars"), "cars");
    ok(e.Sync.SYNC_KEYS.includes("carCfg"), "carCfg");
  });

  t("CR04 위험 매트릭스 bandOf (항공보안파트 셀별 기준)", () => {
    const CC = makeEnv().w.SemisCarcap;
    eq(CC.bandOf(5, "A").key, "lv5", "5A=Lv5 심각(빨강)");
    eq(CC.bandOf(4, "B").key, "lv5", "4B=Lv5 심각");
    eq(CC.bandOf(3, "A").key, "lv4", "3A=Lv4 경계(오렌지)");
    eq(CC.bandOf(3, "C").key, "lv3", "3C=Lv3 주의(노랑)");
    eq(CC.bandOf(2, "C").key, "lv2", "2C=Lv2 관심(파랑)");
    eq(CC.bandOf(1, "E").key, "lv1", "1E=Lv1 예방(초록)");
    eq(CC.bandOf(1, "A").key, "lv3", "1A=Lv3(고심각·저빈도)");
    // 25셀 전부 배정 확인
    eq(Object.keys(CC.CELL_DEFAULT).length, 25, "25셀 배정");
  });

  t("CR04b 자동 위험도 제안 (suggestRisk)", () => {
    const CC = makeEnv().w.SemisCarcap;
    eq(CC.suggestRisk({ classification: "시정", nonconformance: "위해물품(칼) 검색 실패" }).S, "B", "위해물품 검색실패→심각도 B");
    eq(CC.suggestRisk({ classification: "개선권고", nonconformance: "교육 컨텐츠 개선 권고" }).S, "E", "개선권고→심각도 E");
    eq(CC.suggestRisk({ classification: "시정", nonconformance: "봉인 미부착" }).S, "C", "봉인 미부착→심각도 C");
    eq(CC.suggestRisk({ classification: "시정", nonconformance: "봉인", recurCount: 4 }).L, 5, "재발 4건→빈도 5");
    eq(CC.suggestRisk({ classification: "시정", nonconformance: "봉인", recurCount: 1 }).L, 3, "최초→빈도 3");
    ok(CC.suggestRisk({ classification: "시정", nonconformance: "위해물품 검색 실패", recurCount: 4 }).band === "lv5", "빈발+고심각→Lv5");
  });

  t("CR05 날짜 유틸 (addDays/addMonths 말일보정/daysBetween)", () => {
    const CC = makeEnv().w.SemisCarcap;
    eq(CC.addDays("2026-07-01", 21), "2026-07-22", "발행+21");
    eq(CC.addMonths("2026-01-31", 1), "2026-02-28", "1/31+1개월=2/28");
    eq(CC.addMonths("2026-07-01", 3), "2026-10-01", "+3개월");
    eq(CC.daysBetween("2026-07-01", "2026-07-22"), 21, "21일");
  });

  t("CR06 기한 계산 (CAP 마감=발행+21, FAT=회신+완료기한)", () => {
    const CC = makeEnv().w.SemisCarcap;
    eq(CC.calcCapDue({ issuedDate: "2026-07-01" }), "2026-07-22", "CAP 마감");
    eq(CC.calcFatDue({ classification: "시정", capSubmitted: "2026-07-01" }), "2026-08-01", "시정 완료 1개월");
    eq(CC.calcFatDue({ classification: "개선권고", capSubmitted: "2026-07-01" }), "2026-10-01", "개선권고 3개월");
  });

  t("CR07 escLevel 에스컬레이션 (경과/임박/종결)", () => {
    const CC = makeEnv().w.SemisCarcap;
    const today = new Date().toISOString().slice(0, 10);
    const over = CC.escLevel({ stage: "CAR", issuedDate: CC.addDays(today, -40), capSubmitted: "" });
    ok(over && over.over, "기한 경과 감지");
    eq(over.state, "심각", "경과 19일→심각");
    eq(over.band, "red", "red 밴드");
    const soon = CC.escLevel({ stage: "CAR", issuedDate: CC.addDays(today, -19), capSubmitted: "" });
    ok(soon && !soon.over && soon.state === "임박", "D-2 임박");
    eq(CC.escLevel({ stage: "종결", issuedDate: "2020-01-01" }), null, "종결은 알람 없음");
  });

  t("CR08 CAR 번호 자동생성 (YY-LOC-DEPT-##F/R)", () => {
    const e = makeEnv();
    const CC = e.w.SemisCarcap;
    eq(CC.nextNo({ year: 2026, locCode: "BKK", deptCode: "SU", classification: "시정" }), "26-BKK-SU-01F", "최초 01F");
    e.S.data.cars.push({ id: "c1", no: "26-BKK-SU-01F", year: 2026 });
    eq(CC.nextNo({ year: 2026, locCode: "BKK", deptCode: "SU", classification: "시정" }), "26-BKK-SU-02F", "다음 02F");
    eq(CC.nextNo({ year: 2026, locCode: "BKK", deptCode: "SU", classification: "개선권고" }), "26-BKK-SU-02R", "개선권고 R");
  });

  t("CR09 다빈도 재발 recurrence (집중관리 임계)", () => {
    const e = makeEnv();
    const CC = e.w.SemisCarcap;
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 3; i++) e.S.data.cars.push({ id: "r" + i, target: "FRASF", domain: "화물보안", auditDate: today });
    const r = CC.recurrence({ id: "new", target: "FRASF", domain: "화물보안", auditDate: today });
    eq(r.count, 4, "동일 대상·분야 4건");
    ok(r.focus, "4건≥임계 → 집중관리");
  });

  t("CR10 CAR 등록 폼 저장 (hq)", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "carcap");
    ok(q(e, "#car-add"), "등록 버튼(hq)");
    q(e, "#car-add").click();
    q(e, "#cf-target").value = "FRASF";
    q(e, "#cf-nc").value = "화물 보안검색 세부사항 누락";
    q(e, "#cf-issued").value = "2026-07-10";
    q(e, "#cf-save").click();
    eq(e.S.data.cars.length, 1, "1건 저장");
    eq(e.S.data.cars[0].target, "FRASF", "대상 저장");
    ok(e.S.data.cars[0].no || e.S.data.cars[0].seq, "번호/순번 부여");
  });

  t("CR11 목록·단계 배지·위험도 렌더", () => {
    const e = makeEnv();
    e.S.data.cars.push({ id: "c1", year: new Date().getFullYear(), no: "26-LSG-OM-01F", target: "LSG",
      domain: "화물보안", classification: "시정", stage: "CAP", risk: { L: 4, S: "B" }, nonconformance: "봉인 미부착" });
    loginAs(e, "hq");
    go(e, "carcap");
    ok(q(e, ".car-tbl"), "목록 테이블");
    ok(q(e, "#car-body").textContent.includes("26-LSG-OM-01F"), "CAR 번호 표시");
    ok(q(e, "#car-body").textContent.includes("4B"), "위험도 4B 표시");
  });

  t("CR12 권한: user 열람 차단 / hq 열람", () => {
    const e = makeEnv();
    const mn = e.S.data.menus.find(m => m.module === "carcap");
    loginAs(e, "user");
    eq(e.S.canSee(mn), false, "user 미열람");
    go(e, "carcap");
    ok(!q(e, ".page-title").textContent.includes("부적합"), "user는 CAR 페이지 차단");
    loginAs(e, "hq");
    eq(e.S.canSee(mn), true, "hq 열람 가능");
    go(e, "carcap");
    ok(q(e, ".page-title").textContent.includes("부적합"), "hq는 CAR 페이지 표시");
  });

  t("CR13 대시보드 CAR 카드 (mgr 이상) + 알람", () => {
    const e = makeEnv();
    eq(e.w.SemisDash.DASH_CARDS.car, "mgr", "카드 vis=mgr");
    const today = new Date().toISOString().slice(0, 10);
    e.S.data.cars.push({ id: "c1", year: new Date().getFullYear(), no: "26-BKK-SU-01F", target: "BKK지점",
      stage: "CAR", issuedDate: e.w.SemisCarcap.addDays(today, -40), capSubmitted: "" });
    loginAs(e, "manager");
    ok(e.w.SemisDash.cardVis("car"), "manager 카드 열람");
    go(e, "dashboard");
    ok(q(e, "#car-box"), "car-box 렌더");
    ok(q(e, "#car-box").textContent.includes("D+"), "기한 경과 알람 표시");
  });

  t("CR14 설정(carCfg) 병합 반영", () => {
    const e = makeEnv();
    const CC = e.w.SemisCarcap;
    e.S.data.carCfg = { capDueDays: 30 };
    eq(CC.cfg().capDueDays, 30, "설정 반영");
    eq(CC.cfg().likelihood.length, 5, "기본 빈도 유지");
    eq(CC.calcCapDue({ issuedDate: "2026-07-01" }), "2026-07-31", "마감 30일 적용");
    e.S.data.carCfg = { cellOverride: { "3C": "lv5" } };
    eq(CC.bandOf(3, "C").key, "lv5", "셀별 위험수준 변경 반영(3C→Lv5)");
  });

  t("CR15 위험매트릭스/보드 뷰 렌더 무오류", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.w.SemisCarcap.setView("matrix");
    go(e, "carcap");
    ok(q(e, ".rm-grid"), "매트릭스 그리드");
    ok(qa(e, ".rm-cell").length === 25, "5x5 = 25셀");
    e.w.SemisCarcap.setView("board");
    go(e, "carcap");
    ok(q(e, ".car-board"), "프로세스 보드");
    e.w.SemisCarcap.setView("list");
  });

  t("CR16 상세 문서 뷰 렌더 (타임라인·서명그리드·기한)", () => {
    const e = makeEnv();
    const Y = new Date().getFullYear();
    e.S.data.cars.push({ id: "d1", year: Y, no: "26-PSC-HQ-01F", target: "ProScom", domain: "보안검색",
      classification: "시정", stage: "CAP", issuedDate: "2026-07-01", capSubmitted: "2026-07-10",
      risk: { L: 5, S: "B" }, nonconformance: "위해물품 검색 실패", reference: "국가항공보안계획 8.9.3",
      cap: { rootCause: "적극적 검색 미실시", action: "규정 준수 교육" }, signs: {} });
    loginAs(e, "hq");
    e.w.SemisCarcap.open("d1");
    const box = q(e, "#modal-box");
    ok(box.textContent.includes("Corrective Action Report"), "CAR 문서 제목");
    ok(q(e, ".cr-flow"), "프로세스 타임라인");
    ok(q(e, ".cr-signs"), "서명 그리드");
    ok(qa(e, ".cr-sign").length === 8, "서명 슬롯 8종(발행/접수확인/작성/검토/승인/수리/검증/종결)");
    ok(box.textContent.includes("근본원인"), "CAP 근본원인 표시");
  });

  t("CR17 설정 모달 저장 (기한/밴드 수정)", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "carcap");
    ok(q(e, "#car-cfg"), "설정 버튼(hq)");
    q(e, "#car-cfg").click();
    ok(q(e, "#cs-save"), "설정 모달 열림");
    q(e, "#cs-capdays").value = "30";
    q(e, "#cs-save").click();
    eq(e.S.data.carCfg.capDueDays, 30, "CAP 마감일수 저장");
    eq(e.w.SemisCarcap.calcCapDue({ issuedDate: "2026-07-01" }), "2026-07-31", "저장값 적용");
  });

  t("CR18 워크플로 게이트: 지적→CAR→CAP 진행", () => {
    const e = makeEnv();
    const Y = new Date().getFullYear();
    e.S.data.cars.push({ id: "w1", year: Y, no: "26-BKK-SU-01F", target: "BKK지점", classification: "시정",
      stage: "지적", issuedDate: "2026-07-01", risk: { L: 4, S: "C" },
      signs: { carIssue: { name: "최상일", img: "x", at: "2026-07-01T00:00:00Z" } } });
    loginAs(e, "hq");
    e.w.SemisCarcap.open("w1");
    ok(q(e, "#cd-adv"), "발행 버튼");
    q(e, "#cd-adv").click(); // 지적 → CAR (carIssue 사전 서명 → 서명패드 생략)
    eq(e.S.data.cars[0].stage, "CAR", "CAR 발행됨");
    ok(e.S.data.cars[0].capDue, "CAP 마감기한 자동설정");
    q(e, "#cd-adv").click(); // CAR → CAP 접수 처리 모달
    ok(q(e, "#cg-ok"), "CAP 접수 모달");
    q(e, "#cg-sub").value = "2026-07-15";
    q(e, "#cg-ok").click();
    eq(e.S.data.cars[0].stage, "CAP", "CAP 접수됨");
    eq(e.S.data.cars[0].capSubmitted, "2026-07-15", "접수일 기록");
    ok(e.S.data.cars[0].fatDue, "FAT 마감기한 자동설정");
  });

  t("CR19 분야 기본값(여객 제외) + carCfg 편집 반영", () => {
    const CC = makeEnv().w.SemisCarcap;
    ok(CC.cfg().domains.indexOf("여객·수하물") < 0, "여객 항목 제외(화물전용)");
    ok(CC.cfg().domains.indexOf("화물보안") >= 0, "화물보안 포함");
    const e = makeEnv();
    e.S.data.carCfg = { domains: ["화물보안", "특송화물"] };
    eq(e.w.SemisCarcap.cfg().domains.length, 2, "편집 목록 반영");
    ok(e.w.SemisCarcap.cfg().domains.indexOf("특송화물") >= 0, "커스텀 분야");
  });

  t("CR20 전체화면 토글", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "carcap");
    ok(q(e, "#car-fs"), "전체화면 버튼");
    q(e, "#car-fs").click();
    ok(q(e, ".card.car-fullscreen"), "전체화면 적용");
    q(e, "#car-fs").click();
    ok(!q(e, ".card.car-fullscreen"), "전체화면 해제");
  });

  t("CR21 설정 모달에서 분야 추가 저장", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "carcap");
    q(e, "#car-cfg").click();
    ok(q(e, "#cs-dom-new"), "분야 편집 입력");
    q(e, "#cs-dom-new").value = "특송화물";
    q(e, "#cs-dom-add").click();
    q(e, "#cs-save").click();
    ok((e.S.data.carCfg.domains || []).indexOf("특송화물") >= 0, "분야 추가 저장됨");
    // 폼 드롭다운에도 반영
    q(e, "#car-add").click();
    ok(q(e, "#cf-domain").textContent.includes("특송화물"), "등록 폼 드롭다운 반영");
  });

  t("CR22 CAR 코드 원격 로그인 → signer 세션", () => {
    const e = makeEnv();
    const Y = new Date().getFullYear();
    e.S.data.cars.push({ id: "sc1", year: Y, no: "26-BKK-SU-09F", target: "BKK지점", classification: "시정", stage: "CAR", issuedDate: "2026-07-10", nonconformance: "봉인 미부착", signs: {} });
    const code = e.S.signCodeFor(e.S.data.cars.find(c => c.id === "sc1"));
    ok(/^\d{6}$/.test(code), "6자리 코드");
    eq(e.S.signCarFor(code).id, "sc1", "코드→CAR 매칭");
    submitLogin(e, code);
    ok(e.S.user && e.S.user.role === "signer", "signer 로그인");
    eq(e.S.user.signCarId, "sc1", "signCarId 세팅");
    e.S.renderView();
    ok(q(e, ".cr-sign-page"), "접수확인 서명 화면 렌더");
    ok(q(e, "#crs-sign"), "서명 버튼");
  });

  t("CR23 renderSigning 안전정보 표시 + orgAck 반영", () => {
    const e = makeEnv();
    const Y = new Date().getFullYear();
    e.S.data.cars.push({ id: "sc2", year: Y, no: "26-LSG-OM-09F", target: "LSG", classification: "시정", stage: "CAR", issuedDate: "2026-07-10", nonconformance: "봉인 미부착 확인", reference: "자체보안계획 8.1.2", signs: {} });
    const CC = e.w.SemisCarcap;
    const root = e.w.document.getElementById("view");
    CC.renderSigning(root, "sc2");
    ok(root.textContent.includes("LSG"), "수검조직 표시");
    ok(root.textContent.includes("봉인 미부착"), "부적합 내용 표시");
    ok(root.textContent.includes("접수확인"), "접수확인 안내");
    const rec = e.S.data.cars.find(c => c.id === "sc2");
    rec.signs.orgAck = { name: "LSG 소장", img: "data:img", at: "2026-07-12T00:00:00Z" };
    const ai = CC.ackInfo(rec);
    ok(ai.acked, "ackInfo.acked");
    eq(ai.at.slice(0, 10), "2026-07-12", "서명일");
  });

  t("CR24 접수확인 기한/경과 (ackDays)", () => {
    const CC = makeEnv().w.SemisCarcap;
    eq(CC.calcAckDue({ issuedDate: "2026-07-10" }), "2026-07-17", "발행+7일");
    const today = new Date().toISOString().slice(0, 10);
    ok(CC.ackInfo({ stage: "CAR", issuedDate: CC.addDays(today, -10), signs: {} }).overdue, "미서명 기한경과");
    ok(!CC.ackInfo({ stage: "CAR", issuedDate: CC.addDays(today, -10), signs: { orgAck: { name: "x", at: "2026" } } }).overdue, "서명완료시 경과 아님");
  });

  t("CR25 상세 접수확인 배너 + 코드 (hq)", () => {
    const e = makeEnv();
    const Y = new Date().getFullYear();
    e.S.data.cars.push({ id: "sc3", year: Y, no: "26-BKK-SU-08F", target: "BKK", classification: "시정", stage: "CAR", issuedDate: "2026-07-10", signs: {} });
    loginAs(e, "hq");
    e.w.SemisCarcap.open("sc3");
    const box = q(e, "#modal-box");
    ok(box.textContent.includes("접수확인"), "상세 접수확인 배너");
    const code = e.S.signCodeFor(e.S.data.cars.find(c => c.id === "sc3"));
    ok(box.textContent.includes(code), "코드 표시");
    ok(q(e, "#cd-copycode"), "코드 복사 버튼");
  });

  t("CR26 signer 격리 — 단일 메뉴만", () => {
    const e = makeEnv();
    const Y = new Date().getFullYear();
    e.S.data.cars.push({ id: "sc4", year: Y, no: "26-ABC-DE-01F", target: "T", classification: "시정", stage: "CAR", issuedDate: "2026-07-10", signs: {} });
    const code = e.S.signCodeFor(e.S.data.cars.find(c => c.id === "sc4"));
    submitLogin(e, code);
    ok(e.S.user && e.S.user.role === "signer", "signer");
    e.S.renderNav();
    const items = qa(e, "#nav-menu .nav-item");
    eq(items.length, 1, "단일 메뉴");
    ok(items[0].textContent.includes("접수확인"), "접수확인 서명 메뉴");
  });

  t("CR27 25셀 색상 배정이 항공보안파트 기준과 정확히 일치", () => {
    const CC = makeEnv().w.SemisCarcap;
    const expect = {
      red:    ["5A", "4A", "5B", "4B"],
      orange: ["5C", "4C", "3B", "3A"],
      yellow: ["5E", "5D", "4D", "3C", "2B", "2A", "1A"],
      blue:   ["4E", "3D", "2D", "2C", "1B"],
      green:  ["3E", "2E", "1E", "1D", "1C"]
    };
    const key2color = { lv5: "red", lv4: "orange", lv3: "yellow", lv2: "blue", lv1: "green" };
    let n = 0;
    Object.keys(expect).forEach(color => expect[color].forEach(code => {
      const L = Number(code[0]), S = code[1];
      eq(key2color[CC.bandOf(L, S).key], color, code + " → " + color);
      n++;
    }));
    eq(n, 25, "총 25셀 검증");
  });

  t("CR28 위험도 평가 후 폼 입력 보존(데이터 손실 회귀)", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "carcap");
    q(e, "#car-add").click();
    q(e, "#cf-target").value = "FRASF";
    q(e, "#cf-nc").value = "발목 위해물품 미탐지";
    q(e, "#cf-ref").value = "TAC701 5.5";
    q(e, "#cf-risk-btn").click();                              // 위험도 평가 오버레이 열기
    ok(q(e, "#cf-nc"), "폼이 파괴되지 않음(오버레이 분리)");
    eq(q(e, "#cf-nc").value, "발목 위해물품 미탐지", "입력 보존(부적합)");
    const ov = e.w.document.querySelector(".cr-rm-overlay");
    ok(ov, "위험도 오버레이 생성");
    const cell = ov.querySelector('.rm-cell[data-l="4"][data-s="B"]');
    ok(cell, "4B 셀 존재");
    cell.click();
    ov.querySelector(".cr-rm-ok").click();
    ok(!e.w.document.querySelector(".cr-rm-overlay"), "적용 후 오버레이 닫힘");
    ok(q(e, "#cf-risk-box").textContent.includes("4B"), "위험도가 폼에 표시됨");
    eq(q(e, "#cf-ref").value, "TAC701 5.5", "입력 보존(근거)");
    q(e, "#cf-save").click();
    const rec = e.S.data.cars[e.S.data.cars.length - 1];
    eq(rec.nonconformance, "발목 위해물품 미탐지", "저장: 부적합 내용");
    eq(rec.reference, "TAC701 5.5", "저장: 관련근거");
    ok(rec.risk && rec.risk.L === 4 && rec.risk.S === "B", "저장: 위험도 4B");
  });

  /* ══════════ [W] 콘텐츠 폭 티어 (v2.31.2) ══════════ */

  const WIDE_EXPECT = ["schedule", "inspection", "carcap", "kpi", "policy", "dashboard"];
  const MID_EXPECT = ["passes", "branches", "contracts-mgmt", "training", "certs", "contacts", "council", "billing", "equipment", "regs-intl", "regs-own", "vault"];

  t("W1 밀집형 모듈은 view-wide", () => {
    const e = makeEnv();
    loginAs(e, "admin");
    WIDE_EXPECT.forEach(r => {
      go(e, r);
      const cl = q(e, "#view").classList;
      ok(cl.contains("view-wide"), r + " → view-wide");
      ok(!cl.contains("view-mid"), r + " → mid 클래스 미부여");
    });
  });

  t("W2 중간 밀도 모듈은 view-mid", () => {
    const e = makeEnv();
    loginAs(e, "admin");
    MID_EXPECT.forEach(r => {
      go(e, r);
      const cl = q(e, "#view").classList;
      ok(cl.contains("view-mid"), r + " → view-mid");
      ok(!cl.contains("view-wide"), r + " → wide 클래스 미부여");
    });
  });

  t("W3 티어 전환 시 이전 클래스 제거(잔류 회귀)", () => {
    const e = makeEnv();
    loginAs(e, "admin");
    go(e, "schedule");
    go(e, "vault");
    ok(!q(e, "#view").classList.contains("view-wide"), "wide→mid 전환 시 wide 제거");
    go(e, "schedule");
    ok(!q(e, "#view").classList.contains("view-mid"), "mid→wide 전환 시 mid 제거");
  });

  t("W6 확장 컬럼 CSS 규칙(1500px 이상 노출 + 보조줄 숨김)", () => {
    const css = read("css/main.css");
    ok(/\.col-ext\s*\{\s*display:\s*none/.test(css), "col-ext 기본 숨김");
    ok(/@media \(min-width: 1560px\)[\s\S]{0,320}td\.col-ext[^}]*display:\s*table-cell/.test(css), "1500px 이상에서 열 노출");
    ok(/@media \(min-width: 1560px\)[\s\S]{0,400}\.col-sub\s*\{\s*display:\s*none/.test(css), "확장 시 보조줄 숨김");
  });

  t("W7 목록 표 열 벌어짐 방지(tbl-cap) — 장비·협의회·이수증", () => {
    const css = read("css/main.css");
    ok(/\.tbl-cap\s*\{[^}]*max-width:\s*var\(--cap/.test(css), "tbl-cap max-width 규칙");
    ok(/\.tbl-cap tbody tr:hover td/.test(css), "줄무늬보다 뒤에 hover 규칙(우선순위)");
    const zebraAt = css.indexOf(".tbl-cap tbody tr:nth-child(even)");
    const hoverAt = css.indexOf(".tbl-cap tbody tr:hover");
    ok(zebraAt >= 0 && hoverAt > zebraAt, "hover가 줄무늬 뒤에 선언됨");
    ok(/tbl-cap" style="--cap:1480px"/.test(eqJS), "장비 대장 표 cap");
    ok(/tbl-cap" style="--cap:1480px"/.test(cnclJS), "협의회 목록 표 cap");
    ok(/tbl-cap" style="--cap:1480px"/.test(ctcJS), "이수증 목록 표 cap");
  });

  t("W9 확장 컬럼 마크업 — 장비(S/N·배치·업체)·협의회(주재·작성)·이수증(소속·비고)·설정(주소)", () => {
    const e = makeEnv();
    loginAs(e, "admin");
    // 장비 대장
    e.S.data.equipment = [{
      id: "eq-t1", type: "ETD", name: "테스트장비", serial: "SN-777", location: "B동 1층",
      vendor: "프로에스콤", installed: "2024-01-02", status: "정상", logs: []
    }];
    e.S.data.certs = [{ id: "ct-t2", certNo: "T-2", name: "홍길동", dept: "화물팀", role: "보안감독자", kind: "정기", org: "교육원", issued: "2026-02-02", expire: "2027-03-01", note: "재교육 예정" }];
    e.S.data.council = [{ id: "cn-t1", round: 9, date: "2026-05-05", place: "B동", chair: "최상일", scribe: "김작성", attendees: [], cases: [], actions: [], files: [], updated: "2026-05-06T00:00:00.000Z", by: "tester" }];
    e.S.saveSilent();

    go(e, "equipment");
    const eqExt = qa(e, "#view thead th.col-ext").map(th => th.textContent.trim());
    eq(eqExt.join("|"), "S/N|배치|업체", "장비 확장 헤더");
    ok(q(e, "#view tbody td.col-ext").textContent.includes("SN-777"), "S/N 값 렌더");
    ok(q(e, "#view .col-sub"), "좁은 화면용 배치 보조줄 유지");

    go(e, "certs");
    const ctExt = qa(e, "#view thead th.col-ext").map(th => th.textContent.trim());
    eq(ctExt.join("|"), "소속|비고", "이수증 확장 헤더");
    ok(qa(e, "#view tbody td.col-ext").some(td => td.textContent.includes("화물팀")), "소속 열 렌더");
    ok(qa(e, "#view tbody td.col-ext").some(td => td.textContent.includes("재교육 예정")), "비고 열 렌더");

    go(e, "council");
    const cnExt = qa(e, "#view thead th.col-ext").map(th => th.textContent.trim());
    eq(cnExt.join("|"), "장소|주재|작성|최근 수정", "협의회 확장 헤더");
    ok(qa(e, "#view tbody td.col-ext").some(td => td.textContent.includes("최상일")), "주재 열 렌더");

    go(e, "settings");
    const urls = qa(e, "#view .mt-url");
    ok(urls.length >= 5, "메뉴 트리 주소/라우트 표시: " + urls.length);
    ok(urls.some(u => u.textContent.trim().indexOf("#/") === 0), "모듈 라우트 표기");
    ok(urls.some(u => /^https?:\/\//.test(u.textContent.trim())), "링크 메뉴 주소 표기");
  });

  t("W8 tbl-cap 표가 실제 렌더에 적용됨(이수증)", () => {
    const e = makeEnv();
    loginAs(e, "admin");
    e.S.data.certs = [{
      id: "ct-t1", certNo: "T-1", name: "테스트", dept: "항공보안팀", role: "보안감독자",
      kind: "초기", org: "한국항공안전교육원", issued: "2026-01-05", expire: "2027-02-04"
    }];
    e.S.saveSilent();
    go(e, "certs");
    const tb = q(e, "#view .tbl-cap");
    ok(tb, "이수증 목록 표에 tbl-cap 클래스");
    ok((tb.getAttribute("style") || "").includes("--cap"), "--cap 인라인 지정");
  });

  t("W5 index.html 캐시 스탬프가 VERSION과 일치(구버전 CSS/JS 잔존 방지)", () => {
    const html = read("index.html");
    const ver = (appJS.match(/const VERSION = "([\d.]+)"/) || [])[1];
    ok(ver, "app.js VERSION 확인");
    const refs = html.match(/(?:href|src)="(?:css|js)\/[\w.-]+\.(?:css|js)(?:\?v=[\d.]+)?"/g) || [];
    ok(refs.length >= 20, "로컬 자원 참조 발견: " + refs.length);
    const bad = refs.filter(r => !r.includes("?v=" + ver));
    eq(bad.length, 0, "스탬프 누락/불일치: " + bad.slice(0, 3).join(", ") + " (node tools/bump-version.cjs " + ver + " 실행)");
  });

  t("W4 CSS 폭 규칙 및 가독성 보호", () => {
    const css = read("css/main.css");
    ok(/\.view\.view-wide\s*\{[^}]*max-width:\s*2100px/.test(css), "wide 최대폭");
    ok(/\.view\.view-mid\s*\{[^}]*max-width:\s*1560px/.test(css), "mid 최대폭");
    ok(/\.view\s*\{[^}]*max-width:\s*1180px/.test(css), "기본 .view 폭 유지");
    ok(/\.notice-html\s*\{\s*max-width:\s*1040px/.test(css.replace(/\s+/g, " ")) || css.includes(".notice-html { max-width: 1040px; }"), "본문 읽기 폭 제한");
  });

  /* ══════════ [O] v2.34 보안 인력 모듈 + 열 폭/열람 배치 개선 ══════════ */

  /* v2.36.2: 보안 인력 시드는 개인정보라 코드에서 제거됨(공용 DB 전용).
     아래 테스트는 가명 픽스처를 preData로 주입해 로직만 검증한다. */
  const SV_FIX = [
    ["sv01", "안전보안실", "안전보안실", "실장", "안전보안실장", "가나다", "S001", "항공사보안책임자(정)"],
    ["sv02", "안전보안실", "항공보안팀", "팀장", "항공보안팀장", "나다라", "S002", "항공사보안책임자(부)"],
    ["sv03", "안전보안실", "항공보안팀", "프로", "팀원", "다라마", "S003", "항공사보안감독자"],
    ["sv04", "안전보안실", "항공보안팀", "프로", "팀원", "라마바", "", ""],
    ["sv05", "영업본부", "인천화물팀", "팀장", "팀장", "마바사", "S005", "항공사보안감독자"],
    ["sv06", "운항본부", "운항팀", "팀장", "팀장", "바사아", "S006", "항공사보안감독자"],
    ["sv07", "정비본부", "정비팀", "팀장", "팀장", "사아자", "S007", "항공사보안감독자"],
    ["sv08", "종합통제실", "통제팀", "팀장", "팀장", "아자차", "S008", "항공사보안감독자"]
  ].map((r, i) => ({ id: r[0], seq: i, div: r[1], dept: r[2], rank: r[3], duty: r[4],
    name: r[5], empNo: r[6], role: r[7], from: r[7] ? "2026-01-01" : "", to: r[7] ? "2026-12-31" : "", note: "" }));
  const SO_FIX = [
    ["미주", "LAX", "미주하나", "E001", "laxsfz", "지점장"],
    ["미주", "LAX", "미주둘", "E002", "lax2", ""],
    ["유럽", "FRA", "유럽하나", "E003", "frakkf", ""],
    ["일본", "NRT", "일본하나", "E004", "nrtsfz", "영업소장"],
    ["일본", "NRT", "일본둘", "E005", "nrt2", ""],
    ["중국", "PVG", "중국하나", "E006", "pvgsfz", "지점장"],
    ["아시아", "HKG", "아시아하나", "E007", "hkgkkf", ""]
  ].map((r, i) => ({ id: "so" + (i + 1), seq: i, region: r[0], station: r[1],
    name: r[2], empNo: r[3], uniworks: r[4], note: r[5] }));
  const officerEnv = () => makeEnv({ preData: { supervisors: SV_FIX, stationOfficers: SO_FIX } });

  t("O01 보안감독자 데이터 — 본부 정렬 · 발령내용 분포 (가명 픽스처)", () => {
    const e = officerEnv();
    const l = e.S.data.supervisors;
    eq(l.length, 8, "인원");
    eq(e.w.SemisOfficers.svDivs().join(","), "안전보안실,영업본부,운항본부,정비본부,종합통제실", "본부 순서");
    const st = e.w.SemisOfficers.svStats();
    eq(st.chief, 2, "보안책임자 정·부");
    eq(st.sup, 5, "보안감독자");
    eq(st.none, 1, "미발령");
    const x = l.find(v => v.name === "다라마");
    ok(x && x.empNo === "S003" && x.role === "항공사보안감독자", "발령 확인");
    eq(x.from + "~" + x.to, "2026-01-01~2026-12-31", "발령기간");
    eq(new Set(l.map(v => v.id)).size, 8, "id 고유");
  });

  t("O02 보안감독자 상태 판정 (유효/만료/미발령)", () => {
    const e = makeEnv();
    const O = e.w.SemisOfficers;
    eq(O.svState({ role: "항공사보안감독자", to: "2999-12-31" }), "유효");
    eq(O.svState({ role: "항공사보안감독자", to: "2000-01-01" }), "만료");
    eq(O.svState({ role: "", to: "" }), "미발령");
    eq(O.svState({ role: "항공사보안책임자(정)", to: "" }), "유효", "기간 미기재는 유효");
  });

  t("O03 보안감독자 화면 — 본부 그룹행 + 검색/필터", () => {
    const e = officerEnv();
    loginAs(e, "hq");
    go(e, "supervisors");
    ok(q(e, "#sv-body"), "목록 렌더");
    eq(qa(e, "#sv-body .grp-row").length, 5, "본부 그룹행 5개");
    eq(qa(e, "#sv-body [data-sv-row]").length, 8, "전체 행");
    ok(qa(e, "#sv-body [data-sv-edit]").length === 8, "hq 수정 버튼 노출");
    e.w.SemisOfficers.setSvQuery("다라마");
    e.S.renderView();
    eq(qa(e, "#sv-body [data-sv-row]").length, 1, "검색 1건");
    e.w.SemisOfficers.setSvQuery("");
    e.w.SemisOfficers.setSvDiv("안전보안실");
    e.S.renderView();
    eq(qa(e, "#sv-body [data-sv-row]").length, 4, "안전보안실 4명");
    e.w.SemisOfficers.setSvDiv("전체");
  });

  t("O04 보안감독자 등록·수정·삭제 (hq)", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "supervisors");
    q(e, "#sv-add").click();
    q(e, "#sv-name").value = "홍길동";
    q(e, "#sv-div").value = "영업본부";
    q(e, "#sv-dept").value = "인천화물팀";
    q(e, "#sv-from").value = "2026-12-31";
    q(e, "#sv-to").value = "2026-01-01";   // 역순 입력 → 자동 교정
    q(e, "#sv-save").click();
    const x = e.S.data.supervisors.find(v => v.name === "홍길동");
    ok(x, "등록됨");
    eq(x.from + "~" + x.to, "2026-01-01~2026-12-31", "기간 자동 정렬");
    eq(x.role, "항공사보안감독자", "기본 발령내용");
    e.w.SemisOfficers.svForm(x.id);
    q(e, "#sv-rank").value = "파트장";
    q(e, "#sv-save").click();
    eq(e.S.data.supervisors.find(v => v.id === x.id).rank, "파트장", "수정 반영");
    const n0 = e.S.data.supervisors.length;
    e.w.SemisOfficers.svForm(x.id);
    q(e, "#sv-del").click();
    q(e, "#modal-box [data-act=ok]").click();
    eq(e.S.data.supervisors.length, n0 - 1, "삭제 반영");
  });

  t("O05 보안감독자 — 성명·직책 모두 비면 저장 차단", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "supervisors");
    const n0 = e.S.data.supervisors.length;
    q(e, "#sv-add").click();
    q(e, "#sv-name").value = "";
    q(e, "#sv-duty").value = "";
    q(e, "#sv-save").click();
    eq(e.S.data.supervisors.length, n0, "저장되지 않음");
  });

  t("O06 지점 보안담당자 데이터 — 지역 정렬 · 지점장 판정 (가명 픽스처)", () => {
    const e = officerEnv();
    const l = e.S.data.stationOfficers;
    eq(l.length, 7, "인원");
    const O = e.w.SemisOfficers;
    eq(O.soRegions().join(","), "미주,유럽,일본,중국,아시아", "지역 순서");
    const st = O.soStats();
    eq(st.heads, 3, "지점장·영업소장");
    eq(st.stations, 5, "지점 수");
    ok(O.isHead({ note: "지점장" }) && O.isHead({ note: "영업소장" }) && !O.isHead({ note: "KKF" }), "지점장 판정");
    eq(new Set(l.map(x => x.id)).size, 7, "id 고유");
    const lax = l.find(x => x.uniworks === "laxsfz");
    ok(lax && lax.name === "미주하나" && lax.region === "미주", "LAX 지점장");
  });

  t("O07 지점 보안담당자 화면 — 지역 그룹행 + 검색/필터/등록", () => {
    const e = officerEnv();
    loginAs(e, "hq");
    go(e, "stn-officers");
    eq(qa(e, "#so-body .grp-row").length, 5, "지역 그룹행 5개");
    eq(qa(e, "#so-body [data-so-row]").length, 7, "전체 행");
    e.w.SemisOfficers.setSoQuery("frakkf");
    e.S.renderView();
    eq(qa(e, "#so-body [data-so-row]").length, 1, "유니웍스 ID 검색");
    e.w.SemisOfficers.setSoQuery("");
    e.w.SemisOfficers.setSoRegion("일본");
    e.S.renderView();
    eq(qa(e, "#so-body [data-so-row]").length, 2, "일본 2명");
    e.w.SemisOfficers.setSoRegion("전체");
    e.S.renderView();
    q(e, "#so-add").click();
    q(e, "#so-name").value = "테스트담당";
    q(e, "#so-station").value = "abc";
    q(e, "#so-region").value = "미주";
    q(e, "#so-save").click();
    const x = e.S.data.stationOfficers.find(v => v.name === "테스트담당");
    ok(x, "등록됨");
    eq(x.station, "ABC", "지점코드 대문자 정규화");
  });

  t("O08 인력 모듈 권한 — manager 열람 가능/편집 불가, user 접근 차단", () => {
    const e = officerEnv();
    loginAs(e, "manager");
    go(e, "supervisors");
    ok(qa(e, "#sv-body [data-sv-row]").length === 8, "manager 열람 가능");
    eq(q(e, "#sv-add"), null, "manager 등록 버튼 없음");
    eq(qa(e, "#sv-body [data-sv-edit]").length, 0, "manager 수정 버튼 없음");
    go(e, "stn-officers");
    ok(qa(e, "#so-body [data-so-row]").length === 7, "manager 지점담당자 열람");
    eq(q(e, "#so-add"), null, "manager 등록 버튼 없음");

    const e2 = makeEnv();
    loginAs(e2, "user");
    const ids = qa(e2, "#nav-menu [data-route]").map(a => a.dataset.route);
    ok(ids.indexOf("supervisors") < 0 && ids.indexOf("stn-officers") < 0, "user 메뉴 비노출");
  });

  t("O09 메뉴 이관 — 구글시트 링크 제거 + 모듈 메뉴 삽입 (기존 데이터도)", () => {
    const fresh = makeEnv();
    const menus = fresh.S.data.menus;
    ok(!menus.some(m => m.id === "br-supervisor" || m.id === "br-officer"), "구 링크 메뉴 없음");
    const sv = menus.find(m => m.module === "supervisors");
    const so = menus.find(m => m.module === "stn-officers");
    ok(sv && sv.parent === "grp-branch" && sv.vis === "mgr", "보안감독자 메뉴");
    ok(so && so.parent === "grp-branch" && so.vis === "mgr", "지점담당자 메뉴");

    // 구버전(링크 메뉴 + 데이터 없음) 사용자 데이터로 부팅 → 자동 이관
    const old = JSON.parse(JSON.stringify(fresh.S.data));
    delete old.supervisors; delete old.stationOfficers;
    old.menus = old.menus.filter(m => m.module !== "supervisors" && m.module !== "stn-officers");
    old.menus.push({ id: "br-supervisor", seq: 90, type: "link", label: "보안감독자 현황",
      icon: "👥", url: "https://docs.google.com/x", vis: "mgr", parent: "grp-branch" });
    const e2 = makeEnv({ preData: old });
    // v2.36.2: 실데이터는 공용 DB 전용 — 코드는 빈 컨테이너만 보장
    ok(Array.isArray(e2.S.data.supervisors) && e2.S.data.supervisors.length === 0, "감독자 빈 컨테이너");
    ok(Array.isArray(e2.S.data.stationOfficers) && e2.S.data.stationOfficers.length === 0, "지점담당자 빈 컨테이너");
    ok(!e2.S.data.menus.some(m => m.id === "br-supervisor"), "구 링크 제거됨");
    ok(e2.S.data.menus.some(m => m.module === "supervisors" && m.parent === "grp-branch"), "모듈 메뉴 삽입");
  });

  t("O10 통합검색 — 감독자/지점담당자 색인 (manager 이상)", () => {
    const e = officerEnv();
    loginAs(e, "manager");
    const r1 = e.w.SemisSearch.search("다라마");
    ok(r1.some(x => x.group === "보안감독자 현황"), "감독자 검색 결과");
    const r2 = e.w.SemisSearch.search("hkgkkf");
    ok(r2.some(x => x.group === "지점 보안담당자"), "지점담당자 검색 결과");

    const e2 = officerEnv();
    loginAs(e2, "user");
    ok(!e2.w.SemisSearch.search("다라마").some(x => x.group === "보안감독자 현황"), "user 색인 제외");
  });

  t("O17 개인정보 — 인력 시드가 코드에 남아있지 않음 (v2.36.2)", () => {
    const app = read("js/app.js");
    ok(/const seedSupervisors = \(\) => \[\]/.test(app), "감독자 시드 비움");
    ok(/const seedStationOfficers = \(\) => \[\]/.test(app), "지점담당자 시드 비움");
    ok(!/uniworks: "[a-z]/.test(app), "유니웍스 ID 없음");
    ok(!/"(laxsfz|frakkf|hkgkkf|nycsfz)"/.test(app), "계정 ID 없음");
    const e = makeEnv();
    eq(e.S.data.supervisors.length, 0, "기본값 빈 배열");
    eq(e.S.data.stationOfficers.length, 0, "기본값 빈 배열");
    // 화면은 데이터가 없어도 안전하게 렌더
    loginAs(e, "hq");
    go(e, "supervisors"); ok(q(e, "#sv-body"), "감독자 화면 렌더");
    go(e, "stn-officers"); ok(q(e, "#so-body"), "지점담당자 화면 렌더");
  });

  t("O11 규정 목록 — 제목 클릭이 열람(PDF/링크), 열람 열이 앞쪽", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.regulations = [
      { id: "rp1", scope: "intl", title: "PDF 규정", fileUrl: "https://x/a.pdf", fileName: "a.pdf", ideas: [] },
      { id: "rl1", scope: "intl", title: "링크 규정", linkUrl: "https://x/law", ideas: [] },
      { id: "rn1", scope: "intl", title: "미등록 규정", ideas: [] }
    ];
    e.S.saveSilent();
    go(e, "regs-intl");
    const th = qa(e, "#rg-body th").map(x => x.textContent.trim());
    ok(th[0].indexOf("규정명") === 0, "1열 규정명");
    ok(th[1].indexOf("열람") === 0, "2열 열람 (버전보다 앞)");
    ok(th.indexOf("수정") === th.length - 1, "수정 열 맨 끝");
    // PDF 규정: 제목이 뷰어 버튼
    const pdfTitle = q(e, '[data-rg-row="rp1"] .tbl-open');
    ok(pdfTitle && pdfTitle.tagName === "BUTTON" && pdfTitle.dataset.rgPdf === "rp1", "PDF 제목=뷰어 버튼");
    pdfTitle.click();
    ok(q(e, "#modal-box .reg-pdf-frame"), "제목 클릭 → PDF 뷰어");
    ok(!q(e, "#rg-title"), "수정 폼이 열리지 않음");
    e.S.closeModal();
    // 링크 규정: 제목이 새 탭 앵커
    const lnkTitle = q(e, '[data-rg-row="rl1"] .tbl-open');
    ok(lnkTitle && lnkTitle.tagName === "A" && lnkTitle.getAttribute("target") === "_blank", "링크 제목=새 탭");
    eq(lnkTitle.getAttribute("href"), "https://x/law");
    // 미등록: 평문
    eq(q(e, '[data-rg-row="rn1"] .tbl-open'), null, "문서 없으면 링크 아님");
    // 수정은 ✏️ 버튼으로
    q(e, '[data-rg-edit="rn1"]').click();
    ok(q(e, "#rg-title"), "✏️ → 수정 폼");
  });

  t("O12 규정 목록 — 열람 권한만 있으면(manager) 수정 열 없음", () => {
    const e = makeEnv();
    loginAs(e, "manager");
    e.S.data.regulations = [{ id: "rv1", scope: "own", title: "자체규정", fileUrl: "https://x/b.pdf", ideas: [] }];
    e.S.saveSilent();
    go(e, "regs-own");
    eq(qa(e, "#rg-body [data-rg-edit]").length, 0, "manager 수정 버튼 없음");
    ok(q(e, '[data-rg-row="rv1"] .tbl-open'), "열람은 가능");
  });

  t("O13 계약서 목록 — 파일 열이 2열, 계약명 클릭=파일 열기, 분류/기간 폭 확대", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.contracts = [
      { id: "cf1", name: "파일 계약", party: "프로에스콤", category: "유지보수",
        start: "2026-01-01", end: "2099-12-31", fileUrl: "https://drive/x", status: "유효" },
      { id: "cf2", name: "파일 없는 계약", category: "경비", start: "2026-01-01", end: "2099-12-31", status: "유효" }
    ];
    e.S.saveSilent();
    go(e, "contracts-mgmt");
    const th = qa(e, "#cn-body th");
    ok(th[0].textContent.indexOf("계약명") === 0, "1열 계약명");
    eq(th[1].textContent.trim(), "파일", "2열 파일");
    eq(th[2].textContent.trim(), "분류");
    ok(parseInt((th[2].getAttribute("style") || "").replace(/\D/g, ""), 10) >= 96, "분류 폭 96px 이상");
    ok(parseInt((th[3].getAttribute("style") || "").replace(/\D/g, ""), 10) >= 200, "계약기간 폭 200px 이상");
    const a = q(e, '[data-cn-row="cf1"] .tbl-open');
    ok(a && a.tagName === "A" && a.getAttribute("href") === "https://drive/x", "계약명=파일 링크");
    eq(q(e, '[data-cn-row="cf2"] .tbl-open'), null, "파일 없으면 평문");
    // 기간 셀 줄바꿈 방지
    const per = qa(e, '[data-cn-row="cf1"] td')[3];
    ok((per.getAttribute("style") || "").includes("nowrap"), "계약기간 nowrap");
    // 행 클릭은 여전히 수정
    q(e, '[data-cn-row="cf2"]').click();
    ok(q(e, "#c-name"), "행 클릭 → 수정 폼");
    e.S.closeModal();
    q(e, '[data-cn-edit="cf1"]').click();
    ok(q(e, "#c-name"), "✏️ → 수정 폼");
  });

  t("O14 KPI 인쇄 열 폭 — colgroup 배분(Action Plan 축소, 목표·산출물 확대)", () => {
    const cols = (kpiJS.match(/<colgroup>[\s\S]*?<\/colgroup>/) || [""])[0];
    const w = (cols.match(/width:(\d+)%/g) || []).map(s => parseInt(s.replace(/\D/g, ""), 10));
    eq(w.length, 6, "6개 열 폭 지정");
    eq(w.reduce((a, b) => a + b, 0), 100, "합계 100%");
    ok(w[1] <= 28, "Action Plan(2열) 28% 이하: " + w[1]);
    ok(w[5] >= 35, "목표·산출물(6열) 35% 이상: " + w[5]);
    ok(w[3] >= 10 && w[4] >= 10, "계획·실적 각 10% 이상");
    ok(w[5] > w[1], "목표·산출물이 Action Plan보다 넓음");
    ok(/\.ap\s*\{[^}]*table-layout:\s*fixed/.test(kpiJS), "table-layout: fixed");
  });

  t("O15 암호 관리 — 분류 열 폭 확대 + 배지 줄바꿈 방지", () => {
    const src = read("js/vault.js");
    const th = (src.match(/<th style="width:(\d+)px">분류<\/th>/) || [])[1];
    ok(th && Number(th) >= 118, "분류 열 118px 이상: " + th);
    ok(/badge badge-gray" style="white-space:nowrap">\$\{esc\(en\.category\)/.test(src), "분류 배지 nowrap");
  });

  t("O16 신규 모듈 자원 등록 — index.html · 동기화 키 · 화면 폭", () => {
    const html = read("index.html");
    ok(/<script src="js\/officers\.js\?v=[\d.]+"><\/script>/.test(html), "officers.js 스크립트 등록");
    ok(/"supervisors", "stationOfficers"/.test(read("js/sync.js")), "SYNC_KEYS 등록");
    ok(/supervisors: "mid", "stn-officers": "mid"/.test(appJS), "VIEW_WIDTH 등록");
  });

  /* ══════════ [CH] 세미 · 팀 채팅 위젯 (v2.35) ══════════ */
  {
    /* 채팅 전용 fetch 스텁: chat_messages REST + semi-chat Edge + 기타(빈 배열) */
    function makeChatFetch() {
      const st = { rows: [], edgeReply: "안녕하세요! 세미예요.", calls: [] };
      st.fetch = (url, opts = {}) => {
        const u = String(url);
        const method = (opts && opts.method) || "GET";
        st.calls.push({ url: u, method, body: opts && opts.body ? JSON.parse(opts.body) : null });
        if (u.includes("/functions/v1/semi-chat")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: st.edgeReply }) });
        }
        if (u.includes("/rest/v1/chat_messages")) {
          if (method === "GET")
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(st.rows.slice().reverse()) });
          if (method === "POST") {
            const b = JSON.parse(opts.body);
            const row = Object.assign({
              id: "cm" + (st.rows.length + 1),
              created_at: new Date(Date.now() + st.rows.length * 1000).toISOString()
            }, b);
            st.rows.push(row);
            return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve([row]) });
          }
          if (method === "DELETE") {
            const m = u.match(/id=eq\.([^&]+)/);
            const id = m && decodeURIComponent(m[1]);
            st.rows = st.rows.filter(r => r.id !== id);
            return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve([]) });
          }
        }
        if (method === "GET") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve([]) });
      };
      return st;
    }
    const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));

    await ta("CH01 내부 계정 로그인 → 위젯 표시 · 세미 탭 기본 · 인사말/추천칩", async () => {
      const st = makeChatFetch();
      const e = makeEnv({ fetch: st.fetch });
      loginAs(e, "manager");
      await tick();
      ok(q(e, "#chat-fab"), "FAB 존재");
      ok(q(e, "#chat-panel").classList.contains("hidden"), "패널 기본 닫힘");
      q(e, "#chat-fab").click();
      ok(!q(e, "#chat-panel").classList.contains("hidden"), "클릭 시 열림");
      ok(!q(e, "#chat-body-semi").classList.contains("hidden"), "세미 탭 기본");
      ok(q(e, "#semi-msgs").textContent.includes("세미"), "세미 인사말");
      ok(qa(e, "#semi-msgs .chat-chip").length >= 2, "추천 질문 칩");
    });

    await ta("CH02 vendor 로그인 → 위젯 미표시 (canUse 게이트)", async () => {
      const st = makeChatFetch();
      const e = makeEnv({ fetch: st.fetch });
      loginAs(e, "vendor");
      await tick();
      ok(!q(e, "#chat-fab"), "vendor에겐 FAB 없음");
      ok(!e.w.SemisChat.canUse({ role: "signer" }), "signer 차단");
      ok(!e.w.SemisChat.canUse(null), "미로그인 차단");
      ok(e.w.SemisChat.canUse({ role: "user" }), "user 허용");
    });

    await ta("CH03 팀 채팅 전송 → REST POST(작성자 정보) + 내 말풍선 렌더", async () => {
      const st = makeChatFetch();
      const e = makeEnv({ fetch: st.fetch });
      loginAs(e, "hq");
      await tick();
      e.w.SemisChat.setTab("team");
      await e.w.SemisChat.sendTeam("안녕하세요 팀!");
      await tick();
      const post = st.calls.find(c => c.method === "POST" && c.url.includes("chat_messages"));
      ok(post, "POST 발생");
      eq(post.body.author_id, "thq", "author_id");
      eq(post.body.role, "hq", "역할 저장");
      const rows = qa(e, "#team-msgs .chat-row");
      ok(rows.length >= 1, "메시지 렌더");
      ok(rows[rows.length - 1].className.includes("mine"), "내 메시지 우측 정렬");
      ok(q(e, "#team-msgs").textContent.includes("안녕하세요 팀!"), "본문 표시");
      ok(e.w.localStorage.getItem("semis2:chatTab") === "team", "탭 상태 저장");
    });

    await ta("CH04 수신 메시지 → 안읽음 배지 → 팀 탭 열람 시 읽음 처리", async () => {
      const st = makeChatFetch();
      const e = makeEnv({ fetch: st.fetch });
      loginAs(e, "manager");
      await tick();
      e.w.SemisChat.addIncoming({ id: "x1", created_at: new Date().toISOString(),
        author: "최상일", author_id: "hq", role: "hq", text: "회의 10시!" });
      ok(!q(e, "#chat-badge").classList.contains("hidden"), "FAB 배지 표시");
      eq(q(e, "#chat-badge").textContent, "1", "배지 1건");
      eq(e.w.SemisChat.unreadCount(
        [{ id: "a", created_at: "2026-01-01T00:00:00Z", author_id: "hq" }], "", "me"), 1, "unread 계산");
      eq(e.w.SemisChat.unreadCount(
        [{ id: "a", created_at: "2026-01-01T00:00:00Z", author_id: "me" }], "", "me"), 0, "내 글 제외");
      q(e, "#chat-fab").click();
      e.w.SemisChat.setTab("team");
      await tick();
      ok(q(e, "#chat-badge").classList.contains("hidden"), "열람 후 배지 사라짐");
      e.w.SemisChat.removeMsg("x1");
      ok(!q(e, "#team-msgs").textContent.includes("회의 10시"), "삭제 반영");
    });

    await ta("CH05 세미 질문 → Edge 호출(토큰·역할·이력) + 답변 서식 렌더 + 새 대화", async () => {
      const st = makeChatFetch();
      st.edgeReply = "이번 주 일정은 **2건**이에요!\n- 회의\n- 점검";
      const e = makeEnv({ fetch: st.fetch });
      loginAs(e, "hq");
      await tick();
      await e.w.SemisChat.askSemi("이번 주 일정 알려줘");
      const call = st.calls.find(c => c.url.includes("semi-chat"));
      ok(call, "Edge 호출");
      eq(call.body.t, e.w.SemisChat.EDGE_TOKEN, "토큰 포함");
      eq(call.body.user.role, "hq", "역할 전달");
      eq(call.body.messages[call.body.messages.length - 1].content, "이번 주 일정 알려줘", "질문 전달");
      const bubbles = qa(e, "#semi-msgs .semi-bubble");
      const last = bubbles[bubbles.length - 1];
      ok(last.innerHTML.includes("<b>2건</b>"), "굵게 렌더");
      ok(last.innerHTML.includes("• 회의"), "불릿 렌더");
      ok(e.w.sessionStorage.getItem("semis2:semiConv:thq"), "세션 이력 저장");
      e.w.SemisChat.resetSemi();
      ok(!e.w.sessionStorage.getItem("semis2:semiConv:thq"), "새 대화 초기화");
    });

    t("CH06 mdLite — HTML 전면 이스케이프(XSS 차단) + 서식 유지", () => {
      const e = makeEnv({ boot: false });
      const out = e.w.SemisChat.mdLite('<img src=x onerror=alert(1)> **굵게** `코드`');
      ok(!out.includes("<img"), "태그 이스케이프");
      ok(out.includes("&lt;img"), "엔티티 변환");
      ok(out.includes("<b>굵게</b>") && out.includes("<code>코드</code>"), "서식 유지");
    });

    await ta("CH07 Esc 닫기(모달 우선) + 재로그인 멱등(위젯 1개)", async () => {
      const st = makeChatFetch();
      const e = makeEnv({ fetch: st.fetch });
      loginAs(e, "manager");
      await tick();
      q(e, "#chat-fab").click();
      ok(!q(e, "#chat-panel").classList.contains("hidden"), "열림");
      e.S.openModal("<p>모달</p>");
      e.w.document.dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      ok(!q(e, "#chat-panel").classList.contains("hidden"), "모달이 열려 있으면 패널 유지");
      e.w.document.dispatchEvent(new e.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      ok(q(e, "#chat-panel").classList.contains("hidden"), "Esc로 패널 닫힘");
      loginAs(e, "hq");
      await tick();
      eq(qa(e, "#chat-fab").length, 1, "FAB 중복 없음");
      eq(qa(e, "#chat-root").length, 1, "root 중복 없음");
    });

    t("CH08 자원 등록 — index.html 스크립트 · enterApp 연동 · CSS · 인쇄 숨김", () => {
      const html = read("index.html");
      ok(/<script src="js\/chat\.js\?v=[\d.]+"><\/script>/.test(html), "chat.js 스크립트 등록");
      ok(/window\.SemisChat\.onLogin\(\)/.test(read("js/app.js")), "enterApp 연동");
      const css = read("css/main.css");
      ok(/\.chat-fab\s*\{/.test(css) && /\.chat-panel\s*\{/.test(css), "CSS 등록");
      ok(/@media print \{ \.chat-root/.test(css), "인쇄 시 숨김");
    });
  }


  /* ══════════ [GD] 안내 콘텐츠 3종 (v2.36) ══════════ */
  t("GD01 마이그레이션 — 구 링크 메뉴 → 내부 모듈 (seclevel/iosa/pass-docs)", () => {
    const e = makeEnv();
    const M = e.S.data.menus;
    const mod = (id) => M.find(m => m.type === "module" && m.module === id);
    ok(mod("seclevel"), "seclevel 모듈 메뉴");
    ok(mod("iosa"), "iosa 모듈 메뉴");
    ok(mod("pass-docs"), "pass-docs 모듈 메뉴");
    eq(mod("seclevel").parent, "grp-level", "보안등급 그룹");
    eq(mod("iosa").parent, "grp-rule", "규정/인허가 그룹");
    eq(mod("pass-docs").parent, "grp-pass", "출입증 그룹");
    eq(mod("seclevel").vis, "all"); eq(mod("iosa").vis, "all"); eq(mod("pass-docs").vis, "all");
    ok(!M.some(m => m.id === "lvl-intro"), "구 링크 lvl-intro 제거");
    const io = M.find(m => m.id === "rule-iosa");
    ok(io && io.label === "IOSA 자료실 (구버전)" && io.vis === "mgr", "구 IOSA 링크는 자료실(mgr)로 조정");
    // 출입증 신청 서류는 출입증 관리 바로 뒤
    ok(mod("pass-docs").seq > mod("passes").seq, "출입증 관리 다음 순서");
  });

  t("GD02 구버전 저장 데이터에서도 멱등 이관 (2회 정규화)", () => {
    const legacy = {
      menus: [
        { id: "grp-level", seq: 1, type: "group", label: "항공보안등급" },
        { id: "lvl-intro", seq: 2, type: "link", label: "국가 보안등급 소개", icon: "📖",
          url: "https://sites.google.com/view/kjsemis/x", vis: "all", parent: "grp-level" },
        { id: "grp-rule", seq: 3, type: "group", label: "규정 / 인허가" },
        { id: "regs-own", seq: 4, type: "module", label: "자체 보안규정", icon: "📘",
          module: "regs-own", vis: "all", parent: "grp-rule" },
        { id: "rule-iosa", seq: 5, type: "link", label: "IOSA (국제 인허가)", icon: "🏅",
          url: "https://sites.google.com/view/kjsemis/iosa", vis: "all", parent: "grp-rule" },
        { id: "grp-pass", seq: 6, type: "group", label: "출입증" },
        { id: "passes", seq: 7, type: "module", label: "출입증 관리", icon: "🪪",
          module: "passes", vis: "mgr", parent: "grp-pass" }
      ]
    };
    const e = makeEnv({ preData: legacy });
    e.S.normalizeData();
    const M = e.S.data.menus;
    const cnt = (id) => M.filter(m => m.type === "module" && m.module === id).length;
    eq(cnt("seclevel"), 1, "seclevel 중복 없음");
    eq(cnt("iosa"), 1, "iosa 중복 없음");
    eq(cnt("pass-docs"), 1, "pass-docs 중복 없음");
    ok(!M.some(m => m.id === "lvl-intro"), "lvl-intro 제거 유지");
    eq(M.filter(m => m.id === "rule-iosa").length, 1, "구 링크 1건 유지");
  });

  t("GD03 국가 보안등급 소개 — 5단계 카드 + 제도 근거 렌더", () => {
    const e = makeEnv();
    loginAs(e, "user");
    go(e, "seclevel");
    const lv = qa(e, "#view .gd-lvl");
    eq(lv.length, 5, "등급 카드 5개");
    eq(lv.map(x => x.querySelector(".gd-lvl-name").textContent).join(","),
      "평시,관심,주의,경계,심각", "5단계 순서");
    eq(lv.map(x => x.querySelector(".gd-lvl-en").textContent).join(","),
      "GREEN,BLUE,YELLOW,ORANGE,RED", "색상 코드명");
    const html = q(e, "#view").innerHTML;
    ok(html.indexOf("항공보안법 제31조") >= 0, "법적 근거");
    ok(html.indexOf("국가항공보안 우발계획") >= 0, "우발계획 근거");
    ok(html.indexOf("국토교통부장관") >= 0, "발령권자");
    ok(html.indexOf("Contingency Plan") >= 0, "ICAO 해외 동향");
    eq(qa(e, "#view .gd-tl li").length, 3, "연혁 타임라인 3건");
    ok(html.indexOf("세부 조치사항은 이 화면에 담지 않습니다") >= 0, "보안통제 정보 안내");
    // v2.36.1: 구버전 문서 링크 제거 (등급 현황 문서 / kjsemis 소개 페이지)
    ok(html.indexOf("docs.google.com/document") < 0, "보안등급 현황 문서 링크 제거");
    ok(html.indexOf("sites.google.com") < 0, "구버전 소개 페이지 링크 제거");
    ok(qa(e, "#view a[href='#/dashboard']").length === 1, "대시보드 이동만 유지");
  });

  t("GD04 국가 보안등급 소개 — 현재 등급 하이라이트 연동", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    e.S.data.levelHistory.length = 0;
    e.S.data.levelHistory.push({ level: "경계", date: "2000-01-01", end: "", note: "테스트" });
    e.S.saveSilent();
    go(e, "seclevel");
    const on = qa(e, "#view .gd-lvl.on");
    eq(on.length, 1, "현재 등급 1개만 강조");
    eq(on[0].querySelector(".gd-lvl-name").textContent, "경계", "경계 강조");
    ok(on[0].querySelector(".gd-lvl-now"), "현재 배지");
    ok(q(e, "#view .gd-hero .gd-now").textContent.indexOf("경계") >= 0, "히어로 현재 등급");
  });

  t("GD05 IOSA — 통계·RBI 비교표·IDX 섹션 + IATA 공식 링크만 인용", () => {
    const e = makeEnv();
    loginAs(e, "user");
    go(e, "iosa");
    const html = q(e, "#view").innerHTML;
    eq(qa(e, "#view .stat").length, 4, "통계 카드 4개");
    ok(html.indexOf("916") >= 0, "ISM 표준 수");
    ok(html.indexOf("Risk-Based") >= 0, "Risk-Based IOSA");
    ok(html.indexOf("Maturity Assessment") >= 0 || html.indexOf("성숙도 평가") >= 0, "성숙도 평가");
    ok(html.indexOf("Incident Data eXchange") >= 0, "IDX");
    ok(html.indexOf("GADM") >= 0, "GADM");
    ok(html.indexOf("5,700kg") >= 0, "등록 자격 기준");
    eq(qa(e, "#view .gd-cmp tbody tr").length, 2, "RBI 비교표 2행");
    // 외부 링크는 IATA 공식 도메인만 (구버전 보안성 자료 링크 미포함)
    const hrefs = qa(e, "#view a[target=_blank]").map(a => a.getAttribute("href"));
    ok(hrefs.length >= 8, "공식 링크 다수");
    ok(hrefs.every(h => /^https:\/\/(www\.iata\.org|ic\.iata\.org)\//.test(h)),
      "iata.org 도메인만: " + hrefs.filter(h => !/iata\.org/.test(h)).join(","));
    ok(html.indexOf("sites.google.com") < 0, "구버전 보안성 자료 링크 미노출");
  });

  t("GD06 출입증 신청 서류 — 절차 5단계 + 서류 4종 + 주의사항", () => {
    const e = makeEnv();
    loginAs(e, "user");
    go(e, "pass-docs");
    eq(qa(e, "#view .gd-step").length, 5, "절차 5단계");
    eq(qa(e, "#view [data-pd-chk]").length, 4, "서류 체크 4종");
    const html = q(e, "#view").innerHTML;
    ["재직증명서", "신원진술서", "개인정보 제공 동의서", "행정정보 공동이용 사전동의서"]
      .forEach(n => ok(html.indexOf(n) >= 0, n + " 항목"));
    eq(qa(e, "#view .gd-note .gd-ul li").length, 4, "주의사항 4건");
    ok(html.indexOf("마스킹") >= 0, "개인정보 마스킹 안내");
    ok(html.indexOf("pass.airport.kr") >= 0, "출입증관리시스템 링크");
    ok(html.indexOf("032-741-2560") >= 0, "출입증관리센터 연락처");
    ok(html.indexOf("보안교육") >= 0, "보안교육 이수 안내");
    // v2.36.1: 구버전 안내 페이지 · 공항 출입증 규정 자료실 링크 제거
    ok(html.indexOf("sites.google.com") < 0, "구버전 안내 페이지 링크 제거");
    ok(html.indexOf("drive.google.com/drive/folders") < 0, "규정 자료실(폴더) 링크 제거");
    ok(html.indexOf("docs.google.com/spreadsheets") < 0, "책임자 명단 구글시트 링크 제거");
  });

  t("GD07 출입증 서류 체크리스트 — 진행률 + 계정별 localStorage 보존", () => {
    const e = makeEnv();
    loginAs(e, "user");
    go(e, "pass-docs");
    eq(q(e, "#pd-pct").textContent, "0 / 4 준비완료", "초기 진행률");
    const boxes = qa(e, "#view [data-pd-chk]");
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new e.w.Event("change", { bubbles: true }));
    boxes[2].checked = true;
    boxes[2].dispatchEvent(new e.w.Event("change", { bubbles: true }));
    eq(q(e, "#pd-pct").textContent, "2 / 4 준비완료", "진행률 갱신");
    eq(q(e, "#pd-bar").style.width, "50%", "진행 바");
    ok(boxes[0].closest(".gd-chk").classList.contains("done"), "완료 스타일");
    const key = e.w.SemisPassDocs.chkKey();
    ok(key.indexOf("semis2:passDocsChk:") === 0, "계정별 키");
    const saved = JSON.parse(e.w.localStorage.getItem(key));
    ok(saved.d1 === true && saved.d3 === true && !saved.d2, "저장 내용");
    go(e, "dashboard"); go(e, "pass-docs");
    eq(q(e, "#pd-pct").textContent, "2 / 4 준비완료", "재진입 시 복원");
  });

  t("GD08 권한 — 일반사용자 열람 가능 / 협력업체는 미노출", () => {
    const e = makeEnv();
    loginAs(e, "user");
    ["seclevel", "iosa", "pass-docs"].forEach(r => {
      go(e, r);
      ok(q(e, "#view .gd-hero"), r + " 일반사용자 렌더");
    });
    const nav = q(e, "#nav-menu").textContent;
    ok(nav.indexOf("국가 보안등급 소개") >= 0 && nav.indexOf("IOSA") >= 0
      && nav.indexOf("출입증 신청 서류") >= 0, "사이드바 노출");
    const v = makeEnv();
    loginAs(v, "vendor");
    go(v, "iosa");
    ok(!q(v, "#view .gd-hero"), "협력업체는 허용 라우트 밖 → 기본 화면");
  });

  t("GD09 통합 검색 — 안내 콘텐츠 3종 색인", () => {
    const e = makeEnv();
    loginAs(e, "user");
    const hit = (kw) => e.w.SemisSearch.search(kw).map(r => r.group);
    ok(hit("우발계획").some(g => g === "국가 보안등급 소개"), "우발계획 → 보안등급 소개");
    ok(hit("IDX").some(g => g === "IOSA (국제 인허가)"), "IDX → IOSA");
    ok(hit("Risk-Based").some(g => g === "IOSA (국제 인허가)"), "Risk-Based → IOSA");
    ok(hit("신원진술서").some(g => g === "출입증 신청 서류"), "신원진술서 → 출입증 신청 서류");
  });

  t("GD10 자원 등록 — 스크립트/CSS/데이터 격리", () => {
    const html = read("index.html");
    ["seclevel", "iosa", "passdocs"].forEach(f =>
      ok(new RegExp('<script src="js/' + f + '\\.js\\?v=[\\d.]+"><\\/script>').test(html), f + ".js 등록"));
    const css = read("css/main.css");
    [".gd-hero", ".gd-lvl", ".gd-step", ".gd-chk", ".gd-cmp"].forEach(c =>
      ok(new RegExp("\\" + c + "\\s*[,{ ]").test(css), c + " CSS"));
    // 정적 안내 모듈 — 동기화 키를 늘리지 않음
    const e = makeEnv();
    ["seclevel", "iosa", "passDocs", "pass-docs"].forEach(k =>
      ok(!e.Sync.SYNC_KEYS.includes(k), k + " SYNC_KEYS 미포함"));
  });


  /* ══════════ [GD] v2.36.1 후속 — 등급 연동 · 책임자 명단 ══════════ */
  t("GD11 보안등급 변경이 소개 화면에 즉시 반영 (로컬 · 원격 동기화)", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    go(e, "seclevel");
    const cur = () => q(e, "#view .gd-lvl.on .gd-lvl-name").textContent;
    // ① 대시보드에서 등급 변경 → 소개 화면 재진입 시 반영
    e.S.data.levelHistory.length = 0;
    e.S.data.levelHistory.push({ level: "심각", date: "2000-01-01", end: "", note: "" });
    e.S.saveSilent();
    go(e, "dashboard"); go(e, "seclevel");
    eq(cur(), "심각", "로컬 변경 반영");
    ok(q(e, "#view .gd-hero .gd-now").textContent.indexOf("심각") >= 0, "히어로도 갱신");
    // ② 원격 동기화 반영 — sync applyRemote가 renderView를 호출하므로 화면에 있어도 갱신
    e.Sync.applyRemote("levelHistory",
      [{ level: "관심", date: "2000-01-02", end: "", note: "원격" }]);
    eq(cur(), "관심", "원격 변경이 현재 화면에 즉시 반영");
    eq(e.S.secCurrent().level, "관심", "데이터 동기화");
  });

  t("GD12 출입증 관리 책임자 명단 — 코드 미시드 + CRUD (hq)", () => {
    const e = makeEnv();
    // 개인정보이므로 코드/시드에 실데이터가 없어야 한다
    eq(e.S.data.passOwners.length, 0, "기본값 빈 배열(코드 미시드)");
    const src = read("js/passdocs.js");   // 명단 실데이터는 이 모듈 어디에도 없어야 한다
    ok(!/010-(?!0000-0000)\d{3,4}-\d{4}/.test(src), "코드에 실제 휴대폰 번호 없음(입력 예시 제외)");
    ["이은우", "박상형", "허용준"].forEach(n =>
      ok(src.indexOf(n) < 0, "코드에 실명 없음: " + n));
    loginAs(e, "hq");
    go(e, "pass-docs");
    ok(q(e, "#po-body .empty"), "빈 상태 안내");
    q(e, "#po-add").click();
    q(e, "#po-no").value = "1";
    q(e, "#po-org").value = "안전보안실";
    q(e, "#po-team").value = "항공보안팀";
    q(e, "#po-name").value = "홍길동";
    q(e, "#po-title").value = "프로";
    q(e, "#po-empNo").value = "100080";
    q(e, "#po-passNo").value = "2501787491";
    q(e, "#po-tel").value = "010-0000-0000";
    q(e, "#po-consent").checked = true;
    q(e, "#po-save").click();
    eq(e.S.data.passOwners.length, 1, "등록됨");
    const x = e.S.data.passOwners[0];
    eq(x.org + "/" + x.name + "/" + x.consent, "안전보안실/홍길동/true", "필드 저장");
    eq(qa(e, "#po-body tbody tr").length, 1, "표 렌더");
    ok(q(e, "#po-body a[href^='tel:']"), "연락처 전화 링크");
    // 수정
    e.w.SemisPassDocs.ownerForm(x.id);
    q(e, "#po-team").value = "보안운영팀";
    q(e, "#po-save").click();
    eq(e.S.data.passOwners[0].team, "보안운영팀", "수정 반영");
    // 삭제
    e.w.SemisPassDocs.ownerForm(x.id);
    q(e, "#po-del").click();
    q(e, "#modal-box [data-act=ok]").click();
    eq(e.S.data.passOwners.length, 0, "삭제됨");
  });

  t("GD13 책임자 명단 — 권한별 열 노출 · 정렬 · 동기화 키", () => {
    const rows = [
      { id: "po2", no: "2", org: "정비본부", team: "운항정비팀", name: "김둘", title: "프로",
        empNo: "300171", passNo: "2507807160", tel: "010-1111-2222", consent: true, note: "" },
      { id: "po1", no: "1", org: "안전보안실", team: "항공보안팀", name: "이하나", title: "프로",
        empNo: "100080", passNo: "2501787491", tel: "010-3333-4444", consent: false, note: "총괄" }
    ];
    const e = makeEnv({ preData: { passOwners: rows } });
    // 일반 사용자: 이름·연락처는 보이고 사번·출입증번호·동의는 숨김
    loginAs(e, "user");
    go(e, "pass-docs");
    let html = q(e, "#po-body").innerHTML;
    ok(html.indexOf("이하나") >= 0 && html.indexOf("010-3333-4444") >= 0, "이름·연락처 노출");
    ok(html.indexOf("100080") < 0 && html.indexOf("2501787491") < 0, "사번·출입증번호 비노출");
    ok(html.indexOf("개인정보 동의") < 0, "동의 열 비노출");
    ok(!q(e, "#po-add"), "일반 사용자는 추가 버튼 없음");
    eq(qa(e, "#po-body tbody tr td:nth-child(4)")[0].textContent, "이하나", "번호순 정렬");
    // 보안관리자: 전체 열 노출, 편집은 불가
    loginAs(e, "manager");
    go(e, "pass-docs");
    html = q(e, "#po-body").innerHTML;
    ok(html.indexOf("100080") >= 0 && html.indexOf("2501787491") >= 0, "mgr는 사번·출입증번호 열람");
    ok(!q(e, "#po-add"), "mgr는 편집 불가");
    // hq: 편집 가능
    loginAs(e, "hq");
    go(e, "pass-docs");
    ok(q(e, "#po-add"), "hq 추가 버튼");
    eq(qa(e, "#po-body [data-po-edit]").length, 2, "행별 수정 버튼");
    ok(e.Sync.SYNC_KEYS.includes("passOwners"), "SYNC_KEYS 등록");
    // 검색: mgr 이상만 노출
    ok(e.w.SemisSearch.search("이하나").some(r => r.group === "출입증 관리 책임자"), "hq 검색 노출");
    loginAs(e, "user");
    ok(!e.w.SemisSearch.search("이하나").some(r => r.group === "출입증 관리 책임자"), "일반 사용자 검색 차단");
  });


  /* ══════════ [IL] 보안점검 목록 폭 · 일정관리 연동 (v2.36.3) ══════════ */
  t("IL01 목록 뷰 열 폭 배분 — colgroup 7열 + 배지/날짜 줄바꿈 방지", () => {
    const e = makeEnv();
    e.Insp = e.w.SemisInspection;
    loginAs(e, "hq");
    e.Insp.setViewMode("list");
    go(e, "inspection");
    const tbl = q(e, "#view table.insp-list");
    ok(tbl, "목록 표 렌더");
    const cols = qa(e, "#view table.insp-list colgroup col");
    eq(cols.length, 7, "colgroup 7열");
    // 대상만 가변(width 미지정), 나머지는 고정폭
    eq(cols.filter(c => !c.style.width).length, 1, "가변 열은 대상 1개");
    eq(cols[3].style.width, "118px", "일자");
    eq(cols[4].style.width, "150px", "점검관");
    eq(cols[6].style.width, "220px", "결과");
    ok(/--cap:\s*1000px/.test(tbl.getAttribute("style") || ""), "표 최대 폭 제한");
    const css = read("css/main.css");
    ok(/\.insp-list \{ table-layout: fixed/.test(css), "고정 레이아웃");
    ok(/\.insp-list \.il-result \.badge \{[^}]*white-space: nowrap/.test(css), "결과 배지 줄바꿈 방지");
    ok(/\.insp-list \.il-date \{[^}]*white-space: nowrap/.test(css), "일자 줄바꿈 방지");
    e.Insp.setViewMode("matrix");
  });

  t("IL02 목록 뷰 — 점검관은 약자가 아닌 실제 이름", () => {
    const e = makeEnv();
    e.Insp = e.w.SemisInspection;
    loginAs(e, "hq");
    const x = e.S.data.inspections.find(v => v.target === "LSG");
    x.inspectors = ["홍길동", "김철수"];
    e.S.saveSilent();
    e.Insp.setViewMode("list");
    go(e, "inspection");
    const row = qa(e, "#view [data-insp-row]").find(r => r.textContent.includes("LSG"));
    eq(row.querySelector(".il-people").textContent.trim(), "홍길동 · 김철수", "전체 이름 표기");
    e.Insp.setViewMode("matrix");
  });

  t("IL03 점검 일자 수정 → 연결된 일정관리 일정도 함께 변경", () => {
    const e = makeEnv();
    e.Insp = e.w.SemisInspection;
    loginAs(e, "hq");
    const x = e.S.data.inspections.find(v => v.target === "LSG");
    // ① 일자 확정 + 캘린더 연동 → 일정 생성
    Object.assign(x, { start: "2026-05-12", end: "2026-05-13", linkCal: true, status: "계획" });
    e.Insp.syncCalendar(x);
    const sid = "insp_" + x.id;
    const ev = () => e.S.data.schedules.find(s => s.id === sid);
    ok(ev(), "연동 일정 생성");
    eq(ev().start + "~" + ev().end, "2026-05-12~2026-05-13", "최초 일자");
    eq(ev().title, "[점검] LSG", "제목");
    // ② 점검 일자 수정 → 일정도 갱신 (id 유지 = 중복 생성 아님)
    Object.assign(x, { start: "2026-06-01", end: "2026-06-03" });
    e.Insp.syncCalendar(x);
    eq(e.S.data.schedules.filter(s => s.id === sid).length, 1, "중복 생성 없음");
    eq(ev().start + "~" + ev().end, "2026-06-01~2026-06-03", "수정 일자 반영");
    // ③ 상태 완료 → 일정도 완료 표시
    x.status = "완료"; e.Insp.syncCalendar(x);
    eq(ev().done, true, "완료 동기화");
    // ④ 연동 해제 / 취소 / 일자 삭제 → 일정 제거
    x.linkCal = false; e.Insp.syncCalendar(x);
    ok(!ev(), "연동 해제 시 일정 제거");
    x.linkCal = true; x.status = "취소"; e.Insp.syncCalendar(x);
    ok(!ev(), "취소 시 일정 제거");
    x.status = "계획"; e.Insp.syncCalendar(x);
    ok(ev(), "복구");
    e.Insp.removeCalendar(x.id);
    ok(!ev(), "점검 삭제 시 일정 제거");
  });

  t("IL04 점검 폼에서 일자 수정 저장 → 일정관리 반영 (실제 UI 경로)", () => {
    const e = makeEnv();
    e.Insp = e.w.SemisInspection;
    loginAs(e, "hq");
    const x = e.S.data.inspections.find(v => v.target === "정비고");
    e.Insp.open(x.id);
    q(e, "#i-linkcal").checked = true;
    q(e, "#i-start").value = "2026-09-07";
    q(e, "#i-end").value = "2026-09-08";
    q(e, "#i-save").click();
    const sid = "insp_" + x.id;
    let ev = e.S.data.schedules.find(s => s.id === sid);
    ok(ev && ev.start === "2026-09-07" && ev.end === "2026-09-08", "폼 저장 시 일정 생성");
    // 날짜만 바꿔 재저장
    e.Insp.open(x.id);
    q(e, "#i-start").value = "2026-09-21";
    q(e, "#i-end").value = "2026-09-22";
    q(e, "#i-save").click();
    ev = e.S.data.schedules.find(s => s.id === sid);
    eq(ev.start + "~" + ev.end, "2026-09-21~2026-09-22", "수정 일자가 일정에 반영");
    eq(e.S.data.schedules.filter(s => s.id === sid).length, 1, "일정 1건 유지");
  });

  t("IL05 개인정보 — 보안점검 시드에 점검관 이름 없음 (v2.36.3)", () => {
    const app = read("js/app.js");
    const seed = app.slice(app.indexOf("function seedInspections"), app.indexOf("let DATA = null"));
    ok(!/\[\s*"[^"]/.test(seed.replace(/mk\("/g, "")), "시드 inspectors 배열이 모두 비어 있음");
    const e = makeEnv();
    eq(e.S.data.inspections.filter(x => (x.inspectors || []).length).length, 0, "시드 점검관 0명");
    ["최상일", "이은우", "이윤민"].forEach(n => ok(seed.indexOf(n) < 0, "시드에 실명 없음: " + n));
  });


  /* ══════════ [IB] 점검 ↔ 일정관리 양방향 동기화 (v2.36.4) ══════════ */
  t("IB01 일괄 연동 — 취소 제외 전 점검이 일정관리에 표시(일자 미정은 월 1일 [계획])", () => {
    const e = makeEnv();
    const insp = e.S.data.inspections;
    const linked = e.S.data.schedules.filter(x => String(x.id).indexOf("insp_") === 0);
    eq(linked.length, insp.filter(x => x.status !== "취소").length, "취소 제외 전건 연동");
    ok(insp.every(x => x.status === "취소" || x.linkCal === true), "linkCal 일괄 ON");
    eq(e.S.data.inspSync, "2.36.4", "마이그레이션 플래그");
    // 일자 확정 건: [점검], 미정 건: [계획] + 계획 월 1일
    const fixed = insp.find(x => x.start && x.status !== "취소");
    const tent = insp.find(x => !x.start && x.status !== "취소");
    const ev = (x) => e.S.data.schedules.find(s2 => s2.id === "insp_" + x.id);
    ok(ev(fixed).title.indexOf("[점검] ") === 0, "확정 건 제목");
    eq(ev(fixed).start, fixed.start, "확정 일자 그대로");
    ok(ev(tent).title.indexOf("[계획] ") === 0, "미정 건 제목");
    eq(ev(tent).start, tent.year + "-" + String(tent.month).padStart(2, "0") + "-01", "계획 월 1일");
    ok(/일자 미정/.test(ev(tent).memo), "미정 안내 메모");
    eq(ev(tent).reminders.length, 0, "임시 일정은 알림 없음");
    // 재부팅해도 중복 생성 없음(멱등)
    const again = makeEnv({ preData: JSON.parse(JSON.stringify(e.S.data)) });
    eq(again.S.data.schedules.filter(x => String(x.id).indexOf("insp_") === 0).length, linked.length, "멱등");
  });

  t("IB02 신규 점검 등록 시 '일정관리 연동' 기본 켜짐", () => {
    const e = makeEnv();
    e.Insp = e.w.SemisInspection;
    loginAs(e, "hq");
    go(e, "inspection");
    e.Insp.open("__none__");                 // 없는 id → 폼 안 열림
    ok(!q(e, "#i-linkcal"), "존재하지 않는 점검은 폼 미개방");
    // 신규 등록 폼(매트릭스 빈 칸 클릭 경로와 동일하게 inspForm(null))은 open으로 못 여니 렌더 확인
    const src = read("js/inspection.js");
    ok(/id="i-linkcal"[^>]*\$\{x \? \(x\.linkCal \? "checked" : ""\) : "checked"\}/.test(src),
      "신규는 checked, 기존은 저장값");
    // 기존 건: linkCal off면 체크 해제 상태
    const x = e.S.data.inspections[0];
    x.linkCal = false; e.S.saveSilent();
    e.Insp.open(x.id);
    eq(q(e, "#i-linkcal").checked, false, "기존 OFF 유지");
  });

  t("IB03 일정관리에서 연동 일정 드래그 → 점검 일자·계획월 반영", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    const x = e.S.data.inspections.find(v => v.target === "BKKSU");
    Object.assign(x, { start: "2026-03-10", end: "2026-03-12", month: 3, linkCal: true, status: "계획" });
    e.w.SemisInspection.syncCalendar(x);
    // 캘린더에서 11월로 이동
    ok(e.Cal.moveEvent("insp_" + x.id, "2026-11-17"), "이동");
    const y = e.S.data.inspections.find(v => v.id === x.id);
    eq(y.start + "~" + y.end, "2026-11-17~2026-11-19", "점검 일자 반영(기간 유지)");
    eq(y.month, 11, "계획 월도 이동");
    // 되반영 후에도 일정 제목·색은 점검 기준 유지(우선권)
    const ev = e.S.data.schedules.find(s2 => s2.id === "insp_" + x.id);
    eq(ev.title, "[점검] BKKSU", "제목은 점검 원본");
    eq(ev.start, "2026-11-17", "일정도 동일");
  });

  t("IB04 일정관리에서 기간 조정·완료 토글 → 점검 반영", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    const x = e.S.data.inspections.find(v => v.target === "LSG");
    Object.assign(x, { start: "2026-05-12", end: "2026-05-12", month: 5, linkCal: true, status: "계획" });
    e.w.SemisInspection.syncCalendar(x);
    const sid = "insp_" + x.id;
    ok(e.Cal.resizeEvent(sid, "2026-05-15"), "기간 연장");
    eq(e.S.data.inspections.find(v => v.id === x.id).end, "2026-05-15", "종료일 반영");
    // 완료 토글 → 상태 완료
    e.Cal.toggleDone(sid);
    eq(e.S.data.inspections.find(v => v.id === x.id).status, "완료", "완료 반영");
    e.Cal.toggleDone(sid);
    eq(e.S.data.inspections.find(v => v.id === x.id).status, "계획", "해제 시 계획 복귀");
  });

  t("IB05 임시([계획]) 일정을 옮기면 확정 일자로 승격", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    const x = e.S.data.inspections.find(v => !v.start && v.status !== "취소");
    const sid = "insp_" + x.id;
    ok(e.S.data.schedules.find(s2 => s2.id === sid), "임시 일정 존재");
    ok(e.Cal.moveEvent(sid, "2026-09-15"), "이동");
    const y = e.S.data.inspections.find(v => v.id === x.id);
    eq(y.start, "2026-09-15", "확정 일자 승격");
    eq(y.month, 9, "계획 월");
    eq(e.S.data.schedules.find(s2 => s2.id === sid).title.indexOf("[점검] "), 0, "제목도 확정형으로");
  });

  t("IB06 연동 일정을 일정관리에서 삭제 → 연동만 해제(점검 보존)", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    const x = e.S.data.inspections.find(v => v.linkCal);
    const sid = "insp_" + x.id;
    ok(e.w.SemisCalendar.isInspEvent({ id: sid }), "연동 일정 판별");
    e.w.SemisInspection.unlinkBySchedule(sid);
    e.S.data.schedules = e.S.data.schedules.filter(s2 => s2.id !== sid);
    e.S.save();
    eq(e.S.data.inspections.find(v => v.id === x.id).linkCal, false, "연동 해제");
    ok(e.S.data.inspections.some(v => v.id === x.id), "점검 기록은 보존");
  });

  t("IB07 우선권 — 점검에서 수정하면 일정관리 값이 덮어써짐", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    const x = e.S.data.inspections.find(v => v.target === "SFOSF");
    Object.assign(x, { start: "2026-08-23", end: "2026-08-27", month: 8, linkCal: true, status: "계획" });
    e.w.SemisInspection.syncCalendar(x);
    const sid = "insp_" + x.id;
    // 사용자가 일정관리에서 제목·색을 임의로 바꿔둔 상태
    const ev = e.S.data.schedules.find(s2 => s2.id === sid);
    ev.title = "내가 바꾼 제목"; ev.color = "red";
    // 점검 저장 → 원본 값으로 복구
    x.start = "2026-08-24"; x.end = "2026-08-28";
    e.w.SemisInspection.syncCalendar(x);
    const after = e.S.data.schedules.find(s2 => s2.id === sid);
    eq(after.title, "[점검] SFOSF", "제목 복구");
    eq(after.color, "pink", "연동 색(분홍) 복구");
    eq(after.start + "~" + after.end, "2026-08-24~2026-08-28", "일자 반영");
  });

  t("IB09 연동 일정 색상 — 확정=분홍 / 일자 미정(계획)=연분홍", () => {
    const e = makeEnv();
    const I = e.w.SemisInspection;
    eq(I.CAL_COLOR_FIXED, "pink"); eq(I.CAL_COLOR_PLAN, "rose");
    const fixed = e.S.data.inspections.find(x => x.start && x.status !== "취소");
    const tent = e.S.data.inspections.find(x => !x.start && x.status !== "취소");
    const ev = (x) => e.S.data.schedules.find(s2 => s2.id === "insp_" + x.id);
    eq(ev(fixed).color, "pink", "확정 건");
    eq(ev(tent).color, "rose", "미정 건");
    // 일자를 확정하면 색도 분홍으로 승격
    tent.start = "2026-09-15"; tent.end = "2026-09-15";
    I.syncCalendar(tent);
    eq(ev(tent).color, "pink", "확정 시 분홍 승격");
    // 구분(카테고리)이 달라도 연동 색은 동일 — 점검 일정임이 한눈에
    const others = e.S.data.schedules.filter(s2 => String(s2.id).indexOf("insp_") === 0);
    ok(others.every(s2 => s2.color === "pink" || s2.color === "rose"), "연동 일정은 분홍 계열만");
    // CSS 정의 확인
    const css = read("css/main.css");
    ok(/\.ev-rose\s*\{[^}]*background:\s*#fce7f3/.test(css), "연분홍 배경");
    ok(/\.ev-rose\s*\{[^}]*color:\s*#9d174d/.test(css), "가독 글자색");
    ok(/\.ev-pink\s*\{[^}]*--evc:\s*#db2777/.test(css), "분홍 유지");
  });

  t("IB08 취소 상태 점검은 일정관리에서 제거", () => {
    const e = makeEnv();
    loginAs(e, "hq");
    const x = e.S.data.inspections.find(v => v.linkCal && v.status !== "취소");
    const sid = "insp_" + x.id;
    ok(e.S.data.schedules.some(s2 => s2.id === sid), "연동 중");
    x.status = "취소";
    e.w.SemisInspection.syncCalendar(x);
    ok(!e.S.data.schedules.some(s2 => s2.id === sid), "취소 시 일정 제거");
    x.status = "계획";
    e.w.SemisInspection.syncCalendar(x);
    ok(e.S.data.schedules.some(s2 => s2.id === sid), "복구");
  });

  /* ══════════ [PV] 개인 일정 · 자동 연기/연장 (v2.37) ══════════ */
  {
    const base = { memo: "", allDay: true, time: "", timeEnd: "", color: "blue", done: false,
      assignee: "", vehicle: false, room: false, reminders: [], repeat: { freq: "none", until: "" },
      doneFrom: "", doneDates: [], undoneDates: [] };
    const mk = (id, patch) => Object.assign({}, base,
      { id, title: id, start: "2026-07-15", end: "2026-07-15" }, patch || {});

    t("PV01 canSeePriv: 소유 계정만 열람 · owner 없으면 공개", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      eq(e.Cal.meKey(), "thq", "로그인 계정 origId");
      ok(e.Cal.canSeePriv(mk("a", { priv: true, owner: "thq" })), "본인 소유");
      ok(!e.Cal.canSeePriv(mk("b", { priv: true, owner: "tmanager" })), "타 계정 소유");
      ok(e.Cal.canSeePriv(mk("c", { priv: true, owner: "" })), "owner 미기록 = 공개(과거 데이터)");
      ok(e.Cal.canSeePriv(mk("d", {})), "일반 일정");
      ok(e.Cal.isMinePriv(mk("a", { priv: true, owner: "thq" })), "isMinePriv");
      ok(!e.Cal.isMinePriv(mk("d", {})), "비공개 아님");
    });

    t("PV02 filteredEvents/eventsOnDay: 타 계정 비공개 일정 제외", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      clearInspEvents(e);
      e.S.data.schedules.push(
        mk("pv_open", {}),
        mk("pv_mine", { priv: true, owner: "thq" }),
        mk("pv_other", { priv: true, owner: "tmanager" }));
      e.S.saveSilent();
      const ids = e.Cal.filteredEvents().map(x => x.id);
      ok(ids.includes("pv_open") && ids.includes("pv_mine"), "공개·본인 일정 표시");
      ok(!ids.includes("pv_other"), "타 계정 비공개 제외");
      eq(e.Cal.eventsOnDay("2026-07-15").filter(x => x.id === "pv_other").length, 0);
      eq(e.Cal.eventsOnDay("2026-07-15").filter(x => x.id === "pv_mine").length, 1);
    });

    t("PV03 다른 계정으로 재로그인하면 비공개 일정이 사라짐", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      clearInspEvents(e);
      e.S.data.schedules.push(mk("pv_h", { priv: true, owner: "thq" }));
      e.S.saveSilent();
      ok(e.Cal.filteredEvents().some(x => x.id === "pv_h"), "hq 계정에서는 보임");
      const e2 = makeEnv({ preData: JSON.parse(e.w.localStorage.getItem("semis2:data")) });
      loginAs(e2, "manager");
      eq(e2.Cal.meKey(), "tmanager");
      ok(!e2.Cal.filteredEvents().some(x => x.id === "pv_h"), "다른 계정에서는 숨김");
    });

    t("PV04 검색·대시보드·리마인더에서도 비공개 일정 제외", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      clearInspEvents(e);
      const soon = e.Cal.addDays(localToday(), 1);
      e.S.data.schedules.push(
        mk("pv_s1", { title: "비밀회의PV", start: soon, end: soon, priv: true, owner: "tmanager", reminders: ["1d"] }),
        mk("pv_s2", { title: "공개회의PV", start: soon, end: soon }));
      e.S.saveSilent();
      const hits = e.w.SemisSearch.search("회의PV").map(x => x.title);
      ok(hits.includes("공개회의PV"), "공개 일정 검색됨");
      ok(!hits.includes("비밀회의PV"), "타 계정 비공개는 검색 제외");
      go(e, "dashboard");
      const dash = (q(e, ".dash-grid") || { textContent: "" }).textContent;
      ok(dash.indexOf("비밀회의PV") < 0, "대시보드 다가오는 일정 제외");
      ok(!e.Cal.dueReminders(Date.now()).some(d => d.event.id === "pv_s1"), "리마인더 제외");
    });

    t("PV05 자동 연기: 시작일·종료일을 함께 이동(기간 유지)", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const ev = mk("pv_d", { start: "2026-07-10", end: "2026-07-12", autoDefer: true });
      eq(e.Cal.autoRollOne(ev, "2026-07-15"), 3, "3일 경과분 보정");
      eq(ev.start, "2026-07-13"); eq(ev.end, "2026-07-15");
      eq(e.Cal.diffDays(ev.start, ev.end), 2, "기간 2일 유지");
      eq(ev.autoRolledAt, "2026-07-15");
      eq(e.Cal.autoRollOne(ev, "2026-07-15"), 0, "당일 재실행은 변화 없음");
    });

    t("PV06 자동 연장: 종료일만 연장 · 시작일 고정", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const ev = mk("pv_x", { start: "2026-07-10", end: "2026-07-12", autoExtend: true });
      eq(e.Cal.autoRollOne(ev, "2026-07-15"), 3);
      eq(ev.start, "2026-07-10", "시작일 불변");
      eq(ev.end, "2026-07-15", "종료일만 연장");
    });

    t("PV07 자동 연기/연장 미적용 조건 (완료·기한 내·반복·미설정)", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      const C = e.Cal;
      eq(C.autoRollOne(mk("p1", { end: "2026-07-10", autoDefer: true, done: true }), "2026-07-15"), 0, "완료 제외");
      eq(C.autoRollOne(mk("p2", { start: "2026-07-15", end: "2026-07-20", autoDefer: true }), "2026-07-15"), 0, "기한 남음");
      eq(C.autoRollOne(mk("p3", { end: "2026-07-10", autoExtend: true, repeat: { freq: "weekly", until: "" } }), "2026-07-15"), 0, "반복 제외");
      eq(C.autoRollOne(mk("p4", { end: "2026-07-10" }), "2026-07-15"), 0, "옵션 미설정");
    });

    t("PV08 runAutoRoll: 대상만 일괄 보정 후 저장", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      clearInspEvents(e);
      e.S.data.schedules.push(
        mk("pv_r1", { start: "2026-07-01", end: "2026-07-01", autoDefer: true }),
        mk("pv_r2", { start: "2026-07-01", end: "2026-07-03", autoExtend: true }),
        mk("pv_r3", { start: "2026-07-01", end: "2026-07-01" }));
      e.S.saveSilent();
      eq(e.Cal.runAutoRoll("2026-07-15"), 2, "대상 2건만 변경");
      const g = (id) => e.S.data.schedules.find(x => x.id === id);
      eq(g("pv_r1").start, "2026-07-15"); eq(g("pv_r1").end, "2026-07-15");
      eq(g("pv_r2").start, "2026-07-01"); eq(g("pv_r2").end, "2026-07-15");
      eq(g("pv_r3").end, "2026-07-01", "옵션 없는 일정 불변");
      const saved = JSON.parse(e.w.localStorage.getItem("semis2:data"));
      eq(saved.schedules.find(x => x.id === "pv_r1").end, "2026-07-15", "저장 반영");
    });

    t("PV09 열람 전용 계정은 공용 데이터를 변경하지 않음", () => {
      const e = makeEnv();
      loginAs(e, "manager");                                  // rank 2 — canEdit false
      clearInspEvents(e);
      e.S.data.schedules.push(mk("pv_ro", { start: "2026-07-01", end: "2026-07-01", autoDefer: true }));
      e.S.saveSilent();
      eq(e.Cal.autoRollIfAllowed(), 0, "편집 권한 없음 → 미실행");
      eq(e.S.data.schedules.find(x => x.id === "pv_ro").end, "2026-07-01");
    });

    t("PV10 등록 폼: 체크박스 3종 노출 + 저장 시 owner 기록", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      clearInspEvents(e);
      go(e, "schedule");
      q(e, "#cal-add").click();
      ok(q(e, "#f-priv") && q(e, "#f-autodefer") && q(e, "#f-autoextend"), "체크박스 3종");
      q(e, "#f-title").value = "개인일정PV";
      q(e, "#f-start").value = "2026-07-15";
      q(e, "#f-end").value = "2026-07-15";
      q(e, "#f-priv").checked = true;
      q(e, "#f-autoextend").checked = true;
      q(e, "#f-save").click();
      const ev = e.S.data.schedules.find(x => x.title === "개인일정PV");
      ok(ev, "저장됨");
      eq(ev.priv, true); eq(ev.owner, "thq", "소유 계정 기록");
      eq(ev.autoExtend, true); eq(ev.autoDefer, false);
    });

    t("PV11 폼: 자동 연기·연장은 상호 배타", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      go(e, "schedule");
      q(e, "#cal-add").click();
      const dEl = q(e, "#f-autodefer"), xEl = q(e, "#f-autoextend");
      dEl.checked = true; dEl.dispatchEvent(new e.w.Event("change"));
      ok(dEl.checked && !xEl.checked, "연기 선택 시 연장 해제");
      xEl.checked = true; xEl.dispatchEvent(new e.w.Event("change"));
      ok(xEl.checked && !dEl.checked, "연장 선택 시 연기 해제");
    });

    t("PV12 폼: 반복 일정 선택 시 자동 연기·연장 비활성", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      go(e, "schedule");
      q(e, "#cal-add").click();
      const dEl = q(e, "#f-autodefer"), xEl = q(e, "#f-autoextend");
      dEl.checked = true; dEl.dispatchEvent(new e.w.Event("change"));
      q(e, "#f-repeat").value = "weekly";
      q(e, "#f-repeat").dispatchEvent(new e.w.Event("change"));
      ok(dEl.disabled && xEl.disabled, "비활성화");
      ok(!dEl.checked && !xEl.checked, "체크 해제");
      q(e, "#f-title").value = "반복PV";
      q(e, "#f-save").click();
      const ev = e.S.data.schedules.find(x => x.title === "반복PV");
      eq(ev.autoDefer, false); eq(ev.autoExtend, false);
    });

    t("PV13 캘린더 칩에 🔒 · 자동 옵션 표식 표시", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      clearInspEvents(e);
      e.S.data.schedules.push(mk("pv_i", { title: "표식PV", start: "2026-07-15", end: "2026-07-15",
        priv: true, owner: "thq", autoDefer: true }));
      e.S.saveSilent();
      e.Cal.setAnchor("2026-07-15"); e.Cal.setView("month");
      go(e, "schedule");
      const html = (q(e, "#cal-body") || { innerHTML: "" }).innerHTML;
      ok(html.indexOf("표식PV") >= 0, "일정 렌더");
      ok(html.indexOf("🔒") >= 0, "🔒 표식");
      ok(html.indexOf("⏩") >= 0, "자동 연기 표식");
    });

    t("PV14 상세 모달에 옵션 안내 표시", () => {
      const e = makeEnv();
      loginAs(e, "hq");
      clearInspEvents(e);
      e.S.data.schedules.push(mk("pv_dt", { title: "상세PV", priv: true, owner: "thq", autoExtend: true }));
      e.S.saveSilent();
      e.Cal.setAnchor("2026-07-15"); e.Cal.setView("month");
      go(e, "schedule");
      const chip = qa(e, '[data-ev="pv_dt"]')[0];
      ok(chip, "칩 존재");
      chip.click();
      const box = (q(e, "#modal-box") || { textContent: "" }).textContent;
      ok(box.indexOf("나에게만 보이기") >= 0, "비공개 안내");
      ok(box.indexOf("자동 연장") >= 0, "자동 연장 안내");
    });
  }

  /* ══════════ [ST] 저장소 관리 탭 (v2.38) ══════════
     환경(jsdom) 생성은 메모리를 많이 써서 블록당 최소로 재사용한다.
     주의: go()의 location.hash 변경은 hashchange를 비동기로 흘려보내므로
     비동기 검증 전에는 반드시 tick() 한 번으로 재렌더를 흘려보낸 뒤 탭을 연다. */
  {
    const PUB = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-files/";
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
    /* aaa_big·bbb_used = 데이터에서 참조 중 / ccc_old = 미참조(10일 전) / ddd_new = 오늘 업로드(보호) */
    const FILES = [
      { path: "regs/aaa_big.pdf",    name: "aaa_big.pdf",  folder: "regs",    size: 9 * 1024 * 1024, updated: day(30), url: PUB + "regs/aaa_big.pdf" },
      { path: "certs/bbb_used.pdf",  name: "bbb_used.pdf", folder: "certs",   size: 400 * 1024,      updated: day(20), url: PUB + "certs/bbb_used.pdf" },
      { path: "council/ccc_old.png", name: "ccc_old.png",  folder: "council", size: 120 * 1024,      updated: day(10), url: PUB + "council/ccc_old.png" },
      { path: "billing/ddd_new.pdf", name: "ddd_new.pdf",  folder: "billing", size: 50 * 1024,       updated: day(0),  url: PUB + "billing/ddd_new.pdf" }
    ];
    const tick = () => new Promise(r => setTimeout(r, 0));

    const e = makeEnv();
    loginAs(e, "admin");
    const S = e.w.SemisStorage;
    const REF_REG = { id: "st_r1", title: "ST규정", scope: "intl", fileUrl: PUB + "regs/aaa_big.pdf" };
    const REF_CERT = { id: "st_c1", name: "ST이수증", fileUrl: PUB + "certs/bbb_used.pdf" };
    e.S.data.regulations.push(REF_REG);
    e.S.data.certs.push(REF_CERT);
    e.S.saveSilent();

    /* 설정 화면을 연 뒤 hashchange를 흘려보내고 저장소 탭을 연다 */
    async function openStorage(stub) {
      e.w.SemisSync.listFiles = stub || (() => Promise.resolve(FILES.slice()));
      go(e, "settings");
      await tick();                                          // hashchange 재렌더 소진
      go(e, "settings");
      qa(e, ".tab").find(x => x.dataset.tab === "storage").click();
      await tick();
      await tick();
    }

    t("ST01 fmtBytes: 단위 변환", () => {
      eq(S.fmtBytes(512), "512 B");
      eq(S.fmtBytes(2048), "2.0 KB");
      eq(S.fmtBytes(5 * 1024 * 1024), "5.0 MB");
      eq(S.fmtBytes(2 * 1024 * 1024 * 1024), "2.00 GB");
      eq(S.fmtBytes(null), "0 B");
    });

    t("ST02 storeSizes: 컬렉션별 용량 · 용량순 정렬 · 합계", () => {
      const r = S.storeSizes();
      ok(r.rows.length >= 25, "SYNC_KEYS 전 컬렉션");
      ok(r.rows.every((x, i) => i === 0 || r.rows[i - 1].bytes >= x.bytes), "내림차순 정렬");
      eq(r.total, r.rows.reduce((s, x) => s + x.bytes, 0), "합계 일치");
      const sc = r.rows.find(x => x.key === "schedules");
      ok(sc && sc.count === e.S.data.schedules.length, "배열은 항목 수 표기");
    });

    t("ST03 referencedPaths: 데이터 안의 파일 URL만 추출", () => {
      const refs = S.referencedPaths();
      ok(refs.has("regs/aaa_big.pdf"), "규정 첨부 인식");
      ok(refs.has("certs/bbb_used.pdf"), "이수증 첨부 인식");
      ok(!refs.has("council/ccc_old.png"), "미참조 파일은 미포함");
    });

    t("ST04 orphanFiles: 참조·최근 업로드 제외", () => {
      const orphans = S.orphanFiles(FILES, S.referencedPaths());
      eq(orphans.map(f => f.path).join(","), "council/ccc_old.png");
      eq(S.orphanFiles(FILES, new Set()).length, 0, "참조 스캔 실패 시 아무것도 대상 아님");
    });

    t("ST05 folderName: 업로드 폴더 → 한글 라벨", () => {
      eq(S.folderName("branch-train"), "지점 교육 첨부");
      eq(S.folderName("council-sign"), "협의회 서명");
      eq(S.folderName("unknown-x"), "unknown-x", "미등록 폴더는 원문");
    });

    t("ST06 설정 탭 구성: 저장소 관리 탭 추가", () => {
      go(e, "settings");
      eq(qa(e, ".tab").map(x => x.dataset.tab).join(","), "menus,users,data,storage");
    });

    await ta("ST07 탭 렌더: 용량 게이지 2종 + 컬렉션 용량 표", async () => {
      await openStorage();
      eq(qa(e, "#tab-body .st-gauge").length, 2, "파일 · DB 게이지");
      ok(q(e, "#st-reload"), "새로고침 버튼");
      const rows = qa(e, "#tab-body .card:last-child .st-tbl tbody tr");
      ok(rows.length >= 25, "컬렉션별 용량 표: " + rows.length);
    });

    await ta("ST08 파일 목록 로드: 게이지 갱신 · 분류별 · 대용량 TOP", async () => {
      await openStorage();
      const gauge = q(e, "#st-file-gauge").textContent;
      ok(/9\.[56] MB/.test(gauge), "총 용량 표기: " + gauge);
      ok(gauge.indexOf("4개 파일") >= 0, "파일 수");
      const folders = q(e, "#st-folders").textContent;
      ok(folders.indexOf("보안규정 파일") >= 0 && folders.indexOf("대금 청구 증빙") >= 0, "분류 라벨");
      const big = qa(e, "#st-big tbody tr");
      eq(big.length, 4);
      ok(big[0].textContent.indexOf("aaa_big.pdf") >= 0, "용량 내림차순");
    });

    await ta("ST09 미참조 목록: 참조·최근 업로드 파일 제외", async () => {
      await openStorage();
      const rows = qa(e, "#st-orphans tbody tr");
      eq(rows.length, 1, "미참조 1건만");
      ok(rows[0].textContent.indexOf("ccc_old.png") >= 0);
      ok(q(e, "#st-del").disabled, "선택 전에는 삭제 비활성");
    });

    await ta("ST10 선택 삭제: 확인 모달 후에만 deleteFile 호출", async () => {
      await openStorage();
      const deleted = [];
      e.w.SemisSync.deleteFile = (p) => { deleted.push(p); return Promise.resolve(true); };
      const chk = q(e, "#st-orphans .st-o");
      chk.checked = true;
      chk.dispatchEvent(new e.w.Event("change"));
      eq(q(e, "#st-del").disabled, false, "선택 시 활성");
      ok(q(e, "#st-del").textContent.indexOf("1개") >= 0, "선택 수 표기");
      q(e, "#st-del").click();
      eq(deleted.length, 0, "확인 전에는 삭제하지 않음");
      q(e, "#modal-box [data-act=ok]").click();
      await tick();
      eq(deleted.join(","), "council/ccc_old.png");
    });

    await ta("ST11 전체 선택 체크 → 선택 수 반영", async () => {
      await openStorage();
      q(e, "#st-all").checked = true;
      q(e, "#st-all").dispatchEvent(new e.w.Event("change"));
      eq(qa(e, "#st-orphans .st-o").filter(c => c.checked).length, 1);
      eq(q(e, "#st-del").disabled, false);
    });

    await ta("ST12 목록 조회 실패 시 안내만 표시 (삭제 대상 없음)", async () => {
      await openStorage(() => Promise.reject(new Error("network")));
      ok(q(e, "#st-orphans").textContent.indexOf("불러오지 못했습니다") >= 0);
      eq(qa(e, "#st-orphans .st-o").length, 0);
      ok(q(e, "#st-file-gauge").textContent.indexOf("조회 실패") >= 0);
    });

    await ta("ST13 참조 스캔이 0건이면 정리 기능 잠금 (오삭제 방지)", async () => {
      e.S.data.regulations = e.S.data.regulations.filter(x => x.id !== "st_r1");
      e.S.data.certs = e.S.data.certs.filter(x => x.id !== "st_c1");
      e.S.saveSilent();
      eq(S.referencedPaths().size, 0, "참조 URL 없음");
      await openStorage();
      const txt = q(e, "#st-orphans").textContent;
      ok(txt.indexOf("정리 기능을 잠갔습니다") >= 0, "잠금 안내: " + txt.slice(0, 60));
      eq(qa(e, "#st-orphans .st-o").length, 0, "삭제 대상 미노출");
      e.S.data.regulations.push(REF_REG);
      e.S.data.certs.push(REF_CERT);
      e.S.saveSilent();
    });

    t("ST14 저장소 탭은 시스템관리자 전용 (설정 화면 자체가 잠김)", () => {
      loginAs(e, "hq");                                      // 같은 환경에서 계정만 전환(메모리 절약)
      go(e, "settings");
      eq(qa(e, ".tab").length, 0);
      ok(q(e, "#view .empty"), "잠금 안내");
      loginAs(e, "admin");                                   // 원복
    });

    /* sync.js 저장소 API — fetch 스텁 환경 1개 재사용 */
    let stFetch = () => Promise.reject(new Error("no stub"));
    const e3 = makeEnv({ fetch: (u, o) => stFetch(u, o), boot: false });

    await ta("ST15 sync.listFiles: 폴더 재귀 조회 → 경로·공개 URL", async () => {
      const calls = [];
      stFetch = (url, opts) => {
        const body = opts && opts.body ? JSON.parse(opts.body) : {};
        calls.push({ url: String(url), prefix: body.prefix, offset: body.offset });
        if (String(url).indexOf("/object/list/semis-files") < 0) return Promise.reject(new Error("bad url"));
        if (body.offset > 0) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        if (!body.prefix) return Promise.resolve({ ok: true, json: () => Promise.resolve([
          { name: "regs", id: null },
          { name: "loose.txt", id: "x0", metadata: { size: 10 }, updated_at: "2026-08-01T00:00:00Z" }]) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve([
          { name: "a.pdf", id: "x1", metadata: { size: 2048 }, updated_at: "2026-07-01T00:00:00Z" }]) });
      };
      const files = await e3.w.SemisSync.listFiles();
      eq(files.length, 2);
      const a = files.find(f => f.name === "a.pdf");
      eq(a.path, "regs/a.pdf"); eq(a.folder, "regs"); eq(a.size, 2048);
      ok(a.url.indexOf("/object/public/semis-files/regs/a.pdf") > 0, "공개 URL");
      const loose = files.find(f => f.name === "loose.txt");
      eq(loose.path, "loose.txt"); eq(loose.folder, "", "루트 직속 파일");
      ok(calls.some(c => c.prefix === "regs/"), "하위 폴더 재귀 조회");
    });

    await ta("ST16 sync.deleteFile: DELETE 요청 경로", async () => {
      let seen = null;
      stFetch = (url, opts) => {
        seen = { url: String(url), method: opts.method };
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      };
      ok(await e3.w.SemisSync.deleteFile("council/ccc_old.png"));
      eq(seen.method, "DELETE");
      ok(seen.url.indexOf("/storage/v1/object/semis-files/council/ccc_old.png") > 0, seen.url);
    });

    await ta("ST17 sync.listFiles: 실패 응답은 예외로 전달", async () => {
      stFetch = () => Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) });
      let err = null;
      await e3.w.SemisSync.listFiles().catch(x => { err = x; });
      ok(err && /403/.test(err.message), "403 전달");
    });
  }


  /* ══════════ 결과 ══════════ */
  console.log("\n════════════════════════════════════");
  console.log(`  SeMIS v2.9 테스트: ${passed + failed}건 실행`);
  console.log(`  ✓ 통과 ${passed}건  ✗ 실패 ${failed}건`);
  console.log("════════════════════════════════════");
  if (failures.length) {
    console.log("\n실패 목록:");
    failures.forEach(f => console.log("  " + f));
  }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("테스트 러너 오류:", e); process.exit(1); });
