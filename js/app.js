/* ═══════════════════════════════════════════════════════
   SeMIS v2 — Core Engine
   인증 · 저장소 · 메뉴 엔진 · 권한 · 라우터
   ═══════════════════════════════════════════════════════ */
"use strict";

const SeMIS = (() => {

  const VERSION = "2.46.4";
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
  /* vendor(협력업체, v2.16): 자기 업체 대금 청구 입력 + 업체별 허용 메뉴 열람 (VENDOR_ACCESS, v2.32) */
  /* signer(서명 참석자, v2.26): 회의일(YYYYMMDD) 코드 로그인 — 해당 협의회 서명 화면만 접근 */
  const ROLE_RANK  = { admin: 4, hq: 3, manager: 2, user: 1, vendor: 1, signer: 0 };

  /* ─────── v2.32: 협력업체(vendor) 계정 접근 범위 — 업체명별 화이트리스트 ───────
     기본값은 대금 청구 입력 전용(edit 없음). 위탁 운영 업체(프로에스콤)는 업무 수행에
     필요한 메뉴를 열고, edit:true면 해당 메뉴 안에서 항공보안HQ와 동등한 편집 권한
     (rank 3 — 장비 대장·유지보수 계약/비용·구입가, 협의회 회의록, 규정 등록/수정)을 가짐.
     단 레코드 삭제는 항상 내부 계정 전용(canDelete) — 자료 유실 방지.
     업체별 메뉴·편집 권한 조정은 이 표만 수정하면 됩니다. */
  /* v2.45: 보안장비 위탁 운영·유지보수 업체 공통 접근 범위 (프로에스콤 = ETD / 인씨스 = X-ray).
     두 업체는 동일한 메뉴·편집 권한을 갖되, 대금 청구는 billing 모듈이 role==="vendor" 계정을
     자기 업체로 격리(visible()/canWriteFor)하므로 각자 자기 업체 탭·내역만 보게 된다. */
  const VENDOR_OPS_ACCESS = {
    routes: ["regs-intl", "equipment", "council", "billing"],
    links: [{ label: "CARES (보안장비 관제)", icon: "🛰", url: "https://airzeta-security-system.web.app" }],
    edit: true
  };
  const VENDOR_ACCESS = {
    "프로에스콤": VENDOR_OPS_ACCESS,
    "인씨스": VENDOR_OPS_ACCESS
  };
  const VENDOR_DEFAULT = { routes: ["billing"], links: [], edit: false };
  const VENDOR_NAV_LABEL = { billing: { label: "대금 청구 입력", icon: "🧾" } };
  function vendorAccess(u) {
    const a = VENDOR_ACCESS[String((u && u.vendor) || "").trim()] || VENDOR_DEFAULT;
    const routes = (a.routes || []).slice();
    if (!routes.length) routes.push("billing");
    return { routes, links: (a.links || []).slice(), edit: !!a.edit };
  }
  /* 협력업체 계정의 기본 화면 (첫 접속·허용 목록 밖의 라우트 요청 시 이동)
     v2.46.2: 공지·대시보드가 없는 vendor 화면 특성상 협업 중심 메뉴인
     "보안장비 협의회"를 첫 화면으로. 협의회가 없는 업체(청구 전용)는 종전대로. */
  function vendorHome(u) {
    const r = vendorAccess(u).routes;
    if (r.indexOf("council") >= 0) return "council";
    return r.indexOf("billing") >= 0 ? "billing" : r[0];
  }
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
      m("minutes", "회의록 게시판", "🗒️", "minutes", "mgr"),
      m("kpi", "KPI 현황", "📈", "kpi", "hq"),

      g("grp-level", "항공보안등급"),
      m("seclevel", "국가 보안등급 소개", "📖", "seclevel", "all", "grp-level"),
      lk("lvl-now", "보안등급 현황 [현재]", "✅", "https://docs.google.com/document/d/1Fvsi7bcOofgXNv7PA5gPF4USuFAJ1JtLWrAApNY4BDM/edit?usp=sharing", "grp-level", { quick: true }),

      g("grp-rule", "규정 / 인허가"),
      m("regs-intl", "국제/국가 보안규정", "🌐", "regs-intl", "all", "grp-rule"),
      m("regs-own", "자체 보안규정", "📘", "regs-own", "all", "grp-rule"),
      m("iosa", "IOSA (국제 인허가)", "🏅", "iosa", "all", "grp-rule"),
      lk("rule-intl", "국제/국가 보안규정 (구버전)", "🌐", "https://sites.google.com/view/kjsemis/%EA%B7%9C%EC%A0%95%EC%9D%B8%ED%97%88%EA%B0%80/%EA%B5%AD%EC%A0%9C%EA%B5%AD%EA%B0%80-%EB%B3%B4%EC%95%88%EA%B7%9C%EC%A0%95", "grp-rule"),
      lk("rule-own", "자체 보안규정 (구버전)", "📘", "https://sites.google.com/view/kjsemis/%EA%B7%9C%EC%A0%95%EC%9D%B8%ED%97%88%EA%B0%80/%EC%9E%90%EC%B2%B4-%EB%B3%B4%EC%95%88%EA%B7%9C%EC%A0%95", "grp-rule"),
      lk("rule-iosa", "IOSA 자료실 (구버전)", "🏅", "https://sites.google.com/view/kjsemis/%EA%B7%9C%EC%A0%95%EC%9D%B8%ED%97%88%EA%B0%80/iosa%EA%B5%AD%EC%A0%9C-%EC%9D%B8%ED%97%88%EA%B0%80", "grp-rule", { vis: "mgr" }),
      lk("rule-ssi", "비밀 취급 / SSI", "㊙️", "https://sites.google.com/view/kjsemis/%EA%B7%9C%EC%A0%95%EC%9D%B8%ED%97%88%EA%B0%80/%EB%B9%84%EB%B0%80-%EC%B7%A8%EA%B8%89ssi", "grp-rule", { vis: "mgr" }),

      g("grp-branch", "지점 / 협력업체"),
      m("branches", "지점 관리", "🌍", "branches", "mgr", "grp-branch"),
      m("contracts-mgmt", "계약서 관리", "💼", "contracts-mgmt", "hq", "grp-branch"),
      lk("br-sys", "지점보안시스템", "💻", "https://sites.google.com/view/kjsemis/%EC%A7%80%EC%A0%90%ED%98%91%EB%A0%A5%EC%97%85%EC%B2%B4/%EC%A7%80%EC%A0%90%EB%B3%B4%EC%95%88%EC%8B%9C%EC%8A%A4%ED%85%9C", "grp-branch", { quick: true }),
      lk("br-contract", "계약서 관리 (구버전)", "💼", "https://sites.google.com/view/kjsemis/%EC%A7%80%EC%A0%90%ED%98%91%EB%A0%A5%EC%97%85%EC%B2%B4/%EA%B3%84%EC%95%BD%EC%84%9C-%EA%B4%80%EB%A6%AC", "grp-branch", { vis: "mgr" }),
      m("supervisors", "보안감독자 현황", "👥", "supervisors", "mgr", "grp-branch"),
      m("stn-officers", "지점 보안담당자", "🛫", "stn-officers", "mgr", "grp-branch"),

      g("grp-inspect", "보안 점검"),
      m("insp-mgmt", "보안점검 일정관리", "🕵️", "inspection", "mgr", "grp-inspect"),
      m("insp-car", "부적합·시정조치 (CAR)", "📋", "carcap", "hq", "grp-inspect"),
      lk("insp-plan", "보안점검 일정 (구버전)", "🗓️", "https://sites.google.com/view/kjsemis/%EB%B3%B4%EC%95%88-%EC%A0%90%EA%B2%80/%EB%B3%B4%EC%95%88%EC%A0%90%EA%B2%80-%EC%9D%BC%EC%A0%95", "grp-inspect"),
      lk("insp-cabin", "기내 보안점검", "✈️", "https://sites.google.com/view/kjsemis/%EB%B3%B4%EC%95%88-%EC%A0%90%EA%B2%80/%EC%A0%90%EA%B2%80%EA%B8%B0%EB%A1%9D-%EB%AA%A8%EB%8B%88%ED%84%B0%EB%A7%81/%EA%B8%B0%EB%82%B4-%EB%B3%B4%EC%95%88%EC%A0%90%EA%B2%80", "grp-inspect"),
      lk("insp-daily", "일일 보안점검", "🙆", "https://sites.google.com/view/kjsemis/%EB%B3%B4%EC%95%88-%EC%A0%90%EA%B2%80/%EC%A0%90%EA%B2%80%EA%B8%B0%EB%A1%9D-%EB%AA%A8%EB%8B%88%ED%84%B0%EB%A7%81/%EC%9D%BC%EC%9D%BC-%EB%B3%B4%EC%95%88%EC%A0%90%EA%B2%80", "grp-inspect"),

      g("grp-pass", "출입증"),
      m("passes", "출입증 관리", "🪪", "passes", "mgr", "grp-pass"),
      m("pass-docs", "출입증 신청 서류", "📋", "pass-docs", "all", "grp-pass"),
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
      passOwners: [],                 // v2.36.1: 출입증 관리 책임자 명단 (개인정보 — 코드 미시드, 공용 DB만)
      equipment: [],                  // v2.8: 보안장비 유지관리
      trainings: [],                  // v2.8: 보안교육 관리
      contracts: [],                  // v2.8: 계약서 관리
      equipMaint: { contracts: [], costs: [] }, // v2.10: 장비 유지보수 계약/월별 비용 (SeMIS 고유)
      council: [],                    // v2.24: 보안장비 협의회 회의록 (KPI C6-1 기반)
      minutes: [],                    // v2.40: 회의록 게시판 (폴더 분류 · 참석자 QR 서명)
      minuteFolders: [],              // v2.40: 회의록 폴더(그룹) — normalize가 기본 폴더 시드
      regulations: [],                // v2.12: 규정 관리 (국제/국가 + 자체, PDF/링크 + 개정 아이디어 노트)
      policy: { ko: null, en: null }, // v2.14: 에어제타 보안정책 (국문/영문 PDF)
      certs: [],                      // v2.15: 교육 이수증 관리 (외부기관 보안책임자/감독자 등)
      certOpts: { roles: [], orgs: [] }, // v2.17: 이수증 선택지(과정/수료기관 — 사용자 관리, 빈 배열이면 normalize가 기본값 시드)
      billing: [],                    // v2.16: 대금 청구 (협력업체 월별 입력 — 프로에스콤/인씨스)
      chatRooms: [],                  // v2.46: 팀 채팅 초대제 채팅방 [{id,name,members[],createdBy,created}]
      supervisors: seedSupervisors(),        // v2.34: 보안감독자 현황 (구글시트 이관)
      stationOfficers: seedStationOfficers(), // v2.34: 지점 보안담당자 (구글시트 이관)
      vault: { v: 1, members: [], data: null, updated: "" } // v2.9: 암호 관리 (암호문만 저장)
    };
  }

  /* ─────── 보안 인력 현황(보안감독자·지점 보안담당자) ───────
     v2.36.2: 실명·사번이 포함된 개인정보라 코드 시드를 제거했습니다.
     실데이터는 공용 DB(semis_store "supervisors" / "stationOfficers")에서만 로드하며,
     여기서는 빈 컨테이너만 보장합니다 — 보고체계 연락망(contacts)·출입증 관리 책임자(passOwners)와 동일 원칙. */
  const seedSupervisors = () => [];
  const seedStationOfficers = () => [];

  /* ─────── 보안점검 2026 계획 시드 (기존 구글시트 이관) ───────
     id는 고정값 — 여러 브라우저가 동시에 시드해도 동일 데이터가 되어 병합 충돌 없음.
     v2.36.3: 점검관 이름은 개인정보라 시드에서 제외(빈 배열) — 실제 배정은 공용 DB
     (semis_store "inspections")에만 존재하며 화면에서 편집한다. */
  function seedInspections() {
    const mk = (id, category, target, month, inspectors, start, end) => ({
      id, year: 2026, category, target, month,
      inspectors: inspectors || [], start: start || "", end: end || "",
      status: "계획", note: "", resultUrl: "", linkCal: false
    });
    return [
      mk("i2601", "국내정기", "프로에스콤", 5, []),
      mk("i2602", "국내정기", "LSG", 5, []),
      mk("i2603", "국내정기", "정비고", 9, []),
      mk("i2604", "국내정기", "ICNKF", 10, []),
      mk("i2605", "불시평가", "항공기 보안", 4, []),
      mk("i2606", "불시평가", "케이터링", 5, []),
      mk("i2607", "불시평가", "프로에스콤", 5, []),
      mk("i2608", "불시평가", "화물청사", 9, []),
      mk("i2609", "해외공항", "BKKSU", 3, []),
      mk("i2610", "해외공항", "FRASF", 7, []),
      mk("i2611", "해외공항", "ALASU", 7, []),
      mk("i2612", "해외공항", "SFOSF", 8, []),
      mk("i2613", "해외공항", "MILSF", 9, []),
      mk("i2614", "해외공항", "SHASF", 9, []),
      mk("i2615", "해외공항", "HANSF", 9, []),
      mk("i2616", "해외공항", "ATLSF", 10, []),
      mk("i2617", "해외공항", "YNTSF", 10, []),
      mk("i2618", "해외공항", "HKGSF", 10, []),
      mk("i2619", "해외공항", "CHISF", 11, []),
      mk("i2620", "해외공항", "DFWSF", 11, []),
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
    if (!Array.isArray(DATA.chatRooms)) DATA.chatRooms = []; // v2.46: 초대제 채팅방
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
      // v2.33: 반복 일정 회차별 완료 (doneFrom: 이후 모두 / doneDates: 개별 완료 / undoneDates: 개별 해제)
      s.doneFrom = typeof s.doneFrom === "string" ? s.doneFrom : "";
      if (!Array.isArray(s.doneDates)) s.doneDates = [];
      if (!Array.isArray(s.undoneDates)) s.undoneDates = [];
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
    // v2.40: 회의록 게시판 — 데이터 보정 + 기본 폴더 시드 + 메뉴 자동 삽입(일정관리 다음, mgr 열람)
    if (!Array.isArray(DATA.minutes)) DATA.minutes = [];
    if (!Array.isArray(DATA.minuteFolders)) DATA.minuteFolders = [];
    if (!DATA.minuteFolders.length && typeof window !== "undefined" && window.SemisMinutes)
      DATA.minuteFolders = window.SemisMinutes.seedFolders();
    if (!DATA.menus.some(m => m && m.type === "module" && m.module === "minutes")) {
      const sc = DATA.menus.find(m => m && m.type === "module" && m.module === "schedule");
      DATA.menus.push({ id: "minutes", seq: sc ? (sc.seq || 0) + 0.2 : 2.2, type: "module",
        label: "회의록 게시판", icon: "🗒️", module: "minutes", vis: "mgr", parent: null });
    }
    /* v2.46.3: (v2.40.2 불변식 폐지) 회의록 메뉴 vis는 관리자 설정을 그대로 존중한다.
       종전에는 "참석자(일반사용자)도 봐야 한다"는 이유로 mgr 설정을 매번 all로 되돌렸으나,
       전체공개는 운영상 무의미하다는 판단에 따라 제거. 참석 기반 열람 원칙은 canSee()의
       예외(본인 참석·작성 회의가 있으면 등급 무관 진입 허용)로 유지된다. */
    /* v2.41: HTML 소스를 일반 텍스트로 붙여넣어 "<b>…</b>" 가 글자 그대로 굳어버린 본문 복구.
       요소 노드가 이미 있으면 건너뛰므로 멱등하며, 보정이 생기면 normalize 반환값을 통해
       공용 DB로도 자동 반영된다. (회의록 게시판 · 보안장비 협의회 · 공지사항) */
    // v2.41.1: 결정사항 연동 키 보정 + 기한 일정 반영 (기존 회의록도 폼을 안 열고 반영되도록)
    if (typeof window !== "undefined" && window.SemisMinutes && window.SemisMinutes.normalizeDecisions) {
      try { window.SemisMinutes.normalizeDecisions(); } catch (e) { /* 보정 실패가 로딩을 막지 않도록 */ }
    }
    if (typeof document !== "undefined" && window.SemisNotice && window.SemisNotice.repairEscapedRich) {
      const fix = window.SemisNotice.repairEscapedRich;
      (Array.isArray(DATA.minutes) ? DATA.minutes : []).forEach(x => {
        if (!x) return; fix(x, "agenda"); fix(x, "body");
      });
      (Array.isArray(DATA.council) ? DATA.council : []).forEach(x => {
        if (!x) return; fix(x, "agenda"); fix(x, "env"); fix(x, "proposals");
      });
      (Array.isArray(DATA.notices) ? DATA.notices : []).forEach(x => {
        if (!x) return; fix(x, "body");
      });
    }
    /* v2.34: 보안감독자 현황 / 지점 보안담당자 — 구글시트 링크 → 내부 모듈 이관.
       최초 사용 시 시트 내용 시드 + 메뉴 교체(기존 링크 메뉴 제거, idempotent). */
    if (!Array.isArray(DATA.supervisors)) DATA.supervisors = seedSupervisors();
    if (!Array.isArray(DATA.stationOfficers)) DATA.stationOfficers = seedStationOfficers();
    {
      const cn = DATA.menus.find(m => m && m.type === "module" && m.module === "contracts-mgmt");
      const baseSeq = cn ? (cn.seq || 0) : null;
      if (!DATA.menus.some(m => m && m.type === "module" && m.module === "supervisors")) {
        if (baseSeq !== null) DATA.menus.push({ id: "supervisors", seq: baseSeq + 0.1, type: "module",
          label: "보안감독자 현황", icon: "👥", module: "supervisors", vis: "mgr", parent: "grp-branch" });
        else ensureModuleMenu("supervisors", "grp-branch", "보안감독자 현황", "👥", "supervisors", "mgr");
      }
      if (!DATA.menus.some(m => m && m.type === "module" && m.module === "stn-officers")) {
        if (baseSeq !== null) DATA.menus.push({ id: "stn-officers", seq: baseSeq + 0.15, type: "module",
          label: "지점 보안담당자", icon: "🛫", module: "stn-officers", vis: "mgr", parent: "grp-branch" });
        else ensureModuleMenu("stn-officers", "grp-branch", "지점 보안담당자", "🛫", "stn-officers", "mgr");
      }
      // 구버전 구글시트 링크 메뉴 제거 (모듈로 완전 대체 — 원본 시트는 모듈 상단에서 접근)
      DATA.menus = DATA.menus.filter(m => !(m && m.type === "link" &&
        (m.id === "br-supervisor" || m.id === "br-officer")));
    }
    /* v2.36: 안내 콘텐츠 3종을 구 링크 메뉴 → 내부 모듈로 이관 (멱등)
       ① 국가 보안등급 소개(seclevel)  ② IOSA(iosa)  ③ 출입증 신청 서류(pass-docs) */
    {
      // ① 국가 보안등급 소개 — 구 링크(lvl-intro) 자리에 모듈을 넣고 링크는 제거
      if (!DATA.menus.some(m => m && m.type === "module" && m.module === "seclevel")) {
        const lv = DATA.menus.find(m => m && m.id === "lvl-intro");
        if (lv) DATA.menus.push({ id: "seclevel", seq: lv.seq || 0, type: "module",
          label: "국가 보안등급 소개", icon: "📖", module: "seclevel", vis: "all", parent: "grp-level" });
        else ensureModuleMenu("seclevel", "grp-level", "국가 보안등급 소개", "📖", "seclevel", "all");
      }
      DATA.menus = DATA.menus.filter(m => !(m && m.type === "link" && m.id === "lvl-intro"));

      // ② IOSA — 자체 보안규정 다음에 모듈 삽입, 구 링크는 자료실(보안성 내용)로 라벨·권한 조정
      if (!DATA.menus.some(m => m && m.type === "module" && m.module === "iosa")) {
        const ro = DATA.menus.find(m => m && m.type === "module" && m.module === "regs-own");
        if (ro) DATA.menus.push({ id: "iosa", seq: (ro.seq || 0) + 0.1, type: "module",
          label: "IOSA (국제 인허가)", icon: "🏅", module: "iosa", vis: "all", parent: "grp-rule" });
        else ensureModuleMenu("iosa", "grp-rule", "IOSA (국제 인허가)", "🏅", "iosa", "all");
      }
      {
        const io = DATA.menus.find(m => m && m.id === "rule-iosa" && m.type === "link");
        if (io && io.label !== "IOSA 자료실 (구버전)") { io.label = "IOSA 자료실 (구버전)"; io.vis = "mgr"; }
      }

      // ③ 출입증 신청 서류 — 출입증 관리 바로 다음
      //    v2.36.1: 관리 책임자 명단(구글시트 이관) 컨테이너 — 실데이터는 공용 DB에서만 로드
      if (!Array.isArray(DATA.passOwners)) DATA.passOwners = [];
      if (!DATA.menus.some(m => m && m.type === "module" && m.module === "pass-docs")) {
        const ps = DATA.menus.find(m => m && m.type === "module" && m.module === "passes");
        if (ps) DATA.menus.push({ id: "pass-docs", seq: (ps.seq || 0) + 0.1, type: "module",
          label: "출입증 신청 서류", icon: "📋", module: "pass-docs", vis: "all", parent: "grp-pass" });
        else ensureModuleMenu("pass-docs", "grp-pass", "출입증 신청 서류", "📋", "pass-docs", "all");
      }
    }
    /* v2.36.4: 보안점검 ↔ 일정관리 일괄 연동(1회).
       그동안 linkCal이 꺼진 점검은 일정관리에 나타나지 않아 두 화면이 어긋났음
       (예: 점검은 11월로 옮겼는데 캘린더는 10월 그대로).
       취소를 제외한 모든 점검의 linkCal을 켜고 "[점검]/[계획]" 일정을 생성·갱신한다.
       이후에는 저장·드래그 시마다 양방향 동기화되므로 다시 실행하지 않는다. */
    if (DATA.inspSync !== "2.36.4" && typeof window !== "undefined"
        && window.SemisInspection && window.SemisInspection.syncAllCalendar) {
      try { window.SemisInspection.syncAllCalendar(); DATA.inspSync = "2.36.4"; }
      catch (e) { /* 모듈 미로드 등 — 다음 기회에 재시도 */ }
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
  // v2.40: 회의록 게시판 참석 서명 — 회의록 id 기반 6자리 코드 (QR 접속도 동일 코드)
  function signMinuteFor(pw) {
    const code = String(pw || "").trim();
    if (!/^\d{6}$/.test(code)) return null;
    const list = (DATA.minutes || []).filter(c => c && signCodeFor(c) === code);
    if (!list.length) return null;
    return list.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
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
    const mi = signMinuteFor(pw);
    if (mi) {
      currentUser = { id: "__signer__", name: "회의록 참석 서명", role: "signer", signMinuteId: mi.id };
      sessionStorage.setItem(SS_SESSION, JSON.stringify({ uid: "__signer__", signMinuteId: mi.id, ts: Date.now() }));
      return currentUser;
    }
    return null;
  }
  /* v2.40: QR 접속 — 주소 #/sign/123456 로 들어오면 코드 입력 없이 서명 화면으로.
     첫 방문 기기는 공용 DB 동기화 전이라 회의 정보가 없을 수 있어 잠시 재시도한다. */
  function signCodeFromHash() {
    const mm = /^#\/sign\/(\d{6})$/.exec(String(location.hash || ""));
    return mm ? mm[1] : "";
  }
  /* QR에 넣을 접속 주소 — 현재 배포 주소를 그대로 사용(로컬 테스트·사내망에서도 동작) */
  function signUrlFor(rec) {
    const code = signCodeFor(rec);
    let base = "https://semis.pe.kr/";
    try {
      const l = location;
      if (l && l.protocol && l.protocol.indexOf("http") === 0)
        base = l.origin + l.pathname.replace(/index\.html$/i, "");
    } catch (e) { /* 파일 프로토콜 등 — 기본 주소 사용 */ }
    if (base.slice(-1) !== "/") base += "/";
    return base + "#/sign/" + code;
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
        if (s.signMinuteId) {
          const mi = (DATA.minutes || []).find(c => c && c.id === s.signMinuteId);
          if (!mi) return false;
          currentUser = { id: "__signer__", name: "회의록 참석 서명", role: "signer", signMinuteId: mi.id };
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
  /* v2.32.1: 협력업체 중 VENDOR_ACCESS.edit 업체는 허용 메뉴 안에서만 hq 동등(3) 등급.
     접근 가능한 라우트가 화이트리스트로 제한되므로 등급 상승 영향은 그 메뉴에 한정됨. */
  const roleRank = () => {
    if (!currentUser) return 0;
    if (currentUser.role === "vendor") return vendorAccess(currentUser).edit ? 3 : 1;
    /* v2.40.2: signer는 등급 0이 정의값인데 `|| 1` 이 이를 1(일반사용자)로 끌어올리고 있었다.
       미지정 역할만 1로 보정하도록 수정 — 서명 참석자는 어떤 모듈 데이터도 등급으로 얻지 못한다. */
    const r = ROLE_RANK[currentUser.role];
    return (r == null) ? 1 : r;
  };
  const canEdit = () => roleRank() >= 3; // 편집 권한: hq 이상 (v2.11)
  /* v2.32.1: 레코드 삭제 — 편집 권한 + 내부 계정만 (협력업체는 등록·수정만) */
  const canDelete = () => canEdit() && !(currentUser && currentUser.role === "vendor");
  /* v2.46.3: 회의록 게시판 참석자 예외 — 등급이 모자라도 "본인이 참석·작성한 회의"가
     있으면 진입 허용 (v2.40.2 참석 기반 열람 원칙 유지). 무엇을 볼 수 있는지는 모듈의
     visibleAll()이 그대로 판정하므로 이 예외로 타인 회의가 열리지는 않는다.
     vis="hq"/"admin" 제한은 관리자 의도로 보고 예외 없이 존중(종전과 동일). */
  function minutesAttendee(menu) {
    if (menu.module !== "minutes" || !currentUser) return false;
    if (currentUser.role === "vendor" || currentUser.role === "signer") return false;
    if (typeof window === "undefined" || !window.SemisMinutes) return false;
    try { return window.SemisMinutes.visibleAll().length > 0; } catch (e) { return false; }
  }
  function canSee(menu) {
    const vis = menu.vis || "all";
    if (vis === "all") return true;
    if (vis === "mgr") return roleRank() >= 2 || minutesAttendee(menu);
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
  /* 공통 디자인(Section Kit) 링 게이지 — css/main.css 의 .ds-ring 참조.
     pct: 0~100, sub: 링 안쪽 보조 문구(예: "완료 8 / 18") */
  function dsRing(pct, sub) {
    const R = 54, C = 2 * Math.PI * R;
    const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    return `<div class="ds-ring">
      <svg viewBox="0 0 134 134" width="134" height="134" aria-hidden="true">
        <defs><linearGradient id="dsRingG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1552b8"></stop><stop offset="1" stop-color="#4da3f7"></stop>
        </linearGradient></defs>
        <circle cx="67" cy="67" r="${R}" fill="none" stroke="#e3ebf6" stroke-width="13"></circle>
        <circle cx="67" cy="67" r="${R}" fill="none" stroke="url(#dsRingG)" stroke-width="13"
          stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - p / 100)).toFixed(1)}"></circle>
      </svg>
      <div class="ds-ring-c"><span class="ds-ring-p">${p}%</span>${sub ? `<span class="ds-ring-s">${esc(sub)}</span>` : ""}</div>
    </div>`;
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
    box.classList.remove("full");   // v2.41: 전체화면 편집 모드 해제
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

  /* v2.31.2: 라우트별 콘텐츠 폭 — 고해상도 모니터의 과도한 좌우 여백 제거
     wide(2100px) = 캘린더·다열 표·칸반·문서 뷰어 등 밀집형
     mid(1560px)  = 목록/표 중간 밀도
     (미지정 = 기본 1180px) — 폭 조정은 이 표만 수정하면 됩니다. */
  const VIEW_WIDTH = {
    schedule: "wide", inspection: "wide", carcap: "wide",
    kpi: "wide", policy: "wide", dashboard: "wide",
    passes: "mid", branches: "mid", "contracts-mgmt": "mid", training: "mid",
    supervisors: "mid", "stn-officers": "mid",
    certs: "mid", contacts: "mid", council: "mid", billing: "mid", minutes: "mid",
    equipment: "mid", settings: "mid", "regs-intl": "mid", "regs-own": "mid", vault: "mid"
  };
  function applyViewWidth(view, route) {
    const tier = String(route).indexOf("embed/") === 0 ? "wide" : (VIEW_WIDTH[route] || "");
    view.classList.toggle("view-wide", tier === "wide");
    view.classList.toggle("view-mid", tier === "mid");
  }

  function renderView() {
    let route = currentRoute();
    const view = $("#view");
    view.innerHTML = "";
    applyViewWidth(view, route);
    if (currentUser && currentUser.role === "vendor") {
      // v2.16/v2.32: 협력업체 계정은 업체별 허용 목록의 라우트만 접근 (그 외는 기본 화면으로)
      const allow = vendorAccess(currentUser).routes;
      if (allow.indexOf(route) < 0) route = vendorHome(currentUser);
      applyViewWidth(view, route);
      const def = modules[route] || modules.billing || modules.dashboard;
      def.render(view);
      highlightNav(route);
      $("#sidebar").classList.remove("open");
      $("#sidebar-backdrop").classList.remove("show");
      $("#main").scrollTop = 0;
      window.scrollTo(0, 0);
      return;
    }
    if (currentUser && currentUser.role === "signer") {
      // v2.26/v2.29.2/v2.40: 서명 참석자 — 협의회·CAR 접수확인·회의록 서명 화면만 접근
      const sRoute = currentUser.signCarId ? "carcap" : (currentUser.signMinuteId ? "minutes" : "council");
      view.classList.remove("view-wide"); view.classList.remove("view-mid"); // 서명 화면은 기본 폭(모바일 중심)
      const def = modules[sRoute] || modules.dashboard;
      def.render(view);
      highlightNav(sRoute);
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
      // v2.16/v2.32: 협력업체 계정 — 업체별 허용 메뉴 + 외부 링크(CARES 등)만 표시
      const acc = vendorAccess(currentUser);
      acc.routes.forEach(r => {
        const mn = menuForModule(r);
        const ov = VENDOR_NAV_LABEL[r] || {};
        const label = ov.label || (mn && mn.label) || r;
        const b = document.createElement("button");
        b.className = "nav-item";
        b.dataset.route = r;
        b.title = label;
        b.innerHTML = '<span class="nav-ico">' + esc(ov.icon || (mn && mn.icon) || "▪") +
          '</span><span>' + esc(label) + '</span>';
        b.onclick = () => navigate(r);
        box.appendChild(b);
      });
      acc.links.forEach(l => {
        const a = document.createElement("a");
        a.className = "nav-item";
        a.href = l.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.title = l.label;
        a.innerHTML = '<span class="nav-ico">' + esc(l.icon || "🔗") + '</span><span>' +
          esc(l.label) + '</span><span class="ext-mark">↗</span>';
        box.appendChild(a);
      });
      const cur = currentRoute();
      highlightNav(acc.routes.indexOf(cur) >= 0 ? cur : vendorHome(currentUser));
      return;
    }
    if (currentUser && currentUser.role === "signer") {
      // v2.26/v2.29.2/v2.40: 서명 참석자 — 협의회·CAR 접수확인·회의록 서명 메뉴만 표시
      const isCar = !!currentUser.signCarId, isMin = !!currentUser.signMinuteId;
      const b = document.createElement("button");
      b.className = "nav-item active";
      b.dataset.route = isCar ? "carcap" : (isMin ? "minutes" : "council");
      b.innerHTML = isCar ? '<span class="nav-ico">📋</span><span>시정조치 · 접수확인 서명</span>'
        : (isMin ? '<span class="nav-ico">🗒️</span><span>회의록 · 참석 서명</span>'
          : '<span class="nav-ico">🤝</span><span>보안장비 협의회 · 서명</span>');
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
    // v2.18: 전역 검색 — signer(서명) 계정만 미노출.
    // v2.46: vendor(협력업체)에도 제공 — 검색 범위는 search.js가 허용 메뉴로 제한.
    const lite = currentUser.role === "signer";
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
    // v2.35: 세미·팀 채팅 위젯 — 내부 계정만 표시 (vendor/signer는 위젯이 자체 차단)
    if (typeof window !== "undefined" && window.SemisChat) {
      try { window.SemisChat.onLogin(); } catch (e) { /* 위젯 오류가 앱을 막지 않도록 */ }
    }
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
    if (restoreSession()) { enterApp(); return; }

    /* v2.40: QR 접속(#/sign/코드) — 암호 입력 없이 바로 서명 화면.
       처음 접속한 휴대폰은 공용 DB 동기화가 끝나야 회의 정보가 생기므로
       최대 12초 동안 짧게 재시도한 뒤, 실패하면 코드를 채워둔 로그인 화면을 남긴다. */
    const qrCode = signCodeFromHash();
    if (qrCode) {
      const pwEl = $("#login-pw"), errEl = $("#login-error");
      if (pwEl) pwEl.value = qrCode;
      if (errEl) errEl.textContent = "회의 정보를 불러오는 중입니다…";
      let tries = 0;
      const tryIn = () => {
        const u = signLogin(qrCode);
        if (u) {
          if (errEl) errEl.textContent = "";
          location.hash = "";
          enterApp();
          toast("서명 화면입니다. 본인 이름을 찾아 서명해 주세요.");
          return;
        }
        if (++tries >= 16) {
          if (errEl) errEl.textContent = "회의 정보를 찾지 못했습니다. [로그인]을 눌러 다시 시도해 주세요.";
          return;
        }
        setTimeout(tryIn, 750);
      };
      setTimeout(tryIn, 300);
      return;
    }
    setTimeout(() => $("#login-pw") && $("#login-pw").focus(), 100);
  }

  /* ─────────── 공개 API ─────────── */
  return {
    boot, registerModule, navigate,
    get data() { return DATA; },
    save, load, onSave, saveSilent, normalizeData,
    get user() { return currentUser; },
    allUsers, isAdmin, roleRank, canEdit, canDelete, canSee,
    VENDOR_ACCESS, vendorAccess, vendorHome,
    pwHash, sha256, signCodeFor, signCarFor, signMinuteFor, signCodeFromHash, signUrlFor,
    renderNav, renderHeader, renderSecBadge, renderView,
    openModal, closeModal, confirmModal, toast,
    $, $$, esc, fmtDate, dsRing, sortedMenus,
    SEC_LEVELS, secCurrent, secNext, levelSorted,
    ROLE_LABEL, ROLE_RANK, VIS_LABEL,
    BASE_USERS, VERSION
  };
})();

// 전역 노출 (테스트 및 외부 모듈 접근용)
if (typeof window !== "undefined") window.SeMIS = SeMIS;
