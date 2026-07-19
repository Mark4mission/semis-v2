/* ═══════════════════════════════════════════════════════
   SeMIS v2 — KPI 현황 (v2.20)
   항공보안HQ 이상 전용 — CSI 과제(안전보안 L1 / C6-1 / C6-2) 진도관리.
   - 원본: KPI_260719(CSI_C6-1).xlsx 과제정의서 3종 시드
   - 좌측 상단 제목 선택 → 과제별 개요·진척·Action Plan·타임라인
   - hq 이상: 상태/실적/메모 수정 가능 (공용 DB 동기화)
   - "보완" 배지 = 원본 빈칸을 시스템이 채운 항목 (검토 필요)
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const LS_SEL = "semis2:kpiSel";

  /* ─────────── 상태 정의 (8종) ─────────── */
  const ST_META = {
    "실행대기": { color: "#94a3b8", badge: "badge-gray",   grp: "wait" },
    "미실행":   { color: "#dc2626", badge: "badge-red",    grp: "risk" },
    "지연진행": { color: "#d97706", badge: "badge-amber",  grp: "run"  },
    "정시진행": { color: "#2563eb", badge: "badge-blue",   grp: "run"  },
    "완료지연": { color: "#ea580c", badge: "badge-orange", grp: "risk" },
    "지연완료": { color: "#65a30d", badge: "badge-green",  grp: "done" },
    "정상완료": { color: "#16a34a", badge: "badge-green",  grp: "done" },
    "조기완료": { color: "#0d9488", badge: "badge-green",  grp: "done" }
  };
  const ST_LIST = Object.keys(ST_META);
  const ST_ORDER = ["조기완료", "정상완료", "지연완료", "정시진행", "지연진행", "완료지연", "미실행", "실행대기"];
  const grpOf = (s) => (ST_META[s] || {}).grp || "wait";

  /* ─────────── 시드 데이터 (xlsx 이관) ─────────── */
  // a(phase, title, opts) — ps/pe 계획, rs/re 실적, st 상태, out 목표·산출물, risk 위험·지원필요
  const a = (phase, title, o) => Object.assign(
    { phase, title, main: "", sub: "", ps: "", pe: "", rs: "", re: "", st: "실행대기",
      out: "", risk: "", kids: [], added: false }, o || {});

  function seedKpis() {
    const L1 = {
      id: "L1", no: "안전보안L1", short: "TSA Upstream 추진",
      title: "HAN/HKG 발 미주행 보안검색면제(TSA Upstream) 추진",
      status: "On-track", leader: "안전보안실장",
      team: ["항공보안팀(2명)", "화물서비스팀(2명)", "인천화물팀(2명)", "현지 지점(지점 인원)"],
      goal: "1. HAN/HKG 발 미주행 환승화물 보안검색 면제를 통한 고객만족\n2. 보안검색 대상 화물량 감소에 따른 보안용역비 절감",
      effect: "[정량적] 1. ICN 환승 재보안 검색 면제를 통한 비용 5천만원 절감\n[정성적] 1. 적시 운송을 통한 고객만족도 향상\n- HAN, HKG 미주행 화물 보안검색 면제('25년 기준 전체 환적화물 중 50.5%)",
      bg: "HAN/HKG 발 미주행 환승화물 보안 재검색에 따른 투입자원(장비, 인력, 시간) 절감 필요성",
      scope: "TSA Upstream 인가 취득 / HAN, HKG Upstream 보안프로그램 제정 / 운영인력 자격인증\nTSA Upstream 현장심사 통과 / 자체점검을 통한 상시적 개선체계 운영",
      start: "2025-12-01", end: "2026-12-31",
      kp: ["TSA IIR Upstream 인증신청 의향서 접수",
           "HAN/HKG 지점별 TSA 인증장비 보유여부 확인",
           "현지보안검색 시설 및 장비 현황 조사",
           "직무별 업무를 핵심/지원 등으로 구분 및 직무 수행 자격 요건 정리"],
      next: ["TSA DHS 셧다운(2.14~) 해제 동향 모니터링 및 해제 즉시 인가신청서류 제출 — 만회 일정 수립",
             "TSA 기준 보안검색 매뉴얼 검토/개정 사전 준비(현행 절차 정리)",
             "HAN/HKG 현지 보안담당자 TSA 규정 교육 일정 사전 조율"],
      nextAdded: true,
      actions: [
        // ── 사전 준비 ──
        a("사전 준비", "Cargo Equipment List 작성(HAN 지점)", { group: "HAN/HKG 지점별 TSA 인증장비 보유여부 확인", main: "송희우", sub: "허영진(HAN)", ps: "2025-12-01", pe: "2026-01-23", rs: "2025-12-12", re: "2026-02-03", st: "지연완료" }),
        a("사전 준비", "Cargo Equipment List 작성(HKG 지점)", { group: "HAN/HKG 지점별 TSA 인증장비 보유여부 확인", main: "송희우", sub: "김희석(HKG)", ps: "2025-12-01", pe: "2026-01-23", rs: "2025-12-12", re: "2026-03-12", st: "지연완료", risk: "HKG 당사 거래 상용화주 21개 업체 보안장비리스트 취합 소요" }),
        a("사전 준비", "장비 리스트 작성본 검토(HAN 지점)", { group: "HAN/HKG 지점별 TSA 인증장비 보유여부 확인", main: "송희우", sub: "박범훈(CY)", ps: "2025-12-01", pe: "2026-01-23", rs: "2026-02-03", re: "2026-02-11", st: "지연완료" }),
        a("사전 준비", "장비 리스트 작성본 검토(HKG 지점)", { group: "HAN/HKG 지점별 TSA 인증장비 보유여부 확인", main: "송희우", ps: "2025-12-01", pe: "2026-01-23", rs: "2026-03-12", re: "2026-03-17", st: "지연완료" }),
        a("사전 준비", "TSA 작성자료 제출(HAN 지점)", { group: "HAN/HKG 지점별 TSA 인증장비 보유여부 확인", main: "송희우", ps: "2025-12-01", pe: "2026-01-23", rs: "2026-02-10", re: "2026-02-11", st: "지연완료" }),
        a("사전 준비", "TSA 작성자료 제출(HKG 지점)", { group: "HAN/HKG 지점별 TSA 인증장비 보유여부 확인", main: "송희우", ps: "2025-12-01", pe: "2026-01-23", rs: "2026-02-10", re: "2026-03-18", st: "지연완료" }),
        a("사전 준비", "지점 보안검색 장비현황 검토(HAN 지점)", { group: "현지보안검색 시설 및 장비 현황 조사", main: "송희우", sub: "박범훈", ps: "2026-01-23", pe: "2026-01-31", rs: "2026-02-10", re: "2026-02-11", st: "지연완료" }),
        a("사전 준비", "지점 보안검색 장비현황 검토(HKG 지점)", { group: "현지보안검색 시설 및 장비 현황 조사", main: "송희우", ps: "2026-01-23", pe: "2026-01-31", rs: "2026-02-03", re: "2026-03-17", st: "지연완료", risk: "HKG 당사 거래 상용화주 21개 업체 보안장비리스트 취합 소요" }),
        a("사전 준비", "보안검색체계 규정 적합성 당국문의(HAN 지점)", { group: "현지보안검색 시설 및 장비 현황 조사", main: "송희우", ps: "2026-01-23", pe: "2026-01-31", rs: "2026-02-11", st: "완료지연", risk: "베트남 정부 보안검색 기준 파악관련 기간소요(HAN지점)" }),
        a("사전 준비", "보안검색체계 규정 적합성 당국문의(HKG 지점)", { group: "현지보안검색 시설 및 장비 현황 조사", main: "송희우", ps: "2026-01-23", pe: "2026-01-31", rs: "2026-02-11", st: "완료지연", risk: "홍콩 정부 보안검색 기준 파악관련 기간소요(HKG지점)" }),
        // ── 인가 준비 및 신청 ──
        a("인가 준비 및 신청", "인가신청서류 작성 및 제출", { main: "이윤민", ps: "2026-02-01", pe: "2026-02-28", st: "미실행", risk: "TSA DHS(국토안보부) 셧 다운 진행 중(2.14~)",
          kids: ["Upstream Amendment Request Letter 초안 작성", "Request Letter 초안 검토 피드백 반영", "TSA 감독관을 통한 신청서류 최종검토 및 보완", "Request Letter 제출", "TSA 접수 확인 및 추가 요청사항 대응"] }),
        a("인가 준비 및 신청", "TSA 기준 보안검색 및 관련 매뉴얼 검토/개정", { main: "이윤민", ps: "2026-03-01", pe: "2026-03-12", st: "미실행", risk: "TSA DHS(국토안보부) 셧 다운 진행 중(2.14~)",
          kids: ["현행 한국/지점 보안검색 절차 검토 — 김홍석(KF)", "TSA 기준 보안요구사항 정리"] }),
        a("인가 준비 및 신청", "현지 보안담당자 TSA 규정 교육 및 인증 취득", { main: "이윤민", ps: "2026-03-13", pe: "2026-03-31", st: "미실행", risk: "TSA DHS(국토안보부) 셧 다운 진행 중(2.14~)",
          kids: ["개정매뉴얼 지점 배포 및 교육자료 준비", "HAN 지점 보안담당자 TSA 규정 교육 — 허영진", "HKG 지점 보안담당자 TSA 규정 교육 — 김희석", "Approval Document 검토 / 심사 세부사항 문의"] }),
        // ── 공항 심사 ──
        a("공항 심사", "TSA 현장심사 준비", { main: "이윤민", ps: "2026-04-01", pe: "2026-04-10", st: "미실행", risk: "TSA DHS(국토안보부) 셧 다운 진행 중(2.14~)",
          kids: ["심사일정 TSA측 문의 / 자체사전점검 체크리스트 작성 — 박범훈"] }),
        a("공항 심사", "사전 HAN/HKG 현장심사: KJ Upstream TF 주관", { main: "이윤민", ps: "2026-04-10", pe: "2026-05-31", st: "미실행",
          kids: ["HAN/HKG 사전심사 일정 조율 및 수립 — 허영진, 김희석", "HAN/HKG 사전 현장심사 실시 — 허영진, 김희석", "HAN/HKG 사전심사 종합보고 및 개선사항 도출 — 허영진, 김희석"] }),
        a("공항 심사", "TSA airport inspection(HKG/HAN)", { main: "이윤민", ps: "2026-06-01", pe: "2026-09-30", st: "미실행",
          kids: ["TSA 현장심사 일정 확정 및 심사관 정보 확인", "TSA HAN/HKG 현장심사 대응 — 박범훈, 허영진, 김희석, 김홍석", "TSA 현장심사 종합 결과 보고서 작성"] }),
        // ── 인가 취득 후 운영 ──
        a("인가 취득 후 운영", "TSA 심사 후 시정조치 이행사항 확인", { main: "이윤민", ps: "2026-10-01", pe: "2026-10-31", st: "실행대기",
          kids: ["TSA 공식 심사 결과 수령 및 시정조치 요구사항 확인", "HAN/HKG 지점별 시정조치 이행계획 수립 및 보고 — 허영진, 김희석", "HAN/HKG 지점별 시정조치 이행 모니터링 — 박범훈, 허영진, 김희석"] }),
        a("인가 취득 후 운영", "초기 운영성과 분석 및 지속적인 유효성 검증", { main: "이윤민", ps: "2026-11-01", pe: "2026-12-31", st: "실행대기",
          out: "- HAN/HKG TSA Upstream 인가취득 기간 단축\n- 미주 환승화물 재검색 감소율(HAN/HKG) 월 22%",
          kids: ["주간 운영현황 모니터링 및 이슈관리 — 허영진, 김희석", "재검색 면제 화물 실적 데이터 수집 및 분석 — 김홍석", "정시성 개선효과 분석 — 박범훈, 김홍석"] })
      ]
    };

    const C61 = {
      id: "C6-1", no: "안전보안C6-1", short: "내부 보안 관리 체계 보완 — 보안장비",
      title: "내부 보안 관리 체계 보완 (ETD 보안장비 예방정비·디지털화)",
      status: "On-track", leader: "항공보안파트장",
      team: ["실무지원 2명", "현장 운영 담당 1명", "프로에스콤 관리자 1명", "기술지원(필요시 협조)"],
      goal: "1. ETD 보안장비 관리 디지털화를 통한 예방정비 체계 구축\n2. 보안검색 업무 연속성 확보 (장비 가동률 90% 이상 유지)\n3. ETD보안장비 운영비 절감(임차료, 고장수리비 등)",
      effect: "[정량적] 1. 외주 용역비 및 장비 임차료 절감 — 임차 비용 절감: 29.5백만원(5년)\n2. 년간 ETD 장비 가동율 90% 이상 운영을 통한 안정적 화물 보안검색 지원 (정상가동일수/365일)\n3. 고장수리비 포함 운영비 절감 (년간 운영비/최근 3년 평균)",
      bg: "배경: ETD 장비 고장 빈발로 인한 운영 리스크 및 비용 증가\n이슈: 환경적 요인(습도, 온도, 먼지) 관리 미흡 / 사용자 교육 부족으로 인한 오조작 / 예방정비 체계 부재 / 실시간 모니터링 시스템 부재",
      scope: "장비 운영환경 개선(항온항습 시설, 클린룸 구축), IoT센서 기반 실시간 모니터링 등 디지털 통합 관제시스템 구축(전사 보안장비 통합 모니터링)\n교육체계 강화(운영자/정비인력 정기교육) 및 예방정비 프로세스 확립(정기점검 및 부품교체 주기 관리)",
      start: "2026-02-03", end: "2028-12-31",
      kp: ["보안장비 협의체 신설: 분야별 장비관리 개선방안 거버넌스로 공동현안 대응 및 기술파트너십 강화",
           "IoT 환경센서 모니터링 시스템 및 고장수리 신고처리 디지털화"],
      next: ["환경 표준화 개선 방안 로드맵 작성",
             "한국산업기술시험원(KTL) 및 항공안전기술원 실무 미팅 추진",
             "보안장비 관리협의체 활동 강화",
             "보안장비 시스템(CARES) 고도화"],
      actions: [
        // ── 장비 관리 현황 분석 ──
        a("장비 관리 현황 분석", "구매 이후 장비 수선유지 기록 데이터 확인", { main: "최상일", ps: "2025-11-01", pe: "2026-03-31", rs: "2025-11-01", re: "2026-03-18", st: "정상완료", out: "ETD 최적운영 절차 제정" }),
        a("장비 관리 현황 분석", "장비특성(취약점: 코로나 방전 팁, 수분 클러스터링, 멤브레인 노즐 오염 등) 및 사용조건 연구", { main: "최상일", ps: "2026-01-01", pe: "2026-12-31", rs: "2025-11-01", st: "정시진행" }),
        // ── 환경 표준화 ──
        a("환경 표준화 (Clean Booth 구축)", "화물터미널 내 환경(먼지, 습도, 매연) 정밀 측정 및 환경 개선 시작", { main: "최상일", ps: "2026-02-03", pe: "2026-05-31", rs: "2026-02-02", re: "2026-04-21", st: "조기완료" }),
        a("환경 표준화 (Clean Booth 구축)", "환경 표준화 개선 방안 로드맵 마련", { main: "최상일", ps: "2026-05-01", pe: "2026-12-31", rs: "2026-05-01", st: "정시진행" }),
        // ── 장비 운용 조건 개선 ──
        a("장비 운용 조건 개선", "장비별 사용량 균형 유지 절차 실행", { main: "최상일", ps: "2026-02-03", pe: "2026-03-31", rs: "2026-02-02", re: "2026-03-31", st: "정상완료", out: "특정 장비의 과도한 사용방지로 고장 예방" }),
        a("장비 운용 조건 개선", "장비운영 및 유지관리 고도화(모니터링 대시보드 구축)", { main: "최상일", ps: "2026-06-01", pe: "2027-01-31", rs: "2026-04-21", st: "정시진행" }),
        a("장비 운용 조건 개선", "제조사와 기술 파트너십 강화", { main: "최상일", sub: "파트장", ps: "2026-07-01", pe: "2027-06-30", rs: "2026-06-18", st: "정시진행", out: "뉴원S&T, 인씨스와 고장원인 분석 정보 교류", risk: "매월 보안협의체 협의회 개최 — 장소/교통/기타 운영" }),
        // ── DATA 기반 예측정비 도입(DBPM) ──
        a("DATA 기반 예측정비 도입(DBPM)", "엑셀 기반 일일 점검 체크리스트 디지털화(감도, 배경값, 오염도, 온습도, 청소여부)", { main: "최상일", ps: "2026-02-04", pe: "2026-05-31", rs: "2026-02-02", re: "2026-04-21", st: "조기완료", out: "4.21.부터 검색요원 일일점검 모바일 테스트 중" }),
        a("DATA 기반 예측정비 도입(DBPM)", "주간 점검 웹앱 개발(필터 교체, 소모품 상태, 오류 메시지)", { main: "최상일", ps: "2026-04-01", pe: "2026-06-02", rs: "2026-03-29", re: "2026-04-21", st: "조기완료", out: "현장 아이디어 반영 지속 개선 고도화" }),
        a("DATA 기반 예측정비 도입(DBPM)", "월간 성능 추이 분석 및 부품 교체 주기 디지털 최적화", { main: "최상일", ps: "2026-06-03", pe: "2026-08-31", rs: "2026-03-29", st: "정시진행", out: "보안장비협의회 정기 안건 사항" }),
        a("DATA 기반 예측정비 도입(DBPM)", "고장 유형별 트러블슈팅 매뉴얼(SOP) 고도화", { main: "최상일", ps: "2026-03-03", pe: "2026-09-30", rs: "2026-03-03", st: "정시진행", out: "사례연구결과 분석 후 매뉴얼 반영" }),
        a("DATA 기반 예측정비 도입(DBPM)", "예측정비 알고리즘 현장 적용", { main: "최상일", ps: "2026-03-03", pe: "2026-12-31", rs: "2026-03-03", st: "정시진행" }),
        // ── 인적 전문성 강화(SeMS) ──
        a("인적 전문성 강화(SeMS)", "항공보안장비유지보수요원 과정 이수(KAC)", { main: "최상일", ps: "2026-03-30", pe: "2026-04-03", rs: "2026-03-30", re: "2026-04-03", st: "정상완료", out: "보안검색장비관련 지식, 성능인증 기준 이해" }),
        a("인적 전문성 강화(SeMS)", "협력업체에 검색요원 기본교육 정례화 방안 논의(기본/심화 보안장비운용 등)", { main: "최상일", ps: "2026-05-01", pe: "2027-12-31", rs: "2026-04-17", st: "정시진행", out: "보안장비운용 고도화 및 고장신고체제 확립" }),
        a("인적 전문성 강화(SeMS)", "인력 이직으로 인한 전문성 손실 방지 — 지식 관리 시스템 마련 추진(Wiki 형태)", { main: "최상일", ps: "2026-06-01", pe: "2028-12-31", rs: "2026-06-01", st: "정시진행" }),
        a("인적 전문성 강화(SeMS)", "항공보안검색감독자 과정 이수(KAC)", { main: "최상일", ps: "2026-06-25", pe: "2026-11-30", rs: "2026-06-01", st: "정시진행", out: "교육기관 폐강으로 8월 이후로 연기", risk: "신청 인원미달로 인한 지연 가능성" }),
        a("인적 전문성 강화(SeMS)", "협력업체에 검색요원 포상제도 실행방안 제의('27년도 도입)", { main: "최상일", ps: "2026-10-01", pe: "2028-12-31", st: "실행대기", out: "연 1~2회 보안문화 증진 시행", risk: "회사명의 공식 행사, 포상 등" }),
        a("인적 전문성 강화(SeMS)", "협력업체의 휴먼 에러 감소를 위한 'Just Culture' 보고 체계 도입운영 기술지원 및 자료 확보", { main: "최상일", ps: "2026-10-01", pe: "2028-12-31", st: "실행대기" }),
        // ── 사용연한 연장 ──
        a("사용연한 연장", "한국산업기술시험원 및 항공안전기술원 성능검사 전 실무 미팅 추진", { main: "최상일", sub: "파트장", ps: "2026-06-01", pe: "2026-12-31", rs: "2026-07-01", st: "지연진행",
          out: "'25년도 평균 고장일 = 대당 평균 10.3일\n'26년도 상반기 평균 고장일 = CARES 고장기록 기반 산출 예정 (보완)", risk: "조직개편 지연: 계획시작일을 7월 1일 이후로 순연" }),
        a("사용연한 연장", "동종 업계 신기술 및 타제조사 모델 비교 분석", { main: "최상일", ps: "2026-09-01", pe: "2027-12-31", st: "실행대기", risk: "주말/휴일 고장시 유지보수 지원 지연 발생 — 제작사(뉴원)는 휴일 특별 유상 유지보수제도 별도 운영" }),
        a("사용연한 연장", "한국산업기술시험원 성능검사 기준에 따른 자체 모의 평가(Mock Test) 실시 / 항목분석 및 체크리스트 작성", { main: "최상일", ps: "2027-05-01", pe: "2027-06-30", st: "실행대기" }),
        a("사용연한 연장", "성능 저하 장비에 대한 선제적 오버홀(Overhaul) 수행 필요성 검토", { main: "최상일", ps: "2027-09-01", pe: "2027-12-31", rs: "2026-07-15", st: "정시진행", risk: "자산화 장비 유지보수비 유상 전환 1개월전 오버홀 실행 (조기 착수)" }),
        a("사용연한 연장", "사용연한 연장을 위한 성능검사 준비 및 신청 (교체 대상 장비 3대)", { main: "최상일", ps: "2027-10-01", pe: "2027-12-31", st: "실행대기" }),
        // ── 관리증진 종합시스템 구축 (원본 빈칸 → 보완) ──
        a("관리증진 종합시스템 구축", "CARES 권한관리 체계 고도화(6단계 권한 카테고리, 미등록 계정 로그인 차단, 보안 Rules 전면 개정)", { main: "최상일", ps: "2026-06-01", pe: "2026-07-31", rs: "2026-06-20", re: "2026-07-19", st: "정상완료", out: "CARES 권한관리 배포 완료(7.19)", added: true }),
        a("관리증진 종합시스템 구축", "CARES 현장 개선 4종 적용(모바일 점검기록, 시스템관리자 인계, ETD 가동균형, PIN 서버검증)", { main: "최상일", ps: "2026-06-01", pe: "2026-07-31", rs: "2026-07-01", re: "2026-07-19", st: "정상완료", out: "모바일 일일점검·ETD 사용량 균형 관리 현장 적용", added: true }),
        a("관리증진 종합시스템 구축", "SeMIS v2 연계 통합 모니터링(환경센서·고장신고 대시보드 연동)", { main: "최상일", ps: "2026-05-01", pe: "2026-06-30", rs: "2026-05-01", re: "2026-06-30", st: "정상완료", added: true }),
        a("관리증진 종합시스템 구축", "전사 보안장비 통합 관제 고도화(MTBF/MTTR 신뢰성 지표, 월간 보고서 자동화)", { main: "최상일", ps: "2026-08-01", pe: "2027-06-30", st: "실행대기", out: "장비 신뢰성 지표 자동 산출", added: true })
      ]
    };

    const C62 = {
      id: "C6-2", no: "안전보안C6-2", short: "내부 보안 관리 체계 보완 — 보안점검",
      title: "내부 보안 관리 체계 보완 (전사 보안점검·품질보증)",
      status: "On-track", leader: "항공보안파트장",
      team: ["심사관 전원(5명 — TAZ 포함)", "품질심사원 2명", "품질심사원(필요시)"],
      goal: "국토부 인가 자체보안계획 기준 국내 및 해외지점 보안점검 실시를 통한 전사적 보안품질보증 실현",
      effect: "[정량적] 1. 관리지표: '26년 개선조치건수 / 최근 5년 평균\n[정성적] 1. 사내 전문 심사인력 활용을 통한 효과적 심사 진행\n2. 취약요인/부적합사항 개선조치를 통한 보안품질 향상",
      bg: "1. 국토부 인가 자체보안계획/IOSA 심사기준 충족 필요\n- 4개 본부/부문 보안평가\n- 26개 국내/외 지점, 2개 국내 외부위탁사 보안점검\n2. 국내외 점검소요 대비 항공보안팀 자체심사관 인력 운용 한계",
      scope: "1. 국내지점 및 협력사(3개/1년 주기), 해외지점(9개/4년 주기) 보안점검 실시\n2. 부적합사항 개선조치 완료를 통한 재발방지",
      start: "2025-12-01", end: "2026-12-15",
      kp: ["26년도 국내/외 지점 보안점검 계획 수립"],
      next: ["월별 보안점검 실시율·개선율 보고 지속(~12/15)",
             "하반기 해외지점 점검 일정 확정 및 심사관 배정",
             "부적합사항 시정조치 이행 모니터링 (개선율 목표 연간 6.0 / 최근 5년 평균 5.0)"],
      nextAdded: true,
      actions: [
        a("연간 보안 점검 계획", "26년도 국내/외 지점, 협력사 보안심사 계획 수립 (점검 대상, 시기, 관련범위 포함)", { main: "이은우", ps: "2025-12-01", pe: "2025-12-31", rs: "2025-12-01", re: "2025-12-31", st: "정상완료", out: "26년도 국내/외 지점 및 보안기능 수행업체 보안점검 계획 품의 결재문서" }),
        a("점검 인력 소요 파악", "점검대상: 국내지점 및 외부위탁사 4개, 해외지점 9개, 해외 인증심사 3개(ACC3, TSA)", { main: "이은우", ps: "2026-01-02", pe: "2026-01-13", rs: "2026-01-02", re: "2026-01-13", st: "정상완료", out: "월별 보안점검 스케줄 및 심사관 배정" }),
        a("점검 인력 확보", "보안점검관련 자격취득 교육과정(품질심사관 초기, 보안감독자) 진행", { main: "최상일/송희우", sub: "이은우", ps: "2026-02-01", pe: "2026-02-28", rs: "2026-01-13", re: "2026-02-13", st: "조기완료", out: "교육대상 보안품질심사관 교육수료 및 인사발령 문서" }),
        a("점검 인력 확보", "보안품질심사관 인사발령(신규 확보 보안심사관)", { main: "이은우", ps: "2026-03-03", pe: "2026-03-06", rs: "2026-03-06", re: "2026-03-10", st: "지연완료",
          kids: ["1) 국내지점 보안점검: 항공보안팀 보안심사관(TAZ 포함 4명)", "2) 해외지점 보안점검: 항공보안팀 보안심사관 자체 또는 KF/CY 합동심사", "3) 미국 TSA, 유럽 ACC3 인증관련 사전 보안점검: TSA/ACC3 인허가 담당 및 화물서비스팀"] }),
        a("부적합사항 개선조치", "정부 수준관리 기준 충족관련 보안품질점검 실시 (월별 전체 심사대상 실시율 보고)", { main: "최상일, 이은우, 이윤민", ps: "2026-03-01", pe: "2026-12-15", rs: "2026-03-01", st: "정시진행", out: "부적합사항 시정 및 개선권고에 따른 개선율: 년간 6.0 / 최근 5년 평균 5.0 (시정 1점/건당, 개선권고 0.5점/건당)" }),
        a("부적합사항 개선조치", "부적합사항 개선조치 활동을 통한 재발방지 (월별 부적합사항 시정조치/개선권고를 통한 개선율 보고)", { main: "최상일, 이은우, 이윤민", ps: "2026-03-01", pe: "2026-12-15", rs: "2026-03-01", st: "정시진행" }),
        a("부적합사항 개선조치", "1) 국내지점 보안점검: 항공보안팀 보안심사관(TAZ 포함 4명)", { main: "최상일, 이은우, 이윤민", ps: "2026-03-01", pe: "2026-12-15", rs: "2026-03-01", st: "정시진행" }),
        a("부적합사항 개선조치", "2) 해외지점 보안점검: 항공보안팀 보안심사관 자체 또는 KF/CY 합동심사", { main: "최상일, 이은우, 이윤민", ps: "2026-03-01", pe: "2026-12-15", rs: "2026-03-01", st: "정시진행" }),
        a("부적합사항 개선조치", "3) 미국 TSA, 유럽 ACC3 인증관련 사전 보안점검: TSA/ACC3 인허가 담당 및 화물서비스팀", { main: "이윤민", sub: "(KF)김홍석, (CY)박범훈, 유준상", ps: "2026-03-01", pe: "2026-12-15", rs: "2026-03-01", st: "정시진행" })
      ]
    };

    const out = { v: 1, updated: "2026-07-19", src: "KPI_260719(CSI_C6-1).xlsx", items: [L1, C61, C62] };
    out.items.forEach(kk => kk.actions.forEach((x, i) => { x.id = kk.id + "-a" + (i + 1); }));
    return out;
  }

  /* ─────────── 데이터 접근/통계 ─────────── */
  const kpis = () => (D().kpis && Array.isArray(D().kpis.items)) ? D().kpis : { items: [] };
  const findKpi = (id) => kpis().items.find(x => x.id === id) || kpis().items[0] || null;

  function stats(kpi) {
    const c = {};
    ST_LIST.forEach(s => { c[s] = 0; });
    (kpi.actions || []).forEach(x => { if (c[x.st] !== undefined) c[x.st]++; else c[x.st] = (c[x.st] || 0) + 1; });
    const total = (kpi.actions || []).length;
    const done = (kpi.actions || []).filter(x => grpOf(x.st) === "done").length;
    const run = (kpi.actions || []).filter(x => grpOf(x.st) === "run").length;
    const risk = (kpi.actions || []).filter(x => grpOf(x.st) === "risk").length;
    const wait = total - done - run - risk;
    return { c, total, done, run, risk, wait, pct: total ? Math.round(done / total * 100) : 0 };
  }
  // 시간 경과율 (계획 기간 대비 오늘)
  function timePct(kpi) {
    const s = +new Date(kpi.start), e = +new Date(kpi.end), t = +new Date(todayISO());
    if (!(e > s)) return 0;
    return Math.min(100, Math.max(0, Math.round((t - s) / (e - s) * 100)));
  }
  const dday = (ds) => ds ? Math.round((new Date(ds) - new Date(todayISO())) / 86400000) : null;

  // 다음 단계: 미착수(실행대기/미실행) 항목을 계획 시작일순 정렬
  function nextItems(kpi) {
    return (kpi.actions || [])
      .filter(x => x.st === "실행대기" || x.st === "미실행")
      .slice().sort((x, y) => String(x.ps).localeCompare(String(y.ps)));
  }
  // 주의 필요: 미실행(계획 지남) + 완료지연 + 지연진행
  function attentionItems(kpi) {
    return (kpi.actions || []).filter(x => x.st === "미실행" || x.st === "완료지연" || x.st === "지연진행");
  }

  /* ─────────── 공통 조각 ─────────── */
  const stBadge = (st, added) =>
    `<span class="badge ${ (ST_META[st] || {}).badge || "badge-gray" }" style="white-space:nowrap">${esc(st)}</span>${added ? ' <span class="badge badge-amber" title="원본 빈칸을 시스템이 보완한 항목 — 검토 필요">보완</span>' : ""}`;

  const stackedBar = (kpi, h) => {
    const s = stats(kpi);
    if (!s.total) return "";
    const seg = ST_ORDER.filter(t => s.c[t]).map(t =>
      `<span title="${esc(t)} ${s.c[t]}건" style="flex:${s.c[t]};background:${ST_META[t].color}"></span>`).join("");
    return `<span class="kpi-stack" style="height:${h || 8}px">${seg}</span>`;
  };

  const period = (a2, b2) => (a2 || "") + " ~ " + (b2 || "");
  const mmdd = (ds) => ds ? String(ds).slice(2).replace(/-/g, ".") : "-";

  // 타임라인 미니 바 (과제 전체 기간 스케일: 계획=연한 바, 실적=상태색 바, 오늘=세로선)
  function tlBar(kpi, x) {
    const s0 = +new Date(kpi.start), s1 = +new Date(kpi.end);
    const span = Math.max(1, s1 - s0);
    const pct = (ds) => Math.min(100, Math.max(0, (+new Date(ds) - s0) / span * 100));
    if (!x.ps || !x.pe) return "";
    const l = pct(x.ps), w = Math.max(1.5, pct(x.pe) - l);
    let act = "";
    if (x.rs) {
      const al = pct(x.rs);
      const ar = Math.max(al + 1, pct(x.re || todayISO()));
      act = `<span class="tl-act" style="left:${al}%;width:${ar - al}%;background:${(ST_META[x.st] || {}).color || "#64748b"}"></span>`;
    }
    return `<span class="tl" title="계획 ${esc(period(x.ps, x.pe))}${x.rs ? " / 실적 " + esc(period(x.rs, x.re || "진행중")) : ""}">
      <span class="tl-plan" style="left:${l}%;width:${w}%"></span>${act}
      <span class="tl-now" style="left:${pct(todayISO())}%"></span></span>`;
  }

  /* ─────────── 모듈 화면 ─────────── */
  let curId = null;
  function selId() {
    if (curId && findKpi(curId) && findKpi(curId).id === curId) return curId;
    let saved = "";
    try { saved = localStorage.getItem(LS_SEL) || ""; } catch (e) { /* 무시 */ }
    curId = (saved && kpis().items.some(x => x.id === saved)) ? saved : (kpis().items[0] ? kpis().items[0].id : null);
    return curId;
  }
  function select(id) {
    curId = id;
    try { localStorage.setItem(LS_SEL, id); } catch (e) { /* 무시 */ }
    SeMIS.renderView();
  }

  SeMIS.registerModule("kpi", {
    title: "KPI 현황",
    render(root) {
      if (SeMIS.roleRank() < 3) {
        root.innerHTML = '<div class="card"><div class="empty">🔒 항공보안HQ 이상 전용 메뉴입니다.</div></div>';
        return;
      }
      const list = kpis().items;
      if (!list.length) {
        root.innerHTML = '<div class="card"><div class="empty">등록된 KPI가 없습니다.</div></div>';
        return;
      }
      const kpi = findKpi(selId());
      const canW = SeMIS.canEdit();
      const s = stats(kpi);
      const tp = timePct(kpi);
      const dd = dday(kpi.end);
      const nexts = nextItems(kpi).slice(0, 6);
      const attn = attentionItems(kpi);

      root.innerHTML = `
        <div class="page-head">
          <div>
            <div class="page-title">📈 KPI 현황</div>
            <div class="page-desc">CSI 과제 진도관리 — 기준: ${esc(kpis().updated || "")} (${esc(kpis().src || "xlsx")})</div>
          </div>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" id="kpi-print" title="현재 과제를 인쇄하거나 PDF로 저장">🖨 인쇄 / PDF</button>
        </div>

        <div class="kpi-pick">
          ${list.map(x => {
            const xs = stats(x);
            return `<button class="kpi-pick-btn ${x.id === kpi.id ? "on" : ""}" data-kpi="${esc(x.id)}">
              <span class="kpi-pick-no">${esc(x.no)}</span>
              <span class="kpi-pick-title">${esc(x.short || x.title)}</span>
              <span class="kpi-pick-sub">${stackedBar(x, 6)}<b>${xs.pct}%</b></span>
            </button>`;
          }).join("")}
        </div>

        <div class="card">
          <div class="card-title">🎯 ${esc(kpi.title)}
            <span class="badge ${kpi.status === "On-track" ? "badge-green" : "badge-amber"}">${esc(kpi.status)}</span>
            <span class="spacer"></span>
            <span class="badge ${dd !== null && dd < 0 ? "badge-red" : "badge-blue"}" title="과제 종료일까지">${dd !== null ? (dd < 0 ? "종료 D+" + (-dd) : "종료 D-" + dd) : ""}</span>
          </div>
          <div class="kpi-stat-grid">
            <div class="kpi-stat"><b>${s.pct}%</b><span>완료율 (${s.done}/${s.total})</span></div>
            <div class="kpi-stat"><b style="color:#2563eb">${s.run}</b><span>진행 중</span></div>
            <div class="kpi-stat"><b style="color:#dc2626">${s.risk}</b><span>주의 (미실행·완료지연)</span></div>
            <div class="kpi-stat"><b style="color:#64748b">${s.wait}</b><span>실행 대기</span></div>
          </div>
          <div class="kpi-2bars">
            <div><span class="kpi-bar-label">진척률 (완료 ${s.done}/${s.total}건)</span>
              <div class="insp-bar"><div class="insp-bar-fill" style="width:${s.pct}%"></div></div></div>
            <div><span class="kpi-bar-label">기간 경과율 (${esc(period(kpi.start, kpi.end))})</span>
              <div class="insp-bar"><div class="insp-bar-fill" style="width:${tp}%;background:#94a3b8"></div></div></div>
          </div>
          ${s.pct + 7 < tp ? '<div class="kpi-warn">⚠ 완료율이 기간 경과율보다 낮습니다 — 지연 항목의 만회 계획을 확인하세요.</div>' : ""}
          <div class="kpi-chiprow">
            ${ST_ORDER.map(t => s.c[t] ? `<span class="kpi-chip"><i style="background:${ST_META[t].color}"></i>${esc(t)} <b>${s.c[t]}</b></span>` : "").join("")}
          </div>
        </div>

        <div class="kpi-cols">
          <div class="card">
            <div class="card-title">📋 과제 개요 <span class="badge badge-gray">${esc(kpi.no)}</span></div>
            <div class="kpi-def">
              <div><label>개선 목표</label><p>${esc(kpi.goal).replace(/\n/g, "<br>")}</p></div>
              <div><label>예상 효과 (관리 지표)</label><p>${esc(kpi.effect).replace(/\n/g, "<br>")}</p></div>
              <div><label>추진 배경 · 주요 Issue</label><p>${esc(kpi.bg).replace(/\n/g, "<br>")}</p></div>
              <div><label>과제 Scope</label><p>${esc(kpi.scope).replace(/\n/g, "<br>")}</p></div>
              <div><label>추진 조직</label><p><b>리더</b> ${esc(kpi.leader)}<br>${kpi.team.map(esc).join(" · ")}</p></div>
              <div><label>기간</label><p>${esc(period(kpi.start, kpi.end))}</p></div>
            </div>
          </div>
          <div>
            <div class="card">
              <div class="card-title">🔑 Key Progress &amp; Issues</div>
              ${(kpi.kp || []).length ? `<ul class="kpi-ul">${kpi.kp.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : '<div class="empty">기록 없음</div>'}
            </div>
            <div class="card">
              <div class="card-title">⏭ Next Steps &amp; Make-up Plan
                ${kpi.nextAdded ? '<span class="badge badge-amber" title="원본 빈칸을 시스템이 보완한 내용 — 검토 필요">보완</span>' : ""}</div>
              ${(kpi.next || []).length ? `<ul class="kpi-ul">${kpi.next.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : '<div class="empty">기록 없음</div>'}
            </div>
          </div>
        </div>

        <div class="kpi-cols">
          <div class="card">
            <div class="card-title">🚀 다음 단계 준비 <span class="badge badge-blue">${nextItems(kpi).length}건 대기</span></div>
            ${nexts.length ? nexts.map(x => {
              const d2 = dday(x.ps);
              const late = x.st === "미실행";
              return `<div class="kpi-next-row" data-act="${esc(x.id)}" title="클릭하여 세부 확인">
                <span class="badge ${late ? "badge-red" : d2 !== null && d2 <= 14 ? "badge-amber" : "badge-gray"}">${late ? "지연" : d2 === null ? "-" : d2 < 0 ? "D+" + (-d2) : "D-" + d2}</span>
                <span class="kpi-next-title">${esc(x.title)}</span>
                <span class="kpi-next-meta">${esc(mmdd(x.ps))}~${esc(mmdd(x.pe))}${x.main ? " · " + esc(x.main) : ""}</span>
              </div>`;
            }).join("") : '<div class="empty">대기 중인 항목이 없습니다.</div>'}
          </div>
          <div class="card">
            <div class="card-title">⚠️ 주의 필요 항목 <span class="badge ${attn.length ? "badge-red" : "badge-green"}">${attn.length}건</span></div>
            ${attn.length ? attn.map(x => `<div class="kpi-next-row" data-act="${esc(x.id)}" title="클릭하여 세부 확인">
                ${stBadge(x.st)}
                <span class="kpi-next-title">${esc(x.title)}</span>
                <span class="kpi-next-meta">${esc(x.risk || "")}</span>
              </div>`).join("") : '<div class="empty">주의 항목이 없습니다. 👍</div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-title">🗂 Action Plan · 타임라인
            <span class="spacer"></span>
            <span class="kpi-legend"><i class="tl-plan-i"></i>계획 <i class="tl-act-i"></i>실적 <i class="tl-now-i"></i>오늘</span>
          </div>
          <div class="table-wrap">
            <table class="tbl kpi-tbl">
              <thead><tr>
                <th>상태</th><th>Action Plan</th><th>담당</th>
                <th>계획</th><th>실적</th>
                <th class="kpi-th-tl">타임라인 (${esc(kpi.start.slice(0, 4))}~${esc(kpi.end.slice(0, 4))})</th>
                <th>목표 · 산출물 / 위험</th>
              </tr></thead>
              <tbody>${renderRows(kpi, canW)}</tbody>
            </table>
          </div>
          <div class="form-hint" style="margin-top:8px">행을 클릭하면 세부 내용${canW ? "·실적 수정" : ""} 화면이 열립니다.
            "보완" 배지는 원본 엑셀의 빈칸을 시스템이 채운 항목입니다.</div>
        </div>`;

      // 이벤트
      $$(".kpi-pick-btn", root).forEach(b => b.onclick = () => select(b.dataset.kpi));
      $$("[data-act]", root).forEach(el => el.onclick = () => detailModal(kpi.id, el.dataset.act, canW));
      if ($("#kpi-print")) $("#kpi-print").onclick = () => printKpi(kpi.id);
    }
  });

  function renderRows(kpi, canW) {
    let html = "", lastPhase = null;
    (kpi.actions || []).forEach(x => {
      if (x.phase !== lastPhase) {
        lastPhase = x.phase;
        const ph = (kpi.actions || []).filter(y => y.phase === x.phase);
        const phDone = ph.filter(y => grpOf(y.st) === "done").length;
        html += `<tr class="kpi-phase-row"><td colspan="7">
          <b>${esc(x.phase)}</b>
          <span class="kpi-phase-meta">${phDone}/${ph.length} 완료</span>
          <span class="kpi-phase-bar"><span style="width:${ph.length ? Math.round(phDone / ph.length * 100) : 0}%"></span></span>
        </td></tr>`;
      }
      html += `<tr class="kpi-row" data-act="${esc(x.id)}">
        <td>${stBadge(x.st, x.added)}</td>
        <td class="kpi-td-title">${esc(x.title)}${x.kids && x.kids.length ? ` <span class="badge badge-gray" title="세부 항목">+${x.kids.length}</span>` : ""}</td>
        <td class="kpi-td-owner">${esc(x.main || "-")}${x.sub ? `<br><span>${esc(x.sub)}</span>` : ""}</td>
        <td class="kpi-td-date">${esc(mmdd(x.ps))}<br>~${esc(mmdd(x.pe))}</td>
        <td class="kpi-td-date">${x.rs ? esc(mmdd(x.rs)) + "<br>~" + (x.re ? esc(mmdd(x.re)) : "진행") : "-"}</td>
        <td class="kpi-td-tl">${tlBar(kpi, x)}</td>
        <td class="kpi-td-note">${x.out ? esc(x.out).replace(/\n/g, "<br>") : ""}${x.risk ? `<div class="kpi-risk">⚠ ${esc(x.risk)}</div>` : ""}</td>
      </tr>`;
    });
    return html;
  }

  /* ─────────── 세부/수정 모달 ─────────── */
  function detailModal(kid, aid, canW) {
    const kpi = findKpi(kid);
    const x = kpi && (kpi.actions || []).find(y => y.id === aid);
    if (!x) return;
    openModal(`
      <h3 style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${stBadge(x.st, x.added)} <span style="flex:1;min-width:200px">${esc(x.title)}</span></h3>
      <div class="kpi-def" style="margin-top:10px">
        <div><label>Sub 과제</label><p>${esc(x.phase)}${x.group ? " › " + esc(x.group) : ""}</p></div>
        <div><label>담당 (메인 / 서브)</label><p>${esc(x.main || "-")}${x.sub ? " / " + esc(x.sub) : ""}</p></div>
        <div><label>계획</label><p>${esc(period(x.ps, x.pe))}</p></div>
        <div><label>실적</label><p>${x.rs ? esc(period(x.rs, x.re || "진행 중")) : "미착수"}</p></div>
        ${x.out ? `<div><label>목표 · 산출물</label><p>${esc(x.out).replace(/\n/g, "<br>")}</p></div>` : ""}
        ${x.risk ? `<div><label>예상 위험 · 지원필요사항</label><p>${esc(x.risk).replace(/\n/g, "<br>")}</p></div>` : ""}
        ${x.kids && x.kids.length ? `<div><label>세부 실행 항목</label><ul class="kpi-ul">${x.kids.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
      </div>
      ${canW ? `
      <div style="border-top:1px solid var(--border);margin-top:14px;padding-top:12px">
        <div class="form-grid">
          <div class="form-row"><label>상태</label>
            <select id="kf-st">${ST_LIST.map(t => `<option ${x.st === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
          <div class="form-row"><label>&nbsp;</label><span class="form-hint">상태 변경 시 대시보드 그래프에 즉시 반영됩니다.</span></div>
          <div class="form-row"><label>실적 시작일</label><input type="date" id="kf-rs" value="${esc(x.rs || "")}"></div>
          <div class="form-row"><label>실적 종료일</label><input type="date" id="kf-re" value="${esc(x.re || "")}"></div>
        </div>
        <div class="form-row"><label>예상 위험 · 지원필요사항 (메모)</label>
          <textarea id="kf-risk" rows="2" maxlength="500">${esc(x.risk || "")}</textarea></div>
        <div class="form-row"><label>목표 · 산출물</label>
          <textarea id="kf-out" rows="2" maxlength="500">${esc(x.out || "")}</textarea></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="kf-cancel">닫기</button>
        <button class="btn btn-primary" id="kf-save">저장</button>
      </div>` : `
      <div class="modal-actions"><button class="btn btn-ghost" id="kf-cancel">닫기</button></div>`}`, { wide: true });

    $("#kf-cancel").onclick = closeModal;
    if (canW && $("#kf-save")) $("#kf-save").onclick = () => {
      const rs = $("#kf-rs").value, re = $("#kf-re").value;
      if (rs && re && re < rs) { toast("실적 종료일이 시작일보다 빠릅니다.", true); return; }
      Object.assign(x, {
        st: $("#kf-st").value, rs, re,
        risk: $("#kf-risk").value.trim(), out: $("#kf-out").value.trim(),
        edited: { by: SeMIS.user ? SeMIS.user.name : "", at: new Date().toISOString() }
      });
      if (D().kpis) D().kpis.updated = todayISO();
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ─────────── 인쇄 / PDF 출력 ───────────
     화면 데이터를 A4 인쇄용 HTML 문서로 구성 → 숨김 iframe에 써서
     브라우저 인쇄 대화상자(→ PDF로 저장) 호출. 팝업 차단 영향 없음. */
  const P = (v) => esc(v == null ? "" : String(v)).replace(/\n/g, "<br>");
  function printKpi(kid) {
    const kpi = findKpi(kid);
    if (!kpi) return;
    const s = stats(kpi);
    const tp = timePct(kpi);
    const stCell = (st, added) => {
      const m = ST_META[st] || {};
      return `<span class="pst" style="background:${m.color || "#64748b"}">${esc(st)}</span>${added ? '<span class="padd">보완</span>' : ""}`;
    };
    // Action Plan 행 (Sub과제 그룹 헤더 포함)
    let rows = "", lastPhase = null;
    (kpi.actions || []).forEach((x, i) => {
      if (x.phase !== lastPhase) {
        lastPhase = x.phase;
        const ph = (kpi.actions || []).filter(y => y.phase === x.phase);
        const phDone = ph.filter(y => grpOf(y.st) === "done").length;
        rows += `<tr class="pph"><td colspan="6"><b>${esc(x.phase)}</b> <span>(${phDone}/${ph.length} 완료)</span></td></tr>`;
      }
      const note = [x.out ? P(x.out) : "", x.risk ? '<span class="prisk">⚠ ' + P(x.risk) + "</span>" : ""].filter(Boolean).join("<br>");
      const kids = (x.kids && x.kids.length) ? `<div class="pkids">${x.kids.map(t => "· " + esc(t)).join("<br>")}</div>` : "";
      rows += `<tr>
        <td class="pc-st">${stCell(x.st, x.added)}</td>
        <td class="pc-t">${esc(x.title)}${kids}</td>
        <td class="pc-o">${esc(x.main || "-")}${x.sub ? "<br><i>" + esc(x.sub) + "</i>" : ""}</td>
        <td class="pc-d">${esc(x.ps || "")}${x.pe ? "<br>~ " + esc(x.pe) : ""}</td>
        <td class="pc-d">${x.rs ? esc(x.rs) + (x.re ? "<br>~ " + esc(x.re) : "<br>~ 진행") : "-"}</td>
        <td class="pc-n">${note}</td>
      </tr>`;
    });
    const chips = ST_ORDER.filter(t => s.c[t]).map(t =>
      `<span class="pchip"><i style="background:${ST_META[t].color}"></i>${esc(t)} <b>${s.c[t]}</b></span>`).join("");
    const defBlock = (lb, v) => v ? `<tr><th>${esc(lb)}</th><td>${P(v)}</td></tr>` : "";

    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>KPI 과제정의서 · ${esc(kpi.no)} ${esc(kpi.short || kpi.title)}</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4 portrait; margin: 12mm 10mm; }
  body { font-family: -apple-system, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif; color: #0f172a; font-size: 10px; line-height: 1.5; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .sub { color: #475569; font-size: 11px; margin-bottom: 10px; }
  .doc-head { border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; margin-bottom: 12px; }
  .doc-head .meta { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 10px; color: #334155; margin-top: 6px; }
  .doc-head .meta b { color: #0f172a; }
  .st-on { display: inline-block; padding: 1px 8px; border-radius: 10px; background: #16a34a; color: #fff; font-weight: 700; font-size: 9.5px; }
  .sec { margin: 12px 0; page-break-inside: avoid; }
  .sec-h { font-size: 11px; font-weight: 800; color: #1d4ed8; border-left: 3px solid #1d4ed8; padding-left: 6px; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; }
  .stat { display: flex; gap: 6px; margin-bottom: 8px; }
  .stat > div { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 4px; text-align: center; }
  .stat b { display: block; font-size: 15px; }
  .stat span { font-size: 8.5px; color: #475569; }
  .bars { display: flex; gap: 14px; margin-bottom: 6px; }
  .bars > div { flex: 1; }
  .bars .lbl { font-size: 8.5px; color: #475569; font-weight: 700; margin-bottom: 2px; }
  .bar { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
  .bar > i { display: block; height: 100%; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 9px; }
  .pchip i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; vertical-align: middle; margin-right: 2px; }
  .def th { text-align: left; width: 90px; vertical-align: top; padding: 4px 6px; background: #f1f5f9; border: 1px solid #e2e8f0; font-size: 9.5px; color: #334155; }
  .def td { vertical-align: top; padding: 4px 8px; border: 1px solid #e2e8f0; }
  ul.kp { margin: 0; padding-left: 16px; }
  ul.kp li { margin-bottom: 3px; }
  .badd { display: inline-block; margin-left: 4px; padding: 0 5px; border-radius: 8px; background: #fef3c7; color: #b45309; font-size: 8px; font-weight: 700; }
  .two { display: flex; gap: 12px; }
  .two > div { flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; }
  .ap th { background: #1d4ed8; color: #fff; padding: 5px 6px; text-align: left; font-size: 9px; border: 1px solid #1d4ed8; }
  .ap td { padding: 4px 6px; border: 1px solid #e2e8f0; vertical-align: top; }
  .ap tr { page-break-inside: avoid; }
  .ap .pph td { background: #eef2ff; font-size: 9.5px; padding: 4px 6px; }
  .ap .pph span { color: #64748b; font-weight: 600; }
  .pc-st { width: 52px; } .pc-o { width: 66px; font-size: 9px; } .pc-d { width: 62px; font-size: 8.5px; white-space: nowrap; color: #334155; }
  .pc-n { width: 150px; font-size: 8.5px; color: #334155; }
  .pc-t { font-size: 9.5px; }
  .pkids { color: #64748b; font-size: 8px; margin-top: 2px; }
  .pst { display: inline-block; padding: 1px 5px; border-radius: 8px; color: #fff; font-size: 8px; font-weight: 700; white-space: nowrap; }
  .padd { display: inline-block; margin-top: 2px; padding: 0 4px; border-radius: 6px; background: #fef3c7; color: #b45309; font-size: 7.5px; font-weight: 700; }
  .prisk { color: #dc2626; }
  .foot { margin-top: 14px; padding-top: 6px; border-top: 1px solid #e2e8f0; font-size: 8px; color: #94a3b8; display: flex; justify-content: space-between; }
</style></head>
<body>
  <div class="doc-head">
    <h1>${esc(kpi.title)}</h1>
    <div class="sub">CSI 과제정의서 · 진도현황</div>
    <div class="meta">
      <span><b>과제 No.</b> ${esc(kpi.no)}</span>
      <span><b>상태</b> <span class="st-on">${esc(kpi.status)}</span></span>
      <span><b>과제 리더</b> ${esc(kpi.leader)}</span>
      <span><b>기간</b> ${esc(period(kpi.start, kpi.end))}</span>
      <span><b>완료율</b> ${s.pct}% (${s.done}/${s.total})</span>
    </div>
  </div>

  <div class="sec">
    <div class="stat">
      <div><b>${s.pct}%</b><span>완료율 (${s.done}/${s.total})</span></div>
      <div><b style="color:#2563eb">${s.run}</b><span>진행 중</span></div>
      <div><b style="color:#dc2626">${s.risk}</b><span>주의</span></div>
      <div><b style="color:#64748b">${s.wait}</b><span>실행 대기</span></div>
    </div>
    <div class="bars">
      <div><div class="lbl">진척률 (완료 ${s.done}/${s.total})</div><div class="bar"><i style="width:${s.pct}%;background:#16a34a"></i></div></div>
      <div><div class="lbl">기간 경과율</div><div class="bar"><i style="width:${tp}%;background:#94a3b8"></i></div></div>
    </div>
    <div class="chips">${chips}</div>
  </div>

  <div class="sec">
    <div class="sec-h">과제 개요</div>
    <table class="def">
      ${defBlock("개선 목표", kpi.goal)}
      ${defBlock("예상 효과", kpi.effect)}
      ${defBlock("추진 배경 · Issue", kpi.bg)}
      ${defBlock("과제 Scope", kpi.scope)}
      <tr><th>추진 조직</th><td><b>리더</b> ${esc(kpi.leader)} · ${kpi.team.map(esc).join(" · ")}</td></tr>
    </table>
  </div>

  <div class="sec">
    <div class="two">
      <div><div class="sec-h">Key Progress &amp; Issues</div>
        ${(kpi.kp || []).length ? `<ul class="kp">${kpi.kp.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "<i>기록 없음</i>"}</div>
      <div><div class="sec-h">Next Steps &amp; Make-up Plan${kpi.nextAdded ? '<span class="badd">보완</span>' : ""}</div>
        ${(kpi.next || []).length ? `<ul class="kp">${kpi.next.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "<i>기록 없음</i>"}</div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-h">Action Plan · 진도현황 (총 ${s.total}건)</div>
    <table class="ap">
      <thead><tr><th>상태</th><th>Action Plan</th><th>담당</th><th>계획</th><th>실적</th><th>목표·산출물 / 위험</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <div class="foot">
    <span>에어제타 보안종합정보시스템(SeMIS v2) · KPI 현황</span>
    <span>기준 ${esc(kpis().updated || "")} · 출력 ${esc(todayISO())}${SeMIS.user ? " · " + esc(SeMIS.user.name) : ""}</span>
  </div>
</body></html>`;

    try {
      toast("인쇄 문서 준비 중…");
      const fr = document.createElement("iframe");
      fr.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;visibility:hidden";
      document.body.appendChild(fr);
      const doc = fr.contentWindow.document;
      doc.open(); doc.write(html); doc.close();
      const fire = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { /* 무시 */ } };
      // 폰트/레이아웃 안정화 후 인쇄
      if (fr.contentWindow.document.readyState === "complete") setTimeout(fire, 300);
      else fr.onload = () => setTimeout(fire, 300);
      setTimeout(() => { try { fr.remove(); } catch (e) { /* 무시 */ } }, 60000);
    } catch (e) {
      toast("인쇄 대화상자를 열 수 없습니다.", true);
    }
  }

  /* ─────────── 대시보드 위젯 ─────────── */
  function renderDash(el) {
    const list = kpis().items;
    if (!list.length) { el.innerHTML = '<div class="empty">KPI 데이터가 없습니다.</div>'; return; }
    el.innerHTML = list.map(x => {
      const s = stats(x);
      const tp = timePct(x);
      const nx = nextItems(x)[0];
      const behind = s.pct + 7 < tp;
      return `<div class="kpi-dash-item" data-kpi-go="${esc(x.id)}" title="클릭하여 KPI 현황으로 이동">
        <div class="kpi-dash-head">
          <span class="badge badge-blue">${esc(x.id)}</span>
          <span class="kpi-dash-title">${esc(x.short || x.title)}</span>
          <b class="kpi-dash-pct" ${behind ? 'style="color:var(--danger)"' : ""}>${s.pct}%</b>
        </div>
        ${stackedBar(x, 8)}
        <div class="kpi-dash-meta">
          <span>완료 ${s.done}/${s.total} · 진행 ${s.run}${s.risk ? ` · <b style="color:var(--danger)">주의 ${s.risk}</b>` : ""}</span>
          <span>경과 ${tp}%</span>
        </div>
        ${nx ? `<div class="kpi-dash-next">⏭ ${esc(mmdd(nx.ps))} ${esc(nx.title)}</div>` : ""}
      </div>`;
    }).join("") + `<div class="kpi-dash-legend">${["정상완료", "정시진행", "지연진행", "미실행", "실행대기"].map(t =>
      `<span><i style="background:${ST_META[t].color}"></i>${t}</span>`).join("")}</div>`;
    $$("[data-kpi-go]", el).forEach(it => it.onclick = () => {
      try { localStorage.setItem(LS_SEL, it.dataset.kpiGo); } catch (e) { /* 무시 */ }
      curId = it.dataset.kpiGo;
      SeMIS.navigate("kpi");
    });
  }

  /* ─────────── 통합 검색 등록 ─────────── */
  if (typeof SemisSearch !== "undefined" && SemisSearch.register) {
    SemisSearch.register({
      id: "kpis", group: "KPI 현황", icon: "📈", module: "kpi",
      items: () => {
        const out = [];
        kpis().items.forEach(x => {
          out.push({ title: x.no + " " + (x.short || x.title), sub: x.title, route: "kpi" });
          (x.actions || []).forEach(y => out.push({
            title: y.title, sub: x.no + " · " + y.phase + " · " + y.st,
            text: [y.title, y.phase, y.main, y.out, y.risk], route: "kpi"
          }));
        });
        return out;
      }
    });
  }

  window.SemisKpi = { seedKpis, stats, timePct, nextItems, attentionItems, renderDash, printKpi, ST_META, ST_LIST };
})();
