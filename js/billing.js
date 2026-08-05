/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 대금 청구 관리 모듈 (v2.16 · v2.39 확장)
   협력업체(프로에스콤·인씨스)가 매월 직접 청구 내역을 입력하고,
   에어제타(HQ 이상)가 전체를 확인·정산하는 화면.

   데이터: DATA.billing = [{ id, vendor, month "YYYY-MM", category,
     title, amount(원, 숫자), files:[{url,name}](최대 5개, v2.17.1),
     fileUrl, fileName(구버전 단일 첨부 — filesOf()가 호환 처리), note, by, updated,
     costKind(v2.39: 정기 유지보수 / 수리·부품 / 소모품),
     equipGroup(v2.39: OZ+BX / KJ — ETD 장비군) }]

   v2.39 — "폭발물흔적탐지장비 유지보수비 비교 현황" 대장 기준으로 정렬:
   ① 장비 잔존가+수선유지비  ② 부품교체 및 수리비  ③ 소모품비 의 3분류와
   장비군(OZ+BX / KJ) 구분을 필드로 관리하고, 연간 비교표를 대장과 동일 형식으로 제공.

   업체/카테고리:
   - 프로에스콤: ETD 유지보수 / 보안검색&경비 / 기타 수익
   - 인씨스:     X-ray 유지보수
   정산(프로에스콤 계약): 기타 수익(터키항공 B터미널 보안검색·특별보안검색 등)은
   에어제타 몫 50%로 이미 계산된 금액을 업체가 그대로 입력 (100% 입력 후 재계산 없음).
   별도 지급이 아니라 당월 도급비 청구액에서 전액 차감.
   실청구액 = ① ETD + ② 보안검색&경비 − ③ 기타 수익(50% 기계산 입력분).

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
  const MAX_FILES = 5; // v2.17.1: 항목당 증빙 첨부 최대 개수

  /* 첨부 목록 조회 — 신규 files 배열 우선, 구버전 단일 fileUrl/fileName 호환 */
  function filesOf(r) {
    if (r && Array.isArray(r.files) && r.files.length)
      return r.files.filter(f => f && f.url).slice(0, MAX_FILES);
    return r && r.fileUrl ? [{ url: r.fileUrl, name: r.fileName || "청구서.pdf" }] : [];
  }

  const VENDORS = {
    "프로에스콤": {
      icon: "🛡", cats: ["ETD 유지보수", "보안검색&경비", "기타 수익"],
      revenueCat: "기타 수익", share: 1, // v2.17.1: 50% 기계산 금액을 그대로 입력받아 전액 차감
      hint: { "ETD 유지보수": "장비 잔존가+수선유지비, 부품교체건 등 (보안장비 대금청구)",
              "보안검색&경비": "보안검색·경비 도급비 청구액",
              "기타 수익": "터키항공 B터미널 보안검색·특별보안검색 등 — 에어제타 몫 50%로 계산된 금액을 그대로 입력 (당월 도급비 청구에서 전액 차감)" }
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
  /* v2.39: 유지보수비 대장(폭발물흔적탐지장비 비교 현황)과 동일한 3분류 */
  const COST_KINDS = ["정기 유지보수", "수리/부품", "소모품"];
  const KIND_LABEL = { "정기 유지보수": "장비 잔존가+수선유지비",
    "수리/부품": "부품교체 및 수리비", "소모품": "소모품비" };
  const KIND_BADGE = { "정기 유지보수": "badge-blue", "수리/부품": "badge-red", "소모품": "badge-amber" };
  const SUPPLY_RE = /소모품|소모성|스메어|스미어|스와브|swab|건조제|desiccant|카트리지|cartridge|필터|filter|시료|표준시료|샘플\s*트랩|트랩|시약|consumab/i;
  const REPAIR_RE = /부품|교체|수리|고장|파트|보드|board|part|repair/i;
  /* 비용 구분 판정: 항목의 costKind 명시값 우선, 없으면 내용(제목·메모) 기반 자동 분류.
     소모품 키워드를 먼저 확인 — "소모품 교체"처럼 두 키워드가 겹치면 소모품이 우선. */
  function classifyCost(r) {
    if (r && COST_KINDS.includes(r.costKind)) return r.costKind;
    const txt = String((r && r.title) || "") + " " + String((r && r.note) || "");
    if (SUPPLY_RE.test(txt)) return "소모품";
    return REPAIR_RE.test(txt) ? "수리/부품" : "정기 유지보수";
  }

  /* v2.39: 장비군 — ETD는 대장과 동일하게 OZ+BX / KJ 로 구분 집계 */
  const GROUP_CATS = { "ETD 유지보수": ["OZ+BX", "KJ"] };
  const groupsOf = (cat) => GROUP_CATS[cat] || [];
  /* v2.39.1: 장비군 운용 기간
     - 2025년 8월 KJ 통합출범 → 2025년은 OZ+BX·KJ 병행 기록 구간
     - OZ+BX 잔존가 청구는 2025년 12월로 종료 → 2026년부터는 KJ 단독
     - 2024년 이전은 OZ+BX 단독 */
  const GROUP_PERIOD = {
    "OZ+BX": { from: "", to: "2025-12" },
    "KJ": { from: "2025-08", to: "" }
  };
  const GROUP_MERGE_YM = "2025-08"; // KJ 통합출범 시점 (안내 표기용)
  const inPeriod = (g, ym) => {
    const p = GROUP_PERIOD[g];
    if (!p || !ym) return true;
    return !(p.from && ym < p.from) && !(p.to && ym > p.to);
  };
  /* 해당 월(YYYY-MM)에 운용 중인 장비군 */
  function groupsForMonth(cat, ym) {
    return groupsOf(cat).filter(g => inPeriod(g, ym));
  }
  /* 해당 연도에 운용 중인 장비군 (연간 비교표 열 구성) */
  function groupsForYear(cat, year) {
    const y = String(year);
    return groupsOf(cat).filter(g => {
      const p = GROUP_PERIOD[g] || {};
      return !(p.from && y < p.from.slice(0, 4)) && !(p.to && y > p.to.slice(0, 4));
    });
  }
  /* 장비군 판정: ① equipGroup 명시값 → ② 제목·메모의 (KJ)·(OZ+BX) 표기
     → ③ 해당 월에 운용 장비군이 하나뿐이면 그것으로 확정 (구데이터·2026년 이후 자동 보정) */
  function groupOf(r) {
    const cat = r && r.category;
    const gs = groupsOf(cat);
    if (!gs.length) return "";
    if (r && gs.includes(r.equipGroup)) return r.equipGroup;
    const txt = String((r && r.title) || "") + " " + String((r && r.note) || "");
    if (/\bKJ\b|\(\s*KJ\s*\)/i.test(txt)) return "KJ";
    if (/OZ\s*\+\s*BX|\(\s*OZ\s*\)|\(\s*BX\s*\)/i.test(txt)) return "OZ+BX";
    const only = groupsForMonth(cat, String((r && r.month) || ""));
    return only.length === 1 ? only[0] : "";
  }

  const list = () => (Array.isArray(D().billing) ? D().billing : []);
  const thisMonth = () => new Date().toISOString().slice(0, 7);
  const fmtWon = (n) => Math.round(Number(n) || 0).toLocaleString("ko-KR");
  const parseWon = (s) => Number(String(s == null ? "" : s).replace(/[,\s원]/g, "")) || 0;

  /* 접근 컨텍스트: vendor 계정 → 자기 업체 고정, hq+ → 전체 */
  const isVendorUser = () => !!(SeMIS.user && SeMIS.user.role === "vendor");
  const myVendor = () => (isVendorUser() ? String(SeMIS.user.vendor || "") : null);
  /* v2.32.1: 업체 계정은 편집 등급(VENDOR_ACCESS.edit)이 있어도 자기 업체 청구만 작성 가능 */
  const canWriteFor = (vendor) => (isVendorUser() ? myVendor() === vendor : SeMIS.canEdit());
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
        vendor: r.vendor, amount: Number(r.amount) || 0, equipGroup: groupOf(r),
        memo: r.title + (r.note ? " · " + r.note : ""), auto: true }));
  }
  /* v2.39: 유지보수비 연간 비교표 — 대장(엑셀)과 동일 구조.
     장비군(OZ+BX / KJ) × 비용구분(잔존가+수선유지비 / 부품교체·수리비 / 소모품비) 매트릭스.
     반환: { year, category, keys, months:[{ym, mon, cells}], totals, grand } */
  function yearTable(vendor, year, category) {
    const cfg = VENDORS[vendor] || { cats: [] };
    const cat = category || cfg.cats.find(c => MAINT_CATS.includes(c)) || "";
    const base = groupsOf(cat);
    const recs = visible().filter(r => r && r.vendor === vendor && r.category === cat
      && String(r.month || "").slice(0, 4) === String(year));
    const keyOf = (r) => (base.length ? (groupOf(r) || "미지정") : "전체");
    // 열 구성: 해당 연도 운용 장비군 기준 (2024 이전 OZ+BX / 2025 병행 / 2026~ KJ) + 실제 데이터 보정
    const keys = base.length ? groupsForYear(cat, year) : ["전체"];
    recs.forEach(r => { const k = keyOf(r); if (!keys.includes(k)) keys.push(k); });
    if (!keys.length) keys.push(base.length ? base[base.length - 1] : "전체");
    const blank = () => ({ base: 0, repair: 0, supply: 0, sub: 0, total: 0 });
    const add = (c, kind, amt) => {
      if (kind === "수리/부품") c.repair += amt;
      else if (kind === "소모품") c.supply += amt;
      else c.base += amt;
    };
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const ym = String(year) + "-" + String(m).padStart(2, "0");
      const cells = {}; keys.forEach(k => { cells[k] = blank(); });
      recs.filter(r => r.month === ym).forEach(r =>
        add(cells[keyOf(r)], classifyCost(r), Number(r.amount) || 0));
      keys.forEach(k => { const c = cells[k]; c.sub = c.repair + c.supply; c.total = c.base + c.sub; });
      months.push({ ym, mon: m, cells });
    }
    const totals = {}; keys.forEach(k => { totals[k] = blank(); });
    months.forEach(r => keys.forEach(k => {
      const s = totals[k], c = r.cells[k];
      s.base += c.base; s.repair += c.repair; s.supply += c.supply; s.sub += c.sub; s.total += c.total;
    }));
    return { year: Number(year), category: cat, keys, months, totals,
      grand: keys.reduce((s, k) => s + totals[k].total, 0),
      merged: base.length > 1 && String(year) === GROUP_MERGE_YM.slice(0, 4) };
  }
  /* 청구 입력이 존재하는 연도 목록 (연간 비교표 연도 이동 범위) */
  function yearsOf(vendor) {
    const ys = {};
    visible().forEach(r => {
      if (r && r.vendor === vendor && /^\d{4}-\d{2}$/.test(String(r.month || "")))
        ys[String(r.month).slice(0, 4)] = true;
    });
    return Object.keys(ys).sort();
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
    let files = filesOf(x).map(f => ({ url: f.url, name: f.name }));
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
      <div class="form-grid" id="bl-maint-row">
        <div class="form-row"><label>비용 구분 <span style="font-weight:400;color:var(--text-3)">(유지보수비 대장 3분류 · 비용 기록 탭 자동 집계)</span></label>
          <select id="bl-costkind">
            <option value="">자동 판별 — '소모품·건조제·스메어' → 소모품, '부품·교체·수리' → 수리/부품, 그 외 정기 유지보수</option>
            ${COST_KINDS.map(k => `<option value="${k}" ${x && x.costKind === k ? "selected" : ""}>${k} (${KIND_LABEL[k]})</option>`).join("")}
          </select></div>
        <div class="form-row" id="bl-group-row"><label>장비군 <span style="font-weight:400;color:var(--text-3)">(대장 집계 단위)</span></label>
          <select id="bl-equipgroup"></select>
          <div class="form-hint" id="bl-group-hint"></div></div>
      </div>
      <div class="form-row"><label>증빙 PDF (선택 — 청구서·명세서 등 · 최대 ${MAX_FILES}개)</label>
        <div id="bl-file-box" class="nb-files-view"></div>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer;align-self:flex-start">📎 PDF 업로드 (각 20MB 이하)
          <input type="file" id="bl-file" accept="application/pdf,.pdf" multiple style="display:none"></label></div>
      <div class="form-row"><label>메모</label>
        <input id="bl-note" value="${esc(x ? x.note || "" : "")}" maxlength="200" placeholder="예: 12월 도급비 청구 시 차감 예정"></div>
      <div class="modal-actions">
        ${x ? '<button class="btn btn-danger" id="bl-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="bl-cancel">취소</button>
        <button class="btn btn-primary" id="bl-save">저장</button>
      </div>`, { wide: true });

    /* 카테고리·귀속월에 따라 비용구분/장비군 노출 갱신.
       장비군 선택지는 해당 월에 운용 중인 것만 — 단일이면 자동 확정 (2024 이전 OZ+BX / 2026~ KJ) */
    const updHint = () => {
      const c = $("#bl-cat").value, ym = $("#bl-month").value;
      $("#bl-cat-hint").textContent = cfg.hint[c] || "";
      $("#bl-maint-row").style.display = MAINT_CATS.includes(c) ? "" : "none";
      const all = groupsOf(c);
      $("#bl-group-row").style.display = all.length ? "" : "none";
      if (!all.length) return;
      const live = groupsForMonth(c, ym);
      // 기존 항목이 운용 기간 밖 장비군이면 유지 (과거 데이터 보존)
      const opts = live.slice();
      if (x && x.equipGroup && !opts.includes(x.equipGroup)) opts.push(x.equipGroup);
      const sel = $("#bl-equipgroup"), prev = sel.value || (x ? x.equipGroup || "" : "");
      sel.innerHTML = (opts.length > 1 ? '<option value="">자동 판별 — 제목의 (KJ)·(OZ+BX) 표기 기준</option>' : "")
        + opts.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join("");
      sel.value = opts.includes(prev) ? prev : (opts.length === 1 ? opts[0] : "");
      $("#bl-group-hint").textContent = opts.length === 1
        ? `${ym || "해당 월"} 운용 장비군은 ${opts[0]} 뿐입니다 (2025년 8월 KJ 통합출범 · OZ+BX 청구는 2025년 12월 종료).`
        : "2025년은 KJ 통합출범 전환 구간으로 두 장비군이 병행 청구됩니다.";
    };
    $("#bl-cat").onchange = updHint;
    $("#bl-month").onchange = updHint;
    updHint();
    const renderFiles = () => {
      $("#bl-file-box").innerHTML = files.length
        ? files.map((f, i) => `<span class="nb-file"><a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>
            <button type="button" class="mt-btn danger" data-bl-frm="${i}" title="첨부 제거">✕</button></span>`).join("")
          + `<span class="form-hint" style="align-self:center">${files.length}/${MAX_FILES}</span>`
        : '<span class="form-hint">첨부된 파일이 없습니다.</span>';
      $$("#bl-file-box [data-bl-frm]").forEach(b => b.onclick = () => {
        files.splice(Number(b.dataset.blFrm), 1); renderFiles();
      });
    };
    renderFiles();
    $("#bl-file").onchange = async (e) => {
      const picked = Array.prototype.slice.call(e.target.files || []);
      e.target.value = "";
      if (!picked.length) return;
      if (!window.SemisSync || typeof fetch === "undefined") { toast("오프라인에서는 업로드할 수 없습니다.", true); return; }
      for (const f of picked) {
        if (files.length >= MAX_FILES) { toast("첨부는 최대 " + MAX_FILES + "개까지 가능합니다.", true); break; }
        const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
        if (!isPdf) { toast(f.name + ": PDF 파일만 업로드할 수 있습니다.", true); continue; }
        if (f.size > PDF_MAX) { toast(f.name + ": 20MB를 초과합니다.", true); continue; }
        toast("업로드 중: " + f.name);
        try {
          const up = await SemisSync.uploadFile(f, "billing");
          files.push({ url: up.url, name: f.name }); renderFiles();
          toast("업로드되었습니다: " + f.name);
        } catch (err) { toast(f.name + ": 업로드 실패 — 네트워크를 확인하세요.", true); }
      }
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
        equipGroup: groupsOf(cat).length ? $("#bl-equipgroup").value : "",
        files: files.slice(0, MAX_FILES),
        // 구버전 호환 필드 (첫 번째 첨부)
        fileUrl: files.length ? files[0].url : "", fileName: files.length ? files[0].name : "",
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
  let curView = "month";  // v2.39: "month"(월별 입력) | "year"(유지보수비 연간 비교표)
  let curYear = null;

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
        ${items.length ? items.map(r => { const fl = filesOf(r);
          const kd = MAINT_CATS.includes(cat) ? classifyCost(r) : "", gp = groupOf(r); return `
          <div class="bl-item" ${canWrite ? `data-bl-edit="${esc(r.id)}" style="cursor:pointer" title="클릭하여 수정"` : ""}>
            ${gp ? `<span class="badge badge-gray bl-item-tag">${esc(gp)}</span>` : ""}
            ${kd ? `<span class="badge ${KIND_BADGE[kd] || "badge-gray"} bl-item-tag" title="${esc(KIND_LABEL[kd] || kd)}">${esc(kd)}</span>` : ""}
            <span class="bl-item-title">${esc(r.title)}${r.note ? `<span class="bl-item-note"> · ${esc(r.note)}</span>` : ""}</span>
            ${fl.map((f, i) => `<a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(f.name)}" onclick="event.stopPropagation()">📎${fl.length > 1 ? i + 1 : ""}</a>`).join("")}
            <b class="bl-item-amt">${fmtWon(r.amount)}원</b>
          </div>`; }).join("") + `
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
          <tr class="bl-deduct"><td>③ 기타 수익 차감 (에어제타 몫 50% 기계산 입력분)</td><td class="r">− ${fmtWon(s.deduct)}원</td></tr>
          <tr class="bl-net"><td><b>당월 실청구액 (① + ② − ③)</b></td><td class="r"><b>${fmtWon(s.net)}원</b></td></tr>
        </table>
        <div class="form-hint" style="margin-top:8px">계약 조건: 인천화물터미널 B동 보안검색 수익(터키항공 등)은 에어제타 몫 50%로
          <b>이미 계산된 금액을 그대로 입력</b>하며, 별도 지급 없이 <b>당월 도급비 청구액에서 전액 차감</b>하여 청구합니다.</div>
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

  /* v2.39: 유지보수비 연간 비교표 — 대장(엑셀)과 동일한 3단 헤더 구조 */
  function yearTableHTML(vendor, year) {
    const t = yearTable(vendor, year);
    if (!t.category) return "";
    // 열 구성은 운용 기간이 결정 — 운용 기간 밖인데 데이터만 있는 장비군도 함께 노출
    const keys = t.keys, multi = keys.length > 1;
    const cell = (v, cls) => `<td class="${cls}${v ? "" : " bl-yr-zero"}">${v ? fmtWon(v) : "-"}</td>`;
    const gcls = (i) => (i > 0 ? " bl-yr-gsep" : "");
    const head = `
      <thead>
        <tr><th rowspan="3">월</th>
          ${keys.map((k, i) => `<th colspan="5" class="bl-yr-gcap${gcls(i)}">${esc(t.category)} (${esc(k)})</th>`).join("")}
          ${multi ? '<th rowspan="3">총계</th>' : ""}</tr>
        <tr>${keys.map((k, i) => `
          <th rowspan="2" class="${gcls(i).trim()}">장비 잔존가<br>+수선유지비 ①</th>
          <th colspan="2">실비 청구건 ②</th>
          <th rowspan="2">소계 ②</th>
          <th rowspan="2">합계 ①+②</th>`).join("")}</tr>
        <tr>${keys.map(() => "<th>부품교체 및<br>수리비</th><th>소모품비</th>").join("")}</tr>
      </thead>`;
    const body = t.months.map(r => `
      <tr><td class="bl-yr-mon">${r.mon}월</td>
        ${keys.map((k, i) => { const c = r.cells[k]; return `
          ${cell(c.base, "bl-yr-base" + gcls(i))}${cell(c.repair, "")}${cell(c.supply, "")}
          ${cell(c.sub, "bl-yr-sub")}${cell(c.total, "bl-yr-tot")}`; }).join("")}
        ${multi ? cell(keys.reduce((s, k) => s + r.cells[k].total, 0), "bl-yr-grand") : ""}</tr>`).join("");
    const foot = `
      <tr class="bl-yr-sum"><td class="bl-yr-mon">합계</td>
        ${keys.map((k, i) => { const c = t.totals[k]; return `
          ${cell(c.base, gcls(i).trim())}${cell(c.repair, "")}${cell(c.supply, "")}
          ${cell(c.sub, "")}${cell(c.total, "")}`; }).join("")}
        ${multi ? cell(t.grand, "bl-yr-grand") : ""}</tr>`;
    const ys = yearsOf(vendor);
    return `
      <div class="card">
        <div class="card-title">📊 유지보수비 연간 비교 현황 — ${esc(t.category)}
          <span class="badge badge-gray">${t.year}년</span>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" id="bl-yprev">◀</button>
          <b style="font-size:.88rem">${t.year}년</b>
          <button class="btn btn-ghost btn-sm" id="bl-ynext">▶</button>
        </div>
        <div class="table-wrap"><table class="tbl bl-yr-tbl">${head}<tbody>${body}${foot}</tbody></table></div>
        <div class="form-hint" style="margin-top:8px">
          ① 장비 잔존가+수선유지비 · ② 실비 청구건(부품교체 및 수리비 + 소모품비) — 유지보수비 대장과 동일 구조입니다.
          비용 구분·장비군은 항목의 지정값을 따르며, 미지정 시 제목·메모 또는 해당 월 운용 장비군으로 자동 판별합니다.
          <br>장비군 운용: ~2025년 7월 OZ+BX 단독 → <b>2025년 8월 KJ 통합출범</b>(2025년은 병행 기록)
          → 2025년 12월 OZ+BX 잔존 청구 종료 → 2026년부터 KJ 단독.
          ${t.merged ? "<br><b>※ 2025년은 통합출범 전환 구간</b>이라 두 장비군을 모두 표기합니다." : ""}
          ${ys.length ? `<br>청구 입력 연도: ${ys.join(" · ")}` : ""}</div>
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
      if (!curYear) curYear = Number(curMonth.slice(0, 4));
      const month = curMonth;
      const canWrite = canWriteFor(vendor);
      const cfg = VENDORS[vendor];
      const hasMaint = cfg.cats.some(c => MAINT_CATS.includes(c));
      const yearMode = curView === "year" && hasMaint;

      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🧾 대금 청구 ${vendorMode ? "입력" : "관리"} — ${cfg.icon} ${esc(vendor)}</div>
          <span class="spacer"></span>
          <div class="page-desc">${vendorMode
            ? "귀사(" + esc(vendor) + ")의 청구 내역만 표시됩니다. 매월 청구 항목을 입력해 주세요."
            : "협력업체별 월 청구 내역 확인 · 정산 (HQ 이상)"}</div>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
          ${vendorMode ? "" : `<div class="cal-views" style="display:inline-flex">
            ${Object.keys(VENDORS).map(v =>
              `<button class="cal-viewbtn${vendor === v ? " active" : ""}" data-bl-vendor="${esc(v)}">${esc(VENDORS[v].icon)} ${esc(v)}</button>`).join("")}
          </div>`}
          ${hasMaint ? `<div class="cal-views" style="display:inline-flex">
            <button class="cal-viewbtn${yearMode ? "" : " active"}" data-bl-view="month">📅 월별 청구</button>
            <button class="cal-viewbtn${yearMode ? " active" : ""}" data-bl-view="year">📊 연간 비교표</button>
          </div>` : ""}
        </div>
        ${yearMode ? yearTableHTML(vendor, curYear) : `
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
        ${summaryCard(vendor, month)}`}`;

      // 업체 전환 (hq) · 뷰 전환
      $$("[data-bl-vendor]").forEach(b => b.onclick = () => { curVendor = b.dataset.blVendor; SeMIS.renderView(); });
      $$("[data-bl-view]").forEach(b => b.onclick = () => { curView = b.dataset.blView; SeMIS.renderView(); });

      if (yearMode) {
        const shiftYear = (d) => { curYear = Number(curYear) + d; SeMIS.renderView(); };
        if ($("#bl-yprev")) $("#bl-yprev").onclick = () => shiftYear(-1);
        if ($("#bl-ynext")) $("#bl-ynext").onclick = () => shiftYear(1);
        return;
      }

      // 월 이동
      const shiftMonth = (d) => {
        const [y, m] = month.split("-").map(Number);
        const nd = new Date(Date.UTC(y, m - 1 + d, 1));
        curMonth = nd.toISOString().slice(0, 7);
        curYear = Number(curMonth.slice(0, 4));
        SeMIS.renderView();
      };
      $("#bl-prev").onclick = () => shiftMonth(-1);
      $("#bl-next").onclick = () => shiftMonth(1);
      $("#bl-cur-month").onchange = () => {
        const v = $("#bl-cur-month").value;
        if (/^\d{4}-\d{2}$/.test(v)) { curMonth = v; curYear = Number(v.slice(0, 4)); SeMIS.renderView(); }
      };
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
    VENDORS, MAINT_CATS, COST_KINDS, KIND_LABEL, GROUP_CATS, MAX_FILES,
    list, visible, recsOf, settle, yearSummary,
    classifyCost, groupOf, groupsOf, groupsForMonth, groupsForYear, GROUP_PERIOD, GROUP_MERGE_YM,
    yearTable, yearsOf,
    maintRows, monthlySettles, filesOf, itemForm, parseWon, fmtWon,
    setVendor: (v) => { curVendor = v; },
    setMonth: (m) => { curMonth = m; curYear = Number(String(m).slice(0, 4)); },
    setView: (v) => { curView = v; },
    setYear: (y) => { curYear = Number(y); },
    get month() { return curMonth; },
    get view() { return curView; },
    get year() { return curYear; }
  };
})();
