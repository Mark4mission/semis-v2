/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 교육 이수증 관리 모듈 (v2.15)
   외부기관(한국항공안전교육원·극동대·KAC·항공보안아카데미 등)
   보안책임자/보안감독자/보안검색감독자 교육 이수증 등록·관리

   데이터: DATA.certs = [{ id, certNo, name, dept, role, kind,
     org, issued, expire, fileUrl, fileName, note, updated, by }]
   - role: 보안책임자 / 보안감독자 / 보안검색감독자 / 기타
   - kind: 초기 / 정기
   - expire 자동 계산: 수료일 + 13개월 − 1일 (수정 가능)
   - 상태: 유효 / 임박(60일 이내) / 만료 — 대시보드 카드·만료도래 연동
   - PDF: 시스템 직접 업로드(Supabase Storage) → 웹 뷰어/인쇄/다운로드
   - 권한: 열람 mgr 이상(메뉴 vis "mgr"), 편집 hq 이상(canEdit)
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const ROLES = ["보안책임자", "보안감독자", "보안검색감독자", "기타"];
  const KINDS = ["초기", "정기"];
  const ORGS = ["한국항공안전교육원", "극동대 항공안전교육원", "KAC 항공보안교육", "항공보안아카데미"];
  const ROLE_BADGE = { "보안책임자": "badge-red", "보안감독자": "badge-blue", "보안검색감독자": "badge-green", "기타": "badge-gray" };
  const PDF_MAX = 20 * 1024 * 1024;
  const SOON_DAYS = 60;

  const todayISO = () => new Date().toISOString().slice(0, 10);
  const daysLeft = (ds) => ds ? Math.round((new Date(ds) - new Date(todayISO())) / 86400000) : null;
  const list = () => (Array.isArray(D().certs) ? D().certs : []);

  /* 유효만료일 자동 계산: 수료일 + 13개월 − 1일 (월말 보정) */
  function calcExpire(iso) {
    const p = String(iso || "").split("-").map(Number);
    if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return "";
    let y = p[0], mo = p[1] - 1 + 13;
    y += Math.floor(mo / 12); mo %= 12;
    const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const dt = new Date(Date.UTC(y, mo, Math.min(p[2], dim)));
    dt.setUTCDate(dt.getUTCDate() - 1);
    return dt.toISOString().slice(0, 10);
  }

  function stateOf(c) {
    if (!c.expire) return "유효";
    const d = daysLeft(c.expire);
    if (d < 0) return "만료";
    if (d <= SOON_DAYS) return "임박";
    return "유효";
  }
  const ST_BADGE = { "유효": "badge-green", "임박": "badge-amber", "만료": "badge-red" };
  function ddayBadge(c) {
    if (!c.expire) return '<span class="badge badge-gray">기한없음</span>';
    const d = daysLeft(c.expire);
    if (d < 0) return `<span class="badge badge-red">만료 D+${-d}</span>`;
    if (d <= 30) return `<span class="badge badge-red">D-${d}</span>`;
    if (d <= SOON_DAYS) return `<span class="badge badge-amber">D-${d}</span>`;
    return `<span class="badge badge-gray">D-${d}</span>`;
  }

  function stats() {
    const l = list();
    return {
      total: l.length,
      ok: l.filter(c => stateOf(c) === "유효").length,
      soon: l.filter(c => stateOf(c) === "임박").length,
      expired: l.filter(c => stateOf(c) === "만료").length,
      pdf: l.filter(c => c.fileUrl).length
    };
  }

  let query = "", stFilter = "전체", roleFilter = "전체";
  function filtered() {
    const q = query.toLowerCase();
    return list().filter(c => {
      if (stFilter === "만료임박" ? stateOf(c) !== "임박" : (stFilter !== "전체" && stateOf(c) !== stFilter)) return false;
      if (roleFilter !== "전체" && c.role !== roleFilter) return false;
      if (!q) return true;
      return [c.name, c.dept, c.certNo, c.org, c.note].some(v => String(v || "").toLowerCase().includes(q));
    }).sort((a, b) => String(a.expire || "9999").localeCompare(String(b.expire || "9999")) ||
      String(a.name).localeCompare(String(b.name), "ko"));
  }

  /* ─────── PDF 업로드 ─────── */
  async function uploadPdf(file, cb) {
    if (!file) return;
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
    if (!isPdf) { toast("PDF 파일만 업로드할 수 있습니다.", true); return; }
    if (file.size > PDF_MAX) { toast(file.name + ": 20MB를 초과합니다.", true); return; }
    if (!window.SemisSync || typeof fetch === "undefined") { toast("오프라인에서는 업로드할 수 없습니다.", true); return; }
    toast("업로드 중: " + file.name);
    try {
      const up = await SemisSync.uploadFile(file, "certs");
      cb({ url: up.url, name: file.name });
      toast("업로드되었습니다: " + file.name);
    } catch (e) { toast("업로드 실패 — 네트워크를 확인하세요.", true); }
  }

  /* ─────── PDF 뷰어 (웹 열람 + 인쇄 + 다운로드) ─────── */
  const printPdf = (url) => (window.SemisPolicy ? SemisPolicy.printPdf(url) : window.open(url, "_blank"));
  const dlPdf = (url, name) => (window.SemisPolicy ? SemisPolicy.downloadPdf(url, name) : window.open(url, "_blank"));
  function viewCert(id) {
    const c = list().find(x => x.id === id);
    if (!c || !c.fileUrl) return;
    const title = `${c.name} — ${c.role}(${c.kind}) 이수증`;
    openModal(`
      <h3 style="display:flex;align-items:center;gap:8px">🎖 <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</span></h3>
      <iframe class="reg-pdf-frame" src="${esc(c.fileUrl)}" title="${esc(title)}"></iframe>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="ct-print">🖨 인쇄</button>
        <button class="btn btn-ghost" id="ct-dl">⬇ 다운로드</button>
        <a class="btn btn-ghost" href="${esc(c.fileUrl)}" target="_blank" rel="noopener">새 탭 ↗</a>
        <button class="btn btn-primary" id="ct-view-close">닫기</button>
      </div>`, { wide: true });
    $("#ct-print").onclick = () => printPdf(c.fileUrl);
    $("#ct-dl").onclick = () => dlPdf(c.fileUrl, c.fileName || (c.name + "_" + c.role + "_이수증.pdf"));
    $("#ct-view-close").onclick = closeModal;
  }

  /* ─────── 등록/수정 폼 (hq+) ─────── */
  function certForm(id) {
    const c = id ? list().find(x => x.id === id) : null;
    let file = c && c.fileUrl ? { url: c.fileUrl, name: c.fileName || "이수증.pdf" } : null;
    openModal(`
      <h3>${c ? "이수증 수정" : "이수증 등록"} <span class="badge badge-gray">교육 이수증 관리</span></h3>
      <div class="form-grid">
        <div class="form-row"><label>성명</label>
          <input id="ct-name" value="${esc(c ? c.name : "")}" maxlength="30" placeholder="예: 홍길동"></div>
        <div class="form-row"><label>소속 (팀/지점)</label>
          <input id="ct-dept" value="${esc(c ? c.dept || "" : "")}" maxlength="40" placeholder="예: 항공보안팀"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>과정 (자격 구분)</label>
          <select id="ct-role">${ROLES.map(r => `<option ${(c ? c.role : ROLES[1]) === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
        <div class="form-row"><label>초기 / 정기</label>
          <select id="ct-kind">${KINDS.map(k => `<option ${(c ? c.kind : "초기") === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>수료기관</label>
          <input id="ct-org" value="${esc(c ? c.org || "" : "")}" maxlength="60" list="ct-orgs" placeholder="예: 한국항공안전교육원">
          <datalist id="ct-orgs">${ORGS.map(o => `<option value="${esc(o)}">`).join("")}</datalist></div>
        <div class="form-row"><label>수료번호</label>
          <input id="ct-no" value="${esc(c ? c.certNo || "" : "")}" maxlength="40" placeholder="예: KASI-2026-01-1234"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>수료일자</label>
          <input type="date" id="ct-issued" value="${esc(c ? c.issued || "" : "")}"></div>
        <div class="form-row"><label>유효만료일 <span style="font-weight:400;color:var(--text-3)">(자동: 수료일+13개월−1일)</span></label>
          <input type="date" id="ct-expire" value="${esc(c ? c.expire || "" : "")}"></div>
      </div>
      <div class="form-row"><label>이수증 PDF</label>
        <div id="ct-file-box" class="nb-files-view"></div>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;align-self:flex-start">📄 PDF 업로드 (20MB 이하)
          <input type="file" id="ct-file" accept="application/pdf,.pdf" style="display:none"></label></div>
      <div class="form-row"><label>비고</label>
        <input id="ct-note" value="${esc(c ? c.note || "" : "")}" maxlength="200"></div>
      <div class="modal-actions">
        ${c ? '<button class="btn btn-danger" id="ct-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="ct-cancel">취소</button>
        <button class="btn btn-primary" id="ct-save">저장</button>
      </div>`, { wide: true });

    const renderFile = () => {
      $("#ct-file-box").innerHTML = file
        ? `<span class="nb-file">📄 ${esc(file.name)} <button type="button" class="mt-btn danger" id="ct-file-rm" title="첨부 제거">✕</button></span>`
        : '<span class="form-hint">업로드된 이수증이 없습니다.</span>';
      if (file && $("#ct-file-rm")) $("#ct-file-rm").onclick = () => { file = null; renderFile(); };
    };
    renderFile();
    $("#ct-file").onchange = (e) => {
      const f = e.target.files[0]; e.target.value = "";
      uploadPdf(f, (up) => { file = up; renderFile(); });
    };
    // 수료일 변경 시 유효만료일 자동 계산
    $("#ct-issued").onchange = () => {
      const auto = calcExpire($("#ct-issued").value);
      if (auto) $("#ct-expire").value = auto;
    };

    $("#ct-cancel").onclick = closeModal;
    if (c) $("#ct-del").onclick = () =>
      confirmModal(`"${c.name}" 이수증을 삭제하시겠습니까?`, () => {
        D().certs = list().filter(x => x.id !== c.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    $("#ct-save").onclick = () => {
      const name = $("#ct-name").value.trim();
      if (!name) { toast("성명을 입력하세요.", true); return; }
      const issued = $("#ct-issued").value;
      let expire = $("#ct-expire").value;
      if (!expire && issued) expire = calcExpire(issued);
      if (issued && expire && expire < issued) { toast("유효만료일이 수료일보다 빠릅니다.", true); return; }
      const rec = {
        name, dept: $("#ct-dept").value.trim(),
        role: $("#ct-role").value, kind: $("#ct-kind").value,
        org: $("#ct-org").value.trim(), certNo: $("#ct-no").value.trim(),
        issued: issued || "", expire: expire || "",
        fileUrl: file ? file.url : "", fileName: file ? file.name : "",
        note: $("#ct-note").value.trim(),
        updated: new Date().toISOString(), by: SeMIS.user ? SeMIS.user.name : ""
      };
      if (c) Object.assign(c, rec);
      else D().certs.push(Object.assign({ id: uid("ct") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ─────── 시각화: 과정·상태별 / 월별 만료 도래 ─────── */
  function chartHTML() {
    const l = list();
    // ① 과정별 상태 스택 바
    const roleRows = ROLES.map(r => {
      const rl = l.filter(c => c.role === r);
      if (!rl.length) return "";
      const ok = rl.filter(c => stateOf(c) === "유효").length;
      const soon = rl.filter(c => stateOf(c) === "임박").length;
      const exp = rl.filter(c => stateOf(c) === "만료").length;
      const seg = (n, cls) => n ? `<span class="cert-seg ${cls}" style="flex:${n}" title="${n}명">${n}</span>` : "";
      return `<div class="cert-brow">
        <span class="cert-blabel">${esc(r)}</span>
        <div class="cert-bar">${seg(ok, "ok")}${seg(soon, "soon")}${seg(exp, "exp")}</div>
        <span class="cert-btotal">${rl.length}</span>
      </div>`;
    }).join("");
    // ② 향후 12개월 만료 도래
    const now = new Date();
    const months = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + i, 1));
      months.push({ key: d.toISOString().slice(0, 7), label: (d.getUTCMonth() + 1) + "월", n: 0 });
    }
    l.forEach(c => {
      if (!c.expire) return;
      const m = months.find(x => x.key === c.expire.slice(0, 7));
      if (m) m.n++;
    });
    const max = Math.max.apply(null, months.map(m => m.n).concat(1));
    const cols = months.map(m => `
      <div class="cert-mcol" title="${m.key} · ${m.n}건">
        <span class="cert-mnum">${m.n || ""}</span>
        <div class="cert-mbar" style="height:${Math.round(m.n / max * 100)}%"></div>
        <span class="cert-mlabel">${m.label}</span>
      </div>`).join("");
    return `
      <div class="cert-charts">
        <div class="cert-chart">
          <div class="cert-chart-title">과정별 현황
            <span class="cert-legend"><i class="ok"></i>유효 <i class="soon"></i>임박 <i class="exp"></i>만료</span></div>
          ${roleRows || '<div class="empty" style="padding:16px">데이터 없음</div>'}
        </div>
        <div class="cert-chart">
          <div class="cert-chart-title">월별 만료 도래 (향후 12개월)</div>
          <div class="cert-months">${cols}</div>
        </div>
      </div>`;
  }

  /* ─────── 목록 테이블 ─────── */
  function tableHTML() {
    const items = filtered();
    if (!items.length) return '<div class="empty">해당하는 이수증이 없습니다.</div>';
    return `<div class="table-wrap"><table class="tbl"><thead><tr>
        <th>성명 / 소속</th><th style="width:170px">과정</th><th style="width:150px">수료번호</th>
        <th style="width:150px">수료기관</th><th style="width:106px">수료일</th>
        <th style="width:150px">유효만료</th><th style="width:90px">이수증</th></tr></thead><tbody>
      ${items.map(c => { const st = stateOf(c); return `
      <tr data-ct-row="${esc(c.id)}"${SeMIS.canEdit() ? ' style="cursor:pointer" title="클릭하여 수정"' : ""} class="${st === "만료" ? "insp-cancel" : ""}">
        <td><b>${esc(c.name)}</b>${c.dept ? `<div style="font-size:.76rem;color:var(--text-3)">${esc(c.dept)}</div>` : ""}</td>
        <td style="white-space:nowrap"><span class="badge ${ROLE_BADGE[c.role] || "badge-gray"}">${esc(c.role)}</span>
          <span class="badge badge-gray">${esc(c.kind || "")}</span></td>
        <td style="font-size:.78rem">${esc(c.certNo || "-")}</td>
        <td style="font-size:.78rem">${esc(c.org || "-")}</td>
        <td style="font-size:.82rem;white-space:nowrap">${esc(c.issued || "-")}</td>
        <td style="white-space:nowrap"><span style="font-size:.82rem">${esc(c.expire || "-")}</span><div style="margin-top:2px">${ddayBadge(c)}</div></td>
        <td>${c.fileUrl ? `<button class="btn btn-ghost btn-sm" data-ct-pdf="${esc(c.id)}">📄 보기</button>` : '<span style="font-size:.76rem;color:var(--text-3)">미첨부</span>'}</td>
      </tr>`; }).join("")}</tbody></table></div>`;
  }

  /* ─────── 페이지 렌더 ─────── */
  SeMIS.registerModule("certs", {
    title: "교육 이수증 관리",
    render(root) {
      const canWrite = SeMIS.canEdit();
      const s = stats();
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🎖 교육 이수증 관리</div>
          <span class="spacer"></span>
          ${canWrite ? '<button class="btn btn-primary" id="ct-add">+ 이수증 등록</button>' : ""}
          <div class="page-desc">외부기관 보안책임자 · 보안감독자 · 보안검색감독자 교육 이수증 현황</div>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-label">전체 이수증</div><div class="stat-value">${s.total}</div><div class="stat-sub">PDF 보관 ${s.pdf}건</div></div>
          <div class="stat"><div class="stat-label">유효</div><div class="stat-value" style="color:var(--success,#16a34a)">${s.ok}</div><div class="stat-sub">만료 ${SOON_DAYS}일 초과</div></div>
          <div class="stat"><div class="stat-label">만료 임박</div><div class="stat-value" style="color:var(--warning)">${s.soon}</div><div class="stat-sub">${SOON_DAYS}일 이내 — 재교육 필요</div></div>
          <div class="stat"><div class="stat-label">만료</div><div class="stat-value" style="color:var(--danger)">${s.expired}</div><div class="stat-sub">유효기간 경과</div></div>
        </div>
        <div class="card">${chartHTML()}</div>
        <div class="card">
          <div class="cal-toolbar">
            <input id="ct-search" class="ct-search" type="search" style="max-width:250px"
              placeholder="🔍 성명 · 소속 · 수료번호 검색" value="${esc(query)}" autocomplete="off">
            <select id="ct-rolefilter" style="max-width:170px">
              ${["전체"].concat(ROLES).map(r => `<option ${roleFilter === r ? "selected" : ""}>${r}</option>`).join("")}
            </select>
            <span class="spacer"></span>
            <div class="cal-views">${["전체", "유효", "만료임박", "만료"].map(f =>
              `<button class="cal-viewbtn${stFilter === f ? " active" : ""}" data-ctfilter="${f}">${f}</button>`).join("")}</div>
          </div>
          <div id="ct-body">${tableHTML()}</div>
        </div>`;

      const wire = () => {
        if (canWrite) $$("#ct-body [data-ct-row]").forEach(el => el.onclick = (ev) => {
          if (ev.target.closest("button,a")) return;
          certForm(el.dataset.ctRow);
        });
        $$("#ct-body [data-ct-pdf]").forEach(b => b.onclick = (ev) => {
          ev.stopPropagation(); viewCert(b.dataset.ctPdf);
        });
      };
      $("#ct-search").oninput = () => {
        query = $("#ct-search").value.trim();
        $("#ct-body").innerHTML = tableHTML(); wire();
      };
      $("#ct-rolefilter").onchange = () => {
        roleFilter = $("#ct-rolefilter").value;
        $("#ct-body").innerHTML = tableHTML(); wire();
      };
      $$("[data-ctfilter]").forEach(b => b.onclick = () => { stFilter = b.dataset.ctfilter; SeMIS.renderView(); });
      if (canWrite) $("#ct-add").onclick = () => certForm(null);
      wire();
    }
  });

  /* ─────── 대시보드 카드 (현황 + 알람) ─────── */
  function renderDash(box) {
    const s = stats();
    const urgent = list().filter(c => stateOf(c) !== "유효")
      .sort((a, b) => String(a.expire || "9999").localeCompare(String(b.expire || "9999")))
      .slice(0, 6);
    box.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span class="badge badge-green">유효 ${s.ok}</span>
        <span class="badge badge-amber">임박 ${s.soon}</span>
        <span class="badge badge-red">만료 ${s.expired}</span>
        <span class="badge badge-gray">전체 ${s.total}</span>
      </div>
      ${urgent.length ? urgent.map(c => `
        <div class="insp-dash-row" data-ct-go style="display:flex;align-items:center;gap:6px;font-size:.8rem;padding:3px 0;cursor:pointer" title="클릭하여 이동">
          ${ddayBadge(c)}
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)} · ${esc(c.role)}(${esc(c.kind || "-")})${c.dept ? " — " + esc(c.dept) : ""}</span>
        </div>`).join("")
      : '<div style="font-size:.8rem;color:var(--text-3)">만료 임박/만료 이수증이 없습니다. ✅</div>'}`;
    $$("[data-ct-go]", box).forEach(el => el.onclick = () => SeMIS.navigate("certs"));
  }

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisCerts = {
    ROLES, KINDS, ORGS, SOON_DAYS,
    list, stats, stateOf, daysLeft, calcExpire, filtered, renderDash, viewCert, certForm,
    setQuery: (q) => { query = String(q || ""); },
    setFilter: (f) => { stFilter = f; },
    setRoleFilter: (r) => { roleFilter = r; }
  };
})();
