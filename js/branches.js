/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 지점 관리 모듈 (v2.8)
   해외지점을 줌 가능한 세계지도(Leaflet, CDN) 위에 표시.
   마커 hover → 퀵 오버뷰 툴팁 / 클릭 → 상세 모달 / manager+ 등록·수정.
   Leaflet(CDN) 미로드·오프라인 시 목록 뷰로 자동 폴백.

   데이터: DATA.branches = [{ id, region(미주/유럽/중국/일본/아시아),
     code(지점코드), iata, manager(지점장), security(보안담당자),
     staff(총원), catering(기내식), layover(L/O호텔), hotel,
     mechanic(주재 정비사), lat, lng, note, extras:[{label,value}],
     trainings:[{ id, date(교육일), instructor(교관/강사), content(교육내용),
       doneCount(완료 인원), note(비고), files:[{url,name,size}](최대 20) }] (v2.8) }]
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const REGIONS = ["미주", "유럽", "중국", "일본", "아시아"];
  const REGION_COLOR = { "미주": "#2563eb", "유럽": "#7c3aed", "중국": "#dc2626", "일본": "#db2777", "아시아": "#0d9488" };
  const REGION_BADGE = { "미주": "badge-blue", "유럽": "badge-gray", "중국": "badge-red", "일본": "badge-orange", "아시아": "badge-green" };

  /* 교육 현황(지점별 b.trainings) 첨부 제약 (v2.8) */
  const MAX_TRAIN_FILES = 20;                // 교육 기록당 첨부 최대 개수
  const TRAIN_FILE_MAX = 20 * 1024 * 1024;   // 파일당 최대 용량 (20MB)

  /* ─────── 주요 공항 IATA → [위도, 경도] (마커 자동 배치용) ─────── */
  const IATA = {
    ICN:[37.46,126.44],GMP:[37.56,126.79],PUS:[35.18,128.94],CJU:[33.51,126.49],
    NRT:[35.77,140.39],HND:[35.55,139.78],KIX:[34.43,135.23],NGO:[34.86,136.81],FUK:[33.59,130.45],CTS:[42.78,141.69],OKA:[26.20,127.65],
    PEK:[40.08,116.58],PKX:[39.51,116.41],PVG:[31.14,121.81],SHA:[31.20,121.34],CAN:[23.39,113.30],SZX:[22.64,113.81],
    HKG:[22.31,113.91],TPE:[25.08,121.23],TSA:[25.07,121.55],MFM:[22.15,113.59],
    YNT:[37.66,120.99],TAO:[36.36,120.09],DLC:[38.97,121.54],SHE:[41.64,123.48],HRB:[45.62,126.25],TSN:[39.12,117.35],
    CKG:[29.72,106.64],CTU:[30.57,103.95],XIY:[34.44,108.75],KMG:[25.10,102.93],HGH:[30.23,120.43],NKG:[31.74,118.86],WUH:[30.78,114.21],
    BKK:[13.68,100.75],DMK:[13.91,100.60],SGN:[10.82,106.65],HAN:[21.22,105.81],DAD:[16.04,108.20],
    SIN:[1.36,103.99],KUL:[2.75,101.71],CGK:[-6.13,106.66],DPS:[-8.75,115.17],MNL:[14.51,121.02],CEB:[10.31,123.98],
    PNH:[11.55,104.84],REP:[13.41,103.81],RGN:[16.91,96.13],VTE:[17.99,102.56],KTM:[27.70,85.36],
    DEL:[28.56,77.10],BOM:[19.09,72.87],CMB:[7.18,79.88],DAC:[23.84,90.40],
    TAS:[41.26,69.28],ALA:[43.35,77.04],NQZ:[51.02,71.47],ULN:[47.84,106.77],VVO:[43.40,132.15],
    GUM:[13.48,144.80],SPN:[15.12,145.73],SYD:[-33.95,151.18],MEL:[-37.67,144.84],BNE:[-27.38,153.12],AKL:[-37.01,174.79],NAN:[-17.76,177.44],
    LAX:[33.94,-118.41],SFO:[37.62,-122.38],SEA:[47.45,-122.31],LAS:[36.08,-115.15],SAN:[32.73,-117.19],PDX:[45.59,-122.60],
    JFK:[40.64,-73.78],EWR:[40.69,-74.17],BOS:[42.36,-71.01],IAD:[38.95,-77.46],ATL:[33.64,-84.43],ORD:[41.98,-87.90],
    DFW:[32.90,-97.04],IAH:[29.98,-95.34],MIA:[25.79,-80.29],MCO:[28.43,-81.31],DEN:[39.86,-104.67],PHX:[33.44,-112.01],
    MSP:[44.88,-93.22],DTW:[42.21,-83.35],HNL:[21.32,-157.92],ANC:[61.17,-149.98],
    YVR:[49.19,-123.18],YYZ:[43.68,-79.63],YUL:[45.47,-73.74],
    MEX:[19.44,-99.07],CUN:[21.04,-86.87],GRU:[-23.43,-46.47],GIG:[-22.81,-43.25],SCL:[-33.39,-70.79],LIM:[-12.02,-77.11],BOG:[4.70,-74.14],EZE:[-34.82,-58.54],
    LHR:[51.47,-0.45],LGW:[51.15,-0.19],CDG:[49.01,2.55],ORY:[48.72,2.38],FRA:[50.03,8.56],MUC:[48.35,11.79],
    AMS:[52.31,4.76],MAD:[40.47,-3.57],BCN:[41.30,2.08],FCO:[41.80,12.25],MXP:[45.63,8.72],LIN:[45.45,9.28],
    ZRH:[47.46,8.55],VIE:[48.11,16.57],BRU:[50.90,4.48],CPH:[55.62,12.65],ARN:[59.65,17.92],OSL:[60.19,11.10],HEL:[60.32,24.96],
    DUB:[53.43,-6.25],MAN:[53.35,-2.28],LIS:[38.77,-9.13],ATH:[37.94,23.94],IST:[41.26,28.74],SAW:[40.90,29.31],
    PRG:[50.10,14.26],WAW:[52.17,20.97],BUD:[47.44,19.26],OTP:[44.57,26.09],ZAG:[45.74,16.07],
    SVO:[55.97,37.41],DME:[55.41,37.90],LED:[59.80,30.27],
    TLV:[32.01,34.89],DXB:[25.25,55.36],AUH:[24.44,54.65],DOH:[25.26,51.61],JED:[21.68,39.16],RUH:[24.96,46.70],
    CAI:[30.12,31.41],JNB:[-26.14,28.25],NBO:[-1.32,36.93],ADD:[8.98,38.80]
  };
  const iataCoord = (code) => IATA[String(code || "").trim().toUpperCase()] || null;

  const list = () => D().branches || [];
  const coordOf = (b) => {
    const lat = Number(b.lat), lng = Number(b.lng);
    if (b.lat !== "" && b.lat != null && b.lng !== "" && b.lng != null && isFinite(lat) && isFinite(lng) && (lat || lng)) return [lat, lng];
    return iataCoord(b.iata);
  };

  let viewMode = "map";      // map | list
  let regionFilter = "";      // "" = 전체
  let query = "";
  let map = null;             // Leaflet 인스턴스

  const canWrite = () => SeMIS.canEdit();

  /* ─────── 필터/검색 ─────── */
  function filtered() {
    const q = query.toLowerCase();
    return list().filter(b => {
      if (regionFilter && b.region !== regionFilter) return false;
      if (!q) return true;
      const hay = [b.code, b.iata, b.manager, b.security, b.hotel, b.mechanic, b.note,
        ...(b.extras || []).map(x => (x.label || "") + " " + (x.value || ""))].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  /* ─────── 퀵 오버뷰 (hover 툴팁) ─────── */
  function quickHTML(b) {
    const row = (ico, label, val) => val ? `<div class="br-tip-row"><span>${ico} ${label}</span><b>${esc(val)}</b></div>` : "";
    return `<div class="br-tip-in">
      <div class="br-tip-head" style="--brc:${REGION_COLOR[b.region] || "#64748b"}">
        <b>${esc(b.code || "-")}</b><span class="br-tip-iata">${esc(b.iata || "")}</span>
        <span class="br-tip-region">${esc(b.region || "")}</span>
      </div>
      ${row("👤", "지점장", b.manager)}
      ${row("🛡️", "보안담당", b.security)}
      ${row("👥", "총원", b.staff ? b.staff + "명" : "")}
      <div class="br-tip-flags">
        <span class="${b.catering ? "on" : ""}">🍱 기내식</span>
        <span class="${b.layover ? "on" : ""}">🏨 L/O호텔</span>
        <span class="${b.mechanic ? "on" : ""}">🔧 정비사</span>
      </div>
      <div class="br-tip-more">클릭하면 상세 보기</div>
    </div>`;
  }

  /* ─────── 교육 현황 목록 HTML (상세 모달 내부) ─────── */
  function trainListHTML(b) {
    const items = (b.trainings || []).slice().sort((a, z) =>
      String(z.date || "").localeCompare(String(a.date || "")) ||
      String(z.id || "").localeCompare(String(a.id || "")));
    if (!items.length) return '<div class="form-hint" style="margin:2px 0 4px">등록된 교육 기록이 없습니다.</div>';
    return items.map(t => `
      <div class="br-train-item" data-tr-item="${esc(t.id)}">
        <div class="br-train-head">
          <b>📅 ${esc(t.date || "-")}</b>
          ${t.instructor ? `<span class="badge badge-gray">👤 ${esc(t.instructor)}</span>` : ""}
          ${t.doneCount !== "" && t.doneCount != null ? `<span class="badge badge-green">완료 ${esc(String(t.doneCount))}명</span>` : ""}
          ${canWrite() ? `<button class="mt-btn" data-tr-edit="${esc(t.id)}" title="수정" style="margin-left:auto">✎</button>
            <button class="mt-btn danger" data-tr-del="${esc(t.id)}" title="삭제">🗑</button>` : ""}
        </div>
        ${t.content ? `<div class="br-train-content">${esc(t.content)}</div>` : ""}
        ${t.note ? `<div class="br-train-note">📝 ${esc(t.note)}</div>` : ""}
        ${(t.files || []).length ? `<div class="nb-files-view">${(t.files || []).map(f =>
          `<a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>`).join("")}</div>` : ""}
      </div>`).join("");
  }

  /* ─────── 상세 모달 ─────── */
  function detail(id) {
    const b = list().find(x => x.id === id);
    if (!b) return;
    const tr = (label, val) => val ? `<tr><td class="br-d-label">${label}</td><td>${esc(val)}</td></tr>` : "";
    const yn = (v) => v ? "✅ 예" : "— 아니오";
    openModal(`
      <h3><span class="br-dot" style="background:${REGION_COLOR[b.region] || "#64748b"}"></span>
        ${esc(b.code || "-")} <span class="badge ${REGION_BADGE[b.region] || "badge-gray"}">${esc(b.region || "-")}</span>
        ${b.iata ? `<span class="badge badge-gray">✈ ${esc(b.iata)}</span>` : ""}</h3>
      <table class="tbl br-d-tbl">
        ${tr("지점장", b.manager)}
        ${tr("보안담당자", b.security)}
        ${tr("지점 총원", b.staff ? b.staff + "명" : "")}
        <tr><td class="br-d-label">기내식</td><td>${yn(b.catering)}</td></tr>
        <tr><td class="br-d-label">Layover 호텔</td><td>${b.layover ? "✅ 지정" + (b.hotel ? " — " + esc(b.hotel) : "") : "— 미지정"}</td></tr>
        ${tr("주재 정비사", b.mechanic)}
        ${(b.extras || []).map(x => tr(esc(x.label || "추가 항목"), x.value)).join("")}
        ${tr("비고", b.note)}
        ${coordOf(b) ? `<tr><td class="br-d-label">좌표</td><td style="font-variant-numeric:tabular-nums">${coordOf(b)[0].toFixed(2)}, ${coordOf(b)[1].toFixed(2)}${!b.lat && iataCoord(b.iata) ? ' <span class="form-hint" style="display:inline">(IATA 자동)</span>' : ""}</td></tr>` : ""}
      </table>
      <div class="br-train-sec">
        <div class="br-train-sec-head">
          <b>📚 교육 현황 <span class="form-hint" style="display:inline;font-weight:400">${(b.trainings || []).length}건</span></b>
          ${canWrite() ? '<button class="btn btn-ghost btn-sm" id="br-train-add">+ 교육 추가</button>' : ""}
        </div>
        <div id="br-train-list">${trainListHTML(b)}</div>
      </div>
      <div class="modal-actions">
        ${canWrite() ? '<button class="btn btn-danger" id="br-del" style="margin-right:auto">삭제</button><button class="btn btn-ghost" id="br-edit">✎ 수정</button>' : ""}
        <button class="btn btn-primary" id="br-close">닫기</button>
      </div>`);
    $("#br-close").onclick = closeModal;
    if (canWrite()) {
      $("#br-edit").onclick = () => branchForm(b.id);
      $("#br-del").onclick = () => confirmModal(`지점 "${b.code}"을(를) 삭제하시겠습니까?`, () => {
        D().branches = list().filter(x => x.id !== b.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
      const addBtn = $("#br-train-add");
      if (addBtn) addBtn.onclick = () => trainForm(b.id, null);
      $$("#br-train-list [data-tr-edit]").forEach(btn => btn.onclick = () => trainForm(b.id, btn.dataset.trEdit));
      $$("#br-train-list [data-tr-del]").forEach(btn => btn.onclick = () => {
        const t = (b.trainings || []).find(x => x.id === btn.dataset.trDel);
        confirmModal(`교육 기록 "${t && t.date ? t.date : ""}"을(를) 삭제하시겠습니까?`, () => {
          b.trainings = (b.trainings || []).filter(x => x.id !== btn.dataset.trDel);
          SeMIS.save(); toast("교육 기록이 삭제되었습니다.");
          detail(b.id);
        });
      });
    }
  }

  /* ─────── 교육 기록 등록/수정 폼 (첨부: 드래그앤드롭/파일선택) ─────── */
  function trainForm(branchId, trainId) {
    const b = list().find(x => x.id === branchId);
    if (!b) return;
    if (!Array.isArray(b.trainings)) b.trainings = [];
    const t = trainId ? b.trainings.find(x => x.id === trainId) : null;
    let files = t ? (t.files || []).map(f => Object.assign({}, f)) : [];

    openModal(`
      <h3>${t ? "교육 기록 수정" : "교육 기록 추가"} <span class="badge badge-gray">${esc(b.code || "지점")}</span></h3>
      <div class="form-grid">
        <div class="form-row"><label>교육일</label>
          <input id="tr-date" type="date" value="${esc(t ? t.date || "" : "")}"></div>
        <div class="form-row"><label>완료 인원</label>
          <input id="tr-done" type="number" min="0" max="99999" value="${esc(t && t.doneCount != null ? t.doneCount : "")}" placeholder="명"></div>
      </div>
      <div class="form-row"><label>교관(강사)</label>
        <input id="tr-instructor" value="${esc(t ? t.instructor || "" : "")}" maxlength="60" placeholder="예: 김보안 교관"></div>
      <div class="form-row"><label>교육내용</label>
        <textarea id="tr-content" maxlength="1000" placeholder="교육 주제·과목·주요 내용">${esc(t ? t.content || "" : "")}</textarea></div>
      <div class="form-row"><label>비고</label>
        <input id="tr-note" value="${esc(t ? t.note || "" : "")}" maxlength="200" placeholder="특이사항 (선택)"></div>
      <div class="form-row"><label>첨부파일 <span class="form-hint" style="display:inline;font-weight:400">(최대 ${MAX_TRAIN_FILES}개 · 각 20MB 이하)</span></label>
        <div id="tr-dropzone" class="br-dropzone">📎 파일을 이곳에 끌어다 놓거나 <u>클릭하여 선택</u>하세요
          <input type="file" id="tr-file" multiple style="display:none"></div>
        <div id="tr-file-box" class="nb-files-view"></div></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="tr-cancel">취소</button>
        <button class="btn btn-primary" id="tr-save">저장</button>
      </div>`, { wide: true });

    function renderFiles() {
      $("#tr-file-box").innerHTML = files.length
        ? files.map((f, i) => `<span class="nb-file"><a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>
            <button type="button" class="mt-btn danger" data-tr-frm="${i}" title="첨부 제거">✕</button></span>`).join("")
          + `<span class="form-hint" style="align-self:center">${files.length}/${MAX_TRAIN_FILES}</span>`
        : '<span class="form-hint">첨부된 파일이 없습니다.</span>';
      $$("#tr-file-box [data-tr-frm]").forEach(btn => btn.onclick = () => {
        files.splice(Number(btn.dataset.trFrm), 1); renderFiles();
      });
    }
    renderFiles();

    async function addFiles(picked) {
      if (!picked || !picked.length) return;
      if (!window.SemisSync || typeof fetch === "undefined") { toast("오프라인에서는 파일을 첨부할 수 없습니다.", true); return; }
      for (const f of picked) {
        if (files.length >= MAX_TRAIN_FILES) { toast("첨부는 최대 " + MAX_TRAIN_FILES + "개까지 가능합니다.", true); break; }
        if ((f.size || 0) > TRAIN_FILE_MAX) { toast(f.name + ": 20MB를 초과합니다.", true); continue; }
        toast("업로드 중: " + f.name);
        try {
          const up = await SemisSync.uploadFile(f, "branch-train");
          files.push({ url: up.url, name: f.name, size: f.size || 0 }); renderFiles();
          toast("업로드되었습니다: " + f.name);
        } catch (err) { toast(f.name + ": 업로드 실패 — 네트워크를 확인하세요.", true); }
      }
    }

    const dz = $("#tr-dropzone"), fi = $("#tr-file");
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

    $("#tr-cancel").onclick = () => detail(branchId);
    $("#tr-save").onclick = () => {
      const date = $("#tr-date").value;
      const content = $("#tr-content").value.trim();
      if (!date && !content) { toast("교육일 또는 교육내용을 입력하세요.", true); return; }
      const doneV = $("#tr-done").value.trim();
      const rec = {
        date,
        instructor: $("#tr-instructor").value.trim(),
        content,
        doneCount: doneV === "" ? "" : Math.max(0, Number(doneV) || 0),
        note: $("#tr-note").value.trim(),
        files: files.slice(0, MAX_TRAIN_FILES)
      };
      if (t) Object.assign(t, rec);
      else b.trainings.push(Object.assign({ id: uid("trn") }, rec));
      SeMIS.save(); toast("교육 기록이 저장되었습니다. (실시간 공유)");
      detail(branchId);
    };
  }

  /* ─────── 등록/수정 폼 ─────── */
  function branchForm(id) {
    const b = id ? list().find(x => x.id === id) : null;
    let extras = b ? (b.extras || []).map(x => Object.assign({}, x)) : [];

    openModal(`
      <h3>${b ? "지점 수정" : "지점 등록"} <span class="badge badge-gray">지점 관리</span></h3>
      <div class="form-grid">
        <div class="form-row"><label>구역</label>
          <select id="b-region">${REGIONS.map(r => `<option ${(b ? b.region : "아시아") === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
        <div class="form-row"><label>지점코드</label>
          <input id="b-code" value="${esc(b ? b.code : "")}" maxlength="12" placeholder="예: FRASF" style="text-transform:uppercase"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>IATA 공항코드</label>
          <input id="b-iata" value="${esc(b ? b.iata || "" : "")}" maxlength="3" placeholder="예: FRA" style="text-transform:uppercase">
          <div class="form-hint" id="b-iata-hint">3자리 입력 시 지도 좌표 자동 배치</div></div>
        <div class="form-row"><label>지점 총원</label>
          <input id="b-staff" type="number" min="0" max="9999" value="${esc(b && b.staff != null ? b.staff : "")}" placeholder="명"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>지점장명</label><input id="b-manager" value="${esc(b ? b.manager || "" : "")}" maxlength="40"></div>
        <div class="form-row"><label>보안담당자명</label><input id="b-security" value="${esc(b ? b.security || "" : "")}" maxlength="40"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:26px">
          <input type="checkbox" id="b-catering" style="width:auto" ${b && b.catering ? "checked" : ""}> 🍱 기내식 탑재</label></div>
        <div class="form-row"><label>주재 정비사명</label><input id="b-mechanic" value="${esc(b ? b.mechanic || "" : "")}" maxlength="40" placeholder="없으면 비워두기"></div>
      </div>
      <div class="form-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="b-layover" style="width:auto" ${b && b.layover ? "checked" : ""}> 🏨 Layover 호텔 지정</label>
        <input id="b-hotel" value="${esc(b ? b.hotel || "" : "")}" maxlength="80" placeholder="호텔명" style="margin-top:6px;${b && b.layover ? "" : "display:none"}"></div>
      <div class="form-row"><label>추가 항목 (선택)</label>
        <div id="b-extras"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="b-extra-add" style="margin-top:4px">+ 항목 추가</button></div>
      <div class="form-grid">
        <div class="form-row"><label>위도 (수동 지정 시)</label><input id="b-lat" value="${esc(b && b.lat != null ? b.lat : "")}" placeholder="예: 50.03"></div>
        <div class="form-row"><label>경도</label><input id="b-lng" value="${esc(b && b.lng != null ? b.lng : "")}" placeholder="예: 8.56"></div>
      </div>
      <div class="form-row"><label>비고</label><input id="b-note" value="${esc(b ? b.note || "" : "")}" maxlength="200"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="b-cancel">취소</button>
        <button class="btn btn-primary" id="b-save">저장</button>
      </div>`, { wide: true });

    /* 추가 항목 편집 */
    function exCollect() {
      $$("#b-extras .br-ex-row").forEach((row, i) => {
        extras[i].label = row.querySelector(".br-ex-label").value;
        extras[i].value = row.querySelector(".br-ex-value").value;
      });
    }
    function exPaint() {
      $("#b-extras").innerHTML = extras.map((x, i) => `
        <div class="br-ex-row">
          <input class="br-ex-label" value="${esc(x.label || "")}" maxlength="24" placeholder="항목명 (예: GSA 업체)">
          <input class="br-ex-value" value="${esc(x.value || "")}" maxlength="120" placeholder="내용">
          <button type="button" class="btn btn-ghost btn-sm" data-ex-del="${i}" title="삭제">🗑</button>
        </div>`).join("");
      $$("#b-extras [data-ex-del]").forEach(btn => btn.onclick = () => {
        exCollect(); extras.splice(Number(btn.dataset.exDel), 1); exPaint();
      });
    }
    exPaint();
    $("#b-extra-add").onclick = () => { exCollect(); extras.push({ label: "", value: "" }); exPaint(); };

    /* IATA → 좌표 힌트 / L-O 호텔 토글 */
    $("#b-iata").oninput = () => {
      const c = iataCoord($("#b-iata").value);
      $("#b-iata-hint").textContent = c ? `✓ 좌표 자동 배치: ${c[0].toFixed(2)}, ${c[1].toFixed(2)}`
        : "3자리 입력 시 지도 좌표 자동 배치 (미등록 공항은 위도/경도 직접 입력)";
    };
    $("#b-iata").oninput();
    $("#b-layover").onchange = () => { $("#b-hotel").style.display = $("#b-layover").checked ? "" : "none"; };

    $("#b-cancel").onclick = closeModal;
    $("#b-save").onclick = () => {
      const code = $("#b-code").value.trim().toUpperCase();
      if (!code) { toast("지점코드를 입력하세요.", true); return; }
      exCollect();
      const staffV = $("#b-staff").value.trim();
      const rec = {
        region: $("#b-region").value,
        code,
        iata: $("#b-iata").value.trim().toUpperCase(),
        manager: $("#b-manager").value.trim(),
        security: $("#b-security").value.trim(),
        staff: staffV === "" ? "" : Math.max(0, Number(staffV) || 0),
        catering: $("#b-catering").checked,
        layover: $("#b-layover").checked,
        hotel: $("#b-layover").checked ? $("#b-hotel").value.trim() : "",
        mechanic: $("#b-mechanic").value.trim(),
        lat: $("#b-lat").value.trim(),
        lng: $("#b-lng").value.trim(),
        note: $("#b-note").value.trim(),
        extras: extras.filter(x => String(x.label || "").trim() || String(x.value || "").trim())
      };
      if (b) Object.assign(b, rec);
      else D().branches.push(Object.assign({ id: uid("br") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다. (실시간 공유)");
    };
  }

  /* ─────── 지도 뷰 (Leaflet) ─────── */
  function initMap(items) {
    const el = document.getElementById("br-map");
    if (!el || typeof window === "undefined" || !window.L) return false;
    if (map) { try { map.remove(); } catch (e) { /* 이미 해제된 경우 무시 */ } map = null; }
    try {
      map = L.map(el, { worldCopyJump: true, minZoom: 2, maxZoom: 12, zoomControl: true });
      const carto = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd", maxZoom: 12
      }).addTo(map);
      // CARTO 타일 차단 환경 → OSM 표준 타일로 1회 폴백
      let tileErr = 0, fellBack = false;
      carto.on("tileerror", () => {
        tileErr++;
        if (fellBack || tileErr < 4) return;
        fellBack = true;
        try {
          map.removeLayer(carto);
          L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 12
          }).addTo(map);
        } catch (e) { /* 무시 */ }
      });

      const pts = [];
      items.forEach(b => {
        const c = coordOf(b);
        if (!c) return;
        pts.push(c);
        L.circleMarker(c, {
          radius: 8, weight: 2, color: "#ffffff",
          fillColor: REGION_COLOR[b.region] || "#64748b", fillOpacity: .95
        }).addTo(map)
          .bindTooltip(quickHTML(b), { direction: "top", offset: [0, -8], opacity: 1, className: "br-tip", sticky: false })
          .on("click", () => detail(b.id));
      });
      if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 6 });
      else map.setView([30, 40], 2);

      /* 범례 */
      const legend = L.control({ position: "bottomleft" });
      legend.onAdd = () => {
        const div = L.DomUtil.create("div", "br-legend");
        div.innerHTML = REGIONS.map(r =>
          `<span><i style="background:${REGION_COLOR[r]}"></i>${r}</span>`).join("");
        return div;
      };
      legend.addTo(map);
      return true;
    } catch (e) { return false; }
  }

  /* ─────── 목록 뷰 ─────── */
  function listHTML(items) {
    if (!items.length) return '<div class="empty">등록된 지점이 없습니다.' +
      (canWrite() ? " 우측 상단 [+ 지점 등록]으로 추가하세요." : "") + "</div>";
    const sorted = items.slice().sort((a, b) =>
      REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region) || String(a.code).localeCompare(String(b.code)));
    return `<div class="table-wrap"><table class="tbl"><thead><tr>
        <th style="width:64px">구역</th><th>지점코드</th><th style="width:56px">IATA</th>
        <th>지점장</th><th>보안담당</th><th style="width:56px">총원</th>
        <th style="width:52px">기내식</th><th>L/O 호텔</th><th>정비사</th><th style="width:46px">지도</th>
      </tr></thead><tbody>
      ${sorted.map(b => `<tr data-br-row="${esc(b.id)}" style="cursor:pointer">
        <td><span class="br-dot" style="background:${REGION_COLOR[b.region] || "#64748b"}"></span> ${esc(b.region || "-")}</td>
        <td><b>${esc(b.code || "-")}</b></td>
        <td>${esc(b.iata || "-")}</td>
        <td>${esc(b.manager || "-")}</td>
        <td>${esc(b.security || "-")}</td>
        <td>${b.staff !== "" && b.staff != null ? esc(String(b.staff)) : "-"}</td>
        <td style="text-align:center">${b.catering ? "🍱" : "-"}</td>
        <td>${b.layover ? "🏨 " + esc(b.hotel || "지정") : "-"}</td>
        <td>${esc(b.mechanic || "-")}</td>
        <td style="text-align:center">${coordOf(b) ? "📍" : '<span title="좌표 없음 — IATA 또는 위도/경도 입력 필요">⚠️</span>'}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  /* ─────── 모듈 렌더 ─────── */
  SeMIS.registerModule("branches", {
    title: "지점 관리",
    render(root) {
      if (!Array.isArray(D().branches)) D().branches = [];
      const items = filtered();
      const total = list().length;
      const hasLeaflet = typeof window !== "undefined" && !!window.L;
      const mode = viewMode === "map" && hasLeaflet ? "map" : "list";

      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🌍 지점 관리</div>
          <span class="spacer"></span>
          ${canWrite() ? '<button class="btn btn-primary" id="br-add">+ 지점 등록</button>' : ""}
          <div class="page-desc">해외지점 현황 — 전체 ${total}개 지점 ${regionFilter || query ? `· 필터 ${items.length}개 표시` : ""}</div>
        </div>
        <div class="card cal-card">
          <div class="cal-toolbar">
            <div class="cal-views">
              <button class="cal-viewbtn${mode === "map" ? " active" : ""}" data-brmode="map" ${hasLeaflet ? "" : 'title="지도 라이브러리 로드 실패 — 네트워크 확인" disabled'}>🗺 지도</button>
              <button class="cal-viewbtn${mode === "list" ? " active" : ""}" data-brmode="list">목록</button>
            </div>
            <span class="spacer"></span>
            <input id="br-search" class="br-search" type="search" placeholder="🔍 지점·담당자·호텔 검색" value="${esc(query)}" autocomplete="off">
          </div>
          <div class="cal-filters">
            <span class="cal-filter-label">구역</span>
            <button class="cal-fchip${!regionFilter ? " active" : ""}" data-br-region="">전체</button>
            ${REGIONS.map(r => `<button class="cal-fchip${regionFilter === r ? " active" : ""}" data-br-region="${r}">
              <span class="br-dot" style="background:${REGION_COLOR[r]}"></span> ${r}</button>`).join("")}
          </div>
          ${mode === "map"
            ? `<div id="br-map" class="br-map"></div>
               <p class="form-hint" style="margin-top:8px">마커에 마우스를 올리면 퀵 오버뷰, 클릭하면 상세 정보가 열립니다. 휠/버튼으로 자유롭게 확대·축소할 수 있습니다.</p>`
            : (hasLeaflet ? "" : '<div class="form-hint" style="margin-bottom:8px">🗺 지도 라이브러리를 불러오지 못해 목록으로 표시합니다.</div>') + `<div id="br-list">${listHTML(items)}</div>`}
        </div>`;

      if (canWrite()) $("#br-add").onclick = () => branchForm(null);
      $$("[data-brmode]").forEach(btn => btn.onclick = () => {
        if (btn.disabled) return;
        viewMode = btn.dataset.brmode; SeMIS.renderView();
      });
      $$("[data-br-region]").forEach(btn => btn.onclick = () => {
        regionFilter = btn.dataset.brRegion; SeMIS.renderView();
      });
      const si = $("#br-search");
      si.oninput = () => {
        query = si.value.trim();
        if (mode === "map") { initMap(filtered()); updateDesc(); }
        else { $("#br-list").innerHTML = listHTML(filtered()); wireRows(); updateDesc(); }
      };
      function updateDesc() {
        const d = $(".page-desc", root);
        if (d) d.textContent = `해외지점 현황 — 전체 ${list().length}개 지점 ${regionFilter || query ? `· 필터 ${filtered().length}개 표시` : ""}`;
      }
      function wireRows() {
        $$("[data-br-row]", root).forEach(el => el.onclick = () => detail(el.dataset.brRow));
      }
      if (mode === "map") initMap(items);
      else wireRows();
    }
  });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisBranches = {
    REGIONS, REGION_COLOR, iataCoord, coordOf, quickHTML,
    detail, branchForm, trainForm, trainListHTML, MAX_TRAIN_FILES, list, filtered,
    setViewMode: (m) => { if (m === "map" || m === "list") viewMode = m; },
    setRegionFilter: (r) => { regionFilter = REGIONS.includes(r) ? r : ""; },
    setQuery: (q) => { query = String(q || ""); }
  };
})();
