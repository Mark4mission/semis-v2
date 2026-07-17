/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 보안교육 관리 모듈 (v2.8)
   연간 보안교육 계획/실적 관리:
   연도별 목록 + 이수율 통계 + 상태 배지 + manager 편집

   데이터: DATA.trainings = [{ id, year, month, course, type, method,
             target, date, hours, planned, attended, status, note }]
     - type: 초기 / 정기 / 수시 / 특별
     - method: 집합 / 온라인 / OJT / 혼합
     - status: 계획 / 완료 / 연기 / 취소
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const TYPES = ["초기", "정기", "수시", "특별"];
  const TYPE_BADGE = { "초기": "badge-blue", "정기": "badge-green", "수시": "badge-amber", "특별": "badge-red" };
  const METHODS = ["집합", "온라인", "OJT", "혼합"];
  const STATUSES = ["계획", "완료", "연기", "취소"];
  const ST_BADGE = { "계획": "badge-blue", "완료": "badge-green", "연기": "badge-amber", "취소": "badge-gray" };

  let year = new Date().getFullYear();

  const all = () => (Array.isArray(D().trainings) ? D().trainings : []);
  const list = () => all().filter(x => x.year === year);

  function stats() {
    const items = list().filter(x => x.status !== "취소");
    const done = items.filter(x => x.status === "완료");
    const planned = done.reduce((s, x) => s + (Number(x.planned) || 0), 0);
    const attended = done.reduce((s, x) => s + (Number(x.attended) || 0), 0);
    return {
      plan: items.length, done: done.length,
      rate: planned ? Math.round(attended / planned * 100) : null,
      planned, attended
    };
  }

  /* ─────── 등록/수정 폼 (manager+) ─────── */
  function trForm(id) {
    const x = id ? all().find(t => t.id === id) : null;
    openModal(`
      <h3>${x ? "교육 수정" : "교육 등록"} <span class="badge badge-gray">${x ? x.year : year}년</span></h3>
      <div class="form-row"><label>교육 과정명</label>
        <input id="t-course" value="${esc(x ? x.course : "")}" maxlength="80" placeholder="예: 항공보안 정기교육 (상반기)"></div>
      <div class="form-grid">
        <div class="form-row"><label>구분</label>
          <select id="t-type">${TYPES.map(t => `<option ${(x ? x.type : "정기") === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="form-row"><label>방식</label>
          <select id="t-method">${METHODS.map(m => `<option ${(x ? x.method : "집합") === m ? "selected" : ""}>${m}</option>`).join("")}</select></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>계획 월</label>
          <select id="t-month">${Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
            `<option value="${m}" ${(x ? x.month : new Date().getMonth() + 1) === m ? "selected" : ""}>${m}월</option>`).join("")}</select></div>
        <div class="form-row"><label>실시일 (확정 시)</label><input type="date" id="t-date" value="${esc(x ? x.date || "" : "")}"></div>
      </div>
      <div class="form-row"><label>교육 대상</label>
        <input id="t-target" value="${esc(x ? x.target || "" : "")}" maxlength="80" placeholder="예: 보안검색요원 전원, 신규 입사자"></div>
      <div class="form-grid">
        <div class="form-row"><label>교육 시간 (h)</label>
          <input type="number" id="t-hours" min="0" max="999" step="0.5" value="${esc(x ? x.hours || "" : "")}"></div>
        <div class="form-row"><label>상태</label>
          <select id="t-status">${STATUSES.map(s => `<option ${(x ? x.status : "계획") === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>대상 인원</label>
          <input type="number" id="t-planned" min="0" max="99999" value="${esc(x ? x.planned || "" : "")}"></div>
        <div class="form-row"><label>이수 인원</label>
          <input type="number" id="t-attended" min="0" max="99999" value="${esc(x ? x.attended || "" : "")}"></div>
      </div>
      <div class="form-row"><label>비고</label><input id="t-note" value="${esc(x ? x.note || "" : "")}" maxlength="200"></div>
      <div class="modal-actions">
        ${x ? '<button class="btn btn-danger" id="t-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="t-cancel">취소</button>
        <button class="btn btn-primary" id="t-save">저장</button>
      </div>`);

    $("#t-cancel").onclick = closeModal;
    if (x) $("#t-del").onclick = () =>
      confirmModal(`교육 "${x.course}"을(를) 삭제하시겠습니까?`, () => {
        D().trainings = all().filter(t => t.id !== x.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    $("#t-save").onclick = () => {
      const course = $("#t-course").value.trim();
      if (!course) { toast("교육 과정명을 입력하세요.", true); return; }
      const date = $("#t-date").value;
      const rec = {
        year: x ? x.year : year, course,
        type: $("#t-type").value, method: $("#t-method").value,
        month: date ? Number(date.slice(5, 7)) : Number($("#t-month").value),
        date: date || "",
        target: $("#t-target").value.trim(),
        hours: Number($("#t-hours").value) || 0,
        planned: Number($("#t-planned").value) || 0,
        attended: Number($("#t-attended").value) || 0,
        status: $("#t-status").value,
        note: $("#t-note").value.trim()
      };
      if (x) Object.assign(x, rec);
      else D().trainings.push(Object.assign({ id: uid("tr") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ─────── 상세 (읽기 전용) ─────── */
  function trDetail(id) {
    const x = all().find(t => t.id === id);
    if (!x) return;
    const rate = x.planned ? Math.round((x.attended || 0) / x.planned * 100) : null;
    openModal(`
      <h3>🎓 ${esc(x.course)} <span class="badge ${ST_BADGE[x.status] || "badge-gray"}">${esc(x.status)}</span></h3>
      <table class="tbl" style="font-size:.88rem">
        <tr><td style="width:90px;color:var(--text-2)">구분</td><td><span class="badge ${TYPE_BADGE[x.type] || "badge-gray"}">${esc(x.type)}</span> · ${esc(x.method)} · ${x.year}년 ${x.month}월</td></tr>
        <tr><td style="color:var(--text-2)">실시일</td><td>${esc(x.date || "미정")}${x.hours ? " · " + esc(x.hours) + "시간" : ""}</td></tr>
        <tr><td style="color:var(--text-2)">대상</td><td>${esc(x.target || "-")}</td></tr>
        <tr><td style="color:var(--text-2)">이수</td><td>${x.planned ? `${x.attended || 0} / ${x.planned}명${rate !== null ? ` (${rate}%)` : ""}` : "-"}</td></tr>
        ${x.note ? `<tr><td style="color:var(--text-2)">비고</td><td>${esc(x.note)}</td></tr>` : ""}
      </table>
      <div class="modal-actions"><button class="btn btn-ghost" id="t-close">닫기</button></div>`);
    $("#t-close").onclick = closeModal;
  }

  /* ─────── 목록 ─────── */
  function tableHTML() {
    const items = list().slice().sort((a, b) =>
      (a.month - b.month) || String(a.date || "").localeCompare(String(b.date || "")));
    if (!items.length) return '<div class="empty">등록된 교육이 없습니다.</div>';
    return `<div class="table-wrap"><table class="tbl"><thead><tr>
        <th style="width:52px">월</th><th>과정명 / 대상</th><th style="width:60px">구분</th>
        <th style="width:110px">실시일</th><th style="width:100px">이수 현황</th><th style="width:70px">상태</th></tr></thead><tbody>
      ${items.map(x => {
        const rate = x.planned ? Math.round((x.attended || 0) / x.planned * 100) : null;
        return `<tr data-tr-row="${esc(x.id)}" style="cursor:pointer" class="${x.status === "취소" ? "insp-cancel" : ""}">
        <td><b>${x.month}월</b></td>
        <td><b>${esc(x.course)}</b>${x.target ? `<div style="font-size:.76rem;color:var(--text-3)">${esc(x.target)}</div>` : ""}</td>
        <td><span class="badge ${TYPE_BADGE[x.type] || "badge-gray"}">${esc(x.type)}</span></td>
        <td style="font-size:.84rem">${x.date ? esc(x.date) : '<span style="color:var(--text-3)">미정</span>'}${x.hours ? `<div style="font-size:.74rem;color:var(--text-3)">${esc(x.hours)}h · ${esc(x.method)}</div>` : ""}</td>
        <td style="font-size:.84rem">${x.planned ? `${x.attended || 0}/${x.planned}명${rate !== null ? ` <span style="color:${rate >= 100 ? "var(--success)" : "var(--text-3)"};font-size:.76rem">(${rate}%)</span>` : ""}` : "-"}</td>
        <td><span class="badge ${ST_BADGE[x.status] || "badge-gray"}">${esc(x.status)}</span></td>
      </tr>`; }).join("")}</tbody></table></div>`;
  }

  /* ─────── 모듈 렌더 ─────── */
  SeMIS.registerModule("training", {
    title: "보안교육 관리",
    render(root) {
      const canWrite = SeMIS.canEdit();
      const s = stats();
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🎓 보안교육 관리</div>
          <span class="spacer"></span>
          ${canWrite ? '<button class="btn btn-primary" id="tr-add">+ 교육 등록</button>' : ""}
          <div class="page-desc">연간 보안교육 계획/실적 — 완료 ${s.done}건 / 계획 ${s.plan}건</div>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-label">계획 (${year}년)</div><div class="stat-value">${s.plan}</div><div class="stat-sub">취소 제외</div></div>
          <div class="stat"><div class="stat-label">완료</div><div class="stat-value" style="color:var(--success)">${s.done}</div><div class="stat-sub">계획 대비 ${s.plan ? Math.round(s.done / s.plan * 100) : 0}%</div></div>
          <div class="stat"><div class="stat-label">이수율</div><div class="stat-value">${s.rate === null ? "-" : s.rate + "%"}</div><div class="stat-sub">${s.attended} / ${s.planned}명 (완료 과정)</div></div>
        </div>
        <div class="card">
          <div class="cal-toolbar">
            <button class="btn btn-ghost btn-sm" id="tr-prev">◀</button>
            <div class="cal-title">${year}년</div>
            <button class="btn btn-ghost btn-sm" id="tr-next">▶</button>
            <span class="spacer"></span>
          </div>
          <div id="tr-body">${tableHTML()}</div>
        </div>`;

      $("#tr-prev").onclick = () => { year--; SeMIS.renderView(); };
      $("#tr-next").onclick = () => { year++; SeMIS.renderView(); };
      if (canWrite) $("#tr-add").onclick = () => trForm(null);
      $$("#tr-body [data-tr-row]").forEach(el => el.onclick = () => {
        canWrite ? trForm(el.dataset.trRow) : trDetail(el.dataset.trRow);
      });
    }
  });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisTraining = {
    TYPES, METHODS, STATUSES, stats, list,
    getYear: () => year, setYear: (y) => { year = Number(y) || year; }
  };
})();
