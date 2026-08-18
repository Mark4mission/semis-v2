/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 부적합·시정조치 관리 (CAR)  v2.49
   근거: TAC701 자체수준관리지침(R06) · KAB753 내부 안전심사 운영절차(R08)
         ICAO Doc 8973 위험관리 프레임워크(5×5 위험평가)

   v2.49 단순화: 자체 CAR 발행·승인/서명 절차를 제거하고 "부적합 접수 → 조치 →
   종결" 3단계 추적으로 축소. 기한도 '조치기한' 하나로 통합. 위험평가는 유지.

   프로세스:
     [접수] ─(조치 착수)─▶ [조치중] ─(조치 완료)─▶ [종결]        (별도: 기각·개선불요)

   데이터: DATA.cars = [{ id, no, year, scope, target, domain, auditDate, inspId,
        classification, findingLevel, nonconformance, reference, auditor,
        risk:{L,S,band,score}, dueDate, doneDate,
        cap:{rootCause, action}, mitigationResult,
        stage, seq, attachments[], note }]
     ※ 구버전 필드(issuedDate/capDue/capSubmitted/fatDue/fatDone/effStart/
        effSustain/closedDate/signs)는 app.js normalizeData 에서 자동 변환되며
        원본은 보존만 하고 화면·로직에서 사용하지 않음.
   설정: DATA.carCfg = { 조치기한·5x5 위험매트릭스·에스컬레이션 } (전부 설정에서 수정 가능)
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
    dueDays: 30,                                      // 조치기한 기본값(점검일+N일) — 직접 수정 가능
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
    out.dueDays      = Number(c.dueDays) > 0 ? Number(c.dueDays) : DEFAULT_CFG.dueDays;
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

  /* v2.49: 3단계로 축소 (기존 지적/CAR → 접수, CAP/FAT → 조치중) */
  const STAGES = [
    { key: "접수",   label: "접수",      badge: "badge-gray",  step: 0 },
    { key: "조치중", label: "조치중",    badge: "badge-amber", step: 1 },
    { key: "종결",   label: "종결",      badge: "badge-green", step: 2 },
    { key: "기각",   label: "기각·불요", badge: "badge-gray",  step: -1 }
  ];
  const FLOW = ["접수", "조치중", "종결"];
  const stageOf = (k) => STAGES.find(s => s.key === k) || STAGES[0];
  const isClosed = (x) => x.stage === "종결" || x.stage === "기각";

  // 화물전용 항공사 기준 기본 분야(여객 항목 제외) — 설정에서 자유롭게 편집 가능
  const DOMAINS = ["화물보안", "보호구역·출입통제", "항공기 보안", "보안검색", "보안교육", "문서·규정", "보안장비", "우편·특송", "기타"];
  const SCOPES = ["국내", "해외", "본부·부문"];
  const LEVELS = ["", "Lvl 1", "Lvl 2", "Lvl 3"];

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

  /* ═══════════ 기한·에스컬레이션 계산 (v2.49: '조치기한' 단일화) ═══════════ */
  // 조치기한 — 직접 입력값 우선, 없으면 구버전 필드, 그래도 없으면 점검일+기본일수
  function calcDue(r) {
    if (!r) return "";
    return r.dueDate || r.fatDue || r.capDue || (r.auditDate ? addDays(r.auditDate, cfg().dueDays) : "");
  }
  const calcDone = (r) => (r && (r.doneDate || r.fatDone || r.closedDate)) || "";

  function activeDeadline(r) {
    if (isClosed(r)) return null;
    const d = calcDue(r);
    return d ? { kind: "조치기한", date: d } : null;
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
      && ((x.auditDate || "") >= winIso));
    const count = same.length + 1;
    return { count, focus: count >= c.recurCount };
  }

  /* ═══════════ 관리번호 자동생성 (v2.49: 연도-순번 단순 체계) ═══════════ */
  function nextNo(rec) {
    const yy = String((rec && rec.year) || new Date().getFullYear()).slice(-2);
    const head = yy + "-";
    const nums = (D().cars || []).filter(c => c.no && String(c.no).indexOf(head) === 0)
      .map(c => { const m = String(c.no).match(/-(\d{1,3})$/); return m ? Number(m[1]) : 0; });
    const seq = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
    return head + pad2(seq);
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
      .sort((a, b) => String(b.auditDate || "").localeCompare(String(a.auditDate || ""))
        || String(b.no || "").localeCompare(String(a.no || "")));
  }
  function stats(y) {
    const items = list(y);
    const active = items.filter(x => !isClosed(x));
    let overdue = 0, soon = 0;
    active.forEach(x => { const e = escLevel(x); if (e) { e.over ? overdue++ : soon++; } });
    return {
      total: items.length, active: active.length, overdue, soon,
      recv: items.filter(x => x.stage === "접수").length,
      acting: items.filter(x => x.stage === "조치중").length,
      closed: items.filter(x => x.stage === "종결").length,
      extreme: active.filter(x => { const b = x.risk && bandOf(x.risk.L, x.risk.S); return b && (b.key === "lv5" || b.key === "lv4"); }).length
    };
  }

  /* ═══════════ 렌더: 목록 뷰 ═══════════ */
  function listHTML() {
    const items = filtered();
    if (!items.length) return '<div class="empty">해당 조건의 부적합 기록이 없습니다.</div>';
    return `<div class="table-wrap"><table class="tbl car-tbl"><thead><tr>
        <th style="width:38px">순번</th><th style="width:96px">관리번호</th>
        <th style="width:96px">점검일</th><th>대상 · 부적합</th>
        <th style="width:96px">분야</th><th style="width:78px">분류</th>
        <th style="width:104px">위험도</th><th style="width:78px">단계</th>
        <th style="width:150px">조치기한 / 진행</th><th style="width:96px">담당</th>
      </tr></thead><tbody>
      ${items.map((x, i) => {
        const e = escLevel(x);
        const st = stageOf(x.stage);
        const ad = activeDeadline(x);
        const dueTxt = ad ? esc(ad.date) : (x.stage === "종결" ? "완료 " + esc(calcDone(x) || "") : "-");
        return `<tr data-car="${esc(x.id)}" style="cursor:pointer">
          <td style="text-align:center;color:var(--text-3)">${x.seq || (i + 1)}</td>
          <td><b>${esc(x.no || "-")}</b></td>
          <td style="font-size:.82rem">${esc(x.auditDate || "-")}</td>
          <td><b>${esc(x.target || "-")}</b><div style="font-size:.78rem;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px">${esc(x.nonconformance || "")}</div></td>
          <td><span class="badge badge-gray">${esc(x.domain || "-")}</span></td>
          <td><span class="badge ${classOf(x.classification).badge}">${esc(x.classification || "-")}</span></td>
          <td>${riskBadge(x.risk)}</td>
          <td><span class="badge ${st.badge}">${esc(st.label)}</span></td>
          <td style="font-size:.8rem">
            <div>${dueTxt}</div>
            ${e ? `<span class="badge ${bandBadge[e.band]}" style="margin-top:2px">${e.over ? "⚠ " + esc(e.state) + " D+" + e.days : "⏰ 임박 D-" + e.days}</span>` : ""}
          </td>
          <td style="font-size:.8rem">${esc(x.auditor || "-")}</td>
        </tr>`;
      }).join("")}
      </tbody></table></div>`;
  }

  /* ═══════════ 렌더: 위험 매트릭스 뷰 ═══════════ */
  function matrixViewHTML() {
    const active = list(year).filter(x => !isClosed(x) && x.risk && x.risk.L && x.risk.S);
    const counts = {};
    active.forEach(x => { const k = String(x.risk.L) + x.risk.S; counts[k] = (counts[k] || 0) + 1; });
    return `<p class="form-hint" style="margin-bottom:10px">진행 중 부적합 ${active.length}건의 위험도 분포 — 셀의 숫자를 클릭하면 해당 위험도의 목록을 봅니다. (발생빈도 × 심각도)</p>
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

  /* ═══════════ 위험도 선택 (독립 오버레이 — 등록 폼을 파괴하지 않음) ═══════════ */
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

  /* ═══════════ 부적합 등록/수정 폼 ═══════════ */
  function carForm(id, preset) {
    const x = id ? (D().cars || []).find(c => c.id === id) : null;
    const p = preset || {};
    let risk = x && x.risk ? Object.assign({}, x.risk) : (p.risk || null);
    let files = x && x.attachments ? x.attachments.map(f => Object.assign({}, f)) : [];
    const insps = (D().inspections || []).slice().sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")));

    const g = (v) => esc(x ? (x[v] == null ? "" : x[v]) : (p[v] == null ? "" : p[v]));
    openModal(`
      <h3>${x ? "부적합 수정" : "부적합 등록"} <span class="badge badge-gray">${year}년</span></h3>
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
          <div class="form-row"><label>점검일 (지적 접수일)</label><input type="date" id="cf-audit" value="${g("auditDate")}"></div>
          <div class="form-row"><label>담당자 (점검자)</label><input id="cf-auditor" maxlength="60" value="${g("auditor")}" placeholder="예: 최상일, 이은우"></div>
        </div>
        <div class="form-row"><label>연계 보안점검 (선택)</label>
          <select id="cf-insp"><option value="">— 연계 안 함 —</option>${insps.map(s =>
            `<option value="${esc(s.id)}" ${x && x.inspId === s.id ? "selected" : ""}>${esc((s.start || "") + " · " + s.category + " · " + s.target)}</option>`).join("")}</select></div>

        <div class="cr-sec">2. 부적합 사항</div>
        <div class="form-grid">
          <div class="form-row"><label>분류</label><select id="cf-class">${CLASSES.map(c => `<option value="${c.key}" ${(x ? x.classification : p.classification) === c.key ? "selected" : ""}>${esc(c.full)}</option>`).join("")}</select></div>
          <div class="form-row"><label>Finding Level (KAB753)</label><select id="cf-level">${LEVELS.map(l => `<option ${(x ? x.findingLevel : "") === l ? "selected" : ""}>${l || "— 미지정 —"}</option>`).join("")}</select></div>
        </div>
        <div class="form-row"><label>관리번호 (선택)</label>
          <div class="cr-inline"><input id="cf-no" maxlength="40" value="${g("no")}" placeholder="예: 26-01 또는 외부 점검기관 부여 번호">
          <button type="button" class="btn btn-ghost btn-sm" id="cf-no-auto">🔄 자동생성</button></div>
          <div class="form-hint">외부에서 받은 번호가 있으면 그대로 입력하고, 없으면 자동생성(연도-순번)을 쓰세요.</div></div>
        <div class="form-row"><label>부적합 내용</label><textarea id="cf-nc" maxlength="1000" placeholder="발견된 부적합 사항을 구체적으로 기술">${g("nonconformance")}</textarea></div>
        <div class="form-row"><label>관련근거 (규정 조항)</label><textarea id="cf-ref" maxlength="600" style="min-height:56px" placeholder="예: 국가항공보안계획 8.9.3 / 자체보안계획 8.1.2 3) / TAC701 5.5">${g("reference")}</textarea></div>

        <div class="cr-sec">3. 위험평가 (Risk Assessment · 5×5)</div>
        <div class="form-row"><div id="cf-risk-box"></div>
          <div class="cr-inline" style="margin-top:6px">
            <button type="button" class="btn btn-ghost btn-sm" id="cf-risk-btn">⚠️ 위험도 평가/변경</button>
            <button type="button" class="btn btn-ghost btn-sm" id="cf-risk-sug" title="부적합 내용·분류·재발이력 기반 자동 제안">🤖 자동 제안</button>
          </div></div>

        <div class="cr-sec">4. 시정조치</div>
        <div class="form-grid">
          <div class="form-row"><label>조치기한</label><input type="date" id="cf-due" value="${g("dueDate")}"><div class="form-hint" id="cf-due-hint"></div></div>
          <div class="form-row"><label>조치 완료일</label><input type="date" id="cf-done" value="${g("doneDate")}"></div>
        </div>
        <div class="form-row"><label>근본원인 분석 (Root Cause)</label><textarea id="cf-root" maxlength="1000" style="min-height:56px" placeholder="부적합의 근본원인">${x && x.cap ? esc(x.cap.rootCause || "") : ""}</textarea></div>
        <div class="form-row"><label>시정 / 재발방지 대책</label><textarea id="cf-action" maxlength="2000" placeholder="시정조치 및 재발방지 대책">${x && x.cap ? esc(x.cap.action || "") : ""}</textarea></div>
        <div class="form-row"><label>조치 결과</label><textarea id="cf-mit" maxlength="1000" style="min-height:56px" placeholder="조치 결과 및 위험 완화 효과">${g("mitigationResult")}</textarea></div>

        <div class="cr-sec">5. 진행 단계 · 비고</div>
        <div class="form-grid">
          <div class="form-row"><label>단계</label><select id="cf-stage">${STAGES.map(s => `<option value="${s.key}" ${(x ? x.stage : "접수") === s.key ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></div>
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
      const ad = $("#cf-audit").value;
      const rec = ad ? addDays(ad, cfg().dueDays) : "";
      $("#cf-due-hint").textContent = rec ? "권장(점검일+" + cfg().dueDays + "일): " + rec : "";
    }
    ["cf-audit"].forEach(id => { const el = $("#" + id); if (el) el.oninput = hints; });
    hints();

    $("#cf-no-auto").onclick = () => { $("#cf-no").value = nextNo({ year: Number($("#cf-year").value) || year }); };

    $("#cf-cancel").onclick = closeModal;
    if (x) $("#cf-del").onclick = () => confirmModal(`부적합 "${esc(x.no || x.target)}"을(를) 삭제하시겠습니까?`, () => {
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
        no: $("#cf-no").value.trim(),
        nonconformance: $("#cf-nc").value.trim(),
        reference: $("#cf-ref").value.trim(),
        risk: (risk && risk.L && risk.S) ? { L: risk.L, S: risk.S, band: bandOf(risk.L, risk.S).key, score: bandOf(risk.L, risk.S).score } : null,
        dueDate: $("#cf-due").value,
        doneDate: $("#cf-done").value,
        cap: {
          rootCause: $("#cf-root").value.trim(),
          action: $("#cf-action").value.trim()
        },
        mitigationResult: $("#cf-mit").value.trim(),
        stage: $("#cf-stage").value,
        seq: Number($("#cf-seq").value) || (x ? x.seq : 0) || 0,
        note: $("#cf-note").value.trim(),
        attachments: files,
        updatedAt: new Date().toISOString()
      };
      let saved;
      if (x) { saved = Object.assign(x, rec); }
      else {
        rec.createdAt = new Date().toISOString();
        if (!rec.seq) rec.seq = (list(rec.year).reduce((mx, c) => Math.max(mx, c.seq || 0), 0)) + 1;
        saved = Object.assign({ id: uid("car") }, rec);
        (D().cars = D().cars || []).push(saved);
      }
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ═══════════ 프로세스 타임라인 (상세) ═══════════ */
  function timelineHTML(x) {
    const cur = stageOf(x.stage).step;
    const dates = { "접수": x.auditDate, "조치중": calcDue(x), "종결": calcDone(x) };
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

  /* ═══════════ 상세 (문서 뷰 + 단계 이동) ═══════════ */
  function carDetail(id) {
    const x = (D().cars || []).find(c => c.id === id);
    if (!x) return;
    const canWrite = SeMIS.canEdit();
    const e = escLevel(x);
    const rec = recurrence(x);
    const st = stageOf(x.stage);
    const row = (lb, val) => `<tr><td class="cr-dt-l">${lb}</td><td>${val}</td></tr>`;
    openModal(`
      <div class="cr-detail">
        <div class="cr-doc-head">
          <div>
            <h3 style="margin:0">📋 ${esc(x.no || "부적합")} <span class="badge ${st.badge}">${esc(st.label)}</span></h3>
            <div style="font-size:.82rem;color:var(--text-2);margin-top:2px">부적합 · 시정조치 기록 · ${esc(x.year)}년 · ${esc(x.scope || "")}</div>
          </div>
          <div class="cr-doc-risk">${riskBadge(x.risk)}</div>
        </div>

        ${(e || rec.focus) ? `<div class="cr-alert ${e ? (e.over ? "over" : "warn") : "focus"}">
          ${e ? `<b>${e.over ? "⚠ 기한 경과" : "⏰ 마감 임박"}</b> — 조치기한 ${esc(e.date)} (${e.over ? "D+" + e.days : "D-" + e.days}) · 등급 <b>${esc(e.state)}</b>.` : ""}
          ${rec.focus ? `${e ? "<br>" : ""}<b>🔁 다빈도 재발</b> — 최근 ${cfg().recurMonths}개월 동일 대상·분야 ${rec.count}건 → 집중관리항목 검토 (KAB753 4.10).` : ""}
        </div>` : ""}

        ${timelineHTML(x)}

        <table class="tbl cr-dt">
          ${row("점검 대상 / 분야", `<b>${esc(x.target || "-")}</b> · ${esc(x.domain || "-")}`)}
          ${row("점검일 / 담당자", esc((x.auditDate || "-") + " · " + (x.auditor || "-")))}
          ${row("분류 / Level", `<span class="badge ${classOf(x.classification).badge}">${esc(classOf(x.classification).full)}</span> ${x.findingLevel ? '<span class="badge badge-gray">' + esc(x.findingLevel) + "</span>" : ""}`)}
          ${row("부적합 내용", esc(x.nonconformance || "-"))}
          ${row("관련근거", esc(x.reference || "-"))}
          ${row("위험평가", x.risk && x.risk.L ? `발생빈도 ${esc(x.risk.L)} × 심각도 ${esc(x.risk.S)} = 지수 ${bandOf(x.risk.L, x.risk.S).score} · ${riskBadge(x.risk)}` : "미평가")}
        </table>

        <div class="cr-sec2">시정조치</div>
        <table class="tbl cr-dt">
          ${row("조치기한", esc(calcDue(x) || "-") + (x.dueDate ? "" : ' <span class="cr-auto">자동</span>'))}
          ${row("조치 완료일", esc(calcDone(x) || "-"))}
          ${row("근본원인 분석", esc((x.cap && x.cap.rootCause) || "-"))}
          ${row("시정·재발방지 대책", `<div style="white-space:pre-wrap">${esc((x.cap && x.cap.action) || "-")}</div>`)}
          ${row("조치 결과", esc(x.mitigationResult || "-"))}
        </table>

        ${(x.attachments && x.attachments.length) ? `<div class="cr-sec2">첨부</div><div class="cr-files">${x.attachments.map(f => `<span class="cr-file"><a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a></span>`).join("")}</div>` : ""}
        ${x.note ? `<div class="form-hint" style="margin-top:8px">비고: ${esc(x.note)}</div>` : ""}
      </div>
      <div class="modal-actions">
        ${canWrite && !isClosed(x) ? `<button class="btn btn-ghost" id="cd-void" style="margin-right:auto">기각·개선불요</button>` : ""}
        <button class="btn btn-ghost" id="cd-close">닫기</button>
        ${canWrite ? `<button class="btn btn-ghost" id="cd-edit">수정</button>` : ""}
        ${canWrite && nextGate(x) ? `<button class="btn btn-primary" id="cd-adv">${esc(nextGate(x).label)} ▶</button>` : ""}
      </div>`, { wide: true });

    $("#cd-close").onclick = closeModal;
    if (canWrite) {
      const ed = $("#cd-edit"); if (ed) ed.onclick = () => carForm(id);
      const vd = $("#cd-void"); if (vd) vd.onclick = () => confirmModal("이 부적합을 기각/개선불요로 종료하시겠습니까?", () => {
        x.stage = "기각"; if (!x.doneDate) x.doneDate = todayISO(); x.updatedAt = new Date().toISOString();
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("기각 처리되었습니다.");
      });
      const av = $("#cd-adv"); if (av) av.onclick = () => advanceGate(id);
    }
  }

  /* ═══════════ 단계 이동 (v2.49: 승인·서명 없이 기록만) ═══════════ */
  function nextGate(x) {
    if (x.stage === "접수") return { to: "조치중", label: "조치 착수" };
    if (x.stage === "조치중") return { to: "종결", label: "조치 완료 · 종결" };
    return null;
  }
  function advanceGate(id) {
    const x = (D().cars || []).find(c => c.id === id); if (!x) return;
    const gate = nextGate(x); if (!gate) return;

    if (gate.to === "조치중") {
      openModal(`
        <h3>조치 착수</h3>
        <div class="form-hint" style="margin-bottom:10px">시정조치를 시작합니다. 조치기한을 확인하세요. (기본값: 점검일+${cfg().dueDays}일)</div>
        <div class="form-row"><label>조치기한</label><input type="date" id="cg-due" value="${esc(calcDue(x) || addDays(todayISO(), cfg().dueDays))}"></div>
        <div class="modal-actions"><button class="btn btn-ghost" id="cg-cancel">취소</button><button class="btn btn-primary" id="cg-ok">조치 착수</button></div>`);
      $("#cg-cancel").onclick = () => carDetail(id);
      $("#cg-ok").onclick = () => {
        x.dueDate = $("#cg-due").value || calcDue(x);
        x.stage = "조치중";
        x.updatedAt = new Date().toISOString();
        SeMIS.save(); closeModal(); toast("조치중으로 변경되었습니다."); carDetail(id);
      };
      return;
    }
    if (gate.to === "종결") {
      openModal(`
        <h3>조치 완료 · 종결</h3>
        <div class="form-hint" style="margin-bottom:10px">시정조치 이행을 확인하고 종결합니다.</div>
        <div class="form-row"><label>조치 완료일</label><input type="date" id="cg-done" value="${esc(calcDone(x) || todayISO())}"></div>
        <div class="form-row"><label>조치 결과 (선택)</label><textarea id="cg-mit" maxlength="1000" style="min-height:56px" placeholder="조치 결과 요약">${esc(x.mitigationResult || "")}</textarea></div>
        <div class="modal-actions"><button class="btn btn-ghost" id="cg-cancel">취소</button><button class="btn btn-primary" id="cg-ok">종결 처리</button></div>`);
      $("#cg-cancel").onclick = () => carDetail(id);
      $("#cg-ok").onclick = () => {
        x.doneDate = $("#cg-done").value || todayISO();
        const mit = $("#cg-mit").value.trim();
        if (mit) x.mitigationResult = mit;
        x.stage = "종결";
        x.updatedAt = new Date().toISOString();
        SeMIS.save(); closeModal(); toast("시정조치가 종결되었습니다."); carDetail(id);
      };
      return;
    }
  }

  /* ═══════════ 설정 모달 (hq 이상) ═══════════ */
  function cfgModal() {
    const c = cfg();
    openModal(`
      <h3>⚙️ 부적합 관리 설정</h3>
      <div class="form-hint" style="margin-bottom:10px">규정 개정 시 조치기한·위험 매트릭스·에스컬레이션 기준을 수정할 수 있습니다.</div>
      <div class="cr-sec">기한 · 알람</div>
      <div class="form-grid">
        <div class="form-row"><label>조치기한 기본값 (점검일+일)</label><input type="number" id="cs-duedays" value="${c.dueDays}" min="1"></div>
        <div class="form-row"><label>임박 경고 (D-일 이내)</label><input type="number" id="cs-warn" value="${c.warnDays}" min="0"></div>
      </div>
      <div class="form-row"><label>다빈도 재발 (개월 / 건수)</label><div class="cr-inline"><input type="number" id="cs-rmon" value="${c.recurMonths}" min="1" style="width:70px"> / <input type="number" id="cs-rcnt" value="${c.recurCount}" min="2" style="width:70px"></div></div>
      <div class="cr-sec">에스컬레이션 (기한 경과일 기준)</div>
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
        dueDays: Number($("#cs-duedays").value) || 30,
        warnDays: Number($("#cs-warn").value) || 3,
        recurMonths: Number($("#cs-rmon").value) || 12,
        recurCount: Number($("#cs-rcnt").value) || 4,
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

  /* ═══════════ 모듈 렌더 ═══════════ */
  SeMIS.registerModule("carcap", {
    title: "부적합·시정조치 (CAR)",
    render(root) {
      const canWrite = SeMIS.canEdit();
      const s = stats(year);
      const yrs = Array.from(new Set((D().cars || []).map(c => c.year).concat([year, new Date().getFullYear()]))).sort((a, b) => b - a);
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">📋 부적합·시정조치 관리 <span style="font-size:.9rem;font-weight:600;color:var(--text-3)">CAR</span></div>
          <span class="spacer"></span>
          ${canWrite ? '<button class="btn btn-ghost btn-sm" id="car-cfg" title="관리 설정">⚙️ 설정</button>' : ""}
          ${canWrite ? '<button class="btn btn-primary" id="car-add">+ 부적합 등록</button>' : ""}
          <div class="page-desc">보안점검 부적합 접수 → 위험평가 → 시정조치 → 종결 (근거: TAC701 · KAB753 · ICAO Doc 8973)</div>
        </div>

        <div class="stat-row car-stats">
          <div class="stat" data-fstage=""><div class="stat-label">전체</div><div class="stat-value">${s.total}</div><div class="stat-sub">${year}년</div></div>
          <div class="stat" data-fstage="접수"><div class="stat-label">접수</div><div class="stat-value">${s.recv}</div><div class="stat-sub">조치 대기</div></div>
          <div class="stat" data-fstage="조치중"><div class="stat-label">조치중</div><div class="stat-value" style="color:var(--primary)">${s.acting}</div><div class="stat-sub">진행</div></div>
          <div class="stat car-stat-alarm${s.overdue ? " on" : ""}"><div class="stat-label">기한 경과</div><div class="stat-value" style="color:var(--danger)">${s.overdue}</div><div class="stat-sub">에스컬레이션</div></div>
          <div class="stat${s.soon ? " car-stat-warn" : ""}"><div class="stat-label">마감 임박</div><div class="stat-value" style="color:var(--warning)">${s.soon}</div><div class="stat-sub">D-${cfg().warnDays} 이내</div></div>
          <div class="stat" data-fstage="종결"><div class="stat-label">종결</div><div class="stat-value" style="color:var(--success)">${s.closed}</div><div class="stat-sub">완료</div></div>
        </div>

        <div class="card${fullscreen ? " car-fullscreen" : ""}">
          <div class="cal-toolbar car-toolbar">
            <select id="car-year" class="car-sel">${yrs.map(y => `<option value="${y}" ${y === year ? "selected" : ""}>${y}년</option>`).join("")}</select>
            <select id="car-fstage" class="car-sel"><option value="">단계 전체</option>${STAGES.map(st => `<option value="${st.key}" ${fStage === st.key ? "selected" : ""}>${esc(st.label)}</option>`).join("")}</select>
            <select id="car-fdomain" class="car-sel"><option value="">분야 전체</option>${cfg().domains.map(d => `<option ${fDomain === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>
            <input id="car-q" class="car-sel car-q" placeholder="🔍 번호·대상·내용 검색" value="${esc(q)}">
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
          // 해당 위험도의 진행 중 목록 필터
          const L = Number(td.dataset.l), S = td.dataset.s;
          const hits = list(year).filter(c => c.risk && c.risk.L === L && c.risk.S === S && !isClosed(c));
          if (!hits.length) { toast("해당 위험도의 진행 중 부적합이 없습니다."); return; }
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
    calcDue, calcDone, activeDeadline, escLevel, recurrence,
    nextNo, list, filtered, stats, dashStats, open,
    getYear: () => year, setYear: (y) => { year = Number(y) || year; },
    setView: (v) => { if (["list", "matrix", "board"].includes(v)) view = v; }
  };
})();
