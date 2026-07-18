/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 규정 관리 모듈 (v2.12)
   국제/국가 보안규정(regs-intl) · 자체 보안규정(regs-own)

   데이터: DATA.regulations = [{ id, scope: "intl"|"own",
     title, rev, date, org, linkUrl, fileUrl, fileName,
     diffUrl, diffName,           ← 신구대조표 PDF (own 전용, 선택)
     note, ideas: [{ id, loc, kind, content, status, author, created }],
     updated }]
   - 열람: 링크 연결 또는 업로드 PDF(웹 뷰어 모달/새 탭)
   - 개정 아이디어 노트(own): 규정 위치 + 신규/변경/삭제 검토 내용
     · 열람 mgr 이상, 편집 hq 이상 (내부 검토 자료)
   - 편집: hq 이상 (canEdit)
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const SCOPES = {
    intl: { title: "국제/국가 보안규정", icon: "🌐",
            desc: "ICAO · IATA · 외국 정부 · 국가 항공보안 법령/규정 원문 관리",
            orgPh: "예: ICAO / 국토교통부 / TSA" },
    own:  { title: "자체 보안규정", icon: "📘",
            desc: "에어제타 자체 보안규정 · 지침 · 절차서 및 개정 검토 관리",
            orgPh: "예: 항공보안계획(NCASP 승인) / AVSEC-001" }
  };
  const PDF_MAX = 25 * 1024 * 1024;
  const IDEA_KINDS = ["신규", "변경", "삭제"];
  const IDEA_STATUS = ["검토중", "반영완료", "보류"];
  const KIND_BADGE = { "신규": "badge-green", "변경": "badge-amber", "삭제": "badge-red" };
  const ST_BADGE = { "검토중": "badge-blue", "반영완료": "badge-green", "보류": "badge-gray" };

  const list = () => (Array.isArray(D().regulations) ? D().regulations : []);
  const byScope = (scope) => list().filter(r => r && r.scope === scope);
  const ideasOf = (r) => (r && Array.isArray(r.ideas) ? r.ideas : []);
  const canSeeIdeas = () => SeMIS.roleRank() >= 2; // 내부 검토 자료: 보안관리자 이상

  let query = { intl: "", own: "" };

  function stats(scope) {
    const l = byScope(scope);
    return {
      total: l.length,
      pdf: l.filter(r => r.fileUrl).length,
      link: l.filter(r => r.linkUrl).length,
      latest: l.reduce((mx, r) => (r.date && r.date > mx ? r.date : mx), ""),
      ideas: l.reduce((n, r) => n + ideasOf(r).length, 0),
      open: l.reduce((n, r) => n + ideasOf(r).filter(i => i.status === "검토중").length, 0)
    };
  }

  function filtered(scope) {
    const q = (query[scope] || "").toLowerCase();
    return byScope(scope).filter(r => !q ||
      [r.title, r.rev, r.org, r.note].some(v => String(v || "").toLowerCase().includes(q)))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) ||
        String(a.title).localeCompare(String(b.title), "ko"));
  }

  /* ─────── PDF 업로드 (Supabase Storage → 공개 URL, 웹 열람) ─────── */
  async function uploadPdf(file, prefix, cb) {
    if (!file) return;
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
    if (!isPdf) { toast("PDF 파일만 업로드할 수 있습니다.", true); return; }
    if (file.size > PDF_MAX) { toast(file.name + ": 25MB를 초과합니다.", true); return; }
    if (!window.SemisSync || typeof fetch === "undefined") { toast("오프라인에서는 업로드할 수 없습니다.", true); return; }
    toast("업로드 중: " + file.name);
    try {
      const up = await SemisSync.uploadFile(file, prefix);
      cb({ url: up.url, name: file.name });
      toast("업로드되었습니다: " + file.name);
    } catch (e) { toast("업로드 실패 — 네트워크를 확인하세요.", true); }
  }

  /* ─────── PDF 웹 뷰어 (모달 iframe + 새 탭) ─────── */
  function viewPdf(url, title) {
    openModal(`
      <h3 style="display:flex;align-items:center;gap:8px">📄 <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</span></h3>
      <iframe class="reg-pdf-frame" src="${esc(url)}" title="${esc(title)}"></iframe>
      <div class="modal-actions">
        <a class="btn btn-ghost" href="${esc(url)}" target="_blank" rel="noopener">새 탭에서 열기 ↗</a>
        <button class="btn btn-primary" id="rg-view-close">닫기</button>
      </div>`, { wide: true });
    $("#rg-view-close").onclick = closeModal;
  }

  /* ─────── 규정 등록/수정 폼 (hq+) ─────── */
  function regForm(scope, id) {
    const sc = SCOPES[scope];
    const x = id ? list().find(r => r.id === id) : null;
    let file = x && x.fileUrl ? { url: x.fileUrl, name: x.fileName || "규정.pdf" } : null;
    let diff = x && x.diffUrl ? { url: x.diffUrl, name: x.diffName || "신구대조표.pdf" } : null;

    openModal(`
      <h3>${x ? "규정 수정" : "규정 등록"} <span class="badge badge-gray">${esc(sc.title)}</span></h3>
      <div class="form-row"><label>규정명 (제목)</label>
        <input id="rg-title" value="${esc(x ? x.title : "")}" maxlength="120" placeholder="예: 항공보안법 / AirZeta 항공보안계획"></div>
      <div class="form-grid">
        <div class="form-row"><label>버전 (Revision)</label>
          <input id="rg-rev" value="${esc(x ? x.rev || "" : "")}" maxlength="30" placeholder="예: Rev.12 / 개정 제12호"></div>
        <div class="form-row"><label>제·개정일자</label>
          <input type="date" id="rg-date" value="${esc(x ? x.date || "" : "")}"></div>
      </div>
      <div class="form-row"><label>발행기관 / 문서번호</label>
        <input id="rg-org" value="${esc(x ? x.org || "" : "")}" maxlength="80" placeholder="${esc(sc.orgPh)}"></div>
      <div class="form-row"><label>규정 링크 (URL)</label>
        <input id="rg-link" value="${esc(x ? x.linkUrl || "" : "")}" maxlength="500" placeholder="https:// — 법제처·Drive 등 원문 링크">
        <div class="form-hint">링크 연결 또는 아래 PDF 업로드 중 한 가지 이상을 등록하세요. (둘 다 가능)</div></div>
      <div class="form-row"><label>규정 원문 PDF</label>
        <div id="rg-file-box" class="nb-files-view"></div>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;align-self:flex-start">📄 PDF 업로드 (25MB 이하)
          <input type="file" id="rg-file" accept="application/pdf,.pdf" style="display:none"></label></div>
      ${scope === "own" ? `
      <div class="form-row"><label>신구대조표 PDF (선택)</label>
        <div id="rg-diff-box" class="nb-files-view"></div>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;align-self:flex-start">📑 신구대조표 업로드
          <input type="file" id="rg-diff" accept="application/pdf,.pdf" style="display:none"></label></div>` : ""}
      <div class="form-row"><label>비고</label>
        <input id="rg-note" value="${esc(x ? x.note || "" : "")}" maxlength="200" placeholder="적용 범위, 관련 근거 등"></div>
      <div class="modal-actions">
        ${x ? '<button class="btn btn-danger" id="rg-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="rg-cancel">취소</button>
        <button class="btn btn-primary" id="rg-save">저장</button>
      </div>`, { wide: true });

    const chip = (f, rmId) => f
      ? `<span class="nb-file">📄 ${esc(f.name)} <button type="button" class="mt-btn danger" id="${rmId}" title="첨부 제거">✕</button></span>`
      : '<span class="form-hint">업로드된 파일이 없습니다.</span>';
    const renderFiles = () => {
      $("#rg-file-box").innerHTML = chip(file, "rg-file-rm");
      if (file && $("#rg-file-rm")) $("#rg-file-rm").onclick = () => { file = null; renderFiles(); };
      if ($("#rg-diff-box")) {
        $("#rg-diff-box").innerHTML = chip(diff, "rg-diff-rm");
        if (diff && $("#rg-diff-rm")) $("#rg-diff-rm").onclick = () => { diff = null; renderFiles(); };
      }
    };
    renderFiles();
    $("#rg-file").onchange = (e) => {
      const f = e.target.files[0]; e.target.value = "";
      uploadPdf(f, "regs", (up) => { file = up; renderFiles(); });
    };
    if ($("#rg-diff")) $("#rg-diff").onchange = (e) => {
      const f = e.target.files[0]; e.target.value = "";
      uploadPdf(f, "regs-diff", (up) => { diff = up; renderFiles(); });
    };

    $("#rg-cancel").onclick = closeModal;
    if (x) $("#rg-del").onclick = () =>
      confirmModal(`규정 "${x.title}"을(를) 삭제하시겠습니까? 개정 아이디어 노트도 함께 삭제됩니다.`, () => {
        D().regulations = list().filter(r => r.id !== x.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    $("#rg-save").onclick = () => {
      const title = $("#rg-title").value.trim();
      if (!title) { toast("규정명을 입력하세요.", true); return; }
      const linkUrl = $("#rg-link").value.trim();
      if (linkUrl && !/^https?:\/\/.+/.test(linkUrl)) { toast("올바른 링크(https://...)를 입력하세요.", true); return; }
      const rec = {
        title, rev: $("#rg-rev").value.trim(), date: $("#rg-date").value,
        org: $("#rg-org").value.trim(), linkUrl,
        fileUrl: file ? file.url : "", fileName: file ? file.name : "",
        diffUrl: diff ? diff.url : "", diffName: diff ? diff.name : "",
        note: $("#rg-note").value.trim(), updated: new Date().toISOString()
      };
      if (x) Object.assign(x, rec);
      else D().regulations.push(Object.assign({ id: uid("rg"), scope, ideas: [] }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ─────── 개정 아이디어 노트 (own 전용 · 열람 mgr+ · 편집 hq+) ─────── */
  function ideaList(regId) {
    const r = list().find(v => v.id === regId);
    if (!r) return;
    const canWrite = SeMIS.canEdit();
    const notes = ideasOf(r).slice().sort((a, b) => String(b.created).localeCompare(String(a.created)));
    openModal(`
      <h3 style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">💡 개정 아이디어 노트
        <span class="badge badge-gray" style="max-width:100%;overflow:hidden;text-overflow:ellipsis">${esc(r.title)}${r.rev ? " · " + esc(r.rev) : ""}</span></h3>
      <p class="form-hint" style="margin-bottom:10px">규정 검토 중 발견한 신규 반영·변경·삭제 아이디어를 기록해 두고, 차기 개정 시 활용합니다.</p>
      ${canWrite ? '<button class="btn btn-primary btn-sm" id="rg-idea-add" style="margin-bottom:10px">+ 아이디어 추가</button>' : ""}
      <div id="rg-idea-list">
        ${notes.length ? notes.map(n => `
          <div class="reg-idea">
            <div class="reg-idea-head">
              <span class="badge ${KIND_BADGE[n.kind] || "badge-gray"}">${esc(n.kind || "변경")}</span>
              <span class="badge ${ST_BADGE[n.status] || "badge-blue"}">${esc(n.status || "검토중")}</span>
              ${n.loc ? `<span class="reg-idea-loc">📍 ${esc(n.loc)}</span>` : ""}
              <span class="spacer"></span>
              ${canWrite ? `<button class="mt-btn" data-iedit="${esc(n.id)}" title="수정">✏️</button>
                <button class="mt-btn danger" data-idel="${esc(n.id)}" title="삭제">✕</button>` : ""}
            </div>
            <div class="reg-idea-body">${esc(n.content).replace(/\n/g, "<br>")}</div>
            <div class="reg-idea-meta">${esc(n.author || "")} · ${esc(String(n.created || "").slice(0, 10))}</div>
          </div>`).join("") : '<div class="empty">등록된 아이디어가 없습니다.</div>'}
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" id="rg-idea-close">닫기</button></div>`, { wide: true });

    $("#rg-idea-close").onclick = closeModal;
    if (canWrite) {
      $("#rg-idea-add").onclick = () => ideaForm(regId, null);
      $$("#rg-idea-list [data-iedit]").forEach(b => b.onclick = () => ideaForm(regId, b.dataset.iedit));
      $$("#rg-idea-list [data-idel]").forEach(b => b.onclick = () =>
        confirmModal("이 아이디어를 삭제하시겠습니까?", () => {
          r.ideas = ideasOf(r).filter(n => n.id !== b.dataset.idel);
          SeMIS.save(); SeMIS.renderView(); ideaList(regId); toast("삭제되었습니다.");
        }));
    }
  }

  function ideaForm(regId, ideaId) {
    const r = list().find(v => v.id === regId);
    if (!r) return;
    const n = ideaId ? ideasOf(r).find(v => v.id === ideaId) : null;
    openModal(`
      <h3>${n ? "아이디어 수정" : "아이디어 추가"} <span class="badge badge-gray">${esc(r.title)}</span></h3>
      <div class="form-row"><label>규정 위치</label>
        <input id="ri-loc" value="${esc(n ? n.loc || "" : "")}" maxlength="80" placeholder="예: 제3장 3.2.1항 / p.14"></div>
      <div class="form-grid">
        <div class="form-row"><label>검토 구분</label>
          <select id="ri-kind">${IDEA_KINDS.map(k =>
            `<option ${(n ? n.kind : "변경") === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>
        <div class="form-row"><label>상태</label>
          <select id="ri-status">${IDEA_STATUS.map(s =>
            `<option ${(n ? n.status : "검토중") === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      </div>
      <div class="form-row"><label>검토 내용</label>
        <textarea id="ri-content" rows="5" maxlength="2000"
          placeholder="신규 반영/변경/삭제가 필요한 내용과 사유, 참고 근거 등">${esc(n ? n.content || "" : "")}</textarea></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="ri-cancel">취소</button>
        <button class="btn btn-primary" id="ri-save">저장</button>
      </div>`);
    $("#ri-cancel").onclick = () => ideaList(regId);
    $("#ri-save").onclick = () => {
      const content = $("#ri-content").value.trim();
      if (!content) { toast("검토 내용을 입력하세요.", true); return; }
      const rec = { loc: $("#ri-loc").value.trim(), kind: $("#ri-kind").value,
        status: $("#ri-status").value, content };
      if (n) Object.assign(n, rec);
      else {
        if (!Array.isArray(r.ideas)) r.ideas = [];
        r.ideas.push(Object.assign({ id: uid("ri"), author: SeMIS.user ? SeMIS.user.name : "",
          created: new Date().toISOString() }, rec));
      }
      SeMIS.save(); SeMIS.renderView(); ideaList(regId); toast("저장되었습니다.");
    };
  }

  /* ─────── 목록 테이블 ─────── */
  function tableHTML(scope) {
    const items = filtered(scope);
    const own = scope === "own";
    const showIdeas = own && canSeeIdeas();
    if (!items.length) return '<div class="empty">등록된 규정이 없습니다.</div>';
    return `<div class="table-wrap"><table class="tbl"><thead><tr>
        <th>규정명</th><th style="width:110px">버전</th><th style="width:106px">제·개정일자</th>
        <th style="width:${own ? 150 : 120}px">열람</th>
        ${own ? '<th style="width:90px">신구대조표</th>' : ""}
        ${showIdeas ? '<th style="width:76px">노트</th>' : ""}</tr></thead><tbody>
      ${items.map(r => {
        const openCnt = ideasOf(r).filter(i => i.status === "검토중").length;
        return `
      <tr data-rg-row="${esc(r.id)}"${SeMIS.canEdit() ? ' style="cursor:pointer" title="클릭하여 수정"' : ""}>
        <td><b>${esc(r.title)}</b>${r.org || r.note ? `<div style="font-size:.76rem;color:var(--text-3)">${esc(r.org || "")}${r.org && r.note ? " · " : ""}${esc(r.note || "")}</div>` : ""}</td>
        <td>${r.rev ? `<span class="badge badge-blue">${esc(r.rev)}</span>` : "-"}</td>
        <td style="font-size:.82rem">${esc(r.date || "-")}</td>
        <td style="white-space:nowrap">
          ${r.linkUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(r.linkUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">링크 ↗</a>` : ""}
          ${r.fileUrl ? `<button class="btn btn-ghost btn-sm" data-rg-pdf="${esc(r.id)}">📄 PDF</button>` : ""}
          ${!r.linkUrl && !r.fileUrl ? "-" : ""}</td>
        ${own ? `<td>${r.diffUrl ? `<button class="btn btn-ghost btn-sm" data-rg-diff="${esc(r.id)}">📑 보기</button>` : "-"}</td>` : ""}
        ${showIdeas ? `<td><button class="btn btn-ghost btn-sm" data-rg-idea="${esc(r.id)}" title="개정 아이디어 노트">💡 ${ideasOf(r).length}${openCnt ? `<span class="reg-idea-open">${openCnt}</span>` : ""}</button></td>` : ""}
      </tr>`; }).join("")}</tbody></table></div>`;
  }

  /* ─────── 페이지 렌더 ─────── */
  function renderPage(root, scope) {
    const sc = SCOPES[scope];
    const canWrite = SeMIS.canEdit();
    const s = stats(scope);
    root.innerHTML = `
      <div class="page-head">
        <div class="page-title">${sc.icon} ${esc(sc.title)}</div>
        <span class="spacer"></span>
        ${canWrite ? '<button class="btn btn-primary" id="rg-add">+ 규정 등록</button>' : ""}
        <div class="page-desc">${esc(sc.desc)}</div>
      </div>
      <div class="stat-row">
        <div class="stat"><div class="stat-label">등록 규정</div><div class="stat-value">${s.total}</div><div class="stat-sub">${esc(sc.title)}</div></div>
        <div class="stat"><div class="stat-label">최근 제·개정</div><div class="stat-value" style="font-size:1.05rem;padding-top:5px">${esc(s.latest || "-")}</div><div class="stat-sub">가장 최근 개정일</div></div>
        <div class="stat"><div class="stat-label">PDF 보관</div><div class="stat-value">${s.pdf}</div><div class="stat-sub">웹 열람 가능</div></div>
        ${scope === "own" && canSeeIdeas()
          ? `<div class="stat"><div class="stat-label">개정 아이디어</div><div class="stat-value" style="color:var(--warning)">${s.open}</div><div class="stat-sub">검토중 / 전체 ${s.ideas}건</div></div>`
          : `<div class="stat"><div class="stat-label">링크 연결</div><div class="stat-value">${s.link}</div><div class="stat-sub">외부 원문 링크</div></div>`}
      </div>
      <div class="card">
        <div class="cal-toolbar">
          <input id="rg-search" class="ct-search" type="search" style="max-width:280px"
            placeholder="🔍 규정명 · 버전 · 기관 검색" value="${esc(query[scope])}" autocomplete="off">
        </div>
        <div id="rg-body">${tableHTML(scope)}</div>
      </div>`;

    const wire = () => {
      if (canWrite) $$("#rg-body [data-rg-row]").forEach(el => el.onclick = (ev) => {
        if (ev.target.closest("button,a")) return;
        regForm(scope, el.dataset.rgRow);
      });
      $$("#rg-body [data-rg-pdf]").forEach(b => b.onclick = (ev) => {
        ev.stopPropagation();
        const r = list().find(v => v.id === b.dataset.rgPdf);
        if (r) viewPdf(r.fileUrl, r.title + (r.rev ? " (" + r.rev + ")" : ""));
      });
      $$("#rg-body [data-rg-diff]").forEach(b => b.onclick = (ev) => {
        ev.stopPropagation();
        const r = list().find(v => v.id === b.dataset.rgDiff);
        if (r) viewPdf(r.diffUrl, "신구대조표 — " + r.title);
      });
      $$("#rg-body [data-rg-idea]").forEach(b => b.onclick = (ev) => {
        ev.stopPropagation();
        ideaList(b.dataset.rgIdea);
      });
    };
    $("#rg-search").oninput = () => {
      query[scope] = $("#rg-search").value.trim();
      $("#rg-body").innerHTML = tableHTML(scope); wire();
    };
    if (canWrite) $("#rg-add").onclick = () => regForm(scope, null);
    wire();
  }

  SeMIS.registerModule("regs-intl", { title: SCOPES.intl.title, render(root) { renderPage(root, "intl"); } });
  SeMIS.registerModule("regs-own",  { title: SCOPES.own.title,  render(root) { renderPage(root, "own"); } });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisRegs = {
    SCOPES, IDEA_KINDS, IDEA_STATUS,
    list, byScope, stats, filtered, ideasOf, canSeeIdeas,
    setQuery: (scope, q) => { query[scope] = String(q || ""); },
    regForm, ideaList, ideaForm, viewPdf
  };
})();
