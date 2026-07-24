/* ═══════════════════════════════════════════════════════
   SeMIS v2 — CARES 환경센서 대시보드 위젯 (v2.4)
   CARES(airzeta-security-system, Firebase/Firestore)의 환경센서 데이터를
   REST API로 조회하여 임계치 초과 항목과 추이 그래프를 표시.

   - 센서 컬렉션(sensorLogs/sensorThresholds/alarmHistory)은 공개 읽기 규칙
     (2026-07-16 배포)이라 무인증 REST 조회 — 계정 불필요
   - 표시 여부(enabled)만 이 브라우저의 localStorage에 저장
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal } = SeMIS;

  // Firebase 웹 API 키 — 코드(공개 repo)에 두지 않고 공용 DB(semis_store "caresCfg")에서
  // 런타임 로드. (GitHub secret scanning 대응 — 키 자체는 공개 설계값이나 노출 최소화)
  let apiKey = null;
  const KEY_CACHE = "semis2:caresKey"; // 기기 로컬 캐시
  async function getKey() {
    if (apiKey) return apiKey;
    try { const c = localStorage.getItem(KEY_CACHE); if (c) { apiKey = c; return apiKey; } } catch (e) {}
    if (window.SemisSync && SemisSync.fetchKV) {
      const v = await SemisSync.fetchKV("caresCfg");
      if (v && v.apiKey) {
        apiKey = v.apiKey;
        try { localStorage.setItem(KEY_CACHE, apiKey); } catch (e) {}
        return apiKey;
      }
    }
    throw new Error("연동 키 미설정 (공용 DB caresCfg)");
  }
  function clearKeyCache() {
    apiKey = null;
    try { localStorage.removeItem(KEY_CACHE); } catch (e) {}
  }
  const PROJECT = "airzeta-security-system";
  const FS_DOCS = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents";

  // 멀티센서 — logicalId(백엔드/CARES 앱과 일치) → 표시명
  const DEVICE_NAMES = {
    ICN_CARGO_B:     "1호기 · 화물터미널 입구",
    ICN_ETD_CASE:    "2호기 · ETD 보호케이스",
    ICN_SEARCH_ROOM: "3호기 · 검색실"
  };
  const DEVICE_ORDER = ["ICN_CARGO_B", "ICN_ETD_CASE", "ICN_SEARCH_ROOM"];
  const DEFAULT_DEVICE_ID = "ICN_CARGO_B";
  const deviceName  = (id) => DEVICE_NAMES[id] || id;
  const deviceShort = (id) => { const n = DEVICE_NAMES[id]; return n ? n.split(" · ")[0] : id; };
  const DEVICE = { id: DEFAULT_DEVICE_ID, name: deviceName(DEFAULT_DEVICE_ID) }; // 하위호환 export

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
    const res = await fetch(FS_DOCS + ":runQuery?key=" + (await getKey()), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  async function fetchThresholds(deviceId) {
    const id = deviceId || DEVICE.id;
    try {
      const res = await fetch(FS_DOCS + "/sensorThresholds/" + id + "?key=" + (await getKey()));
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

  /* ─────── 기기별 그리드 블록 ─────── */
  // multi=false면 기존 단일 레이아웃과 동일한 HTML(래퍼/헤더 없음)을 반환해 하위호환 유지
  function deviceBlockHTML(id, rs, th, showAll, multi) {
    const last = rs[rs.length - 1];
    const exceeded = METRICS.filter(m => isExceed(last[m.key], th[m.key]));
    const shown = showAll ? METRICS : exceeded;
    const header = multi ? `<div class="cares-dev-head">
        <span class="cares-dev-name">${esc(deviceName(id))}</span>
        <span class="badge ${exceeded.length ? "badge-red" : "badge-green"} badge-sm">${exceeded.length ? "⚠ " + exceeded.length : "✓ 정상"}</span>
      </div>` : "";
    const body = shown.length ? `<div class="cares-grid">
        ${shown.map(m => {
          const v = last[m.key];
          const ex = isExceed(v, th[m.key]);
          const series = rs.map(r => (typeof r[m.key] === "number" ? r[m.key] : null));
          return `<div class="cares-cell${ex ? " exceed" : ""}">
            <div class="cares-label">${esc(m.label)}${ex ? " ⚠" : ""}</div>
            <div class="cares-value">${v == null ? "-" : esc(v.toFixed(m.dec))}<span class="cares-unit">${esc(m.unit)}</span></div>
            ${sparkSVG(series, th[m.key])}
          </div>`;
        }).join("")}
      </div>`
      : `<div class="cares-allok">${multi ? "임계값 이내" : "모든 지표가 임계값 이내입니다."} <span style="color:var(--text-3)">(1분마다 자동 갱신)</span></div>`;
    return multi ? `<div class="cares-device">${header}${body}</div>` : body;
  }

  /* ─────── 위젯 렌더 ─────── */
  let refreshTimer = null;
  async function renderInto(box, canWrite) {
    const c = cfg();
    if (c.enabled === false) { // 명시적으로 끈 경우만 숨김 (기본: 표시)
      box.innerHTML = `<div class="empty" style="padding:20px 10px">환경센서 표시가 꺼져 있습니다.${canWrite ? " ⚙ 버튼에서 켤 수 있습니다." : ""}</div>`;
      return false;
    }
    if (typeof fetch === "undefined") {
      box.innerHTML = '<div class="empty" style="padding:20px 10px">오프라인 — 네트워크 연결 후 표시됩니다.</div>';
      return false;
    }
    box.innerHTML = '<div class="empty" style="padding:20px 10px">환경센서 데이터를 불러오는 중…</div>';
    try {
      await getKey(); // 연동 키 확보 (공용 DB caresCfg → 로컬 캐시)
      const [readings, alarms] = await Promise.all([fetchReadings(180), fetchAlarms()]);
      if (!document.body.contains(box)) return false; // 화면 이탈
      if (!readings.length) { box.innerHTML = '<div class="empty">센서 데이터가 없습니다.</div>'; return false; }

      // ── 기기별 그룹핑 (시간 오름차순 유지) ──
      const byDevice = new Map();
      readings.forEach(r => {
        const id = r.deviceId || DEFAULT_DEVICE_ID;
        if (!byDevice.has(id)) byDevice.set(id, []);
        byDevice.get(id).push(r);
      });
      const presentIds = [];
      DEVICE_ORDER.forEach(id => { if (byDevice.has(id)) presentIds.push(id); });
      byDevice.forEach((_, id) => { if (presentIds.indexOf(id) < 0) presentIds.push(id); });
      const multi = presentIds.length > 1;

      // ── 기기별 임계값 (표시되는 기기만 조회) ──
      const thList = await Promise.all(presentIds.map(id => fetchThresholds(id)));
      const thByDevice = {};
      presentIds.forEach((id, i) => { thByDevice[id] = thList[i]; });

      const active = alarms.filter(a => !a.endedAt);
      const showAll = c.showAll === true; // "전체 표시" 토글

      // ── 전 기기 합산 초과 건수 + 최신 수신 시각 ──
      let totalExceeded = 0, latestMs = 0;
      presentIds.forEach(id => {
        const rs = byDevice.get(id), last = rs[rs.length - 1], th = thByDevice[id];
        totalExceeded += METRICS.filter(m => isExceed(last[m.key], th[m.key])).length;
        const ms = last.timestamp ? new Date(last.timestamp).getTime() : 0;
        if (ms > latestMs) latestMs = ms;
      });
      const lastTs = latestMs ? new Date(latestMs).toLocaleString("ko-KR") : "-";
      const headLabel = multi ? (presentIds.length + "개소") : esc(deviceName(presentIds[0]));

      box.innerHTML = `
        <div class="cares-head">
          <span class="badge ${totalExceeded ? "badge-red" : "badge-green"}">${totalExceeded ? "⚠ 임계치 초과 " + totalExceeded + "건" : "✓ 전체 정상"}</span>
          <span style="font-size:.76rem;color:var(--text-3)">${headLabel} · ${esc(lastTs)}</span>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" id="cares-mode">${showAll ? "초과만 보기" : "전체 표시"}</button>
          <button class="btn btn-ghost btn-sm" id="cares-refresh">↻</button>
        </div>
        ${active.length ? `<div class="cares-alarms">${active.map(a => `
          <div class="cares-alarm">🔴 ${a.deviceId ? `<span class="cares-alarm-dev">${esc(deviceShort(a.deviceId))}</span>` : ""}<b>${esc(a.metricLabel || a.metric)}</b>
            ${a.type === "max" ? "상한" : "하한"} ${esc(String(a.threshold))}${esc(a.unit || "")} 초과 진행 중
            <span style="color:var(--text-3)">(최고 ${esc(String(a.peakValue))}${esc(a.unit || "")})</span></div>`).join("")}</div>` : ""}
        ${presentIds.map(id => deviceBlockHTML(id, byDevice.get(id), thByDevice[id], showAll, multi)).join("")}
        <div class="form-hint" style="margin-top:6px">최근 추이 · 점선=임계값 · 1분마다 자동 갱신</div>`;
      $("#cares-refresh", box).onclick = () => renderInto(box, canWrite);
      $("#cares-mode", box).onclick = () => {
        setCfg(Object.assign(cfg(), { showAll: !showAll }));
        renderInto(box, canWrite);
      };

      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(() => {
        const el = document.getElementById("cares-box");
        if (!el) { clearInterval(refreshTimer); refreshTimer = null; return; }
        renderInto(el, canWrite);
      }, 60000);
      return true;
    } catch (e) {
      clearKeyCache(); // 키 회전/오류 대비 — 재시도 시 공용 DB에서 재조회
      if (document.body.contains(box)) box.innerHTML =
        `<div class="empty" style="padding:16px 10px">⚠ CARES 연결 실패 — ${esc(e.message || "네트워크 오류")}<br>
        <button class="btn btn-ghost btn-sm" id="cares-retry" style="margin-top:8px">다시 시도</button></div>`;
      const rt = box.querySelector("#cares-retry");
      if (rt) rt.onclick = () => renderInto(box, canWrite);
      return false;
    }
  }

  /* ─────── 표시 설정 (이 기기에만 저장) ─────── */
  function settingsForm() {
    const c = cfg();
    openModal(`
      <h3>🌡 CARES 환경센서 연동</h3>
      <div class="form-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="c-enabled" style="width:auto" ${c.enabled !== false ? "checked" : ""}> 대시보드에 환경센서 표시</label>
        <div class="form-hint" style="margin-top:8px">CARES 환경센서(1·2·3호기)의 데이터를 공개 조회 방식으로 표시합니다.
        별도 계정이 필요 없으며, 표시 여부는 이 브라우저에만 적용됩니다.
        임계값 변경은 <a href="https://airzeta-security-system.web.app" target="_blank" rel="noopener">CARES 앱</a>에서 관리합니다.</div></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="c-cancel">취소</button>
        <button class="btn btn-primary" id="c-save">저장</button>
      </div>`);
    $("#c-cancel").onclick = closeModal;
    $("#c-save").onclick = () => {
      setCfg({ enabled: $("#c-enabled").checked });
      closeModal();
      SeMIS.renderView();
      toast("저장되었습니다.");
    };
  }

  window.SemisCares = {
    renderInto, settingsForm,
    parseFs, docToObj, isExceed, sparkSVG,
    METRICS, DEFAULT_TH, DEVICE,
    cfg, setCfg, getKey, clearKeyCache
  };
})();
