/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 출입증 신청 서류 안내 모듈 (v2.36)
   라우트 "pass-docs" · 그룹 grp-pass · 열람 전체(all)

   구버전 Google Sites "출입증 신청 서류" 페이지를 v2 내부 모듈로 이관.
   핵심 = ① 신청 방법(절차) ② 준비할 서류 ③ 출입증 관리 책임자 명단.

   - 안내(절차·서류·주의사항)는 정적 콘텐츠
   - 서류 체크리스트는 개인 준비용으로 localStorage("semis2:passDocsChk:"+uid)에 보관
     (공용 DB 동기화 대상 아님 — 개인 진행 메모)
   - v2.36.1: 출입증 관리 책임자 명단(구글시트 이관) = DATA.passOwners (SYNC_KEY "passOwners")
       [{ id, no, org, team, name, title, empNo, passNo, tel, consent, note }]
       · 사번 · 출입증 발급 번호 · 개인정보 동의는 보안관리자(mgr) 이상만 열람
       · 편집 hq 이상(canEdit) · 삭제 canDelete
       · **실데이터는 코드에 시드하지 않는다**(개인정보 — 공개 저장소).
         공용 DB(semis_store "passOwners")에서만 로드 — 연락망(contacts) 모듈과 동일 원칙
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const LS_CHK = "semis2:passDocsChk:";

  const F = {   // 양식 · 안내 자료 (구버전 SeMIS Drive)
    guide:   "https://drive.google.com/file/d/11SXnJMBe0WFuLmXSJUPoguFuYFFcTzbl/view?usp=drive_link",
    howto:   "https://drive.google.com/file/d/1FHg6FExKbyueZDpCiaA5n41XOXTH4XnV/view?usp=drive_link",
    stmt:    "https://drive.google.com/file/d/1tBxU65zvmcWUWitDFFT3YRfLAYSNu2Xm/view?usp=drive_link",
    privacy: "https://drive.google.com/file/d/1tBxU65zvmcWUWitDFFT3YRfLAYSNu2Xm/view?usp=drive_link",
    admin:   "https://drive.google.com/file/d/1cxkj67lmzNVIk7oCC5WovUpjLSfRyLiv/view?usp=drive_link"
  };
  const L = {   // 외부 시스템 · 공식 안내
    pass:    "https://pass.airport.kr/",
    tsp:     "https://tsp.airport.kr:845/",
    edu:     "https://smartedu.airport.kr/",
    iiac:    "https://www.airport.kr/co_ko/802/subview.do",
    leaflet: "https://www.airport.kr/sites/co_ko/down/Leaflet_PassSystem.pdf",
    rule:    "https://drive.google.com/file/d/18v4ZsN4037qIdDyt1f0gLZfT6yc3xVql/view?usp=drive_link"
    /* v2.36.1 제거(사용자 요청): owners(구글시트 → 아래 명단 모듈로 이관) ·
       ruleDir(공항 출입증 규정 자료실) · legacy(구버전 안내 페이지) */
  };
  const TEL = "032-741-2560~2";

  /* 준비 서류 4종 */
  const DOCS = [
    { id: "d1", title: "재직증명서 1부",
      sub: "소속 회사에서 발급. 신청인 정보가 신청서와 일치해야 합니다." },
    { id: "d2", title: "신원진술서 1부", url: F.stmt,
      sub: "정자로 또박또박 작성 — ‘신청서류 양식 작성방법’을 반드시 먼저 확인하세요." },
    { id: "d3", title: "기타출입증 개인정보 제공 동의서 1부", url: F.privacy,
      sub: "개인정보 수집·제공에 대한 동의 양식." },
    { id: "d4", title: "행정정보 공동이용 사전동의서 1부", url: F.admin,
      sub: "행정정보 공동이용을 통한 확인에 동의하는 서류." }
  ];

  /* 신청 절차 */
  const STEPS = [
    ["출입증 종류·신청 요건 확인",
     "인천국제공항의 보호구역은 <b>사전에 승인된 출입자만</b> 출입할 수 있습니다. 필요한 출입 구역과 출입증 종류(인원/차량, 정규/임시)를 먼저 확인합니다."],
    ["보안교육 이수",
     "절차에 따라 <b>보안교육을 이수</b>해야 신청할 수 있습니다. 이동지역(에어사이드) 운전이 필요한 경우 <b>이동지역 운전자교육</b>을 별도로 이수합니다."],
    ["신청 서류 준비",
     "아래 <b>준비 서류 4종</b>을 갖춥니다. 양식은 다운로드 후 작성방법 안내에 맞춰 작성합니다."],
    ["온라인 신청 (출입증관리시스템)",
     "<b>pass.airport.kr</b>에서 신청서를 접수합니다. 접수는 사내 <b>출입증 관리 책임자</b>를 통해 진행하며, 책임자 명단은 <b>아래 ③ 출입증 관리 책임자</b> 항목에서 확인할 수 있습니다."],
    ["심사 · 발급 · 수령",
     "심사에 <b>소요기간이 있으므로 사전에 여유를 두고</b> 준비하시기 바랍니다. 결과 확인 후 출입증관리센터에서 수령합니다."]
  ];

  const NOTES = [
    "개인정보(주민등록번호 뒷자리, 상세주소 동·호수, 연락처 등)는 <b>마스킹 처리</b>합니다.",
    "서명란은 <b>작성자 이름을 정자로</b> 작성합니다.",
    "신원진술서는 <b>재작성 사례가 많으므로</b>, 사진은 내용을 모두 확인한 뒤 마지막에 부착하는 것이 좋습니다.",
    "PDF 자료는 <b>작성 참고용</b>이며, HWP 파일로 되어 있는 자료만 수기로 작성합니다."
  ];

  /* ═══════════ 출입증 관리 책임자 명단 (DATA.passOwners) ═══════════ */

  const owners = () => (Array.isArray(D().passOwners) ? D().passOwners : []);
  /* 번호 순 → 소속 → 이름 */
  function ownersSorted() {
    return owners().slice().sort((a, b) => {
      const na = Number(a.no) || 9999, nb = Number(b.no) || 9999;
      if (na !== nb) return na - nb;
      return String(a.org || "").localeCompare(String(b.org || ""), "ko")
        || String(a.name || "").localeCompare(String(b.name || ""), "ko");
    });
  }
  const canSeePriv = () => SeMIS.roleRank() >= 2;   // 사번·출입증번호·동의여부: 보안관리자 이상
  const telHref = (t) => "tel:" + String(t || "").replace(/[^0-9+]/g, "");

  function ownersTableHTML() {
    const list = ownersSorted();
    const priv = canSeePriv();
    const write = SeMIS.canEdit();
    if (!list.length) {
      return `<div class="empty">등록된 출입증 관리 책임자가 없습니다.${
        write ? " 상단 <b>+ 책임자 추가</b>로 등록하세요." : ""}</div>`;
    }
    return `
      <div class="table-wrap">
        <table class="tbl tbl-cap po-tbl" style="--cap:1120px">
          <thead><tr>
            <th style="width:44px">No</th>
            <th style="width:110px">소속</th>
            <th style="width:120px">팀 / 파트</th>
            <th style="width:86px">이름</th>
            <th style="width:64px">직책</th>
            ${priv ? '<th style="width:78px">사번</th><th style="width:118px">출입증 발급번호</th>' : ""}
            <th style="width:126px">연락처</th>
            ${priv ? '<th style="width:92px">개인정보 동의</th>' : ""}
            <th>비고</th>
            ${write ? '<th style="width:44px"></th>' : ""}
          </tr></thead>
          <tbody>${list.map((x, i) => `
            <tr${write ? ` data-po-row="${esc(x.id)}"` : ""}>
              <td>${esc(x.no || (i + 1))}</td>
              <td>${esc(x.org || "-")}</td>
              <td>${esc(x.team || "-")}</td>
              <td><b>${esc(x.name || "-")}</b></td>
              <td>${esc(x.title || "")}</td>
              ${priv ? `<td class="po-mono">${esc(x.empNo || "")}</td>
                        <td class="po-mono">${esc(x.passNo || "")}</td>` : ""}
              <td>${x.tel ? `<a href="${esc(telHref(x.tel))}">${esc(x.tel)}</a>` : "-"}</td>
              ${priv ? `<td><span class="badge ${x.consent ? "badge-green" : "badge-gray"}">${
                x.consent ? "동의" : "미동의"}</span></td>` : ""}
              <td>${esc(x.note || "")}</td>
              ${write ? `<td><button class="btn btn-ghost btn-sm" data-po-edit="${esc(x.id)}" title="수정">✏️</button></td>` : ""}
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  function ownersHTML() {
    const write = SeMIS.canEdit();
    return `
      ${write ? '<div class="gd-links" style="margin-bottom:11px"><button class="btn btn-primary btn-sm" id="po-add">+ 책임자 추가</button></div>' : ""}
      <div id="po-body">${ownersTableHTML()}</div>
      <div class="gd-info" style="margin-top:13px">
        <b>ℹ️ 신청 접수는 관리 책임자를 통해 진행합니다.</b>
        출입증관리시스템(pass.airport.kr) 신청은 회사별 출입증 관리 책임자가 접수합니다.
        본인 소속의 책임자에게 준비한 서류를 전달하세요.
      </div>
      ${canSeePriv() ? "" : `<div class="gd-src" style="margin-top:10px">
        사번 · 출입증 발급번호 · 개인정보 동의 여부는 <b>보안관리자 이상</b>에게만 표시됩니다.</div>`}`;
  }

  function ownerForm(id) {
    const x = id ? owners().find(v => v.id === id) : null;
    const f = (lbl, key, val, attrs) =>
      `<div class="form-row"><label>${lbl}</label><input id="po-${key}" value="${esc(val || "")}" ${attrs || ""}></div>`;
    openModal(`
      <h3>${x ? "책임자 수정" : "책임자 추가"} <span class="badge badge-gray">출입증 관리 책임자</span></h3>
      <div class="form-grid">
        ${f("번호", "no", x ? x.no : "", 'type="number" min="1"')}
        ${f("소속", "org", x && x.org, 'placeholder="예: 안전보안실"')}
        ${f("팀 / 파트", "team", x && x.team, 'placeholder="예: 항공보안팀"')}
        ${f("이름", "name", x && x.name)}
        ${f("직책", "title", x && x.title, 'placeholder="예: 프로"')}
        ${f("사번", "empNo", x && x.empNo)}
        ${f("출입증 발급번호", "passNo", x && x.passNo)}
        ${f("연락처", "tel", x && x.tel, 'placeholder="010-0000-0000"')}
      </div>
      <div class="form-row">
        <label><input type="checkbox" id="po-consent"${x && x.consent ? " checked" : ""}> 개인정보 제공 동의</label>
      </div>
      ${f("비고", "note", x && x.note)}
      <p class="form-hint">개인정보가 포함된 명단입니다 — 공용 DB에만 저장되며 코드에는 남지 않습니다.</p>
      <div class="modal-actions">
        ${x && SeMIS.canDelete() ? '<button class="btn btn-danger" id="po-del">삭제</button>' : ""}
        <span class="spacer"></span>
        <button class="btn btn-ghost" id="po-cancel">취소</button>
        <button class="btn btn-primary" id="po-save">저장</button>
      </div>`);

    $("#po-cancel").onclick = closeModal;
    $("#po-save").onclick = () => {
      const v = (k) => ($("#po-" + k) ? $("#po-" + k).value.trim() : "");
      if (!v("name") && !v("org")) { toast("소속 또는 이름을 입력하세요", true); return; }
      const rec = {
        id: x ? x.id : uid("po"),
        no: v("no"), org: v("org"), team: v("team"), name: v("name"), title: v("title"),
        empNo: v("empNo"), passNo: v("passNo"), tel: v("tel"),
        consent: !!($("#po-consent") && $("#po-consent").checked), note: v("note")
      };
      if (!Array.isArray(D().passOwners)) D().passOwners = [];
      if (x) Object.assign(x, rec); else D().passOwners.push(rec);
      SeMIS.save();
      closeModal();
      SeMIS.renderView();
      toast(x ? "수정했습니다" : "등록했습니다");
    };
    const del = $("#po-del");
    if (del) del.onclick = () => confirmModal("이 책임자를 삭제할까요?", () => {
      D().passOwners = owners().filter(v => v.id !== x.id);
      SeMIS.save();
      closeModal();
      SeMIS.renderView();
      toast("삭제했습니다");
    });
  }

  /* ─────── 체크리스트 상태 (개인 준비용) ─────── */
  function chkKey() {
    const u = SeMIS.user;
    return LS_CHK + ((u && u.id) || "_anon");
  }
  function loadChk() {
    try {
      const v = JSON.parse(localStorage.getItem(chkKey()));
      return v && typeof v === "object" ? v : {};
    } catch (e) { return {}; }
  }
  function saveChk(state) {
    try { localStorage.setItem(chkKey(), JSON.stringify(state)); } catch (e) { /* 저장 실패는 무시 */ }
  }
  function chkPct(state) {
    const done = DOCS.filter(d => state[d.id]).length;
    return { done, total: DOCS.length, pct: Math.round(done / DOCS.length * 100) };
  }

  /* ─────── 섹션 헬퍼 ─────── */
  const sec = (no, title, body, hint) => `
    <div class="gd-sec">
      <div class="gd-h"><span class="gd-num">${no}</span><span>${title}</span>
        <span class="spacer"></span>${hint ? `<span class="gd-hint">${hint}</span>` : ""}</div>
      ${body}
    </div>`;
  const ext = (url, label, ico) =>
    `<a class="gd-link" href="${esc(url)}" target="_blank" rel="noopener">${ico || "🔗"} ${esc(label)}<span class="gd-link-ext">↗</span></a>`;

  /* ─────── 화면 조각 ─────── */
  function heroHTML() {
    return `
      <div class="gd-hero">
        <h2>🪪 인천공항 보호구역 출입증 신청 안내</h2>
        <p>인천국제공항 보호구역에 인원·차량이 출입하거나 사진 촬영이 필요한 경우,
           정해진 절차에 따라 <b>보안교육을 이수</b>하고 <b>출입증을 신청</b>해야 합니다.
           심사에 시간이 걸리므로 <b>소요기간을 고려해 미리</b> 준비하세요.</p>
        <div class="gd-hero-tags">
          <span class="gd-tag">보안교육 이수 필수</span>
          <span class="gd-tag">준비 서류 4종</span>
          <span class="gd-tag">온라인 신청 · pass.airport.kr</span>
          <span class="gd-tag">문의 ${esc(TEL)}</span>
        </div>
      </div>`;
  }

  function stepsHTML() {
    return `<div class="gd-steps">${STEPS.map(([t, d], i) => `
      <div class="gd-step">
        <span class="gd-step-no">${i + 1}</span>
        <div class="gd-step-body"><b>${esc(t)}</b><span>${d}</span></div>
      </div>`).join("")}</div>
      <div class="gd-links" style="margin-top:14px">
        ${ext(L.pass, "출입증관리시스템 (신청)", "🖥️")}
        ${ext(L.edu, "이동지역 운전자교육", "🚚")}
        ${ext(L.guide, "인원정규출입증 온라인 신청서류 안내", "📄")}
      </div>`;
  }

  function docsHTML() {
    const st = loadChk();
    const p = chkPct(st);
    return `
      <div class="gd-chk-head">
        <div class="gd-chk-bar"><i id="pd-bar" style="width:${p.pct}%"></i></div>
        <div class="gd-chk-pct" id="pd-pct">${p.done} / ${p.total} 준비완료</div>
      </div>
      <div id="pd-list">${DOCS.map((d, i) => `
        <label class="gd-chk${st[d.id] ? " done" : ""}" data-pd="${esc(d.id)}">
          <input type="checkbox" data-pd-chk="${esc(d.id)}"${st[d.id] ? " checked" : ""}>
          <span>
            <span class="gd-chk-t">${i + 1}. ${esc(d.title)}</span>
            <span class="gd-chk-s">${esc(d.sub)}${d.url
              ? ` <a href="${esc(d.url)}" target="_blank" rel="noopener">양식 다운로드 ↗</a>` : ""}</span>
          </span>
        </label>`).join("")}</div>
      <div class="gd-links" style="margin-top:6px">
        ${ext(F.howto, "신청서류 양식 작성방법", "✍️")}
        ${ext(F.guide, "온라인 신청서류 안내", "📄")}
      </div>
      <div class="gd-src" style="margin-top:12px">
        체크 표시는 <b>이 브라우저에만</b> 저장되는 개인 준비 메모입니다(공용 데이터 아님).
        · 구버전 안내에서 <b>신원진술서</b>와 <b>개인정보 제공 동의서</b>가 동일한 파일로 연결되어 있습니다 —
        최신 양식은 출입증관리시스템 공지 또는 출입증 관리 책임자를 통해 확인하세요.
      </div>`;
  }

  function notesHTML() {
    return `
      <div class="gd-note">
        <b>⚠ 작성 시 주의사항</b>
        <ul class="gd-ul">${NOTES.map(n => `<li>${n}</li>`).join("")}</ul>
      </div>`;
  }

  function refHTML() {
    return `
      <div class="gd-links">
        ${ext(L.iiac, "인천공항공사 · 출입증/촬영/신변보호업무", "🏛️")}
        ${ext(L.leaflet, "출입증관리시스템 리플렛 (PDF)", "📕")}
        ${ext(L.tsp, "입주자 서비스포털", "🏢")}
        ${ext(L.rule, "보호구역 출입증 규정", "📘")}
      </div>
      <div class="gd-info" style="margin-top:13px">
        <b>📞 문의</b> — 출입증관리센터 <b>${esc(TEL)}</b> (인천국제공항공사 보안관리팀) ·
        사내 문의는 에어제타 항공보안파트로 연락하세요.
      </div>
      <div class="gd-links" style="margin-top:13px">
        <a class="gd-link" href="#/passes">🪪 사내 출입증 관리 (발급 현황·만료 관리)</a>
      </div>
      <div class="gd-src">
        출처 — 준비 서류·주의사항: 구 SeMIS(kjsemis) 「출입증 신청 서류」 게시 내용 /
        신청 절차 및 보안교육·소요기간 안내:
        <a href="${esc(L.iiac)}" target="_blank" rel="noopener">인천국제공항공사 「출입증/촬영/신변보호업무」</a> (확인일 2026-08-04).
        세부 절차·요건은 변경될 수 있으므로 실제 신청 전 출입증관리시스템 공지를 확인하세요.
      </div>`;
  }

  /* ─────── 모듈 등록 ─────── */
  SeMIS.registerModule("pass-docs", {
    title: "출입증 신청 서류",
    render(root) {
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">📋 출입증 신청 서류</div>
          <div class="page-desc">인천공항 보호구역 출입증 — 신청 방법과 준비 서류 안내</div>
        </div>
        ${heroHTML()}
        <div class="card">
          ${sec(1, "신청 절차", stepsHTML(), "소요기간을 고려해 사전 준비")}
          ${sec(2, "준비 서류 체크리스트", docsHTML(), "총 4종")}
          ${sec(3, "출입증 관리 책임자", ownersHTML(), "신청 접수 담당")}
          ${sec(4, "작성 시 주의사항", notesHTML())}
          ${sec(5, "참고 자료 · 문의", refHTML())}
        </div>`;

      $$("[data-pd-chk]", root).forEach(box => {
        box.onchange = () => {
          const st = loadChk();
          st[box.dataset.pdChk] = !!box.checked;
          saveChk(st);
          const row = box.closest(".gd-chk");
          if (row) row.classList.toggle("done", !!box.checked);
          const p = chkPct(st);
          const bar = $("#pd-bar", root), pct = $("#pd-pct", root);
          if (bar) bar.style.width = p.pct + "%";
          if (pct) pct.textContent = p.done + " / " + p.total + " 준비완료";
        };
      });

      /* 출입증 관리 책임자 명단 — hq 이상 편집 */
      if (SeMIS.canEdit()) {
        const add = $("#po-add", root);
        if (add) add.onclick = () => ownerForm(null);
        $$("#po-body [data-po-edit]", root).forEach(b => b.onclick = (ev) => {
          ev.stopPropagation(); ownerForm(b.dataset.poEdit);
        });
        $$("#po-body [data-po-row]", root).forEach(tr => tr.onclick = (ev) => {
          if (ev.target.closest("a,button")) return;
          ownerForm(tr.dataset.poRow);
        });
      }
    }
  });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisPassDocs = { DOCS, STEPS, NOTES, FORMS: F, LINKS: L, TEL,
    loadChk, saveChk, chkPct, chkKey,
    owners, ownersSorted, ownerForm, canSeePriv };
})();
