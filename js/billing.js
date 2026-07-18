/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 대금 청구 관리 모듈 (v2.16)
   협력업체(프로에스콤·인씨스)가 매월 직접 청구 내역을 입력하고,
   에어제타(HQ 이상)가 전체를 확인·정산하는 화면.

   데이터: DATA.billing = [{ id, vendor, month "YYYY-MM", category,
     title, amount(원, 숫자), fileUrl, fileName, note, by, updated }]

   업체/카테고리:
   - 프로에스콤: ETD 유지보수 / 보안검색&경비 / 기타 수익
   - 인씨스:     X-ray 유지보수
   정산(프로에스콤 계약): 기타 수익(터키항공 B터미널 보안검색·특별보안검색 등)의
   50%는 에어제타 몫 — 별도 지급이 아니라 당월 보안검색&경비(도급비) 청구액에서
   차감하여 청구. 실청구액 = ETD + 보안검색&경비 − 기타수익×50%.

   권한:
   - vendor 역할(업체 계정): 자기 업체 내역만 입력/조회 (타 업체 차단)
   - admin/hq: 전체 업체 조회·편집·정산 요약
   - manager 이하: 접근 불가 (메뉴 vis "hq" — 비용은 대외비)
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const PDF_MAX = 20 * 1024 * 1024;

  const VENDORS = {
    "프로에스콤": {
      icon: "🛡", cats: ["ETD 유지보수", "보안검색&경비", "기타 수익"],
      revenueCat: "기타 수익", share: 0.5,
      hint: { "ETD 유지보수": "장비 잔존가+수선유지비, 부품교체건 등 (보안장비 대금청구)",
              "보안검색&경비": "보안검색·경비 도급비 청구액",
              "기타 수익": "터키항공 B터미널 보안검색(물량×단가)·특별보안검색 등 수익 발생 내역 — 50%는 도급비 청구 시 차감" }
    },
    "인씨스": {
      icon: "🖥", cats: ["X-ray 유지보수"], revenueCat: null, share: 0,
      hint: { "X-ray 유지보수": "X-ray 장비 유지보수 대금 청구 내역" }
    }
  };
  const CAT_BADGE = { "ETD 유지보수": "badge-blue", "보안검색&경비": "badge-green",
    "기타 수익": "badge-amber", "X-ray 유지보수": "badge-blue" };

  /* v2.17: 장비 비용 기록 연동 — 장비 유지보수 성격 카테고리 (도급비·수익은 장비 비용 아님) */
  const MAINT_CATS = ["ETD 유지보수", "X-ray 유지보수"];
  const COST_KINDS = ["정기 유지보수", "수리/부품"];
  /* 비용 구분 판정: 항목의 costKind 명시값 우선, 없으면 내용(제목·메모) 기반 자동 분류 */
  function classifyCost(r) {
    if (r && COST_KINDS.includes(r.costKind)) return r.costKind;
    const txt = String((r && r.title) || "") + " " + String((r && r.note) || "");
    return /부품|교체|수리|파트|part/i.test(txt) ? "수리/부품" : "정기 유지보수";
  }

  const list = () => (Array.isArray(D().billing) ? D().billing : []);
  const thisMonth = () => new Date().toISOString().slice(0, 7);
  const fmtWon = (n) => Math.round(Number(n) || 0).toLocaleString("ko-KR");
  const parseWon = (s) => Number(String(s == null ? "" : s).replace(/[,\s원]/g, "")) || 0;

  /* 접근 컨텍스트: vendor 계정 → 자기 업체 고정, hq+ → 전체 */
  const isVendorUser = () => !!(SeMIS.user && SeMIS.user.role === "vendor");
  const myVendor = () => (isVendorUser() ? String(SeMIS.user.vendor || "") : null);
  const canWriteFor = (vendor) => SeMIS.canEdit() || (isVendorUser() && myVendor() === vendor);
  /* 조회 가능한 레코드 (vendor는 자기 업체만 — 타 업체 격리) */
  function visible() {
    if (isVendorUser()) return list().filter(r => r && r.vendor === myVendor());
    return SeMIS.canEdit() ? list() : [];
  }
  const recsOf = (vendor, month) => visible().filter(r => r.vendor === vendor && r.month === month);

  /* ─────── 정산 계산 ─────── */
  function settle(vendor, month) {
    const cfg = VENDORS[vendor] || { cats: [], revenueCat: null, share: 0 };
    const byCat = {};
    cfg.cats.forEach(c => { byCat[c] = 0; });
    recsOf(vendor, month).forEach(r => {
      if (byCat[r.category] == null) byCat[r.category] = 0;
      byCat[r.category] += Number(r.amount) || 0;
    });
    const revenue = cfg.revenueCat ? (byCat[cfg.revenueCat] || 0) : 0;
    const deduct = revenue * (cfg.share || 0);
    const pay = cfg.cats.filter(c => c !== cfg.revenueCat).reduce((s, c) => s + (byCat[c] || 0), 0);
    return { byCat, revenue, deduct, pay, net: pay - deduct };
  }
  /* 연간 집계 (equipment 비용 탭 연동용) */
  function yearSummary(year) {
    const out = [];
    Object.keys(VENDORS).forEach(vendor => {
      const months = {};
      let net = 0, any = false;
      visible().forEach(r => {
        if (r.vendor !== vendor || String(r.month || "").slice(0, 4) !== String(year)) return;
        any = true; months[r.month] = true;
      });
      Object.keys(months).forEach(m => { net += settle(vendor, m).net; });
      if (any) out.push({ vendor, months: Object.keys(months).length, net });
    });
    return out;
  }
  /* v2.17: 장비 비용 기록 자동 반영 — 유지보수 성격 항목을 equipMaint.costs 형태의 가상 행으로 변환.
     billing 원본에서 렌더 시마다 계산되므로 업체 입력 수정이 비용 기록 집계에 즉시 반영됨. */
  function maintRows(year) {
    return visible()
      .filter(r => r && MAINT_CATS.includes(r.category) && String(r.month || "").slice(0, 4) === String(year))
      .map(r => ({ id: "bl:" + r.id, srcId: r.id, ym: r.month, kind: classifyCost(r),
        vendor: r.vendor, amount: Number(r.amount) || 0,
        memo: r.title + (r.note ? " · " + r.note : ""), auto: true }));
  }
  /* v2.17: 연도 내 월별 정산 결과 (settle() 그대로) — 비용 기록 탭 월별 정산표용 */
  function monthlySettles(year) {
    const out = [];
    Object.keys(VENDORS).forEach(vendor => {
      const months = {};
      visible().forEach(r => {
        if (r && r.vendor === vendor && String(r.month || "").slice(0, 4) === String(year)) months[r.month] = true;
      });
      Object.keys(months).sort().forEach(m => out.push({ vendor, month: m, s: settle(vendor, m) }));
    });
    return out.sort((a, b) => a.month.localeCompare(b.month) || a.vendor.localeCompare(b.vendor, "ko"));
  }

  /* ─────── 항목 폼 ─────── */
  function itemForm(vendor, month, catPreset, id) {
    if (!canWriteFor(vendor)) return;
    const cfg = VENDORS[vendor];
    const x = id ? list().find(r => r.id === id) : null;
    if (x && isVendorUser() && x.vendor !== myVendor()) return; // 격리 가드
    let file = x && x.fileUrl ? { url: x.fileUrl, name: x.fileName || "청구서.pdf" } : null;
    openModal(`
      <h3>${x ? "청구 항목 수정" : "청구 항목 추가"} <span class="badge badge-gray">${esc(vendor)} · ${esc(month)}</span></h3>
      <div class="form-grid">
        <div class="form-row"><label>귀속 월</label>
          <input type="month" id="bl-month" value="${esc(x ? x.month : month)}"></div>
        <div class="form-row"><label>구분</label>
          <select id="bl-cat">${cfg.cats.map(c =>
            `<option ${(x ? x.category : (catPreset || cfg.cats[0])) === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      </div>
      <div class="form-row"><label>내역 (항목명)</label>
        <input id="bl-title" value="${esc(x ? x.title : "")}" maxlength="120"
          placeholder="예: 장비 잔존가+수선유지비 (KJ) / B터미널 보안검색 (물량 1,363,167 × 6.5원)"></div>
      <div class="form-row"><label>금액 (원)</label>
        <input id="bl-amount" inputmode="numeric" value="${x ? esc(fmtWon(x.amount)) : ""}" placeholder="예: 5,170,000">
        <div class="form-hint" id="bl-cat-hint"></div></div>
      <div class="form-row" id="bl-costkind-row"><label>장비 비용 기록 반영 구분 <span style="font-weight:400;color:var(--text-3)">(보안장비 유지관리 · 비용 기록 탭 자동 집계)</span></label>
        <select id="bl-costkind">
          <option value="">자동 판별 — 내용에 '부품·교체·수리' 포함 시 수리/부품, 그 외 정기 유지보수</option>
          ${COST_KINDS.map(k => `<option value="${k}" ${x && x.costKind === k ? "selected" : ""}>${k}</option>`).join("")}
        </select></div>
      <div class="form-row"><label>증빙 PDF (선택 — 청구서·명세서 등)</label>
        <div id="bl-file-box" class="nb-files-view"></div>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;align-self:flex-start">📎 PDF 업로드 (20MB 이하)
          <input type="file" id="bl-file" accept="application/pdf,.pdf" style="display:none"></label></div>
      <div class="form-row"><label>메모</label>
        <input id="bl-note" value="${esc(x ? x.note || "" : "")}" maxlength="200" placeholder="예: 12월 도급비 청구 시 차감 예정"></div>
      <div class="modal-actions">
        ${x ? '<button class="btn btn-danger" id="bl-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="bl-cancel">취소</button>
        <button class="btn btn-primary" id="bl-save">저장</button>
      </div>`, { wide: true });

    const updHint = () => {
      $("#bl-cat-hint").textContent = cfg.hint[$("#bl-cat").value] || "";
      // 장비 유지보수 성격 카테고리에서만 비용 반영 구분 노출
      $("#bl-costkind-row").style.display = MAINT_CATS.includes($("#bl-cat").value) ? "" : "none";
    };
    $("#bl-cat").onchange = updHint; updHint();
    const renderFile = () => {
      $("#bl-file-box").innerHTML = file
        ? `<span class="nb-file">📎 ${esc(file.name)} <button type="button" class="mt-btn danger" id="bl-file-rm">✕</button></span>`
        : '<span class="form-hint">첨부된 파일이 없습니다.</span>';
      if (file && $("#bl-file-rm")) $("#bl-file-rm").onclick = () => { file = null; renderFile(); };
    };
    renderFile();
    $("#bl-file").onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = "";
      if (!f) return;
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
      if (!isPdf) { toast("PDF 파일만 업로드할 수 있습니다.", true); return; }
      if (f.size > PDF_MAX) { toast("20MB를 초과합니다.", true); return; }
      if (!window.SemisSync || typeof fetch === "undefined") { toast("오프라인에서는 업로드할 수 없습니다.", true); return; }
      toast("업로드 중: " + f.name);
      try {
        const up = await SemisSync.uploadFile(f, "billing");
        file = { url: up.url, name: f.name }; renderFile();
        toast("업로드되었습니다.");
      } catch (err) { toast("업로드 실패 — 네트워크를 확인하세요.", true); }
    };

    $("#bl-cancel").onclick = closeModal;
    if (x) $("#bl-del").onclick = () =>
      confirmModal("이 청구 항목을 삭제하시겠습니까?", () => {
        D().billing = list().filter(r => r.id !== x.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    $("#bl-save").onclick = () => {
      const m = $("#bl-month").value;
      const title = $("#bl-title").value.trim();
      const amount = parseWon($("#bl-amount").value);
      if (!/^\d{4}-\d{2}$/.test(m)) { toast("귀속 월을 선택하세요.", true); return; }
      if (!title) { toast("내역(항목명)을 입력하세요.", true); return; }
      if (!amount) { toast("금액을 입력하세요.", true); return; }
      const cat = $("#bl-cat").value;
      const rec = { vendor, month: m, category: cat, title, amount,
        costKind: MAINT_CATS.includes(cat) ? $("#bl-costkind").value : "",
        fileUrl: file ? file.url : "", fileName: file ? file.name : "",
        note: $("#bl-note").value.trim(),
        by: SeMIS.user ? SeMIS.user.name : "", updated: new Date().toISOString() };
      if (x) Object.assign(x, rec);
      else D().billing.push(Object.assign({ id: uid("bl") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ─────── 화면 구성 ─────── */
  let curVendor = null;   // hq 전용 (vendor 계정은 자기 업체 고정)
  let curMonth = null;

  function catCard(vendor, month, cat, canWrite) {
    const items = recsOf(vendor, month).filter(r => r.category === cat);
    const sum = items.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    return `
      <div class="card">
        <div class="card-title"><span class="badge ${CAT_BADGE[cat] || "badge-gray"}">${esc(cat)}</span>
          <span style="font-size:.76rem;font-weight:500;color:var(--text-3)">${esc(VENDORS[vendor].hint[cat] || "")}</span>
          <span class="spacer"></span>
          ${canWrite ? `<button class="btn btn-primary btn-sm" data-bl-add="${esc(cat)}">+ 항목 추가</button>` : ""}
        </div>
        ${items.length ? items.map(r => `
          <div class="bl-item" ${canWrite ? `data-bl-edit="${esc(r.id)}" style="cursor:pointer" title="클릭하여 수정"` : ""}>
            <span class="bl-item-title">${esc(r.title)}${r.note ? `<span class="bl-item-note"> · ${esc(r.note)}</span>` : ""}</span>
            ${r.fileUrl ? `<a class="nb-file" href="${esc(r.fileUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📎</a>` : ""}
            <b class="bl-item-amt">${fmtWon(r.amount)}원</b>
          </div>`).join("") + `
          <div class="bl-subtotal">소계 <b>${fmtWon(sum)}원</b></div>`
        : '<div class="form-hint" style="padding:6px 0">등록된 항목이 없습니다.</div>'}
      </div>`;
  }

  function summaryCard(vendor, month) {
    const s = settle(vendor, month);
    const cfg = VENDORS[vendor];
    if (vendor === "프로에스콤") {
      return `
      <div class="card bl-summary">
        <div class="card-title">📋 ${esc(month)} 정산 요약 — ${esc(vendor)}</div>
        <table class="tbl bl-sum-tbl">
          <tr><td>① ETD 유지보수 청구</td><td class="r">${fmtWon(s.byCat["ETD 유지보수"])}원</td></tr>
          <tr><td>② 보안검색&경비 (도급비) 청구</td><td class="r">${fmtWon(s.byCat["보안검색&경비"])}원</td></tr>
          <tr><td>③ 기타 수익 합계 (터키항공 등)</td><td class="r">${fmtWon(s.revenue)}원</td></tr>
          <tr class="bl-deduct"><td>④ 에어제타 수익 반환분 — ③ × 50% 차감</td><td class="r">− ${fmtWon(s.deduct)}원</td></tr>
          <tr class="bl-net"><td><b>당월 실청구액 (① + ② − ④)</b></td><td class="r"><b>${fmtWon(s.net)}원</b></td></tr>
        </table>
        <div class="form-hint" style="margin-top:8px">계약 조건: 인천화물터미널 B동 보안검색 수익(터키항공 등)은 에어제타와 50% 배분하되,
          별도 지급 없이 <b>당월 도급비 청구액에서 차감</b>하여 청구합니다.</div>
      </div>`;
    }
    return `
      <div class="card bl-summary">
        <div class="card-title">📋 ${esc(month)} 청구 요약 — ${esc(vendor)}</div>
        <table class="tbl bl-sum-tbl">
          ${cfg.cats.map(c => `<tr><td>${esc(c)} 청구</td><td class="r">${fmtWon(s.byCat[c])}원</td></tr>`).join("")}
          <tr class="bl-net"><td><b>당월 청구 합계</b></td><td class="r"><b>${fmtWon(s.net)}원</b></td></tr>
        </table>
      </div>`;
  }

  SeMIS.registerModule("billing", {
    title: "대금 청구 관리",
    render(root) {
      const vendorMode = isVendorUser();
      if (!vendorMode && !SeMIS.canEdit()) {
        root.innerHTML = '<div class="card"><div class="empty">🔒 접근 권한이 없습니다. (항공보안HQ 이상 · 협력업체 계정 전용)</div></div>';
        return;
      }
      const vendor = vendorMode ? myVendor() : (curVendor || Object.keys(VENDORS)[0]);
      if (!VENDORS[vendor]) {
        root.innerHTML = `<div class="card"><div class="empty">⚠ 계정에 업체 정보가 없습니다. 관리자에게 문의하세요. (${esc(vendor || "미지정")})</div></div>`;
        return;
      }
      if (!curMonth) curMonth = thisMonth();
      const month = curMonth;
      const canWrite = canWriteFor(vendor);
      const cfg = VENDORS[vendor];

      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🧾 대금 청구 ${vendorMode ? "입력" : "관리"} — ${cfg.icon} ${esc(vendor)}</div>
          <span class="spacer"></span>
          <div class="page-desc">${vendorMode
            ? "귀사(" + esc(vendor) + ")의 청구 내역만 표시됩니다. 매월 청구 항목을 입력해 주세요."
            : "협력업체별 월 청구 내역 확인 · 정산 (HQ 이상)"}</div>
        </div>
        ${vendorMode ? "" : `<div class="cal-views" style="margin-bottom:12px;align-self:flex-start;display:inline-flex">
          ${Object.keys(VENDORS).map(v =>
            `<button class="cal-viewbtn${vendor === v ? " active" : ""}" data-bl-vendor="${esc(v)}">${esc(VENDORS[v].icon)} ${esc(v)}</button>`).join("")}
        </div>`}
        <div class="card" style="padding:10px 16px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" id="bl-prev">◀</button>
            <input type="month" id="bl-cur-month" value="${esc(month)}" style="max-width:170px">
            <button class="btn btn-ghost btn-sm" id="bl-next">▶</button>
            <span class="spacer"></span>
            <span style="font-size:.8rem;color:var(--text-3)">항목 ${recsOf(vendor, month).length}건</span>
          </div>
        </div>
        ${cfg.cats.map(c => catCard(vendor, month, c, canWrite)).join("")}
        ${summaryCard(vendor, month)}`;

      // 월 이동
      const shiftMonth = (d) => {
        const [y, m] = month.split("-").map(Number);
        const nd = new Date(Date.UTC(y, m - 1 + d, 1));
        curMonth = nd.toISOString().slice(0, 7);
        SeMIS.renderView();
      };
      $("#bl-prev").onclick = () => shiftMonth(-1);
      $("#bl-next").onclick = () => shiftMonth(1);
      $("#bl-cur-month").onchange = () => {
        const v = $("#bl-cur-month").value;
        if (/^\d{4}-\d{2}$/.test(v)) { curMonth = v; SeMIS.renderView(); }
      };
      // 업체 전환 (hq)
      $$("[data-bl-vendor]").forEach(b => b.onclick = () => { curVendor = b.dataset.blVendor; SeMIS.renderView(); });
      // 항목 추가/수정
      if (canWrite) {
        $$("[data-bl-add]").forEach(b => b.onclick = () => itemForm(vendor, month, b.dataset.blAdd, null));
        $$("[data-bl-edit]").forEach(el => el.onclick = (ev) => {
          if (ev.target.closest("a")) return;
          itemForm(vendor, month, null, el.dataset.blEdit);
        });
      }
    }
  });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisBilling = {
    VENDORS, MAINT_CATS, list, visible, recsOf, settle, yearSummary,
    classifyCost, maintRows, monthlySettles, itemForm, parseWon, fmtWon,
    setVendor: (v) => { curVendor = v; },
    setMonth: (m) => { curMonth = m; },
    get month() { return curMonth; }
  };
})();
