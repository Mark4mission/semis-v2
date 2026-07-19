/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 보안 뉴스 + 항공보안 인사이트 (v2.19)
   guest(일반 사용자) 경량 대시보드 전용 카드 2종.
   - 뉴스: Edge Function(semis-news)이 보안뉴스(boannews) RSS와
     Google News(항공보안 키워드)를 수집·분류 → 30분 로컬 캐시
   - 인사이트: 항공보안 교육·홍보용 정적 시각화 (탭 4종)
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc } = SeMIS;

  /* ─────────── 보안 뉴스 ─────────── */
  const FN_URL = "https://mzyuzrxkdcpzxojenwat.supabase.co/functions/v1/semis-news?t=azs-news-7d3f9a2c";
  const CACHE_KEY = "semis2:news";
  const TTL = 30 * 60 * 1000;        // 캐시 유효 30분
  const REFRESH_MS = 60 * 60 * 1000; // 화면 열려 있는 동안 60분마다 자동 갱신
  let refreshTimer = null;

  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (c && Array.isArray(c.items)) return c;
    } catch (e) { /* 무시 */ }
    return null;
  }

  async function fetchNews() {
    const c = loadCache();
    if (c && Date.now() - c.ts < TTL) return c.items;
    const r = await fetch(FN_URL);
    if (!r.ok) throw new Error("news http " + r.status);
    const j = await r.json();
    const items = (Array.isArray(j.items) ? j.items : []).slice(0, 24);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items })); } catch (e) { /* 무시 */ }
    return items;
  }

  // 분류: aviation(항공) / cargo(화물) / cyber(사이버)
  const CAT_BADGE = {
    aviation: ["badge-blue", "항공"],
    cargo:    ["badge-amber", "화물"],
    cyber:    ["badge-gray", "사이버"]
  };

  const newsRow = (it) => {
    const d = it.date ? String(it.date).slice(5, 10).replace("-", ".") : "";
    const [bc, bl] = CAT_BADGE[it.cat] || CAT_BADGE.cyber;
    return `<a class="news-row" href="${esc(it.link)}" target="_blank" rel="noopener" title="${esc(it.src || "")} 새 창에서 열기">
      <span class="badge ${bc}" style="flex-shrink:0">${bl}</span>
      <span class="news-title">${esc(it.title)}</span>
      <span class="news-meta">${esc(it.src || "")}${d ? " · " + d : ""}</span>
    </a>`;
  };

  function paintNews(el, items, cat, note) {
    const list = cat === "all" ? items : items.filter(x => (x.cat || "cyber") === cat);
    el.innerHTML = (list.length
      ? list.map(newsRow).join("")
      : '<div class="empty">해당 분류의 기사가 없습니다.</div>') + (note || "");
  }

  async function renderNews(el) {
    el.innerHTML = '<div class="empty">뉴스를 불러오는 중…</div>';
    let items = [], note = "";
    try {
      items = await fetchNews();
      note = items.length
        ? '<div style="font-size:.7rem;color:var(--text-3);margin-top:8px">출처: 보안뉴스(boannews.com) — 외부 기사로 연결됩니다.</div>' : "";
      if (!items.length) { el.innerHTML = '<div class="empty">표시할 기사가 없습니다.</div>'; return; }
    } catch (e) {
      const c = loadCache(); // 네트워크 실패 시 만료된 캐시라도 표시
      if (c && c.items.length) {
        items = c.items;
        note = '<div style="font-size:.7rem;color:var(--text-3);margin-top:8px">⚠ 갱신 실패 — 이전에 저장된 기사입니다.</div>';
      } else {
        el.innerHTML = '<div class="empty">뉴스를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>';
        return;
      }
    }
    // 카테고리 필터 (카드 헤더의 전체/항공/화물/사이버 버튼)
    let cat = "all";
    paintNews(el, items, cat, note);
    const card = el.closest ? el.closest(".card") : null;
    if (card) $$("[data-news-cat]", card).forEach(b => b.onclick = () => {
      cat = b.dataset.newsCat;
      $$("[data-news-cat]", card).forEach(x => x.classList.toggle("on", x === b));
      paintNews(el, items, cat, note);
    });

    // 60분마다 자동 갱신 (대시보드가 열려 있는 동안, 필터 상태 유지)
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      if (!el.isConnected) { clearInterval(refreshTimer); refreshTimer = null; return; } // 화면 이탈 시 정리
      try {
        items = await fetchNews(); // 캐시 TTL(30분) 경과 → 서버 재수집
        note = '<div style="font-size:.7rem;color:var(--text-3);margin-top:8px">출처: 보안뉴스(boannews.com) — 외부 기사로 연결됩니다.</div>';
        paintNews(el, items, cat, note);
      } catch (e) { /* 실패 시 기존 표시 유지, 다음 주기 재시도 */ }
    }, REFRESH_MS);
  }

  /* ─────────── 항공보안 인사이트 (교육·홍보, 정적) ─────────── */
  const LEVELS = [
    { l: "평시", c: "badge-green",  d: "일상적 보안활동 유지" },
    { l: "관심", c: "badge-blue",   d: "위협 가능성 인지 · 주의 깊은 관찰" },
    { l: "주의", c: "badge-amber",  d: "위협 징후 구체화 · 검색 강화" },
    { l: "경계", c: "badge-orange", d: "위협 가능성 농후 · 비상대응 준비" },
    { l: "심각", c: "badge-red",    d: "위협 발생 확실시 · 최고 수준 대응" }
  ];
  const ITEMS_RULES = [
    { i: "🔪", n: "칼 · 가위 등 날카로운 물품", cab: "no",  hold: "ok" },
    { i: "💧", n: "액체류 100ml 초과 (국제선)", cab: "no",  hold: "ok" },
    { i: "🔋", n: "리튬 보조배터리",            cab: "ok",  hold: "no" },
    { i: "🧨", n: "폭발물 · 인화성 물질",        cab: "no",  hold: "no" },
    { i: "⚡", n: "전자충격기 · 호신용품",       cab: "no",  hold: "cond" },
    { i: "🔫", n: "총기류 (수렵 · 스포츠)",      cab: "no",  hold: "cond" }
  ];
  const OKX = { ok: ["badge-green", "가능"], no: ["badge-red", "불가"], cond: ["badge-amber", "신고 후"] };
  const STEPS = [
    ["🪪", "신분증 · 탑승권 확인"],
    ["🧳", "휴대품 X-ray 검색"],
    ["🚪", "문형금속탐지기 통과"],
    ["🧤", "필요시 정밀검색 · 폭발물흔적탐지(ETD)"],
    ["✅", "보안구역 진입"]
  ];

  const PANELS = {
    level: () => `
      <div style="font-size:.78rem;color:var(--text-2);margin-bottom:8px">국가 항공보안등급은 위협 수준에 따라 5단계로 운영됩니다.</div>
      ${LEVELS.map((x, i) => `<div class="ins-lvrow">
        <span class="ins-lvbar"><span style="width:${(i + 1) * 20}%" class="ins-lvfill lv-${i + 1}"></span></span>
        <span class="badge ${x.c}" style="flex-shrink:0;min-width:44px;text-align:center">${x.l}</span>
        <span class="ins-lvdesc">${x.d}</span>
      </div>`).join("")}`,
    items: () => `
      <div style="font-size:.78rem;color:var(--text-2);margin-bottom:8px">항공기 반입 제한 물품 — 기내 휴대 / 위탁수하물 기준</div>
      <div class="ins-itemgrid">${ITEMS_RULES.map(x => `<div class="ins-item">
        <span class="ins-item-ico">${x.i}</span>
        <span class="ins-item-name">${x.n}</span>
        <span class="ins-item-tags">
          <span class="badge ${OKX[x.cab][0]}">기내 ${OKX[x.cab][1]}</span>
          <span class="badge ${OKX[x.hold][0]}">위탁 ${OKX[x.hold][1]}</span>
        </span>
      </div>`).join("")}</div>
      <div style="font-size:.7rem;color:var(--text-3);margin-top:6px">※ 세부 기준은 항공사·노선별로 다를 수 있습니다. 자세한 내용은 항공보안 담당 부서로 문의하세요.</div>`,
    steps: () => `
      <div style="font-size:.78rem;color:var(--text-2);margin-bottom:8px">보안검색은 승객과 항공기의 안전을 지키는 필수 절차입니다.</div>
      ${STEPS.map((s, i) => `<div class="ins-step">
        <span class="ins-step-no">${i + 1}</span><span class="ins-step-ico">${s[0]}</span><span>${s[1]}</span>
      </div>${i < STEPS.length - 1 ? '<div class="ins-step-arrow">▼</div>' : ""}`).join("")}`,
    liquid: () => `
      <div style="font-size:.78rem;color:var(--text-2);margin-bottom:8px">국제선 기내 액체류 반입 규정 (3-1-1 규칙)</div>
      <div class="ins-liqgrid">
        <div class="ins-liq"><b>100㎖</b><span>용기 1개당<br>100㎖ 이하</span></div>
        <div class="ins-liq"><b>1L</b><span>투명 지퍼백<br>1L 이하 1매</span></div>
        <div class="ins-liq"><b>1인 1개</b><span>지퍼백은<br>1인당 1개만</span></div>
      </div>
      <div style="font-size:.7rem;color:var(--text-3);margin-top:8px">※ 면세품(STEB 밀봉), 유아식·의약품은 신고 시 예외가 인정될 수 있습니다.</div>`
  };
  const TABS = [["level", "보안등급"], ["items", "반입물품"], ["steps", "검색절차"], ["liquid", "액체류"]];

  function renderInsight(el) {
    el.innerHTML = `
      <div class="ins-tabs">${TABS.map(([k, n], i) =>
        `<button class="ins-tab${i === 0 ? " on" : ""}" data-ins-tab="${k}">${n}</button>`).join("")}</div>
      <div id="ins-panel">${PANELS.level()}</div>`;
    $$("[data-ins-tab]", el).forEach(b => b.onclick = () => {
      $$(".ins-tab", el).forEach(x => x.classList.toggle("on", x === b));
      const p = el.querySelector("#ins-panel");
      if (p) p.innerHTML = PANELS[b.dataset.insTab]();
    });
  }

  window.SemisNews = { renderNews, renderInsight, fetchNews, REFRESH_MS };
})();
