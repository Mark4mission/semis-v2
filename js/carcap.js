/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 부적합·시정조치 위험관리 모듈 (CAR · CAP · FAT)  v2.29
   근거: TAC701 자체수준관리지침(R06) · KAB753 내부 안전심사 운영절차(R08)
         [별표1] 시정조치보고서(CAR) · ICAO Doc 8973 위험관리 프레임워크

   프로세스:
     [보안점검/지적] ─(발행 승인)─▶ [CAR 발행] ─▶ [CAP 수립/제출]
        ─(승인)─▶ [FAT 검증/종결] ─▶ [효과성 유지 확인]

   데이터: DATA.cars = [{ id, no, year, scope, target, domain, auditDate, inspId,
        classification, findingLevel, nonconformance, reference, auditor,
        risk:{L,S,band,score}, issuedDate, capDue, capSubmitted, fatDue, fatDone,
        effStart, effSustain, closedDate, extended,
        cap:{rootCause, action, duePlan}, mitigationResult, onsiteFix,
        signs:{carIssue,capCreate,capReview,capApprove,capAccept,fatVerify,closure},
        stage, attachments[], note }]
   설정: DATA.carCfg = { 기한·5x5 위험매트릭스·에스컬레이션 } (전부 설정에서 수정 가능)
   권한: 입력/열람 = 항공보안파트 이상(hq, canEdit). 대시보드 카드 = 보안관리자 이상(mgr).
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const pad2 = (n) => String(n).padStart(2, "0");

  /* ═══════════ 기본 설정 (규정 기반 · 전부 수정 가능) ═══════════ */
  // 항공보안파트 위험평가 매트릭스 기준(2026) — 셀별 위험수준 고정 배치(Lv5 심각 ~ Lv1 예방)
  const CELL_DEFAULT = {
    "5A": "lv5", "4A": "lv5", "5B": "lv5", "4B": "lv5",                         // 빨강 Lv5 심각
    "5C": "lv4", "4C": "lv4", "3B": "lv4", "3A": "lv4",                         // 오렌지 Lv4 경계
    "5E": "lv3", "5D": "lv3", "4D": "lv3", "3C": "lv3", "2B": "lv3", "2A": "lv3", "1A": "lv3", // 노랑 Lv3 주의
    "4E": "lv2", "3D": "lv2", "2D": "lv2", "2C": "lv2", "1B": "lv2",            // 파랑 Lv2 관심
    "3E": "lv1", "2E": "lv1", "1E": "lv1", "1D": "lv1", "1C": "lv1"             // 초록 Lv1 예방
  };
  const LEVEL_ORDER = ["lv5", "lv4", "lv3", "lv2", "lv1"];

  const DEFAULT_CFG = {
    capDueDays: 21,                                   // CAP 접수 마감(발행일+N일) — TAC701 4.2.1
    fatMonths:    { "시정": 1, "개선권고": 3, "현장시정": 0, "관찰사항": 0 }, // 완료기한(월) — TAC701 4.2.3
    fatMonthsMax: { "시정": 3, "개선권고": 6, "현장시정": 0, "관찰사항": 0 }, // 1회 연장 최대(월)
    effDays: 90,                                      // 효과성 유지 확인 기간(일) — KAB753 4.7 라
    ackDays: 7,                                       // 수검조직 접수확인(이의없음) 기한(발행+일)
    warnDays: 3,                                      // 마감 임박 경고(D-일)
    overdue: [                                        // 경과일 기준 에스컬레이션 — TAC701 4.2.4
      { over: 1,  label: "지연", band: "amber" },
      { over: 8,  label: "경고", band: "orange" },
      { over: 15, label: "심각", band: "red" }
    ],
    recurMonths: 12, recurCount: 4,                   // 다빈도 재발 집중관리 — KAB753 4.10
    likelihood: [                                     // 발생빈도(Y축) 5(매우 높음)~1(매우 낮음)
      { v: 5, label: "매우 높음", desc: "한 달 이내 재발 가능" },
      { v: 4, label: "높음",     desc: "6개월 이내 재발 가능" },
      { v: 3, label: "중간",     desc: "1년 이내 재발 가능" },
      { v: 2, label: "낮음",     desc: "10년 이내 재발 가능" },
      { v: 1, label: "매우 낮음", desc: "10년 이내 재발 가능성 낮음" }
    ],
    severity: [                                       // 심각도(X축) A(매우 높음)~E(매우 낮음) — 예상피해
      { v: "A", w: 5, label: "매우 높음", desc: "항공기 폭파 및 인명 사망" },
      { v: "B", w: 4, label: "높음",     desc: "항공기 손상·인명 중상·운항 중단" },
      { v: "C", w: 3, label: "중간",     desc: "지연 운항·인명 경상" },
      { v: "D", w: 2, label: "낮음",     desc: "점검 지적사항 또는 인적/물적 피해 없는 사고" },
      { v: "E", w: 1, label: "매우 낮음", desc: "권고 사항" }
    ],
    bands: [                                          // 위험수준 5단계 — 대응 조치 방안
      { key: "lv5", label: "Lv5 심각", color: "red",    action: "회사 종합 대응대책 수립·시행으로 위험요인 즉시 제거" },
      { key: "lv4", label: "Lv4 경계", color: "orange", action: "항공보안 자원 투입 등 보안 강화로 위험요인 감소 조치" },
      { key: "lv3", label: "Lv3 주의", color: "yellow", action: "항공보안 관련 규정·절차 보완 조치 시행" },
      { key: "lv2", label: "Lv2 관심", color: "blue",   action: "항공보안 감독 활동 강화를 통한 모니터링 수행" },
      { key: "lv1", label: "Lv1 예방", color: "green",  action: "현행 조치사항 유지를 통한 기본 보안 예방 조치" }
    ],
    cellOverride: CELL_DEFAULT                         // "5A" → 위험수준 key (셀별 배치)
  };

  function cfg() {
    const c = (D() && D().carCfg) || {};
    const out = Object.assign({}, DEFAULT_CFG, c);
    out.likelihood   = (c.likelihood && c.likelihood.length) ? c.likelihood : DEFAULT_CFG.likelihood;
    out.severity     = (c.severity && c.severity.length) ? c.severity : DEFAULT_CFG.severity;
    out.bands        = (c.bands && c.bands.length) ? c.bands : DEFAULT_CFG.bands;
    out.overdue      = (c.overdue && c.overdue.length) ? c.overdue : DEFAULT_CFG.overdue;
    out.fatMonths    = Object.assign({}, DEFAULT_CFG.fatMonths, c.fatMonths || {});
    out.fatMonthsMax = Object.assign({}, DEFAULT_CFG.fatMonthsMax, c.fatMonthsMax || {});
    out.cellOverride = (c.cellOverride && Object.keys(c.cellOverride).length) ? c.cellOverride : CELL_DEFAULT;
    out.domains      = (c.domains && c.domains.length) ? c.domains : DOMAINS;
    out.scopes       = (c.scopes && c.scopes.length) ? c.scopes : SCOPES;
    return out;
  }
  // 편집된 목록에서 빠진 기존 값도 드롭다운에 유지(과거 데이터 호환)
  const withCurrent = (list, cur) => (cur && list.indexOf(cur) < 0) ? list.concat([cur]) : list;
  function saveCfg(patch) {
    D().carCfg = Object.assign({}, cfg(), D().carCfg || {}, patch);
    SeMIS.save();
  }

  /* ═══════════ 상수 ═══════════ */
  const CLASSES = [
    { key: "시정",    full: "시정 (Finding)",           suffix: "F", badge: "badge-red" },
    { key: "개선권고", full: "개선권고 (Recommendation)", suffix: "R", badge: "badge-amber" },
    { key: "현장시정", full: "현장시정 (On-site)",        suffix: "C", badge: "badge-blue" },
    { key: "관찰사항", full: "관찰 (Observation)",        suffix: "O", badge: "badge-gray" }
  ];
  const classOf = (k) => CLASSES.find(c => c.key === k) || CLASSES[0];

  const STAGES = [
    { key: "지적", label: "지적",      badge: "badge-gray",   step: 0 },
    { key: "CAR",  label: "CAR 발행",  badge: "badge-blue",   step: 1 },
    { key: "CAP",  label: "CAP 제출",  badge: "badge-indigo", step: 2 },
    { key: "FAT",  label: "FAT 검증",  badge: "badge-amber",  step: 3 },
    { key: "종결", label: "종결",      badge: "badge-green",  step: 4 },
    { key: "기각", label: "기각·불요", badge: "badge-gray",   step: -1 }
  ];
  const FLOW = ["지적", "CAR", "CAP", "FAT", "종결"];
  const stageOf = (k) => STAGES.find(s => s.key === k) || STAGES[0];

  // 화물전용 항공사 기준 기본 분야(여객 항목 제외) — 설정에서 자유롭게 편집 가능
  const DOMAINS = ["화물보안", "보호구역·출입통제", "항공기 보안", "보안검색", "보안교육", "문서·규정", "보안장비", "우편·특송", "기타"];
  const SCOPES = ["국내", "해외", "본부·부문"];
  const LEVELS = ["", "Lvl 1", "Lvl 2", "Lvl 3"];

  const SIGN_SLOTS = [
    { key: "carIssue",   label: "CAR 발행 승인",  who: "심사주관(항공보안파트)", gate: "CAR" },
    { key: "orgAck",     label: "수검조직 접수확인", who: "수검조직(원격 서명)",    gate: "CAR" },
    { key: "capCreate",  label: "CAP 작성",        who: "수검조직 작성자",        gate: "CAP" },
    { key: "capReview",  label: "CAP 검토",        who: "수검조직 검토자",        gate: "CAP" },
    { key: "capApprove", label: "CAP 승인",        who: "수검조직 승인권자",      gate: "CAP" },
    { key: "capAccept",  label: "CAP 수리·승인",   who: "항공보안파트장",         gate: "FAT" },
    { key: "fatVerify",  label: "FAT 검증",        who: "심사관(효과성 평가)",    gate: "종결" },
    { key: "closure",    label: "종결 승인",        who: "항공보안파트장",         gate: "종결" }
  ];

  const BAND_HEX = {
    red:    { bg: "#fee2e2", bd: "#fca5a5", tx: "#991b1b" },
    orange: { bg: "#ffedd5", bd: "#fdba74", tx: "#9a3412" },
    amber:  { bg: "#fef3c7", bd: "#fcd34d", tx: "#92400e" },
    yellow: { bg: "#fef9c3", bd: "#fde047", tx: "#854d0e" },
    blue:   { bg: "#dbeafe", bd: "#93c5fd", tx: "#1e40af" },
    green:  { bg: "#dcfce7", bd: "#86efac", tx: "#166534" },
    gray:   { bg: "#f1f5f9", bd: "#cbd5e1", tx: "#475569" }
  };
  const bandBadge = { red: "badge-red", orange: "badge-orange", amber: "badge-amber", yellow: "badge-yellow", blue: "badge-blue", green: "badge-green", gray: "badge-gray" };

  /* ═══════════ 날짜 유틸 ═══════════ */
  function addDays(iso, n) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + Number(n || 0));
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function addMonths(iso, n) {
    if (!iso || !n) return "";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    const day = d.getDate();
    d.setMonth(d.getMonth() + Number(n));
    if (d.getDate() < day) d.setDate(0); // 말일 보정
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function daysBetween(fromIso, toIso) { // to - from (일)
    if (!fromIso || !toIso) return null;
    const a = new Date(fromIso + "T00:00:00"), b = new Date(toIso + "T00:00:00");
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
    return Math.round((b - a) / 86400000);
  }

  /* ═══════════ 위험 매트릭스 ═══════════ */
  function bandOf(L, S) {
    const c = cfg();
    const sev = c.severity.find(x => x.v === S);
    if (!sev || !L) return null;
    const score = Number(L) * sev.w;
    let key = c.cellOverride[String(L) + S];
    if (!key) {
      const sorted = c.bands.slice().sort((a, b) => b.min - a.min);
      const hit = sorted.find(b => score >= b.min);
      key = hit ? hit.key : c.bands[c.bands.length - 1].key;
    }
    const band = c.bands.find(b => b.key === key);
    return band ? { key: band.key, label: band.label, color: band.color, score }
                : { key: "", label: "", color: "gray", score };
  }
  function riskBadge(risk) {
    if (!risk || !risk.L || !risk.S) return '<span style="color:var(--text-3)">미평가</span>';
    const b = bandOf(risk.L, risk.S) || { color: "gray", label: "" };
    return `<span class="badge ${bandBadge[b.color] || "badge-gray"}" title="발생빈도 ${esc(String(risk.L))} · 심각도 ${esc(risk.S)} → ${esc(b.label)}">${esc(risk.L)}${esc(risk.S)} · ${esc(b.label)}</span>`;
  }
  /* 5x5 매트릭스 — 심각도(X축 E→A) × 발생빈도(Y축 5→1). mode: "picker" | "heat" | "config" */
  function matrixGrid(mode, opts) {
    opts = opts || {};
    const c = cfg();
    const sel = opts.sel || {};                 // {L,S}
    const counts = opts.counts || {};           // "3C" → n
    const sevsX = c.severity.slice().sort((a, b) => a.w - b.w);    // E..A (좌→우, 심각도 X축)
    const liksY = c.likelihood.slice().sort((a, b) => b.v - a.v);  // 5..1 (상→하, 발생빈도 Y축)
    let html = `<div class="rm-wrap"><table class="rm-grid"><thead><tr><th class="rm-corner">빈도 ＼ 심각도</th>`;
    sevsX.forEach(s => { html += `<th class="rm-sh" title="${esc(s.desc)}">${esc(s.v)}<span>${esc(s.label)}</span></th>`; });
    html += `</tr></thead><tbody>`;
    liksY.forEach(l => {
      html += `<tr><th class="rm-lh" title="${esc(l.desc)}">${l.v}<span>${esc(l.label)}</span></th>`;
      sevsX.forEach(s => {
        const b = bandOf(l.v, s.v) || { color: "gray", label: "", key: "" };
        const hx = BAND_HEX[b.color] || BAND_HEX.gray;
        const code = String(l.v) + s.v;
        const on = sel.L === l.v && sel.S === s.v;
        const cnt = counts[code] || 0;
        html += `<td class="rm-cell${on ? " on" : ""}" data-l="${l.v}" data-s="${esc(s.v)}"
          style="background:${hx.bg};border-color:${hx.bd};color:${hx.tx}"
          title="빈도 ${l.v}(${esc(l.label)}) × 심각도 ${esc(s.v)}(${esc(s.label)}) → ${esc(b.label)}">
          <span class="rm-code">${code}</span>
          ${mode === "heat" ? (cnt ? `<span class="rm-cnt">${cnt}</span>` : "") : `<span class="rm-score">${esc((b.key || "").replace("lv", "Lv"))}</span>`}
          ${on ? '<span class="rm-tick">✓</span>' : ""}
        </td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table>`;
    html += `<div class="rm-legend">` + c.bands.map(b => {
      const hx = BAND_HEX[b.color] || BAND_HEX.gray;
      return `<span class="rm-leg"><i style="background:${hx.bg};border-color:${hx.bd}"></i>${esc(b.label)}</span>`;
    }).join("") + `</div></div>`;
    return html;
  }
  // 위험수준별 대응 조치 방안 표 (picker/config 참고용)
  function levelActionsHTML() {
    return `<table class="rm-lvtbl"><tbody>${cfg().bands.map(b => {
      const hx = BAND_HEX[b.color] || BAND_HEX.gray;
      return `<tr><td style="background:${hx.bg};border-color:${hx.bd};color:${hx.tx};font-weight:800;white-space:nowrap">${esc(b.label)}</td><td>${esc(b.action || "")}</td></tr>`;
    }).join("")}</tbody></table>`;
  }

  /* ═══════════ 기한·에스컬레이션 계산 ═══════════ */
  const calcCapDue = (r) => r.capDue || (r.issuedDate ? addDays(r.issuedDate, cfg().capDueDays) : "");
  function calcFatDue(r) {
    if (r.fatDue) return r.fatDue;
    const base = r.capSubmitted || r.issuedDate;
    const m = cfg().fatMonths[r.classification] || 0;
    return (base && m) ? addMonths(base, m) : "";
  }
  const calcEffSustain = (r) => r.effSustain || (r.effStart ? addDays(r.effStart, cfg().effDays)
    : (r.fatDone ? addDays(r.fatDone, cfg().effDays) : ""));

  // 수검조직 접수확인(이의없음) — 발행+ackDays 이내 원격 서명
  const calcAckDue = (r) => r.issuedDate ? addDays(r.issuedDate, cfg().ackDays) : "";
  function ackInfo(r) {
    const acked = !!(r.signs && r.signs.orgAck);
    const due = calcAckDue(r);
    let overdue = false, days = null;
    if (due && !acked && r.stage !== "종결" && r.stage !== "기각") {
      days = daysBetween(todayISO(), due);
      overdue = days !== null && days < 0;
    }
    return { code: SeMIS.signCodeFor(r), acked, due, at: acked ? (r.signs.orgAck.at || "") : "", overdue, days };
  }

  function activeDeadline(r) {
    if (r.stage === "종결" || r.stage === "기각") return null;
    if (!r.capSubmitted) { const d = calcCapDue(r); return d ? { kind: "CAP 접수", date: d } : null; }
    if (!r.fatDone) { const d = calcFatDue(r); return d ? { kind: "FAT 완료", date: d } : null; }
    return null;
  }
  /* 반환: null(정상) | {state,band,days,over,kind,date} */
  function escLevel(r) {
    const ad = activeDeadline(r);
    if (!ad || !ad.date) return null;
    const dd = daysBetween(todayISO(), ad.date); // + 남음 / - 경과
    if (dd === null) return null;
    const c = cfg();
    if (dd < 0) {
      const over = -dd;
      const hit = c.overdue.slice().sort((a, b) => b.over - a.over).find(o => over >= o.over) || c.overdue[0];
      return { state: hit.label, band: hit.band, days: over, over: true, kind: ad.kind, date: ad.date };
    }
    if (dd <= c.warnDays) return { state: "임박", band: "amber", days: dd, over: false, kind: ad.kind, date: ad.date };
    return null;
  }
  function recurrence(r) {
    const c = cfg();
    const win = new Date(); win.setMonth(win.getMonth() - c.recurMonths);
    const winIso = win.toISOString().slice(0, 10);
    const same = (D().cars || []).filter(x => x.id !== r.id && x.target === r.target && x.domain === r.domain
      && ((x.auditDate || x.issuedDate || "") >= winIso));
    const count = same.length + 1;
    return { count, focus: count >= c.recurCount };
  }

  /* ═══════════ CAR 번호 자동생성 ═══════════ */
  function nextNo(rec) {
    const yy = String(rec.year || new Date().getFullYear()).slice(-2);
    const loc = (rec.locCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "") || "SEC";
    const dept = (rec.deptCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const suffix = classOf(rec.classification).suffix;
    const head = yy + "-" + loc;
    const nums = (D().cars || []).filter(c => c.no && c.no.indexOf(head) === 0)
      .map(c => { const m = c.no.match(/-(\d{1,3})[A-Z]?$/); return m ? Number(m[1]) : 0; });
    const seq = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
    return head + (dept ? "-" + dept : "") + "-" + pad2(seq) + suffix;
  }

  /* ═══════════ 목록/통계 ═══════════ */
  let year = new Date().getFullYear();
  let view = "list";     // list | matrix | board
  let fStage = "";       // 단계 필터
  let fDomain = "";      // 분야 필터
  let q = "";            // 검색어
  let fullscreen = false; // 전체화면(넓게 보기) — 세션 내 임시 상태

  // 전체화면: Esc 로 해제 (모달이 열려 있으면 모달 닫기 우선 — 캡처 단계 처리)
  if (typeof document !== "undefined") document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !fullscreen) return;
    const modal = document.getElementById("modal-overlay");
    if (modal && !modal.classList.contains("hidden")) return;
    fullscreen = false; SeMIS.renderView();
  }, true);

  const list = (y) => (D().cars || []).filter(x => (y == null || x.year === y));
  function filtered() {
    const qq = q.trim().toLowerCase();
    return list(year).filter(x =>
      (!fStage || x.stage === fStage) &&
      (!fDomain || x.domain === fDomain) &&
      (!qq || [x.no, x.target, x.nonconformance, x.reference, x.auditor, x.domain]
        .some(v => String(v || "").toLowerCase().includes(qq))))
      .sort((a, b) => String(b.auditDate || b.issuedDate || "").localeCompare(String(a.auditDate || a.issuedDate || ""))
        || String(b.no || "").localeCompare(String(a.no || "")));
  }
  function stats(y) {
    const items = list(y);
    const active = items.filter(x => x.stage !== "종결" && x.stage !== "기각");
    let overdue = 0, soon = 0;
    active.forEach(x => { const e = escLevel(x); if (e) { e.over ? overdue++ : soon++; } });
    return {
      total: items.length, active: active.length, overdue, soon,
      closed: items.filter(x => x.stage === "종결").length,
      extreme: active.filter(x => { const b = x.risk && bandOf(x.risk.L, x.risk.S); return b && (b.key === "lv5" || b.key === "lv4"); }).length
    };
  }

  /* ═══════════ 렌더: 목록 뷰 ═══════════ */
  function listHTML() {
    const items = filtered();
    if (!items.length) return '<div class="empty">해당 조건의 CAR 기록이 없습니다.</div>';
    return `<div class="table-wrap"><table class="tbl car-tbl"><thead><tr>
        <th style="width:38px">순번</th><th style="width:132px">CAR No.</th>
        <th style="width:96px">점검일</th><th>대상 · 부적합</th>
        <th style="width:96px">분야</th><th style="width:78px">분류</th>
        <th style="width:104px">위험도</th><th style="width:86px">단계</th>
        <th style="width:150px">기한 / 진행</th><th style="width:96px">담당</th>
      </tr></thead><tbody>
      ${items.map((x, i) => {
        const e = escLevel(x);
        const st = stageOf(x.stage);
        const ad = activeDeadline(x);
        const dueTxt = ad ? `${esc(ad.kind)} ${esc(ad.date)}` : (x.stage === "종결" ? "종결 " + esc(x.closedDate || "") : "-");
        return `<tr data-car="${esc(x.id)}" style="cursor:pointer">
          <td style="text-align:center;color:var(--text-3)">${x.seq || (i + 1)}</td>
          <td><b>${esc(x.no || "-")}</b></td>
          <td style="font-size:.82rem">${esc(x.auditDate || x.issuedDate || "-")}</td>
          <td><b>${esc(x.target || "-")}</b><div style="font-size:.78rem;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px">${esc(x.nonconformance || "")}</div></td>
          <td><span class="badge badge-gray">${esc(x.domain || "-")}</span></td>
          <td><span class="badge ${classOf(x.classification).badge}">${esc(x.classification || "-")}</span></td>
          <td>${riskBadge(x.risk)}</td>
          <td><span class="badge ${st.badge}">${esc(st.label)}</span></td>
          <td style="font-size:.8rem">
            <div>${esc(dueTxt)}</div>
            ${e ? `<span class="badge ${bandBadge[e.band]}" style="margin-top:2px">${e.over ? "⚠ " + esc(e.state) + " D+" + e.days : "⏰ 임박 D-" + e.days}</span>` : ""}
          </td>
          <td style="font-size:.8rem">${esc(x.auditor || "-")}</td>
        </tr>`;
      }).join("")}
      </tbody></table></div>`;
  }

  /* ═══════════ 렌더: 위험 매트릭스 뷰 ═══════════ */
  function matrixViewHTML() {
    const active = list(year).filter(x => x.stage !== "종결" && x.stage !== "기각" && x.risk && x.risk.L && x.risk.S);
    const counts = {};
    active.forEach(x => { const k = String(x.risk.L) + x.risk.S; counts[k] = (counts[k] || 0) + 1; });
    return `<p class="form-hint" style="margin-bottom:10px">진행 중 CAR ${active.length}건의 위험도 분포 — 셀의 숫자를 클릭하면 해당 위험도의 CAR 목록을 봅니다. (발생빈도 × 심각도)</p>
      ${matrixGrid("heat", { counts })}`;
  }

  /* ═══════════ 렌더: 프로세스 보드 뷰 ═══════════ */
  function boardHTML() {
    const items = filtered();
    return `<div class="car-board">${FLOW.map(sk => {
      const st = stageOf(sk);
      const col = items.filter(x => x.stage === sk);
      return `<div class="car-col">
        <div class="car-col-head"><span class="badge ${st.badge}">${esc(st.label)}</span><span class="car-col-n">${col.length}</span></div>
        <div class="car-col-body">${col.map(x => {
          const e = escLevel(x);
          return `<div class="car-card" data-car="${esc(x.id)}">
            <div class="car-card-no">${esc(x.no || "-")}</div>
            <div class="car-card-tg">${esc(x.target || "")}</div>
            <div class="car-card-nc">${esc(x.nonconformance || "")}</div>
            <div class="car-card-ft">${riskBadge(x.risk)}${e ? ` <span class="badge ${bandBadge[e.band]}">${e.over ? "⚠" + e.state : "⏰D-" + e.days}</span>` : ""}</div>
          </div>`;
        }).join("") || '<div class="car-col-empty">-</div>'}</div>
      </div>`;
    }).join("")}</div>`;
  }

  function bodyHTML() {
    return view === "matrix" ? matrixViewHTML() : view === "board" ? boardHTML() : listHTML();
  }

  /* ═══════════ 서명 패드 (웹/모바일 공용) ═══════════ */
  function openSignPad(title, sub, onSave) {
    openModal(`
      <h3>✍️ ${esc(title)}</h3>
      <div class="form-hint" style="margin-bottom:8px">${esc(sub || "")} — 아래 칸에 손가락 또는 마우스로 서명해 주세요.</div>
      <div class="form-row"><label>서명자 성명 / 직책</label>
        <input id="cr-sign-name" maxlength="40" placeholder="예: 최상일 프로 / 항공보안파트장" value="${esc((SeMIS.user && SeMIS.user.name) || "")}"></div>
      <div class="sign-pad-wrap"><canvas id="cr-sign-cv" class="sign-pad"></canvas></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cr-sign-clear" style="margin-right:auto">지우기</button>
        <button class="btn btn-ghost" id="cr-sign-cancel">취소</button>
        <button class="btn btn-primary" id="cr-sign-ok">서명 저장</button>
      </div>`);
    const cv = $("#cr-sign-cv");
    if (!cv) return;
    const wrapW = (cv.parentElement && cv.parentElement.clientWidth) || 300;
    const cssW = Math.max(240, Math.min(wrapW, 440));
    const cssH = 180;
    const ratio = window.devicePixelRatio || 1;
    cv.style.width = cssW + "px"; cv.style.height = cssH + "px";
    cv.width = Math.round(cssW * ratio); cv.height = Math.round(cssH * ratio);
    const ctx = cv.getContext ? cv.getContext("2d") : null;
    if (ctx) { ctx.scale(ratio, ratio); ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a"; }
    let drawing = false, hasDrawn = false, lx = 0, ly = 0;
    const pos = (ev) => { const r = cv.getBoundingClientRect(); const t = (ev.touches && ev.touches[0]) || ev; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
    const down = (ev) => { ev.preventDefault(); drawing = true; const p = pos(ev); lx = p.x; ly = p.y; };
    const moveFn = (ev) => { if (!drawing || !ctx) return; ev.preventDefault(); const p = pos(ev); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p.x, p.y); ctx.stroke(); lx = p.x; ly = p.y; hasDrawn = true; };
    const up = () => { drawing = false; };
    if (cv.addEventListener) {
      if (window.PointerEvent) {
        cv.addEventListener("pointerdown", down);
        cv.addEventListener("pointermove", moveFn);
        window.addEventListener("pointerup", up);
      } else {
        cv.addEventListener("touchstart", down, { passive: false });
        cv.addEventListener("touchmove", moveFn, { passive: false });
        window.addEventListener("touchend", up);
        cv.addEventListener("mousedown", down);
        cv.addEventListener("mousemove", moveFn);
        window.addEventListener("mouseup", up);
      }
    }
    const cleanup = () => { try { window.removeEventListener("pointerup", up); window.removeEventListener("touchend", up); window.removeEventListener("mouseup", up); } catch (e) {} };
    $("#cr-sign-clear").onclick = () => { if (ctx) ctx.clearRect(0, 0, cssW, cssH); hasDrawn = false; };
    $("#cr-sign-cancel").onclick = () => { cleanup(); closeModal(); };
    $("#cr-sign-ok").onclick = () => {
      const nm = $("#cr-sign-name").value.trim();
      if (!nm) { toast("서명자 성명을 입력해 주세요.", true); return; }
      if (!hasDrawn) { toast("서명을 입력해 주세요.", true); return; }
      const finish = (val) => { cleanup(); onSave({ name: nm, img: val, at: new Date().toISOString() }); };
      const dataFallback = () => { try { finish(cv.toDataURL("image/png")); } catch (e) { toast("서명 저장에 실패했습니다.", true); } };
      try {
        if (cv.toBlob && window.SemisSync && typeof fetch !== "undefined") {
          cv.toBlob((blob) => {
            if (!blob) return dataFallback();
            (async () => {
              try {
                const file = new File([blob], "carsign_" + Date.now() + ".png", { type: "image/png" });
                const up = await SemisSync.uploadFile(file, "car-sign");
                finish(up.url);
              } catch (e) { dataFallback(); }
            })();
          }, "image/png");
        } else dataFallback();
      } catch (e) { dataFallback(); }
    };
  }
  function signSlot(carId, slotKey) {
    const slot = SIGN_SLOTS.find(s => s.key === slotKey);
    if (!slot) return;
    openSignPad(slot.label, slot.who, (sign) => {
      const r = (D().cars || []).find(c => c.id === carId);
      if (!r) return;
      r.signs = r.signs || {};
      r.signs[slotKey] = Object.assign({ role: slot.who }, sign);
      r.updatedAt = new Date().toISOString();
      SeMIS.save(); closeModal(); toast(slot.label + " 서명이 저장되었습니다."); carDetail(carId);
    });
  }

  /* 자동 위험도 제안 — 부적합 내용·분류의 키워드 + 재발 이력 기반(제안이며 담당자가 확정) */
  function suggestRisk(ctx) {
    ctx = ctx || {};
    const text = ((ctx.nonconformance || "") + " " + (ctx.domain || "")).toLowerCase();
    const has = (re) => re.test(text);
    let S;
    if (has(/폭파|폭발물|사망|테러|불법방해|납치|하이재킹|피랍/)) S = "A";
    else if (has(/위해물품|무기|칼|총|폭발물|미탐지|검색\s*실패|반입|손상|중상|운항\s*중단/)) S = "B";
    else if (has(/봉인|누락|미적용|미제정|부재|지연|경상|위반|취약|실패|미준수/)) S = "C";
    else if ((ctx.classification || "") === "개선권고" || has(/권고/)) S = "E";
    else S = "D";
    const rc = Number(ctx.recurCount || 1);
    let L = rc >= 4 ? 5 : rc >= 2 ? 4 : 3;
    const b = bandOf(L, S);
    const sv = (cfg().severity.find(x => x.v === S) || {}).label || "";
    return { L: L, S: S, band: b.key, score: b.score,
      reason: `심각도 ${S}(${sv}) · 발생빈도 ${L}${rc >= 2 ? "(재발 " + rc + "건 반영)" : ""} → ${b.label}` };
  }

  /* ═══════════ 위험도 선택 (독립 오버레이 — CAR 폼을 파괴하지 않음) ═══════════ */
  function pickRisk(cur, cb, ctx) {
    ctx = ctx || {};
    let sel = cur ? { L: cur.L, S: cur.S } : {};
    const ov = document.createElement("div");
    ov.className = "modal-overlay cr-rm-overlay";
    ov.style.zIndex = "620";
    ov.innerHTML = `<div class="modal-box wide" style="max-height:88vh;overflow:auto">
      <h3>⚠️ 위험도 평가 (Risk Assessment)</h3>
      <div class="form-hint" style="margin-bottom:8px">심각도(X축, 예상피해)와 발생빈도(Y축, 가능성)가 만나는 셀을 선택하세요. 항공보안파트 위험평가 기준(5×5)입니다.</div>
      <div class="cr-rm-grid">${matrixGrid("picker", { sel })}</div>
      <div class="cr-rm-info2 cr-rm-info"></div>
      <details class="cr-rm-ref"><summary>📖 평가 기준 (예상피해 · 발생가능성 · 대응방안)</summary>
        <div class="cr-rm-refbody">
          <div><b>심각도 — 예상피해</b>${cfg().severity.map(s => `<div class="cr-rm-r"><span>${esc(s.v)} ${esc(s.label)}</span><em>${esc(s.desc)}</em></div>`).join("")}</div>
          <div><b>발생빈도 — 발생가능성</b>${cfg().likelihood.map(l => `<div class="cr-rm-r"><span>${l.v} ${esc(l.label)}</span><em>${esc(l.desc)}</em></div>`).join("")}</div>
        </div>
        <div style="margin-top:8px;font-weight:700;font-size:.8rem;color:var(--text-2)">위험수준별 대응 조치</div>
        ${levelActionsHTML()}
      </details>
      <div class="modal-actions">
        <button class="btn btn-ghost cr-rm-clear" style="margin-right:auto">평가 해제</button>
        ${ctx.classification ? '<button class="btn btn-ghost cr-rm-sug">🤖 자동 제안</button>' : ""}
        <button class="btn btn-ghost cr-rm-cancel">취소</button>
        <button class="btn btn-primary cr-rm-ok">적용</button>
      </div></div>`;
    document.body.appendChild(ov);
    const q1 = (s) => ov.querySelector(s);
    const qa1 = (s) => Array.from(ov.querySelectorAll(s));
    const onEsc = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); } };
    const close = () => { try { document.removeEventListener("keydown", onEsc, true); } catch (e) {} ov.remove(); };
    document.addEventListener("keydown", onEsc, true);
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });

    function paintInfo() {
      const box = q1(".cr-rm-info2");
      if (!box) return;
      if (!sel.L || !sel.S) { box.innerHTML = '<span style="color:var(--text-3)">선택된 셀이 없습니다.</span>'; return; }
      const b = bandOf(sel.L, sel.S);
      const hx = BAND_HEX[b.color] || BAND_HEX.gray;
      const c = cfg();
      const lk = c.likelihood.find(x => x.v === sel.L) || {};
      const sv = c.severity.find(x => x.v === sel.S) || {};
      const act = (c.bands.find(x => x.key === b.key) || {}).action || "";
      box.innerHTML = `<div style="padding:10px 12px;border-radius:8px;background:${hx.bg};border:1px solid ${hx.bd};color:${hx.tx}">
        <b>${sel.L}${esc(sel.S)}</b> · 발생빈도 <b>${sel.L} ${esc(lk.label || "")}</b> · 심각도 <b>${esc(sel.S)} ${esc(sv.label || "")}</b> → <b>${esc(b.label)}</b>
        <div style="font-size:.82rem;margin-top:3px">▸ ${esc(act)}</div></div>`;
    }
    function wireCells() {
      qa1(".cr-rm-grid .rm-cell").forEach(td => td.onclick = () => {
        sel = { L: Number(td.dataset.l), S: td.dataset.s };
        q1(".cr-rm-grid").innerHTML = matrixGrid("picker", { sel });
        wireCells(); paintInfo();
      });
    }
    wireCells(); paintInfo();
    const sug = q1(".cr-rm-sug");
    if (sug) sug.onclick = () => {
      const s = suggestRisk(ctx);
      sel = { L: s.L, S: s.S };
      q1(".cr-rm-grid").innerHTML = matrixGrid("picker", { sel });
      wireCells(); paintInfo();
      toast("자동 제안: " + s.reason);
    };
    q1(".cr-rm-clear").onclick = () => { cb(null); close(); };
    q1(".cr-rm-cancel").onclick = close;
    q1(".cr-rm-ok").onclick = () => {
      if (!sel.L || !sel.S) { toast("셀을 선택하거나 평가 해제를 누르세요.", true); return; }
      const b = bandOf(sel.L, sel.S);
      cb({ L: sel.L, S: sel.S, band: b.key, score: b.score });
      close();
    };
  }

  /* ═══════════ CAR 등록/수정 폼 ═══════════ */
  function carForm(id, preset) {
    const x = id ? (D().cars || []).find(c => c.id === id) : null;
    const p = preset || {};
    let risk = x && x.risk ? Object.assign({}, x.risk) : (p.risk || null);
    let files = x && x.attachments ? x.attachments.map(f => Object.assign({}, f)) : [];
    const insps = (D().inspections || []).slice().sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")));

    const g = (v) => esc(x ? (x[v] == null ? "" : x[v]) : (p[v] == null ? "" : p[v]));
    openModal(`
      <h3>${x ? "CAR 수정" : "CAR 등록"} <span class="badge badge-gray">${year}년</span></h3>
      <div class="cr-form">

        <div class="cr-sec">1. 기본 정보</div>
        <div class="form-grid">
          <div class="form-row"><label>연도</label><input type="number" id="cf-year" value="${x ? x.year : (p.year || year)}" min="2020" max="2100"></div>
          <div class="form-row"><label>구분</label><select id="cf-scope">${withCurrent(cfg().scopes, x ? x.scope : p.scope).map(s => `<option ${(x ? x.scope : p.scope) === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>점검 대상 (수검조직)</label><input id="cf-target" maxlength="60" value="${g("target")}" placeholder="예: FRASF, LSG, ProScom, 화물본부"></div>
          <div class="form-row"><label>부적합 분야</label><select id="cf-domain">${withCurrent(cfg().domains, x ? x.domain : p.domain).map(d => `<option ${(x ? x.domain : p.domain) === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></div>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>점검일 (심사일자)</label><input type="date" id="cf-audit" value="${g("auditDate")}"></div>
          <div class="form-row"><label>담당자 (심사관)</label><input id="cf-auditor" maxlength="60" value="${g("auditor")}" placeholder="예: 최상일, 이은우"></div>
        </div>
        <div class="form-row"><label>연계 보안점검 (선택)</label>
          <select id="cf-insp"><option value="">— 연계 안 함 —</option>${insps.map(s =>
            `<option value="${esc(s.id)}" ${x && x.inspId === s.id ? "selected" : ""}>${esc((s.start || "") + " · " + s.category + " · " + s.target)}</option>`).join("")}</select></div>

        <div class="cr-sec">2. 부적합 사항</div>
        <div class="form-grid">
          <div class="form-row"><label>분류</label><select id="cf-class">${CLASSES.map(c => `<option value="${c.key}" ${(x ? x.classification : p.classification) === c.key ? "selected" : ""}>${esc(c.full)}</option>`).join("")}</select></div>
          <div class="form-row"><label>Finding Level (KAB753)</label><select id="cf-level">${LEVELS.map(l => `<option ${(x ? x.findingLevel : "") === l ? "selected" : ""}>${l || "— 미지정 —"}</option>`).join("")}</select></div>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>지점코드</label><input id="cf-loc" maxlength="8" value="${g("locCode")}" placeholder="예: BKK, ICN, PSC" style="text-transform:uppercase"></div>
          <div class="form-row"><label>분야코드</label><input id="cf-dept" maxlength="8" value="${g("deptCode")}" placeholder="예: SU, OM, KF, HQ" style="text-transform:uppercase"></div>
        </div>
        <div class="form-row"><label>부적합 관리번호 (CAR No.)</label>
          <div class="cr-inline"><input id="cf-no" maxlength="40" value="${g("no")}" placeholder="예: 26-BKK-SU-01F">
          <button type="button" class="btn btn-ghost btn-sm" id="cf-no-auto">🔄 자동생성</button></div>
          <div class="form-hint">형식: 연도-지점-분야-순번+구분(F 시정/R 개선/C 현장/O 관찰)</div></div>
        <div class="form-row"><label>부적합 내용</label><textarea id="cf-nc" maxlength="1000" placeholder="발견된 부적합 사항을 구체적으로 기술">${g("nonconformance")}</textarea></div>
        <div class="form-row"><label>관련근거 (규정 조항)</label><textarea id="cf-ref" maxlength="600" style="min-height:56px" placeholder="예: 국가항공보안계획 8.9.3 / 자체보안계획 8.1.2 3) / TAC701 5.5">${g("reference")}</textarea></div>

        <div class="cr-sec">3. 위험평가 (Risk Assessment · 5×5)</div>
        <div class="form-row"><div id="cf-risk-box"></div>
          <div class="cr-inline" style="margin-top:6px">
            <button type="button" class="btn btn-ghost btn-sm" id="cf-risk-btn">⚠️ 위험도 평가/변경</button>
            <button type="button" class="btn btn-ghost btn-sm" id="cf-risk-sug" title="부적합 내용·분류·재발이력 기반 자동 제안">🤖 자동 제안</button>
          </div></div>

        <div class="cr-sec">4. 기한 관리 <span class="cr-sec-sub">(발행일 기준 자동 계산 · 직접 수정 가능)</span></div>
        <div class="form-grid">
          <div class="form-row"><label>CAR 발행일</label><input type="date" id="cf-issued" value="${g("issuedDate")}"></div>
          <div class="form-row"><label>CAP 접수 마감기한</label><input type="date" id="cf-capdue" value="${g("capDue")}"><div class="form-hint" id="cf-capdue-hint"></div></div>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>CAP 접수일 (회신일)</label><input type="date" id="cf-capsub" value="${g("capSubmitted")}"></div>
          <div class="form-row"><label>FAT 마감기한</label><input type="date" id="cf-fatdue" value="${g("fatDue")}"><div class="form-hint" id="cf-fatdue-hint"></div></div>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>FAT 완료일 (시정조치 이행)</label><input type="date" id="cf-fatdone" value="${g("fatDone")}"></div>
          <div class="form-row"><label>효과성 확인 시작일</label><input type="date" id="cf-effstart" value="${g("effStart")}"></div>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>효과성 유지 확인일</label><input type="date" id="cf-effsus" value="${g("effSustain")}"><div class="form-hint" id="cf-effsus-hint"></div></div>
          <div class="form-row"><label>종결일</label><input type="date" id="cf-closed" value="${g("closedDate")}"></div>
        </div>

        <div class="cr-sec">5. 시정조치 계획 (CAP) 및 결과</div>
        <div class="form-row"><label>근본원인 분석 (Root Cause)</label><textarea id="cf-root" maxlength="1000" style="min-height:56px" placeholder="부적합의 근본원인">${x && x.cap ? esc(x.cap.rootCause || "") : ""}</textarea></div>
        <div class="form-row"><label>개선 / 재발방지 대책 (Corrective &amp; Preventive Action)</label><textarea id="cf-action" maxlength="2000" placeholder="시정조치 및 재발방지 대책">${x && x.cap ? esc(x.cap.action || "") : ""}</textarea></div>
        <div class="form-row"><label>Mitigation Result (완화·조치 결과 / 효과성 요약)</label><textarea id="cf-mit" maxlength="1000" style="min-height:56px" placeholder="조치 결과 및 위험 완화 효과">${g("mitigationResult")}</textarea></div>
        <div class="form-row"><label>현장시정 내용 (해당 시)</label><input id="cf-onsite" maxlength="300" value="${g("onsiteFix")}"></div>

        <div class="cr-sec">6. 진행 단계 · 비고</div>
        <div class="form-grid">
          <div class="form-row"><label>단계</label><select id="cf-stage">${STAGES.map(s => `<option value="${s.key}" ${(x ? x.stage : "지적") === s.key ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></div>
          <div class="form-row"><label>순번 (표시용, 선택)</label><input type="number" id="cf-seq" value="${x && x.seq ? x.seq : ""}" placeholder="자동"></div>
        </div>
        <div class="form-row"><label>비고</label><input id="cf-note" maxlength="300" value="${g("note")}"></div>
        <div class="form-row"><label>첨부 (근거자료 · 사진 등)</label>
          <input type="file" id="cf-file" multiple>
          <div id="cf-files" class="cr-files"></div></div>
      </div>
      <div class="modal-actions">
        ${x ? '<button class="btn btn-danger" id="cf-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="cf-cancel">취소</button>
        <button class="btn btn-primary" id="cf-save">저장</button>
      </div>`);

    function paintRisk() {
      const box = $("#cf-risk-box");
      if (!box) return;
      if (!risk || !risk.L || !risk.S) { box.innerHTML = '<span style="color:var(--text-3);font-size:.85rem">위험도 미평가</span>'; return; }
      box.innerHTML = riskBadge(risk);
    }
    paintRisk();
    function riskCtx() {
      const target = $("#cf-target").value.trim(), domain = $("#cf-domain").value;
      const rc = recurrence({ id: x ? x.id : "__new__", target, domain, auditDate: $("#cf-audit").value || todayISO() }).count;
      return { classification: $("#cf-class").value, nonconformance: $("#cf-nc").value, domain, target, recurCount: rc };
    }
    $("#cf-risk-btn").onclick = () => pickRisk(risk, (r) => { risk = r; paintRisk(); }, riskCtx());
    $("#cf-risk-sug").onclick = () => { const s = suggestRisk(riskCtx()); risk = { L: s.L, S: s.S, band: s.band, score: s.score }; paintRisk(); toast("자동 제안 적용: " + s.reason); };

    function paintFiles() {
      const box = $("#cf-files"); if (!box) return;
      box.innerHTML = files.map((f, i) => `<span class="cr-file"><a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a><button type="button" data-fdel="${i}" title="삭제">✕</button></span>`).join("");
      $$("#cf-files [data-fdel]").forEach(b => b.onclick = () => { files.splice(Number(b.dataset.fdel), 1); paintFiles(); });
    }
    paintFiles();
    $("#cf-file").onchange = async (ev) => {
      const fl = Array.from(ev.target.files || []);
      for (const f of fl) {
        try {
          if (window.SemisSync && SemisSync.uploadFile) { const up = await SemisSync.uploadFile(f, "car-att"); files.push(up); }
          else toast("오프라인 상태에서는 첨부를 업로드할 수 없습니다.", true);
        } catch (e) { toast("첨부 업로드 실패: " + esc(f.name), true); }
      }
      paintFiles();
    };

    function hints() {
      const iss = $("#cf-issued").value, cls = $("#cf-class").value, sub = $("#cf-capsub").value;
      const cap = iss ? addDays(iss, cfg().capDueDays) : "";
      $("#cf-capdue-hint").textContent = cap ? "권장(발행+" + cfg().capDueDays + "일): " + cap : "";
      const base = sub || iss, m = cfg().fatMonths[cls] || 0;
      const fat = (base && m) ? addMonths(base, m) : "";
      $("#cf-fatdue-hint").textContent = fat ? "권장(" + (sub ? "회신" : "발행") + "+" + m + "개월): " + fat : (m ? "" : "완료기한 규정 없음(현장/관찰)");
      const es = $("#cf-effstart").value, fd = $("#cf-fatdone").value, base2 = es || fd;
      $("#cf-effsus-hint").textContent = base2 ? "권장(+" + cfg().effDays + "일): " + addDays(base2, cfg().effDays) : "";
    }
    ["cf-issued", "cf-class", "cf-capsub", "cf-effstart", "cf-fatdone"].forEach(id => { const el = $("#" + id); if (el) el.oninput = hints; });
    hints();

    $("#cf-no-auto").onclick = () => {
      const rec = { year: Number($("#cf-year").value) || year, locCode: $("#cf-loc").value, deptCode: $("#cf-dept").value, classification: $("#cf-class").value };
      $("#cf-no").value = nextNo(rec);
    };

    $("#cf-cancel").onclick = closeModal;
    if (x) $("#cf-del").onclick = () => confirmModal(`CAR "${esc(x.no || x.target)}"을(를) 삭제하시겠습니까?`, () => {
      D().cars = (D().cars || []).filter(c => c.id !== x.id);
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
    });

    $("#cf-save").onclick = () => {
      const target = $("#cf-target").value.trim();
      if (!target) { toast("점검 대상을 입력하세요.", true); return; }
      const lvl = $("#cf-level").value; const flvl = LEVELS.includes(lvl) ? lvl : "";
      const rec = {
        year: Number($("#cf-year").value) || year,
        scope: $("#cf-scope").value,
        target,
        domain: $("#cf-domain").value,
        auditDate: $("#cf-audit").value,
        auditor: $("#cf-auditor").value.trim(),
        inspId: $("#cf-insp").value || "",
        classification: $("#cf-class").value,
        findingLevel: flvl === "— 미지정 —" ? "" : flvl,
        locCode: $("#cf-loc").value.trim().toUpperCase(),
        deptCode: $("#cf-dept").value.trim().toUpperCase(),
        no: $("#cf-no").value.trim(),
        nonconformance: $("#cf-nc").value.trim(),
        reference: $("#cf-ref").value.trim(),
        risk: (risk && risk.L && risk.S) ? { L: risk.L, S: risk.S, band: bandOf(risk.L, risk.S).key, score: bandOf(risk.L, risk.S).score } : null,
        issuedDate: $("#cf-issued").value,
        capDue: $("#cf-capdue").value,
        capSubmitted: $("#cf-capsub").value,
        fatDue: $("#cf-fatdue").value,
        fatDone: $("#cf-fatdone").value,
        effStart: $("#cf-effstart").value,
        effSustain: $("#cf-effsus").value,
        closedDate: $("#cf-closed").value,
        cap: {
          rootCause: $("#cf-root").value.trim(),
          action: $("#cf-action").value.trim(),
          duePlan: (x && x.cap && x.cap.duePlan) || ""
        },
        mitigationResult: $("#cf-mit").value.trim(),
        onsiteFix: $("#cf-onsite").value.trim(),
        stage: $("#cf-stage").value,
        seq: Number($("#cf-seq").value) || (x ? x.seq : 0) || 0,
        note: $("#cf-note").value.trim(),
        attachments: files,
        updatedAt: new Date().toISOString()
      };
      let saved;
      if (x) { saved = Object.assign(x, rec); }
      else {
        rec.signs = {}; rec.createdAt = new Date().toISOString();
        if (!rec.seq) rec.seq = (list(rec.year).reduce((mx, c) => Math.max(mx, c.seq || 0), 0)) + 1;
        saved = Object.assign({ id: uid("car") }, rec);
        (D().cars = D().cars || []).push(saved);
      }
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ═══════════ 서명 그리드 (상세) ═══════════ */
  function signGridHTML(x, canWrite) {
    return `<div class="cr-signs">${SIGN_SLOTS.map(s => {
      const v = (x.signs || {})[s.key];
      return `<div class="cr-sign${v ? " done" : ""}">
        <div class="cr-sign-h"><b>${esc(s.label)}</b><span>${esc(s.who)}</span></div>
        <div class="cr-sign-b">${v
          ? `${v.img ? `<img src="${esc(v.img)}" alt="서명">` : ""}<div class="cr-sign-nm">${esc(v.name)}<br><span>${esc((v.at || "").slice(0, 10))}</span></div>`
          : '<span class="cr-sign-no">미서명</span>'}</div>
        ${canWrite ? `<button class="btn btn-ghost btn-sm" data-sign="${s.key}">${v ? "재서명" : "✍️ 서명"}</button>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  /* ═══════════ 프로세스 타임라인 (상세) ═══════════ */
  function timelineHTML(x) {
    const cur = stageOf(x.stage).step;
    const dates = {
      "지적": x.auditDate, "CAR": x.issuedDate, "CAP": x.capSubmitted,
      "FAT": x.fatDone, "종결": x.closedDate
    };
    return `<div class="cr-flow">${FLOW.map((sk, i) => {
      const st = stageOf(sk);
      const done = x.stage === "기각" ? false : st.step <= cur;
      return `<div class="cr-flow-step${done ? " done" : ""}${x.stage === sk ? " cur" : ""}">
        <div class="cr-flow-dot">${done ? "✓" : i + 1}</div>
        <div class="cr-flow-lb">${esc(st.label)}</div>
        <div class="cr-flow-dt">${esc(dates[sk] || "-")}</div>
      </div>${i < FLOW.length - 1 ? `<div class="cr-flow-line${st.step < cur ? " done" : ""}"></div>` : ""}`;
    }).join("")}</div>`;
  }

  /* ═══════════ CAR 상세 (문서 뷰 + 워크플로) ═══════════ */
  function carDetail(id) {
    const x = (D().cars || []).find(c => c.id === id);
    if (!x) return;
    const canWrite = SeMIS.canEdit();
    const e = escLevel(x);
    const rec = recurrence(x);
    const st = stageOf(x.stage);
    const capDue = calcCapDue(x), fatDue = calcFatDue(x), effSus = calcEffSustain(x);
    const ack = ackInfo(x);
    const row = (lb, val) => `<tr><td class="cr-dt-l">${lb}</td><td>${val}</td></tr>`;
    openModal(`
      <div class="cr-detail">
        <div class="cr-doc-head">
          <div>
            <h3 style="margin:0">📋 ${esc(x.no || "CAR")} <span class="badge ${st.badge}">${esc(st.label)}</span></h3>
            <div style="font-size:.82rem;color:var(--text-2);margin-top:2px">시정조치보고서 (Corrective Action Report) · ${esc(x.year)}년 · ${esc(x.scope || "")}</div>
          </div>
          <div class="cr-doc-risk">${riskBadge(x.risk)}</div>
        </div>

        ${(e || rec.focus) ? `<div class="cr-alert ${e ? (e.over ? "over" : "warn") : "focus"}">
          ${e ? `<b>${e.over ? "⚠ 기한 경과" : "⏰ 마감 임박"}</b> — ${esc(e.kind)} 기한 ${esc(e.date)} (${e.over ? "D+" + e.days : "D-" + e.days}) · 등급 <b>${esc(e.state)}</b>. ${e.over ? "재시정 요구/에스컬레이션 검토 필요 (TAC701 4.2.4)." : ""}` : ""}
          ${rec.focus ? `${e ? "<br>" : ""}<b>🔁 다빈도 재발</b> — 최근 ${cfg().recurMonths}개월 동일 대상·분야 ${rec.count}건 → 집중관리항목 검토 (KAB753 4.10).` : ""}
        </div>` : ""}

        ${canWrite && x.stage !== "종결" && x.stage !== "기각" && x.issuedDate ? `<div class="cr-ackbox ${ack.acked ? "ok" : ack.overdue ? "over" : ""}">
          <span class="cr-ack-ic">📱</span>
          <div class="cr-ack-body">${ack.acked
            ? `<b>수검조직 접수확인 완료</b> — ${esc((x.signs.orgAck && x.signs.orgAck.name) || "")} · ${esc((ack.at || "").slice(0, 10))} (이의 없음)`
            : `<b>수검조직 원격 접수확인 대기</b> — 모바일에서 <b>semis.pe.kr</b> 접속 → 코드 <b class="cr-ackcode">${esc(ack.code)}</b> 입력 → 접수확인 서명${ack.due ? ` · 기한 ${esc(ack.due)}${ack.days != null ? ` (${ack.days < 0 ? "D+" + (-ack.days) + " 경과" : "D-" + ack.days})` : ""}` : ""}`}</div>
          ${!ack.acked ? '<button class="btn btn-ghost btn-sm" id="cd-copycode">📋 코드 복사</button>' : ""}
        </div>` : ""}

        ${timelineHTML(x)}

        <table class="tbl cr-dt">
          ${row("점검 대상 / 분야", `<b>${esc(x.target || "-")}</b> · ${esc(x.domain || "-")}`)}
          ${row("심사일자 / 담당자", esc((x.auditDate || "-") + " · " + (x.auditor || "-")))}
          ${row("분류 / Level", `<span class="badge ${classOf(x.classification).badge}">${esc(classOf(x.classification).full)}</span> ${x.findingLevel ? '<span class="badge badge-gray">' + esc(x.findingLevel) + "</span>" : ""}`)}
          ${row("부적합 내용", esc(x.nonconformance || "-"))}
          ${row("관련근거", esc(x.reference || "-"))}
          ${row("위험평가", x.risk && x.risk.L ? `발생빈도 ${esc(x.risk.L)} × 심각도 ${esc(x.risk.S)} = 지수 ${bandOf(x.risk.L, x.risk.S).score} · ${riskBadge(x.risk)}` : "미평가")}
        </table>

        <div class="cr-sec2">시정조치 계획 (CAP)</div>
        <table class="tbl cr-dt">
          ${row("근본원인 분석", esc((x.cap && x.cap.rootCause) || "-"))}
          ${row("개선·재발방지 대책", `<div style="white-space:pre-wrap">${esc((x.cap && x.cap.action) || "-")}</div>`)}
          ${row("Mitigation Result", esc(x.mitigationResult || "-"))}
          ${x.onsiteFix ? row("현장시정", esc(x.onsiteFix)) : ""}
        </table>

        <div class="cr-sec2">기한 관리</div>
        <table class="tbl cr-dt cr-dt-grid">
          ${row("CAR 발행일", esc(x.issuedDate || "-"))}
          ${row("CAP 접수 마감", esc(capDue || "-") + (x.capDue ? "" : ' <span class="cr-auto">자동</span>'))}
          ${row("CAP 접수일", esc(x.capSubmitted || "-"))}
          ${row("FAT 마감", esc(fatDue || "-") + (x.fatDue ? "" : ' <span class="cr-auto">자동</span>'))}
          ${row("FAT 완료일", esc(x.fatDone || "-"))}
          ${row("효과성 확인 시작", esc(x.effStart || "-"))}
          ${row("효과성 유지 확인", esc(effSus || "-") + (x.effSustain ? "" : ' <span class="cr-auto">자동</span>'))}
          ${row("종결일", esc(x.closedDate || "-"))}
        </table>

        <div class="cr-sec2">승인 서명 (웹/모바일)</div>
        ${signGridHTML(x, canWrite)}

        ${(x.attachments && x.attachments.length) ? `<div class="cr-sec2">첨부</div><div class="cr-files">${x.attachments.map(f => `<span class="cr-file"><a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a></span>`).join("")}</div>` : ""}
        ${x.note ? `<div class="form-hint" style="margin-top:8px">비고: ${esc(x.note)}</div>` : ""}
      </div>
      <div class="modal-actions">
        ${canWrite && x.stage !== "종결" && x.stage !== "기각" ? `<button class="btn btn-ghost" id="cd-void" style="margin-right:auto">기각·개선불요</button>` : ""}
        <button class="btn btn-ghost" id="cd-close">닫기</button>
        ${canWrite ? `<button class="btn btn-ghost" id="cd-edit">수정</button>` : ""}
        ${canWrite && nextGate(x) ? `<button class="btn btn-primary" id="cd-adv">${esc(nextGate(x).label)} ▶</button>` : ""}
      </div>`, { wide: true });

    $("#cd-close").onclick = closeModal;
    if (canWrite) {
      $$(".cr-signs [data-sign]").forEach(b => b.onclick = () => signSlot(id, b.dataset.sign));
      const cc = $("#cd-copycode"); if (cc) cc.onclick = () => {
        const code = ack.code;
        try { const ta = document.createElement("textarea"); ta.value = code; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); } catch (e) {}
        try { if (navigator.clipboard) navigator.clipboard.writeText(code); } catch (e) {}
        toast("접수확인 코드가 복사되었습니다: " + code);
      };
      const ed = $("#cd-edit"); if (ed) ed.onclick = () => carForm(id);
      const vd = $("#cd-void"); if (vd) vd.onclick = () => confirmModal("이 CAR을 기각/개선불요로 종료하시겠습니까?", () => {
        x.stage = "기각"; x.closedDate = x.closedDate || todayISO(); x.updatedAt = new Date().toISOString();
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("기각 처리되었습니다.");
      });
      const av = $("#cd-adv"); if (av) av.onclick = () => advanceGate(id);
    }
  }

  /* ═══════════ 워크플로 게이트 진행 ═══════════ */
  function nextGate(x) {
    if (x.stage === "지적") return { to: "CAR", label: "CAR 발행", sign: "carIssue" };
    if (x.stage === "CAR") return { to: "CAP", label: "CAP 접수 처리", sign: "capAccept" };
    if (x.stage === "CAP") return { to: "FAT", label: "CAP 승인·이행", sign: null };
    if (x.stage === "FAT") return { to: "종결", label: "FAT 검증·종결", sign: "closure" };
    return null;
  }
  function advanceGate(id) {
    const x = (D().cars || []).find(c => c.id === id); if (!x) return;
    const gate = nextGate(x); if (!gate) return;

    if (gate.to === "CAR") {
      if (!x.risk || !x.risk.L) { toast("먼저 위험도를 평가하세요. (수정 → 위험평가)", true); return; }
      if (!x.issuedDate) x.issuedDate = todayISO();
      const apply = () => { x.stage = "CAR"; if (!x.capDue) x.capDue = calcCapDue(x); x.updatedAt = new Date().toISOString(); SeMIS.save(); closeModal(); toast("CAR이 발행되었습니다."); carDetail(id); };
      if (!(x.signs && x.signs.carIssue)) openSignPad("CAR 발행 승인", "심사주관(항공보안파트)", (sg) => { x.signs = x.signs || {}; x.signs.carIssue = Object.assign({ role: "심사주관" }, sg); apply(); });
      else apply();
      return;
    }
    if (gate.to === "CAP") {
      // CAP 접수 처리: 접수일 기록 + 수검조직 작성/검토/승인 서명 안내
      openModal(`
        <h3>CAP 접수 처리</h3>
        <div class="form-hint" style="margin-bottom:10px">수검조직이 회신한 시정조치계획(CAP)의 접수일을 기록합니다. 근본원인·대책은 [수정]에서, 수검조직 서명(작성/검토/승인)은 서명란에서 받습니다.</div>
        <div class="form-row"><label>CAP 접수일 (회신일)</label><input type="date" id="cg-sub" value="${esc(x.capSubmitted || todayISO())}"></div>
        <div class="modal-actions"><button class="btn btn-ghost" id="cg-cancel">취소</button><button class="btn btn-primary" id="cg-ok">접수 처리</button></div>`);
      $("#cg-cancel").onclick = () => carDetail(id);
      $("#cg-ok").onclick = () => {
        x.capSubmitted = $("#cg-sub").value || todayISO();
        x.stage = "CAP";
        if (!x.fatDue) x.fatDue = calcFatDue(x);
        x.updatedAt = new Date().toISOString();
        SeMIS.save(); closeModal(); toast("CAP이 접수되었습니다."); carDetail(id);
      };
      return;
    }
    if (gate.to === "FAT") {
      // CAP 승인 (항공보안파트장 수리) → 이행 단계
      const apply = () => { x.stage = "FAT"; x.updatedAt = new Date().toISOString(); SeMIS.save(); closeModal(); toast("CAP이 승인되어 이행(FAT) 단계로 이동했습니다."); carDetail(id); };
      if (!(x.signs && x.signs.capAccept)) openSignPad("CAP 수리·승인", "항공보안파트장", (sg) => { x.signs = x.signs || {}; x.signs.capAccept = Object.assign({ role: "항공보안파트장" }, sg); apply(); });
      else apply();
      return;
    }
    if (gate.to === "종결") {
      openModal(`
        <h3>FAT 검증 · 종결</h3>
        <div class="form-hint" style="margin-bottom:10px">시정조치 이행을 검증하고 효과성을 평가한 뒤 종결합니다. (KAB753 4.7 · Final Review and Acceptance)</div>
        <div class="form-grid">
          <div class="form-row"><label>FAT 완료일</label><input type="date" id="cg-fatdone" value="${esc(x.fatDone || todayISO())}"></div>
          <div class="form-row"><label>효과성 확인 시작일</label><input type="date" id="cg-eff" value="${esc(x.effStart || todayISO())}"></div>
        </div>
        <div class="form-row"><label>종결일</label><input type="date" id="cg-closed" value="${esc(x.closedDate || todayISO())}"></div>
        <div class="form-hint">효과성 유지 확인일은 효과성 확인 시작일 +${cfg().effDays}일로 자동 설정됩니다(수정 가능).</div>
        <div class="modal-actions"><button class="btn btn-ghost" id="cg-cancel">취소</button><button class="btn btn-primary" id="cg-ok">검증 서명 후 종결</button></div>`);
      $("#cg-cancel").onclick = () => carDetail(id);
      $("#cg-ok").onclick = () => {
        const fatDone = $("#cg-fatdone").value || todayISO();
        const eff = $("#cg-eff").value || fatDone;
        const closed = $("#cg-closed").value || todayISO();
        openSignPad("FAT 검증 (효과성 평가)", "심사관", (v1) => {
          openSignPad("종결 승인", "항공보안파트장", (v2) => {
            x.fatDone = fatDone; x.effStart = eff;
            if (!x.effSustain) x.effSustain = addDays(eff, cfg().effDays);
            x.closedDate = closed; x.stage = "종결";
            x.signs = x.signs || {};
            x.signs.fatVerify = Object.assign({ role: "심사관" }, v1);
            x.signs.closure = Object.assign({ role: "항공보안파트장" }, v2);
            x.updatedAt = new Date().toISOString();
            SeMIS.save(); closeModal(); toast("시정조치가 검증·종결되었습니다."); carDetail(id);
          });
        });
      };
      return;
    }
  }

  /* ═══════════ 설정 모달 (hq 이상) ═══════════ */
  function cfgModal() {
    const c = cfg();
    openModal(`
      <h3>⚙️ CAR 프로세스 설정</h3>
      <div class="form-hint" style="margin-bottom:10px">규정 개정 시 기한·위험 매트릭스·에스컬레이션 기준을 수정할 수 있습니다.</div>
      <div class="cr-sec">기한 (규정 기준값)</div>
      <div class="form-grid">
        <div class="form-row"><label>CAP 접수 마감 (발행+일)</label><input type="number" id="cs-capdays" value="${c.capDueDays}" min="1"></div>
        <div class="form-row"><label>효과성 유지 확인 (완료+일)</label><input type="number" id="cs-effdays" value="${c.effDays}" min="1"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>시정 완료기한 (개월)</label><input type="number" id="cs-fat-f" value="${c.fatMonths["시정"]}" min="0"></div>
        <div class="form-row"><label>개선권고 완료기한 (개월)</label><input type="number" id="cs-fat-r" value="${c.fatMonths["개선권고"]}" min="0"></div>
      </div>
      <div class="form-row"><label>수검조직 접수확인 기한 (발행+일, 이 기한 내 원격 서명=이의없음)</label><input type="number" id="cs-ackdays" value="${c.ackDays}" min="1"></div>
      <div class="cr-sec">에스컬레이션 (기한 경과일 기준)</div>
      <div class="form-grid">
        <div class="form-row"><label>임박 경고 (D-일 이내)</label><input type="number" id="cs-warn" value="${c.warnDays}" min="0"></div>
        <div class="form-row"><label>다빈도 재발 (개월/건수)</label><div class="cr-inline"><input type="number" id="cs-rmon" value="${c.recurMonths}" min="1" style="width:70px"> / <input type="number" id="cs-rcnt" value="${c.recurCount}" min="2" style="width:70px"></div></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>지연 (경과일≥)</label><input type="number" id="cs-o1" value="${c.overdue[0] ? c.overdue[0].over : 1}" min="1"></div>
        <div class="form-row"><label>경고 (경과일≥)</label><input type="number" id="cs-o2" value="${c.overdue[1] ? c.overdue[1].over : 8}" min="1"></div>
      </div>
      <div class="form-row"><label>심각 (경과일≥)</label><input type="number" id="cs-o3" value="${c.overdue[2] ? c.overdue[2].over : 15}" min="1"></div>

      <div class="cr-sec">위험 매트릭스 (5×5) <span class="cr-sec-sub">셀을 클릭하면 위험수준이 Lv5→Lv4→…→Lv1 순으로 바뀝니다 (기준 변경 대비)</span></div>
      <div id="cs-matrix"></div>
      <div class="cr-lvref">${levelActionsHTML()}</div>

      <div class="cr-sec">드롭다운 항목 편집 <span class="cr-sec-sub">(입력 폼의 선택지 — 추가/삭제)</span></div>
      <div class="form-row"><label>부적합 분야</label>
        <div id="cs-doms" class="cs-taglist"></div>
        <div class="cr-inline"><input id="cs-dom-new" maxlength="24" placeholder="새 분야 입력 후 Enter 또는 추가">
          <button type="button" class="btn btn-ghost btn-sm" id="cs-dom-add">+ 추가</button></div></div>
      <div class="form-row"><label>구분 (범위)</label>
        <div id="cs-scopes" class="cs-taglist"></div>
        <div class="cr-inline"><input id="cs-scope-new" maxlength="24" placeholder="새 구분 입력 후 Enter 또는 추가">
          <button type="button" class="btn btn-ghost btn-sm" id="cs-scope-add">+ 추가</button></div></div>

      <div class="modal-actions">
        <button class="btn btn-ghost" id="cs-reset" style="margin-right:auto">기본값 복원</button>
        <button class="btn btn-ghost" id="cs-cancel">취소</button>
        <button class="btn btn-primary" id="cs-save">저장</button>
      </div>`, { wide: true });

    let doms = cfg().domains.slice();
    let scps = cfg().scopes.slice();
    function paintTags() {
      $("#cs-doms").innerHTML = doms.map((d, i) => `<span class="cs-tag">${esc(d)}<button type="button" data-domdel="${i}" title="삭제">✕</button></span>`).join("") || '<span class="form-hint">항목이 없습니다.</span>';
      $("#cs-scopes").innerHTML = scps.map((s, i) => `<span class="cs-tag">${esc(s)}<button type="button" data-scdel="${i}" title="삭제">✕</button></span>`).join("") || '<span class="form-hint">항목이 없습니다.</span>';
      $$("#cs-doms [data-domdel]").forEach(b => b.onclick = () => { doms.splice(Number(b.dataset.domdel), 1); paintTags(); });
      $$("#cs-scopes [data-scdel]").forEach(b => b.onclick = () => { scps.splice(Number(b.dataset.scdel), 1); paintTags(); });
    }
    paintTags();
    const addDom = () => { const v = $("#cs-dom-new").value.trim(); if (v && doms.indexOf(v) < 0) { doms.push(v); $("#cs-dom-new").value = ""; paintTags(); } };
    const addScope = () => { const v = $("#cs-scope-new").value.trim(); if (v && scps.indexOf(v) < 0) { scps.push(v); $("#cs-scope-new").value = ""; paintTags(); } };
    $("#cs-dom-add").onclick = addDom;
    $("#cs-scope-add").onclick = addScope;
    $("#cs-dom-new").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addDom(); } };
    $("#cs-scope-new").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addScope(); } };

    let cells = Object.assign({}, cfg().cellOverride);
    function paintMatrix() {
      const prev = D().carCfg;
      D().carCfg = Object.assign({}, cfg(), { cellOverride: cells });
      $("#cs-matrix").innerHTML = matrixGrid("config", {});
      D().carCfg = prev;
      $$("#cs-matrix .rm-cell").forEach(td => td.onclick = () => {
        const code = td.dataset.l + td.dataset.s;
        const cur = cells[code] || LEVEL_ORDER[LEVEL_ORDER.length - 1];
        cells[code] = LEVEL_ORDER[(LEVEL_ORDER.indexOf(cur) + 1) % LEVEL_ORDER.length];
        paintMatrix();
      });
    }
    paintMatrix();

    $("#cs-cancel").onclick = closeModal;
    $("#cs-reset").onclick = () => confirmModal("모든 설정을 기본값(규정 기준)으로 복원하시겠습니까?", () => {
      D().carCfg = {}; SeMIS.save(); closeModal(); toast("기본값으로 복원되었습니다."); SeMIS.renderView();
    });
    $("#cs-save").onclick = () => {
      const patch = {
        capDueDays: Number($("#cs-capdays").value) || 21,
        effDays: Number($("#cs-effdays").value) || 90,
        ackDays: Number($("#cs-ackdays").value) || 7,
        warnDays: Number($("#cs-warn").value) || 3,
        recurMonths: Number($("#cs-rmon").value) || 12,
        recurCount: Number($("#cs-rcnt").value) || 4,
        fatMonths: Object.assign({}, c.fatMonths, { "시정": Number($("#cs-fat-f").value) || 0, "개선권고": Number($("#cs-fat-r").value) || 0 }),
        overdue: [
          { over: Number($("#cs-o1").value) || 1, label: "지연", band: "amber" },
          { over: Number($("#cs-o2").value) || 8, label: "경고", band: "orange" },
          { over: Number($("#cs-o3").value) || 15, label: "심각", band: "red" }
        ],
        cellOverride: Object.assign({}, cells),
        domains: doms.length ? doms.slice() : DOMAINS.slice(),
        scopes: scps.length ? scps.slice() : SCOPES.slice()
      };
      saveCfg(patch);
      closeModal(); toast("설정이 저장되었습니다."); SeMIS.renderView();
    };
  }

  /* ═══════════ 수검조직 원격 접수확인 서명 화면 (signer 세션) ═══════════ */
  function renderSigning(root, carId) {
    const r = (D().cars || []).find(c => c.id === carId);
    if (!r) { root.innerHTML = '<div class="empty">유효하지 않은 서명 링크입니다.</div>'; return; }
    const ack = r.signs && r.signs.orgAck;
    const due = calcAckDue(r);
    root.innerHTML = `
      <div class="cr-sign-page">
        <div class="cr-sign-phead">
          <div class="cr-sign-ptitle">📋 시정조치 접수확인</div>
          <div class="cr-sign-pmeta">${esc(r.no || "")} · 발행일 ${esc(r.issuedDate || "-")}${due ? " · 접수확인 기한 " + esc(due) : ""}</div>
        </div>
        <div class="cr-sign-card">
          <table class="tbl cr-dt">
            <tr><td class="cr-dt-l">수검조직</td><td><b>${esc(r.target || "-")}</b></td></tr>
            <tr><td class="cr-dt-l">분류</td><td><span class="badge ${classOf(r.classification).badge}">${esc(classOf(r.classification).full)}</span></td></tr>
            <tr><td class="cr-dt-l">부적합 내용</td><td>${esc(r.nonconformance || "-")}</td></tr>
            <tr><td class="cr-dt-l">관련근거</td><td>${esc(r.reference || "-")}</td></tr>
          </table>
          <div class="cr-sign-guide">위 시정조치 요구서(CAR)를 <b>접수·확인</b>하셨다면 아래에 서명해 주세요. 기한 내 서명은 <b>이의 없음(접수 확인)</b>으로 처리되어 시정조치계획(CAP) 단계로 진행됩니다.</div>
          <div class="cr-sign-act">
            ${ack
              ? `<div class="cr-sign-done2">${ack.img ? `<img src="${esc(ack.img)}" alt="서명">` : ""}<div>✅ <b>${esc(ack.name)}</b> · ${esc((ack.at || "").slice(0, 10))} 접수확인 완료</div></div>
                 <button class="btn btn-ghost btn-sm" id="crs-re">다시 서명</button>`
              : `<button class="btn btn-primary" id="crs-sign">✍️ 접수확인 서명</button>`}
          </div>
        </div>
        <div class="cr-sign-foot">서명은 저장 즉시 반영됩니다. 완료 후 창을 닫으셔도 됩니다.</div>
      </div>`;
    const doSign = () => openSignPad("수검조직 접수확인 서명", (r.target || "") + " — 이의 없음(접수 확인)", (sign) => {
      const rec = (D().cars || []).find(c => c.id === carId);
      if (!rec) return;
      rec.signs = rec.signs || {};
      rec.signs.orgAck = Object.assign({ role: "수검조직 접수확인" }, sign);
      rec.updatedAt = new Date().toISOString();
      SeMIS.save(); closeModal(); toast("접수확인 서명이 저장되었습니다."); SeMIS.renderView();
    });
    const b1 = $("#crs-sign"); if (b1) b1.onclick = doSign;
    const b2 = $("#crs-re"); if (b2) b2.onclick = doSign;
  }

  /* ═══════════ 모듈 렌더 ═══════════ */
  SeMIS.registerModule("carcap", {
    title: "부적합·시정조치 (CAR)",
    render(root) {
      const u = SeMIS.user;
      if (u && u.role === "signer" && u.signCarId) { renderSigning(root, u.signCarId); return; }
      const canWrite = SeMIS.canEdit();
      const s = stats(year);
      const yrs = Array.from(new Set((D().cars || []).map(c => c.year).concat([year, new Date().getFullYear()]))).sort((a, b) => b - a);
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">📋 부적합·시정조치 관리 <span style="font-size:.9rem;font-weight:600;color:var(--text-3)">CAR · CAP · FAT</span></div>
          <span class="spacer"></span>
          ${canWrite ? '<button class="btn btn-ghost btn-sm" id="car-cfg" title="프로세스 설정">⚙️ 설정</button>' : ""}
          ${canWrite ? '<button class="btn btn-primary" id="car-add">+ CAR 등록</button>' : ""}
          <div class="page-desc">SeMS 보안점검 부적합 → 위험평가 → 시정조치 → 검증/종결 (근거: TAC701 · KAB753 · ICAO Doc 8973)</div>
        </div>

        <div class="stat-row car-stats">
          <div class="stat" data-fstage=""><div class="stat-label">전체</div><div class="stat-value">${s.total}</div><div class="stat-sub">${year}년</div></div>
          <div class="stat"><div class="stat-label">진행 중</div><div class="stat-value" style="color:var(--primary)">${s.active}</div><div class="stat-sub">미종결</div></div>
          <div class="stat car-stat-alarm${s.overdue ? " on" : ""}"><div class="stat-label">기한 경과</div><div class="stat-value" style="color:var(--danger)">${s.overdue}</div><div class="stat-sub">에스컬레이션</div></div>
          <div class="stat${s.soon ? " car-stat-warn" : ""}"><div class="stat-label">마감 임박</div><div class="stat-value" style="color:var(--warning)">${s.soon}</div><div class="stat-sub">D-${cfg().warnDays} 이내</div></div>
          <div class="stat"><div class="stat-label">고위험 진행</div><div class="stat-value" style="color:#ea580c">${s.extreme}</div><div class="stat-sub">수용불가·조건부</div></div>
          <div class="stat" data-fstage="종결"><div class="stat-label">종결</div><div class="stat-value" style="color:var(--success)">${s.closed}</div><div class="stat-sub">완료</div></div>
        </div>

        <div class="card${fullscreen ? " car-fullscreen" : ""}">
          <div class="cal-toolbar car-toolbar">
            <select id="car-year" class="car-sel">${yrs.map(y => `<option value="${y}" ${y === year ? "selected" : ""}>${y}년</option>`).join("")}</select>
            <select id="car-fstage" class="car-sel"><option value="">단계 전체</option>${STAGES.map(st => `<option value="${st.key}" ${fStage === st.key ? "selected" : ""}>${esc(st.label)}</option>`).join("")}</select>
            <select id="car-fdomain" class="car-sel"><option value="">분야 전체</option>${cfg().domains.map(d => `<option ${fDomain === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>
            <input id="car-q" class="car-sel car-q" placeholder="🔍 CAR번호·대상·내용 검색" value="${esc(q)}">
            <span class="spacer"></span>
            <div class="cal-views">
              <button class="cal-viewbtn${view === "list" ? " active" : ""}" data-cview="list">목록</button>
              <button class="cal-viewbtn${view === "matrix" ? " active" : ""}" data-cview="matrix">위험 매트릭스</button>
              <button class="cal-viewbtn${view === "board" ? " active" : ""}" data-cview="board">프로세스 보드</button>
            </div>
            <button class="btn btn-ghost btn-sm car-fsbtn" id="car-fs" title="${fullscreen ? "전체화면 해제 (Esc)" : "전체화면으로 넓게 보기"}" aria-label="전체화면 전환">${fullscreen ? "⤡ 해제" : "⤢ 전체화면"}</button>
          </div>
          <div id="car-body">${bodyHTML()}</div>
        </div>`;

      if (canWrite) { $("#car-add").onclick = () => carForm(null, { year }); $("#car-cfg").onclick = cfgModal; }
      $("#car-year").onchange = (ev) => { year = Number(ev.target.value) || year; SeMIS.renderView(); };
      $("#car-fstage").onchange = (ev) => { fStage = ev.target.value; refresh(); };
      $("#car-fdomain").onchange = (ev) => { fDomain = ev.target.value; refresh(); };
      $("#car-q").oninput = (ev) => { q = ev.target.value; refresh(); };
      $$("[data-cview]").forEach(b => b.onclick = () => { view = b.dataset.cview; SeMIS.renderView(); });
      { const fsb = $("#car-fs"); if (fsb) fsb.onclick = () => { fullscreen = !fullscreen; SeMIS.renderView(); }; }
      $$(".car-stats [data-fstage]").forEach(el => el.onclick = () => { fStage = el.dataset.fstage; view = "list"; SeMIS.renderView(); });

      function refresh() {
        const body = $("#car-body"); if (body) body.innerHTML = bodyHTML();
        wireBody();
      }
      function wireBody() {
        $$("#car-body [data-car]").forEach(el => el.onclick = () => carDetail(el.dataset.car));
        if (view === "matrix") $$("#car-body .rm-cell").forEach(td => td.onclick = () => {
          // 해당 위험도의 진행 CAR 필터 목록
          const L = Number(td.dataset.l), S = td.dataset.s;
          const hits = list(year).filter(c => c.risk && c.risk.L === L && c.risk.S === S && c.stage !== "종결" && c.stage !== "기각");
          if (!hits.length) { toast("해당 위험도의 진행 중 CAR이 없습니다."); return; }
          if (hits.length === 1) carDetail(hits[0].id);
          else { view = "list"; q = L + S; SeMIS.renderView(); }
        });
      }
      wireBody();
    }
  });

  /* ═══════════ 외부/대시보드/테스트 노출 ═══════════ */
  function open(id) {
    if (!(D().cars || []).some(c => c.id === id)) return;
    carDetail(id);
  }
  function dashStats() { return stats(new Date().getFullYear()); }

  window.SemisCarcap = {
    DEFAULT_CFG, cfg, CLASSES, STAGES, FLOW, DOMAINS, SCOPES,
    bandOf, riskBadge, matrixGrid, suggestRisk, levelActionsHTML, CELL_DEFAULT,
    addDays, addMonths, daysBetween,
    calcCapDue, calcFatDue, calcEffSustain, calcAckDue, ackInfo, activeDeadline, escLevel, recurrence,
    nextNo, list, filtered, stats, dashStats, open, renderSigning,
    getYear: () => year, setYear: (y) => { year = Number(y) || year; },
    setView: (v) => { if (["list", "matrix", "board"].includes(v)) view = v; }
  };
})();
