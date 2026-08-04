/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 출입증 신청 서류 안내 모듈 (v2.36)
   라우트 "pass-docs" · 그룹 grp-pass · 열람 전체(all)

   구버전 Google Sites "출입증 신청 서류" 페이지를 v2 내부 모듈로 이관.
   핵심 = ① 신청 방법(절차) ② 준비할 서류.

   - 저장 데이터 없음(정적 안내) → SYNC_KEYS 변경 불필요
   - 서류 체크리스트만 개인 준비용으로 localStorage("semis2:passDocsChk:"+uid)에 보관
     (공용 DB 동기화 대상 아님 — 개인 진행 메모)
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc } = SeMIS;

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
    owners:  "https://docs.google.com/spreadsheets/d/1yMAhgi_yXKIxWXZqV8GamY6urrbT33AqwCDhpIyHGN4/edit?usp=sharing",
    rule:    "https://drive.google.com/file/d/18v4ZsN4037qIdDyt1f0gLZfT6yc3xVql/view?usp=drive_link",
    ruleDir: "https://drive.google.com/drive/folders/1FTgqAUwT-ZLHwGfz2AjxBAYPZhlP6qJL?usp=sharing",
    legacy:  "https://sites.google.com/view/kjsemis/%EC%B6%9C%EC%9E%85%EC%A6%9D%EB%B3%B4%EC%95%88%EC%9E%A5%EB%B9%84/%EC%B6%9C%EC%9E%85%EC%A6%9D-%EA%B4%80%EB%A6%AC/%EC%B6%9C%EC%9E%85%EC%A6%9D-%EC%8B%A0%EC%B2%AD-%EC%84%9C%EB%A5%98"
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
     "<b>pass.airport.kr</b>에서 신청서를 접수합니다. 접수는 사내 <b>출입증 관리 책임자</b>를 통해 진행하며, 책임자 명단은 아래 참고 자료에서 확인할 수 있습니다."],
    ["심사 · 발급 · 수령",
     "심사에 <b>소요기간이 있으므로 사전에 여유를 두고</b> 준비하시기 바랍니다. 결과 확인 후 출입증관리센터에서 수령합니다."]
  ];

  const NOTES = [
    "개인정보(주민등록번호 뒷자리, 상세주소 동·호수, 연락처 등)는 <b>마스킹 처리</b>합니다.",
    "서명란은 <b>작성자 이름을 정자로</b> 작성합니다.",
    "신원진술서는 <b>재작성 사례가 많으므로</b>, 사진은 내용을 모두 확인한 뒤 마지막에 부착하는 것이 좋습니다.",
    "PDF 자료는 <b>작성 참고용</b>이며, HWP 파일로 되어 있는 자료만 수기로 작성합니다."
  ];

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
        ${ext(L.owners, "출입증 관리 책임자 명단", "👤")}
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
        ${ext(L.ruleDir, "공항 출입증 규정 자료실", "🗂️")}
        ${ext(L.legacy, "구버전 안내 페이지 (kjsemis)", "🕰️")}
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
          ${sec(3, "작성 시 주의사항", notesHTML())}
          ${sec(4, "참고 자료 · 문의", refHTML())}
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
    }
  });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisPassDocs = { DOCS, STEPS, NOTES, FORMS: F, LINKS: L, TEL, loadChk, saveChk, chkPct, chkKey };
})();
