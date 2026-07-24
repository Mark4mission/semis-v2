/* ═══════════════════════════════════════════════════════
   SeMIS v2 — Core Engine
   인증 · 저장소 · 메뉴 엔진 · 권한 · 라우터
   ═══════════════════════════════════════════════════════ */
"use strict";

const SeMIS = (() => {

  const VERSION = "2.29.7";
  const LS_DATA = "semis2:data";
  const LS_UI   = "semis2:ui";
  const SS_SESSION = "semis2:session";
  const SALT = "SeMISv2:";

  /* ─────────── SHA-256 (pure JS, 동기, 어디서나 동작) ─────────── */
  function sha256(str) {
    const msg = unescape(encodeURIComponent(str));
    const K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const l = msg.length;
    const w = [];
    for (let i = 0; i < l; i++) w[i >> 2] = (w[i >> 2] || 0) | (msg.charCodeAt(i) << (24 - (i % 4) * 8));
    w[l >> 2] = (w[l >> 2] || 0) | (0x80 << (24 - (l % 4) * 8));
    const wlen = ((((l + 8) >> 6) + 1) << 4);
    for (let i = w.length; i < wlen; i++) w[i] = 0;
    w[wlen - 1] = (l * 8) >>> 0;
    w[wlen - 2] = Math.floor((l * 8) / 4294967296);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let j = 0; j < wlen; j += 16) {
      const W = w.slice(j, j + 16);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i-15],7) ^ rotr(W[i-15],18) ^ (W[i-15] >>> 3);
        const s1 = rotr(W[i-2],17) ^ rotr(W[i-2],19) ^ (W[i-2] >>> 10);
        W[i] = (W[i-16] + s0 + W[i-7] + s1) | 0;
      }
      let [a,b,c,d,e,f,g,hh] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + W[i]) | 0;
        const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H = [ (H[0]+a)|0,(H[1]+b)|0,(H[2]+c)|0,(H[3]+d)|0,(H[4]+e)|0,(H[5]+f)|0,(H[6]+g)|0,(H[7]+hh)|0 ];
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }
  const pwHash = (pw) => sha256(SALT + ":" + pw);

  /* ─────────── 기본 사용자 (암호는 해시로만 보관 — 평문 미노출) ─────────── */
  const BASE_USERS = [
    { id: "mark3464", name: "시스템관리자", role: "admin",
      hash: "a033918b0ad1c21f2aa2ba2905f1c26a8c1eb14ae58d19d37b73c8cd5106a840" },
    { id: "avsec",    name: "항공보안팀",   role: "manager",
      hash: "3e005f5a63c594353d10b017f2e3a4d26a3456ad8a8141145bf6571000b591ea" },
    { id: "branch",   name: "지점사용자",   role: "user",
      hash: "cfb1658673413530f9d2ca87a80d750b7eec3cfef5bd228e0331ed037a05023f" },
    { id: "hq",       name: "항공보안HQ",   role: "hq",
      hash: "baf18bfc212cf8a7ca80cd468495ef952b27e32f1c615f1737dc81a901b5a20a" }
  ];
  const ROLE_LABEL = { admin: "시스템관리자", hq: "항공보안HQ", manager: "보안관리자", user: "일반사용자", vendor: "협력업체", signer: "서명 참석자" };
  /* 권한 서열 (v2.11): admin(4) > hq(3) > manager(2) > user(1)
     - admin:   모든 기능 + 시스템 설정
     - hq:      항공보안파트원 — 시스템 설정 외 모든 기능(편집 포함)
     - manager: 지점·유관부서 보안감독자/담당자 — 보안사항 열람 가능, 편집 불가,
                대외비(유지보수 비용·계약·암호 등)는 열람 불가
     - user:    일반 직원 — 일반사항·홍보사항 수준만 열람 */
  /* vendor(협력업체, v2.16): 대금 청구 입력 화면(billing)만 접근 — 자기 업체 내역 한정 */
  /* signer(서명 참석자, v2.26): 회의일(YYYYMMDD) 코드 로그인 — 해당 협의회 서명 화면만 접근 */
  const ROLE_RANK  = { admin: 4, hq: 3, manager: 2, user: 1, vendor: 1, signer: 0 };
  const VIS_LABEL  = { all: "전체", mgr: "보안관리자 이상", hq: "항공보안HQ 이상", admin: "시스템관리자" };

  /* ─────────── 국가 항공보안등급 (5단계) ─────────── */
  const SEC_LEVELS = ["평시", "관심", "주의", "경계", "심각"];
  const todayStr = () => new Date().toISOString().slice(0, 10);
  function levelSorted() {
    return (DATA.levelHistory || []).slice().sort((a, b) =>
      a.date === b.date ? String(a.at).localeCompare(String(b.at)) : a.date.localeCompare(b.date));
  }
  function secCurrent() {
    // 시작일 도래 + (종료일 없음 or 종료일 미경과) 항목 중 최신 적용.
    // 기간형 등급(예: 행사 경계)이 만료되면 이전의 무기한 등급으로 자동 복귀.
    const t = todayStr();
    const active = levelSorted().filter(e => e.date <= t && (!e.end || e.end >= t));
    return active.length ? active[active.length - 1] : { level: "평시", date: "", end: "", note: "" };
  }
  function secNext() {
    return levelSorted().find(e => e.date > todayStr()) || null;
  }

  /* ─────────── 기본 메뉴 시드 (기존 kjsemis 사이트 이관) ─────────── */
  function defaultMenus() {
    let seq = 0;
    const g  = (id, label) => ({ id, seq: seq++, type: "group",  label });
    const m  = (id, label, icon, module, vis, parent) => ({ id, seq: seq++, type: "module", label, icon, module, vis: vis || "all", parent: parent || null });
    const lk = (id, label, icon, url, parent, opts) => Object.assign({ id, seq: seq++, type: "link", label, icon, url, vis: "all", parent: parent || null }, opts || {});
    return [
      m("dashboard", "대시보드", "🏠", "dashboard"),
      m("schedule", "일정관리", "📅", "schedule", "mgr"),
      m("kpi", "KPI 현황", "📈", "kpi", "hq"),

      g("grp-level", "항공보안등급"),
      lk("lvl-intro", "국가 보안등급 소개", "📖", "https://sites.google.com/view/kjsemis/%ED%95%AD%EA%B3%B5%EB%B3%B4%EC%95%88%EB%93%B1%EA%B8%89/%EA%B5%AD%EA%B0%80-%ED%95%AD%EA%B3%B5%EB%B3%B4%EC%95%88%EB%93%B1%EA%B8%89-%EC%86%8C%EA%B0%9C", "grp-level"),
      lk("lvl-now", "보안등급 현황 [현재]", "✅", "https://docs.google.com/document/d/1Fvsi7bcOofgXNv7PA5gPF4USuFAJ1JtLWrAApNY4BDM/edit?usp=sharing", "grp-level", { quick: true }),

      g("grp-rule", "규정 / 인허가"),
      m("regs-intl", "국제/국가 보안규정", "🌐", "regs-intl", "all", "grp-rule"),
      m("regs-own", "자체 보안규정", "📘", "regs-own", "all", "grp-rule"),
      lk("rule-intl", "국제/국가 보안규정 (구버전)", "🌐", "https://sites.google.com/view/kjsemis/%EA%B7%9C%EC%A0%95%EC%9D%B8%ED%97%88%EA%B0%80/%EA%B5%AD%EC%A0%9C%EA%B5%AD%EA%B0%80-%EB%B3%B4%EC%95%88%EA%B7%9C%EC%A0%95", "grp-rule"),
      lk("rule-own", "자체 보안규정 (구버전)", "📘", "https://sites.google.com/view/kjsemis/%EA%B7%9C%EC%A0%95%EC%9D%B8%ED%97%88%EA%B0%80/%EC%9E%90%EC%B2%B4-%EB%B3%B4%EC%95%88%EA%B7%9C%EC%A0%95", "grp-rule"),
      lk("rule-iosa", "IOSA (국제 인허가)", "🏅", "https://sites.google.com/view/kjsemis/%EA%B7%9C%EC%A0%95%EC%9D%B8%ED%97%88%EA%B0%80/iosa%EA%B5%AD%EC%A0%9C-%EC%9D%B8%ED%97%88%EA%B0%80", "grp-rule"),
      lk("rule-ssi", "비밀 취급 / SSI", "㊙️", "https://sites.google.com/view/kjsemis/%EA%B7%9C%EC%A0%95%EC%9D%B8%ED%97%88%EA%B0%80/%EB%B9%84%EB%B0%80-%EC%B7%A8%EA%B8%89ssi", "grp-rule", { vis: "mgr" }),

      g("grp-branch", "지점 / 협력업체"),
      m("branches", "지점 관리", "🌍", "branches", "mgr", "grp-branch"),
      m("contracts-mgmt", "계약서 관리", "💼", "contracts-mgmt", "hq", "grp-branch"),
      lk("br-sys", "지점보안시스템", "💻", "https://sites.google.com/view/kjsemis/%EC%A7%80%EC%A0%90%ED%98%91%EB%A0%A5%EC%97%85%EC%B2%B4/%EC%A7%80%EC%A0%90%EB%B3%B4%EC%95%88%EC%8B%9C%EC%8A%A4%ED%85%9C", "grp-branch", { quick: true }),
      lk("br-contract", "계약서 관리 (구버전)", "💼", "https://sites.google.com/view/kjsemis/%EC%A7%80%EC%A0%90%ED%98%91%EB%A0%A5%EC%97%85%EC%B2%B4/%EA%B3%84%EC%95%BD%EC%84%9C-%EA%B4%80%EB%A6%AC", "grp-branch", { vis: "mgr" }),
      lk("br-supervisor", "보안감독자 현황", "👥", "https://docs.google.com/spreadsheets/d/1RlxvnrjDWMy4lSTDdbF6JTKCgL45EuTW0O1mjGd8RtQ/edit?usp=sharing", "grp-branch", { vis: "mgr" }),
      lk("br-officer", "지점 보안담당자", "👥", "https://docs.google.com/spreadsheets/d/15Qvf5NgdeyfIBBLzFc3BtTGE6kQse-_HTb9u4PvzHt0/edit?usp=sharing", "grp-branch", { vis: "mgr" }),

      g("grp-inspect", "보안 점검"),
      m("insp-mgmt", "보안점검 일정관리", "🕵️", "inspection", "mgr", "grp-inspect"),
      m("insp-car", "부적합·시정조치 (CAR)", "📋", "carcap", "hq", "grp-inspect"),
      lk("insp-plan", "보안점검 일정 (구버전)", "🗓️", "https://sites.google.com/view/kjsemis/%EB%B3%B4%EC%95%88-%EC%A0%90%EA%B2%80/%EB%B3%B4%EC%95%88%EC%A0%90%EA%B2%80-%EC%9D%BC%EC%A0%95", "grp-inspect"),
      lk("insp-cabin", "기내 보안점검", "✈️", "https://sites.google.com/view/kjsemis/%EB%B3%B4%EC%95%88-%EC%A0%90%EA%B2%80/%EC%A0%90%EA%B2%80%EA%B8%B0%EB%A1%9D-%EB%AA%A8%EB%8B%88%ED%84%B0%EB%A7%81/%EA%B8%B0%EB%82%B4-%EB%B3%B4%EC%95%88%EC%A0%90%EA%B2%80", "grp-inspect"),
      lk("insp-daily", "일일 보안점검", "🙆", "https://sites.google.com/view/kjsemis/%EB%B3%B4%EC%95%88-%EC%A0%90%EA%B2%80/%EC%A0%90%EA%B2%80%EA%B8%B0%EB%A1%9D-%EB%AA%A8%EB%8B%88%ED%84%B0%EB%A7%81/%EC%9D%BC%EC%9D%BC-%EB%B3%B4%EC%95%88%EC%A0%90%EA%B2%80", "grp-inspect"),

      g("grp-pass", "출입증"),
      m("passes", "출입증 관리", "🪪", "passes", "mgr", "grp-pass"),
      lk("pass-mgmt", "출입증 관리 (구버전)", "🪪", "https://sites.google.com/view/kjsemis/%EC%B6%9C%EC%9E%85%EC%A6%9D%EB%B3%B4%EC%95%88%EC%9E%A5%EB%B9%84/%EC%B6%9C%EC%9E%85%EC%A6%9D-%EA%B4%80%EB%A6%AC", "grp-pass"),

      g("grp-equip", "보안장비"),
      m("equipment", "보안장비 유지관리", "🔧", "equipment", "mgr", "grp-equip"),
      m("council", "보안장비 협의회", "🤝", "council", "mgr", "grp-equip"),
      m("billing", "대금 청구 관리", "🧾", "billing", "hq", "grp-equip"),
      lk("equip-mgmt", "보안장비 관리 (구버전)", "🔧", "https://sites.google.com/view/kjsemis/%EC%B6%9C%EC%9E%85%EC%A6%9D%EB%B3%B4%EC%95%88%EC%9E%A5%EB%B9%84/%EB%B3%B4%EC%95%88%EC%9E%A5%EB%B9%84-%EA%B4%80%EB%A6%AC", "grp-equip"),
      lk("equip-council", "보안장비 협의체 (구버전)", "🤝", "https://sites.google.com/view/kjsemis/%EC%B6%9C%EC%9E%85%EC%A6%9D%EB%B3%B4%EC%95%88%EC%9E%A5%EB%B9%84/%EB%B3%B4%EC%95%88%EC%9E%A5%EB%B9%84-%ED%98%91%EC%9D%98%EC%B2%B4", "grp-equip"),

      g("grp-edu", "보안 증진"),
      m("training", "보안교육 관리", "🎓", "training", "mgr", "grp-edu"),
      m("certs", "교육 이수증 관리", "🎖", "certs", "mgr", "grp-edu"),
      lk("edu-training", "보안 교육 (구버전)", "🎓", "https://sites.google.com/view/kjsemis/%EB%B3%B4%EC%95%88-%EC%A6%9D%EC%A7%84/%EB%B3%B4%EC%95%88-%EA%B5%90%EC%9C%A1", "grp-edu"),
      lk("edu-campaign", "보안 캠페인", "📣", "https://sites.google.com/view/kjsemis/%EB%B3%B4%EC%95%88-%EC%A6%9D%EC%A7%84/%EB%B3%B4%EC%95%88-%EC%BA%A0%ED%8E%98%EC%9D%B8", "grp-edu"),

      g("grp-abnormal", "비정상 상황"),
      Object.assign(m("contacts", "보고체계 연락망", "☎️", "contacts", "mgr", "grp-abnormal"), { quick: true }),
      lk("ab-contact", "보고체계 연락망 (구버전)", "☎️", "https://docs.google.com/spreadsheets/d/1DpNibLZVClfEDjNsKZR-LkXWX5SvE1jlM8JsubD_aIM/edit?usp=sharing", "grp-abnormal", { quick: true }),
      lk("ab-munjasin", "문자의 신 (보안동보)", "📨", "https://www.munjasin.co.kr/", "grp-abnormal", { quick: true }),
      lk("ab-guide", "문자의 신 이용 안내", "📖", "https://sites.google.com/view/kjsemis/%EB%B9%84%EC%A0%95%EC%83%81-%EC%83%81%ED%99%A9/%EB%AC%B8%EC%9E%90%EC%9D%98-%EC%8B%A0-%EB%B3%B4%EA%B3%A0-%EB%B0%A9%EB%B2%95-%EC%95%88%EB%82%B4", "grp-abnormal"),

      g("grp-ref", "참고 / 링크"),
      m("policy", "에어제타 보안정책", "🛡️", "policy", "all", "grp-ref"),
      lk("ref-policy", "에어제타 보안정책 (구버전)", "🛡️", "https://drive.google.com/file/d/15V_aIYU9gB6nCp9AYQPE3kxePisQ2vJV/view?usp=sharing", "grp-ref"),
      lk("ref-agreement", "보안 서약서", "✍️", "https://mark4mission.github.io/airzeta-security-agreement/", "grp-ref"),
      lk("ref-drive", "SeMIS Drive", "🗂️", "https://drive.google.com/drive/folders/1KSKO1ioqb8I0s-kysIkkP4yb2SwURXTW?usp=drive_link", "grp-ref", { vis: "mgr" }),
      lk("ref-legacy", "구버전 (kjsemis)", "🕰️", "https://sites.google.com/view/kjsemis/", "grp-ref"),
      lk("ref-boannews", "보안뉴스", "📰", "https://www.boannews.com/", "grp-ref"),

      m("vault", "암호 관리", "🔐", "vault", "hq"),
      m("settings", "시스템 설정", "⚙️", "settings", "admin")
    ];
  }

  /* ─────────── 저장소 ─────────── */
  function freshData() {
    return {
      version: 1,
      menus: defaultMenus(),
      notices: [{
        id: "n" + Date.now(),
        title: "SeMIS v2 오픈 안내",
        body: "보안종합정보시스템이 v2로 새롭게 개편되었습니다.\n\n- 좌측 메뉴에서 각 업무 자료로 이동할 수 있습니다.\n- 기존 자료는 순차적으로 v2 내부 모듈로 이관될 예정입니다.\n- 문의: 에어제타 항공보안팀",
        author: "시스템관리자", pinned: true, created: new Date().toISOString()
      }],
      levelHistory: [{ id: "lv0", date: new Date().toISOString().slice(0, 10), level: "평시",
        note: "SeMIS v2 개설", by: "시스템", at: new Date().toISOString() }],
      pwOverrides: {},   // { baseUserId: hash }
      userOverrides: {}, // v2.11.1: 기본 계정 속성 변경 { baseUserId: { id?, name?, role?, deleted? } }
      customUsers: [],   // [{id, name, role, hash}]
      schedules: [],     // v2.2: [{id,title,memo,start,end,allDay,time,timeEnd,color,done,assignee,vehicle,room,reminders,gcalId?}]
      gcal: { enabled: false, calendarId: "airzetaavsec@gmail.com", apiKey: "" },
      inspections: seedInspections(), // v2.4: 보안점검 일정
      cars: [],                       // v2.29: 보안점검 부적합·시정조치 (CAR→CAP→FAT) 위험관리
      carCfg: {},                     // v2.29: CAR 프로세스 설정(기한·5x5 위험매트릭스·에스컬레이션) — 모듈이 기본값 병합
      contacts: { sections: [] },     // v2.6: 보고체계 연락망 (실데이터는 공용 DB 동기화 — 코드에 미시드)
      branches: [],                   // v2.7: 지점 관리 (해외지점 세계지도)
      passes: [],                     // v2.8: 출입증 관리 (개인정보 — 공용 DB 동기화)
      equipment: [],                  // v2.8: 보안장비 유지관리
      trainings: [],                  // v2.8: 보안교육 관리
      contracts: [],                  // v2.8: 계약서 관리
      equipMaint: { contracts: [], costs: [] }, // v2.10: 장비 유지보수 계약/월별 비용 (SeMIS 고유)
      council: [],                    // v2.24: 보안장비 협의회 회의록 (KPI C6-1 기반)
      regulations: [],                // v2.12: 규정 관리 (국제/국가 + 자체, PDF/링크 + 개정 아이디어 노트)
      policy: { ko: null, en: null }, // v2.14: 에어제타 보안정책 (국문/영문 PDF)
      certs: [],                      // v2.15: 교육 이수증 관리 (외부기관 보안책임자/감독자 등)
      certOpts: { roles: [], orgs: [] }, // v2.17: 이수증 선택지(과정/수료기관 — 사용자 관리, 빈 배열이면 normalize가 기본값 시드)
      billing: [],                    // v2.16: 대금 청구 (협력업체 월별 입력 — 프로에스콤/인씨스)
      vault: { v: 1, members: [], data: null, updated: "" } // v2.9: 암호 관리 (암호문만 저장)
    };
  }

  /* ─────── 보안점검 2026 계획 시드 (기존 구글시트 이관) ───────
     id는 고정값 — 여러 브라우저가 동시에 시드해도 동일 데이터가 되어 병합 충돌 없음 */
  function seedInspections() {
    const mk = (id, category, target, month, inspectors, start, end) => ({
      id, year: 2026, category, target, month,
      inspectors: inspectors || [], start: start || "", end: end || "",
      status: "계획", note: "", resultUrl: "", linkCal: false
    });
    return [
      mk("i2601", "국내정기", "프로에스콤", 5, ["최상일", "이은우"]),
      mk("i2602", "국내정기", "LSG", 5, ["최상일", "이은우"]),
      mk("i2603", "국내정기", "정비고", 9, ["이은우"]),
      mk("i2604", "국내정기", "ICNKF", 10, []),
      mk("i2605", "불시평가", "항공기 보안", 4, ["최상일"]),
      mk("i2606", "불시평가", "케이터링", 5, ["최상일", "이은우"]),
      mk("i2607", "불시평가", "프로에스콤", 5, ["최상일", "이은우"]),
      mk("i2608", "불시평가", "화물청사", 9, []),
      mk("i2609", "해외공항", "BKKSU", 3, ["TAZ", "최상일"]),
      mk("i2610", "해외공항", "FRASF", 7, ["최상일", "이윤민"]),
      mk("i2611", "해외공항", "ALASU", 7, ["이윤민", "최상일"]),
      mk("i2612", "해외공항", "SFOSF", 8, ["최상일", "이은우"]),
      mk("i2613", "해외공항", "MILSF", 9, ["TAZ", "이은우"]),
      mk("i2614", "해외공항", "SHASF", 9, ["최상일", "이은우"]),
      mk("i2615", "해외공항", "HANSF", 9, []),
      mk("i2616", "해외공항", "ATLSF", 10, ["최상일", "이은우"]),
      mk("i2617", "해외공항", "YNTSF", 10, ["TAZ", "이은우"]),
      mk("i2618", "해외공항", "HKGSF", 10, []),
      mk("i2619", "해외공항", "CHISF", 11, ["이윤민", "TAZ"]),
      mk("i2620", "해외공항", "DFWSF", 11, ["이윤민", "TAZ"]),
      mk("i2621", "주요일정", "밀라노 동계올림픽", 2, [], "2026-02-06", "2026-02-22"),
      mk("i2622", "주요일정", "FIFA 월드컵", 6, [], "2026-06-11", "2026-07-19"),
      mk("i2623", "주요일정", "안전심사팀 내부심사", 8, [])
    ];
  }

  let DATA = null;
  function load() {
    try {
      const raw = localStorage.getItem(LS_DATA);
      if (raw) { DATA = JSON.parse(raw); }
    } catch (e) { DATA = null; }
    if (!DATA) DATA = freshData();
    normalizeData();
    save();
  }

  /* 데이터 정규화/마이그레이션 (idempotent).
     load() 및 동기화 pull/원격 반영 이후에도 호출되어, 서버의 구버전 데이터가
     로컬 마이그레이션을 되돌리지 않도록 보장. 변경 여부를 반환. */
  function normalizeData() {
    const before = JSON.stringify(DATA);
    if (!Array.isArray(DATA.menus)) DATA.menus = defaultMenus();
    // v2.22: '출입증 / 보안장비' 그룹을 '출입증'(grp-pass) + '보안장비'(grp-equip)로 분리.
    //  기존 사용자 데이터도 grp-equip 생성 + 장비/청구/구링크 이동 (idempotent).
    {
      const passGrp = DATA.menus.find(m => m && m.id === "grp-pass" && m.type === "group");
      if (passGrp && passGrp.label !== "출입증") passGrp.label = "출입증";
      let equipGrp = DATA.menus.find(m => m && m.id === "grp-equip" && m.type === "group");
      if (!equipGrp) {
        const baseSeq = passGrp ? (passGrp.seq || 0)
          : DATA.menus.reduce((mx, m) => Math.max(mx, (m && m.seq) || 0), 0) + 1;
        equipGrp = { id: "grp-equip", seq: baseSeq + 0.5, type: "group", label: "보안장비" };
        DATA.menus.push(equipGrp);
      } else if (equipGrp.label !== "보안장비") {
        equipGrp.label = "보안장비";
      }
      // 보안장비 소속 항목을 grp-pass → grp-equip 로 이동
      ["equipment", "billing", "equip-mgmt", "equip-council"].forEach(id => {
        const mn = DATA.menus.find(m => m && m.id === id);
        if (mn && mn.parent === "grp-pass") mn.parent = "grp-equip";
      });
    }
    // 필드 보정 (구버전 데이터 마이그레이션 대비)
    DATA.notices = DATA.notices || [];
    DATA.pwOverrides = DATA.pwOverrides || {};
    DATA.userOverrides = DATA.userOverrides || {};
    // 최고관리자(mark3464) 보호: 권한 변경·삭제 불가 (잠금 방지)
    if (DATA.userOverrides.mark3464) {
      delete DATA.userOverrides.mark3464.role;
      delete DATA.userOverrides.mark3464.deleted;
    }
    DATA.customUsers = DATA.customUsers || [];
    DATA.schedules = DATA.schedules || [];
    // 구버전 secLevel → levelHistory 마이그레이션
    if (!Array.isArray(DATA.levelHistory) || !DATA.levelHistory.length) {
      const old = DATA.secLevel;
      DATA.levelHistory = [{
        id: "lv0",
        date: (old && old.updated) || new Date().toISOString().slice(0, 10),
        level: (old && old.level) || "평시",
        note: (old && old.note) || "",
        by: old ? "v1 이관" : "시스템",
        at: new Date().toISOString()
      }];
    }
    delete DATA.secLevel;
    // v2.0 schedules {id,date,title,memo} → v2.1 캘린더 스키마 마이그레이션
    DATA.schedules = (DATA.schedules || []).map(s => {
      if (!s) return null;
      if (s.date && !s.start) {
        return { id: s.id, title: s.title, memo: s.memo || "", start: s.date, end: s.date,
                 allDay: true, time: "", timeEnd: "", color: "blue", done: false, assignee: "",
                 vehicle: false, room: false, reminders: [] };
      }
      // 필드 보정 (idempotent)
      s.end = s.end || s.start;
      if (typeof s.allDay !== "boolean") s.allDay = !s.time;
      s.time = s.time || ""; s.timeEnd = s.timeEnd || "";
      s.color = s.color || "blue"; s.done = !!s.done;
      s.assignee = s.assignee || ""; s.memo = s.memo || "";
      s.vehicle = !!s.vehicle; s.room = !!s.room;          // v2.2: 차량/회의실 예약
      if (!Array.isArray(s.reminders)) s.reminders = [];    // v2.2: 리마인더
      if (!s.repeat || typeof s.repeat !== "object" || !s.repeat.freq)
        s.repeat = { freq: "none", until: "" };             // v2.5: 반복
      delete s.date;
      return s;
    }).filter(Boolean);
    // v2.2: 구글캘린더 연동 설정
    if (!DATA.gcal || typeof DATA.gcal !== "object") {
      DATA.gcal = { enabled: false, calendarId: "airzetaavsec@gmail.com", apiKey: "" };
    }
    // v2.4: 보안점검 일정 (최초 사용 시 2026 계획 시드)
    if (!Array.isArray(DATA.inspections)) DATA.inspections = seedInspections();
    // v2.6.1: 점검 결과 유형(findings) 필드 보정
    DATA.inspections.forEach(x => { if (x && !Array.isArray(x.findings)) x.findings = []; });
    // v2.4: 보안점검 모듈 메뉴 보장 (기존 사용자 메뉴에 자동 삽입)
    if (!DATA.menus.some(m => m && m.type === "module" && m.module === "inspection")) {
      const grp = DATA.menus.find(m => m && m.id === "grp-inspect" && m.type === "group");
      const children = grp ? DATA.menus.filter(m => m && m.parent === "grp-inspect") : [];
      const seq = children.length ? Math.min.apply(null, children.map(c => c.seq || 0)) - 0.5
        : DATA.menus.reduce((mx, m) => Math.max(mx, (m && m.seq) || 0), 0) + 1;
      DATA.menus.push({ id: "insp-mgmt", seq, type: "module", label: "보안점검 일정관리",
        icon: "🕵️", module: "inspection", vis: "all", parent: grp ? "grp-inspect" : null });
    }
    // v2.29: 부적합·시정조치(CAR→CAP→FAT) 컬렉션/설정 + 메뉴 보장
    if (!Array.isArray(DATA.cars)) DATA.cars = [];
    if (!DATA.carCfg || typeof DATA.carCfg !== "object" || Array.isArray(DATA.carCfg)) DATA.carCfg = {};
    if (!DATA.menus.some(m => m && m.type === "module" && m.module === "carcap")) {
      const grpC = DATA.menus.find(m => m && m.id === "grp-inspect" && m.type === "group");
      const insM = DATA.menus.find(m => m && m.type === "module" && m.module === "inspection");
      const seqC = insM ? (insM.seq || 0) + 0.3
        : (grpC ? (grpC.seq || 0) + 0.3 : DATA.menus.reduce((mx, m) => Math.max(mx, (m && m.seq) || 0), 0) + 1);
      DATA.menus.push({ id: "insp-car", seq: seqC, type: "module", label: "부적합·시정조치 (CAR)",
        icon: "📋", module: "carcap", vis: "hq", parent: grpC ? "grp-inspect" : null });
    }
    // v2.6: 보고체계 연락망 — 기본 빈 구조 (실데이터는 공용 DB에서 동기화, 코드 미시드)
    if (!DATA.contacts || typeof DATA.contacts !== "object" || Array.isArray(DATA.contacts)) DATA.contacts = { sections: [] };
    if (!Array.isArray(DATA.contacts.sections)) DATA.contacts.sections = [];
    // v2.6: 연락망 모듈 메뉴 보장 (grp-abnormal 최상단 자동 삽입)
    if (!DATA.menus.some(m => m && m.type === "module" && m.module === "contacts")) {
      const grp = DATA.menus.find(m => m && m.id === "grp-abnormal" && m.type === "group");
      const children = grp ? DATA.menus.filter(m => m && m.parent === "grp-abnormal") : [];
      const seq = children.length ? Math.min.apply(null, children.map(c => c.seq || 0)) - 0.5
        : DATA.menus.reduce((mx, m) => Math.max(mx, (m && m.seq) || 0), 0) + 1;
      DATA.menus.push({ id: "contacts", seq, type: "module", label: "보고체계 연락망",
        icon: "☎️", module: "contacts", vis: "all", parent: grp ? "grp-abnormal" : null, quick: true });
    }
    // 기존 시트 링크는 유지하되 "(구버전)"으로 구분
    const abOld = DATA.menus.find(m => m && m.id === "ab-contact");
    if (abOld && abOld.label === "보고체계 연락망") abOld.label = "보고체계 연락망 (구버전)";
    // v2.7: 지점 관리 — 기본 빈 배열 + 메뉴 자동 삽입 (grp-branch 최상단)
    if (!Array.isArray(DATA.branches)) DATA.branches = [];
    if (!DATA.menus.some(m => m && m.type === "module" && m.module === "branches")) {
      const grp = DATA.menus.find(m => m && m.id === "grp-branch" && m.type === "group");
      const children = grp ? DATA.menus.filter(m => m && m.parent === "grp-branch") : [];
      const seq = children.length ? Math.min.apply(null, children.map(c => c.seq || 0)) - 0.5
        : DATA.menus.reduce((mx, m) => Math.max(mx, (m && m.seq) || 0), 0) + 1;
      DATA.menus.push({ id: "branches", seq, type: "module", label: "지점 관리",
        icon: "🌍", module: "branches", vis: "all", parent: grp ? "grp-branch" : null });
    }
    // v2.8: 출입증/보안장비/보안교육/계약서 모듈 — 배열 보정 + 메뉴 자동 삽입 + 구링크 구분
    if (!Array.isArray(DATA.passes)) DATA.passes = [];
    if (!Array.isArray(DATA.equipment)) DATA.equipment = [];
    // v2.10: 장비 유지보수 계약/비용 컨테이너 보정
    if (!DATA.equipMaint || typeof DATA.equipMaint !== "object" || Array.isArray(DATA.equipMaint)) DATA.equipMaint = { contracts: [], costs: [] };
    if (!Array.isArray(DATA.equipMaint.contracts)) DATA.equipMaint.contracts = [];
    if (!Array.isArray(DATA.equipMaint.costs)) DATA.equipMaint.costs = [];
    if (!Array.isArray(DATA.trainings)) DATA.trainings = [];
    if (!Array.isArray(DATA.contracts)) DATA.contracts = [];
    const ensureModuleMenu = (menuId, grpId, label, icon, moduleId, vis) => {
      if (DATA.menus.some(m => m && m.type === "module" && m.module === moduleId)) return;
      const grp = DATA.menus.find(m => m && m.id === grpId && m.type === "group");
      const children = grp ? DATA.menus.filter(m => m && m.parent === grpId) : [];
      const seq = children.length ? Math.min.apply(null, children.map(c => c.seq || 0)) - 0.5
        : DATA.menus.reduce((mx, m) => Math.max(mx, (m && m.seq) || 0), 0) + 1;
      DATA.menus.push({ id: menuId, seq, type: "module", label, icon, module: moduleId,
        vis: vis || "all", parent: grp ? grpId : null });
    };
    // 출입증(grp-pass) 최상단에 출입증 관리, 보안장비(grp-equip) 최상단에 보안장비 유지관리
    ensureModuleMenu("equipment", "grp-equip", "보안장비 유지관리", "🔧", "equipment", "mgr");
    ensureModuleMenu("passes", "grp-pass", "출입증 관리", "🪪", "passes", "mgr");
    ensureModuleMenu("training", "grp-edu", "보안교육 관리", "🎓", "training", "mgr");
    // 계약서 관리는 '지점 관리' 바로 다음 위치 (관리자 이상 전용)
    if (!DATA.menus.some(m => m && m.type === "module" && m.module === "contracts-mgmt")) {
      const brMenu = DATA.menus.find(m => m && m.type === "module" && m.module === "branches" && m.parent === "grp-branch");
      if (brMenu) {
        DATA.menus.push({ id: "contracts-mgmt", seq: (brMenu.seq || 0) + 0.25, type: "module",
          label: "계약서 관리", icon: "💼", module: "contracts-mgmt", vis: "hq", parent: "grp-branch" });
      } else ensureModuleMenu("contracts-mgmt", "grp-branch", "계약서 관리", "💼", "contracts-mgmt", "hq");
    }
    // 기존 시트 링크는 유지하되 "(구버전)"으로 구분
    [["pass-mgmt", "출입증 관리"], ["equip-mgmt", "보안장비 관리"],
     ["edu-training", "보안 교육"], ["br-contract", "계약서 관리"]].forEach(([id, orig]) => {
      const mn = DATA.menus.find(m => m && m.id === id);
      if (mn && mn.label === orig) mn.label = orig + " (구버전)";
    });
    // v2.9: 암호 관리(vault) — 암호문 저장소 구조 보정 + 메뉴(최상위, 시스템 설정 위)
    if (!DATA.vault || typeof DATA.vault !== "object" || Array.isArray(DATA.vault))
      DATA.vault = { v: 1, members: [], data: null, updated: "" };
    if (!Array.isArray(DATA.vault.members)) DATA.vault.members = [];
    if (!DATA.menus.some(m => m && m.type === "module" && m.module === "vault")) {
      const st = DATA.menus.find(m => m && m.id === "settings");
      const seq = st ? (st.seq || 0) - 0.5
        : DATA.menus.reduce((mx, m) => Math.max(mx, (m && m.seq) || 0), 0) + 1;
      DATA.menus.push({ id: "vault", seq, type: "module", label: "암호 관리",
        icon: "🔐", module: "vault", vis: "hq", parent: null });
    }
    // v2.11: 권한 재정렬 마이그레이션 — 보안 모듈은 user 차단(mgr 이상), 대외비는 hq 이상
    ["schedule", "insp-mgmt", "contacts", "branches", "equipment", "passes", "training"].forEach(id => {
      const mn = DATA.menus.find(m => m && m.id === id && m.type === "module");
      if (mn && (!mn.vis || mn.vis === "all")) mn.vis = "mgr";
    });
    ["contracts-mgmt", "vault"].forEach(id => {
      const mn = DATA.menus.find(m => m && m.id === id && m.type === "module");
      if (mn && mn.vis !== "hq") mn.vis = "hq";
    });
    // v2.12: 규정 관리 — 데이터 보정 + 메뉴 자동 삽입(grp-rule 최상단: 국제/국가 → 자체) + 구링크 구분
    if (!Array.isArray(DATA.regulations)) DATA.regulations = [];
    DATA.regulations.forEach(r => { if (r && !Array.isArray(r.ideas)) r.ideas = []; });
    ensureModuleMenu("regs-own", "grp-rule", "자체 보안규정", "📘", "regs-own", "all");
    ensureModuleMenu("regs-intl", "grp-rule", "국제/국가 보안규정", "🌐", "regs-intl", "all");
    [["rule-intl", "국제/국가 보안규정"], ["rule-own", "자체 보안규정"]].forEach(([id, orig]) => {
      const mn = DATA.menus.find(m => m && m.id === id && m.type === "link");
      if (mn && mn.label === orig) mn.label = orig + " (구버전)";
    });
    // v2.14: 보안정책 뷰어 — 데이터 보정 + 메뉴 자동 삽입(grp-ref 최상단) + 구링크 구분
    if (!DATA.policy || typeof DATA.policy !== "object" || Array.isArray(DATA.policy)) DATA.policy = { ko: null, en: null };
    if (!("ko" in DATA.policy)) DATA.policy.ko = null;
    if (!("en" in DATA.policy)) DATA.policy.en = null;
    ensureModuleMenu("policy", "grp-ref", "에어제타 보안정책", "🛡️", "policy", "all");
    {
      const mn = DATA.menus.find(m => m && m.id === "ref-policy" && m.type === "link");
      if (mn && mn.label === "에어제타 보안정책") mn.label = "에어제타 보안정책 (구버전)";
    }
    // v2.16: 대금 청구 — 데이터 보정 + 메뉴 자동 삽입 (보안장비 유지관리 다음, hq 전용)
    //  v2.22: 소속 그룹을 grp-equip(보안장비)로 변경
    if (!Array.isArray(DATA.billing)) DATA.billing = [];
    if (!DATA.menus.some(m => m && m.type === "module" && m.module === "billing")) {
      const eq = DATA.menus.find(m => m && m.type === "module" && m.module === "equipment");
      if (eq) DATA.menus.push({ id: "billing", seq: (eq.seq || 0) + 0.2, type: "module",
        label: "대금 청구 관리", icon: "🧾", module: "billing", vis: "hq", parent: "grp-equip" });
      else ensureModuleMenu("billing", "grp-equip", "대금 청구 관리", "🧾", "billing", "hq");
    }
    // v2.15: 교육 이수증 관리 — 데이터 보정 + 메뉴 자동 삽입 (보안교육 관리 바로 다음, mgr 열람)
    if (!Array.isArray(DATA.certs)) DATA.certs = [];
    if (!DATA.menus.some(m => m && m.type === "module" && m.module === "certs")) {
      const tr = DATA.menus.find(m => m && m.type === "module" && m.module === "training" && m.parent === "grp-edu");
      if (tr) DATA.menus.push({ id: "certs", seq: (tr.seq || 0) + 0.25, type: "module",
        label: "교육 이수증 관리", icon: "🎖", module: "certs", vis: "mgr", parent: "grp-edu" });
      else ensureModuleMenu("certs", "grp-edu", "교육 이수증 관리", "🎖", "certs", "mgr");
    }
    // v2.17: 이수증 선택지(과정/수료기관) — 구조 보정 + 빈 목록이면 기본값 시드 (사용자 추가/삭제 가능)
    if (!DATA.certOpts || typeof DATA.certOpts !== "object" || Array.isArray(DATA.certOpts))
      DATA.certOpts = { roles: [], orgs: [] };
    if (!Array.isArray(DATA.certOpts.roles)) DATA.certOpts.roles = [];
    if (!Array.isArray(DATA.certOpts.orgs)) DATA.certOpts.orgs = [];
    DATA.certOpts.roles = DATA.certOpts.roles.map(v => String(v || "").trim()).filter(Boolean);
    DATA.certOpts.orgs = DATA.certOpts.orgs.map(v => String(v || "").trim()).filter(Boolean);
    if (!DATA.certOpts.roles.length)
      DATA.certOpts.roles = ["보안책임자", "보안감독자", "보안검색감독자", "기타"];
    if (!DATA.certOpts.orgs.length)
      DATA.certOpts.orgs = ["한국항공안전교육원", "극동대 항공안전교육원", "KAC 항공보안교육", "항공보안아카데미"];
    // v2.20: KPI 현황 (CSI 과제 진도관리) — 시드 + 메뉴 자동 삽입 (일정관리 다음, hq 전용)
    if ((!DATA.kpis || !Array.isArray(DATA.kpis.items) || !DATA.kpis.items.length)
        && typeof window !== "undefined" && window.SemisKpi) {
      DATA.kpis = window.SemisKpi.seedKpis();
    }
    if (!DATA.menus.some(m => m && m.type === "module" && m.module === "kpi")) {
      const sc = DATA.menus.find(m => m && m.type === "module" && m.module === "schedule");
      const seq = sc ? (sc.seq || 0) + 0.25
        : DATA.menus.reduce((mx, m) => Math.max(mx, (m && m.seq) || 0), 0) + 1;
      DATA.menus.push({ id: "kpi", seq, type: "module", label: "KPI 현황",
        icon: "📈", module: "kpi", vis: "hq", parent: null });
    }
    // v2.24: 보안장비 협의회 회의록 — 데이터 보정 + 메뉴 자동 삽입(보안장비 유지관리 다음, mgr 열람) + 구링크 구분
    if (!Array.isArray(DATA.council)) DATA.council = [];
    if (!DATA.menus.some(m => m && m.type === "module" && m.module === "council")) {
      const eq = DATA.menus.find(m => m && m.type === "module" && m.module === "equipment");
      if (eq) DATA.menus.push({ id: "council", seq: (eq.seq || 0) + 0.1, type: "module",
        label: "보안장비 협의회", icon: "🤝", module: "council", vis: "mgr", parent: "grp-equip" });
      else ensureModuleMenu("council", "grp-equip", "보안장비 협의회", "🤝", "council", "mgr");
    }
    {
      const mn = DATA.menus.find(m => m && m.id === "equip-council" && m.type === "link");
      if (mn && mn.label === "보안장비 협의체") mn.label = "보안장비 협의체 (구버전)";
    }
    return JSON.stringify(DATA) !== before;
  }
  const saveHooks = [];
  function onSave(fn) { saveHooks.push(fn); }
  function saveSilent() { localStorage.setItem(LS_DATA, JSON.stringify(DATA)); }
  function save() {
    localStorage.setItem(LS_DATA, JSON.stringify(DATA));
    saveHooks.forEach(fn => { try { fn(); } catch (e) { /* sync 오류가 앱을 막지 않도록 */ } });
  }

  function uiState() {
    try { return JSON.parse(localStorage.getItem(LS_UI)) || {}; } catch (e) { return {}; }
  }
  function setUiState(patch) {
    localStorage.setItem(LS_UI, JSON.stringify(Object.assign(uiState(), patch)));
  }
  // v2.22: 사이드바 상태(그룹 펼치기/접기·미니 모드)를 접속 계정별로 저장.
  //  같은 브라우저를 여러 계정이 공유해도 각자의 설정이 유지됨.
  function navPrefsKey() { return (currentUser && currentUser.id) || "_anon"; }
  function navPrefs() {
    const all = uiState().navPrefs || {};
    return all[navPrefsKey()] || {};
  }
  function setNavPref(patch) {
    const st = uiState();
    const all = st.navPrefs || {};
    all[navPrefsKey()] = Object.assign({}, all[navPrefsKey()] || {}, patch);
    setUiState({ navPrefs: all });
  }

  /* ─────────── 인증 ─────────── */
  let currentUser = null;

  function allUsers() {
    // 기본 계정: userOverrides(계정명/이름/권한/삭제) + pwOverrides(암호) 병합.
    // pwOverrides/userOverrides 키는 원본 id(origId) 고정 — 계정명 변경과 무관하게 유지.
    const base = BASE_USERS.map(u => {
      const ov = (DATA.userOverrides || {})[u.id] || {};
      if (ov.deleted && u.id !== "mark3464") return null;
      return Object.assign({}, u, {
        id: ov.id || u.id,
        name: ov.name || u.name,
        role: u.id === "mark3464" ? "admin" : (ov.role && ROLE_RANK[ov.role] ? ov.role : u.role),
        vendor: ov.vendor || "",
        hash: DATA.pwOverrides[u.id] || u.hash,
        origId: u.id, base: true
      });
    }).filter(Boolean);
    return base.concat(DATA.customUsers.map(u => Object.assign({}, u, { origId: u.id, base: false })));
  }
  function login(pw) {
    const h = pwHash(pw);
    const user = allUsers().find(u => u.hash === h);
    if (!user) return null;
    currentUser = user;
    sessionStorage.setItem(SS_SESSION, JSON.stringify({ uid: user.id, ts: Date.now() }));
    return user;
  }
  /* v2.26: 서명 세션 — 회의별 6자리 숫자 코드(회의 id 기반 결정적 파생, 동기화 충돌 없음).
     v2.26.1: 회의일(추측 가능) → 랜덤 숫자 코드로 변경. 코드는 조직자 상세 화면에 안내됨. */
  function signCodeFor(m) {
    const id = String((m && m.id) || "");
    let h = 5381;
    for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
    return String(100000 + (h % 900000)); // 6자리 (100000~999999)
  }
  function signMeetingFor(pw) {
    const code = String(pw || "").trim();
    if (!/^\d{6}$/.test(code)) return null;
    const list = (DATA.council || []).filter(c => c && signCodeFor(c) === code);
    if (!list.length) return null;
    return list.sort((a, b) => (Number(b.round) || 0) - (Number(a.round) || 0))[0];
  }
  // v2.29.2: CAR(시정조치) 접수확인 원격 서명 — 수검조직에게 6자리 코드 부여
  function signCarFor(pw) {
    const code = String(pw || "").trim();
    if (!/^\d{6}$/.test(code)) return null;
    return (DATA.cars || []).find(c => c && signCodeFor(c) === code) || null;
  }
  function signLogin(pw) {
    const m = signMeetingFor(pw);
    if (m) {
      currentUser = { id: "__signer__", name: "보안장비 협의회", role: "signer", signMeetingId: m.id };
      sessionStorage.setItem(SS_SESSION, JSON.stringify({ uid: "__signer__", signMeetingId: m.id, ts: Date.now() }));
      return currentUser;
    }
    const car = signCarFor(pw);
    if (car) {
      currentUser = { id: "__signer__", name: "수검조직 서명", role: "signer", signCarId: car.id };
      sessionStorage.setItem(SS_SESSION, JSON.stringify({ uid: "__signer__", signCarId: car.id, ts: Date.now() }));
      return currentUser;
    }
    return null;
  }
  function restoreSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SS_SESSION));
      if (!s) return false;
      if (s.uid === "__signer__") {
        if (s.signCarId) {
          const car = (DATA.cars || []).find(c => c && c.id === s.signCarId);
          if (!car) return false;
          currentUser = { id: "__signer__", name: "수검조직 서명", role: "signer", signCarId: car.id };
          return true;
        }
        const m = (DATA.council || []).find(c => c && c.id === s.signMeetingId);
        if (!m) return false;
        currentUser = { id: "__signer__", name: "보안장비 협의회", role: "signer", signMeetingId: m.id };
        return true;
      }
      const user = allUsers().find(u => u.id === s.uid);
      if (!user) return false;
      currentUser = user;
      return true;
    } catch (e) { return false; }
  }
  function logout() {
    currentUser = null;
    sessionStorage.removeItem(SS_SESSION);
    location.hash = "";
    location.reload();
  }
  const isAdmin = () => currentUser && currentUser.role === "admin";
  const roleRank = () => currentUser ? (ROLE_RANK[currentUser.role] || 1) : 0;
  const canEdit = () => roleRank() >= 3; // 편집 권한: hq 이상 (v2.11)
  function canSee(menu) {
    const vis = menu.vis || "all";
    if (vis === "all") return true;
    if (vis === "mgr") return roleRank() >= 2;
    if (vis === "hq") return roleRank() >= 3;
    return roleRank() >= 4;
  }

  /* ─────────── 유틸 ─────────── */
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function toast(msg, isErr) {
    const wrap = $("#toast-wrap");
    const t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 2200);
    setTimeout(() => t.remove(), 2600);
  }

  /* ─────────── 모달 ─────────── */
  function openModal(html, opts) {
    const box = $("#modal-box");
    box.classList.toggle("wide", !!(opts && opts.wide));
    box.innerHTML = html;
    $("#modal-overlay").classList.remove("hidden");
  }
  function closeModal() {
    $("#modal-overlay").classList.add("hidden");
    const box = $("#modal-box");
    box.classList.remove("wide");
    box.innerHTML = "";
  }
  function confirmModal(msg, onOk) {
    openModal(
      '<h3>확인</h3><p style="font-size:.92rem;color:var(--text-2)">' + esc(msg) + '</p>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost" data-act="cancel">취소</button>' +
      '<button class="btn btn-danger" data-act="ok">확인</button></div>'
    );
    $("#modal-box [data-act=ok]").onclick = () => { closeModal(); onOk(); };
    $("#modal-box [data-act=cancel]").onclick = closeModal;
  }

  /* ─────────── 모듈 레지스트리 & 라우터 ─────────── */
  const modules = {};
  function registerModule(id, def) { modules[id] = def; }

  function currentRoute() {
    const h = location.hash.replace(/^#\//, "");
    return h || "dashboard";
  }
  function navigate(id) { location.hash = "#/" + id; }

  function menuForModule(moduleId) {
    return DATA.menus.find(x => x.type === "module" && x.module === moduleId);
  }

  function renderView() {
    let route = currentRoute();
    const view = $("#view");
    view.innerHTML = "";
    if (currentUser && currentUser.role === "vendor") {
      // v2.16: 협력업체 계정은 대금 청구 화면만 접근 가능 (다른 모든 라우트 차단)
      route = "billing";
      const def = modules.billing || modules.dashboard;
      def.render(view);
      highlightNav(route);
      $("#sidebar").classList.remove("open");
      $("#sidebar-backdrop").classList.remove("show");
      $("#main").scrollTop = 0;
      window.scrollTo(0, 0);
      return;
    }
    if (currentUser && currentUser.role === "signer") {
      // v2.26/v2.29.2: 서명 참석자 — 협의회(signMeetingId) 또는 CAR 접수확인(signCarId) 화면만 접근
      const isCar = !!currentUser.signCarId;
      const def = isCar ? (modules.carcap || modules.dashboard) : (modules.council || modules.dashboard);
      def.render(view);
      highlightNav(isCar ? "carcap" : "council");
      $("#sidebar").classList.remove("open");
      $("#sidebar-backdrop").classList.remove("show");
      $("#main").scrollTop = 0;
      window.scrollTo(0, 0);
      return;
    }
    if (route.indexOf("embed/") === 0) {
      // v2.13: 링크 메뉴 내부 프레임 열기 (open: "frame")
      renderEmbedView(view, route.slice(6));
    } else {
      let def = modules[route];
      const menu = menuForModule(route);
      if (menu && !canSee(menu)) { toast("접근 권한이 없습니다.", true); def = modules.dashboard; }
      if (!def) def = modules.dashboard;
      def.render(view);
    }
    highlightNav(route);
    // 모바일: 이동 시 사이드바 닫기
    $("#sidebar").classList.remove("open");
    $("#sidebar-backdrop").classList.remove("show");
    $("#main").scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /* v2.13: 외부 링크를 시스템 내부 화면(iframe)에서 열기 */
  function renderEmbedView(root, id) {
    const mn = DATA.menus.find(m => m && m.id === id && m.type === "link");
    if (!mn || !canSee(mn)) {
      toast(mn ? "접근 권한이 없습니다." : "메뉴를 찾을 수 없습니다.", true);
      modules.dashboard.render(root);
      return;
    }
    root.innerHTML = `
      <div class="page-head">
        <div class="page-title">${esc(mn.icon || "🔗")} ${esc(mn.label)}</div>
        <span class="spacer"></span>
        <a class="btn btn-ghost btn-sm" href="${esc(mn.url)}" target="_blank" rel="noopener">새 탭에서 열기 ↗</a>
        <div class="page-desc">화면이 비어 있으면 해당 사이트가 내부 열기(iframe)를 차단하는 것입니다 — 새 탭에서 열기를 이용하세요.</div>
      </div>
      <iframe class="embed-frame" src="${esc(mn.url)}" title="${esc(mn.label)}"
        allow="fullscreen" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
  }

  function highlightNav(route) {
    $$(".nav-item").forEach(el => {
      el.classList.toggle("active", el.dataset.route === route);
    });
  }

  /* ─────────── 사이드바 렌더 ─────────── */
  function sortedMenus() {
    return DATA.menus.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
  }
  function renderNav() {
    const box = $("#nav-menu");
    box.innerHTML = "";
    if (currentUser && currentUser.role === "vendor") {
      // v2.16: 협력업체 계정 — 대금 청구 메뉴만 표시
      const b = document.createElement("button");
      b.className = "nav-item";
      b.dataset.route = "billing";
      b.innerHTML = '<span class="nav-ico">🧾</span><span>대금 청구 입력</span>';
      b.onclick = () => navigate("billing");
      box.appendChild(b);
      highlightNav("billing");
      return;
    }
    if (currentUser && currentUser.role === "signer") {
      // v2.26/v2.29.2: 서명 참석자 — 협의회 또는 CAR 접수확인 서명 메뉴만 표시
      const isCar = !!currentUser.signCarId;
      const b = document.createElement("button");
      b.className = "nav-item active";
      b.dataset.route = isCar ? "carcap" : "council";
      b.innerHTML = isCar ? '<span class="nav-ico">📋</span><span>시정조치 · 접수확인 서명</span>'
        : '<span class="nav-ico">🤝</span><span>보안장비 협의회 · 서명</span>';
      b.onclick = () => renderView();
      box.appendChild(b);
      return;
    }
    const menus = sortedMenus();
    const collapsed = navPrefs().collapsed || {};        // v2.22: 계정별 그룹 펼치기/접기
    const mini = !!navPrefs().sidebarMini;               // v2.22: 사이드바 축소(아이콘 전용) 모드
    const appEl = $("#app");
    if (appEl) appEl.classList.toggle("sidebar-mini", mini);

    const itemEl = (mn) => {
      if (mn.type === "link") {
        if (mn.open === "frame") {
          // v2.13: 내부 프레임 열기 — 내부 라우트 버튼
          const b2 = document.createElement("button");
          b2.className = "nav-item";
          b2.dataset.route = "embed/" + mn.id;
          b2.title = mn.label;
          b2.innerHTML = '<span class="nav-ico">' + esc(mn.icon || "🔗") + '</span><span>' + esc(mn.label) + '</span><span class="ext-mark">▣</span>';
          b2.onclick = () => navigate("embed/" + mn.id);
          return b2;
        }
        const a = document.createElement("a");
        a.className = "nav-item";
        a.href = mn.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.title = mn.label;
        a.innerHTML = '<span class="nav-ico">' + esc(mn.icon || "🔗") + '</span><span>' + esc(mn.label) + '</span><span class="ext-mark">↗</span>';
        return a;
      }
      const b = document.createElement("button");
      b.className = "nav-item";
      b.dataset.route = mn.module;
      b.title = mn.label;
      b.innerHTML = '<span class="nav-ico">' + esc(mn.icon || "▪") + '</span><span>' + esc(mn.label) + '</span>';
      b.onclick = () => navigate(mn.module);
      return b;
    };

    // v2.22: 사이드바 상단 툴바 — [모두 펼치기/접기] 토글 + [축소/확대] 토글
    const groupIds = menus.filter(g => g.type === "group" &&
      menus.some(c => c.parent === g.id && canSee(c))).map(g => g.id);
    const allCollapsed = groupIds.length > 0 && groupIds.every(id => collapsed[id]);
    const bar = document.createElement("div");
    bar.className = "nav-toolbar";
    bar.innerHTML =
      '<button type="button" class="nav-tool-btn" id="nav-toggle-all" title="' +
        (allCollapsed ? "모두 펼치기" : "모두 접기") + '">' +
        '<span class="nt-ico">' + (allCollapsed ? "⊞" : "⊟") + '</span>' +
        '<span class="nt-txt">' + (allCollapsed ? "모두 펼치기" : "모두 접기") + '</span></button>' +
      '<button type="button" class="nav-tool-btn nav-tool-mini" id="nav-toggle-mini" title="' +
        (mini ? "사이드바 확대" : "사이드바 축소") + '" aria-label="사이드바 축소/확대">' +
        (mini ? "»" : "«") + '</button>';
    box.appendChild(bar);
    bar.querySelector("#nav-toggle-all").onclick = () => {
      const c = Object.assign({}, navPrefs().collapsed || {});
      const collapseNow = !allCollapsed;   // 하나라도 펼쳐져 있으면 모두 접기, 전부 접혀 있으면 모두 펼치기
      groupIds.forEach(id => { c[id] = collapseNow; });
      setNavPref({ collapsed: c });
      renderNav();
    };
    bar.querySelector("#nav-toggle-mini").onclick = () => {
      setNavPref({ sidebarMini: !navPrefs().sidebarMini });
      renderNav();
    };

    menus.filter(mn => !mn.parent || mn.type === "group").forEach(mn => {
      if (mn.type === "group") {
        const children = menus.filter(c => c.parent === mn.id && canSee(c));
        if (!children.length) return;
        const wrap = document.createElement("div");
        wrap.className = "nav-group" + (collapsed[mn.id] ? " collapsed" : "");
        const head = document.createElement("button");
        head.className = "nav-group-label";
        head.innerHTML = "<span>" + esc(mn.label) + '</span><span class="chev">▼</span>';
        head.onclick = () => {
          wrap.classList.toggle("collapsed");
          const c = Object.assign({}, navPrefs().collapsed || {});
          c[mn.id] = wrap.classList.contains("collapsed");
          setNavPref({ collapsed: c });
          // 툴바 [모두 펼치기/접기] 라벨 갱신을 위해 재렌더
          renderNav();
        };
        const inner = document.createElement("div");
        inner.className = "nav-group-items";
        children.forEach(c => inner.appendChild(itemEl(c)));
        wrap.appendChild(head);
        wrap.appendChild(inner);
        box.appendChild(wrap);
      } else if (canSee(mn)) {
        box.appendChild(itemEl(mn));
      }
    });

    highlightNav(currentRoute());
  }

  /* ─────────── 헤더 위젯 ─────────── */
  function renderHeader() {
    $("#user-chip").textContent = currentUser.name + " · " + (ROLE_LABEL[currentUser.role] || currentUser.role);
    // v2.18: 전역 검색 — vendor(협력업체)·signer(서명) 계정은 검색 미노출
    const lite = currentUser.role === "vendor" || currentUser.role === "signer";
    const sw = $("#hdr-search-wrap"), sb = $("#hdr-search-btn");
    if (sw) sw.classList.toggle("vendor-hide", lite);
    if (sb) sb.classList.toggle("vendor-hide", lite);
    renderSecBadge();
    $("#app-version").textContent = "v" + VERSION;
  }
  function renderSecBadge() {
    const b = $("#sec-level-badge");
    const cur = secCurrent();
    const nxt = secNext();
    b.dataset.level = cur.level;
    b.textContent = "보안등급 · " + cur.level;
    b.title = "국가 항공보안등급: " + cur.level +
      (cur.note ? " — " + cur.note : "") +
      (cur.date ? " (" + cur.date + (cur.end ? " ~ " + cur.end : " ~") + ")" : "") +
      (nxt ? " / 예약: " + nxt.date + "부터 [" + nxt.level + "]" : "");
  }

  /* ─────────── 부팅 ─────────── */
  function enterApp() {
    $("#login-overlay").classList.add("hidden");
    $("#app").classList.remove("hidden");
    renderHeader();
    renderNav();
    renderView();
  }

  function boot() {
    load();

    // 로그인 폼
    $("#login-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const pw = $("#login-pw").value;
      if (!pw) return;
      const user = login(pw) || signLogin(pw);
      if (user) {
        $("#login-error").textContent = "";
        enterApp();
        toast(user.role === "signer" ? "서명 화면입니다. 본인 이름을 찾아 서명해 주세요." : user.name + "님, 환영합니다.");
      } else {
        $("#login-error").textContent = "암호가 올바르지 않습니다.";
        $("#login-pw").value = "";
        $("#login-pw").focus();
      }
    });
    $("#pw-toggle").addEventListener("click", () => {
      const i = $("#login-pw");
      i.type = i.type === "password" ? "text" : "password";
      i.focus();
    });

    // 헤더/사이드바 이벤트
    $("#logout-btn").addEventListener("click", logout);
    $("#menu-toggle").addEventListener("click", () => {
      $("#sidebar").classList.toggle("open");
      $("#sidebar-backdrop").classList.toggle("show", $("#sidebar").classList.contains("open"));
    });
    $("#sidebar-backdrop").addEventListener("click", () => {
      $("#sidebar").classList.remove("open");
      $("#sidebar-backdrop").classList.remove("show");
    });
    $("#modal-overlay").addEventListener("click", (e) => {
      if (e.target === $("#modal-overlay")) closeModal();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
    window.addEventListener("hashchange", () => { if (currentUser) renderView(); });

    // 세션 복원
    if (restoreSession()) enterApp();
    else setTimeout(() => $("#login-pw") && $("#login-pw").focus(), 100);
  }

  /* ─────────── 공개 API ─────────── */
  return {
    boot, registerModule, navigate,
    get data() { return DATA; },
    save, load, onSave, saveSilent, normalizeData,
    get user() { return currentUser; },
    allUsers, isAdmin, roleRank, canEdit, canSee,
    pwHash, sha256, signCodeFor, signCarFor,
    renderNav, renderHeader, renderSecBadge, renderView,
    openModal, closeModal, confirmModal, toast,
    $, $$, esc, fmtDate, sortedMenus,
    SEC_LEVELS, secCurrent, secNext, levelSorted,
    ROLE_LABEL, ROLE_RANK, VIS_LABEL,
    BASE_USERS, VERSION
  };
})();

// 전역 노출 (테스트 및 외부 모듈 접근용)
if (typeof window !== "undefined") window.SeMIS = SeMIS;
