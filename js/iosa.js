/* ═══════════════════════════════════════════════════════
   SeMIS v2 — IOSA (국제 인허가) 소개 모듈 (v2.36)
   라우트 "iosa" · 그룹 grp-rule · 열람 전체(all)

   IATA 공식 공개 자료(iata.org)만 인용한 정적 소개 화면.
   ※ 자사 IOSA 감사 준비·결과 등 보안성 자료는 본 모듈에 포함하지 않으며,
      기존 자료실 링크(구버전 메뉴, 열람 mgr 이상)에서 별도 관리한다.

   인용 출처 (2026-08-04 확인)
   - IATA Operational Safety Audit (IOSA)            : /en/programs/safety/audit/iosa/
   - IOSA and the Risk-Based Approach                : /en/programs/safety/audit/iosa/about-iosa/
   - IOSA Registration Process                       : /en/programs/safety/audit/iosa/iosa-registration/
   - Fact sheet: IATA Safety Audit Programs (2025.12): /en/iata-repository/pressroom/fact-sheets/fact-sheet-safety-audits/
   - Incident Data eXchange (IDX)                    : /en/services/data/safety/gadm/idx/

   저장 데이터 없음(정적 콘텐츠) → SYNC_KEYS 변경 불필요
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { esc } = SeMIS;

  const U = {
    iosa: "https://www.iata.org/en/programs/safety/audit/iosa/",
    rbi: "https://www.iata.org/en/programs/safety/audit/iosa/about-iosa/",
    reg: "https://www.iata.org/en/programs/safety/audit/iosa/iosa-registration/",
    fact: "https://www.iata.org/en/iata-repository/pressroom/fact-sheets/fact-sheet-safety-audits/",
    idx: "https://www.iata.org/en/services/data/safety/gadm/idx/",
    gadm: "https://www.iata.org/en/services/data/safety/gadm/",
    issa: "https://www.iata.org/en/programs/safety/audit/issa/",
    isago: "https://www.iata.org/en/programs/safety/audit/isago/",
    registry: "https://ic.iata.org/registry/iosa",
    ism: "https://www.iata.org/en/publications/manuals/iosa-standard-manual/"
  };
  const SRC_DATE = "2026-08-04";

  const STATS = [
    { label: "IOSA 등록 항공사", value: "450+", sub: "IOSA Registry (IATA Connect)" },
    { label: "ISM 표준 수", value: "916", sub: "IOSA Standards Manual" },
    { label: "중복 감사 절감", value: "6,400+", sub: "프로그램 누적 (건)" },
    { label: "사고율 격차", value: "약 3배", sub: "IOSA 등록사가 미등록사보다 우수" }
  ];

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
        <h2>🏅 IOSA — IATA Operational Safety Audit</h2>
        <p>항공사의 <b>운영 관리 및 통제 시스템</b>을 평가하기 위해 국제적으로 인정·수용되는 평가체계입니다.
           전 세계 공통 기준으로 감사하고 그 보고서를 상호 활용함으로써 중복 감사를 없애고,
           항공사·규제기관 모두의 비용과 자원을 절감합니다.</p>
        <div class="gd-hero-tags">
          <span class="gd-tag">IATA 회원 자격 요건</span>
          <span class="gd-tag">코드셰어 · 웻리스 · 차터의 표준</span>
          <span class="gd-tag">2024년 Risk-Based 전환</span>
          <span class="gd-tag">ISO 9001:2015 인증 프로그램</span>
        </div>
      </div>`;
  }

  function statsHTML() {
    return `<div class="stat-row">${STATS.map(s => `
      <div class="stat">
        <div class="stat-label">${esc(s.label)}</div>
        <div class="stat-value">${esc(s.value)}</div>
        <div class="stat-sub">${esc(s.sub)}</div>
      </div>`).join("")}</div>`;
  }

  function whatHTML() {
    return `
      <ul class="gd-ul">
        <li><b>정의</b> — 항공사의 운영 관리·통제 시스템을 평가하도록 설계된 국제 공인 평가체계로,
          <b>항공사 운영안전 감사의 글로벌 산업 표준</b>입니다.</li>
        <li><b>회원 요건</b> — 모든 IATA 회원 항공사는 IOSA에 등록되어 있으며,
          회원 자격을 유지하려면 등록 상태를 계속 유지해야 합니다.</li>
        <li><b>적용 범위</b> — 코드셰어(codeshare)·웻리스(wet-lease)·차터(charter) 운영에서도 확립된 표준으로 통용됩니다.</li>
        <li><b>개발 주체</b> — 호주 CASA, 미국 FAA, Transport Canada, 유럽 EASA 등 규제기관과 협력하여 개발되었고,
          ISARPs(IOSA 표준 및 권고관행)는 산업 파트너와 함께 지속적으로 개정됩니다.</li>
        <li><b>안전 성과</b> — 2023년 IOSA 등록 항공사에서 전손 사고 및 치명적 사고가 발생하지 않았으며,
          2005년 이후 IOSA 등록 항공사의 전체 사고율은 미등록 항공사 대비 <b>약 3배 우수</b>합니다.</li>
      </ul>
      <div class="gd-grid gd-g2" style="margin-top:13px">
        <div class="gd-item">
          <b>🎯 3대 전략 축</b>
          <span><b>Safety</b> 글로벌 안전 수준 향상·SMS 이행 지원 ·
            <b>Effectiveness</b> 중복 감사 최소화·프로그램 효과성 개선 ·
            <b>Integrity</b> 감사 프로세스 통제 강화·프로그램 신뢰성 보호</span>
        </div>
        <div class="gd-item">
          <b>🏛️ 규제기관의 활용</b>
          <span>FAA(비미국 코드셰어 승인), EASA(27개 EU 회원국 TCO 승인 및 위험기반 감독 주기),
            중국 CAAC(코드셰어 안전감사 자문회람) 등에서 활용하며,
            ICAO 제35·38차 총회가 IOSA의 안전 편익을 인정했습니다.</span>
        </div>
      </div>`;
  }

  function rbiHTML() {
    return `
      <p class="gd-p">IATA는 2022년부터 IOSA를 <b>리스크 기반(Risk-Based) 모델</b>로 진화시켜 <b>2024년 전환</b>했습니다.
        모든 항공사에 동일한 범위를 적용하던 “one-size-fits-all” 방식에서 벗어나,
        <b>항공사별 위험 프로파일에 맞춘 감사 범위</b>를 설계하고
        <b>성숙도 평가(Maturity Assessment)</b>를 새로 도입한 것이 핵심입니다.</p>
      <div class="gd-grid" style="margin-bottom:14px">
        <div class="gd-item"><b>① 데이터 기반 우선순위</b>
          <span>IATA <b>Safety Issue Hub</b>가 식별한 산업 전반의 안전 위험을 근거로 표준의 우선순위를 정합니다.</span></div>
        <div class="gd-item"><b>② 운영자별 범위 설계</b>
          <span>산업 표준에 더해 <b>운영 프로파일 · 안전 이벤트 · 과거 IOSA 감사 이력</b>을 조합해 감사 범위를 정합니다.</span></div>
        <div class="gd-item"><b>③ 성숙도 평가 도입</b>
          <span>적합/부적합 이분법을 넘어, 안전 관련 시스템·프로그램이 <b>얼마나 효과적으로 작동하는지</b>를 평가합니다.
            단, ISARPs 적합성이라는 <b>기준선(baseline)</b>은 그대로 요구됩니다.</span></div>
        <div class="gd-item"><b>④ 감사 품질 강화</b>
          <span>감사 방법과 감사관 역량 기준을 개선해 일관성과 신뢰도를 높였습니다.</span></div>
      </div>
      <table class="gd-cmp">
        <thead><tr><th style="width:22%">감사 범위 설정</th><th>기존 방식</th><th class="gd-cmp-new">현재 · 리스크 기반</th></tr></thead>
        <tbody>
          <tr>
            <td>전 세계 활주로 이탈률이 증가한 경우</td>
            <td>보편적 중요도와 무관하게 모든 ISARP를 감사</td>
            <td class="gd-cmp-new">ISARP를 주기적으로 우선순위화 — 활주로 이탈 관련 ISARP를 고위험으로 식별해 <b>심층 감사</b></td>
          </tr>
          <tr>
            <td>비핵심 ISARP에 여러 차례 연속 적합했던 경우</td>
            <td>중요도와 무관하게 모든 ISARP를 감사</td>
            <td class="gd-cmp-new">운영 프로파일·감사 이력에 맞춰 범위 조정 — 중요도가 낮은 ISARP는 <b>감사 주기를 낮춰</b> 고위험 항목에 집중</td>
          </tr>
        </tbody>
      </table>
      <div class="gd-info" style="margin-top:13px">
        <b>📌 지금까지의 성과</b> — 100건이 넘는 리스크 기반 감사가 수행되었으며,
        <b>감사한 표준 수는 오히려 줄었음에도 평균 부적합 발견 건수는 종전 감사의 약 2배</b>였습니다.
        항공사들은 성숙도 평가가 표준 적합성 평가를 보완하는 유용한 수단이라고 평가하고 있습니다.
      </div>`;
  }

  function regHTML() {
    return `
      <div class="gd-grid gd-g2" style="margin-bottom:14px">
        <div class="gd-item" style="border-left-color:var(--success)">
          <b>✅ 대상이 되는 운영자</b>
          <span>최대인증이륙중량 <b>5,700kg(12,566 lb) 초과</b>의 <b>2인 조종 · 다발</b> 항공기를 1대 이상 운영하면서
            ① 상업 여객 운송(객실승무원 유무 무관) 또는 ② 상업 화물 운송
            (supernumerary·화물 관리인 탑승 여부 무관)을 수행하는 경우</span>
        </div>
        <div class="gd-item" style="border-left-color:var(--danger)">
          <b>🚫 대상이 아닌 경우</b>
          <span>위 조건의 항공기를 보유하지 않거나 전 운항을 타 운영자가 수행하는 경우.
            5,700kg 이하 · 단발기 · 단독 조종 · 헬리콥터 · 수상기 운항에는 ISARPs를 적용하지 않으며,
            이 경우 <b>ISSA</b> 수감을 검토할 수 있습니다.</span>
        </div>
      </div>
      <div class="gd-steps">
        <div class="gd-step"><span class="gd-step-no">1</span><div class="gd-step-body">
          <b>자격 요건 확인</b><span>ISM(IOSA Standards Manual)의 적용 대상 요건에 해당하는지 먼저 확인합니다.</span></div></div>
        <div class="gd-step"><span class="gd-step-no">2</span><div class="gd-step-body">
          <b>Initial Audit Information Sheet 검토</b><span>최초 감사 전체 절차의 개요를 담은 안내서로 준비 범위를 파악합니다.</span></div></div>
        <div class="gd-step"><span class="gd-step-no">3</span><div class="gd-step-body">
          <b>최초 신청서 제출</b><span>Initial IOSA Application Form을 작성해 <b>iosa@iata.org</b>로 보내면 IOSA 팀이 다음 단계를 안내합니다.</span></div></div>
        <div class="gd-step"><span class="gd-step-no">4</span><div class="gd-step-body">
          <b>최초 감사 (Full-scope)</b><span>모든 최초 IOSA 감사는 <b>ISM의 전 ISARPs를 대상으로 하는 전체 범위</b> 방식으로 수행됩니다.
            ISARPs는 AOC에 등재되고 상업 운송에 사용되는 기종에만 적용되며,
            그 밖의 보유·임차 항공기는 감사 대상에서 제외되고 보고서에 그 사실이 설명과 함께 기재됩니다.</span></div></div>
        <div class="gd-step"><span class="gd-step-no">5</span><div class="gd-step-body">
          <b>등록 및 갱신</b><span>감사 완료 후 IOSA Registry에 등재되며, 갱신 감사(Renewal Audit) 일정은 <b>iosa@iata.org</b>로 협의합니다.</span></div></div>
      </div>`;
  }

  function idxHTML() {
    return `
      <p class="gd-p">IDX는 IATA의 <b>GADM(Global Aviation Data Management)</b> 프로그램에 속한
        <b>안전·보안 사건(Incident) 데이터 관리 프로그램</b>입니다.
        운항·객실·지상조업의 안전 및 <b>보안 발생사례</b>를 전 세계에서 모아
        <b>비식별(de-identified)·집계</b> 형태로 공유합니다.</p>
      <div class="gd-grid">
        <div class="gd-item"><b>📊 지표 · 벤치마킹</b>
          <span>안전·보안 정보를 KPI로 제공해, ICAO의 SMS 요건에 따른 <b>안전성과지표·목표</b>를
            지역·글로벌 수준에서 비교하며 설정할 수 있습니다.</span></div>
        <div class="gd-item"><b>🆓 기여자 무료 도구</b>
          <span>데이터를 제공하는 항공사에게 분석 도구와 리포트가 <b>무료로</b> 제공되며,
            안전·보안 위원회 안건 구성에 그대로 활용할 수 있습니다.</span></div>
        <div class="gd-item"><b>📈 대시보드</b>
          <span>지역·전 세계 주요 추세 파악, 벤치마킹, <b>특정 공항의 운영상 난제 예측</b>,
            핵심 사건 추세 식별 및 개선 목표 설정을 지원합니다.</span></div>
        <div class="gd-item"><b>🤖 심층 분석</b>
          <span>IATA 전문가와 AI 분석을 결합해 <b>기내 난동승객 · 드론 · 항공교통관리 관련 사건</b> 등을
            심층 분석하고, 사내 공유용 발표자료까지 제공합니다.</span></div>
      </div>
      <div class="gd-info" style="margin-top:13px">
        <b>🔗 IOSA와의 연결</b> — IDX는 IOSA 및 ISSA 준수를 뒷받침하며,
        IATA가 정립한 <b>보안 발생사례 분류체계(taxonomy)</b>는 IDX 프로그램과
        IOSA Standards Manual 등 IATA 발간물에 함께 반영되어 있습니다.
        GADM 참여 252개 항공사 중 174개가 IOSA 등록사이며, 그중 <b>165개가 IDX</b>에 참여하고 있습니다.
      </div>
      <ul class="gd-ul" style="margin-top:10px">
        <li><b>참여 대상</b> — 항공사, 지상조업사, 지상조업을 제공하는 공항</li>
        <li><b>참여 방법</b> — GADM 가입 신청서를 작성해 <b>gadm@iata.org</b>로 제출</li>
      </ul>`;
  }

  function relatedHTML() {
    return `
      <div class="gd-grid gd-g2">
        <div class="gd-item"><b>ISSA — IATA Standard Safety Assessment</b>
          <span>주로 <b>MTOW 5,700kg 미만</b> 항공기를 운영하는 항공사를 위한 평가 프로그램.
            평가 기준은 ISARPs에서 직접 도출되며 ICAO SMS 프레임워크를 다룹니다.
            2023년 10월부터 비상업 운영자도 수감할 수 있습니다.</span></div>
        <div class="gd-item"><b>ISAGO — IATA Safety Audit for Ground Operations</b>
          <span>지상조업사(GHSP)에 대한 글로벌 감독 프로그램. 표준화된 절차와 관리시스템 요건 이행을 유도하고,
            <b>하나의 ISAGO 감사로 다수 항공사의 중복 감사를 대체</b>해 비용을 줄입니다.
            보고서는 ONE Source 포털에서 관리됩니다.</span></div>
        <div class="gd-item"><b>IATA Connect</b>
          <span>IOSA 수행·갱신을 지원하는 협업 플랫폼. 항공사·감사관·규제기관이 참여하며
            <b>IOSA 문서와 감사보고서 저장소, IOSA Registry, Safety Issue Hub</b>가 통합되어 있습니다.</span></div>
        <div class="gd-item"><b>GADM 데이터 공유</b>
          <span>FDX(Flight Data eXchange)와 IDX로 구성되며, 감사 프로그램과 상호 보완해
            시스템적 안전 위험을 식별·측정·모니터링합니다.</span></div>
      </div>`;
  }

  function linksHTML() {
    return `
      <div class="gd-links">
        ${ext(U.iosa, "IOSA 프로그램 개요", "🏅")}
        ${ext(U.rbi, "IOSA and the Risk-Based Approach", "🎯")}
        ${ext(U.reg, "IOSA Registration Process", "📝")}
        ${ext(U.registry, "IOSA Registry (IATA Connect)", "📋")}
        ${ext(U.ism, "IOSA Standards Manual (ISM)", "📕")}
        ${ext(U.idx, "Incident Data eXchange (IDX)", "📊")}
        ${ext(U.gadm, "GADM 프로그램", "🗄️")}
        ${ext(U.issa, "ISSA", "🛩️")}
        ${ext(U.isago, "ISAGO", "🛠️")}
        ${ext(U.fact, "Fact Sheet · IATA Safety Audit Programs", "📄")}
      </div>
      <div class="gd-src">
        출처 — 본 화면의 내용은 IATA 공식 공개 자료
        (<a href="${esc(U.iosa)}" target="_blank" rel="noopener">IOSA</a>,
        <a href="${esc(U.rbi)}" target="_blank" rel="noopener">Risk-Based Approach</a>,
        <a href="${esc(U.reg)}" target="_blank" rel="noopener">Registration Process</a>,
        <a href="${esc(U.idx)}" target="_blank" rel="noopener">IDX</a>,
        <a href="${esc(U.fact)}" target="_blank" rel="noopener">Fact Sheet(2025.12)</a>)를 요약·번역한 것입니다.
        확인일 ${esc(SRC_DATE)} · 수치는 IATA 공표 기준(등록 항공사 수는 Registry 기준 450+,
        Fact Sheet 기준 2024년 12월 440개)이며 갱신될 수 있으므로 최신 값은 원문을 확인하세요.
      </div>`;
  }

  /* ─────── 모듈 등록 ─────── */
  SeMIS.registerModule("iosa", {
    title: "IOSA (국제 인허가)",
    render(root) {
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🏅 IOSA (국제 인허가)</div>
          <div class="page-desc">IATA 운영안전감사 제도 소개 — Risk-Based IOSA와 IDX 중심 (IATA 공식 자료 인용)</div>
        </div>
        ${heroHTML()}
        ${statsHTML()}
        <div class="card">
          ${sec(1, "IOSA란 무엇인가", whatHTML())}
          ${sec(2, "Risk-Based IOSA (리스크 기반 감사)", rbiHTML(), "2022년 착수 · 2024년 전환")}
          ${sec(3, "등록 자격과 절차", regHTML())}
          ${sec(4, "IDX — Incident Data eXchange", idxHTML(), "IATA GADM 안전·보안 데이터 공유")}
          ${sec(5, "관련 프로그램", relatedHTML())}
          ${sec(6, "공식 자료 · 출처", linksHTML())}
        </div>`;
    }
  });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisIosa = { URLS: U, STATS, SRC_DATE };
})();
