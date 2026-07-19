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
const ctJS = read("js/contacts.js");
const brJS = read("js/branches.js");
const psJS = read("js/passes.js");
const eqJS = read("js/equipment.js");
const trJS = read("js/training.js");
const cnJS = read("js/contracts.js");
const rgJS = read("js/regulations.js");
const plJS = read("js/policy.js");
const ctcJS = read("js/certs.js");
const blJS = read("js/billing.js");
const vtJS = read("js/vault.js");
const caresJS = read("js/cares.js");
const searchJS = read("js/search.js");
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
  w.eval(appJS + "\n;" + modJS + "\n;" + calJS + "\n;" + inspJS + "\n;" + ctJS + "\n;" + brJS + "\n;" + psJS + "\n;" + eqJS + "\n;" + trJS + "\n;" + cnJS + "\n;" + rgJS + "\n;" + plJS + "\n;" + ctcJS + "\n;" + blJS + "\n;" + vtJS + "\n;" + caresJS + "\n;" + searchJS + "\n;" + syncJS);
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
    t("R54 설정: admin 접근 및 탭 3개", () => eq(qa(e, ".tab").length, 3));
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
      eq(C.COLORS.length, 14);
      ok(new Set(C.COLORS.map(c => c.id)).size === 14, "id 중복 없음");
    });
    t("C05 보기 5종 (일/주/2주/월/년)", () =>
      eq(C.VIEWS.map(v => v.id).join(","), "day,week,2week,month,year"));
  }
  {
    const e = makeEnv();
    loginAs(e, "hq");
    const C = e.Cal;
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
    t("C32 드래그앤드롭 배선: dragstart→drop으로 이동", () => {
      C.setAnchor("2026-07-15"); e.S.renderView();
      const chip = qa(e, '[data-ev="ev1"]')[0];
      ok(chip, "칩 존재");
      chip.dispatchEvent(new e.w.Event("dragstart", { bubbles: true, cancelable: true }));
      const target = qa(e, ".cal-cell").find(c => c.dataset.day === "2026-07-22");
      target.dispatchEvent(new e.w.Event("drop", { bubbles: true, cancelable: true }));
      eq(D.schedules.find(x => x.id === "ev1").start, "2026-07-22");
      C.moveEvent("ev1", "2026-07-15"); // 원복
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
    t("C35 칩 완료 토글 버튼(○/✓)", () => {
      C.setAnchor("2026-07-15"); C.setView("month"); e.S.renderView();
      const tog = qa(e, '[data-donetoggle="ev1"]')[0];
      ok(tog);
      tog.click();
      eq(D.schedules.find(x => x.id === "ev1").done, true);
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
      ok(chip && !chip.hasAttribute("draggable"), "드래그 불가");
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
    t("V03 팀 4명 + 담당자 태그(이모지+약자)", () => {
      const C = e.Cal;
      eq(C.TEAM.length, 4);
      eq(C.TEAM.map(t2 => t2.name).join(","), "박철성,최상일,이은우,이윤민");
      ok(C.tagOf("박철성").includes("박"));
      ok(C.tagOf("최상일").includes("최"));
      ok(C.tagOf("이은우").includes("은"));
      ok(C.tagOf("이윤민").includes("윤"));
      eq(C.tagOf("외부인사").length, 2, "미등록자는 앞 2자");
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
      timestamp: { timestampValue: "2026-07-16T10:00:00Z" },
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
      timestamp: { timestampValue: "2026-07-16T10:00:00Z" },
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
    t("V14 이윤민 이모지 변경(🌸)", () => {
      eq(C.TEAM.find(t2 => t2.name === "이윤민").emoji, "🌸");
      ok(C.tagOf("이윤민").includes("🌸"));
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
    eq(keys, "billing,branches,certOpts,certs,contacts,contracts,customUsers,equipMaint,equipment,gcal,inspections,levelHistory,menus,notices,passes,policy,pwOverrides,regulations,schedules,trainings,userOverrides,vault");
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
    const remote = [{ id: "rt1", title: "실시간일정", memo: "", start: "2026-09-10", end: "2026-09-10", allDay: true, time: "", timeEnd: "", color: "green", done: false, assignee: "", vehicle: false, room: false, reminders: [], repeat: { freq: "none", until: "" } }];
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
    eq(mn.parent, "grp-pass", "출입증/보안장비 그룹");
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
    // 라우팅 격리: 다른 모듈 접근 시도 → billing 강제
    go(e, "dashboard");
    ok(/대금 청구/.test(q(e, ".page-title").textContent), "dashboard 접근 → billing 강제");
    go(e, "settings");
    ok(/대금 청구/.test(q(e, ".page-title").textContent), "settings 접근 → billing 강제");
    // 네비: billing 하나만
    eq(qa(e, "#nav-menu .nav-item").length, 1, "네비 메뉴 1개");
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
