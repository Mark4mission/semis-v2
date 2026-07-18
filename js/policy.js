/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 에어제타 보안정책 뷰어 모듈 (v2.14)
   국문/영문 PDF 2종 업로드 + 웹 뷰어

   데이터: DATA.policy = { ko: {url,name,size,updated,by}|null,
                           en: {url,name,size,updated,by}|null }
   - 뷰어: PDF.js(cdnjs, 지연 로드) 캔버스 렌더 — zoom(−/+/맞춤),
     인쇄(blob iframe), 다운로드(blob), 로드 실패 시 iframe 폴백
   - 보기 모드: 국문 / 영문 / 좌우 분할 (모바일은 상하 배치)
   - 업로드/교체/삭제: hq 이상 (canEdit — 시스템관리자·항공보안HQ)
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;

  const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const PDF_MAX = 50 * 1024 * 1024;
  const LS_UI = "semis2:policyUi";
  const LANGS = { ko: { label: "국문", flag: "🇰🇷", dl: "에어제타 보안정책(국문).pdf" },
                  en: { label: "English", flag: "🇺🇸", dl: "AirZeta Security Policy (EN).pdf" } };

  const pol = () => (D().policy && typeof D().policy === "object" ? D().policy : { ko: null, en: null });

  /* ─────── 뷰어 상태 ─────── */
  let mode = "ko";        // ko | en | split
  let zoom = "fit";       // "fit" | number
  let lastEff = 1;        // 마지막 적용 배율 (줌 단계 기준)
  const renderToken = {}; // lang → token (경합 방지)
  const docCache = {};    // url → Promise<pdfDoc>

  function loadUi() {
    try {
      const u = JSON.parse(localStorage.getItem(LS_UI)) || {};
      if (u.mode === "ko" || u.mode === "en" || u.mode === "split") mode = u.mode;
      if (u.zoom === "fit" || (typeof u.zoom === "number" && u.zoom >= 0.3 && u.zoom <= 3)) zoom = u.zoom;
    } catch (e) { /* 무시 */ }
  }
  function saveUi() {
    try { localStorage.setItem(LS_UI, JSON.stringify({ mode, zoom })); } catch (e) {}
  }

  /* ─────── PDF.js 지연 로드 ─────── */
  let pdfjsPromise = null;
  function loadPdfjs() {
    if (typeof window !== "undefined" && window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("pdfjs timeout")), 8000);
      try {
        const s = document.createElement("script");
        s.src = PDFJS_CDN;
        s.onload = () => {
          clearTimeout(to);
          try {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
            resolve(window.pdfjsLib);
          } catch (e) { reject(e); }
        };
        s.onerror = () => { clearTimeout(to); reject(new Error("pdfjs load fail")); };
        document.head.appendChild(s);
      } catch (e) { clearTimeout(to); reject(e); }
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; }); // 실패 시 재시도 허용
    return pdfjsPromise;
  }

  /* ─────── 캔버스 렌더 (zoom 적용, 실패 시 iframe 폴백) ─────── */
  async function renderPdfInto(body, url, lang) {
    const token = (renderToken[lang] = (renderToken[lang] || 0) + 1);
    body.innerHTML = '<div class="pol-loading">📄 문서를 불러오는 중…</div>';
    try {
      const lib = await loadPdfjs();
      if (!docCache[url]) docCache[url] = lib.getDocument({ url }).promise;
      const doc = await docCache[url];
      if (renderToken[lang] !== token || !body.isConnected) return;
      const p1 = await doc.getPage(1);
      const baseW = p1.getViewport({ scale: 1 }).width;
      const avail = Math.max(body.clientWidth - 36, 200);
      const fit = Math.min(Math.max(avail / baseW, 0.3), 3);
      const eff = zoom === "fit" ? fit : zoom;
      lastEff = eff;
      updateZoomLabel();
      body.innerHTML = "";
      const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
      for (let i = 1; i <= doc.numPages; i++) {
        if (renderToken[lang] !== token || !body.isConnected) return;
        const page = i === 1 ? p1 : await doc.getPage(i);
        const vp = page.getViewport({ scale: eff });
        const cv = document.createElement("canvas");
        cv.className = "pol-page";
        cv.width = Math.floor(vp.width * ratio);
        cv.height = Math.floor(vp.height * ratio);
        cv.style.width = Math.floor(vp.width) + "px";
        cv.style.height = Math.floor(vp.height) + "px";
        body.appendChild(cv);
        const rc = { canvasContext: cv.getContext("2d"), viewport: vp };
        if (ratio !== 1) rc.transform = [ratio, 0, 0, ratio, 0, 0];
        await page.render(rc).promise;
      }
      const foot = document.createElement("div");
      foot.className = "pol-pagecount";
      foot.textContent = "총 " + doc.numPages + "페이지";
      body.appendChild(foot);
    } catch (e) {
      if (renderToken[lang] !== token || !body.isConnected) return;
      // 폴백: 브라우저 내장 PDF 뷰어 (zoom/인쇄는 내장 뷰어 기능 사용)
      body.innerHTML = `<iframe class="pol-fallback" src="${esc(url)}" title="보안정책 PDF"></iframe>`;
    }
  }

  /* ─────── 인쇄 / 다운로드 (blob — Supabase Storage CORS 허용) ─────── */
  async function printPdf(url) {
    try {
      toast("인쇄 준비 중…");
      const res = await fetch(url);
      if (!res.ok) throw new Error("fetch " + res.status);
      const burl = URL.createObjectURL(await res.blob());
      const fr = document.createElement("iframe");
      fr.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;visibility:hidden";
      fr.src = burl;
      fr.onload = () => {
        try { fr.contentWindow.focus(); fr.contentWindow.print(); }
        catch (e) { window.open(burl, "_blank"); }
      };
      document.body.appendChild(fr);
      setTimeout(() => { try { fr.remove(); URL.revokeObjectURL(burl); } catch (e) {} }, 120000);
    } catch (e) {
      try { window.open(url, "_blank"); } catch (e2) {}
      toast("브라우저 인쇄 대화상자를 사용할 수 없어 새 탭으로 엽니다.", true);
    }
  }
  async function downloadPdf(url, name) {
    try {
      toast("다운로드 준비 중…");
      const res = await fetch(url);
      if (!res.ok) throw new Error("fetch " + res.status);
      const burl = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = burl;
      a.download = name || "policy.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(burl); } catch (e) {} }, 30000);
    } catch (e) {
      try { window.open(url, "_blank"); } catch (e2) {}
      toast("직접 다운로드가 불가하여 새 탭으로 엽니다.", true);
    }
  }

  /* ─────── 파일 관리 (hq+): 업로드/교체/삭제 ─────── */
  function fmtSize(n) {
    if (!n) return "";
    return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  }
  function manageForm() {
    if (!SeMIS.canEdit()) return;
    const p = pol();
    const row = (lang) => {
      const f = p[lang];
      const L = LANGS[lang];
      return `
      <div class="form-row"><label>${L.flag} ${L.label} PDF</label>
        <div class="nb-files-view" id="pm-cur-${lang}">
          ${f ? `<span class="nb-file">📄 ${esc(f.name)}${f.size ? " · " + fmtSize(f.size) : ""}
            <button type="button" class="mt-btn danger" data-pm-del="${lang}" title="삭제">✕</button></span>
            <span class="form-hint">등록: ${esc(String(f.updated || "").slice(0, 10))}${f.by ? " · " + esc(f.by) : ""}</span>`
          : '<span class="form-hint">등록된 파일이 없습니다.</span>'}
        </div>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;align-self:flex-start">⬆ ${f ? "교체 업로드" : "PDF 업로드"} (50MB 이하)
          <input type="file" data-pm-up="${lang}" accept="application/pdf,.pdf" style="display:none"></label>
      </div>`;
    };
    openModal(`
      <h3>🛡️ 보안정책 파일 관리 <span class="badge badge-amber">HQ 이상</span></h3>
      <p class="form-hint" style="margin-bottom:12px">국문/영문 PDF를 각각 업로드합니다. 업로드 즉시 모든 사용자에게 반영됩니다.</p>
      ${row("ko")}${row("en")}
      <div class="modal-actions"><button class="btn btn-primary" id="pm-close">닫기</button></div>`);
    $("#pm-close").onclick = () => { closeModal(); SeMIS.renderView(); };
    $$("#modal-box [data-pm-up]").forEach(inp => inp.onchange = async (e) => {
      const file = e.target.files[0]; e.target.value = "";
      if (!file) return;
      const lang = inp.dataset.pmUp;
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
      if (!isPdf) { toast("PDF 파일만 업로드할 수 있습니다.", true); return; }
      if (file.size > PDF_MAX) { toast("50MB를 초과합니다.", true); return; }
      if (!window.SemisSync || typeof fetch === "undefined") { toast("오프라인에서는 업로드할 수 없습니다.", true); return; }
      toast("업로드 중: " + file.name);
      try {
        const up = await SemisSync.uploadFile(file, "policy");
        const old = pol()[lang];
        D().policy[lang] = { url: up.url, name: file.name, size: file.size || 0,
          updated: new Date().toISOString(), by: SeMIS.user ? SeMIS.user.name : "" };
        if (old && old.url) delete docCache[old.url];
        delete docCache[up.url];
        SeMIS.save(); toast(LANGS[lang].label + " PDF가 등록되었습니다.");
        manageForm(); // 목록 갱신
      } catch (err) { toast("업로드 실패 — 네트워크를 확인하세요.", true); }
    });
    $$("#modal-box [data-pm-del]").forEach(b => b.onclick = () => {
      const lang = b.dataset.pmDel;
      confirmModal(LANGS[lang].label + " PDF를 삭제하시겠습니까?", () => {
        const old = pol()[lang];
        if (old && old.url) delete docCache[old.url];
        D().policy[lang] = null;
        SeMIS.save(); toast("삭제되었습니다.");
        manageForm();
      });
    });
  }

  /* ─────── 페이지 렌더 ─────── */
  function updateZoomLabel() {
    const el = $("#pol-zoom-pct");
    if (el) el.textContent = Math.round((zoom === "fit" ? lastEff : zoom) * 100) + "%";
  }
  function paneHTML(lang) {
    const f = pol()[lang];
    const L = LANGS[lang];
    return `
      <div class="pol-pane" data-pol-pane="${lang}">
        <div class="pol-pane-head">
          <span>${L.flag} ${L.label}</span>
          ${f ? `<span class="pol-pane-file" title="${esc(f.name)}">${esc(f.name)}</span>` : ""}
          <span class="spacer"></span>
          ${f ? `<button class="btn btn-ghost btn-sm" data-pol-print="${lang}" title="인쇄">🖨</button>
            <button class="btn btn-ghost btn-sm" data-pol-dl="${lang}" title="다운로드">⬇</button>` : ""}
        </div>
        <div class="pol-pane-body" data-pol-body="${lang}">
          ${f ? "" : `<div class="pol-empty">
            <div style="font-size:2rem">📄</div>
            <div>${L.label} PDF가 아직 등록되지 않았습니다.</div>
            ${SeMIS.canEdit() ? '<button class="btn btn-primary btn-sm" data-pol-upload style="margin-top:10px">⬆ PDF 업로드</button>' : '<div class="form-hint">항공보안HQ에 등록을 요청하세요.</div>'}
          </div>`}
        </div>
      </div>`;
  }

  function renderPage(root) {
    loadUi();
    const canWrite = SeMIS.canEdit();
    const langs = mode === "split" ? ["ko", "en"] : [mode];
    root.innerHTML = `
      <div class="page-head">
        <div class="page-title">🛡️ 에어제타 보안정책</div>
        <span class="spacer"></span>
        ${canWrite ? '<button class="btn btn-primary" id="pol-manage">⚙ 파일 관리</button>' : ""}
        <div class="page-desc">AirZeta Security Policy — 국문/영문 원문 열람 · 인쇄 · 다운로드</div>
      </div>
      <div class="card">
        <div class="pol-toolbar">
          <div class="cal-views">
            <button class="cal-viewbtn${mode === "ko" ? " active" : ""}" data-pol-mode="ko">국문</button>
            <button class="cal-viewbtn${mode === "en" ? " active" : ""}" data-pol-mode="en">English</button>
            <button class="cal-viewbtn${mode === "split" ? " active" : ""}" data-pol-mode="split">◫ 좌우 분할</button>
          </div>
          <span class="spacer"></span>
          <div class="pol-zoom">
            <button class="btn btn-ghost btn-sm" id="pol-zoom-out" title="축소">−</button>
            <span id="pol-zoom-pct">${Math.round((zoom === "fit" ? lastEff : zoom) * 100)}%</span>
            <button class="btn btn-ghost btn-sm" id="pol-zoom-in" title="확대">＋</button>
            <button class="btn btn-ghost btn-sm" id="pol-zoom-fit" title="폭 맞춤">↔ 맞춤</button>
          </div>
        </div>
        <div class="pol-panes${mode === "split" ? " split" : ""}">
          ${langs.map(paneHTML).join("")}
        </div>
      </div>`;

    // 모드 전환
    $$("[data-pol-mode]").forEach(b => b.onclick = () => {
      mode = b.dataset.polMode; saveUi(); SeMIS.renderView();
    });
    // 줌
    const rerenderDocs = () => {
      saveUi();
      langs.forEach(lang => {
        const f = pol()[lang];
        const body = $(`[data-pol-body="${lang}"]`, root);
        if (f && body) renderPdfInto(body, f.url, lang);
      });
    };
    $("#pol-zoom-in").onclick = () => { zoom = Math.min(Math.round((zoom === "fit" ? lastEff : zoom) * 1.2 * 100) / 100, 3); rerenderDocs(); updateZoomLabel(); };
    $("#pol-zoom-out").onclick = () => { zoom = Math.max(Math.round(((zoom === "fit" ? lastEff : zoom) / 1.2) * 100) / 100, 0.3); rerenderDocs(); updateZoomLabel(); };
    $("#pol-zoom-fit").onclick = () => { zoom = "fit"; rerenderDocs(); };
    // 인쇄/다운로드
    $$("[data-pol-print]", root).forEach(b => b.onclick = () => {
      const f = pol()[b.dataset.polPrint];
      if (f) printPdf(f.url);
    });
    $$("[data-pol-dl]", root).forEach(b => b.onclick = () => {
      const lang = b.dataset.polDl, f = pol()[lang];
      if (f) downloadPdf(f.url, f.name || LANGS[lang].dl);
    });
    // 관리
    if (canWrite) {
      if ($("#pol-manage")) $("#pol-manage").onclick = manageForm;
      $$("[data-pol-upload]", root).forEach(b => b.onclick = manageForm);
    }
    // 문서 렌더
    langs.forEach(lang => {
      const f = pol()[lang];
      const body = $(`[data-pol-body="${lang}"]`, root);
      if (f && body) renderPdfInto(body, f.url, lang);
    });
  }

  SeMIS.registerModule("policy", { title: "에어제타 보안정책", render(root) { renderPage(root); } });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisPolicy = {
    LANGS, pol, manageForm, printPdf, downloadPdf, loadPdfjs, fmtSize,
    get mode() { return mode; }, setMode: (m) => { mode = m; },
    get zoom() { return zoom; }, setZoom: (z) => { zoom = z; }
  };
})();
