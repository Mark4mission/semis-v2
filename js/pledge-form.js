/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 보안서약서 작성 화면 (pledge.html, v2.55)
   QR · 링크로 열어 로그인 없이 작성 · 제출한다.
   제출: RPC semis_v2_pledge_submit (작업증명 · IP별 시도 제한 · 서버 검증 · 같은 날 중복 차단)
   서명은 PNG(투명 배경, 가로 600px)로 보낸다. 서버는 비공개 표에만 저장한다.
   ═══════════════════════════════════════════════════════ */
"use strict";

(function () {
  const SUPA_URL = "https://mzyuzrxkdcpzxojenwat.supabase.co";
  // anon(publishable) key — 공개용 키. 이 화면이 부를 수 있는 것은 제출 RPC 와 작업증명 문제뿐이다.
  const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eXV6cnhrZGNwenhvamVud2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTQ1MTYsImV4cCI6MjA5OTY5MDUxNn0.YqcCnEY8Bn-Bc2cbUHWl4m9GLMIifZbH5KqrbamU0YI";
  const LS_LANG = "semis-pledge-lang";
  const T = (window.SemisPledgeText && window.SemisPledgeText.TEXT) || {};

  const UI = {
    ko: {
      hPledge: "서약 내용", hInfo: "정보 입력", hSign: "서명", date: "서약일", dept: "소속", position: "직위",
      empId: "사번 (직원이 아니면 생년월일)", name: "성명", clear: "지우기", submit: "제출하기",
      signHint: "이 칸에 손가락이나 마우스로 서명하세요",
      ph: { dept: "예: 영업운송본부 인천화물팀", position: "예: 프로", empId: "예: 100000 또는 1990-01-01", name: "예: 홍길동" },
      busy: "등록 중입니다", doneT: "제출되었습니다", doneM: "이 화면을 닫아도 됩니다.", again: "다른 사람 작성",
      rName: "성명", rAt: "제출 시각", rNo: "접수 번호",
      e: {
        agree: "모든 조항에 동의해 주세요.", field: "입력하지 않은 칸이 있습니다.", sign: "서명해 주세요.",
        emp: "사번(또는 생년월일)을 숫자로 입력해 주세요.", too_long: "입력한 내용이 너무 깁니다.",
        dup: "오늘 같은 사번으로 제출된 서약서가 이미 있습니다 ({at}).",
        limit: "잠시 후 다시 시도해 주세요 ({w}분).", busy: "접속이 많습니다. 잠시 후 다시 시도해 주세요.",
        pow: "보안 확인에 실패했습니다. 다시 제출해 주세요.", net: "서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 제출해 주세요.",
        other: "제출하지 못했습니다. 다시 시도해 주세요."
      }
    },
    en: {
      hPledge: "Pledge", hInfo: "Information", hSign: "Signature", date: "Date", dept: "Department / Affiliation",
      position: "Position / Title", empId: "Employee ID (if not, date of birth)", name: "Full name", clear: "Clear", submit: "Submit",
      signHint: "Sign here with your finger or mouse",
      ph: { dept: "e.g. Cargo Operations", position: "e.g. Manager", empId: "e.g. 700100 or 1990-01-01", name: "e.g. John Doe" },
      busy: "Submitting", doneT: "Submitted", doneM: "You may close this window.", again: "New pledge",
      rName: "Name", rAt: "Submitted at", rNo: "Receipt no.",
      e: {
        agree: "Please agree to all clauses.", field: "Please fill in all fields.", sign: "Please sign in the box.",
        emp: "Please enter your employee ID (or date of birth) in digits.", too_long: "Some entries are too long.",
        dup: "A pledge with this employee ID was already submitted today ({at}).",
        limit: "Please try again later ({w} min).", busy: "The server is busy. Please try again shortly.",
        pow: "Security check failed. Please submit again.", net: "Could not reach the server. Check your connection and submit again.",
        other: "Submission failed. Please try again."
      }
    }
  };

  const $ = (s) => document.querySelector(s);
  let lang = "ko";
  let sending = false;

  function pickLang() {
    const q = /[?&]lang=(ko|en)\b/i.exec(location.search || "");
    if (q) return q[1].toLowerCase();
    try { const s = localStorage.getItem(LS_LANG); if (s === "ko" || s === "en") return s; } catch (e) { /* 저장소 없음 */ }
    return /^ko\b/i.test(navigator.language || "") ? "ko" : "en";
  }
  function today() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /* ─── 문구 ─── */
  function paint() {
    const u = UI[lang], t = T[lang] || T.ko || { clauses: [] };
    document.documentElement.lang = lang;
    document.title = lang === "ko" ? "보안서약서 · Security Pledge Agreement" : "Security Pledge Agreement · 보안서약서";
    $("#pf-title").textContent = t.title || "";
    $("#pf-sub").textContent = t.sub || "";
    $("#pf-lead").textContent = t.lead || "";
    $("#pf-all-t").textContent = t.agreeAll || "";
    $("#pf-to").textContent = t.to || "";
    document.querySelectorAll("[data-i18n]").forEach(el => { const v = u[el.getAttribute("data-i18n")]; if (typeof v === "string") el.textContent = v; });
    $("#pf-dept").placeholder = u.ph.dept; $("#pf-position").placeholder = u.ph.position;
    $("#pf-emp").placeholder = u.ph.empId; $("#pf-name").placeholder = u.ph.name;
    $("#pf-busy-t").textContent = u.busy;
    $("#pf-done-t").textContent = u.doneT; $("#pf-done-m").textContent = u.doneM;
    const again = $("#pf-again"); if (again) again.textContent = u.again;
    $("#pf-canvas").setAttribute("aria-label", u.hSign);
    document.querySelectorAll(".pf-lang button").forEach(b => b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === lang)));
    const ol = $("#pf-clauses");
    const was = Array.from(ol.querySelectorAll("input")).map(i => i.checked);
    ol.innerHTML = "";
    (t.clauses || []).forEach((c, i) => {
      const li = document.createElement("li");
      const lab = document.createElement("label");
      lab.className = "pf-clause" + (was[i] ? " on" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = !!was[i]; cb.setAttribute("data-c", String(i));
      const box = document.createElement("div");
      const b = document.createElement("b"); b.textContent = c[0];
      const s = document.createElement("span"); s.textContent = c[1];
      box.appendChild(b); box.appendChild(s);
      lab.appendChild(cb); lab.appendChild(box); li.appendChild(lab); ol.appendChild(li);
      cb.addEventListener("change", syncAll);
    });
    if ($("#pf-err").textContent) $("#pf-err").textContent = "";
  }
  function clauseBoxes() { return Array.from(document.querySelectorAll("#pf-clauses input")); }
  function syncAll() {
    const cbs = clauseBoxes();
    cbs.forEach(cb => cb.closest(".pf-clause").classList.toggle("on", cb.checked));
    $("#pf-all").checked = cbs.length > 0 && cbs.every(cb => cb.checked);
  }
  function setLang(l) {
    lang = l === "en" ? "en" : "ko";
    try { localStorage.setItem(LS_LANG, lang); } catch (e) { /* 저장소 없음 */ }
    paint();
  }

  /* ─── 서명 패드 (CSS 픽셀 좌표로 획을 기억 → 크기가 바뀌어도 다시 그림) ─── */
  const pad = { strokes: [], cur: null, w: 0, h: 0, ratio: 1 };
  function fitCanvas() {
    const c = $("#pf-canvas"), box = $("#pf-pad");
    const r = box.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    if (pad.w && (Math.abs(r.width - pad.w) > 1 || Math.abs(r.height - pad.h) > 1)) {
      const sx = r.width / pad.w, sy = r.height / pad.h;
      pad.strokes.forEach(st => st.forEach(p => { p.x *= sx; p.y *= sy; }));
    }
    pad.w = r.width; pad.h = r.height; pad.ratio = ratio;
    c.width = Math.round(r.width * ratio); c.height = Math.round(r.height * ratio);
    redraw();
  }
  function drawStroke(ctx, st, k, lw) {
    if (!st.length) return;
    ctx.lineWidth = lw; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0b1320";
    ctx.beginPath();
    if (st.length === 1) { ctx.arc(st[0].x * k, st[0].y * k, lw / 2, 0, Math.PI * 2); ctx.fillStyle = "#0b1320"; ctx.fill(); return; }
    ctx.moveTo(st[0].x * k, st[0].y * k);
    for (let i = 1; i < st.length - 1; i++) {
      const mx = (st[i].x + st[i + 1].x) / 2, my = (st[i].y + st[i + 1].y) / 2;
      ctx.quadraticCurveTo(st[i].x * k, st[i].y * k, mx * k, my * k);
    }
    const last = st[st.length - 1];
    ctx.lineTo(last.x * k, last.y * k);
    ctx.stroke();
  }
  function redraw() {
    const c = $("#pf-canvas"), ctx = c.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    pad.strokes.forEach(st => drawStroke(ctx, st, pad.ratio, 2.6 * pad.ratio));
    $("#pf-pad").classList.toggle("inked", pad.strokes.length > 0);
  }
  function inkLength() {
    let n = 0;
    pad.strokes.forEach(st => { for (let i = 1; i < st.length; i++) n += Math.hypot(st[i].x - st[i - 1].x, st[i].y - st[i - 1].y); });
    return n;
  }
  function signed() { return inkLength() >= 24; }
  function bindPad() {
    const c = $("#pf-canvas");
    const pos = (ev) => { const r = c.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    c.addEventListener("pointerdown", (ev) => {
      if (ev.button !== undefined && ev.button > 0) return;
      ev.preventDefault();
      try { c.setPointerCapture(ev.pointerId); } catch (e) { /* 무시 */ }
      pad.cur = [pos(ev)];
      pad.strokes.push(pad.cur);
      $("#pf-pad").classList.remove("bad");
      redraw();
    });
    c.addEventListener("pointermove", (ev) => {
      if (!pad.cur) return;
      ev.preventDefault();
      const evs = typeof ev.getCoalescedEvents === "function" ? ev.getCoalescedEvents() : [ev];
      (evs.length ? evs : [ev]).forEach(e2 => {
        const p = pos(e2), q = pad.cur[pad.cur.length - 1];
        if (Math.hypot(p.x - q.x, p.y - q.y) >= 1.2) pad.cur.push(p);
      });
      redraw();
    });
    const end = () => { pad.cur = null; };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("lostpointercapture", end);
    $("#pf-clear").addEventListener("click", () => { pad.strokes = []; pad.cur = null; redraw(); });
    let rt = 0;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(fitCanvas, 120); });
  }
  /* 가로 600px PNG(투명 배경) — 화면 비율 유지 */
  function signPng() {
    const W = 600, H = Math.max(150, Math.round(600 * pad.h / Math.max(pad.w, 1)));
    const k = W / pad.w;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    pad.strokes.forEach(st => drawStroke(ctx, st, k, Math.max(2.4, 2.6 * k)));
    return c.toDataURL("image/png");
  }

  /* ─── 제출 ─── */
  function hdr() { return { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY, "Content-Type": "application/json" }; }
  async function rpc(name, body) {
    const res = await fetch(SUPA_URL + "/rest/v1/rpc/" + name, { method: "POST", headers: hdr(), body: JSON.stringify(body || {}) });
    if (!res.ok) { const e = new Error("http " + res.status); e.status = res.status; throw e; }
    return res.json();
  }
  async function proof() {
    const ch = await rpc("semis_v2_challenge", {});
    if (!ch || !ch.ok || !ch.c) throw new Error("challenge");
    const x = await window.SemisPow.solve(String(ch.c), Number(ch.d) || 16);
    return { c: String(ch.c), x: String(x) };
  }
  function values() {
    return {
      dept: $("#pf-dept").value.trim(), position: $("#pf-position").value.trim(),
      empId: $("#pf-emp").value.trim(), name: $("#pf-name").value.trim()
    };
  }
  function showErr(msg) { $("#pf-err").textContent = msg || ""; }
  function errText(d) {
    const e = UI[lang].e, code = String((d && d.error) || "");
    if (code === "dup") return e.dup.replace("{at}", d.at || "");
    if (code === "limit") return e.limit.replace("{w}", String(d.wait || 10));
    if (/^pow/.test(code)) return e.pow;
    return e[code] || e.other;
  }
  function validate(v) {
    const u = UI[lang].e;
    ["#pf-dept", "#pf-position", "#pf-emp", "#pf-name"].forEach(s => $(s).removeAttribute("aria-invalid"));
    if (!clauseBoxes().every(cb => cb.checked)) { $("#pf-all").focus(); return u.agree; }
    const miss = [["#pf-dept", v.dept], ["#pf-position", v.position], ["#pf-emp", v.empId], ["#pf-name", v.name]].filter(x => !x[1]);
    if (miss.length) { miss.forEach(x => $(x[0]).setAttribute("aria-invalid", "true")); $(miss[0][0]).focus(); return u.field; }
    if (!/[0-9A-Za-z]/.test(v.empId)) { $("#pf-emp").setAttribute("aria-invalid", "true"); $("#pf-emp").focus(); return u.emp; }
    if (!signed()) { $("#pf-pad").classList.add("bad"); $("#pf-pad").scrollIntoView({ block: "center", behavior: "smooth" }); return u.sign; }
    return "";
  }
  async function submit(ev) {
    if (ev) ev.preventDefault();
    if (sending) return;
    const v = values();
    const bad = validate(v);
    if (bad) { showErr(bad); return; }
    showErr("");
    sending = true;
    $("#pf-submit").disabled = true;
    $("#pf-busy").classList.remove("hidden");
    let d = null;
    try {
      const body = { p: { name: v.name, dept: v.dept, position: v.position, empId: v.empId, lang, agreed: true, sign: signPng() } };
      for (let i = 0; i < 2; i++) {
        body.p_pow = await proof();
        d = await rpc("semis_v2_pledge_submit", body);
        if (!(d && /^pow/.test(String(d.error || "")))) break;
      }
    } catch (e) { d = { ok: false, error: "net" }; }
    sending = false;
    $("#pf-submit").disabled = false;
    $("#pf-busy").classList.add("hidden");
    if (d && d.ok) { done(v, d); return; }
    showErr(errText(d));
  }
  function done(v, d) {
    $("#pf-form").classList.add("hidden");
    $("#pf-r-name").textContent = v.name;
    $("#pf-r-at").textContent = d.at || "";
    $("#pf-r-no").textContent = d.receipt || "";
    $("#pf-done").classList.remove("hidden");
    window.scrollTo(0, 0);
  }
  function reset() {
    $("#pf-form").reset();
    clauseBoxes().forEach(cb => { cb.checked = false; });
    syncAll();
    pad.strokes = []; redraw();
    showErr("");
    $("#pf-done").classList.add("hidden");
    $("#pf-form").classList.remove("hidden");
    $("#pf-date").textContent = today();
    window.scrollTo(0, 0);
  }

  function init() {
    lang = pickLang();
    $("#pf-date").textContent = today();
    paint();
    $("#pf-all").addEventListener("change", (e) => { clauseBoxes().forEach(cb => { cb.checked = e.target.checked; }); syncAll(); });
    document.querySelectorAll(".pf-lang button").forEach(b => b.addEventListener("click", () => setLang(b.getAttribute("data-lang"))));
    $("#pf-form").addEventListener("submit", submit);
    const again = document.createElement("button");
    again.type = "button"; again.id = "pf-again"; again.className = "pf-btn-ghost"; again.textContent = UI[lang].again;
    again.addEventListener("click", reset);
    $("#pf-done").appendChild(again);
    bindPad();
    fitCanvas();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.SemisPledgeForm = { values, signed, signPng, pad, setLang, submit, _ui: UI };
})();
