/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 출입증 관리 모듈 (v2.8)
   공항 출입증(상주직원/임시/차량) 발급·만료·반납 관리:
   목록 + 상태/만료 D-day 배지 + 통합 검색 + 상태 필터 + manager 편집

   데이터: DATA.passes = [{ id, kind, holder, company, no, area,
             issue, expire, status, note }]
     - kind: 상주직원 / 임시출입 / 차량 / 기타
     - status: 사용중 / 반납 / 분실 / 폐기
   ※ 실데이터는 코드에 시드하지 않음(개인정보) — 공용 DB 동기화.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const KINDS = ["상주직원", "임시출입", "차량", "기타"];
  const KIND_ICON = { "상주직원": "🪪", "임시출입": "⏱", "차량": "🚗", "기타": "▪" };
  const STATUSES = ["사용중", "반납", "분실", "폐기"];
  const ST_BADGE = { "사용중": "badge-green", "반납": "badge-gray", "분실": "badge-red", "폐기": "badge-gray" };

  const todayISO = () => new Date().toISOString().slice(0, 10);
  function daysLeft(dateStr) {
    if (!dateStr) return null;
    return Math.round((new Date(dateStr) - new Date(todayISO())) / 86400000);
  }
  const isExpired = (x) => x.status === "사용중" && x.expire && daysLeft(x.expire) < 0;

  function ddayBadge(x) {
    if (!x.expire) return '<span class="badge badge-gray">기한없음</span>';
    if (x.status !== "사용중") return "";
    const d = daysLeft(x.expire);
    if (d < 0) return `<span class="badge badge-red">만료 D+${-d}</span>`;
    if (d <= 7) return `<span class="badge badge-red">D-${d}</span>`;
    if (d <= 30) return `<span class="badge badge-amber">D-${d}</span>`;
    return `<span class="badge badge-gray">D-${d}</span>`;
  }

  let query = "", stFilter = "전체";

  const list = () => (Array.isArray(D().passes) ? D().passes : []);
  function filtered() {
    const q = query.toLowerCase();
    return list().filter(x => {
      if (stFilter === "만료임박") {
        const d = daysLeft(x.expire);
        if (!(x.status === "사용중" && x.expire && d <= 30)) return false;
      } else if (stFilter !== "전체" && x.status !== stFilter) return false;
      if (!q) return true;
      return [x.holder, x.company, x.no, x.area, x.kind, x.note]
        .some(v => String(v || "").toLowerCase().includes(q));
    }).sort((a, b) => {
      const ra = a.status === "사용중" ? 0 : 1, rb = b.status === "사용중" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return String(a.expire || "9999").localeCompare(String(b.expire || "9999"));
    });
  }

  function stats() {
    const l = list();
    const act = l.filter(x => x.status === "사용중");
    return {
      active: act.length,
      expired: act.filter(isExpired).length,
      soon: act.filter(x => { const d = daysLeft(x.expire); return x.expire && d >= 0 && d <= 30; }).length,
      lost: l.filter(x => x.status === "분실").length
    };
  }

  /* ─────── 등록/수정 폼 (manager+) ─────── */
  function passForm(id) {
    const x = id ? list().find(p => p.id === id) : null;
    openModal(`
      <h3>${x ? "출입증 수정" : "출입증 등록"} <span class="badge badge-gray">출입증 관리</span></h3>
      <div class="form-grid">
        <div class="form-row"><label>구분</label>
          <select id="p-kind">${KINDS.map(k => `<option ${(x ? x.kind : "상주직원") === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>
        <div class="form-row"><label>상태</label>
          <select id="p-status">${STATUSES.map(s => `<option ${(x ? x.status : "사용중") === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>성명 / 차량번호</label>
          <input id="p-holder" value="${esc(x ? x.holder : "")}" maxlength="40" placeholder="예: 홍길동"></div>
        <div class="form-row"><label>소속</label>
          <input id="p-company" value="${esc(x ? x.company : "")}" maxlength="40" placeholder="예: 에어제타 보안팀"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>출입증 번호</label>
          <input id="p-no" value="${esc(x ? x.no : "")}" maxlength="30" placeholder="예: I-2026-0001"></div>
        <div class="form-row"><label>출입 구역</label>
          <input id="p-area" value="${esc(x ? x.area : "")}" maxlength="40" placeholder="예: 보호구역 전지역, 램프"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>발급일</label><input type="date" id="p-issue" value="${esc(x ? x.issue || "" : "")}"></div>
        <div class="form-row"><label>만료일</label><input type="date" id="p-expire" value="${esc(x ? x.expire || "" : "")}"></div>
      </div>
      <div class="form-row"><label>비고</label><input id="p-note" value="${esc(x ? x.note || "" : "")}" maxlength="200"></div>
      <div class="modal-actions">
        ${x ? '<button class="btn btn-danger" id="p-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="p-cancel">취소</button>
        <button class="btn btn-primary" id="p-save">저장</button>
      </div>`);

    $("#p-cancel").onclick = closeModal;
    if (x) $("#p-del").onclick = () =>
      confirmModal(`출입증 "${x.holder || x.no}"을(를) 삭제하시겠습니까?`, () => {
        D().passes = list().filter(p => p.id !== x.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    $("#p-save").onclick = () => {
      const holder = $("#p-holder").value.trim();
      if (!holder) { toast("성명(또는 차량번호)을 입력하세요.", true); return; }
      let issue = $("#p-issue").value, expire = $("#p-expire").value;
      if (issue && expire && expire < issue) { const t = issue; issue = expire; expire = t; }
      const rec = {
        kind: $("#p-kind").value, holder,
        company: $("#p-company").value.trim(),
        no: $("#p-no").value.trim(),
        area: $("#p-area").value.trim(),
        issue: issue || "", expire: expire || "",
        status: $("#p-status").value,
        note: $("#p-note").value.trim()
      };
      if (x) Object.assign(x, rec);
      else D().passes.push(Object.assign({ id: uid("ps") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ─────── 상세 (읽기 전용) ─────── */
  function passDetail(id) {
    const x = list().find(p => p.id === id);
    if (!x) return;
    openModal(`
      <h3>${esc(KIND_ICON[x.kind] || "🪪")} ${esc(x.holder)} <span class="badge ${ST_BADGE[x.status] || "badge-gray"}">${esc(x.status)}</span></h3>
      <table class="tbl" style="font-size:.88rem">
        <tr><td style="width:90px;color:var(--text-2)">구분</td><td>${esc(x.kind)}</td></tr>
        <tr><td style="color:var(--text-2)">소속</td><td>${esc(x.company || "-")}</td></tr>
        <tr><td style="color:var(--text-2)">번호</td><td>${esc(x.no || "-")}</td></tr>
        <tr><td style="color:var(--text-2)">출입구역</td><td>${esc(x.area || "-")}</td></tr>
        <tr><td style="color:var(--text-2)">유효기간</td><td>${esc(x.issue || "?")} ~ ${esc(x.expire || "기한없음")} ${ddayBadge(x)}</td></tr>
        ${x.note ? `<tr><td style="color:var(--text-2)">비고</td><td>${esc(x.note)}</td></tr>` : ""}
      </table>
      <div class="modal-actions"><button class="btn btn-ghost" id="p-close">닫기</button></div>`);
    $("#p-close").onclick = closeModal;
  }

  /* ─────── 목록 ─────── */
  function tableHTML() {
    const items = filtered();
    if (!items.length) return '<div class="empty">해당하는 출입증이 없습니다.</div>';
    return `<div class="table-wrap"><table class="tbl"><thead><tr>
        <th style="width:86px">구분</th><th>성명 / 소속</th><th>번호</th><th>출입구역</th>
        <th style="width:110px">만료일</th><th style="width:96px">잔여</th><th style="width:70px">상태</th></tr></thead><tbody>
      ${items.map(x => `<tr data-pass-row="${esc(x.id)}" style="cursor:pointer" class="${isExpired(x) ? "insp-cancel" : ""}">
        <td>${esc(KIND_ICON[x.kind] || "▪")} ${esc(x.kind)}</td>
        <td><b>${esc(x.holder)}</b>${x.company ? `<div style="font-size:.76rem;color:var(--text-3)">${esc(x.company)}</div>` : ""}</td>
        <td style="font-size:.84rem">${esc(x.no || "-")}</td>
        <td style="font-size:.84rem">${esc(x.area || "-")}</td>
        <td style="font-size:.84rem">${esc(x.expire || "-")}</td>
        <td>${ddayBadge(x)}</td>
        <td><span class="badge ${ST_BADGE[x.status] || "badge-gray"}">${esc(x.status)}</span></td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  /* ─────── 모듈 렌더 ─────── */
  SeMIS.registerModule("passes", {
    title: "출입증 관리",
    render(root) {
      const canWrite = SeMIS.canEdit();
      const s = stats();
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🪪 출입증 관리</div>
          <span class="spacer"></span>
          ${canWrite ? '<button class="btn btn-primary" id="pass-add">+ 출입증 등록</button>' : ""}
          <div class="page-desc">공항 상주직원 · 임시 · 차량 출입증 발급/만료 현황</div>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-label">사용중</div><div class="stat-value">${s.active}</div><div class="stat-sub">전체 ${list().length}건</div></div>
          <div class="stat"><div class="stat-label">30일 내 만료</div><div class="stat-value" style="color:var(--warning)">${s.soon}</div><div class="stat-sub">갱신 준비 필요</div></div>
          <div class="stat"><div class="stat-label">만료 경과</div><div class="stat-value" style="color:var(--danger)">${s.expired}</div><div class="stat-sub">즉시 조치</div></div>
          <div class="stat"><div class="stat-label">분실</div><div class="stat-value" style="color:var(--danger)">${s.lost}</div><div class="stat-sub">신고/재발급 확인</div></div>
        </div>
        <div class="card">
          <div class="cal-toolbar">
            <input id="pass-search" class="ct-search" type="search" style="max-width:280px"
              placeholder="🔍 성명 · 소속 · 번호 검색" value="${esc(query)}" autocomplete="off">
            <span class="spacer"></span>
            <div class="cal-views">${["전체", "사용중", "만료임박", "반납", "분실"].map(f =>
              `<button class="cal-viewbtn${stFilter === f ? " active" : ""}" data-pfilter="${f}">${f}</button>`).join("")}</div>
          </div>
          <div id="pass-body">${tableHTML()}</div>
        </div>`;

      const wire = () => {
        $$("#pass-body [data-pass-row]").forEach(el => el.onclick = () => {
          canWrite ? passForm(el.dataset.passRow) : passDetail(el.dataset.passRow);
        });
      };
      $("#pass-search").oninput = () => {
        query = $("#pass-search").value.trim();
        $("#pass-body").innerHTML = tableHTML(); wire();
      };
      $$("[data-pfilter]").forEach(b => b.onclick = () => { stFilter = b.dataset.pfilter; SeMIS.renderView(); });
      if (canWrite) $("#pass-add").onclick = () => passForm(null);
      wire();
    }
  });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisPasses = {
    KINDS, STATUSES, daysLeft, isExpired, stats, list,
    setFilter: (f) => { stFilter = f; }, setQuery: (q) => { query = String(q || ""); }
  };
})();
