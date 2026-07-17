/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 계약서 관리 모듈 (v2.8, 메뉴 vis: mgr)
   보안용역/경비/시스템 계약 현황 + 만료 D-day 관리:
   목록 + 만료 임박 강조 + 계약서 파일 링크 + manager 편집

   데이터: DATA.contracts = [{ id, name, party, category, start, end,
             amount, owner, autoRenew, fileUrl, status, note }]
     - category: 보안용역 / 경비 / 시스템 / 유지보수 / 기타
     - status: 유효 / 해지 (만료는 종료일 경과 시 자동 판정)
   ※ 계약 정보는 관리자 이상만 열람 (메뉴 vis "mgr").
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const CATS = ["보안용역", "경비", "시스템", "유지보수", "기타"];
  const CAT_BADGE = { "보안용역": "badge-blue", "경비": "badge-green", "시스템": "badge-amber", "유지보수": "badge-orange", "기타": "badge-gray" };

  const todayISO = () => new Date().toISOString().slice(0, 10);
  function daysLeft(dateStr) {
    if (!dateStr) return null;
    return Math.round((new Date(dateStr) - new Date(todayISO())) / 86400000);
  }
  /* 유효/만료/해지 판정: 해지는 수동, 만료는 종료일 경과 시 자동 */
  function stateOf(x) {
    if (x.status === "해지") return "해지";
    if (x.end && daysLeft(x.end) < 0) return "만료";
    return "유효";
  }
  const STATE_BADGE = { "유효": "badge-green", "만료": "badge-red", "해지": "badge-gray" };

  function ddayBadge(x) {
    const st = stateOf(x);
    if (st !== "유효") return "";
    if (!x.end) return '<span class="badge badge-gray">기한없음</span>';
    const d = daysLeft(x.end);
    if (d <= 30) return `<span class="badge badge-red">D-${d}</span>`;
    if (d <= 90) return `<span class="badge badge-amber">D-${d}</span>`;
    return `<span class="badge badge-gray">D-${d}</span>`;
  }

  let query = "", stFilter = "전체";

  const list = () => (Array.isArray(D().contracts) ? D().contracts : []);
  function filtered() {
    const q = query.toLowerCase();
    return list().filter(x => {
      const st = stateOf(x);
      if (stFilter === "만료임박") {
        const d = daysLeft(x.end);
        if (!(st === "유효" && x.end && d <= 90)) return false;
      } else if (stFilter !== "전체" && st !== stFilter) return false;
      if (!q) return true;
      return [x.name, x.party, x.category, x.owner, x.note]
        .some(v => String(v || "").toLowerCase().includes(q));
    }).sort((a, b) => {
      const ra = stateOf(a) === "유효" ? 0 : 1, rb = stateOf(b) === "유효" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return String(a.end || "9999").localeCompare(String(b.end || "9999"));
    });
  }

  function stats() {
    const l = list();
    const act = l.filter(x => stateOf(x) === "유효");
    return {
      active: act.length,
      soon: act.filter(x => { const d = daysLeft(x.end); return x.end && d >= 0 && d <= 90; }).length,
      expired: l.filter(x => stateOf(x) === "만료").length,
      renew: act.filter(x => x.autoRenew).length
    };
  }

  /* ─────── 등록/수정 폼 (manager+) ─────── */
  function cnForm(id) {
    const x = id ? list().find(c => c.id === id) : null;
    openModal(`
      <h3>${x ? "계약 수정" : "계약 등록"} <span class="badge badge-gray">계약서 관리</span></h3>
      <div class="form-row"><label>계약명</label>
        <input id="c-name" value="${esc(x ? x.name : "")}" maxlength="80" placeholder="예: 인천공항 보안검색 위탁용역"></div>
      <div class="form-grid">
        <div class="form-row"><label>계약 상대방</label>
          <input id="c-party" value="${esc(x ? x.party || "" : "")}" maxlength="60" placeholder="예: 프로에스콤"></div>
        <div class="form-row"><label>분류</label>
          <select id="c-cat">${CATS.map(c => `<option ${(x ? x.category : CATS[0]) === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>계약 시작일</label><input type="date" id="c-start" value="${esc(x ? x.start || "" : "")}"></div>
        <div class="form-row"><label>계약 종료일</label><input type="date" id="c-end" value="${esc(x ? x.end || "" : "")}"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>계약 금액</label>
          <input id="c-amount" value="${esc(x ? x.amount || "" : "")}" maxlength="40" placeholder="예: 월 33,000,000원 (VAT 포함)"></div>
        <div class="form-row"><label>담당자</label>
          <input id="c-owner" value="${esc(x ? x.owner || "" : "")}" maxlength="30"></div>
      </div>
      <div class="form-row"><label>계약서 파일 링크 (Drive 등)</label>
        <input id="c-file" value="${esc(x ? x.fileUrl || "" : "")}" maxlength="300" placeholder="https://..."></div>
      <div class="form-grid">
        <div class="form-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:22px">
          <input type="checkbox" id="c-renew" style="width:auto" ${x && x.autoRenew ? "checked" : ""}> 자동 갱신 조항</label></div>
        <div class="form-row"><label>상태</label>
          <select id="c-status"><option ${(x ? x.status : "유효") !== "해지" ? "selected" : ""}>유효</option><option ${x && x.status === "해지" ? "selected" : ""}>해지</option></select></div>
      </div>
      <div class="form-row"><label>비고</label><input id="c-note" value="${esc(x ? x.note || "" : "")}" maxlength="200"></div>
      <div class="modal-actions">
        ${x ? '<button class="btn btn-danger" id="c-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="c-cancel">취소</button>
        <button class="btn btn-primary" id="c-save">저장</button>
      </div>`);

    $("#c-cancel").onclick = closeModal;
    if (x) $("#c-del").onclick = () =>
      confirmModal(`계약 "${x.name}"을(를) 삭제하시겠습니까?`, () => {
        D().contracts = list().filter(c => c.id !== x.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    $("#c-save").onclick = () => {
      const name = $("#c-name").value.trim();
      if (!name) { toast("계약명을 입력하세요.", true); return; }
      let start = $("#c-start").value, end = $("#c-end").value;
      if (start && end && end < start) { const t = start; start = end; end = t; }
      const rec = {
        name, party: $("#c-party").value.trim(),
        category: $("#c-cat").value,
        start: start || "", end: end || "",
        amount: $("#c-amount").value.trim(),
        owner: $("#c-owner").value.trim(),
        autoRenew: $("#c-renew").checked,
        fileUrl: $("#c-file").value.trim(),
        status: $("#c-status").value,
        note: $("#c-note").value.trim()
      };
      if (x) Object.assign(x, rec);
      else D().contracts.push(Object.assign({ id: uid("cn") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ─────── 목록 ─────── */
  function tableHTML() {
    const items = filtered();
    if (!items.length) return '<div class="empty">해당하는 계약이 없습니다.</div>';
    return `<div class="table-wrap"><table class="tbl"><thead><tr>
        <th>계약명 / 상대방</th><th style="width:80px">분류</th><th style="width:180px">계약 기간</th>
        <th style="width:96px">잔여</th><th>금액 / 담당</th><th style="width:66px">상태</th><th style="width:56px">파일</th></tr></thead><tbody>
      ${items.map(x => { const st = stateOf(x); return `
      <tr data-cn-row="${esc(x.id)}" style="cursor:pointer" class="${st !== "유효" ? "insp-cancel" : ""}">
        <td><b>${esc(x.name)}</b>${x.party ? `<div style="font-size:.76rem;color:var(--text-3)">${esc(x.party)}${x.autoRenew ? " · 🔄 자동갱신" : ""}</div>` : ""}</td>
        <td><span class="badge ${CAT_BADGE[x.category] || "badge-gray"}">${esc(x.category)}</span></td>
        <td style="font-size:.82rem">${esc(x.start || "?")} ~ ${esc(x.end || "기한없음")}</td>
        <td>${ddayBadge(x)}</td>
        <td style="font-size:.82rem">${esc(x.amount || "-")}${x.owner ? `<div style="font-size:.74rem;color:var(--text-3)">담당: ${esc(x.owner)}</div>` : ""}</td>
        <td><span class="badge ${STATE_BADGE[st]}">${esc(st)}</span></td>
        <td>${x.fileUrl ? `<a href="${esc(x.fileUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">열기 ↗</a>` : "-"}</td>
      </tr>`; }).join("")}</tbody></table></div>`;
  }

  /* ─────── 모듈 렌더 ─────── */
  SeMIS.registerModule("contracts-mgmt", {
    title: "계약서 관리",
    render(root) {
      const canWrite = SeMIS.roleRank() >= 2;
      const s = stats();
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">💼 계약서 관리</div>
          <span class="spacer"></span>
          ${canWrite ? '<button class="btn btn-primary" id="cn-add">+ 계약 등록</button>' : ""}
          <div class="page-desc">보안용역 · 경비 · 시스템 계약 현황과 만료 관리</div>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-label">유효 계약</div><div class="stat-value">${s.active}</div><div class="stat-sub">전체 ${list().length}건</div></div>
          <div class="stat"><div class="stat-label">90일 내 만료</div><div class="stat-value" style="color:var(--warning)">${s.soon}</div><div class="stat-sub">갱신 협의 필요</div></div>
          <div class="stat"><div class="stat-label">만료</div><div class="stat-value" style="color:var(--danger)">${s.expired}</div><div class="stat-sub">종료일 경과</div></div>
          <div class="stat"><div class="stat-label">자동 갱신</div><div class="stat-value">${s.renew}</div><div class="stat-sub">유효 계약 중</div></div>
        </div>
        <div class="card">
          <div class="cal-toolbar">
            <input id="cn-search" class="ct-search" type="search" style="max-width:280px"
              placeholder="🔍 계약명 · 상대방 · 담당 검색" value="${esc(query)}" autocomplete="off">
            <span class="spacer"></span>
            <div class="cal-views">${["전체", "유효", "만료임박", "만료", "해지"].map(f =>
              `<button class="cal-viewbtn${stFilter === f ? " active" : ""}" data-cfilter="${f}">${f}</button>`).join("")}</div>
          </div>
          <div id="cn-body">${tableHTML()}</div>
        </div>`;

      const wire = () => {
        if (canWrite) $$("#cn-body [data-cn-row]").forEach(el => el.onclick = () => cnForm(el.dataset.cnRow));
      };
      $("#cn-search").oninput = () => {
        query = $("#cn-search").value.trim();
        $("#cn-body").innerHTML = tableHTML(); wire();
      };
      $$("[data-cfilter]").forEach(b => b.onclick = () => { stFilter = b.dataset.cfilter; SeMIS.renderView(); });
      if (canWrite) $("#cn-add").onclick = () => cnForm(null);
      wire();
    }
  });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisContracts = {
    CATS, stateOf, daysLeft, stats, list,
    setFilter: (f) => { stFilter = f; }, setQuery: (q) => { query = String(q || ""); }
  };
})();
