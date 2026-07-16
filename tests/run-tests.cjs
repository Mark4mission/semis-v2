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
const caresJS = read("js/cares.js");
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
  // 개별 eval 간에는 최상위 const 바인딩이 공유되지 않으므로 한 번에 평가
  w.eval(appJS + "\n;" + modJS + "\n;" + calJS + "\n;" + inspJS + "\n;" + caresJS + "\n;" + syncJS);
  const S = w.SeMIS;
  if (opts.boot !== false) S.boot();
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
    t("R05 기본 사용자 3명 (admin/manager/user)", () => {
      eq(e.S.BASE_USERS.length, 3);
      eq(e.S.BASE_USERS.map(u => u.role).join(","), "admin,manager,user");
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
    loginAs(e, "manager");
    t("R44 네비 권한: manager에게 mgr 메뉴 표시", () => {
      const labels = qa(e, "#nav-menu .nav-item").map(x => x.textContent);
      ok(labels.some(l => l.includes("계약서 관리")));
    });
  }

  /* ══════════ [R] 회귀 — 대시보드/공지/등급 변경 ══════════ */
  {
    const e = makeEnv();
    loginAs(e, "manager");
    t("R45 대시보드 통계 카드 4개", () => eq(qa(e, ".stat").length, 4));
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
      ok(n && n.pinned === true && n.author === "Tmanager");
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
    loginAs(e, "user");
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
    t("R63 암호 변경: 타 사용자와 동일 암호 거부", () => {
      q(e, '[data-pw="branch"]').click();
      q(e, "#f-pw1").value = "unique-pw-551"; // newbie1과 동일
      q(e, "#f-pw2").value = "unique-pw-551";
      q(e, "#f-save").click();
      ok(e.S.data.pwOverrides["branch"] !== e.S.pwHash("unique-pw-551"));
      e.S.closeModal();
    });
    t("R64 암호 변경: 정상 변경 → pwOverrides 반영", () => {
      q(e, '[data-pw="branch"]').click();
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
    loginAs(e, "manager");
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
    t("C18 월 보기: 기간 일정 칩이 매일 표시", () => {
      C.resizeEvent("ev2", "2026-07-25"); // 7/20~25 (renderView 포함)
      eq(qa(e, '[data-ev="ev2"]').length, 6, "7/20~25 6일");
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
    t("C26 시간 일정 칩에 시간 표기", () => {
      const chip = q(e, '[data-ev="ev3"]');
      ok(chip.innerHTML.includes("14:00"));
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
      q(e, "#f-memo").value = "메모입니다";
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
    loginAs(e, "user");
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
    loginAs(e, "manager");
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
      loginAs(e, "manager");
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
    loginAs(e, "manager");
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
    t("I08 일반 사용자: 등록 버튼 없음 + 상세 열람", () => {
      const e2 = makeEnv();
      loginAs(e2, "user");
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
    loginAs(e, "manager");
    const CA = e.w.SemisCares;
    t("CA01 미설정 시 안내 표시 (대시보드 카드)", () => {
      const box = q(e, "#cares-box");
      ok(box, "CARES 카드 존재");
      ok(box.innerHTML.includes("연동이 설정되지"), "설정 안내");
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
    const e = makeEnv({ fetch: stub });
    loginAs(e, "manager");
    e.w.SemisCares.setCfg({ enabled: true, email: "v@a.com", pw: "p" });
    const box = q(e, "#cares-box");
    await e.w.SemisCares.renderInto(box, true);
    ok(box.innerHTML.includes("임계치 초과"), "초과 배지");
    ok(q(e, ".cares-cell.exceed"), "초과 셀 강조 (temp 45 > 40)");
    eq(qa(e, ".cares-cell").length, 8, "8개 지표");
    ok(q(e, ".cares-spark"), "스파크라인");
    e.Sync.stop();
  });

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
    loginAs(e, "manager");
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
    loginAs(e, "manager");
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
      const cell = qa(e, ".cal-cell").find(c => c.dataset.day === "2026-07-14");
      eq(cell.querySelectorAll("[data-ev]").length, 10, "10개 모두 표시");
      ok(!cell.querySelector(".cal-more"), "더보기 없음");
    });
    t("V17 월 보기: 5개까지 표시 후 더보기", () => {
      C.setView("month"); e.S.renderView();
      const cell = qa(e, ".cal-cell").find(c => c.dataset.day === "2026-07-14");
      eq(cell.querySelectorAll("[data-ev]").length, 5, "월 5개 표시");
      ok(cell.querySelector(".cal-more"), "+N개 더보기");
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
    eq(keys, "customUsers,gcal,inspections,levelHistory,menus,notices,pwOverrides,schedules");
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
    const remote = [{ id: "rt1", title: "실시간일정", memo: "", start: "2026-09-10", end: "2026-09-10", allDay: true, time: "", timeEnd: "", color: "green", done: false, assignee: "", vehicle: false, room: false, reminders: [] }];
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

  /* ══════════ 결과 ══════════ */
  console.log("\n════════════════════════════════════");
  console.log(`  SeMIS v2.4 테스트: ${passed + failed}건 실행`);
  console.log(`  ✓ 통과 ${passed}건  ✗ 실패 ${failed}건`);
  console.log("════════════════════════════════════");
  if (failures.length) {
    console.log("\n실패 목록:");
    failures.forEach(f => console.log("  " + f));
  }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("테스트 러너 오류:", e); process.exit(1); });
