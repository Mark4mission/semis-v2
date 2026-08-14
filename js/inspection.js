/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 보안점검 일정관리 모듈 (v2.4)
   기존 구글시트(연간 매트릭스) 방식을 내재화:
   구분(국내정기/불시평가/해외공항/주요일정) × 월(1~12) 매트릭스 + 목록 뷰
   상태(계획/완료/연기/취소), 점검관(팀 태그), 일자 확정 시 캘린더 자동 연동

   데이터: DATA.inspections = [{ id, year, category, target, month,
             inspectors[], start, end, status, note, resultUrl, linkCal }]
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const CATEGORIES = ["국내정기", "불시평가", "해외공항", "주요일정"];
  const CAT_COLOR = { "국내정기": "green", "불시평가": "amber", "해외공항": "indigo", "주요일정": "pink" };
  const STATUSES = ["계획", "완료", "연기", "취소"];
  const ST_BADGE = { "계획": "badge-blue", "완료": "badge-green", "연기": "badge-amber", "취소": "badge-gray" };

  // 점검 결과 유형 (v2.6.1): findings = [{ type, text }] — 유형별 복수 등록 가능
  const FINDING_TYPES = ["시정조치", "개선권고", "현장시정", "관찰사항"];
  const FD_BADGE = { "시정조치": "badge-red", "개선권고": "badge-amber", "현장시정": "badge-blue", "관찰사항": "badge-gray" };
  const FD_SHORT = { "시정조치": "시정", "개선권고": "개선", "현장시정": "현장", "관찰사항": "관찰" };
  function fdSummary(x) {
    const cnt = {};
    (x.findings || []).forEach(f => { cnt[f.type] = (cnt[f.type] || 0) + 1; });
    return FINDING_TYPES.filter(t => cnt[t])
      .map(t => `<span class="badge ${FD_BADGE[t]}" title="${esc(t)} ${cnt[t]}건">${esc(FD_SHORT[t])}${cnt[t]}</span>`).join(" ");
  }

  const TEAM = () => (window.SemisCalendar ? SemisCalendar.TEAM : []);
  const tagOf = (n) => (window.SemisCalendar ? SemisCalendar.tagOf(n) : (n || "").slice(0, 2));

  let year = new Date().getFullYear();
  let viewMode = "matrix"; // matrix | list

  const list = () => (D().inspections || []).filter(x => x.year === year);

  /* ═══════ 캘린더 연동: 점검 ↔ 일정 (일정 id = "insp_" + 점검id) ═══════
     원칙(v2.36.4): **보안점검 일정관리가 원본(우선권)**.
     - 점검 → 일정: 제목·구분(색)·일자·완료를 항상 덮어씀
     - 일정 → 점검: **일자와 완료 여부만** 역방향 반영(syncFromSchedule) — 두 화면이 어긋나지 않도록
     - 일자 미정 점검도 계획 월 1일자 "[계획] …" 임시 일정으로 표시(확정하면 자동 이동)  */
  /* 연동 일정 색상(v2.36.5): 일자 확정 = 분홍 / 일자 미정(계획) = 연분홍 */
  const CAL_COLOR_FIXED = "pink";
  const CAL_COLOR_PLAN = "rose";
  const p2 = (n) => String(n).padStart(2, "0");
  const SID = (inspId) => "insp_" + inspId;
  const inspIdOfSid = (sid) => (String(sid).indexOf("insp_") === 0 ? String(sid).slice(5) : "");

  /* 연동 일정에 쓸 일자 — 확정일이 없으면 계획 월 1일(임시) */
  function calDates(insp) {
    if (insp.start) return { start: insp.start, end: insp.end || insp.start, tentative: false };
    const m = Number(insp.month);
    if (!(m >= 1 && m <= 12)) return null;
    const d = (insp.year || new Date().getFullYear()) + "-" + p2(m) + "-01";
    return { start: d, end: d, tentative: true };
  }

  function syncCalendar(insp) {
    const sid = SID(insp.id);
    const idx = D().schedules.findIndex(s => s.id === sid);
    const dt = insp.linkCal && insp.status !== "취소" ? calDates(insp) : null;
    if (!dt) {
      if (idx >= 0) D().schedules.splice(idx, 1);
      return;
    }
    const rec = {
      id: sid, title: (dt.tentative ? "[계획] " : "[점검] ") + insp.target,
      memo: insp.category + " 보안점검"
        + (dt.tentative ? " — 일자 미정(" + insp.month + "월 계획, 확정 시 자동 이동)" : "")
        + (insp.note ? " — " + insp.note : ""),
      start: dt.start, end: dt.end,
      allDay: true, time: "", timeEnd: "",
      color: dt.tentative ? CAL_COLOR_PLAN : CAL_COLOR_FIXED,
      done: insp.status === "완료",
      assignee: (insp.inspectors && insp.inspectors[0]) || "",
      vehicle: false, room: false, reminders: dt.tentative ? [] : ["1w", "1d"],
      repeat: { freq: "none", until: "" }, doneFrom: "", doneDates: [], undoneDates: []
    };
    if (idx >= 0) Object.assign(D().schedules[idx], rec);
    else D().schedules.push(rec);
  }
  function removeCalendar(inspId) {
    D().schedules = D().schedules.filter(s => s.id !== SID(inspId));
  }

  /* 일정관리에서 연동 일정을 옮기거나 완료 처리했을 때 점검에 되반영.
     patch = { start, end, done } — 날짜가 바뀌면 계획 월(month)도 함께 맞춘다. */
  function syncFromSchedule(sid, patch) {
    const id = inspIdOfSid(sid);
    if (!id) return false;
    const x = (D().inspections || []).find(i => i.id === id);
    if (!x) return false;
    let changed = false;
    const p = patch || {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(p.start))) {
      // 임시(월 계획) 일정을 옮긴 경우에도 확정 일자로 승격
      if (x.start !== p.start) { x.start = p.start; changed = true; }
      const end = /^\d{4}-\d{2}-\d{2}$/.test(String(p.end)) && p.end >= p.start ? p.end : p.start;
      if (x.end !== end) { x.end = end; changed = true; }
      const m = Number(p.start.slice(5, 7));
      if (m >= 1 && m <= 12 && x.month !== m) { x.month = m; changed = true; }
      const y = Number(p.start.slice(0, 4));
      if (y && x.year !== y) { x.year = y; changed = true; }
    }
    if (typeof p.done === "boolean") {
      if (p.done && x.status !== "완료") { x.status = "완료"; changed = true; }
      else if (!p.done && x.status === "완료") { x.status = "계획"; changed = true; }
    }
    if (changed) syncCalendar(x);   // 제목·색 등 원본 속성 재적용(우선권)
    return changed;
  }
  /* 연동 일정을 일정관리에서 삭제 → 점검의 연동만 해제(점검 자체는 보존) */
  function unlinkBySchedule(sid) {
    const id = inspIdOfSid(sid);
    const x = id ? (D().inspections || []).find(i => i.id === id) : null;
    if (!x) return false;
    x.linkCal = false;
    return true;
  }
  /* v2.36.4 일괄 연동: 취소를 제외한 모든 점검을 일정관리에 반영 */
  function syncAllCalendar(opts) {
    const turnOn = !(opts && opts.turnOn === false);
    (D().inspections || []).forEach(x => {
      if (turnOn && x.status !== "취소") x.linkCal = true;
      syncCalendar(x);
    });
  }

  /* ─────── 점검 칩 (대상/점검관 줄 분리) ─────── */
  function chip(x, canWrite) {
    const insp = (x.inspectors || []).map(n => `<span class="insp-tag">${esc(tagOf(n))}</span>`).join("");
    const mark = x.status === "완료" ? "✓ " : x.status === "연기" ? "⏸ " : x.status === "취소" ? "✕ " : "";
    return `<div class="insp-chip st-${esc(x.status)} ev-${CAT_COLOR[x.category] || "gray"}" data-insp="${esc(x.id)}" ${canWrite ? 'draggable="true"' : ""}
        title="${esc(x.target)} · ${esc(x.status)}${x.inspectors && x.inspectors.length ? " · " + esc(x.inspectors.join(", ")) : ""}${x.note ? "\n" + esc(x.note) : ""}">
      <div class="insp-target">${mark}${esc(x.target)}</div>
      ${insp ? `<div class="insp-people">${insp}</div>` : ""}
    </div>`;
  }

  /* ─────── 매트릭스 드래그: 계획월(및 구분) 이동 ─────── */
  function moveInsp(id, category, month) {
    const x = (D().inspections || []).find(i => i.id === id);
    month = Number(month);
    if (!x || !(month >= 1 && month <= 12)) return false;
    if (x.month === month && (!category || x.category === category)) return false;
    // 확정 일자가 있으면 같은 일자로 월만 이동 (기간 길이 유지, 말일 초과 시 보정)
    if (x.start) {
      const y = Number(x.start.slice(0, 4));
      const day = Number(x.start.slice(8, 10));
      const lastDay = new Date(y, month, 0).getDate();
      const dur = Math.round((new Date(x.end || x.start) - new Date(x.start)) / 86400000);
      const p2 = (n) => String(n).padStart(2, "0");
      const ns = y + "-" + p2(month) + "-" + p2(Math.min(day, lastDay));
      const ne = new Date(y, month - 1, Math.min(day, lastDay) + dur);
      x.start = ns;
      x.end = ne.getFullYear() + "-" + p2(ne.getMonth() + 1) + "-" + p2(ne.getDate());
    }
    x.month = month;
    if (category && CATEGORIES.includes(category)) x.category = category;
    syncCalendar(x);
    SeMIS.save(); SeMIS.renderView();
    return true;
  }
  let dragCtx = null;

  /* ─────── 연간 실적 요약 (v2.47) ───────
     주요일정은 "점검"이 아니므로 완료율 계산에서 제외하고 건수만 별도 표기.
     v2.47 완료율 산식 변경: **연기 건은 분모에서 제외**한다.
       완료율 = 완료 / (완료 + 미실시(계획))   ※ 취소·연기·주요일정 제외
     연기는 해당 연도 내 미실시로 종결될 개연성이 높아, 분모에 두면 만회 가능한
     "미실시(계획)"과 뒤섞여 실제 이행 수준이 과소평가된다. 연기 건수는 분모에서
     빼되 화면에는 별도 지표로 계속 노출한다. */
  function summary(items) {
    const plan = items.filter(x => x.category !== "주요일정" && x.status !== "취소"); // 취소 제외 전체
    const base = plan.filter(x => x.status !== "연기");   // 완료율 모집단 (완료 + 계획)
    const done = base.filter(x => x.status === "완료").length;
    const byCat = CATEGORIES.filter(c => c !== "주요일정").map(cat => {
      const rows = plan.filter(x => x.category === cat);
      const b = rows.filter(x => x.status !== "연기");
      const d = b.filter(x => x.status === "완료").length;
      return { cat, plan: rows.length, base: b.length, done: d, delayed: rows.length - b.length,
               pct: b.length ? Math.round(d / b.length * 100) : 0 };
    }).filter(c => c.plan);
    let car = 0;
    items.forEach(x => (x.findings || []).forEach(f => { if (f.type === "시정조치") car++; }));
    return {
      pct: base.length ? Math.round(done / base.length * 100) : 0,
      total: plan.length,       // 취소 제외 계획 전체 (연기 포함)
      base: base.length,        // 완료율 분모
      done,
      todo: plan.filter(x => x.status === "계획").length,
      delayed: plan.filter(x => x.status === "연기").length,
      undated: plan.filter(x => !x.start).length,
      major: items.filter(x => x.category === "주요일정" && x.status !== "취소").length,
      car, byCat
    };
  }

  /* ─────── 연간 매트릭스 뷰 ─────── */
  function matrixHTML(canWrite) {
    const items = list();
    let html = `<div class="table-wrap"><table class="insp-matrix"><thead><tr><th class="insp-cat-h">구분</th>`;
    for (let m = 1; m <= 12; m++) html += `<th>${m}월</th>`;
    html += `<th class="insp-sum-h">계</th></tr></thead><tbody>`;
    CATEGORIES.forEach(cat => {
      const rows = items.filter(x => x.category === cat);
      const doneN = rows.filter(x => x.status === "완료").length;
      /* v2.47: 계 열의 분모도 완료율과 동일하게 취소·연기를 제외 */
      const planN = rows.filter(x => x.status !== "취소" && x.status !== "연기").length;
      const dlyN = rows.filter(x => x.status === "연기").length;
      html += `<tr><td class="insp-cat"><span class="cal-dot ev-${CAT_COLOR[cat]}"></span> ${esc(cat)}</td>`;
      for (let m = 1; m <= 12; m++) {
        const cell = rows.filter(x => x.month === m);
        html += `<td class="insp-cell${m === new Date().getMonth() + 1 && year === new Date().getFullYear() ? " now" : ""}" data-cat="${esc(cat)}" data-month="${m}">
          ${cell.map(x => chip(x, canWrite)).join("")}</td>`;
      }
      html += `<td class="insp-sum"${cat !== "주요일정" && dlyN ? ` title="연기 ${dlyN}건은 분모에서 제외"` : ""}>${
        cat === "주요일정" ? rows.length + "건"
          : doneN + " / " + planN + (dlyN ? `<div class="insp-sum-x">연기 ${dlyN}</div>` : "")}</td></tr>`;
    });
    return html + "</tbody></table></div>" +
      (canWrite ? '<p class="form-hint" style="margin-top:8px">빈 칸을 클릭하면 해당 구분·월로 새 점검을 등록합니다. 칩 클릭 시 수정.</p>' : "");
  }

  /* ─────── 목록 뷰 ─────── */
  function listHTML(canWrite) {
    const items = list().slice().sort((a, b) =>
      (a.month - b.month) || String(a.start || "").localeCompare(String(b.start || "")) || String(a.category).localeCompare(b.category));
    if (!items.length) return '<div class="empty">등록된 점검이 없습니다.</div>';
    /* v2.36.3: 열 폭 고정 배분(colgroup) — 대상이 남는 폭을 독점해 결과 배지가
       세로로 쪼개지던 문제 해소. 점검관은 약자 대신 실제 이름 표기. */
    return `<div class="table-wrap"><table class="tbl tbl-cap ds-tbl insp-list" style="--cap:1000px">
      <colgroup>
        <col style="width:54px"><col style="width:96px"><col>
        <col style="width:118px"><col style="width:150px">
        <col style="width:74px"><col style="width:220px">
      </colgroup>
      <thead><tr>
        <th>월</th><th>구분</th><th>대상</th>
        <th>일자</th><th>점검관</th><th>상태</th><th>결과</th></tr></thead><tbody>
      ${items.map(x => `<tr data-insp-row="${esc(x.id)}" style="cursor:pointer" class="${x.status === "취소" ? "insp-cancel" : ""}">
        <td><b>${x.month}월</b></td>
        <td class="il-cat"><span class="cal-dot ev-${CAT_COLOR[x.category] || "gray"}"></span> ${esc(x.category)}</td>
        <td class="il-target"><b>${esc(x.target)}</b>${x.note ? `<div class="il-note">${esc(x.note)}</div>` : ""}</td>
        <td class="il-date">${x.start ? esc(x.start) + (x.end && x.end !== x.start ? "<br>~ " + esc(x.end) : "") : '<span style="color:var(--text-3)">미정</span>'}${x.linkCal && x.start ? ' <span title="일정관리 연동">📅</span>' : ""}</td>
        <td class="il-people">${(x.inspectors || []).map(n => esc(n)).join(" · ") || '<span style="color:var(--text-3)">미정</span>'}</td>
        <td><span class="badge ${ST_BADGE[x.status] || "badge-gray"}">${esc(x.status)}</span></td>
        <td class="il-result">${fdSummary(x) || (x.resultUrl ? `<a href="${esc(x.resultUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">보기 ↗</a>` : "-")}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  /* ─────── 등록/수정 폼 ─────── */
  function inspForm(id, preset) {
    const x = id ? (D().inspections || []).find(i => i.id === id) : null;
    const p = preset || {};
    let inspectors = x ? (x.inspectors || []).slice() : [];
    let findings = x ? (x.findings || []).map(f => Object.assign({}, f)) : [];
    openModal(`
      <h3>${x ? "점검 수정" : "점검 등록"} <span class="badge badge-gray">${year}년</span></h3>
      <div class="form-grid">
        <div class="form-row"><label>구분</label>
          <select id="i-cat">${CATEGORIES.map(c => `<option ${(x ? x.category : p.category) === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div class="form-row"><label>계획 월</label>
          <select id="i-month">${Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
            `<option value="${m}" ${(x ? x.month : (p.month || new Date().getMonth() + 1)) === m ? "selected" : ""}>${m}월</option>`).join("")}</select></div>
      </div>
      <div class="form-row"><label>대상 (지점/업체/공항)</label>
        <input id="i-target" value="${esc(x ? x.target : "")}" maxlength="60" placeholder="예: 프로에스콤, FRASF"></div>
      <div class="form-grid">
        <div class="form-row"><label>시작일 (확정 시)</label><input type="date" id="i-start" value="${esc(x ? x.start || "" : "")}"></div>
        <div class="form-row"><label>종료일</label><input type="date" id="i-end" value="${esc(x ? x.end || "" : "")}"></div>
      </div>
      <div class="form-row"><label>점검관</label>
        <div class="team-picker" id="i-team">${TEAM().map(t =>
          `<button type="button" class="cal-fchip${inspectors.includes(t.name) ? " active" : ""}" data-insp-t="${esc(t.name)}">${t.emoji} ${esc(t.name)}</button>`).join("")}</div>
        <input id="i-extra" value="${esc(inspectors.filter(n => !TEAM().some(t => t.name === n)).join(", "))}"
          maxlength="60" placeholder="외부/기타 점검관 (쉼표로 구분, 예: TAZ)"></div>
      <div class="form-row"><label>상태</label>
        <select id="i-status">${STATUSES.map(s => `<option ${(x ? x.status : "계획") === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="form-row"><label>점검 결과 (유형별 복수 등록 가능)</label>
        <div id="i-findings"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="ifd-add" style="margin-top:4px">+ 결과 추가</button>
        ${x && x.resultUrl ? `<div class="form-hint">기존 결과 링크: <a href="${esc(x.resultUrl)}" target="_blank" rel="noopener">열기 ↗</a></div>` : ""}</div>
      <div class="form-row"><label>비고</label><input id="i-note" value="${esc(x ? x.note || "" : "")}" maxlength="200"></div>
      <div class="form-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="i-linkcal" style="width:auto" ${x ? (x.linkCal ? "checked" : "") : "checked"}>
        📅 일정관리 캘린더에 표시 (시작일 확정 시)</label></div>
      <div class="modal-actions">
        ${x ? '<button class="btn btn-danger" id="i-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="i-cancel">취소</button>
        <button class="btn btn-primary" id="i-save">저장</button>
      </div>`);

    /* 점검 결과 편집 (유형 + 한 줄 내용, 복수) */
    function fdCollect() {
      $$("#i-findings .ifd-row").forEach((row, i) => {
        findings[i].type = row.querySelector("select").value;
        findings[i].text = row.querySelector("input").value;
      });
    }
    function fdPaint() {
      $("#i-findings").innerHTML = findings.map((f, i) => `
        <div class="ifd-row" data-fd="${i}">
          <select class="ifd-type">${FINDING_TYPES.map(t => `<option ${f.type === t ? "selected" : ""}>${t}</option>`).join("")}</select>
          <input class="ifd-text" value="${esc(f.text || "")}" maxlength="200" placeholder="내용 한 줄 (예: 검색장비 캘리브레이션 미실시)">
          <button type="button" class="btn btn-ghost btn-sm" data-fd-del="${i}" title="삭제">🗑</button>
        </div>`).join("") || '<div class="form-hint">등록된 결과가 없습니다.</div>';
      $$("#i-findings [data-fd-del]").forEach(b => b.onclick = () => {
        fdCollect(); findings.splice(Number(b.dataset.fdDel), 1); fdPaint();
      });
    }
    fdPaint();
    $("#ifd-add").onclick = () => {
      fdCollect();
      findings.push({ type: FINDING_TYPES[0], text: "" });
      fdPaint();
      const rows = $$("#i-findings .ifd-text");
      if (rows.length) rows[rows.length - 1].focus();
    };

    $$("#i-team [data-insp-t]").forEach(b => b.onclick = () => {
      const n = b.dataset.inspT;
      if (inspectors.includes(n)) inspectors = inspectors.filter(v => v !== n);
      else inspectors.push(n);
      b.classList.toggle("active", inspectors.includes(n));
    });
    $("#i-cancel").onclick = closeModal;
    if (x) $("#i-del").onclick = () =>
      confirmModal(`점검 "${x.target}"을(를) 삭제하시겠습니까?`, () => {
        D().inspections = D().inspections.filter(i => i.id !== x.id);
        removeCalendar(x.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    $("#i-save").onclick = () => {
      const target = $("#i-target").value.trim();
      if (!target) { toast("대상을 입력하세요.", true); return; }
      let s = $("#i-start").value, en = $("#i-end").value;
      if (s && en && en < s) { const t = s; s = en; en = t; }
      const extra = $("#i-extra").value.split(",").map(v => v.trim()).filter(Boolean)
        .filter(n => !TEAM().some(t => t.name === n));
      const team = TEAM().map(t => t.name).filter(n => inspectors.includes(n));
      fdCollect();
      const rec = {
        year: x ? x.year : year, // 대시보드 등 외부에서 열어도 기존 연도 유지
        category: $("#i-cat").value, target,
        month: s ? Number(s.slice(5, 7)) : Number($("#i-month").value),
        inspectors: team.concat(extra),
        start: s || "", end: en || (s || ""),
        status: $("#i-status").value,
        note: $("#i-note").value.trim(),
        findings: findings.filter(f => String(f.text || "").trim())
          .map(f => ({ type: FINDING_TYPES.includes(f.type) ? f.type : FINDING_TYPES[0], text: f.text.trim() })),
        linkCal: $("#i-linkcal").checked
      };
      let saved;
      if (x) { Object.assign(x, rec); saved = x; }
      else { saved = Object.assign({ id: uid("i") }, rec); D().inspections.push(saved); }
      syncCalendar(saved);
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ─────── 상세 (읽기 전용) ─────── */
  function inspDetail(id) {
    const x = (D().inspections || []).find(i => i.id === id);
    if (!x) return;
    openModal(`
      <h3><span class="cal-dot ev-${CAT_COLOR[x.category] || "gray"}"></span> ${esc(x.target)}
        <span class="badge ${ST_BADGE[x.status]}">${esc(x.status)}</span></h3>
      <table class="tbl" style="font-size:.88rem">
        <tr><td style="width:90px;color:var(--text-2)">구분</td><td>${esc(x.category)} · ${x.year}년 ${x.month}월</td></tr>
        <tr><td style="color:var(--text-2)">일자</td><td>${x.start ? esc(x.start) + (x.end && x.end !== x.start ? " ~ " + esc(x.end) : "") : "미정"}</td></tr>
        <tr><td style="color:var(--text-2)">점검관</td><td>${(x.inspectors || []).join(", ") || "미정"}</td></tr>
        ${x.note ? `<tr><td style="color:var(--text-2)">비고</td><td>${esc(x.note)}</td></tr>` : ""}
        ${(x.findings || []).length ? `<tr><td style="color:var(--text-2)">결과</td><td>${x.findings.map(f =>
          `<div style="padding:2px 0"><span class="badge ${FD_BADGE[f.type] || "badge-gray"}">${esc(f.type)}</span> ${esc(f.text)}</div>`).join("")}</td></tr>` : ""}
        ${x.resultUrl ? `<tr><td style="color:var(--text-2)">결과 링크</td><td><a href="${esc(x.resultUrl)}" target="_blank" rel="noopener">열기 ↗</a></td></tr>` : ""}
      </table>
      <div class="modal-actions"><button class="btn btn-ghost" id="i-close">닫기</button></div>`);
    $("#i-close").onclick = closeModal;
  }

  /* ─────── 모듈 렌더 ─────── */
  SeMIS.registerModule("inspection", {
    title: "보안점검 일정관리",
    render(root) {
      const canWrite = SeMIS.canEdit();
      const items = list();
      const s = summary(items);
      root.innerHTML = `
        <div class="ds-head">
          <div class="ds-head-t"><i class="em">🕵️</i>보안점검 일정관리
            <small>국내정기 · 불시평가 · 해외공항 연간 계획/실적</small></div>
          <span class="spacer"></span>
          <div class="ds-yearnav">
            <button class="btn btn-ghost btn-sm" id="insp-prev" title="이전 해">◀</button>
            <b>${year}년</b>
            <button class="btn btn-ghost btn-sm" id="insp-next" title="다음 해">▶</button>
          </div>
          ${canWrite ? '<button class="btn btn-primary btn-sm" id="insp-add">+ 점검 등록</button>' : ""}
        </div>

        <div class="ds-panel ds-panel-tint">
          <div class="ds-hd">
            <span class="ds-pill"><i class="em">📊</i>${year}년 실적 요약</span>
            <span class="spacer"></span>
            ${s.undated ? `<span class="badge badge-amber" title="계획 월만 있고 점검 일자가 확정되지 않은 건">일자 미정 ${s.undated}건</span>` : ""}
            ${s.car ? `<span class="badge badge-red" title="점검 결과 시정조치 지적 건수">시정조치 ${s.car}건</span>` : ""}
            ${s.major ? `<span class="badge badge-gray">주요일정 ${s.major}건</span>` : ""}
          </div>
          <div class="ds-flexrow">
            ${SeMIS.dsRing(s.pct, "완료 " + s.done + " / " + s.base)}
            <div class="ds-stats ds-flex-1">
              <div class="ds-stat tone-blue" title="취소를 제외한 연간 계획 건수 (연기 포함)"><b>${s.total}</b><span>연간 계획</span></div>
              <div class="ds-stat tone-green"><b>${s.done}</b><span>완료</span></div>
              <div class="ds-stat tone-gray" title="아직 실시하지 않은 계획 건 — 완료율 분모에 포함"><b>${s.todo}</b><span>미실시 (계획)</span></div>
              <div class="ds-stat tone-red" title="연기 건은 완료율 분모에서 제외"><b>${s.delayed}</b><span>연기 (제외)</span></div>
            </div>
            <div class="ds-bars ds-flex-12">
              ${s.byCat.map(c => `<div>
                <div class="ds-bar-l"><span class="cal-dot ev-${CAT_COLOR[c.cat]}"></span>${esc(c.cat)}
                  <span>완료 ${c.done}/${c.base}건${c.delayed ? " · 연기 " + c.delayed : ""}</span><b>${c.pct}%</b></div>
                <div class="ds-bar"><span style="width:${c.pct}%"></span></div>
              </div>`).join("") || '<div class="ds-empty">등록된 점검이 없습니다.</div>'}
            </div>
          </div>
          <p class="insp-pct-note" id="insp-pct-note">완료율 = 완료 ${s.done} / 대상 ${s.base}건 (완료 + 미실시)${s.delayed ? ` — 연기 ${s.delayed}건은 분모에서 제외` : ""}${s.major ? `, 주요일정 ${s.major}건 및 취소 건 제외` : ""}</p>
        </div>

        <div class="ds-panel" style="margin-top:16px">
          <div class="ds-hd">
            <span class="ds-pill"><i class="em">🗓</i>${viewMode === "matrix" ? "연간 매트릭스" : "점검 목록"}</span>
            <span class="spacer"></span>
            <div class="cal-views">
              <button class="cal-viewbtn${viewMode === "matrix" ? " active" : ""}" data-imode="matrix">연간 매트릭스</button>
              <button class="cal-viewbtn${viewMode === "list" ? " active" : ""}" data-imode="list">목록</button>
            </div>
          </div>
          <div id="insp-body">${viewMode === "matrix" ? matrixHTML(canWrite) : listHTML(canWrite)}</div>
        </div>`;

      $("#insp-prev").onclick = () => { year--; SeMIS.renderView(); };
      $("#insp-next").onclick = () => { year++; SeMIS.renderView(); };
      $$("[data-imode]").forEach(b => b.onclick = () => { viewMode = b.dataset.imode; SeMIS.renderView(); });
      if (canWrite) $("#insp-add").onclick = () => inspForm(null);

      $$("[data-insp]", root).forEach(el => el.onclick = (ev) => {
        ev.stopPropagation();
        canWrite ? inspForm(el.dataset.insp) : inspDetail(el.dataset.insp);
      });
      $$("[data-insp-row]", root).forEach(el => el.onclick = () => {
        canWrite ? inspForm(el.dataset.inspRow) : inspDetail(el.dataset.inspRow);
      });
      if (canWrite) $$(".insp-cell", root).forEach(cell => cell.onclick = (ev) => {
        if (ev.target.closest(".insp-chip")) return;
        inspForm(null, { category: cell.dataset.cat, month: Number(cell.dataset.month) });
      });

      /* ── 매트릭스 드래그앤드롭: 칩을 다른 칸으로 → 계획월(/구분) 변경 ── */
      if (canWrite) {
        $$(".insp-chip[draggable]", root).forEach(el => {
          el.addEventListener("dragstart", (ev) => {
            dragCtx = { id: el.dataset.insp };
            el.classList.add("dragging");
            if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = "move"; try { ev.dataTransfer.setData("text/plain", el.dataset.insp); } catch (e) {} }
          });
          el.addEventListener("dragend", () => { el.classList.remove("dragging"); dragCtx = null; });
        });
        $$(".insp-cell", root).forEach(cell => {
          cell.addEventListener("dragover", (ev) => { ev.preventDefault(); cell.classList.add("drop-hover"); });
          cell.addEventListener("dragleave", () => cell.classList.remove("drop-hover"));
          cell.addEventListener("drop", (ev) => {
            ev.preventDefault();
            cell.classList.remove("drop-hover");
            if (!dragCtx) return;
            const x = (D().inspections || []).find(i => i.id === dragCtx.id);
            const catChanged = x && x.category !== cell.dataset.cat;
            if (moveInsp(dragCtx.id, cell.dataset.cat, Number(cell.dataset.month)))
              toast(cell.dataset.month + "월로 이동되었습니다." + (catChanged ? " (구분: " + cell.dataset.cat + ")" : ""));
            dragCtx = null;
          });
        });
      }
    }
  });

  /* ─────── 테스트/외부 노출 ─────── */
  /* 외부(대시보드 등)에서 점검 열기 — 권한에 따라 수정 폼/읽기 상세 */
  function open(id) {
    if (!(D().inspections || []).some(i => i.id === id)) return;
    if (SeMIS.canEdit()) inspForm(id);
    else inspDetail(id);
  }

  window.SemisInspection = {
    CATEGORIES, STATUSES, CAT_COLOR,
    FINDING_TYPES, FD_BADGE, fdSummary, open,
    getYear: () => year, setYear: (y) => { year = Number(y) || year; },
    setViewMode: (m) => { if (m === "matrix" || m === "list") viewMode = m; },
    CAL_COLOR_FIXED, CAL_COLOR_PLAN,
    syncCalendar, removeCalendar, moveInsp, syncFromSchedule, unlinkBySchedule, syncAllCalendar, calDates,
    list
  };
})();
