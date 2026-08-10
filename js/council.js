/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 보안장비 협의회 회의록 모듈 (v2.26)
   인천화물터미널 B동 보안검색장비(X-ray·ETD 등) 관리 협의회.
   KPI 과제 C6-1「내부 보안 관리 체계 보완」의 '보안장비 협의체 신설'
   활동 기반. 월 1회 정기 개최 — 제조사/유지보수/운영사/본사 참석.

   일반 회의록 포맷(참석자·안건·논의·결정) + 협의회 특화 3대 안건:
     1. 최근 고장/수리/유지보수 사례 근본원인
     2. 장비 사용환경 개선 방안
     3. 분야별 제안 및 토의

   데이터: DATA.council = [{ id, round(회차), date, time, place,
     chair(주재), scribe(작성),
     attendees:[{ cat(구분), org(소속), name(성명), role(직책), sign(서명URL) }],
       — v2.30: 참석자 자가등록. 서명 화면에서 본인이 이름·소속·직책 입력 후 서명.
         구분(cat)은 소속에서 자동 매핑(orgToCat). 관리자 사전등록도 병행 가능.
     agenda(안건),
     cases:[{ equip(장비), symptom(증상), cause(근본원인), action(조치) }],
     env(사용환경 개선), proposals(제안·토의),
     actions:[{ task(내용), owner(담당), due(기한), done(완료) }],
     nextPlan(차기),
     files:[{url,name,size}](최대 20), by, updated }]
   접근: manager 이상 열람(vis=mgr) / hq 이상 편집(canEdit)

   v2.42 — 회의 중 활용:
     ① 사례표 채우는 3단계 — 자동(기간 일괄) / 반자동(이력 조회·선택) / 수동(직접 작성)
     ② 회의록 상세·편집폼의 CARES 연동 사례(🔗)를 누르면 원본 고장이력을 겹쳐 띄운다.
       모두 본 모달을 파괴하지 않는 보조 오버레이(openSub)로 동작한다.
     ③ 불러온 사례는 '요약'으로 들어간다(briefText) — 표가 산만해지지 않게. 전문은 🔗.
     ④ ⛶ 넓게 보기(prefFull) — 상세·수정 화면을 min(1500px,96vw)로 넓히고
       사례 행을 표처럼 한 줄로 펼친다. 기기별로 기억한다.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* 참석자 구분 (거버넌스 이해관계자) */
  const CATS = ["제조사", "유지보수", "운영자", "본사", "기타"];
  // 운영사(구값)는 운영자로 취급 — 기존 데이터 하위호환
  const CAT_BADGE = { "제조사": "badge-blue", "유지보수": "badge-green", "운영자": "badge-orange", "운영사": "badge-orange", "본사": "badge-red", "기타": "badge-gray" };
  const catNorm = (c) => (c === "운영사" ? "운영자" : (c || ""));
  const CAT_HINT = "제조사=뉴원S&T·인씨스 등 / 유지보수=프로에스콤 등 / 운영자=화물터미널 / 본사=항공화물·항공보안파트";

  const DEFAULT_PLACE = "인천화물터미널 B동";

  /* v2.30: 서명 자가등록 — 소속 기본 선택지 + 소속→구분 자동 매핑 */
  const ORG_PRESETS = ["항공보안파트", "인천화물팀", "프로에스콤", "인씨스", "뉴원에스엔티", "AAP", "국가기관"];
  const ORG_CAT = { "항공보안파트": "본사", "인천화물팀": "운영자", "프로에스콤": "유지보수", "인씨스": "유지보수", "뉴원에스엔티": "제조사", "AAP": "운영자", "국가기관": "기타" };
  function orgToCat(org) {
    const o = String(org || "").trim();
    if (!o) return "기타";
    if (ORG_CAT[o]) return ORG_CAT[o];
    const c = o.replace(/\s+/g, "").toLowerCase();
    if (c.indexOf("항공보안") >= 0 || c.indexOf("본사") >= 0) return "본사";
    if (c.indexOf("화물") >= 0 || c.indexOf("aap") >= 0) return "운영자";
    if (c.indexOf("프로에스콤") >= 0 || c.indexOf("인씨스") >= 0) return "유지보수";
    if (c.indexOf("뉴원") >= 0) return "제조사";
    return "기타";
  }

  /* 첨부 제약 (branches 교육현황과 동일) */
  const MAX_FILES = 20;
  const FILE_MAX = 20 * 1024 * 1024;   // 20MB

  const all = () => (Array.isArray(D().council) ? D().council : []);
  const sorted = () => all().slice().sort((a, b) =>
    (Number(b.round) || 0) - (Number(a.round) || 0) ||
    String(b.date || "").localeCompare(String(a.date || "")) ||
    String(b.id || "").localeCompare(String(a.id || "")));
  const nextRound = () => (all().reduce((mx, x) => Math.max(mx, Number(x.round) || 0), 0) + 1);
  const canWrite = () => SeMIS.canEdit();
  const canSeeKpi = () => SeMIS.roleRank() >= 3;

  const nl2br = (s) => esc(String(s || "")).replace(/\n/g, "<br>");
  const meetTitle = (x) => (x.round ? "제" + x.round + "차 " : "") + "보안장비 협의회";

  /* ─── ⛶ 넓게 보기 (기기별 기억) — 회의록 상세·수정 화면 공용 ───
     기본 모달 폭(780px)은 사례표·참석자표를 담기에 좁다. 켜면 .modal-box.full
     (min(1500px, 96vw))로 넓어지고 사례 행이 표처럼 한 줄로 펼쳐진다. */
  const LS_FULL = "semis2:cnFull";
  const prefFull = () => { try { return localStorage.getItem(LS_FULL) === "1"; } catch (e) { return false; } };
  const setPrefFull = (v) => { try { localStorage.setItem(LS_FULL, v ? "1" : "0"); } catch (e) {} };
  const fullBtnHTML = '<span class="mn-formbar"><button type="button" class="btn btn-ghost btn-sm" id="cn-fullsw"></button></span>';
  function wireFull() {
    const box = document.getElementById("modal-box");
    const b = document.getElementById("cn-fullsw");
    const apply = (on) => {
      if (box) box.classList.toggle("full", !!on);
      if (b) {
        b.textContent = on ? "⤡ 기본 폭" : "⛶ 넓게 보기";
        b.title = on ? "기본 폭으로 되돌립니다." : "화면을 넓게 써서 보고 편집합니다. (이 기기에 기억됩니다)";
      }
    };
    apply(prefFull());
    if (b) b.onclick = () => { const on = !(box && box.classList.contains("full")); setPrefFull(on); apply(on); };
  }

  /* ─── 리치 텍스트(링크·이미지 붙여넣기) 공용 — 공지 에디터 인프라 재사용 ─── */
  const sanitize = (h) => (window.SemisNotice ? window.SemisNotice.sanitizeHtml(h) : esc(h));
  const hasRich = (html, text) => !!(text && text.trim()) || /<(img|table|a|ul|ol|li)\b/i.test(html || "");
  /* 읽기: html 있으면 살균 렌더(.notice-html), 없으면 텍스트 줄바꿈 */
  const richView = (html, text) => html
    ? `<div class="cn-text cn-rich notice-html">${sanitize(html)}</div>`
    : (text ? `<div class="cn-text">${nl2br(text)}</div>` : "");
  /* 편집 폼: 미니 툴바 + contenteditable 에디터 HTML */
  const richFieldHTML = (key, labelHTML, ph, labelCls) => `
        <div class="form-row"><label class="${labelCls || ""}">${labelHTML}</label>
          <div class="nb-toolbar nb-mini" data-rich-tb="${key}">
            <button type="button" data-cmd="bold" title="굵게"><b>B</b></button>
            <button type="button" data-cmd="insertUnorderedList" title="글머리 목록">•—</button>
            <button type="button" data-rich-link="${key}" title="링크">🔗 링크</button>
            <button type="button" data-rich-img="${key}" title="이미지">🖼 이미지</button>
            <button type="button" data-rich-file="${key}" title="파일">📎 파일</button>
          </div>
          <div id="cn-${key}" class="nb-editor nb-rich" contenteditable="true" data-ph="${esc(ph || "")}"></div>
          <input type="file" id="cn-${key}-img" accept="image/*" style="display:none">
          <input type="file" id="cn-${key}-file" style="display:none" multiple></div>`;
  /* 에디터에 초기값 주입 + 툴바/붙여넣기 배선 */
  /* 저장된 값 → 에디터. html 이 비었는데 평문에 마크업이 있으면 서식으로 해석
     (세미 AI의 agenda_append 등은 text 만 채우므로 그대로 esc 하면 태그가 글자로 굳는다) */
  const looksHtml = (s) => !!(window.SemisNotice && window.SemisNotice.looksLikeHtml
    ? window.SemisNotice.looksLikeHtml(s) : false);
  function initialRich(html, text) {
    if (html) return html;
    if (!text) return "";
    return looksHtml(text) ? sanitize(text) : esc(text).replace(/\n/g, "<br>");
  }
  function wireRich(key, html, text) {
    const ed = $("#cn-" + key);
    if (!ed) return;
    ed.innerHTML = initialRich(html, text);
    const rich = window.SemisNotice ? window.SemisNotice.wireRichMedia(ed, "council") : null;
    $$(`[data-rich-tb="${key}"] [data-cmd]`).forEach(b => {
      b.onmousedown = (ev) => ev.preventDefault();
      b.onclick = () => { ed.focus(); try { document.execCommand(b.dataset.cmd); } catch (e) {} };
    });
    const linkBtn = $(`[data-rich-link="${key}"]`);
    if (linkBtn) linkBtn.onclick = () => {
      let url = ""; try { url = window.prompt("링크 주소(URL)", "https://") || ""; } catch (e) {}
      url = url.trim();
      if (!/^https?:\/\/.+/.test(url)) { if (url) toast("http:// 또는 https:// 로 시작하는 주소를 입력하세요.", true); return; }
      let label = ""; try { label = window.prompt("링크에 표시할 제목 (비우면 주소가 그대로 표시됩니다)", "") || ""; } catch (e) {}
      label = label.trim();
      ed.focus();
      const a = `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label || url)}</a>&nbsp;`;
      if (rich) rich.insert(a);
      else { try { document.execCommand("insertHTML", false, a); } catch (e) { ed.innerHTML += a; } }
    };
    const imgBtn = $(`[data-rich-img="${key}"]`), imgFile = $("#cn-" + key + "-img");
    if (imgBtn) imgBtn.onclick = () => imgFile.click();
    if (imgFile) imgFile.onchange = (ev) => { if (rich) rich.addFiles(ev.target.files); ev.target.value = ""; };
    const fileBtn = $(`[data-rich-file="${key}"]`), anyFile = $("#cn-" + key + "-file");
    if (fileBtn) fileBtn.onclick = () => anyFile.click();
    if (anyFile) anyFile.onchange = (ev) => { if (rich) rich.addFiles(ev.target.files); ev.target.value = ""; };
  }
  /* 저장: 에디터 → { html(살균·내용없으면 빈문자), text } */
  function richOut(key) {
    const ed = $("#cn-" + key);
    if (!ed) return { html: "", text: "" };
    const html = sanitize(ed.innerHTML);
    const tmp = document.createElement("div"); tmp.innerHTML = html;
    const text = (tmp.textContent || "").replace(/\u00A0/g, " ").trim();
    return { html: hasRich(html, text) ? html : "", text };
  }

  /* 클립보드 복사 (구형 브라우저 폴백 포함) */
  function copyText(t) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t); return; } } catch (e) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    } catch (e) {}
  }
  /* scope 내 [data-copy] 요소를 복사 버튼으로 배선 */
  function wireCopies(scope) {
    $$((scope || "") + " [data-copy]").forEach(el => el.onclick = (ev) => {
      ev.preventDefault();
      copyText(el.dataset.copy);
      toast("복사되었습니다: " + (el.dataset.copyLabel || el.dataset.copy));
    });
  }
  /* 본문 링크 뒤에 📋 복사 버튼 삽입 (긴 URL도 제목만 보이고 주소는 복사) */
  function decorateLinks(scope) {
    $$((scope || "") + " .cn-rich a[href]").forEach(a => {
      const nx = a.nextSibling;
      if (nx && nx.classList && nx.classList.contains("cn-link-copy")) return;
      const href = a.getAttribute("href") || "";
      if (!href) return;
      a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener");
      const b = document.createElement("button");
      b.type = "button"; b.className = "cn-link-copy"; b.title = "링크 주소 복사";
      b.textContent = "📋"; b.dataset.copy = href; b.dataset.copyLabel = "링크 주소";
      if (a.parentNode) a.parentNode.insertBefore(b, a.nextSibling);
    });
  }

  /* ══════════ 참석자 서명 QR (v2.40) ══════════
     회의별 6자리 코드는 그대로 두고, 같은 코드를 담은 접속 주소를 QR로도 제공.
     휴대폰에서 주소를 타이핑할 필요 없이 카메라로 스캔하면 서명 화면이 열린다. */
  function qrSvg(text, px) {
    if (!window.SemisQR) return "";
    try { return SemisQR.svg(text, { size: px || 132, ecc: "M", margin: 3 }); }
    catch (e) { return ""; }
  }
  function signBoxHTML(x) {
    const code = SeMIS.signCodeFor(x), url = SeMIS.signUrlFor(x);
    const qr = qrSvg(url, 132);
    return `<div class="mn-signbox">
      <div class="mn-qr">${qr || '<div class="mn-qr-na">QR 생성 불가</div>'}</div>
      <div class="mn-signbox-body">
        <div class="mn-signbox-h">📱 참석자 서명 안내</div>
        <ol class="mn-signbox-steps">
          <li>휴대폰 <b>카메라</b>로 왼쪽 QR을 비추면 서명 화면이 바로 열립니다.</li>
          <li>QR이 안 될 때는 <b>semis.pe.kr</b> 접속 후 암호 <b class="cn-signcode-code">${esc(code)}</b> 입력.</li>
          <li>명단에서 본인 이름을 선택(없으면 직접 입력)하고 소속·직책 확인 후 서명 — 사전등록은 필수가 아닙니다.</li>
        </ol>
        <div class="mn-signbox-act">
          <span class="cn-signcode-copy" data-copy="${esc(code)}" title="코드 복사">📋 코드 복사</span>
          <span class="cn-signcode-copy" data-copy="${esc(url)}" data-copy-label="접속 주소" title="주소 복사">🔗 주소 복사</span>
          <button class="btn btn-ghost btn-sm" id="cn-qr-print">🖨 QR 안내문 인쇄</button>
        </div>
      </div></div>`;
  }
  /* QR 안내문 A4 인쇄 — 회의록 게시판 모듈의 공용 인쇄 화면을 재사용 */
  function printQrSheet(x) {
    if (!window.SemisMinutes || !SemisMinutes.printQrSheet) { toast("QR 안내문을 열 수 없습니다.", true); return; }
    SemisMinutes.printQrSheet(null, {
      rec: x, url: SeMIS.signUrlFor(x), code: SeMIS.signCodeFor(x),
      title: meetTitle(x),
      sub: ["보안장비 협의회", x.date, x.time, x.place].filter(Boolean).join(" · ")
    });
  }

  /* ══════════ CARES 고장·수리 이력 동기화 ══════════ */
  const CAUSE_SHORT = { environmental: "환경", mechanical: "기계", human: "인적", other: "기타" };
  const pad2 = (n) => String(n).padStart(2, "0");
  const CASE_KEYS = ["date", "equip", "symptom", "cause", "action"];
  function msToDate(ms) {
    if (!ms) return "";
    const d = new Date(Number(ms));
    return isNaN(d.getTime()) ? "" : d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  /* ── 사례표는 '요약'으로 채운다 ──
     회의록 사례표는 회의 중 한눈에 훑는 표이므로 CARES 원문을 그대로 옮기면 금방 산만해진다.
     한 줄로 펴고 문장 경계에서 잘라 넣되, 전문은 🔗(원본 상세)에서 언제든 볼 수 있다.
     사용자가 직접 고친 내용은 여기서 다루지 않는다(길이 제한 없음). */
  const CASE_LIMIT = { symptom: 42, cause: 54, action: 52 };
  const oneLine = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  function briefText(s, max) {
    const t = oneLine(s);
    if (!t || t.length <= max) return t;
    const head = t.slice(0, max + 1);
    /* ① 제한 안에 들어오는 마지막 문장 종결 지점에서 끊는다 (너무 짧으면 무시) */
    let end = -1;
    for (let i = 0; i < head.length; i++) if (/[.!?。]/.test(head.charAt(i))) end = i;
    if (end >= Math.floor(max * 0.3)) return head.slice(0, end + 1).trim();
    /* ② 문장부호가 없으면 단어 경계에서 끊고 말줄임 */
    const sp = head.lastIndexOf(" ");
    const cut = (sp >= Math.floor(max * 0.6)) ? head.slice(0, sp) : t.slice(0, max);
    return cut.replace(/[\s,·、(\[]+$/, "") + "…";
  }
  /* CARES repairLog → 사례 필드(발생일·장비·증상·근본원인·조치) */
  function repairToCase(r) {
    const date = msToDate(r.reportedAtMs) || (r.reportedAt ? String(r.reportedAt).slice(0, 10) : "");
    const equip = oneLine(r.equipmentName || r.equipmentSerial);
    const symptom = briefText(r.symptom, CASE_LIMIT.symptom);
    const cat = CAUSE_SHORT[r.causeCategory] || "";
    /* 원인 분류 표식은 잘리면 안 되므로 본문만 줄이고 뒤에 붙인다 */
    const base = briefText(r.rootCause || r.cause, CASE_LIMIT.cause - (cat ? 5 : 0));
    const cause = base + (cat ? (base ? " " : "") + "[" + cat + "]" : "");
    const pl = (Array.isArray(r.parts) ? r.parts : []).map(p => {
      const nm = oneLine(p && p.part); const q = (p && Number(p.qty)) || 0;
      return nm ? nm + (q > 1 ? "×" + q : "") : "";
    }).filter(Boolean);
    const parts = pl.slice(0, 2).join(", ") + (pl.length > 2 ? " 외 " + (pl.length - 2) : "");
    const stLabel = r.resolvedAtMs ? "수리완료"
      : (r.status === "in_repair" ? "수리중" : (r.status === "accepted" ? "접수됨" : "접수대기"));
    const action = briefText([r.resolvedBy ? "처리: " + oneLine(r.resolvedBy) : "", stLabel,
      parts ? "부품: " + parts : ""].filter(Boolean).join(" · "), CASE_LIMIT.action);
    return { date, equip, symptom, cause, action };
  }
  const caseUnedited = (c) => {
    const s = c.caresSnap || {};
    return CASE_KEYS.every(k => String(c[k] || "").trim() === String(s[k] || "").trim());
  };
  /* 병합: caresId로 연동 — 미편집분만 CARES 최신값으로 갱신, 사용자 수정분 보존, 신규 추가 */
  function mergeCaresIntoCases(cases, repairs) {
    let added = 0, updated = 0, kept = 0;
    repairs.forEach(r => {
      if (!r || !r.id) return;
      const derived = repairToCase(r);
      const ex = cases.find(c => c && c.caresId === r.id);
      if (ex) {
        if (caseUnedited(ex)) { Object.assign(ex, derived); ex.caresSnap = Object.assign({}, derived); updated++; }
        else kept++;
      } else {
        cases.push(Object.assign({}, derived, { caresId: r.id, caresSnap: Object.assign({}, derived) }));
        added++;
      }
    });
    return { added, updated, kept };
  }
  /* 이번 회의 직전 회의의 회의일(없으면 null) */
  function prevMeetingDate(thisDate, excludeId) {
    const ds = all().filter(c => c && c.id !== excludeId && c.date && c.date < thisDate)
      .map(c => c.date).sort();
    return ds.length ? ds[ds.length - 1] : null;
  }
  /* 기간(이전 회의일 초과 ~ 이번 회의일 이하)에 발생한 고장 필터 */
  function repairsInPeriod(repairs, prevDate, thisDate) {
    return (repairs || []).filter(r => {
      const d = msToDate(r.reportedAtMs) || (r.reportedAt ? String(r.reportedAt).slice(0, 10) : "");
      if (!d || d > thisDate) return false;
      if (prevDate && d <= prevDate) return false;
      return true;
    });
  }
  const repDate = (r) => msToDate(r && r.reportedAtMs) || ((r && r.reportedAt) ? String(r.reportedAt).slice(0, 10) : "");
  function nextDay(d) {
    if (!d) return "";
    const t = new Date(String(d) + "T00:00:00");
    if (isNaN(t.getTime())) return d;
    t.setDate(t.getDate() + 1);
    return t.getFullYear() + "-" + pad2(t.getMonth() + 1) + "-" + pad2(t.getDate());
  }

  /* ══════════ 보조 오버레이 (본 모달 위에 겹치는 독립 레이어) ══════════
     회의 중 활용 목적 — 편집 폼이나 회의록 상세를 그대로 둔 채 CARES 자료를
     열람·선택한다. 앱 모달(#modal-overlay, z-index 500)은 한 겹만 지원하므로
     carcap.pickRisk 와 같은 방식(modal-overlay 재사용 + z-index 상향)을 쓰되,
     피커 → 상세처럼 여러 겹을 쌓을 수 있도록 스택으로 관리한다. */
  const subStack = [];
  function subEsc(ev) {
    if (ev.key !== "Escape" || !subStack.length) return;
    ev.stopPropagation(); ev.preventDefault(); closeSub();
  }
  function openSub(html, opts) {
    opts = opts || {};
    const ov = document.createElement("div");
    ov.className = "modal-overlay cn-sub-ov";
    ov.style.zIndex = String(600 + subStack.length * 2);
    ov.innerHTML = `<div class="modal-box wide ${opts.cls || ""}">${html}</div>`;
    document.body.appendChild(ov);
    ov.addEventListener("mousedown", (ev2) => { if (ev2.target === ov) closeSub(); });
    if (!subStack.length && typeof document.addEventListener === "function") document.addEventListener("keydown", subEsc, true);
    subStack.push(ov);
    return ov;
  }
  function closeSub() {
    const ov = subStack.pop();
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    if (!subStack.length) { try { document.removeEventListener("keydown", subEsc, true); } catch (e) {} }
  }
  function closeAllSub() { while (subStack.length) closeSub(); }
  const subAlive = (ov) => !!(ov && document.body && document.body.contains(ov));
  const subBox = (ov) => ov.querySelector(".modal-box");

  /* ══════════ CARES 고장이력 — 표시 라벨 / 서식 ══════════ */
  const RS_LABEL = { reported: "접수 대기", accepted: "접수됨", in_repair: "수리중", resolved: "수리 완료" };
  const RS_CLS = { reported: "badge-red", accepted: "badge-amber", in_repair: "badge-blue", resolved: "badge-green" };
  const CAUSE_LABEL = { environmental: "환경적 요인", mechanical: "기계적 결함", human: "인적 오류", other: "기타/복합" };
  const CAUSE_CLS = { environmental: "badge-blue", mechanical: "badge-purple", human: "badge-orange", other: "badge-gray" };
  const HANDLING_LABEL = { manufacturer: "제작사 수리", internal: "자체 점검" };
  const CARES_URL = "https://airzeta-security-system.web.app";
  /* CARES 규약과 동일: 신고 → 접수 → 수리중 → 완료 */
  const repStatus = (r) => (r && r.resolvedAtMs) ? "resolved"
    : ((r && r.status && RS_LABEL[r.status] && r.status !== "resolved") ? r.status : "reported");
  function fmtDT(ms, s) {
    if (ms) {
      const d = new Date(Number(ms));
      if (!isNaN(d.getTime())) return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
        + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    }
    return s ? String(s) : "";
  }
  function fmtDur(ms) {
    const n = Number(ms);
    if (!n || n < 0) return "";
    const m = Math.floor(n / 60000);
    if (m < 60) return m + "분";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "시간" + (m % 60 ? " " + (m % 60) + "분" : "");
    return Math.floor(h / 24) + "일" + (h % 24 ? " " + (h % 24) + "시간" : "");
  }

  /* CARES 이력 로드 (실패 시 사유 문자열 반환) */
  async function fetchCares(force) {
    if (!window.SemisEquipment || !SemisEquipment.loadCares) throw new Error("CARES 연동을 사용할 수 없습니다.");
    const c = await SemisEquipment.loadCares(!!force);
    if (c && c.err) throw new Error(c.err);
    return c || { repairs: [] };
  }

  /* ══════════ 고장이력 상세 (원본 열람 — 회의 중 참고) ══════════ */
  function repairHTML(r, o) {
    o = o || {};
    if (!r) {
      const c = o.fallbackCase || {};
      const hasSnap = c.date || c.equip || c.symptom || c.cause || c.action;
      return `<h3>🔧 고장이력 상세</h3>
        <div class="cn-rd-warn">${esc(o.err || "CARES 원본을 찾을 수 없습니다.")}</div>
        ${hasSnap ? `<div class="form-hint" style="margin-bottom:6px">회의록에 저장된 사례 내용입니다.</div>
        <table class="tbl cn-rd-tbl">
          <tr><td class="cn-rd-k">발생일</td><td>${esc(c.date || "-")}</td></tr>
          <tr><td class="cn-rd-k">장비</td><td>${esc(c.equip || "-")}</td></tr>
          <tr><td class="cn-rd-k">증상</td><td>${nl2br(c.symptom)}</td></tr>
          <tr><td class="cn-rd-k">근본원인</td><td>${nl2br(c.cause)}</td></tr>
          <tr><td class="cn-rd-k">조치</td><td>${nl2br(c.action)}</td></tr>
        </table>` : ""}
        <div class="modal-actions">
          <a class="btn btn-ghost" href="${CARES_URL}" target="_blank" rel="noopener">CARES 열기 ↗</a>
          <button type="button" class="btn btn-primary cn-rd-close">닫기</button></div>`;
    }
    const st = repStatus(r);
    const parts = Array.isArray(r.parts) ? r.parts : [];
    const dur = r.resolvedAtMs && r.reportedAtMs ? fmtDur(r.resolvedAtMs - r.reportedAtMs) : "";
    const row = (k, v, sub) => v ? `<tr><td class="cn-rd-k">${k}</td><td>${v}${sub ? `<span class="cn-rd-sub">${sub}</span>` : ""}</td></tr>` : "";
    const cc = r.causeCategory || "";
    const nPhoto = (Number(r.reportPhotoCount) || (r.reportPhotos || []).length) + (Number(r.repairPhotoCount) || (r.repairPhotos || []).length);
    return `<h3>🔧 ${esc(r.equipmentName || "장비 미상")} <span class="badge ${RS_CLS[st]}">${RS_LABEL[st]}</span></h3>
      <div class="cn-rd-meta">
        ${r.equipmentSerial ? `<span>S/N ${esc(r.equipmentSerial)}</span>` : ""}
        <span>${esc(HANDLING_LABEL[r.handlingType === "internal" ? "internal" : "manufacturer"])}</span>
        ${r.reporter ? `<span>신고 ${esc(r.reporter)}</span>` : ""}
        <span class="cn-rd-src">CARES 원본</span>
      </div>
      <table class="tbl cn-rd-tbl">
        ${row("고장 발생", esc(fmtDT(r.occurredAtMs, r.occurredAt)))}
        ${row("신고 접수", esc(fmtDT(r.reportedAtMs, r.reportedAt)), r.reportDelayMs ? "발생 후 " + fmtDur(r.reportDelayMs) : "")}
        ${row("접수 처리", esc(fmtDT(r.acceptedAtMs, r.acceptedAt)), r.acceptedBy ? esc(r.acceptedBy) : "")}
        ${row("수리 시작", esc(fmtDT(r.repairStartedAtMs, r.repairStartedAt)), r.repairStartedBy ? esc(r.repairStartedBy) : "")}
        ${row("수리 완료", esc(fmtDT(r.resolvedAtMs, r.resolvedAt)), [r.resolvedBy ? esc(r.resolvedBy) : "", dur ? "소요 " + dur : ""].filter(Boolean).join(" · "))}
      </table>
      <div class="cn-rd-sec"><b>증상</b><div class="cn-text">${nl2br(r.symptom) || '<span style="color:var(--text-3)">-</span>'}</div></div>
      <div class="cn-rd-sec"><b>원인 분석</b>
        <div>${cc && CAUSE_LABEL[cc] ? `<span class="badge ${CAUSE_CLS[cc] || "badge-gray"}">${CAUSE_LABEL[cc]}</span> ` : '<span class="badge badge-gray">미분류</span> '}</div>
        <div class="cn-text">${nl2br(r.rootCause) || '<span style="color:var(--text-3)">근본원인 미기재</span>'}</div>
        ${r.cause && r.cause !== r.rootCause ? `<div class="cn-text" style="color:var(--text-2)">${nl2br(r.cause)}</div>` : ""}</div>
      <div class="cn-rd-sec"><b>교체·사용 부품</b>
        ${parts.length ? `<table class="tbl cn-rd-parts"><thead><tr><th>부품</th><th style="width:70px">수량</th><th style="width:80px">비용</th></tr></thead><tbody>
          ${parts.map(p => `<tr><td>${esc((p && p.part) || "-")}</td><td>${esc(String((p && p.qty) || 1))}</td>
            <td>${p && p.isPaid ? '<span class="badge badge-amber">유상</span>' : '<span class="badge badge-green">무상</span>'}</td></tr>`).join("")}
        </tbody></table>` : '<div class="form-hint">기록된 부품이 없습니다.</div>'}</div>
      ${nPhoto ? `<div class="form-hint" style="margin-top:8px">📷 사진 ${nPhoto}장 — CARES에서 확인</div>` : ""}
      ${r.editedBy ? `<div class="form-hint" style="margin-top:8px">최근 수정 ${esc(String(r.editedAt || "").slice(0, 16))} · ${esc(r.editedBy)}${r.editCount ? " (누적 " + esc(String(r.editCount)) + "회)" : ""}</div>` : ""}
      <div class="modal-actions">
        <a class="btn btn-ghost" href="${CARES_URL}" target="_blank" rel="noopener" style="margin-right:auto">CARES 열기 ↗</a>
        ${o.onPick ? '<button type="button" class="btn btn-primary cn-rd-pick">이 사례 불러오기</button>' : ""}
        <button type="button" class="btn ${o.onPick ? "btn-ghost" : "btn-primary"} cn-rd-close">닫기</button>
      </div>`;
  }
  function paintRepair(ov, r, o) {
    if (!subAlive(ov)) return;
    o = o || {};
    subBox(ov).innerHTML = repairHTML(r, o);
    const cl = ov.querySelector(".cn-rd-close");
    if (cl) cl.onclick = closeSub;
    const pk = ov.querySelector(".cn-rd-pick");
    if (pk) pk.onclick = () => { closeSub(); o.onPick(r); };
  }
  /* 이미 로드된 이력 객체로 즉시 열기 */
  function openRepair(r, o) {
    const ov = openSub("", { cls: "cn-rd-box" });
    paintRepair(ov, r, o);
    return ov;
  }
  /* caresId 로 CARES에서 원본을 찾아 열기 (실패 시 회의록 저장분 표시) */
  function openRepairById(id, fallbackCase) {
    const ov = openSub(`<h3>🔧 고장이력 상세</h3>
      <div class="form-hint cn-rd-loading">CARES에서 원본 이력을 불러오는 중…</div>
      <div class="modal-actions"><button type="button" class="btn btn-primary cn-rd-close">닫기</button></div>`, { cls: "cn-rd-box" });
    ov.querySelector(".cn-rd-close").onclick = closeSub;
    (async () => {
      let r = null, err = null;
      try {
        const c = await fetchCares(false);
        r = ((c && c.repairs) || []).find(x => x && x.id === id) || null;
        if (!r) err = "CARES 최근 고장이력에서 해당 건을 찾지 못했습니다.";
      } catch (e) { err = "CARES 조회 실패: " + ((e && e.message) || "네트워크 확인"); }
      paintRepair(ov, r, { err, fallbackCase });
    })();
    return ov;
  }

  /* ══════════ CARES 고장이력 조회·선택 (반자동 불러오기) ══════════
     기간 일괄 불러오기(자동)와 사례 직접 작성(수동) 사이의 중간 단계.
     전체 이력을 필터로 좁혀 눈으로 확인하고 필요한 건만 골라 담는다.
     onPick 없이 열면 읽기 전용 — 회의 진행 중 원본 자료 열람 용도. */
  function caresPicker(opts) {
    opts = opts || {};
    const pick = typeof opts.onPick === "function";
    const existing = new Set((opts.existing || []).filter(Boolean));
    const def = { from: opts.from || "", to: opts.to || "" };
    const f = { from: def.from, to: def.to, equip: "", st: "", cause: "", q: "" };
    const sel = new Set();
    let repairs = [];

    const ov = openSub(`<h3>🔍 CARES 고장이력 ${pick ? "조회·선택" : "조회"}</h3>
      <div class="form-hint cn-pk-loading">CARES 고장이력을 불러오는 중…</div>
      <div class="modal-actions"><button type="button" class="btn btn-primary cn-pk-close">닫기</button></div>`,
      { cls: "cn-pk-box" });
    ov.querySelector(".cn-pk-close").onclick = closeSub;

    (async () => {
      let err = null;
      try { repairs = (await fetchCares(false)).repairs || []; }
      catch (e) { err = "CARES 조회 실패: " + ((e && e.message) || "네트워크 확인"); }
      if (!subAlive(ov)) return;
      if (err) {
        subBox(ov).innerHTML = `<h3>🔍 CARES 고장이력</h3><div class="cn-rd-warn">${esc(err)}</div>
          <div class="modal-actions"><button type="button" class="btn btn-primary cn-pk-close">닫기</button></div>`;
        ov.querySelector(".cn-pk-close").onclick = closeSub;
        return;
      }
      paintShell();
    })();

    function equipNames() {
      return Array.from(new Set(repairs.map(r => String((r && r.equipmentName) || "").trim()).filter(Boolean))).sort();
    }
    function match(r) {
      const d = repDate(r);
      if (f.from && (!d || d < f.from)) return false;
      if (f.to && (!d || d > f.to)) return false;
      if (f.equip && String(r.equipmentName || "").trim() !== f.equip) return false;
      if (f.st && repStatus(r) !== f.st) return false;
      if (f.cause) {
        const cc = String(r.causeCategory || "");
        if (f.cause === "__none" ? !!cc : cc !== f.cause) return false;
      }
      if (f.q) {
        const hay = [r.equipmentName, r.equipmentSerial, r.symptom, r.rootCause, r.cause, r.reporter, r.resolvedBy]
          .map(v => String(v || "")).join(" ").toLowerCase();
        if (hay.indexOf(f.q.toLowerCase()) < 0) return false;
      }
      return true;
    }
    const visible = () => repairs.filter(match)
      .sort((a, b) => (Number(b.reportedAtMs) || 0) - (Number(a.reportedAtMs) || 0));

    function paintShell() {
      subBox(ov).innerHTML = `<h3>🔍 CARES 고장이력 ${pick ? "조회·선택" : "조회"}</h3>
        <div class="form-hint" style="margin-bottom:8px">${pick
          ? "필요한 사례만 골라 회의록 ① 사례표로 가져옵니다. 행을 누르면 원본 상세를 볼 수 있습니다."
          : "회의 진행 중 참고용입니다. 행을 누르면 원본 상세를 볼 수 있습니다."}</div>
        <div class="cn-pk-filter">
          <input type="date" class="cn-pk-from" value="${esc(f.from)}" title="시작일">
          <span class="cn-pk-sep">~</span>
          <input type="date" class="cn-pk-to" value="${esc(f.to)}" title="종료일">
          ${(def.from || def.to) ? '<button type="button" class="btn btn-ghost btn-sm cn-pk-period">이번 회의 기간</button>' : ""}
          <button type="button" class="btn btn-ghost btn-sm cn-pk-allp">전체 기간</button>
          <select class="cn-pk-equip"><option value="">장비 전체</option>
            ${equipNames().map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("")}</select>
          <select class="cn-pk-st"><option value="">상태 전체</option>
            ${Object.keys(RS_LABEL).map(k => `<option value="${k}">${RS_LABEL[k]}</option>`).join("")}</select>
          <select class="cn-pk-cause"><option value="">원인 전체</option>
            ${Object.keys(CAUSE_LABEL).map(k => `<option value="${k}">${CAUSE_LABEL[k]}</option>`).join("")}
            <option value="__none">미분류</option></select>
          <input class="cn-pk-q" placeholder="증상·원인·담당자 검색" maxlength="40">
          <button type="button" class="btn btn-ghost btn-sm cn-pk-reset">초기화</button>
        </div>
        <div class="cn-pk-scroll"><div class="cn-pk-body"></div></div>
        <div class="modal-actions">
          <span class="cn-pk-count" style="margin-right:auto"></span>
          <button type="button" class="btn ${pick ? "btn-ghost" : "btn-primary"} cn-pk-close">닫기</button>
          ${pick ? '<button type="button" class="btn btn-primary cn-pk-ok">선택 항목 불러오기</button>' : ""}
        </div>`;
      const on = (s, ev, fn) => { const el = ov.querySelector(s); if (el) el.addEventListener(ev, fn); };
      on(".cn-pk-from", "change", (e) => { f.from = e.target.value; paintRows(); });
      on(".cn-pk-to", "change", (e) => { f.to = e.target.value; paintRows(); });
      on(".cn-pk-equip", "change", (e) => { f.equip = e.target.value; paintRows(); });
      on(".cn-pk-st", "change", (e) => { f.st = e.target.value; paintRows(); });
      on(".cn-pk-cause", "change", (e) => { f.cause = e.target.value; paintRows(); });
      on(".cn-pk-q", "input", (e) => { f.q = e.target.value; paintRows(); });
      on(".cn-pk-period", "click", () => { f.from = def.from; f.to = def.to; syncFilterUI(); paintRows(); });
      on(".cn-pk-allp", "click", () => { f.from = ""; f.to = ""; syncFilterUI(); paintRows(); });
      on(".cn-pk-reset", "click", () => {
        f.from = def.from; f.to = def.to; f.equip = ""; f.st = ""; f.cause = ""; f.q = "";
        syncFilterUI(); paintRows();
      });
      ov.querySelector(".cn-pk-close").onclick = closeSub;
      const okBtn = ov.querySelector(".cn-pk-ok");
      if (okBtn) okBtn.onclick = () => {
        const chosen = repairs.filter(r => r && sel.has(r.id));
        if (!chosen.length) { toast("불러올 사례를 선택하세요.", true); return; }
        closeSub();
        opts.onPick(chosen);
      };
      paintRows();
    }
    function syncFilterUI() {
      const set = (s, v) => { const el = ov.querySelector(s); if (el) el.value = v; };
      set(".cn-pk-from", f.from); set(".cn-pk-to", f.to); set(".cn-pk-equip", f.equip);
      set(".cn-pk-st", f.st); set(".cn-pk-cause", f.cause); set(".cn-pk-q", f.q);
    }
    function paintRows() {
      const rows = visible();
      const body = ov.querySelector(".cn-pk-body");
      if (!body) return;
      if (!rows.length) {
        body.innerHTML = '<div class="empty" style="padding:24px">조건에 맞는 고장이력이 없습니다.</div>';
      } else {
        body.innerHTML = `<table class="tbl cn-pk-tbl"><thead><tr>
            ${pick ? '<th style="width:38px"><input type="checkbox" class="cn-pk-all" title="표시된 항목 전체 선택"></th>' : ""}
            <th style="width:104px">발생일</th><th style="width:150px">장비</th>
            <th>증상 / 근본원인</th><th style="width:88px">원인</th><th style="width:88px">상태</th>
            <th style="width:64px"></th></tr></thead><tbody>
          ${rows.map(r => {
            const st = repStatus(r);
            const cc = String(r.causeCategory || "");
            const dup = existing.has(r.id);
            return `<tr class="cn-pk-row${sel.has(r.id) ? " on" : ""}" data-rid="${esc(r.id)}">
              ${pick ? `<td>${dup
                ? '<span class="cn-pk-dup" title="이미 회의록에 있는 사례">✓</span>'
                : `<input type="checkbox" class="cn-pk-ck" data-rid="${esc(r.id)}"${sel.has(r.id) ? " checked" : ""}>`}</td>` : ""}
              <td class="cn-nowrap">${esc(repDate(r) || "-")}</td>
              <td><b>${esc(r.equipmentName || "-")}</b>${dup ? '<div class="cn-pk-duptx">회의록에 추가됨</div>' : ""}</td>
              <td><div class="cn-pk-sym">${esc(r.symptom || "-")}</div>
                ${r.rootCause ? `<div class="cn-pk-rc">${esc(r.rootCause)}</div>` : ""}</td>
              <td>${cc && CAUSE_LABEL[cc] ? `<span class="badge ${CAUSE_CLS[cc] || "badge-gray"}">${CAUSE_SHORT[cc] || CAUSE_LABEL[cc]}</span>` : '<span style="color:var(--text-3)">-</span>'}</td>
              <td><span class="badge ${RS_CLS[st]}">${RS_LABEL[st]}</span></td>
              <td><button type="button" class="btn btn-ghost btn-sm cn-pk-view" data-rid="${esc(r.id)}" title="원본 상세 보기">상세</button></td>
            </tr>`;
          }).join("")}
        </tbody></table>`;
      }
      /* 체크박스 = 선택 / 그 외 클릭 = 상세 열람 */
      Array.prototype.forEach.call(ov.querySelectorAll(".cn-pk-ck"), (cb) => {
        cb.onclick = (ev) => { ev.stopPropagation(); };
        cb.onchange = () => {
          if (cb.checked) sel.add(cb.dataset.rid); else sel.delete(cb.dataset.rid);
          const tr = cb.closest ? cb.closest("tr") : null;
          if (tr) tr.classList.toggle("on", cb.checked);
          paintCount();
        };
      });
      const allCk = ov.querySelector(".cn-pk-all");
      if (allCk) {
        /* 다시 그려도 헤더 체크 상태 유지 — 표시분(중복 제외)이 모두 선택됐는지로 판정 */
        const selectable = rows.filter(r => !existing.has(r.id));
        allCk.checked = selectable.length > 0 && selectable.every(r => sel.has(r.id));
      }
      if (allCk) allCk.onchange = () => {
        rows.forEach(r => {
          if (existing.has(r.id)) return;
          if (allCk.checked) sel.add(r.id); else sel.delete(r.id);
        });
        paintRows();
      };
      Array.prototype.forEach.call(ov.querySelectorAll(".cn-pk-view"), (b) => {
        b.onclick = (ev) => { ev.stopPropagation(); openOne(b.dataset.rid); };
      });
      Array.prototype.forEach.call(ov.querySelectorAll(".cn-pk-row"), (tr) => {
        tr.addEventListener("click", (ev) => {
          const t = ev.target;
          if (t && t.classList && (t.classList.contains("cn-pk-ck") || t.classList.contains("cn-pk-view"))) return;
          openOne(tr.dataset.rid);
        });
      });
      paintCount();
    }
    function openOne(id) {
      const r = repairs.find(x => x && x.id === id);
      if (!r) return;
      openRepair(r, (pick && !existing.has(id)) ? { onPick: (one) => { closeSub(); opts.onPick([one]); } } : {});
    }
    function paintCount() {
      const el = ov.querySelector(".cn-pk-count");
      if (!el) return;
      const n = visible().length;
      el.textContent = "전체 " + repairs.length + "건 · 표시 " + n + "건" + (pick ? " · 선택 " + sel.size + "건" : "");
      const ok = ov.querySelector(".cn-pk-ok");
      if (ok) ok.textContent = sel.size ? "선택 " + sel.size + "건 불러오기" : "선택 항목 불러오기";
    }
    return ov;
  }

  function stats() {
    const items = all();
    const yr = new Date().getFullYear();
    const thisYear = items.filter(x => String(x.date || "").slice(0, 4) === String(yr)).length;
    const cases = items.reduce((s, x) => s + ((x.cases || []).length), 0);
    let openAct = 0;
    items.forEach(x => (x.actions || []).forEach(a => { if (!a.done) openAct++; }));
    return { total: items.length, thisYear, cases, openAct, yr };
  }

  /* ══════════ 목록 ══════════ */
  function listHTML() {
    const items = sorted();
    if (!items.length) return '<div class="empty">등록된 회의록이 없습니다.' +
      (canWrite() ? ' 우측 상단 <b>+ 회의록 작성</b>으로 첫 회의를 기록하세요.' : '') + '</div>';
    return `<div class="table-wrap"><table class="tbl cn-list-tbl tbl-cap" style="--cap:1480px"><thead><tr>
        <th style="width:60px">회차</th><th style="width:126px">회의일</th>
        <th style="width:190px;min-width:160px">회의명<span class="col-sub"> / 장소</span></th>
        <th class="col-ext" style="width:140px">장소</th>
        <th class="col-ext" style="width:110px">주재</th>
        <th class="col-ext" style="width:110px">작성</th>
        <th class="col-ext" style="width:150px">최근 수정</th>
        <th style="width:210px">참석</th>
        <th style="width:190px">사례·결정</th><th style="width:56px">첨부</th></tr></thead><tbody>
      ${items.map(x => {
        const att = (x.attendees || []).length;
        const cats = Array.from(new Set((x.attendees || []).map(a => a.cat).filter(Boolean)));
        const nCase = (x.cases || []).length;
        const nAct = (x.actions || []).length;
        const nFile = (x.files || []).length;
        return `<tr data-cn-row="${esc(x.id)}" style="cursor:pointer">
          <td><b>제${esc(String(x.round || "-"))}차</b></td>
          <td style="font-size:.86rem;white-space:nowrap">${x.date ? esc(x.date) : '<span style="color:var(--text-3)">미정</span>'}${x.time ? `<div style="font-size:.74rem;color:var(--text-3)">${esc(x.time)}</div>` : ""}</td>
          <td><b>${esc(meetTitle(x))}</b><div class="col-sub" style="font-size:.76rem;color:var(--text-3)">📍 ${esc(x.place || "-")}</div></td>
          <td class="col-ext" style="font-size:.82rem">${esc(x.place || "-")}</td>
          <td class="col-ext" style="font-size:.82rem">${esc(x.chair || "-")}</td>
          <td class="col-ext" style="font-size:.82rem">${esc(x.scribe || "-")}</td>
          <td class="col-ext" style="font-size:.78rem;color:var(--text-3)">${x.updated ? esc(String(x.updated).slice(0, 10)) + (x.by ? `<div style="font-size:.72rem">${esc(x.by)}</div>` : "") : "-"}</td>
          <td style="font-size:.82rem">${att ? `${att}명` : "-"}${cats.length ? `<div style="margin-top:2px;display:flex;flex-wrap:wrap;gap:2px">${cats.map(c => `<span class="badge ${CAT_BADGE[c] || "badge-gray"}" style="font-size:.66rem">${esc(c)}</span>`).join("")}</div>` : ""}</td>
          <td style="font-size:.82rem">${nCase ? `사례 ${nCase}` : ""}${nCase && nAct ? " · " : ""}${nAct ? `결정 ${nAct}` : ""}${!nCase && !nAct ? "-" : ""}</td>
          <td style="font-size:.82rem">${nFile ? `📎 ${nFile}` : "-"}</td>
        </tr>`; }).join("")}</tbody></table></div>`;
  }

  /* ══════════ 상세 (읽기 전용) ══════════ */
  function detail(id) {
    const x = all().find(c => c.id === id);
    if (!x) return;
    const att = (x.attendees || []);
    const cases = (x.cases || []);
    const acts = (x.actions || []);
    const sec = (title, body) => body ? `<div class="cn-sec"><div class="cn-sec-h">${title}</div>${body}</div>` : "";

    /* 열 폭: 직책은 "책임연구원"·"보안검색감독자" 같은 5~7자를 한 줄에 담아야 하므로
       셀 좌우 패딩(24px)을 감안해 118px. 대신 비고를 고정 폭으로 줄여 총 폭은 그대로 둔다. */
    const attHTML = att.length ? `<table class="tbl cn-att-tbl"><thead><tr>
        <th style="width:46px">No</th><th style="width:88px">구분</th><th style="width:78px">성명</th>
        <th style="width:118px">직책</th><th>소속</th><th style="width:104px">서명</th><th style="width:110px">비고</th></tr></thead><tbody>
      ${att.map((a, i) => `<tr>
        <td class="cn-nowrap" style="text-align:center;color:var(--text-3)">${i + 1}</td>
        <td>${a.cat ? `<span class="badge ${CAT_BADGE[a.cat] || "badge-gray"}">${esc(a.cat)}</span>` : "-"}</td>
        <td>${esc(a.name || "-")}</td><td class="cn-a-role">${esc(a.role || "-")}</td>
        <td>${esc(a.org || "-")}</td>
        <td style="text-align:center">${a.sign ? `<img class="cn-sign-img" src="${esc(a.sign)}" alt="서명">` : '<span style="color:var(--text-3)">-</span>'}</td>
        <td>${a.note ? esc(a.note) : "-"}</td></tr>`).join("")}
      </tbody></table>` : "";

    /* CARES 연동 사례는 행 클릭으로 원본 상세를 겹쳐 띄운다 (회의 중 즉시 참고) */
    const caseTbl = cases.length ? `<table class="tbl cn-case-tbl"><thead><tr>
        <th style="width:12%">발생일</th><th style="width:15%">장비</th><th style="width:16%">증상</th>
        <th style="width:29%">근본원인</th><th style="width:28%">조치</th></tr></thead><tbody>
      ${cases.map((c, i) => `<tr${c.caresId ? ` class="cn-case-clk" data-cn-case="${i}" title="CARES 원본 고장이력 보기"` : ""}>
        <td>${c.date ? esc(c.date) : '<span style="color:var(--text-3)">-</span>'}</td>
        <td><b>${esc(c.equip || "-")}</b>${c.caresId ? ' <span class="cn-cares-tag" title="CARES 고장이력 연동 — 클릭하면 원본을 봅니다">🔗</span>' : ""}</td><td>${nl2br(c.symptom)}</td>
        <td>${nl2br(c.cause)}</td><td>${nl2br(c.action)}</td></tr>`).join("")}
      </tbody></table>` : '<div class="form-hint">등록된 사례가 없습니다.</div>';
    const caseHTML = `<div class="cn-cares-bar" style="margin-bottom:8px">
        <button type="button" class="btn btn-ghost btn-sm" id="cn-view-cares">🔍 CARES 고장이력 조회</button>
        <span class="form-hint">회의 중 원본 이력을 열어 확인할 수 있습니다.</span>
      </div>${caseTbl}`;

    const actHTML = acts.length ? `<table class="tbl cn-act-tbl"><thead><tr>
        <th style="width:40px"></th><th>결정 / 조치 사항</th><th style="width:92px">담당</th><th style="width:116px">기한</th></tr></thead><tbody>
      ${acts.map(a => `<tr class="${a.done ? "cn-act-done" : ""}">
        <td style="text-align:center">${a.done ? "✅" : "⬜"}</td>
        <td>${nl2br(a.task)}</td><td>${esc(a.owner || "-")}</td><td class="cn-nowrap">${esc(a.due || "-")}</td></tr>`).join("")}
      </tbody></table>` : "";

    openModal(`
     <div class="cn-view">
      <h3>🤝 ${esc(meetTitle(x))}${fullBtnHTML}</h3>
      <div class="cn-meta">
        <span>📅 <b>${esc(x.date || "미정")}</b>${x.time ? " " + esc(x.time) : ""}</span>
        <span>📍 ${esc(x.place || "-")}</span>
        ${x.chair ? `<span>🧑‍💼 주재 ${esc(x.chair)}</span>` : ""}
        ${x.scribe ? `<span>✍️ 작성 ${esc(x.scribe)}</span>` : ""}
        <span>👥 참석 ${att.length}명</span>
      </div>
      ${canWrite() ? signBoxHTML(x) : ""}
      ${sec("참석자", attHTML)}
      ${sec("안건", richView(x.agendaHtml, x.agenda))}
      ${sec("① 고장·수리·유지보수 사례 근본원인", caseHTML)}
      ${sec("② 장비 사용환경 개선 방안", richView(x.envHtml, x.env))}
      ${sec("③ 분야별 제안 및 토의", richView(x.proposalsHtml, x.proposals))}
      ${sec("결정사항 / 액션 아이템", actHTML)}
      ${sec("차기 회의", x.nextPlan ? `<div class="cn-text">${nl2br(x.nextPlan)}</div>` : "")}
      ${(x.files || []).length ? `<div class="cn-sec"><div class="cn-sec-h">첨부파일 (${(x.files || []).length})</div>
        <div class="nb-files-view br-files-scroll">${(x.files || []).map(f =>
          `<a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">📄 ${esc(f.name)}</a>`).join("")}</div></div>` : ""}
      ${x.updated ? `<div class="form-hint" style="margin-top:10px">최종 수정 ${esc(String(x.updated).slice(0, 10))}${x.by ? " · " + esc(x.by) : ""}</div>` : ""}
      <div class="modal-actions">
        ${SeMIS.canDelete() ? '<button class="btn btn-danger" id="cn-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="cn-print">🖨 인쇄</button>
        ${canWrite() ? '<button class="btn btn-ghost" id="cn-edit">✎ 수정</button>' : ""}
        <button class="btn btn-primary" id="cn-close">닫기</button>
      </div>
     </div>`, { wide: true });

    wireFull();
    $("#cn-close").onclick = () => { closeAllSub(); closeModal(); };
    $("#cn-print").onclick = () => printMinutes(x.id);
    if ($("#cn-qr-print")) $("#cn-qr-print").onclick = () => printQrSheet(x);
    /* 회의 중 참고 — 사례 행 클릭 = CARES 원본 / 버튼 = 전체 이력 조회 */
    $$("#modal-box [data-cn-case]").forEach(el => el.onclick = () => {
      const c = cases[Number(el.dataset.cnCase)];
      if (c && c.caresId) openRepairById(c.caresId, c);
    });
    if ($("#cn-view-cares")) $("#cn-view-cares").onclick = () => caresPicker({
      from: prevMeetingDate(x.date || "9999-12-31", x.id) ? nextDay(prevMeetingDate(x.date || "9999-12-31", x.id)) : "",
      to: x.date || ""
    });
    decorateLinks("#modal-box");  // 본문 링크 뒤 📋 복사 버튼 삽입
    wireCopies("#modal-box");     // 서명 코드 복사 + 본문 링크 복사 버튼 배선
    if (canWrite()) {
      $("#cn-edit").onclick = () => form(x.id);
      if ($("#cn-del")) $("#cn-del").onclick = () => confirmModal(`"${meetTitle(x)}" 회의록을 삭제하시겠습니까?`, () => {
        D().council = all().filter(c => c.id !== x.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    }
  }

  /* ══════════ 등록/수정 폼 (hq+) ══════════ */
  function form(id) {
    const x = id ? all().find(c => c.id === id) : null;
    let attendees = x ? (x.attendees || []).map(a => Object.assign({}, a, { cat: catNorm(a.cat) })) : [];
    let cases = x ? (x.cases || []).map(c => Object.assign({}, c)) : [];
    let actions = x ? (x.actions || []).map(a => Object.assign({}, a)) : [];
    let files = x ? (x.files || []).map(f => Object.assign({}, f)) : [];

    openModal(`
     <div class="cn-form">
      <h3>${x ? "회의록 수정" : "회의록 작성"} <span class="badge badge-gray">보안장비 협의회</span>${fullBtnHTML}</h3>

      <fieldset class="cn-fs"><legend>📋 회의 정보</legend>
        <div class="form-grid">
          <div class="form-row"><label>회차</label>
            <input id="cn-round" type="number" min="1" max="999" value="${esc(x ? x.round || "" : nextRound())}"></div>
          <div class="form-row"><label>회의일</label>
            <input id="cn-date" type="date" value="${esc(x ? x.date || "" : "")}"></div>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>시간 (선택)</label>
            <input id="cn-time" value="${esc(x ? x.time || "" : "")}" maxlength="40" placeholder="예: 14:00~16:00"></div>
          <div class="form-row"><label>장소</label>
            <input id="cn-place" value="${esc(x ? x.place || "" : DEFAULT_PLACE)}" maxlength="80"></div>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>주재 (의장)</label>
            <input id="cn-chair" value="${esc(x ? x.chair || "" : "")}" maxlength="40" placeholder="예: 최상일 프로"></div>
          <div class="form-row"><label>작성자 (서기)</label>
            <input id="cn-scribe" value="${esc(x ? x.scribe || "" : "")}" maxlength="40"></div>
        </div>
      </fieldset>

      <fieldset class="cn-fs"><legend>👥 참석자</legend>
        <div class="form-hint" style="margin:0 0 8px">${CAT_HINT}</div>
        <div id="cn-att"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="cn-att-add" style="margin-top:6px">+ 참석자 추가</button>
      </fieldset>

      <fieldset class="cn-fs"><legend>🗣 협의 안건</legend>
        <div class="form-hint" style="margin:0 0 8px">본문에는 링크·이미지를 붙여넣거나 드래그앤드롭으로 넣을 수 있습니다.</div>
        ${richFieldHTML("agenda", "안건 (선택)", "이번 회의 안건 (한 줄에 하나씩)")}
        <div class="form-row"><label class="cn-flabel">① 고장·수리·유지보수 사례 근본원인</label>
          <div class="cn-cares-bar">
            <button type="button" class="btn btn-ghost btn-sm" id="cn-cares-sync">🔄 CARES 고장이력 불러오기</button>
            <button type="button" class="btn btn-ghost btn-sm" id="cn-cares-pick">🔍 이력에서 골라 담기</button>
            <span class="form-hint" id="cn-cares-hint" style="display:inline"></span>
          </div>
          <div id="cn-cases"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="cn-case-add" style="margin-top:6px">+ 사례 추가</button></div>
        ${richFieldHTML("env", "② 장비 사용환경 개선 방안", "온·습도·먼지 등 사용환경 개선 논의 및 방안", "cn-flabel")}
        ${richFieldHTML("proposals", "③ 분야별 제안 및 토의", "제조사·유지보수·운영사·본사 각 분야 제안 및 토의 내용", "cn-flabel")}
      </fieldset>

      <fieldset class="cn-fs"><legend>✅ 결정 및 차기</legend>
        <div class="form-row"><label>결정사항 / 액션 아이템</label>
          <div id="cn-acts"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="cn-act-add" style="margin-top:6px">+ 결정사항 추가</button></div>
        <div class="form-row"><label>차기 회의 (선택)</label>
          <input id="cn-next" value="${esc(x ? x.nextPlan || "" : "")}" maxlength="200" placeholder="예: 2026-08-20 / 부품 교체주기 데이터 검토"></div>
      </fieldset>

      <fieldset class="cn-fs"><legend>📎 첨부파일</legend>
        <div class="form-hint" style="margin:0 0 8px">회의자료·사진 등 · 최대 ${MAX_FILES}개 · 각 20MB 이하</div>
        <div id="cn-dropzone" class="br-dropzone">📎 파일을 이곳에 끌어다 놓거나 <u>클릭하여 선택</u>하세요
          <input type="file" id="cn-file" multiple style="display:none"></div>
        <div id="cn-file-box" class="nb-files-view br-files-scroll"></div>
      </fieldset>

      <div class="modal-actions">
        ${x && SeMIS.canDelete() ? '<button class="btn btn-danger" id="cn-fdel" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="cn-cancel">취소</button>
        <button class="btn btn-primary" id="cn-save">저장</button>
      </div>
     </div>`, { wide: true });

    wireFull();
    /* ─ 본문 리치 에디터(안건·②·③) 초기값 주입 + 배선 ─ */
    wireRich("agenda", x ? x.agendaHtml : "", x ? x.agenda : "");
    wireRich("env", x ? x.envHtml : "", x ? x.env : "");
    wireRich("proposals", x ? x.proposalsHtml : "", x ? x.proposals : "");

    /* ─ 참석자 동적행 ─ */
    function attCollect() {
      $$("#cn-att .cn-att-row").forEach((row, i) => {
        attendees[i].cat = row.querySelector(".cn-a-cat").value;
        attendees[i].org = row.querySelector(".cn-a-org").value;
        attendees[i].name = row.querySelector(".cn-a-name").value;
        attendees[i].role = row.querySelector(".cn-a-role").value;
        attendees[i].note = row.querySelector(".cn-a-note").value;
      });
    }
    function attPaint() {
      $("#cn-att").innerHTML = attendees.map((a, i) => `
        <div class="cn-att-row">
          <span class="cn-a-no">${i + 1}</span>
          <select class="cn-a-cat">${CATS.map(c => `<option ${(a.cat || "제조사") === c ? "selected" : ""}>${c}</option>`).join("")}</select>
          <input class="cn-a-org" value="${esc(a.org || "")}" maxlength="40" placeholder="소속">
          <input class="cn-a-name" value="${esc(a.name || "")}" maxlength="24" placeholder="성명">
          <input class="cn-a-role" value="${esc(a.role || "")}" maxlength="24" placeholder="직책">
          <input class="cn-a-note" value="${esc(a.note || "")}" maxlength="40" placeholder="비고 (선택)">
          <button type="button" class="mt-btn danger" data-att-del="${i}" title="삭제">✕</button>
        </div>`).join("") || '<span class="form-hint">참석자를 추가하세요.</span>';
      $$("#cn-att [data-att-del]").forEach(btn => btn.onclick = () => {
        attCollect(); attendees.splice(Number(btn.dataset.attDel), 1); attPaint();
      });
    }
    attPaint();
    $("#cn-att-add").onclick = () => { attCollect(); attendees.push({ cat: "제조사", org: "", name: "", role: "", note: "", sign: "" }); attPaint(); };

    /* ─ 사례 동적행 ─ */
    function caseCollect() {
      $$("#cn-cases .cn-case-row").forEach((row, i) => {
        cases[i].date = row.querySelector(".cn-c-date").value;
        cases[i].equip = row.querySelector(".cn-c-equip").value;
        cases[i].symptom = row.querySelector(".cn-c-symptom").value;
        cases[i].cause = row.querySelector(".cn-c-cause").value;
        cases[i].action = row.querySelector(".cn-c-action").value;
      });
    }
    /* 사례 행 — 기본은 3줄 카드(발생일·장비 / 증상·근본원인 / 조치),
       ⛶ 넓게 보기에서는 표처럼 한 줄로 펼쳐진다(.modal-box.full CSS). */
    function casePaint() {
      $("#cn-cases").innerHTML = cases.length ? `
        <div class="cn-case-head"><span>발생일</span><span>장비</span><span>증상</span>
          <span>근본원인</span><span>조치 / 대책</span><span></span></div>
        ${cases.map((c, i) => `
        <div class="cn-case-row${c.caresId ? " cn-case-linked" : ""}">
          <input class="cn-c-date" value="${esc(c.date || "")}" maxlength="20" placeholder="발생일">
          <input class="cn-c-equip" value="${esc(c.equip || "")}" maxlength="40" placeholder="장비 (예: ETD 3호기)">
          <input class="cn-c-symptom" value="${esc(c.symptom || "")}" maxlength="120" placeholder="증상 (예: 잦은 알람 오류)">
          <input class="cn-c-cause" value="${esc(c.cause || "")}" maxlength="200" placeholder="근본원인 (예: 멤브레인 노즐 오염)">
          <input class="cn-c-action" value="${esc(c.action || "")}" maxlength="200" placeholder="조치 / 대책">
          <span class="cn-case-btns">
            ${c.caresId ? `<button type="button" class="mt-btn" data-case-cares="${i}" title="CARES 원본 고장이력 보기">🔗</button>` : ""}
            <button type="button" class="mt-btn danger" data-case-del="${i}" title="사례 삭제">✕</button></span>
        </div>`).join("")}` : '<span class="form-hint">고장·수리 사례를 추가하세요.</span>';
      $$("#cn-cases [data-case-del]").forEach(btn => btn.onclick = () => {
        caseCollect(); cases.splice(Number(btn.dataset.caseDel), 1); casePaint();
      });
      $$("#cn-cases [data-case-cares]").forEach(btn => btn.onclick = () => {
        const c = cases[Number(btn.dataset.caseCares)];
        if (c && c.caresId) openRepairById(c.caresId, c);
      });
    }
    casePaint();
    $("#cn-case-add").onclick = () => { caseCollect(); cases.push({ date: "", equip: "", symptom: "", cause: "", action: "" }); casePaint(); };

    /* CARES 고장이력 불러오기 (기간: 이전 회의일 초과 ~ 이번 회의일 이하) */
    function updateCaresHint() {
      const d = $("#cn-date").value;
      const hint = $("#cn-cares-hint");
      if (!hint) return;
      if (!d) { hint.textContent = "회의일 입력 후 사용"; return; }
      const prev = prevMeetingDate(d, x ? x.id : null);
      hint.textContent = "기간: " + (prev ? prev + " 이후" : "처음") + " ~ " + d;
    }
    updateCaresHint();
    if ($("#cn-date")) $("#cn-date").addEventListener("change", updateCaresHint);
    $("#cn-cares-sync").onclick = async () => {
      const thisDate = $("#cn-date").value;
      if (!thisDate) { toast("먼저 회의일을 입력하세요.", true); return; }
      if (!window.SemisEquipment || !SemisEquipment.loadCares) { toast("CARES 연동을 사용할 수 없습니다.", true); return; }
      const btn = $("#cn-cares-sync");
      const orig = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.textContent = "불러오는 중…"; }
      try {
        const c = await SemisEquipment.loadCares(true);
        if (c && c.err) { toast("CARES 조회 실패: " + c.err, true); return; }
        const prev = prevMeetingDate(thisDate, x ? x.id : null);
        const reps = repairsInPeriod((c && c.repairs) || [], prev, thisDate);
        caseCollect();
        if (!reps.length) { toast("해당 기간에 CARES 고장이력이 없습니다 (" + (prev ? prev + " 이후" : "처음") + " ~ " + thisDate + ")."); return; }
        const res = mergeCaresIntoCases(cases, reps);
        casePaint();
        const parts2 = [];
        if (res.added) parts2.push(res.added + "건 추가");
        if (res.updated) parts2.push(res.updated + "건 갱신");
        if (res.kept) parts2.push(res.kept + "건 수정 보존");
        toast("CARES 고장이력: " + (parts2.join(" · ") || "변경 없음"));
      } catch (e) {
        toast("CARES 동기화 오류: " + ((e && e.message) || "네트워크 확인"), true);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = orig; }
      }
    };

    /* 반자동 — 전체 이력을 필터로 훑어보고 필요한 건만 골라 담기 (회의 중 활용) */
    $("#cn-cares-pick").onclick = () => {
      const thisDate = $("#cn-date").value;
      const prev = thisDate ? prevMeetingDate(thisDate, x ? x.id : null) : null;
      caseCollect();
      caresPicker({
        from: prev ? nextDay(prev) : "",
        to: thisDate || "",
        existing: cases.map(c => c && c.caresId).filter(Boolean),
        onPick: (reps) => {
          caseCollect();
          const res = mergeCaresIntoCases(cases, reps);
          casePaint();
          const p = [];
          if (res.added) p.push(res.added + "건 추가");
          if (res.updated) p.push(res.updated + "건 갱신");
          if (res.kept) p.push(res.kept + "건 수정 보존");
          toast("선택한 고장이력: " + (p.join(" · ") || "변경 없음"));
        }
      });
    };

    /* ─ 결정/액션 동적행 ─ */
    function actCollect() {
      $$("#cn-acts .cn-act-row").forEach((row, i) => {
        actions[i].task = row.querySelector(".cn-t-task").value;
        actions[i].owner = row.querySelector(".cn-t-owner").value;
        actions[i].due = row.querySelector(".cn-t-due").value;
        actions[i].done = row.querySelector(".cn-t-done").checked;
      });
    }
    function actPaint() {
      $("#cn-acts").innerHTML = actions.map((a, i) => `
        <div class="cn-act-row">
          <label class="cn-t-donebox" title="완료"><input type="checkbox" class="cn-t-done" ${a.done ? "checked" : ""}></label>
          <input class="cn-t-task" value="${esc(a.task || "")}" maxlength="200" placeholder="결정·조치 사항">
          <input class="cn-t-owner" value="${esc(a.owner || "")}" maxlength="24" placeholder="담당">
          <input class="cn-t-due" type="date" value="${esc(a.due || "")}">
          <button type="button" class="mt-btn danger" data-act-del="${i}" title="삭제">✕</button>
        </div>`).join("") || '<span class="form-hint">결정사항·액션 아이템을 추가하세요.</span>';
      $$("#cn-acts [data-act-del]").forEach(btn => btn.onclick = () => {
        actCollect(); actions.splice(Number(btn.dataset.actDel), 1); actPaint();
      });
    }
    actPaint();
    $("#cn-act-add").onclick = () => { actCollect(); actions.push({ task: "", owner: "", due: "", done: false }); actPaint(); };

    /* ─ 첨부 ─ */
    function renderFiles() {
      $("#cn-file-box").innerHTML = files.length
        ? files.map((f, i) => `<span class="nb-file"><a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>
            <button type="button" class="mt-btn danger" data-cn-frm="${i}" title="첨부 제거">✕</button></span>`).join("")
          + `<span class="form-hint" style="align-self:center">${files.length}/${MAX_FILES}</span>`
        : '<span class="form-hint">첨부된 파일이 없습니다.</span>';
      $$("#cn-file-box [data-cn-frm]").forEach(btn => btn.onclick = () => {
        files.splice(Number(btn.dataset.cnFrm), 1); renderFiles();
      });
    }
    renderFiles();
    async function addFiles(picked) {
      if (!picked || !picked.length) return;
      if (!window.SemisSync || typeof fetch === "undefined") { toast("오프라인에서는 파일을 첨부할 수 없습니다.", true); return; }
      for (const f of picked) {
        if (files.length >= MAX_FILES) { toast("첨부는 최대 " + MAX_FILES + "개까지 가능합니다.", true); break; }
        if ((f.size || 0) > FILE_MAX) { toast(f.name + ": 20MB를 초과합니다.", true); continue; }
        toast("업로드 중: " + f.name);
        try {
          const up = await SemisSync.uploadFile(f, "council");
          files.push({ url: up.url, name: f.name, size: f.size || 0 }); renderFiles();
          toast("업로드되었습니다: " + f.name);
        } catch (err) { toast(f.name + ": 업로드 실패 — 네트워크를 확인하세요.", true); }
      }
    }
    const dz = $("#cn-dropzone"), fi = $("#cn-file");
    dz.onclick = () => fi.click();
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("drag"); };
    dz.ondragleave = () => dz.classList.remove("drag");
    dz.ondrop = (e) => {
      e.preventDefault(); dz.classList.remove("drag");
      addFiles(Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []));
    };
    fi.onchange = (e) => {
      const picked = Array.prototype.slice.call(e.target.files || []);
      e.target.value = ""; addFiles(picked);
    };

    /* ─ 저장/취소/삭제 ─ */
    $("#cn-cancel").onclick = () => { closeAllSub(); return x ? detail(x.id) : (closeModal(), SeMIS.renderView()); };
    if (x && $("#cn-fdel")) $("#cn-fdel").onclick = () => confirmModal(`"${meetTitle(x)}" 회의록을 삭제하시겠습니까?`, () => {
      D().council = all().filter(c => c.id !== x.id);
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
    });
    $("#cn-save").onclick = () => {
      closeAllSub();
      attCollect(); caseCollect(); actCollect();
      const round = Number($("#cn-round").value) || 0;
      const date = $("#cn-date").value;
      if (!round) { toast("회차를 입력하세요.", true); return; }
      if (!date) { toast("회의일을 입력하세요.", true); return; }
      const clean = (arr, keys) => arr.filter(o => keys.some(k => String(o[k] || "").trim() !== ""));
      const ag = richOut("agenda"), en = richOut("env"), pr = richOut("proposals");
      const rec = {
        round, date,
        time: $("#cn-time").value.trim(),
        place: $("#cn-place").value.trim() || DEFAULT_PLACE,
        chair: $("#cn-chair").value.trim(),
        scribe: $("#cn-scribe").value.trim(),
        attendees: clean(attendees, ["org", "name"]).map(a => ({
          cat: a.cat || "기타", org: (a.org || "").trim(), name: (a.name || "").trim(),
          role: (a.role || "").trim(), note: (a.note || "").trim(), sign: a.sign || "" })),
        agenda: ag.text, agendaHtml: ag.html,
        cases: clean(cases, ["date", "equip", "symptom", "cause", "action"]).map(c => {
          const o = { date: (c.date || "").trim(), equip: (c.equip || "").trim(), symptom: (c.symptom || "").trim(),
            cause: (c.cause || "").trim(), action: (c.action || "").trim() };
          if (c.caresId) { o.caresId = c.caresId; o.caresSnap = c.caresSnap || {}; }
          return o;
        }),
        env: en.text, envHtml: en.html,
        proposals: pr.text, proposalsHtml: pr.html,
        actions: clean(actions, ["task"]).map(a => ({
          task: (a.task || "").trim(), owner: (a.owner || "").trim(), due: a.due || "", done: !!a.done })),
        nextPlan: $("#cn-next").value.trim(),
        files: files.slice(0, MAX_FILES),
        by: (SeMIS.user && SeMIS.user.name) || "",
        updated: new Date().toISOString()
      };
      if (x) Object.assign(x, rec);
      else D().council.push(Object.assign({ id: uid("cn") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ══════════ 인쇄 (A4 회의록) ══════════ */
  function printMinutes(id) {
    const x = all().find(c => c.id === id);
    if (!x) return;
    const P = (s) => nl2br(s);
    const att = (x.attendees || []), cases = (x.cases || []), acts = (x.actions || []);
    const today = new Date().toISOString().slice(0, 10);

    const attRows = att.length ? att.map((a, i) => `<tr>
        <td style="text-align:center">${i + 1}</td><td>${esc(a.cat || "-")}</td>
        <td>${esc(a.name || "-")}</td><td class="role">${esc(a.role || "-")}</td>
        <td>${esc(a.org || "-")}</td>
        <td style="text-align:center">${a.sign ? `<img src="${esc(a.sign)}" style="height:26px;max-width:100%">` : ""}</td>
        <td>${esc(a.note || "")}</td></tr>`).join("")
      : '<tr><td colspan="7" class="pc-empty">기록 없음</td></tr>';
    const caseRows = cases.length ? cases.map(c => `<tr>
        <td>${esc(c.date || "")}</td><td><b>${esc(c.equip || "-")}</b></td><td>${P(c.symptom)}</td>
        <td>${P(c.cause)}</td><td>${P(c.action)}</td></tr>`).join("")
      : '<tr><td colspan="5" class="pc-empty">기록 없음</td></tr>';
    const actRows = acts.length ? acts.map(a => `<tr>
        <td style="text-align:center">${a.done ? "✔" : "□"}</td><td>${P(a.task)}</td>
        <td>${esc(a.owner || "-")}</td><td>${esc(a.due || "-")}</td></tr>`).join("")
      : '<tr><td colspan="4" class="pc-empty">기록 없음</td></tr>';
    const textSec = (title, html, text) => {
      const inner = html ? sanitize(html) : (text ? P(text) : "");
      return inner ? `<div class="sec"><div class="sec-h">${title}</div><div class="ptext">${inner}</div></div>` : "";
    };

    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>보안장비 협의회 회의록 · 제${esc(String(x.round || ""))}차</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4 portrait; margin: 14mm 12mm; }
  body { font-family: -apple-system, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif; color: #0f172a; font-size: 10.5px; line-height: 1.55; margin: 0; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .doc-head { border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; margin-bottom: 12px; }
  .doc-head .sub { color: #475569; font-size: 10px; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 10px; color: #334155; margin-top: 8px; }
  .meta b { color: #0f172a; }
  .sec { margin: 12px 0; page-break-inside: avoid; }
  .sec-h { font-size: 11px; font-weight: 800; color: #1d4ed8; border-left: 3px solid #1d4ed8;
    padding: 0 0 3px 6px; margin-bottom: 6px; border-bottom: 1px solid #94a3b8; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #94a3b8; padding: 4px 6px; text-align: left; vertical-align: top; font-size: 9.5px; }
  th { background: #eff6ff; color: #1e3a8a; font-weight: 700; border-bottom: 1.5px solid #64748b; text-align: center; }
  table.att, table.cases { table-layout: fixed; }
  table.att td, table.cases td { word-break: break-word; }
  table.att td.role { word-break: keep-all; overflow-wrap: break-word; }  /* 직책 단어 중간 끊김 방지 */
  table.att td img { display: block; margin: 0 auto; }
  .ptext { border: 1px solid #94a3b8; border-left: 3px solid #1d4ed8; border-radius: 6px; padding: 8px 10px; background: #fff; white-space: normal; }
  .ptext img { max-width: 100%; height: auto; border-radius: 4px; margin: 4px 0; }
  .ptext a { color: #1d4ed8; word-break: break-all; }
  .ptext ul, .ptext ol { margin: 4px 0; padding-left: 18px; }
  .ptext table { border-collapse: collapse; margin: 4px 0; }
  .ptext td, .ptext th { border: 1px solid #cbd5e1; padding: 3px 5px; }
  .pc-empty { color: #94a3b8; text-align: center; }
  .foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 8.5px; color: #64748b; }
</style></head><body>
  <div class="doc-head">
    <h1>보안장비 협의회 회의록 — 제${esc(String(x.round || ""))}차</h1>
    <div class="sub">에어제타 항공보안 · 인천화물터미널 B동 보안검색장비 관리 협의회 (KPI C6-1 기반)</div>
    <div class="meta">
      <span>회의일 <b>${esc(x.date || "-")}</b>${x.time ? " " + esc(x.time) : ""}</span>
      <span>장소 <b>${esc(x.place || "-")}</b></span>
      ${x.chair ? `<span>주재 <b>${esc(x.chair)}</b></span>` : ""}
      ${x.scribe ? `<span>작성 <b>${esc(x.scribe)}</b></span>` : ""}
      <span>참석 <b>${att.length}명</b></span>
    </div>
  </div>
  <div class="sec"><div class="sec-h">참석자</div>
    <table class="att"><thead><tr><th style="width:24px">No</th><th style="width:52px">구분</th>
      <th style="width:60px">성명</th><th style="width:84px">직책</th><th style="width:26%">소속</th>
      <th style="width:74px">서명</th><th>비고</th></tr></thead>
      <tbody>${attRows}</tbody></table></div>
  ${textSec("안건", x.agendaHtml, x.agenda)}
  <div class="sec"><div class="sec-h">① 고장·수리·유지보수 사례 근본원인</div>
    <table class="cases"><thead><tr><th style="width:12%">발생일</th><th style="width:15%">장비</th><th style="width:16%">증상</th>
      <th style="width:29%">근본원인</th><th style="width:28%">조치</th></tr></thead>
      <tbody>${caseRows}</tbody></table></div>
  ${textSec("② 장비 사용환경 개선 방안", x.envHtml, x.env)}
  ${textSec("③ 분야별 제안 및 토의", x.proposalsHtml, x.proposals)}
  <div class="sec"><div class="sec-h">결정사항 / 액션 아이템</div>
    <table><thead><tr><th style="width:34px">완료</th><th>결정·조치 사항</th><th style="width:80px">담당</th><th style="width:84px">기한</th></tr></thead>
      <tbody>${actRows}</tbody></table></div>
  ${textSec("차기 회의", x.nextPlan)}
  <div class="foot">
    <span>에어제타 보안종합정보시스템(SeMIS v2) · 보안장비 협의회</span>
    <span>출력 ${esc(today)}${SeMIS.user ? " · " + esc(SeMIS.user.name) : ""}</span>
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
      if (fr.contentWindow.document.readyState === "complete") setTimeout(fire, 300);
      else fr.onload = () => setTimeout(fire, 300);
      setTimeout(() => { try { fr.remove(); } catch (e) { /* 무시 */ } }, 60000);
    } catch (e) { toast("인쇄 대화상자를 열 수 없습니다.", true); }
  }

  /* ══════════ 서명 모드 (모바일 참석자) ══════════ */
  /* 회의별 6자리 코드로 로그인한 참석자 화면 (v2.30 자가등록):
     - 명단(사전등록·기존 서명자)에 있으면 → 본인 선택 → 정보 확인·수정 → 서명
     - 명단에 없으면 → [직접 입력 후 서명] → 이름·소속·직책 입력(이전 참석 이력 있으면 이름 선택 시 자동 채움) → 서명
     v2.31: 회차 선택 — 코드 재입력 없이 지난 회의 명단 열람, 본인 항목 수정(정보만 저장 시 서명 유지) */

  let signViewId = null;   // 서명 세션에서 현재 열람 중인 회차 (null=코드로 접속한 회의)

  /* 전 회의 참석 이력 디렉터리 — 같은 이름은 최신(회의일) 기록 우선 */
  function knownPeople() {
    const dir = new Map();
    all().slice().sort((x, y) =>
      String(y.date || "").localeCompare(String(x.date || "")) ||
      (Number(y.round) || 0) - (Number(x.round) || 0))
      .forEach(mm => (mm.attendees || []).forEach(a => {
        const nm = String(a.name || "").trim();
        if (!nm || dir.has(nm)) return;
        dir.set(nm, { name: nm, cat: catNorm(a.cat) || orgToCat(a.org), org: String(a.org || "").trim(), role: String(a.role || "").trim() });
      }));
    return dir;
  }

  /* 지난 회의(현재 회의 제외·이후 회의 제외)의 동명 참석 행 순회 */
  function forEachPastEntry(meetingId, name, fn) {
    const nm = String(name || "").trim();
    if (!nm) return;
    const cur = all().find(c => c.id === meetingId);
    const curDate = cur ? String(cur.date || "") : "";
    all().forEach(mm => {
      if (!mm || mm.id === meetingId) return;
      if (curDate && String(mm.date || "") > curDate) return; // 이후 회의 제외
      (mm.attendees || []).forEach(a => { if (String(a.name || "").trim() === nm) fn(a, mm); });
    });
  }

  /* 지난 회의 명단에 소속·직책·구분 일괄 반영 (서명은 건드리지 않음) */
  function propagatePersonInfo(meetingId, name, rec) {
    let n = 0;
    forEachPastEntry(meetingId, name, (a) => { a.cat = rec.cat; a.org = rec.org; a.role = rec.role; n++; });
    if (n) SeMIS.save();
    return n;
  }

  /* 서명+정보 저장 — 최신 상태 재조회 후 반영. idx<0(신규)이면 동명 기존 행에 병합, 없으면 추가 */
  function saveSignEntry(meetingId, idx, person, signVal, alsoPast) {
    const m = all().find(c => c.id === meetingId);
    if (!m) return false;
    if (!Array.isArray(m.attendees)) m.attendees = [];
    const nm = String(person.name || "").trim();
    if (!nm) return false;
    const rec = { cat: person.cat || orgToCat(person.org), org: String(person.org || "").trim(), name: nm, role: String(person.role || "").trim() };
    let i = idx;
    if (i < 0) i = m.attendees.findIndex(a => String(a.name || "").trim() === nm);
    if (i >= 0 && m.attendees[i]) Object.assign(m.attendees[i], rec, signVal ? { sign: signVal } : {});
    else m.attendees.push(Object.assign({ note: "", sign: signVal || "" }, rec));
    if (alsoPast) propagatePersonInfo(meetingId, nm, rec);
    SeMIS.save();
    return true;
  }

  function renderSigning(root, meetingId) {
    const m = all().find(c => c.id === meetingId);
    if (!m) { root.innerHTML = '<div class="empty">회의 정보를 찾을 수 없습니다. 진행자에게 문의하세요.</div>'; return; }
    const homeId = (SeMIS.user && SeMIS.user.signMeetingId) || meetingId;
    const isPast = m.id !== homeId;
    const atts = m.attendees || [];
    const signed = atts.filter(a => a.sign).length;
    root.innerHTML = `
      <div class="cn-sign-page">
        <div class="cn-sign-head">
          <div class="cn-sign-title">🤝 ${esc(meetTitle(m))} · 참석 서명</div>
          <div class="cn-sign-meta">📅 ${esc(m.date || "")}${m.time ? " " + esc(m.time) : ""} · 📍 ${esc(m.place || "")}</div>
        </div>
        <div class="cn-sign-switch">
          <label for="cn-sign-meet">📖 회차 선택</label>
          <select id="cn-sign-meet">${sorted().map(c =>
            `<option value="${esc(c.id)}"${c.id === m.id ? " selected" : ""}>제${esc(String(c.round || "?"))}차 · ${esc(c.date || "날짜 미정")}${c.id === homeId ? " — 이번 서명 회의" : ""}</option>`).join("")}</select>
          ${isPast ? '<button class="btn btn-ghost btn-sm" id="cn-sign-home">↩ 이번 회의로</button>' : ""}
        </div>
        <div class="cn-sign-guide">${isPast
          ? "🕓 <b>지난 회의 명단</b>입니다 — 본인 이름을 눌러 소속·직책을 수정하거나 누락된 서명을 추가할 수 있습니다."
          : "명단에서 <b>본인 이름</b>을 찾아 <b>[서명하기]</b> → 소속·직책 확인 후 서명해 주세요.<br>명단에 없으면 아래 <b>[직접 입력 후 서명]</b>으로 등록합니다."} <span class="cn-sign-count">${signed}/${atts.length}명 완료</span></div>
        <div class="cn-sign-list">
          ${atts.length ? atts.map((a, i) => `
            <div class="cn-sign-item${a.sign ? " done" : ""}">
              <div class="cn-sign-who">
                <b>${esc(a.name || "(이름 미입력)")}</b>
                <span class="cn-sign-sub">${a.cat ? `<span class="badge ${CAT_BADGE[a.cat] || "badge-gray"}">${esc(a.cat)}</span> ` : ""}${esc(a.org || "")}${a.role ? " · " + esc(a.role) : ""}</span>
              </div>
              <div class="cn-sign-act">
                ${a.sign
                  ? `<img class="cn-sign-thumb" src="${esc(a.sign)}" alt="서명"><span class="cn-sign-ok">✅ 완료</span><button class="btn btn-ghost btn-sm" data-sign="${i}">다시</button>`
                  : `<button class="btn btn-primary btn-sm" data-sign="${i}">✍️ 서명하기</button>`}
              </div>
            </div>`).join("") : '<div class="empty">아직 등록된 참석자가 없습니다. 아래 버튼으로 본인 정보를 입력하고 서명해 주세요.</div>'}
        </div>
        <button class="btn btn-ghost cn-sign-addbtn" id="cn-sign-new">➕ 명단에 없어요 — 직접 입력 후 서명</button>
        <div class="cn-sign-foot">서명은 저장 즉시 반영됩니다. 완료 후 창을 닫으셔도 됩니다.</div>
      </div>`;
    $$(".cn-sign-list [data-sign]").forEach(btn => btn.onclick = () => personModal(meetingId, Number(btn.dataset.sign)));
    $("#cn-sign-new").onclick = () => personModal(meetingId, -1);
    const sel = $("#cn-sign-meet");
    if (sel) sel.onchange = () => { signViewId = sel.value === homeId ? null : sel.value; SeMIS.renderView(); };
    const hm = $("#cn-sign-home");
    if (hm) hm.onclick = () => { signViewId = null; SeMIS.renderView(); };
  }

  /* 본인 정보 확인·입력 모달 — idx>=0: 명단의 본인(확인·수정), idx<0: 미등록자 직접 입력 */
  function personModal(meetingId, idx) {
    const m = all().find(c => c.id === meetingId);
    if (!m) return;
    const a = (idx >= 0 && Array.isArray(m.attendees)) ? m.attendees[idx] : null;
    if (idx >= 0 && !a) return;
    const dir = knownPeople();
    const init = a
      ? { name: String(a.name || ""), org: String(a.org || ""), role: String(a.role || ""), cat: catNorm(a.cat) || orgToCat(a.org) }
      : { name: "", org: "", role: "", cat: "" };
    const orgOpts = ORG_PRESETS.slice();
    dir.forEach(p => { if (p.org && orgOpts.indexOf(p.org) < 0) orgOpts.push(p.org); });
    if (init.org && orgOpts.indexOf(init.org) < 0) orgOpts.push(init.org);
    openModal(`
      <h3>✍️ 참석 서명${idx < 0 ? " — 참석자 등록" : ""}</h3>
      <div class="form-hint" style="margin-bottom:10px">${idx >= 0
        ? "아래 정보를 확인하고, 바뀐 내용이 있으면 수정한 뒤 서명을 진행해 주세요."
        : "본인 이름을 입력하고 소속·직책을 입력해 주세요. 이전에 참석한 적이 있으면 이름 선택 시 자동으로 채워집니다."}</div>
      <div class="form-row"><label>성명 *</label>
        <input id="cn-sp-name" value="${esc(init.name)}" maxlength="40" autocomplete="off"${idx < 0 ? ' list="cn-sp-names" placeholder="이름 입력 또는 선택"' : ""}>
        ${idx < 0 ? `<datalist id="cn-sp-names">${[...dir.values()].map(p =>
          `<option value="${esc(p.name)}">${esc(p.org || "")}${p.role ? " · " + esc(p.role) : ""}</option>`).join("")}</datalist>` : ""}</div>
      <div class="form-row"><label>소속 *</label>
        <select id="cn-sp-org">
          <option value="">선택하세요</option>
          ${orgOpts.map(o => `<option value="${esc(o)}"${o === init.org ? " selected" : ""}>${esc(o)}</option>`).join("")}
          <option value="__etc__">직접 입력…</option>
        </select>
        <input id="cn-sp-org-etc" maxlength="60" placeholder="소속 직접 입력" style="display:none;margin-top:6px"></div>
      <div class="form-row"><label>직책</label>
        <input id="cn-sp-role" value="${esc(init.role)}" maxlength="40" placeholder="예: 과장 / 팀장"></div>
      <div class="form-row"><label>구분</label>
        <div><span id="cn-sp-cat" class="badge ${CAT_BADGE[init.cat] || "badge-gray"}">${esc(init.cat || "자동")}</span>
        <span class="form-hint" style="display:inline;margin-left:6px">소속에 따라 자동 지정됩니다.</span></div></div>
      <label class="cn-sp-past" id="cn-sp-past-wrap" style="display:none">
        <input type="checkbox" id="cn-sp-past-chk"> 지난 회의 명단의 내 소속·직책에도 반영 (<span id="cn-sp-past-n">0</span>건)</label>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cn-sp-cancel">취소</button>
        ${a && a.sign ? '<button class="btn btn-ghost" id="cn-sp-save">💾 정보만 저장</button>' : ""}
        <button class="btn btn-primary" id="cn-sp-go">✍️ 서명 진행</button>
      </div>`);
    const nameEl = $("#cn-sp-name"), orgSel = $("#cn-sp-org"), orgEtc = $("#cn-sp-org-etc"), roleEl = $("#cn-sp-role");
    const catEl = $("#cn-sp-cat"), pastWrap = $("#cn-sp-past-wrap"), pastN = $("#cn-sp-past-n"), pastChk = $("#cn-sp-past-chk");
    const st = { cat: init.cat };
    const curName = () => String(nameEl.value || "").trim();
    const curOrg = () => orgSel.value === "__etc__" ? String(orgEtc.value || "").trim() : orgSel.value;
    const setCat = (c) => { st.cat = c; catEl.textContent = c || "자동"; catEl.className = "badge " + (CAT_BADGE[c] || "badge-gray"); };
    const refreshPast = () => {
      let n = 0; forEachPastEntry(meetingId, curName(), () => n++);
      pastWrap.style.display = n ? "" : "none"; pastN.textContent = n;
    };
    const fillFromDir = () => {
      const p = dir.get(curName());
      if (!p) return;
      if (p.org && orgOpts.indexOf(p.org) >= 0) { orgSel.value = p.org; orgEtc.style.display = "none"; }
      else if (p.org) { orgSel.value = "__etc__"; orgEtc.style.display = ""; orgEtc.value = p.org; }
      roleEl.value = p.role || "";
      setCat(p.cat || orgToCat(p.org));
    };
    orgSel.onchange = () => {
      orgEtc.style.display = orgSel.value === "__etc__" ? "" : "none";
      setCat(orgToCat(curOrg()));
    };
    orgEtc.oninput = () => setCat(orgToCat(curOrg()));
    nameEl.oninput = () => { if (idx < 0) fillFromDir(); refreshPast(); };
    refreshPast();
    $("#cn-sp-cancel").onclick = () => { closeModal(); SeMIS.renderView(); };
    /* 입력값 검증·수집 (통과 시 person 반환, 실패 시 null) */
    const collect = () => {
      const nm = curName(), og = curOrg();
      if (!nm) { toast("성명을 입력해 주세요.", true); return null; }
      if (!og) { toast("소속을 선택하거나 입력해 주세요.", true); return null; }
      return { name: nm, org: og, role: String(roleEl.value || "").trim(), cat: st.cat || orgToCat(og) };
    };
    const saveOnly = $("#cn-sp-save");
    if (saveOnly) saveOnly.onclick = () => {
      const person = collect();
      if (!person) return;
      saveSignEntry(meetingId, idx, person, "", !!(pastChk && pastChk.checked));
      closeModal(); toast("정보가 저장되었습니다. (기존 서명 유지)"); SeMIS.renderView();
    };
    $("#cn-sp-go").onclick = () => {
      const person = collect();
      if (!person) return;
      const alsoPast = !!(pastChk && pastChk.checked);
      closeModal();
      openSignPad(person, (val) => {
        saveSignEntry(meetingId, idx, person, val, alsoPast);
        closeModal(); toast("서명이 저장되었습니다."); SeMIS.renderView();
      });
    };
  }

  /* 서명 저장 — 최신 상태(실시간 병합분 포함) 재조회 후 해당 참석자에만 기록 */
  function setSign(meetingId, idx, val) {
    const m = all().find(c => c.id === meetingId);
    if (!m || !Array.isArray(m.attendees) || !m.attendees[idx]) return false;
    m.attendees[idx].sign = val || "";
    SeMIS.save();
    return true;
  }

  /* 서명 패드 — 캔버스에 그린 뒤 Storage 업로드(실패 시 dataURL). 저장 시 onDone(값) 호출 */
  function openSignPad(p, onDone) {
    openModal(`
      <h3>✍️ ${esc(p.name || "참석자")} 서명</h3>
      <div class="form-hint" style="margin-bottom:8px">${p.org ? esc(p.org) : ""}${p.role ? " · " + esc(p.role) : ""} — 아래 칸에 손가락 또는 마우스로 서명해 주세요.</div>
      <div class="sign-pad-wrap"><canvas id="cn-sign-cv" class="sign-pad"></canvas></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cn-sign-clear" style="margin-right:auto">지우기</button>
        <button class="btn btn-ghost" id="cn-sign-cancel">취소</button>
        <button class="btn btn-primary" id="cn-sign-ok">저장</button>
      </div>`);
    const cv = $("#cn-sign-cv");
    if (!cv) return;
    const wrapW = (cv.parentElement && cv.parentElement.clientWidth) || 300;
    const cssW = Math.max(240, Math.min(wrapW, 440));
    const cssH = 180;
    const ratio = window.devicePixelRatio || 1;
    cv.style.width = cssW + "px"; cv.style.height = cssH + "px";
    cv.width = Math.round(cssW * ratio); cv.height = Math.round(cssH * ratio);
    const ctx = cv.getContext ? cv.getContext("2d") : null;
    if (ctx) { ctx.scale(ratio, ratio); ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a"; }
    let drawing = false, hasDrawn = false, lx = 0, ly = 0;
    const pos = (ev) => { const r = cv.getBoundingClientRect(); const t = (ev.touches && ev.touches[0]) || ev; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
    const down = (ev) => { ev.preventDefault(); drawing = true; const p = pos(ev); lx = p.x; ly = p.y; };
    const moveFn = (ev) => { if (!drawing || !ctx) return; ev.preventDefault(); const p = pos(ev); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p.x, p.y); ctx.stroke(); lx = p.x; ly = p.y; hasDrawn = true; };
    const up = () => { drawing = false; };
    if (cv.addEventListener) {
      if (window.PointerEvent) {
        // 포인터 이벤트 하나로 터치·마우스·펜 모두 처리(중복 방지)
        cv.addEventListener("pointerdown", down);
        cv.addEventListener("pointermove", moveFn);
        window.addEventListener("pointerup", up);
      } else {
        cv.addEventListener("touchstart", down, { passive: false });
        cv.addEventListener("touchmove", moveFn, { passive: false });
        window.addEventListener("touchend", up);
        cv.addEventListener("mousedown", down);
        cv.addEventListener("mousemove", moveFn);
        window.addEventListener("mouseup", up);
      }
    }
    const cleanup = () => { try { window.removeEventListener("pointerup", up); window.removeEventListener("touchend", up); window.removeEventListener("mouseup", up); } catch (e) {} };
    $("#cn-sign-clear").onclick = () => { if (ctx) ctx.clearRect(0, 0, cssW, cssH); hasDrawn = false; };
    $("#cn-sign-cancel").onclick = () => { cleanup(); closeModal(); SeMIS.renderView(); };
    $("#cn-sign-ok").onclick = () => {
      if (!hasDrawn) { toast("서명을 입력해 주세요.", true); return; }
      const finish = (val) => { cleanup(); onDone(val); };
      const dataFallback = () => { try { finish(cv.toDataURL("image/png")); } catch (e) { toast("서명 저장에 실패했습니다.", true); } };
      try {
        if (cv.toBlob && window.SemisSync && typeof fetch !== "undefined") {
          cv.toBlob((blob) => {
            if (!blob) return dataFallback();
            (async () => {
              try {
                const file = new File([blob], "sign_" + Date.now() + ".png", { type: "image/png" });
                const up = await SemisSync.uploadFile(file, "council-sign");
                finish(up.url);
              } catch (e) { dataFallback(); }
            })();
          }, "image/png");
        } else dataFallback();
      } catch (e) { dataFallback(); }
    };
  }

  /* ══════════ 모듈 렌더 ══════════ */
  SeMIS.registerModule("council", {
    title: "보안장비 협의회",
    render(root) {
      const u = SeMIS.user;
      if (u && u.role === "signer") {
        const vid = signViewId && all().some(c => c.id === signViewId) ? signViewId : u.signMeetingId;
        renderSigning(root, vid); return;
      }
      const s = stats();
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🤝 보안장비 협의회</div>
          <span class="spacer"></span>
          ${canWrite() ? '<button class="btn btn-primary" id="cn-add">+ 회의록 작성</button>' : ""}
          <div class="page-desc">인천화물터미널 B동 보안검색장비 관리 협의회 회의록 — 총 ${s.total}회</div>
        </div>
        <div class="council-banner">
          <span class="cb-ico">🎯</span>
          <div class="cb-body">
            <b>KPI 과제 C6-1 기반 운영</b>
            <div>「내부 보안 관리 체계 보완」(안전보안 C6-1)의 <i>보안장비 협의체 신설</i> 활동입니다. 제조사·유지보수·운영사·본사가 매월 모여 X-ray·ETD 등 보안검색장비의 고장 원인 분석과 사용환경 개선을 공동 논의합니다.</div>
          </div>
          ${canSeeKpi() ? '<button class="btn btn-ghost btn-sm" id="cn-kpi">C6-1 과제 보기 →</button>' : ""}
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-label">총 회의</div><div class="stat-value">${s.total}</div><div class="stat-sub">누적 개최</div></div>
          <div class="stat"><div class="stat-label">${s.yr}년 개최</div><div class="stat-value" style="color:var(--primary)">${s.thisYear}</div><div class="stat-sub">올해 회의</div></div>
          <div class="stat"><div class="stat-label">누적 사례</div><div class="stat-value">${s.cases}</div><div class="stat-sub">고장·수리 분석</div></div>
          <div class="stat"><div class="stat-label">미완료 결정</div><div class="stat-value" style="color:${s.openAct ? "var(--warning)" : "var(--success)"}">${s.openAct}</div><div class="stat-sub">액션 아이템</div></div>
        </div>
        <div class="card"><div id="cn-body">${listHTML()}</div></div>`;

      if (canWrite()) $("#cn-add").onclick = () => form(null);
      if (canSeeKpi() && $("#cn-kpi")) $("#cn-kpi").onclick = () => SeMIS.navigate("kpi");
      $$("#cn-body [data-cn-row]").forEach(el => el.onclick = () => detail(el.dataset.cnRow));
    }
  });

  /* ══════════ 테스트/외부 노출 ══════════ */
  window.SemisCouncil = { CATS, stats, all, sorted, nextRound, printMinutes, setSign, renderSigning,
    signBoxHTML, printQrSheet, qrSvg,
    repairToCase, mergeCaresIntoCases, repairsInPeriod, prevMeetingDate, catNorm,
    ORG_PRESETS, orgToCat, knownPeople, saveSignEntry, propagatePersonInfo,
    caresPicker, openRepair, openRepairById, repairHTML, repStatus, nextDay, repDate,
    briefText, CASE_LIMIT, prefFull, setPrefFull,
    closeSub, closeAllSub, subCount: () => subStack.length };
})();
