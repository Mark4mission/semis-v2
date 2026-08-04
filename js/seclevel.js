/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 국가 항공보안등급 소개 모듈 (v2.36)
   라우트 "seclevel" · 그룹 grp-level · 열람 전체(all)

   구버전 Google Sites "국가 항공보안등급 소개" 페이지를 v2 내부 모듈로 이관하고,
   국가법령정보센터·ICAO 공개 자료로 근거를 보강한 정적 안내 화면.

   - 저장 데이터 없음(정적 콘텐츠) → SYNC_KEYS 변경 불필요
   - 현재 등급/다음 예정 등급은 SeMIS.secCurrent()/secNext() 로 실시간 연동
   - 등급별 '세부 보안조치'는 국가항공보안 우발계획 및 자체 우발계획 소관(보안통제 정보)이므로
     본 화면에는 공개 가능한 제도 개요와 대응 방향만 개괄로 표시
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { esc } = SeMIS;

  const LEGACY_URL = "https://sites.google.com/view/kjsemis/%ED%95%AD%EA%B3%B5%EB%B3%B4%EC%95%88%EB%93%B1%EA%B8%89/%EA%B5%AD%EA%B0%80-%ED%95%AD%EA%B3%B5%EB%B3%B4%EC%95%88%EB%93%B1%EA%B8%89-%EC%86%8C%EA%B0%9C";
  const NOW_DOC_URL = "https://docs.google.com/document/d/1Fvsi7bcOofgXNv7PA5gPF4USuFAJ1JtLWrAApNY4BDM/edit?usp=sharing";
  const LAW_URL = "https://www.law.go.kr/%EB%B2%95%EB%A0%B9/%ED%95%AD%EA%B3%B5%EB%B3%B4%EC%95%88%EB%B2%95";
  const MOLIT_URL = "https://www.molit.go.kr/";

  /* 5단계 — 명칭·색상은 국가항공보안 우발계획의 발령단계 체계
     (평시 Green – 관심 Blue – 주의 Yellow – 경계 Orange – 심각 Red) */
  const LEVELS = [
    { name: "평시", en: "GREEN", color: "#16a34a", soft: "#f0fdf4",
      desc: "위협 징후가 식별되지 않은 일상 운영 상태. 법령이 정한 기본 보안조치를 정상 유지합니다." },
    { name: "관심", en: "BLUE", color: "#2563eb", soft: "#eff6ff",
      desc: "위협 징후가 일부 감지된 상태. 정보 수집·전파를 강화하고 보안 취약요소를 점검합니다." },
    { name: "주의", en: "YELLOW", color: "#ca8a04", soft: "#fefce8",
      desc: "위협 발생 가능성이 높아진 상태. 보안검색·순찰 등 현장 보안조치를 강화합니다." },
    { name: "경계", en: "ORANGE", color: "#ea580c", soft: "#fff7ed",
      desc: "위협이 구체화된 상태. 보안 인력·장비를 증강하고 보호구역 접근통제를 강화합니다." },
    { name: "심각", en: "RED", color: "#dc2626", soft: "#fef2f2",
      desc: "위협이 임박했거나 발생한 상태. 최고 수준의 보안조치와 비상대응 체계를 가동합니다." }
  ];

  const HISTORY = [
    ["2002. 11. 27.", "「항공안전 및 보안에 관한 법률」 제31조(비상계획)에 항공보안 우발 대응의 법적 근거 마련"],
    ["2003. 11. 25.", "법률 시행을 위하여 <b>국가항공보안 우발계획</b> 수립 — 항공보안등급을 5단계로 구분·운영"],
    ["이후 개정", "법률 개정에 따라 용어가 <b>‘비상계획’ → ‘우발계획’</b>으로 변경 (현행 「항공보안법」 제31조)"]
  ];

  function levelIndex(name) {
    const i = LEVELS.findIndex(l => l.name === name);
    return i < 0 ? 0 : i;
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
    const cur = SeMIS.secCurrent();
    const next = SeMIS.secNext();
    const li = LEVELS[levelIndex(cur.level)];
    return `
      <div class="gd-hero">
        <h2>📖 국가 항공보안등급 제도</h2>
        <p>민간항공을 대상으로 하는 항공테러 등 불법방해행위를 사전에 차단하기 위해,
           위협 정도에 따라 <b>5단계 등급</b>을 발령하고 등급별로 보안조치를 차등 강화하는 국가 대응체계입니다.</p>
        <div class="gd-hero-tags">
          <span class="gd-tag">근거 · 항공보안법 제31조</span>
          <span class="gd-tag">국가항공보안 우발계획 제6조</span>
          <span class="gd-tag">발령 · 국토교통부장관</span>
          <span class="gd-tag">5단계 (평시–관심–주의–경계–심각)</span>
        </div>
        <div class="gd-now">
          <span style="width:11px;height:11px;border-radius:50%;background:${li.color};
            box-shadow:0 0 0 3px rgba(255,255,255,.35)"></span>
          <span>현재 발령 등급 <b>${esc(cur.level)}</b>${cur.date ? " · " + esc(cur.date) + " 발령" : ""}${cur.end ? " ~ " + esc(cur.end) : ""}</span>
          ${next ? `<span style="opacity:.8">｜예정 ${esc(next.level)} (${esc(next.date)})</span>` : ""}
        </div>
      </div>`;
  }

  function levelsHTML() {
    const cur = SeMIS.secCurrent().level;
    return `<div class="gd-lvls">${LEVELS.map((l, i) => `
      <div class="gd-lvl${l.name === cur ? " on" : ""}" style="--lvc:${l.color};--lvs:${l.soft}">
        ${l.name === cur ? '<span class="gd-lvl-now">현재</span>' : ""}
        <div class="gd-lvl-top">
          <span class="gd-lvl-dot"></span>
          <span class="gd-lvl-name">${l.name}</span>
          <span class="gd-lvl-en">${l.en}</span>
          <span class="gd-lvl-step">${i + 1}단계</span>
        </div>
        <div class="gd-lvl-desc">${l.desc}</div>
      </div>`).join("")}</div>
    <div class="gd-note" style="margin-top:13px">
      <b>⚠ 등급별 세부 조치사항은 이 화면에 담지 않습니다</b>
      등급별로 이행해야 하는 구체적 보안조치는 <b>국가항공보안 우발계획</b>과 이에 따른
      <b>자체 우발계획</b>에 규정되어 있으며, 보안통제 정보에 해당합니다.
      실제 조치는 항공보안파트 지침과 자체 우발계획을 따르시기 바랍니다.
    </div>`;
  }

  function policyHTML() {
    return `
      <div class="gd-grid gd-g2">
        <div class="gd-item">
          <b>💠 추진 배경</b>
          <span>민간항공을 대상으로 하는 항공테러 등 불법방해행위를 사전에 차단하고,
            위협 등급별 대응체계를 구축하기 위해 도입되었습니다.</span>
        </div>
        <div class="gd-item">
          <b>💠 법적 근거</b>
          <span>「항공보안법」 제31조(국가항공보안 우발계획 등의 수립)에 따라 국토교통부장관이 수립한
            <b>국가항공보안 우발계획 제6조</b>(항공보안등급 발령 책임)</span>
        </div>
        <div class="gd-item">
          <b>💠 등급 체계</b>
          <span>민간항공에 대한 위협 정도에 따라 <b>5단계</b>로 발령·운영되며,
            등급이 상향될수록 보안 조치사항이 단계적으로 강화됩니다.</span>
        </div>
        <div class="gd-item">
          <b>💠 발령 · 조정</b>
          <span>민간항공에 대한 위협상황이 발생하였거나 위협이 증가하는 경우
            <b>국토교통부장관이 발령</b>합니다. 특정 공항 또는 특정 지역 항공노선에
            <b>한정하여 발령</b>할 수도 있습니다.</span>
        </div>
      </div>
      <div class="gd-info" style="margin-top:13px">
        <b>💠 정책 효과</b> — 국가 주요행사 및 테러 위협 정도에 따라 보안등급을 조정하거나 특정 지역에
        한정 발령함으로써 탄력적·효율적 대응이 가능하며, 공항공사 및 항공사별 보안강화 사항이
        구체·세분화되어 현장에서의 적의(適宜) 조치가 용이해집니다.
      </div>`;
  }

  function opsHTML() {
    return `
      <ul class="gd-ul">
        <li><b>공항운영자·항공운송사업자</b>는 국가항공보안 우발계획에 따라 <b>자체 우발계획</b>을 수립·시행하여야 하며,
          수립하거나 변경할 때에는 국토교통부장관의 승인을 받아야 합니다. (항공보안법 제31조)</li>
        <li>등급이 발령·조정되면 <b>보안동보(문자의 신)</b>로 관계 부서·지점에 전파하고,
          해당 등급에서 요구되는 조치 이행 여부를 점검합니다.</li>
        <li>SeMIS는 현재 등급을 <b>화면 상단 배지</b>와 <b>대시보드 보안등급 카드</b>에 상시 표시하며,
          발령 이력(시작일·종료일·비고)은 대시보드에서 관리합니다.</li>
        <li>기간이 정해진 등급(예: 국가 주요행사 대비 ‘경계’)은 <b>종료일이 지나면 직전의 무기한 등급으로 자동 복귀</b>합니다.</li>
      </ul>
      <div class="gd-links" style="margin-top:13px">
        <a class="gd-link" href="#/dashboard">🏠 대시보드 · 보안등급 현황 관리</a>
        ${ext(NOW_DOC_URL, "항공보안등급 현황 [현재] 문서", "✅")}
      </div>`;
  }

  function worldHTML() {
    return `
      <ul class="gd-ul">
        <li><b>ICAO</b>는 항공테러 등 예측이 어려운 불법방해행위로부터 민간항공을 효과적으로 보호하기 위하여
          <b>우발계획(Contingency Plans)</b> 수립을 의무화하고 있습니다.</li>
        <li><b>미국·영국·중국·일본</b> 등 대부분의 국가도 보안등급을 <b>3～5단계</b>로 구분하고,
          등급별로 차등적인 보안강화 조치사항을 이행하고 있습니다.</li>
      </ul>`;
  }

  function historyHTML() {
    return `<ul class="gd-tl">${HISTORY.map(([d, t]) => `
      <li><div class="gd-tl-date">${esc(d)}</div><div class="gd-tl-text">${t}</div></li>`).join("")}</ul>`;
  }

  function linksHTML() {
    return `
      <div class="gd-links">
        ${ext(LAW_URL, "항공보안법 (국가법령정보센터)", "⚖️")}
        ${ext(MOLIT_URL, "국토교통부", "🏛️")}
        ${ext(NOW_DOC_URL, "보안등급 현황 [현재]", "✅")}
        ${ext(LEGACY_URL, "구버전 소개 페이지 (kjsemis)", "🕰️")}
      </div>
      <div class="gd-src">
        출처 — 국가 항공보안등급 정책 개요·연혁·해외 동향: 구 SeMIS(kjsemis) 「국가 항공보안등급 소개」 게시 내용 /
        법적 근거 조문: <a href="${esc(LAW_URL)}" target="_blank" rel="noopener">국가법령정보센터 「항공보안법」 제31조</a>.
        등급 명칭·단계 구분은 국가항공보안 우발계획 체계를 따르며,
        각 단계 설명은 현장 이해를 돕기 위한 <b>개괄</b>입니다(공식 조치사항 아님).
      </div>`;
  }

  /* ─────── 모듈 등록 ─────── */
  SeMIS.registerModule("seclevel", {
    title: "국가 보안등급 소개",
    render(root) {
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">📖 국가 보안등급 소개</div>
          <div class="page-desc">국가 항공보안등급 제도의 근거·5단계 체계·발령 절차 안내</div>
        </div>
        ${heroHTML()}
        <div class="card">
          ${sec(1, "제도 개요", policyHTML())}
          ${sec(2, "항공보안등급 5단계", levelsHTML(), "위협 정도에 따라 등급 상향 시 조치 강화")}
          ${sec(3, "발령 시 우리의 대응", opsHTML())}
          ${sec(4, "연혁", historyHTML())}
          ${sec(5, "해외 동향", worldHTML())}
          ${sec(6, "참고 자료", linksHTML())}
        </div>`;
    }
  });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisSecLevel = { LEVELS, HISTORY, levelIndex, LEGACY_URL };
})();
