/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 보안서약서 문구 (v2.55)
   서약서 작성 화면(pledge.html)과 비밀 취급 / SSI 모듈(개별 서약서 인쇄)이 함께 쓴다.
   문구를 바꾸면 VERSION 을 올린다(인쇄물에 표시).
   ═══════════════════════════════════════════════════════ */
"use strict";

(function (root) {
  const TEXT = {
    ko: {
      title: "보안서약서",
      sub: "Security Pledge Agreement",
      lead: "본 서약서는 국가항공보안계획 1.2.13에 의거, 민감보안정보 취급자의 요건인 신원 조사를 대체한다.",
      clauses: [
        ["제1항 항공보안법 준수", "본인은 항공보안법, 국가항공보안계획, 공항보안규정, 항공사 자체보안계획, 지점보안계획 및 취항국가의 항공보안 관련 법령과 규정에서 정한 모든 항공보안요건을 철저히 준수할 것을 서약한다."],
        ["제2항 범죄이력 확인", "본인은 항공보안법, 관세법, 출입국관리법, 외국환거래법, 마약류관리에 관한 법률 위반으로 벌금 이상의 형을 선고받은 사실이 없음을 확인하고, 향후 민감보안정보를 취급하는 동안 전단의 법률 위반행위를 절대 하지 않을 것을 서약한다."],
        ["제3항 정보보안", "본인은 민감보안정보를 당사 업무 관련자에 대한 교육 및 긴급 전파 목적 외에 공개하거나 배포하지 않을 것을 서약한다."],
        ["제4항 위반 시 조치", "본인은 위의 사항을 어겼을 경우, 그에 수반되는 회사의 제반 조치에 어떠한 이의도 제기하지 않을 것을 서약한다."]
      ],
      agreeAll: "모든 조항에 동의합니다",
      to: "에어제타㈜ 대표 귀하"
    },
    en: {
      title: "Security Pledge Agreement",
      sub: "보안서약서",
      lead: "This pledge replaces the background check requirement for \"Need to Know\" person pursuant to National Civil Aviation Security Plan 1.2.13.",
      clauses: [
        ["Clause 1. Aviation Security Compliance", "I hereby pledge to strictly comply with all aviation security requirements as stipulated in the Aviation Security Act, the National Civil Aviation Security Program, Airport Security Plans, the Aircraft Operator Security Plan, Supplementary Station Procedures (SSP), and the aviation security laws and regulations of the countries to which the aircraft operates."],
        ["Clause 2. Criminal Record Confirmation", "I confirm that I have not been sentenced to a fine or more for any violation of the Aviation Security Act, Customs Act, Immigration Act, Foreign Exchange Act, or Narcotics Control Act. Furthermore, I pledge to strictly adhere to these laws and commit no violations while working as \"Need to Know\" person."],
        ["Clause 3. Information Security", "I hereby pledge not to disclose or distribute sensitive security information except for the purpose of education and emergency dissemination to employees related to our business."],
        ["Clause 4. Acceptance of Measures", "I undertake not to raise any objection to any action taken by the Company in the event of any breach of the above."]
      ],
      agreeAll: "I agree to all terms",
      to: "To President/CEO, AIRZETA Co., Ltd."
    }
  };
  root.SemisPledgeText = { VERSION: "2025.09", TEXT };
})(typeof window !== "undefined" ? window : this);
