/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 비밀 취급 / SSI · 보안서약서 관리 (v2.55)
   민감보안정보 취급자 보안서약서(국가항공보안계획 1.2.13 — 신원조사 대체)의 제출 기록 관리.
     · 작성: QR · 링크 → pledge.html (로그인 없이) → RPC semis_v2_pledge_submit
     · 명단: 사람별 최신 서약(재서약은 이력) / 전체 제출 기록 · 검색 · 연도 · 상태 · 구분 필터
     · 상세: 서명 · 처음 제출 값 · 이력 · 개별 서약서 A4 인쇄
     · 수정 · 종이 서약 등록(스캔 첨부) · 상태(유효 / 퇴직·전출 / 무효) · 삭제(시스템관리자)
     · A4 명단 인쇄(국토부 제출용 — 사번/생년월일 · 서명 포함)
   데이터: 비공개 표 semis_v2_private.pledges — 공용 DB 컬렉션이 아니다(동기화 사본에 싣지 않음).
          RPC semis_v2_pledges · semis_v2_pledge_signs · semis_v2_pledge_save · semis_v2_pledge_delete
          (항공보안HQ 이상 내부 계정). 새 제출은 변경 알림(key 'pledges')으로 바로 반영.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const MOD = "ssi";
  const TITLE = "비밀 취급 / SSI";
  const PROD_URL = "https://semis.pe.kr/pledge.html";
  const STALE_MS = 60000;
  const STATE = { valid: ["유효", "green"], left: ["퇴직 · 전출", "gray"], void: ["무효", "red"] };
  const SRC = { web: ["웹 제출", "blue"], sheet: ["시트 이관", "indigo"], paper: ["종이", "amber"] };
  const NAVY = "#1b3088";

  const st = { rows: null, at: 0, busy: null, err: "", signs: {}, signBusy: null,
               view: "people", q: "", year: "", state: "valid", src: "", showSign: false };

  /* ─────────── 날짜 (한국 시각) ─────────── */
  const kst = (iso) => { const t = Date.parse(iso); return isNaN(t) ? "" : new Date(t + 9 * 3600e3).toISOString(); };
  const kDate = (iso) => kst(iso).slice(0, 10);
  const kTime = (iso) => kst(iso).slice(11, 16);
  const todayK = () => kDate(new Date().toISOString());
  const nf = (n) => Number(n || 0).toLocaleString("ko-KR");

  /* ─────────── 데이터 ─────────── */
  const rpc = (name, args) => window.SemisSync && SemisSync.rpc ? SemisSync.rpc(name, args || {}) : Promise.reject(new Error("offline"));
  function load(force) {
    if (!force && st.rows && Date.now() - st.at < STALE_MS) return Promise.resolve(st.rows);
    if (st.busy) return st.busy;
    st.busy = rpc("semis_v2_pledges", {}).then(d => {
      if (!d || !d.ok) throw new Error((d && d.error) || "load");
      st.rows = Array.isArray(d.rows) ? d.rows : [];
      st.at = Date.now(); st.err = "";
      return st.rows;
    }).catch(e => { st.err = String((e && e.message) || e); if (!st.rows) st.rows = null; throw e; })
      .finally(() => { st.busy = null; });
    return st.busy;
  }
  /* 서명 이미지 — 필요한 것만 받아 이 화면 동안 기억 */
  async function loadSigns(ids) {
    const need = Array.from(new Set(ids.filter(id => id && !(id in st.signs))));
    for (let i = 0; i < need.length; i += 200) {
      const part = need.slice(i, i + 200);
      const d = await rpc("semis_v2_pledge_signs", { p_ids: part });
      if (!d || !d.ok) throw new Error((d && d.error) || "signs");
      part.forEach(id => { st.signs[id] = (d.signs && d.signs[id]) || ""; });
    }
    return st.signs;
  }
  /* 사람 키 — 서버 semis_v2_private.pledge_pkey 와 같은 규칙 */
  function empKey(v) {
    return String(v || "").toLowerCase().replace(/[^0-9a-z]/g, "").replace(/^kj(?=[0-9])/, "");
  }
  function pkey(r) { const k = empKey(r.empId); return k || "n:" + String(r.name || "").toLowerCase().replace(/\s/g, ""); }
  /* 사람별 묶음 — 대표는 유효한 서약 중 최신(없으면 최신) */
  function people(rows) {
    const map = new Map();
    (rows || []).forEach(r => {
      const k = pkey(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    const out = [];
    map.forEach((list, k) => {
      list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const lead = list.find(x => x.state === "valid") || list[0];
      out.push({ key: k, lead, all: list, n: list.length });
    });
    return out.sort((a, b) => String(b.lead.at).localeCompare(String(a.lead.at)));
  }
  function historyOf(r) { const k = pkey(r); return (st.rows || []).filter(x => pkey(x) === k).sort((a, b) => String(b.at).localeCompare(String(a.at))); }
  const hay = (r) => [r.name, r.dept, r.position, r.empId].join(" ").toLowerCase();
  function match(r) {
    if (st.year && kDate(r.at).slice(0, 4) !== st.year) return false;
    if (st.state && r.state !== st.state) return false;
    if (st.src && r.src !== st.src) return false;
    const q = st.q.trim().toLowerCase();
    if (q && q.split(/\s+/).some(w => hay(r).indexOf(w) < 0)) return false;
    return true;
  }
  /* 현재 조건의 목록 — 사람별 보기는 대표 서약으로 판정 */
  function listed() {
    const rows = st.rows || [];
    if (st.view === "records") return rows.filter(match).map(r => ({ r, n: 0, lead: true }));
    return people(rows).filter(p => match(p.lead)).map(p => ({ r: p.lead, n: p.n, lead: true }));
  }
  function stats() {
    const rows = st.rows || [];
    const ppl = people(rows);
    const y = todayK().slice(0, 4);
    const since = Date.now() - 30 * 86400e3;
    return {
      valid: ppl.filter(p => p.lead.state === "valid").length,
      year: rows.filter(r => kDate(r.at).slice(0, 4) === y).length,
      recent: rows.filter(r => Date.parse(r.at) >= since).length,
      again: ppl.filter(p => p.n > 1).length,
      off: ppl.filter(p => p.lead.state !== "valid").length,
      total: rows.length, people: ppl.length
    };
  }
  function years() {
    const s = new Set((st.rows || []).map(r => kDate(r.at).slice(0, 4)).filter(Boolean));
    return Array.from(s).sort().reverse();
  }

  /* ─────────── 작성 화면 주소 · QR 카드 ─────────── */
  function formUrl() {
    try {
      const l = location;
      if (l && /^https?:$/.test(l.protocol) && !/semis\.test$/.test(l.hostname)) {
        return l.origin + l.pathname.replace(/[^/]*$/, "") + "pledge.html";
      }
    } catch (e) { /* 파일 프로토콜 등 */ }
    return PROD_URL;
  }
  /* 기존 인쇄물과 같은 모양의 QR 카드(SVG) — 로고 · 네이비 테두리 · QR · 보안서약서 */
  function qrCard(url) {
    let mods = "";
    let n = 29;
    try {
      const m = SemisQR.matrix(url, { ecc: "M" });
      n = m.size;
      const cell = 272 / n;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (m.get(r, c)) mods += `<rect x="${(62 + c * cell).toFixed(2)}" y="${(100 + r * cell).toFixed(2)}" width="${(cell + .35).toFixed(2)}" height="${(cell + .35).toFixed(2)}"/>`;
      }
    } catch (e) { mods = ""; }
    return `<svg class="pl-qrsvg" viewBox="0 0 720 440" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="보안서약서 작성 QR 코드">
      <rect width="720" height="440" fill="#fff"/>
      <g transform="translate(44 16) scale(.46)"><polygon points="84.6,15.1 61.3,15.1 10.9,55.1 37.2,55.1 37.2,38.9 65,38.9" fill="#df4552"/><polygon points="86.1,41.8 67.3,41.8 67.3,63.2 39.5,63.2 12.6,87.9 52.4,87.9" fill="${NAVY}"/></g>
      <text x="92" y="58" font-family="Arial, Helvetica, sans-serif" font-size="33" font-weight="900" font-style="italic" letter-spacing="1" fill="${NAVY}">AIRZETA</text>
      <path d="M252 45 H688 V410 H32 V74" fill="none" stroke="${NAVY}" stroke-width="7" stroke-linejoin="miter"/>
      <g fill="${NAVY}">${mods}</g>
      <text x="378" y="222" font-family="-apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="54" font-weight="800" fill="${NAVY}" letter-spacing="-.5">보안서약서</text>
      <text x="380" y="280" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="500" fill="${NAVY}">Security Pledge</text>
      <text x="380" y="320" font-family="Arial, Helvetica, sans-serif" font-size="31" font-weight="500" fill="${NAVY}">Agreement</text>
    </svg>`;
  }
  function copyText(text) {
    const done = () => toast("주소를 복사했습니다.");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, () => fallback()); return; }
    } catch (e) { /* 아래 */ }
    fallback();
    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("복사하지 못했습니다.", true); }
      ta.remove();
    }
  }
  function savePng() {
    try {
      const svg = qrCard(formUrl()).replace('<svg class="pl-qrsvg"', '<svg width="1440" height="880"');
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = 1440; c.height = 880;
        const g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => {
          if (!b) { toast("이미지를 만들지 못했습니다.", true); return; }
          const a = document.createElement("a");
          a.href = URL.createObjectURL(b); a.download = "보안서약서_QR.png";
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        }, "image/png");
      };
      img.onerror = () => { URL.revokeObjectURL(url); toast("이미지를 만들지 못했습니다.", true); };
      img.src = url;
    } catch (e) { toast("이미지를 만들지 못했습니다.", true); }
  }

  /* ─────────── 인쇄 공통 (숨은 iframe) ─────────── */
  function printHTML(html) {
    try {
      const fr = document.createElement("iframe");
      fr.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;visibility:hidden";
      document.body.appendChild(fr);
      const doc = fr.contentWindow.document;
      doc.open(); doc.write(html); doc.close();
      const fire = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { /* 무시 */ } };
      const go = () => setTimeout(fire, 250);
      if (doc.readyState === "complete") go(); else fr.onload = go;
      setTimeout(() => { try { fr.remove(); } catch (e) { /* 무시 */ } }, 60000);
    } catch (e) { toast("인쇄 대화상자를 열 수 없습니다.", true); }
  }
  const PRINT_CSS = `* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "맑은 고딕", sans-serif; color: #0f172a; margin: 0; }`;

  function printQr() {
    const url = formUrl();
    printHTML(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>보안서약서 QR</title><style>${PRINT_CSS}
      @page { size: A4 portrait; margin: 18mm; }
      .wrap { text-align: center; padding-top: 30mm; } svg { width: 170mm; height: auto; }
      p { font-size: 11pt; color: #334155; margin-top: 8mm; word-break: break-all; }</style></head>
      <body><div class="wrap">${qrCard(url)}<p>${esc(url)}</p></div></body></html>`);
  }

  /* 국토부 제출용 명단 */
  function listPrintHTML(items, opt) {
    const rowsHtml = items.map((it, i) => {
      const r = it.r, sg = opt.sign ? (st.signs[r.id] || "") : "";
      return `<tr><td class="c">${i + 1}</td><td>${esc(r.dept)}</td><td>${esc(r.position)}</td><td class="nm">${esc(r.name)}</td>
        <td class="c">${esc(r.empId)}</td><td class="c">${esc(kDate(r.at))}</td>
        ${opt.sign ? `<td class="sg">${sg ? `<img src="${sg}" alt="">` : r.src === "paper" ? '<span class="pp">종이 서약서</span>' : ""}</td>` : ""}</tr>`;
    }).join("");
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(opt.title)}</title><style>${PRINT_CSS}
      @page { size: A4 portrait; margin: 14mm 12mm 16mm; @bottom-center { content: counter(page) " / " counter(pages); font-size: 8pt; color: #64748b; } }
      h1 { font-size: 17pt; text-align: center; margin: 0 0 3mm; letter-spacing: -.3px; }
      .meta { display: flex; justify-content: space-between; font-size: 9pt; color: #334155; margin-bottom: 3mm; }
      table { width: 100%; border-collapse: collapse; font-size: 9pt; }
      thead { display: table-header-group; } tr { break-inside: avoid; }
      th { background: #0b2545; color: #fff; font-weight: 700; padding: 5px 4px; border: 1px solid #0b2545; }
      td { border: 1px solid #94a3b8; padding: 3px 5px; height: ${opt.sign ? "13mm" : "7mm"}; }
      td.c { text-align: center; white-space: nowrap; } td.nm { font-weight: 700; white-space: nowrap; }
      td.sg { width: 34mm; text-align: center; padding: 1px 2px; } td.sg img { max-width: 32mm; max-height: 12mm; vertical-align: middle; }
      .pp { font-size: 8pt; color: #64748b; }
      .foot { margin-top: 4mm; font-size: 8.5pt; color: #475569; }</style></head><body>
      <h1>${esc(opt.title)}</h1>
      <div class="meta"><span>에어제타㈜ · ${esc(opt.scope)}</span><span>기준일 ${esc(todayK())} · 총 ${items.length}명</span></div>
      <table><thead><tr><th style="width:9mm">번호</th><th>소속</th><th>직위</th><th>성명</th><th>사번 / 생년월일</th><th style="width:22mm">서약일</th>${opt.sign ? "<th>서명</th>" : ""}</tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="${opt.sign ? 7 : 6}" class="c">대상 없음</td></tr>`}</tbody></table>
      <p class="foot">국가항공보안계획 1.2.13에 따른 민감보안정보 취급자 보안서약 (신원조사 대체)</p>
    </body></html>`;
  }
  const SORTS = {
    date: (a, b) => String(a.r.at).localeCompare(String(b.r.at)),
    dept: (a, b) => String(a.r.dept).localeCompare(String(b.r.dept), "ko") || String(a.r.name).localeCompare(String(b.r.name), "ko"),
    name: (a, b) => String(a.r.name).localeCompare(String(b.r.name), "ko")
  };
  function openListPrint() {
    const items = listed();
    const scope = scopeText();
    openModal(`<h3>명단 인쇄 (A4)</h3>
      <div class="form-row"><label>제목</label><input id="plp-title" maxlength="60" value="보안서약서 작성자 명단"></div>
      <div class="form-grid">
        <div class="form-row"><label>정렬</label><select id="plp-sort"><option value="date">서약일순</option><option value="dept">소속순</option><option value="name">성명순</option></select></div>
        <div class="form-row"><label>대상</label><input value="${esc(scope)} · ${items.length}명" disabled></div>
      </div>
      <label class="pl-check"><input type="checkbox" id="plp-sign" checked> 서명 이미지 포함</label>
      <div class="modal-actions"><button class="btn btn-ghost" id="plp-x">취소</button><button class="btn btn-primary" id="plp-go">인쇄</button></div>`);
    $("#plp-x").onclick = closeModal;
    $("#plp-go").onclick = async () => {
      const opt = { title: $("#plp-title").value.trim() || "보안서약서 작성자 명단", sign: $("#plp-sign").checked, scope };
      const list = items.slice().sort(SORTS[$("#plp-sort").value] || SORTS.date);
      const btn = $("#plp-go");
      btn.disabled = true; btn.textContent = "준비 중…";
      try { if (opt.sign) await loadSigns(list.map(x => x.r.id)); }
      catch (e) { btn.disabled = false; btn.textContent = "인쇄"; toast("서명 이미지를 받지 못했습니다.", true); return; }
      closeModal();
      printHTML(listPrintHTML(list, opt));
    };
  }
  function scopeText() {
    const bits = [st.view === "records" ? "전체 제출 기록" : "사람별 최신 서약"];
    if (st.state) bits.push(STATE[st.state][0]);
    if (st.year) bits.push(st.year + "년");
    if (st.src) bits.push(SRC[st.src][0]);
    if (st.q.trim()) bits.push("검색 '" + st.q.trim() + "'");
    return bits.join(" · ");
  }

  /* 개별 서약서 (제출한 문구 · 서명 그대로) */
  async function printPledge(r) {
    try { await loadSigns([r.id]); } catch (e) { /* 서명 없이 */ }
    const P = window.SemisPledgeText || { TEXT: {}, VERSION: "" };
    const t = P.TEXT[r.lang === "en" ? "en" : "ko"] || P.TEXT.ko;
    const en = r.lang === "en";
    const L = en ? { date: "Date", dept: "Department", pos: "Position", emp: "Employee ID / Date of birth", name: "Name", sign: "Signature" }
                 : { date: "서약일", dept: "소속", pos: "직위", emp: "사번 / 생년월일", name: "성명", sign: "서명" };
    const sg = st.signs[r.id] || "";
    printHTML(`<!doctype html><html lang="${en ? "en" : "ko"}"><head><meta charset="utf-8"><title>${esc(t.title)} — ${esc(r.name)}</title><style>${PRINT_CSS}
      @page { size: A4 portrait; margin: 20mm 18mm; }
      .top { border-top: 5px solid #0b2545; padding-top: 6mm; text-align: center; }
      h1 { font-size: 22pt; margin: 0; letter-spacing: 2px; } .sub { color: #475569; font-size: 10pt; margin-top: 1mm; }
      .lead { margin: 7mm 0 5mm; font-size: 10pt; background: #eef4fd; padding: 3mm 4mm; border-radius: 2mm; }
      ol { list-style: none; padding: 0; margin: 0; } li { margin-bottom: 4mm; font-size: 10.5pt; line-height: 1.6; display: flex; gap: 3mm; }
      li .ck { font-size: 12pt; color: #0b2545; } li b { display: block; color: #0b2545; }
      table { width: 100%; border-collapse: collapse; margin-top: 7mm; font-size: 10.5pt; }
      th { width: 42mm; background: #f1f5f9; text-align: left; } th, td { border: 1px solid #94a3b8; padding: 2.5mm 3mm; }
      .sg { height: 30mm; } .sg img { max-height: 27mm; max-width: 90mm; }
      .to { text-align: right; font-size: 12pt; font-weight: 700; margin-top: 9mm; }
      .meta { margin-top: 10mm; font-size: 8pt; color: #64748b; border-top: 1px solid #cbd5e1; padding-top: 2mm; }</style></head><body>
      <div class="top"><h1>${esc(t.title)}</h1><div class="sub">${esc(t.sub)}</div></div>
      <p class="lead">${esc(t.lead)}</p>
      <ol>${(t.clauses || []).map(c => `<li><span class="ck">☑</span><div><b>${esc(c[0])}</b>${esc(c[1])}</div></li>`).join("")}</ol>
      <table>
        <tr><th>${L.date}</th><td>${esc(kDate(r.at))}</td></tr>
        <tr><th>${L.dept}</th><td>${esc(r.dept)}</td></tr>
        <tr><th>${L.pos}</th><td>${esc(r.position)}</td></tr>
        <tr><th>${L.emp}</th><td>${esc(r.empId)}</td></tr>
        <tr><th>${L.name}</th><td>${esc(r.name)}</td></tr>
        <tr><th>${L.sign}</th><td class="sg">${sg ? `<img src="${sg}" alt="">` : r.src === "paper" ? "종이 서약서 원본 보관" : ""}</td></tr>
      </table>
      <p class="to">${esc(t.to)}</p>
      <p class="meta">${esc(SRC[r.src] ? SRC[r.src][0] : "")} · 제출 ${esc(kDate(r.at) + " " + kTime(r.at))} · 접수 ${esc(String(r.submitId || "").replace(/-/g, "").slice(0, 8).toUpperCase())}${r.ip ? " · IP " + esc(r.ip) : ""} · 문구 ${esc(P.VERSION)} · SeMIS 출력 ${esc(todayK())}</p>
    </body></html>`);
  }

  /* ─────────── 화면 ─────────── */
  const badge = (pair) => pair ? `<span class="badge badge-${esc(pair[1])}">${esc(pair[0])}</span>` : "";
  function statsHTML() {
    const s = stats();
    return `<div class="ds-stats pl-stats">
      <div class="ds-stat tone-green"><b>${nf(s.valid)}<em>명</em></b><span>유효 서약자</span></div>
      <div class="ds-stat tone-blue"><b>${nf(s.year)}<em>건</em></b><span>${todayK().slice(0, 4)}년 제출</span></div>
      <div class="ds-stat"><b>${nf(s.recent)}<em>건</em></b><span>최근 30일</span></div>
      <div class="ds-stat tone-gray"><b>${nf(s.again)}<em>명</em></b><span>재서약</span></div>
      <div class="ds-stat tone-red"><b>${nf(s.off)}<em>명</em></b><span>퇴직 · 전출 · 무효</span></div>
    </div>`;
  }
  function qrPanelHTML() {
    const url = formUrl();
    return `<div class="ds-panel pl-qrpanel">
      <div class="ds-hd"><span class="ds-pill"><i class="em">▦</i>작성 QR · 링크</span></div>
      <div class="pl-qrcard">${qrCard(url)}</div>
      <div class="pl-url"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url.replace(/^https?:\/\//, ""))}</a></div>
      <div class="pl-qrbtns">
        <button type="button" class="btn btn-ghost btn-sm" id="pl-copy">링크 복사</button>
        <button type="button" class="btn btn-ghost btn-sm" id="pl-png">PNG 저장</button>
        <button type="button" class="btn btn-ghost btn-sm" id="pl-qrprint">QR 인쇄</button>
      </div>
      <p class="pl-mini">기존 QR · 링크도 이 작성 화면으로 연결됩니다.</p>
    </div>`;
  }
  function toolbarHTML() {
    const ys = years();
    return `<div class="pl-tools">
      <div class="pl-seg" role="group" aria-label="보기">
        <button type="button" data-pl-view="people" aria-pressed="${st.view === "people"}">사람별</button>
        <button type="button" data-pl-view="records" aria-pressed="${st.view === "records"}">전체 제출 기록</button>
      </div>
      <input type="search" id="pl-q" class="pl-q" placeholder="성명 · 소속 · 직위 · 사번 검색" value="${esc(st.q)}" autocomplete="off">
      <select id="pl-state" aria-label="상태"><option value="">상태 전체</option>${Object.keys(STATE).map(k => `<option value="${k}"${st.state === k ? " selected" : ""}>${STATE[k][0]}</option>`).join("")}</select>
      <select id="pl-year" aria-label="연도"><option value="">연도 전체</option>${ys.map(y => `<option value="${y}"${st.year === y ? " selected" : ""}>${y}년</option>`).join("")}</select>
      <select id="pl-src" aria-label="구분"><option value="">구분 전체</option>${Object.keys(SRC).map(k => `<option value="${k}"${st.src === k ? " selected" : ""}>${SRC[k][0]}</option>`).join("")}</select>
      <label class="pl-check"><input type="checkbox" id="pl-sign"${st.showSign ? " checked" : ""}> 서명 보기</label>
    </div>`;
  }
  function tableHTML() {
    if (st.rows === null) {
      return st.err ? `<div class="ds-empty">명단을 불러오지 못했습니다. <button type="button" class="btn btn-ghost btn-sm" id="pl-retry">다시 시도</button></div>`
                    : `<div class="ds-empty">불러오는 중…</div>`;
    }
    const items = listed();
    const total = st.view === "records" ? (st.rows || []).length : people(st.rows).length;
    const head = `<div class="pl-count">${nf(items.length)}${items.length !== total ? ` / ${nf(total)}` : ""}${st.view === "records" ? "건" : "명"}</div>`;
    if (!items.length) return head + `<div class="ds-empty">조건에 맞는 서약이 없습니다.</div>`;
    const leadIds = new Set(people(st.rows).map(p => p.lead.id));
    return head + `<div class="table-wrap"><table class="tbl ds-tbl pl-tbl"><thead><tr>
        <th class="pl-no">번호</th><th>서약일</th><th>성명</th><th>소속</th><th>직위</th><th>사번 / 생년월일</th>${st.showSign ? "<th>서명</th>" : ""}<th>구분</th><th>상태</th>
      </tr></thead><tbody>${items.map((it, i) => {
        const r = it.r;
        const again = st.view === "people" && it.n > 1 ? ` <span class="badge badge-gray badge-sm" title="서약 ${it.n}회">재서약 ${it.n - 1}</span>` : "";
        const old = st.view === "records" && !leadIds.has(r.id) ? ` <span class="badge badge-gray badge-sm">이전</span>` : "";
        const sg = st.showSign ? `<td class="pl-sgc" data-l="서명">${st.signs[r.id] ? `<img src="${st.signs[r.id]}" alt="${esc(r.name)} 서명">` : r.hasSign ? '<span class="pl-dim">…</span>' : '<span class="pl-dim">없음</span>'}</td>` : "";
        return `<tr data-pl-id="${esc(r.id)}" tabindex="0">
          <td class="pl-no">${i + 1}</td><td class="pl-date" data-l="서약일">${esc(kDate(r.at))}</td>
          <td class="pl-name" data-l="성명"><b>${esc(r.name)}</b>${again}${old}<span class="pl-msub">${esc([r.dept, r.position, r.empId].filter(Boolean).join(" · "))}</span></td>
          <td data-l="소속">${esc(r.dept)}</td><td data-l="직위">${esc(r.position)}</td><td class="pl-emp" data-l="사번">${esc(r.empId)}</td>
          ${sg}<td data-l="구분">${badge(SRC[r.src])}</td><td data-l="상태">${badge(STATE[r.state])}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }
  function paintList() {
    const box = $("#pl-list");
    if (!box) return;
    box.innerHTML = tableHTML();
    const retry = $("#pl-retry", box);
    if (retry) retry.onclick = () => refresh(true);
    $$("tr[data-pl-id]", box).forEach(tr => {
      const open = () => openDetail(tr.getAttribute("data-pl-id"));
      tr.onclick = open;
      tr.onkeydown = (e) => { if (e.key === "Enter") open(); };
    });
    if (st.showSign && st.rows) {
      const ids = listed().map(x => x.r.id).filter(id => !(id in st.signs));
      if (ids.length && !st.signBusy) {
        st.signBusy = loadSigns(ids).then(() => { st.signBusy = null; paintList(); })
          .catch(() => { st.signBusy = null; toast("서명 이미지를 받지 못했습니다.", true); });
      }
    }
  }
  /* 최근 제출 5건 — 새 제출이 들어오면 여기에 먼저 보인다 */
  function recentHTML() {
    const list = (st.rows || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 5);
    if (!list.length) return "";
    return `<div class="pl-recent"><div class="pl-recent-t">최근 제출</div><ul>${list.map(r => `<li><button type="button" data-pl-open="${esc(r.id)}">
      <b>${esc(r.name)}</b><span>${esc([r.dept, r.position].filter(Boolean).join(" · "))}</span><time>${esc(kDate(r.at))}</time></button></li>`).join("")}</ul></div>`;
  }
  function paintTop() {
    const s = $("#pl-statsbox");
    if (!s) return;
    s.innerHTML = st.rows ? statsHTML() + recentHTML() : "";
    $$("[data-pl-open]", s).forEach(b => b.onclick = () => openDetail(b.getAttribute("data-pl-open")));
  }
  function render(root) {
    root.innerHTML = `
      <div class="ds-head">
        <div class="ds-head-t"><i class="em">㊙️</i>${TITLE} <small>보안서약서 · 민감보안정보 취급자</small></div>
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm" id="pl-refresh" title="명단 다시 읽기">↻ 새로고침</button>
        <button type="button" class="btn btn-ghost btn-sm" id="pl-add">+ 종이 서약 등록</button>
        <button type="button" class="btn btn-primary btn-sm" id="pl-print" title="A4 명단 인쇄">🖨 명단 인쇄</button>
      </div>
      <div id="pl-page" class="pl-page">
        <div class="pl-top">
          ${qrPanelHTML()}
          <div class="ds-panel ds-panel-tint pl-sum">
            <div class="ds-hd"><span class="ds-pill"><i class="em">📊</i>서약 현황</span><span class="spacer"></span><span class="ds-head-meta" id="pl-asof"></span></div>
            <div id="pl-statsbox"></div>
            <p class="pl-basis">국가항공보안계획 1.2.13 — 민감보안정보 취급자 신원조사를 보안서약으로 대체</p>
          </div>
        </div>
        <div class="ds-panel pl-listpanel">
          <div class="ds-hd"><span class="ds-pill"><i class="em">📋</i>서약자 명단</span></div>
          <div id="pl-toolbox">${toolbarHTML()}</div>
          <div id="pl-list"></div>
        </div>
      </div>`;
    $("#pl-refresh", root).onclick = () => refresh(true);
    $("#pl-add", root).onclick = () => openEdit(null);
    $("#pl-print", root).onclick = () => { if (!st.rows) { toast("명단을 불러온 뒤 인쇄할 수 있습니다.", true); return; } openListPrint(); };
    $("#pl-copy", root).onclick = () => copyText(formUrl());
    $("#pl-png", root).onclick = savePng;
    $("#pl-qrprint", root).onclick = printQr;
    bindTools(root);
    paintTop(); paintList(); paintAsOf();
    load(false).then(() => { paintTop(); refreshTools(); paintList(); paintAsOf(); })
      .catch(() => { paintList(); });
  }
  function paintAsOf() { const el = $("#pl-asof"); if (el) el.textContent = st.at ? "기준 " + kTime(new Date(st.at).toISOString()) : ""; }
  function refreshTools() {
    const tb = $("#pl-toolbox");
    if (!tb) return;
    const q = $("#pl-q", tb), had = q && document.activeElement === q;
    tb.innerHTML = toolbarHTML();
    bindTools(tb);
    if (had) { const n = $("#pl-q", tb); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
  }
  function bindTools(root) {
    $$("[data-pl-view]", root).forEach(b => b.onclick = () => {
      st.view = b.getAttribute("data-pl-view");
      $$("[data-pl-view]", root).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      paintList();
    });
    const q = $("#pl-q", root);
    if (q) q.oninput = () => { st.q = q.value.replace(/[ㄱ-ㆎ]+$/, ""); paintList(); };   // 조합 중 자모 제외 · 입력칸은 다시 그리지 않음
    const sel = (id, key) => { const el = $(id, root); if (el) el.onchange = () => { st[key] = el.value; paintList(); }; };
    sel("#pl-state", "state"); sel("#pl-year", "year"); sel("#pl-src", "src");
    const sg = $("#pl-sign", root);
    if (sg) sg.onchange = () => { st.showSign = sg.checked; paintList(); };
  }
  function refresh(force) {
    const btn = $("#pl-refresh");
    if (btn) btn.disabled = true;
    return load(force).then(() => { paintTop(); refreshTools(); paintList(); paintAsOf(); })
      .catch(() => { toast("명단을 불러오지 못했습니다.", true); paintList(); })
      .finally(() => { const b = $("#pl-refresh"); if (b) b.disabled = false; });
  }

  /* ─────────── 상세 ─────────── */
  const find = (id) => (st.rows || []).find(r => r.id === id);
  function openDetail(id) {
    const r = find(id);
    if (!r) return;
    const hist = historyOf(r);
    const o = r.orig;
    const files = Array.isArray(r.files) ? r.files : [];
    const ua = String(r.ua || "");
    const dev = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "Mac" : "";
    openModal(`<div class="pl-dt">
      <div class="pl-dt-hd"><h3>${esc(r.name)}</h3>${badge(STATE[r.state])} ${badge(SRC[r.src])}</div>
      <div class="pl-dt-grid">
        <dl class="pl-dl">
          <dt>서약 일시</dt><dd>${esc(kDate(r.at))} ${esc(kTime(r.at))}</dd>
          <dt>소속</dt><dd>${esc(r.dept) || "—"}</dd>
          <dt>직위</dt><dd>${esc(r.position) || "—"}</dd>
          <dt>사번 / 생년월일</dt><dd>${esc(r.empId) || "—"}</dd>
          <dt>서약 문구</dt><dd>${r.lang === "en" ? "영문" : "국문"}</dd>
          ${r.state !== "valid" ? `<dt>상태</dt><dd>${esc(STATE[r.state][0])}${r.stateAt ? " · " + esc(r.stateAt) : ""}${r.stateNote ? " — " + esc(r.stateNote) : ""}</dd>` : ""}
          ${r.note ? `<dt>비고</dt><dd class="pl-pre">${esc(r.note)}</dd>` : ""}
          <dt>접수</dt><dd class="pl-meta">${esc(String(r.submitId || "").replace(/-/g, "").slice(0, 8).toUpperCase())}${r.ip ? " · IP " + esc(r.ip) : ""}${dev ? " · " + dev : ""}</dd>
        </dl>
        <div class="pl-dt-sign" id="pl-dt-sign">${r.hasSign ? '<span class="pl-dim">서명 불러오는 중…</span>' : '<span class="pl-dim">서명 이미지 없음</span>'}</div>
      </div>
      ${o ? `<div class="pl-orig"><b>처음 제출 값</b> ${esc([o.name, o.dept, o.position, o.empId].filter(Boolean).join(" · "))}${o.at && o.at !== r.at ? " · " + esc(kDate(o.at) + " " + kTime(o.at)) : ""}</div>` : ""}
      ${files.length ? `<div class="pl-files"><b>첨부</b> ${files.map(f => `<a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name || "파일")}</a>`).join(" ")}</div>` : ""}
      ${hist.length > 1 ? `<div class="pl-hist"><b>서약 이력 ${hist.length}건</b><ul>${hist.map(h => `<li${h.id === r.id ? ' class="on"' : ""}><button type="button" data-pl-h="${esc(h.id)}">${esc(kDate(h.at))}</button> ${esc(h.dept)} · ${esc(h.position)} ${badge(STATE[h.state])}</li>`).join("")}</ul></div>` : ""}
      <div class="modal-actions">
        ${SeMIS.isAdmin() ? '<button class="btn btn-danger" id="pl-del">삭제</button><span style="flex:1"></span>' : ""}
        <button class="btn btn-ghost" id="pl-dt-print">서약서 인쇄</button>
        <button class="btn btn-ghost" id="pl-dt-edit">수정</button>
        <button class="btn btn-primary" id="pl-dt-x">닫기</button>
      </div></div>`, { wide: true });
    $("#pl-dt-x").onclick = closeModal;
    $("#pl-dt-edit").onclick = () => openEdit(r);
    $("#pl-dt-print").onclick = () => printPledge(r);
    $$("[data-pl-h]").forEach(b => b.onclick = () => openDetail(b.getAttribute("data-pl-h")));
    const del = $("#pl-del");
    if (del) del.onclick = () => confirmModal(`${r.name} (${kDate(r.at)}) 서약 기록을 삭제합니다. 되돌릴 수 없습니다 — 퇴직·오기재는 '상태'로 처리하는 것을 권장합니다.`, async () => {
      try {
        const d = await rpc("semis_v2_pledge_delete", { p_id: r.id });
        if (!d || !d.ok) throw new Error((d && d.error) || "delete");
        st.rows = (st.rows || []).filter(x => x.id !== r.id);
        delete st.signs[r.id];
        toast("삭제했습니다.");
        paintTop(); paintList();
      } catch (e) { toast("삭제하지 못했습니다.", true); }
    });
    if (r.hasSign) loadSigns([r.id]).then(() => {
      const box = $("#pl-dt-sign");
      if (box && st.signs[r.id]) box.innerHTML = `<img src="${st.signs[r.id]}" alt="${esc(r.name)} 서명">`;
    }).catch(() => { const box = $("#pl-dt-sign"); if (box) box.innerHTML = '<span class="pl-dim">서명을 불러오지 못했습니다.</span>'; });
  }

  /* ─────────── 수정 · 종이 서약 등록 ─────────── */
  function openEdit(r) {
    const isNew = !r;
    const v = r || { name: "", dept: "", position: "", empId: "", at: new Date().toISOString(), lang: "ko", state: "valid", stateAt: "", stateNote: "", note: "", files: [], src: "paper" };
    let files = (Array.isArray(v.files) ? v.files : []).slice();
    const fileList = () => files.length ? files.map((f, i) => `<span class="pl-fchip"><a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name || "파일")}</a><button type="button" data-pl-fx="${i}" aria-label="첨부 빼기">×</button></span>`).join("") : '<span class="pl-dim">없음</span>';
    openModal(`<h3>${isNew ? "종이 서약 등록" : "서약 기록 수정"}</h3>
      <div class="form-grid">
        <div class="form-row"><label>성명</label><input id="pe-name" maxlength="60" value="${esc(v.name)}"></div>
        <div class="form-row"><label>사번 / 생년월일</label><input id="pe-emp" maxlength="40" value="${esc(v.empId)}"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>소속</label><input id="pe-dept" maxlength="80" value="${esc(v.dept)}"></div>
        <div class="form-row"><label>직위</label><input id="pe-pos" maxlength="60" value="${esc(v.position)}"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>서약일</label><input type="date" id="pe-date" value="${esc(kDate(v.at))}"></div>
        <div class="form-row"><label>시각</label><input type="time" id="pe-time" value="${esc(isNew ? "" : kTime(v.at))}"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>상태</label><select id="pe-state">${Object.keys(STATE).map(k => `<option value="${k}"${v.state === k ? " selected" : ""}>${STATE[k][0]}</option>`).join("")}</select></div>
        <div class="form-row"><label>서약 문구</label><select id="pe-lang"><option value="ko"${v.lang !== "en" ? " selected" : ""}>국문</option><option value="en"${v.lang === "en" ? " selected" : ""}>영문</option></select></div>
      </div>
      <div class="form-grid pl-stateopt${v.state === "valid" ? " hidden" : ""}" id="pe-stbox">
        <div class="form-row"><label>상태 일자</label><input type="date" id="pe-stat" value="${esc(v.stateAt || todayK())}"></div>
        <div class="form-row"><label>사유</label><input id="pe-stnote" maxlength="500" value="${esc(v.stateNote || "")}"></div>
      </div>
      <div class="form-row"><label>비고</label><textarea id="pe-note" maxlength="2000" rows="2">${esc(v.note || "")}</textarea></div>
      <div class="form-row"><label>첨부 ${isNew || v.src === "paper" ? "(서약서 스캔)" : ""}</label>
        <div class="pl-fbox"><span id="pe-files">${fileList()}</span>
          <label class="btn btn-ghost btn-sm pl-up">파일 올리기<input type="file" id="pe-file" multiple hidden></label></div></div>
      ${!isNew && v.src !== "paper" ? '<p class="pl-mini">성명 · 소속 · 직위 · 사번 · 일시를 고치면 처음 제출 값이 함께 보관됩니다.</p>' : ""}
      <div class="modal-actions"><button class="btn btn-ghost" id="pe-x">취소</button><button class="btn btn-primary" id="pe-save">저장</button></div>`, { wide: true });
    const paintFiles = () => {
      $("#pe-files").innerHTML = fileList();
      $$("[data-pl-fx]").forEach(b => b.onclick = () => { files.splice(Number(b.getAttribute("data-pl-fx")), 1); paintFiles(); });
    };
    paintFiles();
    $("#pe-state").onchange = () => $("#pe-stbox").classList.toggle("hidden", $("#pe-state").value === "valid");
    $("#pe-file").onchange = async (e) => {
      const list = Array.from(e.target.files || []);
      e.target.value = "";
      for (const f of list) {
        if (f.size > 20 * 1024 * 1024) { toast(f.name + " — 20MB 이하만 올릴 수 있습니다.", true); continue; }
        try { const up = await SemisSync.uploadFile(f, "pledges"); files.push({ name: up.name, size: up.size, url: up.url }); paintFiles(); }
        catch (err) { toast(f.name + " 업로드 실패", true); }
      }
    };
    $("#pe-x").onclick = closeModal;
    $("#pe-save").onclick = async () => {
      const name = $("#pe-name").value.trim();
      const date = $("#pe-date").value;
      if (!name) { toast("성명을 입력하세요.", true); $("#pe-name").focus(); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("서약일을 입력하세요.", true); $("#pe-date").focus(); return; }
      const time = $("#pe-time").value || (isNew ? "09:00" : kTime(v.at) || "09:00");
      const at = date + "T" + time + ":00+09:00";
      const state = $("#pe-state").value;
      const p = {
        id: isNew ? "" : v.id, name, dept: $("#pe-dept").value.trim(), position: $("#pe-pos").value.trim(), empId: $("#pe-emp").value.trim(),
        lang: $("#pe-lang").value, state, stateAt: state === "valid" ? "" : $("#pe-stat").value, stateNote: state === "valid" ? "" : $("#pe-stnote").value.trim(),
        note: $("#pe-note").value.trim(), files
      };
      if (isNew || kDate(v.at) !== date || kTime(v.at) !== time) p.at = at;
      const btn = $("#pe-save");
      btn.disabled = true;
      try {
        const d = await rpc("semis_v2_pledge_save", { p });
        if (!d || !d.ok || !d.row) throw new Error((d && d.error) || "save");
        const row = d.row;
        const i = (st.rows || []).findIndex(x => x.id === row.id);
        if (!st.rows) st.rows = [];
        if (i >= 0) st.rows[i] = row; else st.rows.unshift(row);
        st.rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
        toast(isNew ? "등록했습니다." : "저장했습니다.");
        paintTop(); refreshTools(); paintList();
        openDetail(row.id);
      } catch (e) {
        btn.disabled = false;
        const code = String((e && e.message) || "");
        toast(code === "date" ? "서약일을 확인하세요." : code === "too_long" ? "입력이 너무 깁니다." : "저장하지 못했습니다.", true);
      }
    };
  }

  /* 새 제출 · 다른 사람의 수정 — 이 화면을 보고 있으면 다시 읽는다 */
  if (typeof window !== "undefined") window.addEventListener("semis-remote", (e) => {
    const k = e && e.detail && e.detail.key;
    if (k !== "pledges") return;
    st.at = 0;
    if (document.getElementById("pl-page")) refresh(true);
  });

  SeMIS.registerModule(MOD, { title: TITLE, render });

  if (window.SemisSearch) SemisSearch.register({
    id: MOD, group: "보안서약서", icon: "㊙️", module: MOD,
    items: () => (st.rows ? people(st.rows) : []).map(p => ({ title: p.lead.name, sub: [p.lead.dept, p.lead.position, kDate(p.lead.at)].filter(Boolean).join(" · "), route: MOD }))
  });

  window.SemisPledges = { load, people, listed, stats, pkey, empKey, qrCard, formUrl, listPrintHTML, state: st, openDetail, openEdit };
})();
