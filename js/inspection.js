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
  const FD_SHORT = { "시정조치": "시정", "개선권고": "권고", "현장시정": "현장", "관찰사항": "관찰" };
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

  /* ─────── 캘린더 연동: 점검 ↔ 일정 (id "insp_"+점검id) ─────── */
  function syncCalendar(insp) {
    const sid = "insp_" + insp.id;
    const idx = D().schedules.findIndex(s => s.id === sid);
    if (!insp.linkCal || !insp.start || insp.status === "취소") {
      if (idx >= 0) D().schedules.splice(idx, 1);
      return;
    }
    const rec = {
      id: sid, title: "[점검] " + insp.target,
      memo: insp.category + " 보안점검" + (insp.note ? " — " + insp.note : ""),
      start: insp.start, end: insp.end || insp.start,
      allDay: true, time: "", timeEnd: "",
      color: CAT_COLOR[insp.category] || "blue",
      done: insp.status === "완료",
      assignee: (insp.inspectors && insp.inspectors[0]) || "",
      vehicle: false, room: false, reminders: ["1w", "1d"]
    };
    if (idx >= 0) Object.assign(D().schedules[idx], rec);
    else D().schedules.push(rec);
  }
  function removeCalendar(inspId) {
    D().schedules = D().schedules.filter(s => s.id !== "insp_" + inspId);
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

  /* ─────── 연간 매트릭스 뷰 ─────── */
  function matrixHTML(canWrite) {
    const items = list();
    let html = `<div class="table-wrap"><table class="insp-matrix"><thead><tr><th class="insp-cat-h">구분</th>`;
    for (let m = 1; m <= 12; m++) html += `<th>${m}월</th>`;
    html += `<th class="insp-sum-h">계</th></tr></thead><tbody>`;
    CATEGORIES.forEach(cat => {
      const rows = items.filter(x => x.category === cat);
      const doneN = rows.filter(x => x.status === "완료").length;
      const planN = rows.filter(x => x.status !== "취소").length;
      html += `<tr><td class="insp-cat"><span class="cal-dot ev-${CAT_COLOR[cat]}"></span> ${esc(cat)}</td>`;
      for (let m = 1; m <= 12; m++) {
        const cell = rows.filter(x => x.month === m);
        html += `<td class="insp-cell${m === new Date().getMonth() + 1 && year === new Date().getFullYear() ? " now" : ""}" data-cat="${esc(cat)}" data-month="${m}">
          ${cell.map(x => chip(x, canWrite)).join("")}</td>`;
      }
      html += `<td class="insp-sum">${cat === "주요일정" ? rows.length + "건" : doneN + " / " + planN}</td></tr>`;
    });
    return html + "</tbody></table></div>" +
      (canWrite ? '<p class="form-hint" style="margin-top:8px">빈 칸을 클릭하면 해당 구분·월로 새 점검을 등록합니다. 칩 클릭 시 수정.</p>' : "");
  }

  /* ─────── 목록 뷰 ─────── */
  function listHTML(canWrite) {
    const items = list().slice().sort((a, b) =>
      (a.month - b.month) || String(a.start || "").localeCompare(String(b.start || "")) || String(a.category).localeCompare(b.category));
    if (!items.length) return '<div class="empty">등록된 점검이 없습니다.</div>';
    return `<div class="table-wrap"><table class="tbl"><thead><tr>
        <th style="width:52px">월</th><th style="width:90px">구분</th><th>대상</th>
        <th style="width:150px">일자</th><th>점검관</th><th style="width:70px">상태</th>
        <th style="width:60px">결과</th></tr></thead><tbody>
      ${items.map(x => `<tr data-insp-row="${esc(x.id)}" style="cursor:pointer" class="${x.status === "취소" ? "insp-cancel" : ""}">
        <td><b>${x.month}월</b></td>
        <td><span class="cal-dot ev-${CAT_COLOR[x.category] || "gray"}"></span> ${esc(x.category)}</td>
        <td><b>${esc(x.target)}</b>${x.note ? `<div style="font-size:.76rem;color:var(--text-3)">${esc(x.note)}</div>` : ""}</td>
        <td style="font-size:.82rem">${x.start ? esc(x.start) + (x.end && x.end !== x.start ? "<br>~ " + esc(x.end) : "") : '<span style="color:var(--text-3)">미정</span>'}${x.linkCal && x.start ? " 📅" : ""}</td>
        <td style="font-size:.84rem">${(x.inspectors || []).map(n => esc(tagOf(n))).join(" ") || '<span style="color:var(--text-3)">미정</span>'}</td>
        <td><span class="badge ${ST_BADGE[x.status] || "badge-gray"}">${esc(x.status)}</span></td>
        <td>${fdSummary(x) || (x.resultUrl ? `<a href="${esc(x.resultUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">보기 ↗</a>` : "-")}</td>
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
        <input type="checkbox" id="i-linkcal" style="width:auto" ${x && x.linkCal ? "checked" : ""}>
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
        year, category: $("#i-cat").value, target,
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
      const canWrite = SeMIS.roleRank() >= 2;
      const items = list();
      const plan = items.filter(x => x.category !== "주요일정" && x.status !== "취소");
      const done = plan.filter(x => x.status === "완료").length;
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🕵️ 보안점검 일정관리</div>
          <span class="spacer"></span>
          ${canWrite ? '<button class="btn btn-primary" id="insp-add">+ 점검 등록</button>' : ""}
          <div class="page-desc">국내정기 · 불시평가 · 해외공항 점검 연간 계획/실적 — 완료 ${done}건 / 계획 ${plan.length}건</div>
        </div>
        <div class="card">
          <div class="cal-toolbar">
            <button class="btn btn-ghost btn-sm" id="insp-prev">◀</button>
            <div class="cal-title">${year}년</div>
            <button class="btn btn-ghost btn-sm" id="insp-next">▶</button>
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
  window.SemisInspection = {
    CATEGORIES, STATUSES, CAT_COLOR,
    FINDING_TYPES, FD_BADGE, fdSummary,
    getYear: () => year, setYear: (y) => { year = Number(y) || year; },
    setViewMode: (m) => { if (m === "matrix" || m === "list") viewMode = m; },
    syncCalendar, removeCalendar, moveInsp,
    list
  };
})();
