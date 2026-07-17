/* ═══════════════════════════════════════════════════════
   SeMIS v2 — Core Engine
   인증 · 저장소 · 메뉴 엔진 · 권한 · 라우터
   ═══════════════════════════════════════════════════════ */
"use strict";

const SeMIS = (() => {

  const VERSION = "2.9.0";
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
      hash: "cfb1658673413530f9d2ca87a80d750b7eec3cfef5bd228e0331ed037a05023f" }
  ];
  const ROLE_LABEL = { admin: "시스템관리자", manager: "보안관리자", user: "일반사용자" };
  const ROLE_RANK  = { admin: 3, manager: 2, user: 1 };
  const VIS_LABEL  = { all: "전체", mgr: "관리자 이상", admin: "시스템관리자" };

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
      m("schedule", "일정관리", "📅", "schedule"),

      g("grp-level", "항공보안등급"),
      lk("lvl-intro", "국가 보안등급 소개", "📖", "https://sites.google.com/view/kjsemis/%ED%95%AD%EA%B3%B5%EB%B3%B4%EC%95%88%EB%93%B1%EA%B8%89/%EA%B5%AD%EA%B0%80-%ED%95%AD%EA%B3%B5%EB%B3%B4%EC%95%88%EB%93%B1%EA%B8%89-%EC%86%8C%EA%B0%9C", "grp-level"),
      lk("lvl-now", "보안등급 현황 [현재]", "✅", "https://docs.google.com/document/d/1Fvsi7bcOofgXNv7PA5gPF4USuFAJ1JtLWrAApNY4BDM/edit?usp=sharing", "grp-level", { quick: true }),

      g("grp-rule", "규정 / 인허가"),
      lk("rule-intl", "국제/국가 보안규정", "🌐", "https://sites.google.com/view/kjsemis/%EA%B7%9C%EC%A0%95%EC%9D%B8%ED%97%88%EA%B0%80/%EA%B5%AD%EC%A0%9C%EA%B5%AD%EA%B0%80-%EB%B3%B4%EC%95%88%EA%B7%9C%EC%A0%95", "grp-rule"),
      lk("rule-own", "자체 보안규정", "📘", "https://sites.google.com/view/kjsemis/%EA%B7%9C%EC%A0%95%EC%9D%B8%ED%97%88%EA%B0%80/%EC%9E%90%EC%B2%B4-%EB%B3%B4%EC%95%88%EA%B7%9C%EC%A0%95", "grp-rule"),
      lk("rule-iosa", "IOSA (국제 인허가)", "🏅", "https://sites.google.com/view/kjsemis/%EA%B7%9C%EC%A0%95%EC%9D%B8%ED%97%88%EA%B0%80/iosa%EA%B5%AD%EC%A0%9C-%EC%9D%B8%ED%97%88%EA%B0%80", "grp-rule"),
      lk("rule-ssi", "비밀 취급 / SSI", "㊙️", "https://sites.google.com/view/kjsemis/%EA%B7%9C%EC%A0%95%EC%9D%B8%ED%97%88%EA%B0%80/%EB%B9%84%EB%B0%80-%EC%B7%A8%EA%B8%89ssi", "grp-rule", { vis: "mgr" }),

      g("grp-branch", "지점 / 협력업체"),
      m("branches", "지점 관리", "🌍", "branches", "all", "grp-branch"),
      m("contracts-mgmt", "계약서 관리", "💼", "contracts-mgmt", "mgr", "grp-branch"),
      lk("br-sys", "지점보안시스템", "💻", "https://sites.google.com/view/kjsemis/%EC%A7%80%EC%A0%90%ED%98%91%EB%A0%A5%EC%97%85%EC%B2%B4/%EC%A7%80%EC%A0%90%EB%B3%B4%EC%95%88%EC%8B%9C%EC%8A%A4%ED%85%9C", "grp-branch", { quick: true }),
      lk("br-contract", "계약서 관리 (구버전)", "💼", "https://sites.google.com/view/kjsemis/%EC%A7%80%EC%A0%90%ED%98%91%EB%A0%A5%EC%97%85%EC%B2%B4/%EA%B3%84%EC%95%BD%EC%84%9C-%EA%B4%80%EB%A6%AC", "grp-branch", { vis: "mgr" }),
      lk("br-supervisor", "보안감독자 현황", "👥", "https://docs.google.com/spreadsheets/d/1RlxvnrjDWMy4lSTDdbF6JTKCgL45EuTW0O1mjGd8RtQ/edit?usp=sharing", "grp-branch", { vis: "mgr" }),
      lk("br-officer", "지점 보안담당자", "👥", "https://docs.google.com/spreadsheets/d/15Qvf5NgdeyfIBBLzFc3BtTGE6kQse-_HTb9u4PvzHt0/edit?usp=sharing", "grp-branch", { vis: "mgr" }),

      g("grp-inspect", "보안 점검"),
      m("insp-mgmt", "보안점검 일정관리", "🕵️", "inspection", "all", "grp-inspect"),
      lk("insp-plan", "보안점검 일정 (구버전)", "🗓️", "https://sites.google.com/view/kjsemis/%EB%B3%B4%EC%95%88-%EC%A0%90%EA%B2%80/%EB%B3%B4%EC%95%88%EC%A0%90%EA%B2%80-%EC%9D%BC%EC%A0%95", "grp-inspect"),
      lk("insp-cabin", "기내 보안점검", "✈️", "https://sites.google.com/view/kjsemis/%EB%B3%B4%EC%95%88-%EC%A0%90%EA%B2%80/%EC%A0%90%EA%B2%80%EA%B8%B0%EB%A1%9D-%EB%AA%A8%EB%8B%88%ED%84%B0%EB%A7%81/%EA%B8%B0%EB%82%B4-%EB%B3%B4%EC%95%88%EC%A0%90%EA%B2%80", "grp-inspect"),
      lk("insp-daily", "일일 보안점검", "🙆", "https://sites.google.com/view/kjsemis/%EB%B3%B4%EC%95%88-%EC%A0%90%EA%B2%80/%EC%A0%90%EA%B2%80%EA%B8%B0%EB%A1%9D-%EB%AA%A8%EB%8B%88%ED%84%B0%EB%A7%81/%EC%9D%BC%EC%9D%BC-%EB%B3%B4%EC%95%88%EC%A0%90%EA%B2%80", "grp-inspect"),

      g("grp-pass", "출입증 / 보안장비"),
      m("passes", "출입증 관리", "🪪", "passes", "all", "grp-pass"),
      m("equipment", "보안장비 유지관리", "🔧", "equipment", "all", "grp-pass"),
      lk("pass-mgmt", "출입증 관리 (구버전)", "🪪", "https://sites.google.com/view/kjsemis/%EC%B6%9C%EC%9E%85%EC%A6%9D%EB%B3%B4%EC%95%88%EC%9E%A5%EB%B9%84/%EC%B6%9C%EC%9E%85%EC%A6%9D-%EA%B4%80%EB%A6%AC", "grp-pass"),
      lk("equip-mgmt", "보안장비 관리 (구버전)", "🔧", "https://sites.google.com/view/kjsemis/%EC%B6%9C%EC%9E%85%EC%A6%9D%EB%B3%B4%EC%95%88%EC%9E%A5%EB%B9%84/%EB%B3%B4%EC%95%88%EC%9E%A5%EB%B9%84-%EA%B4%80%EB%A6%AC", "grp-pass"),
      lk("equip-council", "보안장비 협의체", "🤝", "https://sites.google.com/view/kjsemis/%EC%B6%9C%EC%9E%85%EC%A6%9D%EB%B3%B4%EC%95%88%EC%9E%A5%EB%B9%84/%EB%B3%B4%EC%95%88%EC%9E%A5%EB%B9%84-%ED%98%91%EC%9D%98%EC%B2%B4", "grp-pass"),

      g("grp-edu", "보안 증진"),
      m("training", "보안교육 관리", "🎓", "training", "all", "grp-edu"),
      lk("edu-training", "보안 교육 (구버전)", "🎓", "https://sites.google.com/view/kjsemis/%EB%B3%B4%EC%95%88-%EC%A6%9D%EC%A7%84/%EB%B3%B4%EC%95%88-%EA%B5%90%EC%9C%A1", "grp-edu"),
      lk("edu-campaign", "보안 캠페인", "📣", "https://sites.google.com/view/kjsemis/%EB%B3%B4%EC%95%88-%EC%A6%9D%EC%A7%84/%EB%B3%B4%EC%95%88-%EC%BA%A0%ED%8E%98%EC%9D%B8", "grp-edu"),

      g("grp-abnormal", "비정상 상황"),
      Object.assign(m("contacts", "보고체계 연락망", "☎️", "contacts", "all", "grp-abnormal"), { quick: true }),
      lk("ab-contact", "보고체계 연락망 (구버전)", "☎️", "https://docs.google.com/spreadsheets/d/1DpNibLZVClfEDjNsKZR-LkXWX5SvE1jlM8JsubD_aIM/edit?usp=sharing", "grp-abnormal", { quick: true }),
      lk("ab-munjasin", "문자의 신 (보안동보)", "📨", "https://www.munjasin.co.kr/", "grp-abnormal", { quick: true }),
      lk("ab-guide", "문자의 신 이용 안내", "📖", "https://sites.google.com/view/kjsemis/%EB%B9%84%EC%A0%95%EC%83%81-%EC%83%81%ED%99%A9/%EB%AC%B8%EC%9E%90%EC%9D%98-%EC%8B%A0-%EB%B3%B4%EA%B3%A0-%EB%B0%A9%EB%B2%95-%EC%95%88%EB%82%B4", "grp-abnormal"),

      g("grp-ref", "참고 / 링크"),
      lk("ref-policy", "에어제타 보안정책", "🛡️", "https://drive.google.com/file/d/15V_aIYU9gB6nCp9AYQPE3kxePisQ2vJV/view?usp=sharing", "grp-ref"),
      lk("ref-agreement", "보안 서약서", "✍️", "https://mark4mission.github.io/airzeta-security-agreement/", "grp-ref"),
      lk("ref-drive", "SeMIS Drive", "🗂️", "https://drive.google.com/drive/folders/1KSKO1ioqb8I0s-kysIkkP4yb2SwURXTW?usp=drive_link", "grp-ref", { vis: "mgr" }),
      lk("ref-legacy", "구버전 (kjsemis)", "🕰️", "https://sites.google.com/view/kjsemis/", "grp-ref"),
      lk("ref-boannews", "보안뉴스", "📰", "https://www.boannews.com/", "grp-ref"),

      m("vault", "암호 관리", "🔐", "vault", "mgr"),
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
      pwOverrides: {},   // { userId: hash }
      customUsers: [],   // [{id, name, role, hash}]
      schedules: [],     // v2.2: [{id,title,memo,start,end,allDay,time,timeEnd,color,done,assignee,vehicle,room,reminders,gcalId?}]
      gcal: { enabled: false, calendarId: "airzetaavsec@gmail.com", apiKey: "" },
      inspections: seedInspections(), // v2.4: 보안점검 일정
      contacts: { sections: [] },     // v2.6: 보고체계 연락망 (실데이터는 공용 DB 동기화 — 코드에 미시드)
      branches: [],                   // v2.7: 지점 관리 (해외지점 세계지도)
      passes: [],                     // v2.8: 출입증 관리 (개인정보 — 공용 DB 동기화)
      equipment: [],                  // v2.8: 보안장비 유지관리
      trainings: [],                  // v2.8: 보안교육 관리
      contracts: [],                  // v2.8: 계약서 관리
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
    // 필드 보정 (구버전 데이터 마이그레이션 대비)
    DATA.notices = DATA.notices || [];
    DATA.pwOverrides = DATA.pwOverrides || {};
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
    // grp-pass 최상단에 출입증 → 보안장비 순서 (equipment 먼저 삽입해야 passes가 위에 옴)
    ensureModuleMenu("equipment", "grp-pass", "보안장비 유지관리", "🔧", "equipment", "all");
    ensureModuleMenu("passes", "grp-pass", "출입증 관리", "🪪", "passes", "all");
    ensureModuleMenu("training", "grp-edu", "보안교육 관리", "🎓", "training", "all");
    // 계약서 관리는 '지점 관리' 바로 다음 위치 (관리자 이상 전용)
    if (!DATA.menus.some(m => m && m.type === "module" && m.module === "contracts-mgmt")) {
      const brMenu = DATA.menus.find(m => m && m.type === "module" && m.module === "branches" && m.parent === "grp-branch");
      if (brMenu) {
        DATA.menus.push({ id: "contracts-mgmt", seq: (brMenu.seq || 0) + 0.25, type: "module",
          label: "계약서 관리", icon: "💼", module: "contracts-mgmt", vis: "mgr", parent: "grp-branch" });
      } else ensureModuleMenu("contracts-mgmt", "grp-branch", "계약서 관리", "💼", "contracts-mgmt", "mgr");
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
        icon: "🔐", module: "vault", vis: "mgr", parent: null });
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

  /* ─────────── 인증 ─────────── */
  let currentUser = null;

  function allUsers() {
    const base = BASE_USERS.map(u => {
      const ov = DATA.pwOverrides[u.id];
      return ov ? Object.assign({}, u, { hash: ov }) : u;
    });
    return base.concat(DATA.customUsers);
  }
  function login(pw) {
    const h = pwHash(pw);
    const user = allUsers().find(u => u.hash === h);
    if (!user) return null;
    currentUser = user;
    sessionStorage.setItem(SS_SESSION, JSON.stringify({ uid: user.id, ts: Date.now() }));
    return user;
  }
  function restoreSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SS_SESSION));
      if (!s) return false;
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
  function canSee(menu) {
    const vis = menu.vis || "all";
    if (vis === "all") return true;
    if (vis === "mgr") return roleRank() >= 2;
    return roleRank() >= 3;
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
    const route = currentRoute();
    let def = modules[route];
    const menu = menuForModule(route);
    if (menu && !canSee(menu)) { toast("접근 권한이 없습니다.", true); def = modules.dashboard; }
    if (!def) def = modules.dashboard;
    $("#view").innerHTML = "";
    def.render($("#view"));
    highlightNav(route);
    // 모바일: 이동 시 사이드바 닫기
    $("#sidebar").classList.remove("open");
    $("#sidebar-backdrop").classList.remove("show");
    $("#main").scrollTop = 0;
    window.scrollTo(0, 0);
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
    const menus = sortedMenus();
    const collapsed = uiState().collapsed || {};

    const itemEl = (mn) => {
      if (mn.type === "link") {
        const a = document.createElement("a");
        a.className = "nav-item";
        a.href = mn.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.innerHTML = '<span class="nav-ico">' + esc(mn.icon || "🔗") + '</span><span>' + esc(mn.label) + '</span><span class="ext-mark">↗</span>';
        return a;
      }
      const b = document.createElement("button");
      b.className = "nav-item";
      b.dataset.route = mn.module;
      b.innerHTML = '<span class="nav-ico">' + esc(mn.icon || "▪") + '</span><span>' + esc(mn.label) + '</span>';
      b.onclick = () => navigate(mn.module);
      return b;
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
          const c = uiState().collapsed || {};
          c[mn.id] = wrap.classList.contains("collapsed");
          setUiState({ collapsed: c });
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
      const user = login(pw);
      if (user) {
        $("#login-error").textContent = "";
        enterApp();
        toast(user.name + "님, 환영합니다.");
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
    allUsers, isAdmin, roleRank, canSee,
    pwHash, sha256,
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
