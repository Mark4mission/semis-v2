/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 전역 통합 검색 (v2.18)
   헤더 상단 중앙 검색창: 포탈 전체(메뉴·링크·공지·일정·점검·연락망·지점·
   출입증·장비·교육·이수증·계약·규정·청구 …)를 한 번에 검색.

   설계 원칙
   - 권한: 결과마다 해당 메뉴의 vis(SeMIS.canSee)를 그대로 적용 —
     접속 계정의 권한 범위 안에서만 노출. 대외비(계약·유지보수 비용·청구)는
     추가로 minRank(hq 이상) 이중 게이트. vendor 계정은 검색 자체 미노출.
   - 확장성: 메뉴/링크는 DATA.menus를 검색 시점에 실시간 스캔 —
     이후 메뉴를 추가·변경해도 즉시 검색됨. 데이터는 프로바이더 레지스트리
     (SemisSearch.register)로 신규 모듈이 스스로 등록 가능.
   - 검색어: 공백 구분 다중 단어 AND 매칭, 대소문자 무시.
   ═══════════════════════════════════════════════════════ */
"use strict";

const SemisSearch = (() => {
  const S = () => window.SeMIS;
  const D = () => S().data;
  const esc = (s) => S().esc(s);

  /* ─────── 프로바이더 레지스트리 ───────
     { id, group, icon, module?, minRank?, items() => [{title, sub?, text?, route?, url?}] }
     - module: 권한 게이트(해당 모듈 메뉴의 vis) + 기본 이동 라우트
     - minRank: 추가 권한 하한 (대외비 이중 게이트 / module 없을 때 단독 게이트)
     - text: 검색 대상 필드 배열(없으면 title+sub) */
  const providers = [];
  function register(p) {
    if (!p || !p.id || typeof p.items !== "function") return;
    const i = providers.findIndex(x => x.id === p.id);
    if (i >= 0) providers[i] = p; else providers.push(p);
  }

  function canUseProvider(p) {
    const rank = S().roleRank();
    if (p.minRank && rank < p.minRank) return false;
    if (p.module) {
      const mn = (D().menus || []).find(m => m && m.type === "module" && m.module === p.module);
      if (mn) return S().canSee(mn);
      return rank >= 4; // 메뉴가 제거된 모듈은 관리자만 (보수적)
    }
    return true;
  }

  /* ─────── 매칭/하이라이트 ─────── */
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function terms(q) {
    return String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  }
  function haystack(it) {
    const src = it.text != null ? it.text : [it.title, it.sub];
    return (Array.isArray(src) ? src : [src])
      .map(v => Array.isArray(v) ? v.join(" ") : v)
      .filter(v => v != null && v !== "").join(" \n ").toLowerCase();
  }
  function scoreOf(it, ts) {
    const hay = haystack(it);
    if (!ts.every(t => hay.indexOf(t) >= 0)) return 0;
    const title = String(it.title || "").toLowerCase();
    let sc = 1;
    if (ts.some(t => title.indexOf(t) >= 0)) sc += 2;
    if (ts.some(t => title.indexOf(t) === 0)) sc += 1;
    return sc;
  }
  function hl(s, ts) {
    s = String(s == null ? "" : s);
    if (!ts.length) return esc(s);
    const re = new RegExp("(" + ts.map(reEsc).join("|") + ")", "gi");
    return s.split(re).map((part, i) =>
      i % 2 ? '<b class="sp-hl">' + esc(part) + "</b>" : esc(part)).join("");
  }
  /* 매칭 지점 주변만 발췌 */
  function snip(s, ts, len) {
    s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    len = len || 64;
    if (s.length <= len) return s;
    const low = s.toLowerCase();
    let idx = -1;
    ts.forEach(t => { const i = low.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i; });
    if (idx <= 20) return s.slice(0, len) + "…";
    const start = Math.max(0, idx - 20);
    return "…" + s.slice(start, start + len) + "…";
  }

  /* ─────── 검색 실행 (권한 범위 내) ─────── */
  const PER_GROUP = 8, TOTAL_MAX = 60;
  function search(q) {
    const ts = terms(q);
    const u = S().user;
    if (!ts.length || !u || u.role === "vendor") return [];
    const out = [];

    /* 1) 메뉴/링크 — DATA.menus 실시간 스캔 (메뉴 추가·변경 즉시 반영) */
    const menuHits = [];
    S().sortedMenus().forEach(mn => {
      if (!mn || mn.type === "group" || !S().canSee(mn)) return;
      const it = mn.type === "module"
        ? { title: mn.label, sub: "메뉴로 이동", icon: mn.icon || "▪", route: mn.module }
        : { title: mn.label, sub: mn.open === "frame" ? "내부 화면으로 열기" : "새 탭으로 열기",
            icon: mn.icon || "🔗", text: [mn.label, mn.url],
            route: mn.open === "frame" ? "embed/" + mn.id : "", url: mn.open === "frame" ? "" : mn.url };
      const sc = scoreOf(it, ts);
      if (sc) menuHits.push(Object.assign({ group: "메뉴 · 링크", score: sc }, it));
    });
    menuHits.sort((a, b) => b.score - a.score);
    out.push.apply(out, menuHits.slice(0, PER_GROUP));

    /* 2) 데이터 프로바이더 */
    providers.forEach(p => {
      if (!canUseProvider(p)) return;
      let items = [];
      try { items = p.items() || []; } catch (e) { items = []; }
      const hits = [];
      items.forEach(it => {
        if (!it || !it.title) return;
        const sc = scoreOf(it, ts);
        if (sc) hits.push(Object.assign({
          group: p.group, icon: it.icon || p.icon || "▪", score: sc,
          route: it.route != null ? it.route : (p.module || "dashboard")
        }, it));
      });
      hits.sort((a, b) => b.score - a.score);
      out.push.apply(out, hits.slice(0, PER_GROUP));
    });
    return out.slice(0, TOTAL_MAX);
  }

  /* ─────── 기본 프로바이더 (현행 전 모듈) ─────── */
  const A = (v) => Array.isArray(v) ? v : [];

  register({ id: "notices", group: "공지사항", icon: "📢", module: "dashboard",
    items: () => A(D().notices).map(n => ({
      title: n.title, sub: n.body, text: [n.title, n.body, n.author], route: "dashboard" })) });

  register({ id: "levels", group: "항공보안등급", icon: "🚨", module: "dashboard",
    items: () => A(D().levelHistory).map(e => ({
      title: "[" + e.level + "] " + (e.date || ""), sub: e.note || "",
      text: [e.level, e.note, e.date], route: "dashboard" })) });

  register({ id: "schedules", group: "일정관리", icon: "📅", module: "schedule",
    items: () => A(D().schedules).map(s => ({
      title: s.title, sub: [s.start + (s.end && s.end !== s.start ? "~" + s.end : ""), s.assignee, s.memo].filter(Boolean).join(" · "),
      text: [s.title, s.memo, s.assignee] })) });

  register({ id: "inspections", group: "보안점검", icon: "🕵️", module: "inspection",
    items: () => A(D().inspections).map(x => ({
      title: "[" + x.category + "] " + x.target,
      sub: [x.year + "년 " + x.month + "월", x.status, A(x.inspectors).join(", ")].filter(Boolean).join(" · "),
      text: [x.category, x.target, x.note, x.status, A(x.inspectors), A(x.findings)] })) });

  register({ id: "contacts", group: "보고체계 연락망", icon: "☎️", module: "contacts",
    items: () => {
      const outc = [];
      const secsArr = (D().contacts && A(D().contacts.sections)) || [];
      secsArr.forEach(sec => A(sec.rows).forEach(r => {
        if (sec.type === "people") outc.push({
          title: (r.name || "") + (r.role ? " · " + r.role : ""),
          sub: [r.mobile, r.office, r.duty].filter(Boolean).join(" · "),
          text: [r.name, r.role, r.mobile, r.office, r.duty, r.note, sec.title] });
        else if (sec.type === "emails") outc.push({
          title: r.name || r.email || "", sub: r.email || "", text: [r.name, r.email, sec.title] });
        else if (sec.type === "procedure") outc.push({
          title: r.title || sec.title || "", sub: r.body || "", text: [r.title, r.body, sec.title] });
        else outc.push({
          title: r.items || sec.title || "", sub: r.to || "", text: [r.no, r.items, r.to, sec.title] });
      }));
      return outc;
    } });

  register({ id: "branches", group: "지점", icon: "🌍", module: "branches",
    items: () => A(D().branches).map(b => ({
      title: (b.code || "") + (b.iata ? " (" + b.iata + ")" : ""),
      sub: [b.region, b.manager, b.security].filter(Boolean).join(" · "),
      text: [b.code, b.iata, b.region, b.manager, b.security, b.hotel, b.mechanic, b.note,
             A(b.extras).map(x => (x.label || "") + " " + (x.value || ""))] })) });

  register({ id: "passes", group: "출입증", icon: "🪪", module: "passes",
    items: () => A(D().passes).map(p => ({
      title: p.holder, sub: [p.company, p.kind, p.status].filter(Boolean).join(" · "),
      text: [p.holder, p.company, p.no, p.area, p.status, p.note] })) });

  register({ id: "equipment", group: "보안장비", icon: "🔧", module: "equipment",
    items: () => A(D().equipment).map(x => ({
      title: x.name, sub: [x.type, x.location, x.serial].filter(Boolean).join(" · "),
      text: [x.name, x.type, x.serial, x.location, x.vendor, x.cert, x.status, x.note,
             A(x.logs).map(l => (l.kind || "") + " " + (l.text || ""))] })) });

  /* 유지보수 계약·비용 — 대외비: 장비 메뉴 접근 + hq 이상 이중 게이트 */
  register({ id: "equipMaint", group: "장비 유지보수 (대외비)", icon: "🧰", module: "equipment", minRank: 3,
    items: () => {
      const m = D().equipMaint || {};
      return A(m.contracts).map(c => ({
        title: "유지보수 계약 · " + (c.vendor || ""), sub: [c.scope, c.terms].filter(Boolean).join(" · "),
        text: [c.vendor, c.scope, c.terms, c.note] }))
      .concat(A(m.costs).map(c => ({
        title: "유지보수 비용 · " + (c.ym || "") + (c.vendor ? " " + c.vendor : ""),
        sub: [c.kind, c.serial, c.memo].filter(Boolean).join(" · "),
        text: [c.ym, c.kind, c.vendor, c.serial, c.memo] })));
    } });

  register({ id: "trainings", group: "보안교육", icon: "🎓", module: "training",
    items: () => A(D().trainings).map(t => ({
      title: t.course, sub: [t.year + "년", t.target, t.status].filter(Boolean).join(" · "),
      text: [t.course, t.target, t.type, t.method, t.status, t.note] })) });

  register({ id: "certs", group: "교육 이수증", icon: "🎖", module: "certs",
    items: () => A(D().certs).map(c => ({
      title: c.name, sub: [c.role, c.org, c.expire ? "~" + c.expire : ""].filter(Boolean).join(" · "),
      text: [c.name, c.dept, c.role, c.org, c.certNo, c.note] })) });

  register({ id: "contracts", group: "계약서 (대외비)", icon: "💼", module: "contracts-mgmt", minRank: 3,
    items: () => A(D().contracts).map(c => ({
      title: c.name, sub: [c.party, c.status, c.end ? "~" + c.end : ""].filter(Boolean).join(" · "),
      text: [c.name, c.party, c.category, c.owner, c.amount, c.note] })) });

  const regItems = (scope) => A(D().regulations).filter(r => r && r.scope === scope).map(r => ({
    title: r.title, sub: [r.rev, r.org, r.date].filter(Boolean).join(" · "),
    text: [r.title, r.rev, r.org, r.note, r.fileName, A(r.ideas).map(i => i.text || i.body || "")] }));
  register({ id: "regs-intl", group: "국제/국가 보안규정", icon: "🌐", module: "regs-intl",
    items: () => regItems("intl") });
  register({ id: "regs-own", group: "자체 보안규정", icon: "📘", module: "regs-own",
    items: () => regItems("own") });

  register({ id: "billing", group: "대금 청구 (대외비)", icon: "🧾", module: "billing", minRank: 3,
    items: () => A(D().billing).map(b => ({
      title: "[" + (b.month || "") + "] " + (b.title || ""),
      sub: [b.vendor, b.category, b.amount ? Number(b.amount).toLocaleString() + "원" : ""].filter(Boolean).join(" · "),
      text: [b.vendor, b.title, b.category, b.note, b.month] })) });
  /* vault(암호 관리)는 암호문만 저장 — 검색 대상에서 의도적으로 제외 */

  /* ─────── UI ─────── */
  let pop = null, input = null, wrap = null, items = [], active = -1;

  function goItem(it) {
    closePop();
    if (input) input.blur();
    document.querySelector(".header").classList.remove("search-open");
    if (it.url) { window.open(it.url, "_blank", "noopener"); return; }
    if (it.route) S().navigate(it.route);
  }

  function closePop() {
    if (pop) pop.classList.add("hidden");
    active = -1;
  }

  function renderPop(q) {
    if (!pop) return;
    const u = S().user;
    if (!u || u.role === "vendor") { closePop(); return; }
    const ts = terms(q);
    if (!ts.length) { closePop(); return; }
    items = search(q);
    active = -1;
    if (!items.length) {
      pop.innerHTML = '<div class="sp-empty">"' + esc(q.trim()) + '" 검색 결과가 없습니다.</div>';
      pop.classList.remove("hidden");
      return;
    }
    let html = "", lastGroup = null;
    items.forEach((it, i) => {
      if (it.group !== lastGroup) {
        html += '<div class="sp-group">' + esc(it.group) + "</div>";
        lastGroup = it.group;
      }
      html += '<button type="button" class="sp-item" data-i="' + i + '">' +
        '<span class="sp-ico">' + esc(it.icon || "▪") + "</span>" +
        '<span class="sp-txt"><span class="sp-title">' + hl(it.title, ts) + "</span>" +
        (it.sub ? '<span class="sp-sub">' + hl(snip(it.sub, ts), ts) + "</span>" : "") +
        "</span></button>";
    });
    pop.innerHTML = html;
    pop.classList.remove("hidden");
    Array.prototype.forEach.call(pop.querySelectorAll(".sp-item"), el => {
      el.onclick = () => goItem(items[Number(el.dataset.i)]);
    });
  }

  function setActive(n) {
    const els = pop ? pop.querySelectorAll(".sp-item") : [];
    if (!els.length) return;
    active = (n + els.length) % els.length;
    Array.prototype.forEach.call(els, (el, i) => el.classList.toggle("active", i === active));
    els[active].scrollIntoView({ block: "nearest" });
  }

  let debTimer = null;
  function init() {
    wrap = document.getElementById("hdr-search-wrap");
    input = document.getElementById("hdr-search");
    pop = document.getElementById("hdr-search-pop");
    if (!wrap || !input || !pop) return;

    input.addEventListener("input", () => {
      clearTimeout(debTimer);
      debTimer = setTimeout(() => renderPop(input.value), 120);
    });
    input.addEventListener("focus", () => { if (input.value.trim()) renderPop(input.value); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (active >= 0 && items[active]) goItem(items[active]);
        else if (items.length) goItem(items[0]);
      } else if (e.key === "Escape") { closePop(); input.blur(); }
    });

    // 바깥 클릭 시 닫기
    document.addEventListener("click", (e) => {
      if (wrap && !wrap.contains(e.target) && e.target.id !== "hdr-search-btn") closePop();
    });

    // 단축키: Ctrl/Cmd+K 또는 "/" (입력 중이 아닐 때)
    document.addEventListener("keydown", (e) => {
      const u = S().user;
      if (!u || u.role === "vendor") return;
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "") ||
        (e.target && e.target.isContentEditable);
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (!inField && e.key === "/")) {
        e.preventDefault();
        document.querySelector(".header").classList.add("search-open");
        input.focus(); input.select();
      }
    });

    // 모바일: 🔍 버튼으로 검색바 토글
    const btn = document.getElementById("hdr-search-btn");
    if (btn) btn.addEventListener("click", () => {
      const h = document.querySelector(".header");
      h.classList.toggle("search-open");
      if (h.classList.contains("search-open")) { input.focus(); }
      else closePop();
    });
  }

  return { init, search, register, terms };
})();

if (typeof window !== "undefined") window.SemisSearch = SemisSearch;
