/* ═══════════════════════════════════════════════════════
   SeMIS v2 — CARES 환경센서 대시보드 위젯 (v2.4)
   CARES(airzeta-security-system, Firebase/Firestore)의 환경센서 데이터를
   REST API로 조회하여 임계치 초과 항목과 추이 그래프를 표시.

   - CARES Firestore 규칙상 읽기에 인증 필요 → CARES 계정으로 REST 로그인
   - 계정 정보는 이 브라우저의 localStorage에만 저장 (공용 DB 미동기화)
   - 컬렉션: sensorLogs(1분 주기), sensorThresholds/{deviceId}, alarmHistory
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal } = SeMIS;

  const API_KEY = "AIzaSyC1WRvtCRCkQbsPQ28Zjrr16kfdPIrZeYo"; // CARES 웹앱 공개 설정값
  const PROJECT = "airzeta-security-system";
  const FS_DOCS = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents";
  const DEVICE = { id: "ICN_CARGO_B", name: "인천 화물터미널 B동" };
  const CFG_KEY = "semis2:cares"; // 기기 로컬 전용 (동기화 안 함)

  const METRICS = [
    { key: "temp",     label: "온도",   unit: "°C",    dec: 1 },
    { key: "humidity", label: "습도",   unit: "%",     dec: 0 },
    { key: "co2",      label: "CO₂",    unit: "ppm",   dec: 0 },
    { key: "pm25",     label: "PM2.5",  unit: "㎍/㎥", dec: 0 },
    { key: "pm10",     label: "PM10",   unit: "㎍/㎥", dec: 0 },
    { key: "pm1",      label: "PM1.0",  unit: "㎍/㎥", dec: 0 },
    { key: "tvoc",     label: "TVOC",   unit: "mg/㎥", dec: 3 },
    { key: "hcho",     label: "HCHO",   unit: "mg/㎥", dec: 3 }
  ];
  // CARES DEFAULT_THRESHOLDS와 동일
  const DEFAULT_TH = {
    temp: { min: 0, max: 40 }, humidity: { min: 20, max: 80 },
    co2: { min: null, max: 1500 }, pm25: { min: null, max: 35 },
    pm10: { min: null, max: 75 }, pm1: { min: null, max: null },
    tvoc: { min: null, max: 0.3 }, hcho: { min: null, max: 0.1 }
  };

  function cfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; }
  }
  function setCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }

  /* ─────── Firebase Auth (REST) ─────── */
  let authState = { token: null, exp: 0 };
  async function ensureToken() {
    if (authState.token && Date.now() < authState.exp - 60000) return authState.token;
    const c = cfg();
    if (!c.email || !c.pw) throw new Error("계정 미설정");
    const res = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + API_KEY, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: c.email, password: c.pw, returnSecureToken: true })
    });
    if (!res.ok) throw new Error("로그인 실패 (" + res.status + ")");
    const j = await res.json();
    authState = { token: j.idToken, exp: Date.now() + (Number(j.expiresIn) || 3600) * 1000 };
    return authState.token;
  }

  /* ─────── Firestore REST 값 파서 ─────── */
  function parseFs(v) {
    if (v == null || typeof v !== "object") return null;
    if ("doubleValue" in v) return Number(v.doubleValue);
    if ("integerValue" in v) return Number(v.integerValue);
    if ("stringValue" in v) return v.stringValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("nullValue" in v) return null;
    if ("mapValue" in v) {
      const out = {};
      const f = (v.mapValue && v.mapValue.fields) || {};
      Object.keys(f).forEach(k => { out[k] = parseFs(f[k]); });
      return out;
    }
    if ("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(parseFs);
    return null;
  }
  const docToObj = (fields) => parseFs({ mapValue: { fields: fields || {} } });

  async function runQuery(body) {
    const token = await ensureToken();
    const res = await fetch(FS_DOCS + ":runQuery", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error("조회 실패 (" + res.status + ")");
    const rows = await res.json();
    return rows.filter(r => r.document).map(r => docToObj(r.document.fields));
  }

  async function fetchReadings(n) {
    return (await runQuery({ structuredQuery: {
      from: [{ collectionId: "sensorLogs" }],
      orderBy: [{ field: { fieldPath: "timestamp" }, direction: "DESCENDING" }],
      limit: n || 120
    } })).reverse(); // 시간 오름차순
  }
  async function fetchThresholds() {
    try {
      const token = await ensureToken();
      const res = await fetch(FS_DOCS + "/sensorThresholds/" + DEVICE.id, {
        headers: { Authorization: "Bearer " + token }
      });
      if (!res.ok) return DEFAULT_TH;
      const j = await res.json();
      const th = docToObj(j.fields);
      const out = {};
      METRICS.forEach(m => { out[m.key] = Object.assign({}, DEFAULT_TH[m.key], th[m.key] || {}); });
      return out;
    } catch (e) { return DEFAULT_TH; }
  }
  async function fetchAlarms() {
    try {
      return await runQuery({ structuredQuery: {
        from: [{ collectionId: "alarmHistory" }],
        orderBy: [{ field: { fieldPath: "startedAt" }, direction: "DESCENDING" }],
        limit: 30
      } });
    } catch (e) { return []; }
  }

  /* ─────── 임계치 판정 / 스파크라인 ─────── */
  function isExceed(val, th) {
    if (val == null || !th) return false;
    if (th.max != null && val > th.max) return true;
    if (th.min != null && val < th.min) return true;
    return false;
  }
  function sparkSVG(values, th) {
    const vs = values.filter(v => v != null);
    if (vs.length < 2) return "";
    let mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
    if (th && th.max != null) mx = Math.max(mx, th.max);
    if (th && th.min != null) mn = Math.min(mn, th.min);
    if (mx === mn) { mx += 1; mn -= 1; }
    const W = 110, H = 30, pad = 2;
    const xy = (v, i) => ((i / (values.length - 1)) * (W - pad * 2) + pad).toFixed(1) + "," +
      ((H - pad) - ((v - mn) / (mx - mn)) * (H - pad * 2)).toFixed(1);
    const pts = values.map((v, i) => v == null ? null : xy(v, i)).filter(Boolean).join(" ");
    const thLine = (t) => t == null ? "" :
      `<line x1="0" x2="${W}" y1="${((H - pad) - ((t - mn) / (mx - mn)) * (H - pad * 2)).toFixed(1)}" y2="${((H - pad) - ((t - mn) / (mx - mn)) * (H - pad * 2)).toFixed(1)}" stroke="#dc2626" stroke-width="1" stroke-dasharray="3,2" opacity=".6"/>`;
    return `<svg class="cares-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${th ? thLine(th.max) + thLine(th.min) : ""}
      <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }

  /* ─────── 위젯 렌더 ─────── */
  let refreshTimer = null;
  async function renderInto(box, canWrite) {
    const c = cfg();
    if (!c.enabled || !c.email || !c.pw) {
      box.innerHTML = `<div class="empty" style="padding:20px 10px">CARES 연동이 설정되지 않았습니다.${canWrite ? "<br>우측 상단 ⚙ 버튼에서 CARES 계정을 연결하세요." : ""}</div>`;
      return false;
    }
    box.innerHTML = '<div class="empty" style="padding:20px 10px">환경센서 데이터를 불러오는 중…</div>';
    try {
      const [readings, th, alarms] = await Promise.all([fetchReadings(120), fetchThresholds(), fetchAlarms()]);
      if (!document.body.contains(box)) return false; // 화면 이탈
      if (!readings.length) { box.innerHTML = '<div class="empty">센서 데이터가 없습니다.</div>'; return false; }
      const last = readings[readings.length - 1];
      const lastTs = last.timestamp ? new Date(last.timestamp).toLocaleString("ko-KR") : "-";
      const exceeded = METRICS.filter(m => isExceed(last[m.key], th[m.key]));
      const active = alarms.filter(a => !a.endedAt);

      box.innerHTML = `
        <div class="cares-head">
          <span class="badge ${exceeded.length ? "badge-red" : "badge-green"}">${exceeded.length ? "⚠ 임계치 초과 " + exceeded.length + "건" : "✓ 전체 정상"}</span>
          <span style="font-size:.76rem;color:var(--text-3)">${esc(DEVICE.name)} · ${esc(lastTs)}</span>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" id="cares-refresh">↻</button>
        </div>
        ${active.length ? `<div class="cares-alarms">${active.map(a => `
          <div class="cares-alarm">🔴 <b>${esc(a.metricLabel || a.metric)}</b>
            ${a.type === "max" ? "상한" : "하한"} ${esc(String(a.threshold))}${esc(a.unit || "")} 초과 진행 중
            <span style="color:var(--text-3)">(최고 ${esc(String(a.peakValue))}${esc(a.unit || "")})</span></div>`).join("")}</div>` : ""}
        <div class="cares-grid">
          ${METRICS.map(m => {
            const v = last[m.key];
            const ex = isExceed(v, th[m.key]);
            const series = readings.map(r => (typeof r[m.key] === "number" ? r[m.key] : null));
            return `<div class="cares-cell${ex ? " exceed" : ""}">
              <div class="cares-label">${esc(m.label)}${ex ? " ⚠" : ""}</div>
              <div class="cares-value">${v == null ? "-" : esc(v.toFixed(m.dec))}<span class="cares-unit">${esc(m.unit)}</span></div>
              ${sparkSVG(series, th[m.key])}
            </div>`;
          }).join("")}
        </div>
        <div class="form-hint" style="margin-top:6px">최근 2시간 추이 · 점선=임계값 · 1분마다 자동 갱신</div>`;
      $("#cares-refresh", box).onclick = () => renderInto(box, canWrite);

      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(() => {
        const el = document.getElementById("cares-box");
        if (!el) { clearInterval(refreshTimer); refreshTimer = null; return; }
        renderInto(el, canWrite);
      }, 60000);
      return true;
    } catch (e) {
      if (document.body.contains(box)) box.innerHTML =
        `<div class="empty" style="padding:16px 10px">⚠ CARES 연결 실패 — ${esc(e.message || "네트워크 오류")}<br>
        <button class="btn btn-ghost btn-sm" id="cares-retry" style="margin-top:8px">다시 시도</button></div>`;
      const rt = box.querySelector("#cares-retry");
      if (rt) rt.onclick = () => renderInto(box, canWrite);
      return false;
    }
  }

  /* ─────── 연동 설정 (계정은 이 기기에만 저장) ─────── */
  function settingsForm() {
    const c = cfg();
    openModal(`
      <h3>🌡 CARES 환경센서 연동</h3>
      <div class="form-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="c-enabled" style="width:auto" ${c.enabled ? "checked" : ""}> 대시보드에 환경센서 표시</label></div>
      <div class="form-row"><label>CARES 계정 이메일</label>
        <input id="c-email" type="email" value="${esc(c.email || "")}" placeholder="viewer@airzeta.com"></div>
      <div class="form-row"><label>암호</label>
        <input id="c-pw" type="password" value="${esc(c.pw || "")}" autocomplete="new-password">
        <div class="form-hint">CARES(airzeta-security-system) 로그인 계정입니다. 조회 전용 계정 사용을 권장합니다.
        계정 정보는 <b>이 브라우저에만</b> 저장되며 공용 DB로 동기화되지 않습니다. (기기마다 1회 설정)</div></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="c-cancel">취소</button>
        <button class="btn btn-primary" id="c-save">저장 후 연결 테스트</button>
      </div>`);
    $("#c-cancel").onclick = closeModal;
    $("#c-save").onclick = async () => {
      setCfg({ enabled: $("#c-enabled").checked, email: $("#c-email").value.trim(), pw: $("#c-pw").value });
      authState = { token: null, exp: 0 };
      closeModal();
      if ($("#c-enabled") && !cfg().enabled) { SeMIS.renderView(); return; }
      try { await ensureToken(); toast("CARES 연결 성공"); }
      catch (e) { toast("연결 실패: " + (e.message || ""), true); }
      SeMIS.renderView();
    };
  }

  window.SemisCares = {
    renderInto, settingsForm,
    parseFs, docToObj, isExceed, sparkSVG,
    METRICS, DEFAULT_TH, DEVICE,
    cfg, setCfg
  };
})();
