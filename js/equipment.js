/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 보안장비 유지관리 모듈 (v2.10)
   CARES 마스터 연동 + 내용연수 관리 + 유지보수 계약/비용 기록

   설계 원칙:
   - 장비 등록/상태/고장/점검의 마스터는 CARES(Firestore) — SeMIS는 읽기 표시
   - SeMIS 고유 관리: 내용연수(법정 교체주기)·구입가·유지보수 계약·월별 비용 기록
   - 내용연수(항공보안장비 기준·항공용품 내용연수 규정 참조):
       X-Ray 10년 / ETD 5년 / WTMD 10년 / HHMD 4년 — 제조(설치)일 기산, 장비별 수정 가능

   데이터:
   - DATA.equipment = [{ id, type, name, serial, location, vendor, installed(설치일),
       mfgDate(제조일: 내용연수 기산일, 없으면 installed), lifeYears(내용연수 년, 없으면 유형 기본),
       replaceDue(교체예정 수동지정, 없으면 기산일+내용연수), price(구입가), cert(인증),
       status, logs[{id,date,kind,text,by}], note }]
     ※ 구버전 필드 lastCheck/cycleM은 데이터에 남아 있어도 무시(점검은 CARES에서 관리)
   - DATA.equipMaint = { contracts:[{id,vendor,scope,feeMonthly,units,freeMonths,partsOver,terms,note}],
                         costs:[{id,ym("YYYY-MM"),kind,vendor,amount,serial,memo}] }
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const TYPES = ["X-Ray", "WTMD(문형)", "HHMD(휴대용)", "ETD(폭발물흔적)", "CCTV", "기타"];
  const TYPE_ICON = { "X-Ray": "📦", "WTMD(문형)": "🚪", "HHMD(휴대용)": "🪄", "ETD(폭발물흔적)": "🧪", "CCTV": "📹", "기타": "🔧" };
  const TYPE_SHORT = { "X-Ray": "X-Ray", "WTMD(문형)": "WTMD", "HHMD(휴대용)": "HHMD", "ETD(폭발물흔적)": "ETD", "CCTV": "CCTV", "기타": "기타" };
  // 유형별 기본 내용연수 (년) — 장비별 lifeYears로 override 가능
  const TYPE_LIFE = { "X-Ray": 10, "ETD(폭발물흔적)": 5, "WTMD(문형)": 10, "HHMD(휴대용)": 4, "CCTV": 0, "기타": 0 };
  const STATUSES = ["정상", "점검필요", "고장", "수리중", "폐기"];
  const ST_BADGE = { "정상": "badge-green", "주의": "badge-amber", "점검필요": "badge-amber", "고장": "badge-red", "수리중": "badge-blue", "폐기": "badge-gray" };
  const LOG_KINDS = ["점검", "고장", "수리", "기타"];
  const LOG_BADGE = { "점검": "badge-blue", "고장": "badge-red", "수리": "badge-green", "기타": "badge-gray" };
  const COST_KINDS = ["정기 유지보수", "수리/부품", "기타"];

  const todayISO = () => new Date().toISOString().slice(0, 10);
  function addMonths(dateStr, months) {
    if (!dateStr || !months) return "";
    const y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7)), day = Number(dateStr.slice(8, 10));
    const t = new Date(Date.UTC(y, m - 1 + Number(months), 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(day, last));
    return t.toISOString().slice(0, 10);
  }
  function daysLeft(dateStr) {
    if (!dateStr) return null;
    return Math.round((new Date(dateStr) - new Date(todayISO())) / 86400000);
  }
  const fmtWon = (n) => (Number(n) || 0).toLocaleString("ko-KR");

  /* ─────── 내용연수 (점검도래 대체) ─────── */
  const lifeBase = (x) => x.mfgDate || x.installed || "";
  const lifeYearsOf = (x) =>
    (x.lifeYears != null && x.lifeYears !== "") ? Number(x.lifeYears) : (TYPE_LIFE[x.type] || 0);
  const replaceDue = (x) => {
    if (x.replaceDue) return x.replaceDue;
    const base = lifeBase(x), yrs = lifeYearsOf(x);
    return (base && yrs) ? addMonths(base, yrs * 12) : "";
  };
  // 내용연수 임박(1년 이내) 또는 만료
  const isLifeDue = (x) => {
    if (x.status === "폐기") return false;
    const r = replaceDue(x);
    return !!r && daysLeft(r) <= 365;
  };
  function lifeBadge(x) {
    if (x.status === "폐기") return "";
    const r = replaceDue(x);
    if (!r) return '<span class="badge badge-gray">미지정</span>';
    const d = daysLeft(r);
    if (d < 0) return `<span class="badge badge-red">내용연수 만료 D+${-d}</span>`;
    if (d <= 365) return `<span class="badge badge-amber">교체 D-${d}</span>`;
    const yrs = (d / 365).toFixed(1);
    return `<span class="badge badge-gray">잔여 ${yrs}년</span>`;
  }

  /* ─────── CARES 연동 (마스터: 장비/고장/점검) ─────── */
  let apiKey = null;
  const KEY_CACHE = "semis2:caresKey"; // cares.js와 캐시 공유
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
  const PROJECT = "airzeta-security-system";
  const FS_DOCS = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents";
  const CARES_URL = "https://airzeta-security-system.web.app";

  function parseFs(v) {
    if (v == null || typeof v !== "object") return null;
    if ("doubleValue" in v) return Number(v.doubleValue);
    if ("integerValue" in v) return Number(v.integerValue);
    if ("stringValue" in v) return v.stringValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("nullValue" in v) return null;
    if ("mapValue" in v) {
      const out = {}, f = (v.mapValue && v.mapValue.fields) || {};
      Object.keys(f).forEach(k => { out[k] = parseFs(f[k]); });
      return out;
    }
    if ("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(parseFs);
    return null;
  }
  const parseDoc = (doc) => {
    const out = { id: String(doc.name || "").split("/").pop() };
    const f = doc.fields || {};
    Object.keys(f).forEach(k => { out[k] = parseFs(f[k]); });
    return out;
  };
  async function fsList(coll, pageSize) {
    const res = await fetch(FS_DOCS + "/" + coll + "?pageSize=" + (pageSize || 50) + "&key=" + (await getKey()));
    if (!res.ok) throw new Error("CARES 조회 실패 " + res.status);
    const j = await res.json();
    return (j.documents || []).map(parseDoc);
  }
  async function fsQuery(coll, orderField, lim) {
    const res = await fetch(FS_DOCS + ":runQuery?key=" + (await getKey()), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: coll }],
        orderBy: [{ field: { fieldPath: orderField }, direction: "DESCENDING" }],
        limit: lim
      }})
    });
    if (!res.ok) throw new Error("CARES 조회 실패 " + res.status);
    const rows = await res.json();
    return rows.filter(r => r.document).map(r => parseDoc(r.document));
  }

  // 캐시 (60초 TTL)
  const cares = { ts: 0, equips: [], repairs: [], inspections: [], err: null, loading: false };
  async function loadCares(force) {
    if (typeof fetch === "undefined") { cares.err = "오프라인"; return cares; }
    if (!force && cares.ts && Date.now() - cares.ts < 60000) return cares;
    if (cares.loading) return cares;
    cares.loading = true;
    try {
      const [eq, rp, ins] = await Promise.all([
        fsList("equipments", 50),
        fsQuery("repairLogs", "reportedAtMs", 200),
        fsQuery("inspectionLogs", "inspectedAtMs", 200)
      ]);
      cares.equips = eq; cares.repairs = rp; cares.inspections = ins;
      cares.ts = Date.now(); cares.err = null;
    } catch (e) {
      cares.err = (e && e.message) || "연동 실패";
      apiKey = null; // 키 문제 가능성 — 다음 시도에서 재조회
    } finally { cares.loading = false; }
    return cares;
  }

  // 고장 처리 상태 (CARES 규약과 동일: 신고→접수→수리중→완료)
  const repairStatus = (rl) => rl.resolvedAtMs ? "resolved" : (rl.status && rl.status !== "resolved" ? rl.status : "reported");
  const RS_META = {
    reported: { label: "접수 대기", cls: "badge-red" },
    accepted: { label: "접수됨", cls: "badge-amber" },
    in_repair: { label: "수리중", cls: "badge-blue" },
    resolved: { label: "수리 완료", cls: "badge-green" }
  };
  const CAT_LABEL = { environmental: "환경", mechanical: "기계", human: "인적", other: "기타" };
  const INS_TYPE = { daily: "일일", weekly: "주간", monthly: "월간", quarterly: "분기", biannual: "반기", annual: "연간", special: "특별" };
  function fmtElapsed(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 60) return m + "분";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "시간";
    return Math.floor(h / 24) + "일 " + (h % 24) + "시간";
  }
  const fmtMs = (ms) => ms ? new Date(ms).toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" }) : "-";

  // CARES ↔ SeMIS 매칭 (S/N 기준)
  const normSN = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();
  function caresLinkOf(x) {
    if (!cares.equips.length) return null;
    const sn = normSN(x.serial);
    if (!sn) return null;
    return cares.equips.find(c => normSN(c.serial) === sn) || null;
  }
  const ST_FROM_CARES = { safe: "정상", warning: "주의", broken: "고장" };
  function effStatus(x) {
    if (x.status === "폐기") return "폐기";
    const c = caresLinkOf(x);
    if (c && ST_FROM_CARES[c.status]) {
      // 진행중 고장신고가 수리중 단계면 '수리중' 표시
      if (c.status === "broken") {
        const act = cares.repairs.find(r => r.equipmentId === c.id && !r.resolvedAtMs);
        if (act && repairStatus(act) === "in_repair") return "수리중";
        return "고장";
      }
      return ST_FROM_CARES[c.status];
    }
    return x.status;
  }
  // CARES에만 있고 SeMIS 대장에 없는 장비 (S/N 매칭 실패분)
  function caresOnlyEquips() {
    const sns = new Set(list().map(x => normSN(x.serial)).filter(Boolean));
    return cares.equips.filter(c => !sns.has(normSN(c.serial)));
  }

  /* ─────── 유지보수 계약/비용 (SeMIS 고유) ─────── */
  function M() {
    let m = D().equipMaint;
    if (!m || typeof m !== "object" || Array.isArray(m)) m = D().equipMaint = { contracts: [], costs: [] };
    if (!Array.isArray(m.contracts)) m.contracts = [];
    if (!Array.isArray(m.costs)) m.costs = [];
    return m;
  }
  /* v2.17: 대금 청구(billing) 연동 — 유지보수 성격 청구를 비용 기록에 자동 반영.
     billing이 원본(가상 행)이라 업체 입력 수정 시 즉시 집계에 반영됨. */
  const blMod = () => (window.SemisBilling && SeMIS.canEdit() ? window.SemisBilling : null);
  function billingAutoRows(year) {
    const B = blMod();
    try { return B ? B.maintRows(year) : []; } catch (e) { return []; }
  }
  // 수동 기록의 업체명이 청구 연동 업체(프로에스콤/인씨스)와 일치하는지
  function billingVendorOf(name) {
    const B = blMod();
    const n = String(name || "").replace(/\s+/g, "");
    if (!B || !n) return null;
    return Object.keys(B.VENDORS).find(v => n.includes(v.replace(/\s+/g, ""))) || null;
  }
  /* 중복 계상 방지: 같은 달·같은 업체의 유지보수 청구(자동 행)가 있으면
     수동 기록은 집계에서 자동 제외 — force 플래그(비용 기록 폼 체크박스)로 강제 포함 가능 */
  function isDupManual(c, autoRows) {
    if (!c || c.force) return false;
    const v = billingVendorOf(c.vendor);
    if (!v) return false;
    return autoRows.some(a => a.vendor === v && a.ym === c.ym);
  }
  function yearCosts(year) {
    const all = M().costs.filter(c => String(c.ym || "").slice(0, 4) === String(year));
    const autoRows = billingAutoRows(year);
    const excluded = all.filter(c => isDupManual(c, autoRows));
    const rows = all.filter(c => excluded.indexOf(c) < 0);
    const byM = {};
    for (let i = 1; i <= 12; i++) byM[i] = { "정기 유지보수": 0, "수리/부품": 0, "기타": 0, total: 0 };
    const addRow = (c) => {
      const mo = Number(String(c.ym || "").slice(5, 7));
      if (!byM[mo]) return;
      const k = COST_KINDS.includes(c.kind) ? c.kind : "기타";
      byM[mo][k] += Number(c.amount) || 0;
      byM[mo].total += Number(c.amount) || 0;
    };
    rows.forEach(addRow); autoRows.forEach(addRow);
    const total = Object.keys(byM).reduce((s, k) => s + byM[k].total, 0);
    return { byM, total, rows, autoRows, excluded };
  }

  /* ─────── 상태/필터 ─────── */
  let query = "", stFilter = "전체", tab = "list", costYear = new Date().getFullYear();

  const list = () => (Array.isArray(D().equipment) ? D().equipment : []);
  function filtered() {
    const q = query.toLowerCase();
    return list().filter(x => {
      const st = effStatus(x);
      if (stFilter === "내용연수임박") { if (!isLifeDue(x)) return false; }
      else if (stFilter === "고장/수리중") { if (st !== "고장" && st !== "수리중") return false; }
      else if (stFilter !== "전체" && st !== stFilter) return false;
      if (!q) return true;
      return [x.type, x.name, x.serial, x.location, x.vendor, x.note]
        .some(v => String(v || "").toLowerCase().includes(q));
    }).sort((a, b) => {
      const ra = a.status === "폐기" ? 1 : 0, rb = b.status === "폐기" ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return String(replaceDue(a) || "9999").localeCompare(String(replaceDue(b) || "9999"));
    });
  }

  function stats() {
    const l = list().filter(x => x.status !== "폐기");
    const brokenSt = (x) => { const s = effStatus(x); return s === "고장" || s === "수리중"; };
    return {
      total: l.length,
      ok: l.filter(x => effStatus(x) === "정상" && !isLifeDue(x)).length,
      due: l.filter(isLifeDue).length,
      broken: l.filter(brokenSt).length
    };
  }

  /* ─────── 등록/수정 폼 (manager+) ─────── */
  function eqForm(id) {
    const x = id ? list().find(e => e.id === id) : null;
    let logs = x ? (x.logs || []).map(l => Object.assign({}, l)) : [];
    openModal(`
      <h3>${x ? "장비 수정" : "장비 등록"} <span class="badge badge-gray">보안장비</span></h3>
      <div class="form-hint" style="margin-bottom:8px">장비 상태·고장/점검 이력은 CARES가 마스터입니다 (S/N 일치 시 자동 연동).
        SeMIS에서는 내용연수·구입가 등 대장 정보를 관리합니다.</div>
      <div class="form-grid">
        <div class="form-row"><label>장비 유형</label>
          <select id="e-type">${TYPES.map(t => `<option ${(x ? x.type : TYPES[0]) === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="form-row"><label>상태 (CARES 미연동 장비용)</label>
          <select id="e-status">${STATUSES.map(s => `<option ${(x ? x.status : "정상") === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>장비명 / 모델</label>
          <input id="e-name" value="${esc(x ? x.name : "")}" maxlength="60" placeholder="예: RAP-638DV"></div>
        <div class="form-row"><label>제조번호 (S/N) — CARES 연동 키</label>
          <input id="e-serial" value="${esc(x ? x.serial || "" : "")}" maxlength="40"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>설치 위치</label>
          <input id="e-location" value="${esc(x ? x.location || "" : "")}" maxlength="60" placeholder="예: 인천 화물터미널 B동"></div>
        <div class="form-row"><label>제작사 / 유지보수 업체</label>
          <input id="e-vendor" value="${esc(x ? x.vendor || "" : "")}" maxlength="60" placeholder="예: 라피스캔 / 인씨스"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>제조일 (내용연수 기산일)</label><input type="date" id="e-mfg" value="${esc(x ? x.mfgDate || "" : "")}"></div>
        <div class="form-row"><label>설치/취득일</label><input type="date" id="e-installed" value="${esc(x ? x.installed || "" : "")}"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>내용연수 (년) — 비우면 유형 기본</label>
          <input type="number" id="e-life" min="0" max="30" value="${esc(x && x.lifeYears != null ? x.lifeYears : "")}"
            placeholder="X-Ray 10 · ETD 5 · WTMD 10 · HHMD 4"></div>
        <div class="form-row"><label>교체예정일 (수동 지정 시)</label><input type="date" id="e-repdue" value="${esc(x ? x.replaceDue || "" : "")}"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>구입가 (원)</label>
          <input type="number" id="e-price" min="0" value="${esc(x && x.price != null ? x.price : "")}" placeholder="예: 460000000"></div>
        <div class="form-row"><label>인증 취득 (TSA/ECAC 등)</label>
          <input id="e-cert" value="${esc(x ? x.cert || "" : "")}" maxlength="120" placeholder="예: TSA, ECAC, KIAST"></div>
      </div>
      <div class="form-row"><label>자체 기록 (CARES 외 별도 메모용 이력)</label>
        <div id="e-logs"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="elog-add" style="margin-top:4px">+ 기록 추가</button></div>
      <div class="form-row"><label>비고</label><input id="e-note" value="${esc(x ? x.note || "" : "")}" maxlength="200"></div>
      <div class="modal-actions">
        ${x ? '<button class="btn btn-ghost" id="e-detail" style="margin-right:auto">상세/이력 보기</button>' : ""}
        ${x ? '<button class="btn btn-danger" id="e-del">삭제</button>' : ""}
        <button class="btn btn-ghost" id="e-cancel">취소</button>
        <button class="btn btn-primary" id="e-save">저장</button>
      </div>`, { wide: true });

    function logCollect() {
      $$("#e-logs .ifd-row").forEach((row, i) => {
        logs[i].date = row.querySelector("input[type=date]").value;
        logs[i].kind = row.querySelector("select").value;
        logs[i].text = row.querySelector("input[type=text]").value;
      });
    }
    function logPaint() {
      $("#e-logs").innerHTML = logs.map((l, i) => `
        <div class="ifd-row" data-log="${i}">
          <input type="date" value="${esc(l.date || "")}" style="width:130px;flex-shrink:0">
          <select class="ifd-type">${LOG_KINDS.map(k => `<option ${l.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select>
          <input type="text" class="ifd-text" value="${esc(l.text || "")}" maxlength="200" placeholder="내용">
          <button type="button" class="btn btn-ghost btn-sm" data-log-del="${i}" title="삭제">🗑</button>
        </div>`).join("") || '<div class="form-hint">자체 기록이 없습니다.</div>';
      $$("#e-logs [data-log-del]").forEach(b => b.onclick = () => {
        logCollect(); logs.splice(Number(b.dataset.logDel), 1); logPaint();
      });
    }
    logPaint();
    $("#elog-add").onclick = () => {
      logCollect();
      logs.push({ id: uid("el"), date: todayISO(), kind: "기타", text: "", by: (SeMIS.user && SeMIS.user.name) || "" });
      logPaint();
    };

    $("#e-cancel").onclick = closeModal;
    if (x) $("#e-detail").onclick = () => { closeModal(); eqDetail(x.id); };
    if (x) $("#e-del").onclick = () =>
      confirmModal(`장비 "${x.name}"을(를) 삭제하시겠습니까?`, () => {
        D().equipment = list().filter(e => e.id !== x.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    $("#e-save").onclick = () => {
      const name = $("#e-name").value.trim();
      if (!name) { toast("장비명을 입력하세요.", true); return; }
      logCollect();
      const cleanLogs = logs.filter(l => String(l.text || "").trim() || l.date)
        .map(l => ({ id: l.id || uid("el"), date: l.date || "", kind: LOG_KINDS.includes(l.kind) ? l.kind : "기타",
                     text: String(l.text || "").trim(), by: l.by || "" }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const lifeRaw = $("#e-life").value;
      const rec = {
        type: $("#e-type").value, name,
        serial: $("#e-serial").value.trim(),
        location: $("#e-location").value.trim(),
        vendor: $("#e-vendor").value.trim(),
        mfgDate: $("#e-mfg").value || "",
        installed: $("#e-installed").value || "",
        lifeYears: lifeRaw === "" ? null : Math.max(0, Number(lifeRaw) || 0),
        replaceDue: $("#e-repdue").value || "",
        price: $("#e-price").value === "" ? null : Math.max(0, Number($("#e-price").value) || 0),
        cert: $("#e-cert").value.trim(),
        status: $("#e-status").value,
        logs: cleanLogs,
        note: $("#e-note").value.trim()
      };
      if (x) Object.assign(x, rec);
      else D().equipment.push(Object.assign({ id: uid("eq") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ─────── 상세 (CARES 이력 포함) ─────── */
  function eqDetail(id) {
    const x = list().find(e => e.id === id);
    if (!x) return;
    const c = caresLinkOf(x);
    const st = effStatus(x);
    openModal(`
      <h3>${esc(TYPE_ICON[x.type] || "🔧")} ${esc(x.name)}
        <span class="badge ${ST_BADGE[st] || "badge-gray"}">${esc(st)}</span>
        ${c ? '<span class="badge badge-blue" title="S/N 매칭으로 CARES와 연동 중">CARES 연동</span>' : ""}</h3>
      <table class="tbl" style="font-size:.88rem">
        <tr><td style="width:110px;color:var(--text-2)">유형</td><td>${esc(x.type)}</td></tr>
        <tr><td style="color:var(--text-2)">S/N</td><td>${esc(x.serial || "-")}</td></tr>
        <tr><td style="color:var(--text-2)">위치</td><td>${esc((c && c.location) || x.location || "-")}${c ? ' <span style="font-size:.74rem;color:var(--text-3)">(CARES 배치)</span>' : ""}</td></tr>
        <tr><td style="color:var(--text-2)">업체</td><td>${esc(x.vendor || "-")}</td></tr>
        <tr><td style="color:var(--text-2)">제조/설치</td><td>제조 ${esc(x.mfgDate || "-")} · 설치 ${esc(x.installed || "-")}</td></tr>
        <tr><td style="color:var(--text-2)">내용연수</td><td>${lifeYearsOf(x) || "-"}년 · 교체예정 ${esc(replaceDue(x) || "-")} ${lifeBadge(x)}</td></tr>
        ${x.price != null && SeMIS.roleRank() >= 3 ? `<tr><td style="color:var(--text-2)">구입가</td><td>${fmtWon(x.price)}원</td></tr>` : ""}
        ${x.cert ? `<tr><td style="color:var(--text-2)">인증</td><td>${esc(x.cert)}</td></tr>` : ""}
        ${x.note ? `<tr><td style="color:var(--text-2)">비고</td><td>${esc(x.note)}</td></tr>` : ""}
      </table>
      <div id="eqd-cares" style="margin-top:12px"><div class="form-hint">CARES 이력 불러오는 중…</div></div>
      ${(x.logs || []).length ? `<div style="font-size:.78rem;font-weight:700;color:var(--text-3);margin:12px 0 4px">자체 기록</div>
        ${x.logs.map(l => `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);font-size:.84rem">
          <span style="color:var(--text-3);white-space:nowrap">${esc(l.date || "-")}</span>
          <span class="badge ${LOG_BADGE[l.kind] || "badge-gray"}">${esc(l.kind)}</span>
          <span style="flex:1">${esc(l.text)}</span>${l.by ? `<span style="font-size:.74rem;color:var(--text-3)">${esc(l.by)}</span>` : ""}
        </div>`).join("")}` : ""}
      <div class="modal-actions">
        <a class="btn btn-ghost" href="${CARES_URL}" target="_blank" rel="noopener">CARES ↗</a>
        <button class="btn btn-ghost" id="e-close">닫기</button></div>`, { wide: true });
    $("#e-close").onclick = closeModal;

    // CARES 이력 비동기 로드
    loadCares().then(() => {
      const box = $("#eqd-cares");
      if (!box) return; // 모달이 이미 닫힘
      const c2 = caresLinkOf(x);
      if (cares.err || !c2) {
        box.innerHTML = `<div class="form-hint">${cares.err ? "CARES 연동 불가: " + esc(cares.err) : "CARES 미연동 장비 (S/N 매칭 없음) — 고장/점검 이력은 CARES 등록 장비만 표시됩니다."}</div>`;
        return;
      }
      const reps = cares.repairs.filter(r => r.equipmentId === c2.id);
      const inss = cares.inspections.filter(r => r.equipmentId === c2.id).slice(0, 10);
      const repHTML = reps.length ? reps.slice(0, 10).map(r => {
        const rs = repairStatus(r);
        const dur = r.resolvedAtMs ? fmtElapsed(r.resolvedAtMs - r.reportedAtMs) : fmtElapsed(Date.now() - r.reportedAtMs) + " 경과";
        return `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);font-size:.84rem">
          <span style="color:var(--text-3);white-space:nowrap">${fmtMs(r.reportedAtMs)}</span>
          <span class="badge ${RS_META[rs].cls}">${RS_META[rs].label}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.symptom || "")}">${esc(r.symptom || "-")}</span>
          ${r.causeCategory && CAT_LABEL[r.causeCategory] ? `<span class="badge badge-gray">${CAT_LABEL[r.causeCategory]}</span>` : ""}
          <span style="font-size:.76rem;color:var(--text-3);white-space:nowrap">${dur}</span>
        </div>`;
      }).join("") : '<div class="form-hint">고장/수리 이력이 없습니다.</div>';
      const insHTML = inss.length ? inss.map(r => {
        const bad = (r.checklist || []).filter(e2 => e2 && e2.result === "bad").length;
        return `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);font-size:.84rem">
          <span style="color:var(--text-3);white-space:nowrap">${fmtMs(r.inspectedAtMs)}</span>
          <span class="badge badge-blue">${INS_TYPE[r.type] || esc(r.type || "점검")}</span>
          <span style="flex:1">${esc(r.inspector || "-")}</span>
          <span class="badge ${bad ? "badge-red" : "badge-green"}">${bad ? "불량 " + bad : "양호"}</span>
        </div>`;
      }).join("") : '<div class="form-hint">점검 기록이 없습니다.</div>';
      box.innerHTML = `
        <div style="font-size:.78rem;font-weight:700;color:var(--text-3);margin-bottom:4px">🔧 고장/수리 이력 (CARES · 최근 ${Math.min(reps.length, 10)}건 / 총 ${reps.length}건)</div>${repHTML}
        <div style="font-size:.78rem;font-weight:700;color:var(--text-3);margin:12px 0 4px">✅ 점검 기록 (CARES · 최근 ${inss.length}건)</div>${insHTML}`;
    });
  }

  /* ─────── CARES 전용(대장 미등록) 장비 안내 ─────── */
  function caresOnlyDetail(c) {
    if (!c) return;
    openModal(`
      <h3>${esc(c.name)} <span class="badge badge-blue">CARES 등록 장비</span></h3>
      <div class="form-hint" style="margin-bottom:8px">CARES에는 등록되어 있으나 SeMIS 대장에는 없는 장비입니다.
        같은 S/N으로 장비를 등록하면 자동 연동됩니다.</div>
      <table class="tbl" style="font-size:.88rem">
        <tr><td style="width:100px;color:var(--text-2)">유형</td><td>${esc(c.type || "-")}</td></tr>
        <tr><td style="color:var(--text-2)">S/N</td><td>${esc(c.serial || "-")}</td></tr>
        <tr><td style="color:var(--text-2)">배치</td><td>${esc(c.location || "-")}</td></tr>
      </table>
      <div class="modal-actions"><button class="btn btn-ghost" id="e-close">닫기</button></div>`);
    $("#e-close").onclick = closeModal;
  }

  /* ─────── 목록 테이블 ─────── */
  function tableHTML() {
    const items = filtered();
    const extras = stFilter === "전체" && !query ? caresOnlyEquips() : [];
    if (!items.length && !extras.length) return '<div class="empty">해당하는 장비가 없습니다.</div>';
    return `<div class="table-wrap"><table class="tbl"><thead><tr>
        <th style="width:82px">유형</th><th>장비명 / 배치</th><th style="width:96px">기산일</th>
        <th style="width:150px">내용연수</th><th style="width:84px">이력</th><th style="width:76px">상태</th></tr></thead><tbody>
      ${items.map(x => {
        const c = caresLinkOf(x);
        const st = effStatus(x);
        const repN = c ? cares.repairs.filter(r => r.equipmentId === c.id).length : 0;
        const loc = (c && c.location) || x.location || "";
        return `<tr data-eq-row="${esc(x.id)}" style="cursor:pointer" class="${x.status === "폐기" ? "insp-cancel" : ""}">
        <td style="white-space:nowrap" title="${esc(x.type)}">${esc(TYPE_ICON[x.type] || "▪")} ${esc(TYPE_SHORT[x.type] || x.type)}</td>
        <td><b>${esc(x.name)}</b>${c ? ' <span class="badge badge-blue" style="font-size:.64rem" title="CARES 연동 (S/N 매칭)">C</span>' : ""}
          ${loc ? `<div style="font-size:.76rem;color:var(--text-3)">${esc(loc)}</div>` : ""}</td>
        <td style="font-size:.8rem">${esc(lifeBase(x) || "-")}</td>
        <td>${lifeBadge(x)}${lifeYearsOf(x) ? `<div style="font-size:.7rem;color:var(--text-3)">${lifeYearsOf(x)}년 · ${esc(replaceDue(x) || "")}</div>` : ""}</td>
        <td style="font-size:.8rem">${repN ? `<span class="badge badge-red" style="font-size:.66rem">고장 ${repN}</span>` : ""}${(x.logs || []).length ? ` <span style="color:var(--text-3)">메모 ${(x.logs || []).length}</span>` : (repN ? "" : "-")}</td>
        <td><span class="badge ${ST_BADGE[st] || "badge-gray"}">${esc(st)}</span></td>
      </tr>`; }).join("")}
      ${extras.map((c, i) => `<tr data-cares-only="${i}" style="cursor:pointer;opacity:.78">
        <td style="white-space:nowrap">📡 ${esc(c.type || "-")}</td>
        <td><b>${esc(c.name)}</b> <span class="badge badge-blue" style="font-size:.64rem">CARES만</span>
          ${c.location ? `<div style="font-size:.76rem;color:var(--text-3)">${esc(c.location)}</div>` : ""}</td>
        <td style="font-size:.8rem">-</td><td><span class="badge badge-gray">대장 미등록</span></td><td>-</td>
        <td><span class="badge ${c.status === "safe" ? "badge-green" : c.status === "warning" ? "badge-amber" : "badge-red"}">${ST_FROM_CARES[c.status] || "-"}</span></td>
      </tr>`).join("")}
      </tbody></table></div>`;
  }

  /* ─────── 유지보수 계약 탭 ─────── */
  function contractForm(id) {
    const m = M();
    const x = id ? m.contracts.find(c => c.id === id) : null;
    openModal(`
      <h3>${x ? "계약 수정" : "유지보수 계약 등록"} <span class="badge badge-gray">보안장비</span></h3>
      <div class="form-grid">
        <div class="form-row"><label>업체</label><input id="mc-vendor" value="${esc(x ? x.vendor : "")}" maxlength="60" placeholder="예: 인씨스"></div>
        <div class="form-row"><label>대상 장비</label><input id="mc-scope" value="${esc(x ? x.scope : "")}" maxlength="60" placeholder="예: X-ray 3대"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>월 유지보수비 / 대 (원)</label><input type="number" id="mc-fee" min="0" value="${esc(x && x.feeMonthly != null ? x.feeMonthly : "")}" placeholder="870000"></div>
        <div class="form-row"><label>대수</label><input type="number" id="mc-units" min="0" value="${esc(x && x.units != null ? x.units : "")}" placeholder="3"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>무상수리 기간 (개월)</label><input type="number" id="mc-free" min="0" value="${esc(x && x.freeMonths != null ? x.freeMonths : "")}" placeholder="36"></div>
        <div class="form-row"><label>부품비 별도청구 기준액 (원 이상)</label><input type="number" id="mc-parts" min="0" value="${esc(x && x.partsOver != null ? x.partsOver : "")}" placeholder="200000"></div>
      </div>
      <div class="form-row"><label>계약 조건 상세</label><textarea id="mc-terms" rows="3" maxlength="600" placeholder="정기 점검 및 수리 조건, 리스 조건 등">${esc(x ? x.terms || "" : "")}</textarea></div>
      <div class="form-row"><label>비고</label><input id="mc-note" value="${esc(x ? x.note || "" : "")}" maxlength="200"></div>
      <div class="modal-actions">
        ${x ? '<button class="btn btn-danger" id="mc-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="mc-cancel">취소</button>
        <button class="btn btn-primary" id="mc-save">저장</button>
      </div>`);
    $("#mc-cancel").onclick = closeModal;
    if (x) $("#mc-del").onclick = () => confirmModal(`계약 "${x.vendor}"을(를) 삭제하시겠습니까?`, () => {
      m.contracts = m.contracts.filter(c => c.id !== x.id);
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
    });
    $("#mc-save").onclick = () => {
      const vendor = $("#mc-vendor").value.trim();
      if (!vendor) { toast("업체명을 입력하세요.", true); return; }
      const rec = {
        vendor, scope: $("#mc-scope").value.trim(),
        feeMonthly: Number($("#mc-fee").value) || 0,
        units: Number($("#mc-units").value) || 0,
        freeMonths: Number($("#mc-free").value) || 0,
        partsOver: Number($("#mc-parts").value) || 0,
        terms: $("#mc-terms").value.trim(),
        note: $("#mc-note").value.trim()
      };
      if (x) Object.assign(x, rec);
      else m.contracts.push(Object.assign({ id: uid("mc") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  function contractsHTML(canWrite) {
    const cs = M().contracts;
    if (!cs.length) return '<div class="empty">등록된 유지보수 계약이 없습니다.' + (canWrite ? " '+ 계약 등록'으로 추가하세요." : "") + "</div>";
    const annual = cs.reduce((s, c) => s + (c.feeMonthly || 0) * (c.units || 0) * 12, 0);
    return `
      <div class="form-hint" style="margin:8px 0">정기 유지보수 연간 합계(계약 기준): <b>${fmtWon(annual)}원</b> + 수리/부품비 별도</div>
      ${cs.map(c => `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px;${canWrite ? "cursor:pointer" : ""}" ${canWrite ? `data-mc="${esc(c.id)}"` : ""}>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <b>💼 ${esc(c.vendor)}</b>
          <span class="badge badge-blue">${esc(c.scope || "-")}</span>
          <span style="font-size:.84rem">월 ${fmtWon(c.feeMonthly)}원/대 × ${c.units || 0}대 = <b>${fmtWon((c.feeMonthly || 0) * (c.units || 0))}원/월</b></span>
        </div>
        <div style="font-size:.8rem;color:var(--text-2);margin-top:4px">
          무상수리 ${c.freeMonths ? c.freeMonths + "개월" : "-"} · 이후 ${c.partsOver ? fmtWon(c.partsOver) + "원 이상 부품비 별도 청구" : "부품비 조건 미지정"}</div>
        ${c.terms ? `<div style="font-size:.8rem;color:var(--text-2);margin-top:4px;white-space:pre-wrap">${esc(c.terms)}</div>` : ""}
        ${c.note ? `<div style="font-size:.76rem;color:var(--text-3);margin-top:2px">${esc(c.note)}</div>` : ""}
      </div>`).join("")}`;
  }

  /* ─────── 비용 기록 탭 ─────── */
  function costForm(id) {
    const m = M();
    const x = id ? m.costs.find(c => c.id === id) : null;
    const defYM = new Date().toISOString().slice(0, 7);
    openModal(`
      <h3>${x ? "비용 기록 수정" : "비용 기록 추가"} <span class="badge badge-gray">보안장비</span></h3>
      <div class="form-grid">
        <div class="form-row"><label>귀속 월</label><input type="month" id="ct-ym" value="${esc(x ? x.ym : defYM)}"></div>
        <div class="form-row"><label>구분</label>
          <select id="ct-kind">${COST_KINDS.map(k => `<option ${(x ? x.kind : COST_KINDS[0]) === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>업체</label><input id="ct-vendor" value="${esc(x ? x.vendor || "" : "")}" maxlength="60" placeholder="예: 프로에스콤"></div>
        <div class="form-row"><label>금액 (원)</label><input type="number" id="ct-amount" min="0" value="${esc(x && x.amount != null ? x.amount : "")}" placeholder="예: 2610000"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>관련 장비 S/N (선택)</label><input id="ct-serial" value="${esc(x ? x.serial || "" : "")}" maxlength="40"></div>
        <div class="form-row"><label>메모</label><input id="ct-memo" value="${esc(x ? x.memo || "" : "")}" maxlength="200" placeholder="예: 드리프트튜브 Sys 교체"></div>
      </div>
      <div class="form-row"><label style="display:flex;gap:6px;align-items:center;font-weight:500;cursor:pointer">
          <input type="checkbox" id="ct-force" ${x && x.force ? "checked" : ""} style="width:auto;margin:0">
          청구 연동 중복 제외를 무시하고 항상 집계에 포함</label>
        <div class="form-hint">프로에스콤·인씨스는 대금 청구 관리 입력이 비용 기록에 자동 반영됩니다.
          같은 달 유지보수 청구가 있으면 이 수동 기록은 중복 계상 방지를 위해 집계에서 자동 제외되며, 별개 비용이면 체크하세요.</div></div>
      <div class="modal-actions">
        ${x ? '<button class="btn btn-danger" id="ct-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="ct-cancel">취소</button>
        <button class="btn btn-primary" id="ct-save">저장</button>
      </div>`);
    $("#ct-cancel").onclick = closeModal;
    if (x) $("#ct-del").onclick = () => confirmModal("이 비용 기록을 삭제하시겠습니까?", () => {
      m.costs = m.costs.filter(c => c.id !== x.id);
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
    });
    $("#ct-save").onclick = () => {
      const ym = $("#ct-ym").value;
      if (!/^\d{4}-\d{2}$/.test(ym)) { toast("귀속 월을 선택하세요.", true); return; }
      const amount = Number($("#ct-amount").value) || 0;
      const rec = { ym, kind: $("#ct-kind").value, vendor: $("#ct-vendor").value.trim(),
        amount, serial: $("#ct-serial").value.trim(), memo: $("#ct-memo").value.trim(),
        force: !!$("#ct-force").checked };
      if (x) Object.assign(x, rec);
      else m.costs.push(Object.assign({ id: uid("ct") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  // CARES 완료 수리 중 유상(isPaid) 부품 자동 집계 (완료일 기준 연도 귀속, customPrice 기재분)
  function caresPaidRows(year) {
    const rows = [];
    cares.repairs.forEach(r => {
      if (!r.resolvedAtMs) return;
      const d = new Date(r.resolvedAtMs);
      if (d.getFullYear() !== Number(year)) return;
      const paid = (r.parts || []).filter(p => p && p.isPaid);
      if (!paid.length) return;
      let sum = 0, unknown = 0;
      paid.forEach(p => {
        if (p.customPrice != null) sum += (Number(p.customPrice) || 0) * (Number(p.qty) || 1);
        else unknown++;
      });
      rows.push({ ym: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"),
        name: r.equipmentName, parts: paid.map(p => p.part).join(", "), sum, unknown });
    });
    return rows.sort((a, b) => b.ym.localeCompare(a.ym));
  }

  function caresCostBlock() {
    let body;
    if (typeof fetch === "undefined" || (!cares.ts && !cares.err)) body = '<div class="form-hint">CARES 연동 중…</div>';
    else if (cares.err) body = `<div class="form-hint">CARES 연동 불가: ${esc(cares.err)}</div>`;
    else {
      const rows = caresPaidRows(costYear);
      const total = rows.reduce((s2, r) => s2 + r.sum, 0);
      body = rows.length
        ? rows.map(r => `<div style="display:flex;gap:8px;align-items:center;padding:3px 0;font-size:.82rem">
            <span style="color:var(--text-3);white-space:nowrap">${esc(r.ym)}</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)} — ${esc(r.parts)}</span>
            <b style="white-space:nowrap">${fmtWon(r.sum)}원</b>${r.unknown ? `<span style="font-size:.72rem;color:var(--text-3)">+단가미기재 ${r.unknown}건</span>` : ""}
          </div>`).join("") +
          `<div style="text-align:right;font-size:.84rem;margin-top:4px;border-top:1px solid var(--border);padding-top:4px">연간 합계 <b>${fmtWon(total)}원</b></div>`
        : '<div class="form-hint">해당 연도 유상 수리 내역이 없습니다.</div>';
    }
    return `
      <div style="margin-top:14px;padding:10px 12px;border:1px dashed var(--border);border-radius:10px">
        <div style="font-size:.78rem;font-weight:700;color:var(--text-3);margin-bottom:4px">🔗 CARES 유상 수리비 자동 집계 (${costYear}년 · 참고용)</div>
        ${body}
        <div class="form-hint" style="margin-top:6px">CARES 수리 완료 시 유상 처리된 부품 비용을 완료일 기준으로 자동 표시합니다.
          위 월별 표는 실지출 수동 기록으로 별개 관리되며, 지출 확정 시 '+ 비용 기록'으로 등록하세요.</div>
      </div>`;
  }

  /* v2.17.2: 월 비용 변화 차트 — 장비별(ETD/X-ray/기타·수동) 그룹 막대 (인라인 SVG).
     사용자 피드백: 합계 꺾은선은 의미 없음 → 제거, ETD와 X-ray를 각각 비교 가능하게. */
  function costGroupOf(row) {
    if (row.auto) return row.vendor === "인씨스" ? "X-ray" : "ETD";
    const v = billingVendorOf(row.vendor);
    if (v === "프로에스콤") return "ETD";
    if (v === "인씨스") return "X-ray";
    const txt = String(row.memo || "") + " " + String(row.serial || "") + " " + String(row.vendor || "");
    if (/x-?ray/i.test(txt)) return "X-ray";
    if (/etd/i.test(txt)) return "ETD";
    return "기타/수동";
  }
  function costChartHTML(yc) {
    // 장비별 막대 + 성격별 스택: 아래 = 정기 유지보수(ETD 파랑/X-ray 녹색), 위 = 수리/부품(주황), 기타 성격 = 회색
    const GROUPS = [["ETD", "var(--primary)"], ["X-ray", "var(--success)"], ["기타/수동", "var(--text-3)"]];
    const REPAIR_COL = "var(--warning)", ETC_COL = "var(--text-3)";
    const kindKey = (k) => k === "정기 유지보수" ? "maint" : k === "수리/부품" ? "repair" : "etc";
    const byM = {};
    for (let i = 1; i <= 12; i++) {
      byM[i] = {};
      GROUPS.forEach(([g]) => { byM[i][g] = { maint: 0, repair: 0, etc: 0 }; });
    }
    yc.rows.concat(yc.autoRows || []).forEach(r => {
      const mo = Number(String(r.ym || "").slice(5, 7));
      if (byM[mo]) byM[mo][costGroupOf(r)][kindKey(r.kind)] += Number(r.amount) || 0;
    });
    const gTotal = (c) => c.maint + c.repair + c.etc;
    const vals = [];
    for (let i = 1; i <= 12; i++) vals.push(byM[i]);
    const used = GROUPS.filter(([g]) => vals.some(m => gTotal(m[g])));
    if (!used.length) return "";
    const max = Math.max.apply(null, vals.reduce((a, m) => a.concat(used.map(([g]) => gTotal(m[g]))), [1]));
    const W = 720, H = 200, top = 16, bot = 26, slot = W / 12;
    const bw = Math.min(18, (slot - 10) / used.length);
    const y = (v) => top + (H - top - bot) * (1 - v / max);
    const anyRepair = vals.some(m => used.some(([g]) => m[g].repair));
    const anyEtc = vals.some(m => used.some(([g]) => g !== "기타/수동" && m[g].etc));
    // 막대 상단 값 라벨 (백만원 단위 — 0.05M 미만은 생략)
    const lblOf = (v) => {
      const m = v / 1e6;
      if (m < 0.05) return "";
      return m >= 10 ? String(Math.round(m)) : String(Math.round(m * 10) / 10);
    };
    const bars = vals.map((m, i) => {
      const x0 = i * slot + (slot - bw * used.length) / 2;
      const segs = used.map(([g, col], j) => {
        const c = m[g];
        if (!gTotal(c)) return "";
        const x = (x0 + j * bw).toFixed(1);
        const cx = (x0 + j * bw + (bw - 1.5) / 2).toFixed(1);
        let acc = 0;
        // [값, 색, 라벨] — 아래부터 정기 → 수리/부품 → 기타
        const rects = [[c.maint, col, g + " 정기"], [c.repair, REPAIR_COL, g + " 수리/부품"], [c.etc, ETC_COL, g + " 기타"]]
          .map(([v, scol, lb]) => {
            if (!v) return "";
            const y1 = y(acc + v), h = y(acc) - y(acc + v);
            acc += v;
            return `<rect x="${x}" y="${y1.toFixed(1)}" width="${(bw - 1.5).toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="1.5" fill="${scol}" opacity=".88" style="pointer-events:all"><title>${i + 1}월 ${lb} ${fmtWon(v)}원 (합계 ${fmtWon(gTotal(c))}원)</title></rect>`;
          }).join("");
        const lbl = lblOf(gTotal(c));
        return rects + (lbl ? `<text x="${cx}" y="${(y(gTotal(c)) - 3).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--text-2)">${lbl}</text>` : "");
      }).join("");
      return `<g>${segs}<text x="${(i * slot + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-3)">${i + 1}월</text></g>`;
    }).join("");
    const legend = used.filter(([g]) => g !== "기타/수동").map(([g, col]) => [g + " 정기", col])
      .concat(anyRepair ? [["수리/부품", REPAIR_COL]] : [])
      .concat(used.some(([g]) => g === "기타/수동") || anyEtc ? [["기타/수동", ETC_COL]] : []);
    return `
      <div style="margin:4px 0 10px">
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:.72rem;color:var(--text-3);margin-bottom:2px">
          <span style="font-weight:700">📊 월 비용 변화 — 장비별 · 정기/수리부품 (${costYear}년 · 막대 위 숫자: 백만원)</span>
          ${legend.map(([lb, col]) => `<span style="display:inline-flex;align-items:center;gap:4px"><i style="width:9px;height:9px;border-radius:2px;background:${col};display:inline-block"></i>${lb}</span>`).join("")}
        </div>
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="월별 장비별 비용 차트" id="eq-cost-chart">
          <line x1="0" y1="${y(0).toFixed(1)}" x2="${W}" y2="${y(0).toFixed(1)}" stroke="var(--border)"></line>
          ${bars}
        </svg>
      </div>`;
  }

  function costsHTML(canWrite) {
    const yc = yearCosts(costYear);
    const monthRows = [];
    for (let i = 1; i <= 12; i++) {
      const r = yc.byM[i];
      monthRows.push(`<tr><td>${i}월</td>
        <td style="text-align:right">${r["정기 유지보수"] ? fmtWon(r["정기 유지보수"]) : "-"}</td>
        <td style="text-align:right">${r["수리/부품"] ? fmtWon(r["수리/부품"]) : "-"}</td>
        <td style="text-align:right">${r["기타"] ? fmtWon(r["기타"]) : "-"}</td>
        <td style="text-align:right"><b>${r.total ? fmtWon(r.total) : "-"}</b></td></tr>`);
    }
    const sum = (k) => Object.values(yc.byM).reduce((s, r) => s + r[k], 0);
    // 상세 목록: 수동 기록 + 청구 연동(자동) + 집계 제외(청구 중복) 통합, 월 내림차순
    const merged = yc.rows.map(c => ({ c, tag: "manual" }))
      .concat((yc.autoRows || []).map(c => ({ c, tag: "auto" })))
      .concat((yc.excluded || []).map(c => ({ c, tag: "excl" })))
      .sort((a, b) => String(b.c.ym).localeCompare(String(a.c.ym)));
    const detail = merged.map(({ c, tag }) => {
      const auto = tag === "auto", excl = tag === "excl";
      const attr = auto ? 'data-ct-bl="1" title="대금 청구 연동 항목 — 클릭 시 대금 청구 관리로 이동"'
        : (canWrite ? `data-ct="${esc(c.id)}" title="클릭하여 수정"` : "");
      return `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);font-size:.84rem;${(auto || canWrite) ? "cursor:pointer;" : ""}${excl ? "opacity:.55" : ""}" ${attr}>
        <span style="color:var(--text-3);white-space:nowrap">${esc(c.ym)}</span>
        <span class="badge ${c.kind === "정기 유지보수" ? "badge-blue" : c.kind === "수리/부품" ? "badge-red" : "badge-gray"}">${esc(c.kind)}</span>
        ${auto ? '<span class="badge badge-amber" style="font-size:.64rem">🧾 청구 연동</span>' : ""}
        ${excl ? '<span class="badge badge-gray" style="font-size:.64rem">집계 제외 · 청구 중복</span>' : ""}
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${excl ? "text-decoration:line-through" : ""}">${esc(c.vendor || "-")}${c.memo ? " · " + esc(c.memo) : ""}${c.serial ? ` <span style="color:var(--text-3)">(${esc(c.serial)})</span>` : ""}</span>
        <b style="white-space:nowrap;${excl ? "text-decoration:line-through" : ""}">${fmtWon(c.amount)}원</b>
      </div>`;
    }).join("");
    return `
      <div style="display:flex;align-items:center;gap:8px;margin:8px 0">
        <button class="btn btn-ghost btn-sm" id="cy-prev">◀</button>
        <b>${costYear}년</b>
        <button class="btn btn-ghost btn-sm" id="cy-next">▶</button>
        <span class="spacer"></span>
        <span style="font-size:.88rem">연간 합계 <b style="color:var(--primary)">${fmtWon(yc.total)}원</b></span>
      </div>
      ${costChartHTML(yc)}
      <div class="table-wrap"><table class="tbl" style="font-size:.84rem"><thead><tr>
        <th style="width:56px">월</th><th style="text-align:right">정기 유지보수</th>
        <th style="text-align:right">수리/부품</th><th style="text-align:right">기타</th><th style="text-align:right">계</th></tr></thead>
        <tbody>${monthRows.join("")}
        <tr style="font-weight:700;border-top:2px solid var(--border)"><td>합계</td>
          <td style="text-align:right">${fmtWon(sum("정기 유지보수"))}</td>
          <td style="text-align:right">${fmtWon(sum("수리/부품"))}</td>
          <td style="text-align:right">${fmtWon(sum("기타"))}</td>
          <td style="text-align:right">${fmtWon(yc.total)}</td></tr></tbody></table></div>
      <div style="font-size:.78rem;font-weight:700;color:var(--text-3);margin:12px 0 4px">기록 상세
        (수동 ${yc.rows.length}건 + 청구 연동 ${(yc.autoRows || []).length}건${(yc.excluded || []).length ? ` · 중복 제외 ${yc.excluded.length}건` : ""})</div>
      ${detail || '<div class="form-hint">해당 연도 비용 기록이 없습니다.</div>'}
      ${(yc.autoRows || []).length || (yc.excluded || []).length ? `<div class="form-hint" style="margin-top:4px">
        🧾 청구 연동: 프로에스콤 ETD·인씨스 X-ray 유지보수 청구가 월별 표에 자동 집계됩니다 (수정은 대금 청구 관리에서).
        같은 달·같은 업체의 수동 기록은 중복 계상 방지를 위해 자동 제외되며, 별개 비용은 기록 수정에서 '항상 집계에 포함'을 체크하세요.</div>` : ""}
      ${billingCostBlock()}
      ${caresCostBlock()}`;
  }

  /* v2.17: 협력업체 대금 청구(billing) 월별 정산표 — settle() 결과 그대로 자동 대입 + 이동 버튼 */
  function billingCostBlock() {
    if (!window.SemisBilling || !SeMIS.canEdit()) return "";
    const ms = SemisBilling.monthlySettles(costYear);
    const fw = SemisBilling.fmtWon;
    let body = '<div class="form-hint">해당 연도 업체 청구 입력이 없습니다.</div>';
    if (ms.length) {
      const maintOf = (s) => (s.byCat["ETD 유지보수"] || 0) + (s.byCat["X-ray 유지보수"] || 0);
      const guardOf = (s) => s.byCat["보안검색&경비"] || 0;
      const tot = { maint: 0, guard: 0, deduct: 0, net: 0 };
      const trs = ms.map(({ vendor, month, s }) => {
        tot.maint += maintOf(s); tot.guard += guardOf(s); tot.deduct += s.deduct; tot.net += s.net;
        return `<tr>
          <td style="white-space:nowrap">${esc(month.slice(5, 7))}월</td>
          <td style="white-space:nowrap">${esc(vendor)}</td>
          <td style="text-align:right">${maintOf(s) ? fw(maintOf(s)) : "-"}</td>
          <td style="text-align:right">${guardOf(s) ? fw(guardOf(s)) : "-"}</td>
          <td style="text-align:right;color:var(--danger)">${s.deduct ? "− " + fw(s.deduct) : "-"}</td>
          <td style="text-align:right"><b>${fw(s.net)}</b></td></tr>`;
      }).join("");
      body = `<div class="table-wrap"><table class="tbl" style="font-size:.8rem"><thead><tr>
          <th style="width:48px">월</th><th style="width:96px">업체</th>
          <th style="text-align:right">장비 유지보수</th><th style="text-align:right">보안검색&경비</th>
          <th style="text-align:right">기타 수익 차감</th><th style="text-align:right">실청구액</th></tr></thead>
        <tbody>${trs}
          <tr style="font-weight:700;border-top:2px solid var(--border)"><td colspan="2">합계</td>
            <td style="text-align:right">${fw(tot.maint)}</td>
            <td style="text-align:right">${fw(tot.guard)}</td>
            <td style="text-align:right;color:var(--danger)">− ${fw(tot.deduct)}</td>
            <td style="text-align:right">${fw(tot.net)}</td></tr></tbody></table></div>`;
    }
    return `
      <div style="margin-top:14px;padding:10px 12px;border:1px dashed var(--border);border-radius:10px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:.78rem;font-weight:700;color:var(--text-3)">🧾 협력업체 월별 정산 (${costYear}년 · 대금 청구 자동 반영)</span>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" id="eq-go-billing">대금 청구 관리 ↗</button>
        </div>
        ${body}
        <div class="form-hint" style="margin-top:6px">실청구액 = ETD/X-ray 유지보수 + 보안검색&경비 − 기타 수익(에어제타 몫 50% 기계산 입력분, 프로에스콤 계약).
          장비 유지보수분은 위 월별 비용 표에도 자동 집계됩니다.</div>
      </div>`;
  }

  /* ─────── 대시보드 위젯: 고장신고·배치 현황 (CARES) ─────── */
  async function renderDash(el) {
    if (!el) return;
    if (typeof fetch === "undefined") {
      el.innerHTML = '<div style="font-size:.8rem;color:var(--text-3)">오프라인 — CARES 연동 대기</div>';
      return;
    }
    el.innerHTML = '<div style="font-size:.8rem;color:var(--text-3)">CARES 장비 현황 불러오는 중…</div>';
    await loadCares();
    if (!el.isConnected) return;
    if (cares.err) {
      el.innerHTML = `<div style="font-size:.8rem;color:var(--text-3)">CARES 연동 불가: ${esc(cares.err)}</div>`;
      return;
    }
    const eqs = cares.equips;
    const act = cares.repairs.filter(r => !r.resolvedAtMs);
    const types = [["X-RAY", "X-ray"], ["ETD", "ETD"], ["WTMD", "WTMD"], ["HHMD", "HHMD"]];
    const chips = types.map(([t, lb]) => {
      const g = eqs.filter(e2 => e2.type === t);
      if (!g.length) return "";
      const bad = g.filter(e2 => e2.status === "broken").length;
      return `<span class="badge ${bad ? "badge-red" : "badge-green"}" style="font-size:.72rem">${lb} ${g.length}대${bad ? " · 고장 " + bad : ""}</span>`;
    }).filter(Boolean).join(" ");
    const actHTML = act.length ? act.slice(0, 5).map(r => {
      const rs = repairStatus(r);
      return `<div class="insp-dash-row" data-eq-dash style="display:flex;align-items:center;gap:6px;font-size:.8rem;padding:3px 0;cursor:pointer">
        <span class="badge ${RS_META[rs].cls}" style="flex-shrink:0">${RS_META[rs].label}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${esc(r.equipmentName)} — ${esc(r.symptom || "")}</span>
        <span style="font-size:.72rem;color:var(--danger);white-space:nowrap">${fmtElapsed(Date.now() - r.reportedAtMs)}</span>
      </div>`;
    }).join("") : '<div style="font-size:.8rem;color:var(--text-3);padding:2px 0">✅ 진행 중인 고장 신고가 없습니다.</div>';
    // 배치 현황: ETD 행방 중심 표시 — "ETD n @Xray n" / 고장 시 "ETD n 고장", X-ray는 고장 시에만 노출
    const shortLoc = (loc) => String(loc || "-").replace(/x-?ray\s*/i, "Xray ").replace(/\s*호기/, "").trim();
    const unitNo = (e2) => {
      const m = String(e2.name || "").match(/(\d+)\s*호기/) || String(e2.location || "").match(/(\d+)\s*호기/);
      return m ? m[1] : "?";
    };
    const chipBox = (inner, broken) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:.74rem;border:1px solid ${broken ? "var(--danger)" : "var(--border)"};border-radius:10px;padding:2px 8px;margin:2px 3px 0 0;${broken ? "color:var(--danger);font-weight:700;background:rgba(239,68,68,.06)" : ""}">${inner}</span>`;
    const dotSpan = (color) => `<span style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0"></span>`;
    const etdChips = eqs.filter(e2 => e2.type === "ETD")
      .sort((a, b) => Number(unitNo(a)) - Number(unitNo(b)))
      .map(e2 => {
        const broken = e2.status === "broken";
        const dot = broken ? "var(--danger)" : e2.status === "warning" ? "var(--warning)" : "var(--success)";
        const tail = broken ? " 고장" : ` <span style="color:var(--text-3);font-weight:400">@${esc(shortLoc(e2.location))}</span>`;
        return chipBox(`${dotSpan(dot)}ETD ${unitNo(e2)}${tail}`, broken);
      });
    const xrayChips = eqs.filter(e2 => e2.type === "X-RAY" && e2.status === "broken")
      .sort((a, b) => Number(unitNo(a)) - Number(unitNo(b)))
      .map(e2 => chipBox(`${dotSpan("var(--danger)")}Xray ${unitNo(e2)} 고장`, true));
    const locHTML = etdChips.concat(xrayChips).join("");
    el.innerHTML = `
      <div style="margin-bottom:6px">${chips || '<span style="font-size:.8rem;color:var(--text-3)">등록된 장비 없음</span>'}</div>
      <div style="font-size:.74rem;font-weight:700;color:var(--text-3);margin-bottom:2px">진행 중 고장 신고${act.length ? " (" + act.length + "건)" : ""}</div>
      ${actHTML}
      <div style="font-size:.74rem;font-weight:700;color:var(--text-3);margin:8px 0 2px">ETD 배치 현황 <span style="font-weight:400">(X-ray는 고장 시에만 표시)</span></div>
      <div>${locHTML || '<span style="font-size:.8rem;color:var(--text-3)">-</span>'}</div>`;
    $$("[data-eq-dash]", el).forEach(n => n.onclick = () => SeMIS.navigate("equipment"));
  }

  /* ─────── 모듈 렌더 ─────── */
  SeMIS.registerModule("equipment", {
    title: "보안장비 유지관리",
    render(root) {
      const canWrite = SeMIS.canEdit();
      const canConfid = SeMIS.roleRank() >= 3; // 대외비(계약·비용·구입가): hq 이상
      const s = stats();
      const tabs = canConfid
        ? [["list", "장비 대장"], ["contracts", "유지보수 계약"], ["costs", "비용 기록"]]
        : [["list", "장비 대장"]];
      if (!canConfid && tab !== "list") tab = "list";
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🔧 보안장비 유지관리</div>
          <span class="spacer"></span>
          ${canWrite && tab === "list" ? '<button class="btn btn-primary" id="eq-add">+ 장비 등록</button>' : ""}
          ${canWrite && tab === "contracts" ? '<button class="btn btn-primary" id="mc-add">+ 계약 등록</button>' : ""}
          ${canWrite && tab === "costs" ? '<button class="btn btn-primary" id="ct-add">+ 비용 기록</button>' : ""}
          <div class="page-desc">장비·고장·점검은 CARES 마스터 연동 · 내용연수(X-Ray 10년/ETD 5년) · 계약/비용은 SeMIS 기록</div>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-label">운용 장비</div><div class="stat-value">${s.total}</div><div class="stat-sub">폐기 제외</div></div>
          <div class="stat"><div class="stat-label">정상</div><div class="stat-value" style="color:var(--success)">${s.ok}</div><div class="stat-sub">내용연수 이내</div></div>
          <div class="stat"><div class="stat-label">내용연수 임박</div><div class="stat-value" style="color:var(--warning)">${s.due}</div><div class="stat-sub">1년 이내 · 만료</div></div>
          <div class="stat"><div class="stat-label">고장/수리중</div><div class="stat-value" style="color:var(--danger)">${s.broken}</div><div class="stat-sub">CARES 상태 반영</div></div>
        </div>
        <div class="card">
          <div class="cal-toolbar">
            <div class="cal-views">${tabs.map(([id, lb]) =>
              `<button class="cal-viewbtn${tab === id ? " active" : ""}" data-etab="${id}">${lb}</button>`).join("")}</div>
            <span class="spacer"></span>
            ${tab === "list" ? `<span id="eq-sync" style="font-size:.74rem;color:var(--text-3)"></span>
              <button class="btn btn-ghost btn-sm" id="eq-refresh" title="CARES 새로고침">⟳</button>` : ""}
          </div>
          ${tab === "list" ? `<div class="cal-toolbar">
            <input id="eq-search" class="ct-search" type="search" style="max-width:280px"
              placeholder="🔍 장비명 · 위치 · S/N 검색" value="${esc(query)}" autocomplete="off">
            <span class="spacer"></span>
            <div class="cal-views">${["전체", "내용연수임박", "고장/수리중", "폐기"].map(f =>
              `<button class="cal-viewbtn${stFilter === f ? " active" : ""}" data-efilter="${f}">${f}</button>`).join("")}</div>
          </div>` : ""}
          <div id="eq-body">${tab === "list" ? tableHTML() : tab === "contracts" ? contractsHTML(canWrite) : costsHTML(canWrite)}</div>
        </div>`;

      const wire = () => {
        $$("#eq-body [data-eq-row]").forEach(el => el.onclick = () => {
          canWrite ? eqForm(el.dataset.eqRow) : eqDetail(el.dataset.eqRow);
        });
        $$("#eq-body [data-cares-only]").forEach(el => el.onclick = () =>
          caresOnlyDetail(caresOnlyEquips()[Number(el.dataset.caresOnly)]));
        if (canWrite) {
          $$("#eq-body [data-mc]").forEach(el => el.onclick = () => contractForm(el.dataset.mc));
          $$("#eq-body [data-ct]").forEach(el => el.onclick = () => costForm(el.dataset.ct));
        }
        // 청구 연동 행 클릭 → 대금 청구 관리로 이동
        $$("#eq-body [data-ct-bl]").forEach(el => el.onclick = () => SeMIS.navigate("billing"));
      };
      const syncLabel = () => {
        const n = $("#eq-sync");
        if (!n) return;
        n.textContent = cares.err ? "CARES 연동 불가" :
          cares.ts ? "CARES " + cares.equips.length + "대 연동 · " + new Date(cares.ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) + " 갱신" : "CARES 연동 중…";
      };

      $$("[data-etab]").forEach(b => b.onclick = () => { tab = b.dataset.etab; SeMIS.renderView(); });
      if (tab === "list") {
        $("#eq-search").oninput = () => {
          query = $("#eq-search").value.trim();
          $("#eq-body").innerHTML = tableHTML(); wire();
        };
        $$("[data-efilter]").forEach(b => b.onclick = () => { stFilter = b.dataset.efilter; SeMIS.renderView(); });
        if (canWrite) $("#eq-add").onclick = () => eqForm(null);
        if ($("#eq-refresh")) $("#eq-refresh").onclick = () => { cares.ts = 0; SeMIS.renderView(); };
        syncLabel();
        // CARES 데이터 비동기 로드 후 목록/통계 갱신 (모듈 이탈 시 무시)
        if (typeof fetch !== "undefined") loadCares().then(() => {
          const body = $("#eq-body");
          if (!body || tab !== "list") return;
          body.innerHTML = tableHTML(); wire(); syncLabel();
          const s2 = stats();
          const vals = $$(".stat-row .stat-value");
          if (vals.length === 4) { vals[0].textContent = s2.total; vals[1].textContent = s2.ok; vals[2].textContent = s2.due; vals[3].textContent = s2.broken; }
        });
        else syncLabel();
      } else if (tab === "contracts" && canWrite) {
        $("#mc-add").onclick = () => contractForm(null);
      } else if (tab === "costs") {
        if (canWrite) $("#ct-add").onclick = () => costForm(null);
        $("#cy-prev").onclick = () => { costYear--; SeMIS.renderView(); };
        $("#cy-next").onclick = () => { costYear++; SeMIS.renderView(); };
        if ($("#eq-go-billing")) $("#eq-go-billing").onclick = () => SeMIS.navigate("billing");
        if (typeof fetch !== "undefined" && !cares.ts && !cares.err)
          loadCares().then(() => { if (tab === "costs" && $("#eq-body")) SeMIS.renderView(); });
      }
      wire();
    }
  });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisEquipment = {
    TYPES, STATUSES, TYPE_LIFE, addMonths,
    lifeBase, lifeYearsOf, replaceDue, isLifeDue,
    stats, list, yearCosts, renderDash, loadCares,
    setFilter: (f) => { stFilter = f; }, setQuery: (q) => { query = String(q || ""); },
    setTab: (t) => { tab = t; }, setCostYear: (y) => { costYear = Number(y) || new Date().getFullYear(); }
  };
})();
