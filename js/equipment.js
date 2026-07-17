/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 보안장비 유지관리 모듈 (v2.8)
   X-Ray/문형·휴대용 금속탐지기/ETD 등 보안장비 대장 + 점검주기 관리:
   목록 + 차기점검 D-day + 상태 배지 + 점검/고장/수리 이력 로그 + manager 편집

   데이터: DATA.equipment = [{ id, type, name, serial, location, vendor,
             installed, lastCheck, cycleM, status, logs[], note }]
     - type: X-Ray / WTMD(문형) / HHMD(휴대용) / ETD(폭발물흔적) / CCTV / 기타
     - status: 정상 / 점검필요 / 고장 / 수리중 / 폐기
     - logs: [{ id, date, kind(점검/고장/수리/기타), text, by }]
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const TYPES = ["X-Ray", "WTMD(문형)", "HHMD(휴대용)", "ETD(폭발물흔적)", "CCTV", "기타"];
  const TYPE_ICON = { "X-Ray": "📦", "WTMD(문형)": "🚪", "HHMD(휴대용)": "🪄", "ETD(폭발물흔적)": "🧪", "CCTV": "📹", "기타": "🔧" };
  const STATUSES = ["정상", "점검필요", "고장", "수리중", "폐기"];
  const ST_BADGE = { "정상": "badge-green", "점검필요": "badge-amber", "고장": "badge-red", "수리중": "badge-blue", "폐기": "badge-gray" };
  const LOG_KINDS = ["점검", "고장", "수리", "기타"];
  const LOG_BADGE = { "점검": "badge-blue", "고장": "badge-red", "수리": "badge-green", "기타": "badge-gray" };

  const todayISO = () => new Date().toISOString().slice(0, 10);
  function addMonths(dateStr, months) {
    if (!dateStr || !months) return "";
    const y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7)), day = Number(dateStr.slice(8, 10));
    const t = new Date(Date.UTC(y, m - 1 + Number(months), 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(day, last));
    return t.toISOString().slice(0, 10);
  }
  const nextCheck = (x) => addMonths(x.lastCheck, x.cycleM);
  function daysLeft(dateStr) {
    if (!dateStr) return null;
    return Math.round((new Date(dateStr) - new Date(todayISO())) / 86400000);
  }
  const isDue = (x) => {
    if (x.status === "폐기") return false;
    const n = nextCheck(x);
    return !!n && daysLeft(n) <= 0;
  };

  function checkBadge(x) {
    if (x.status === "폐기") return "";
    const n = nextCheck(x);
    if (!n) return '<span class="badge badge-gray">미지정</span>';
    const d = daysLeft(n);
    if (d <= 0) return `<span class="badge badge-red">점검 도래 D+${-d}</span>`;
    if (d <= 30) return `<span class="badge badge-amber">D-${d}</span>`;
    return `<span class="badge badge-gray">D-${d}</span>`;
  }

  let query = "", stFilter = "전체";

  const list = () => (Array.isArray(D().equipment) ? D().equipment : []);
  function filtered() {
    const q = query.toLowerCase();
    return list().filter(x => {
      if (stFilter === "점검도래") { if (!isDue(x)) return false; }
      else if (stFilter !== "전체" && x.status !== stFilter) return false;
      if (!q) return true;
      return [x.type, x.name, x.serial, x.location, x.vendor, x.note]
        .some(v => String(v || "").toLowerCase().includes(q));
    }).sort((a, b) => {
      const ra = a.status === "폐기" ? 1 : 0, rb = b.status === "폐기" ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return String(nextCheck(a) || "9999").localeCompare(String(nextCheck(b) || "9999"));
    });
  }

  function stats() {
    const l = list().filter(x => x.status !== "폐기");
    return {
      total: l.length,
      ok: l.filter(x => x.status === "정상" && !isDue(x)).length,
      due: l.filter(isDue).length,
      broken: l.filter(x => x.status === "고장" || x.status === "수리중").length
    };
  }

  /* ─────── 등록/수정 폼 (manager+, 이력 로그 포함) ─────── */
  function eqForm(id) {
    const x = id ? list().find(e => e.id === id) : null;
    let logs = x ? (x.logs || []).map(l => Object.assign({}, l)) : [];
    openModal(`
      <h3>${x ? "장비 수정" : "장비 등록"} <span class="badge badge-gray">보안장비</span></h3>
      <div class="form-grid">
        <div class="form-row"><label>장비 유형</label>
          <select id="e-type">${TYPES.map(t => `<option ${(x ? x.type : TYPES[0]) === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="form-row"><label>상태</label>
          <select id="e-status">${STATUSES.map(s => `<option ${(x ? x.status : "정상") === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>장비명 / 모델</label>
          <input id="e-name" value="${esc(x ? x.name : "")}" maxlength="60" placeholder="예: Smiths HI-SCAN 6040i"></div>
        <div class="form-row"><label>제조번호 (S/N)</label>
          <input id="e-serial" value="${esc(x ? x.serial || "" : "")}" maxlength="40"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>설치 위치</label>
          <input id="e-location" value="${esc(x ? x.location || "" : "")}" maxlength="60" placeholder="예: 인천공항 T1 화물터미널"></div>
        <div class="form-row"><label>공급/유지보수 업체</label>
          <input id="e-vendor" value="${esc(x ? x.vendor || "" : "")}" maxlength="60"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>도입일</label><input type="date" id="e-installed" value="${esc(x ? x.installed || "" : "")}"></div>
        <div class="form-row"><label>최근 점검일</label><input type="date" id="e-lastcheck" value="${esc(x ? x.lastCheck || "" : "")}"></div>
      </div>
      <div class="form-row"><label>점검 주기 (개월)</label>
        <input type="number" id="e-cycle" min="0" max="60" value="${esc(x ? x.cycleM : 12)}" placeholder="12"></div>
      <div class="form-row"><label>이력 (점검 / 고장 / 수리)</label>
        <div id="e-logs"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="elog-add" style="margin-top:4px">+ 이력 추가</button></div>
      <div class="form-row"><label>비고</label><input id="e-note" value="${esc(x ? x.note || "" : "")}" maxlength="200"></div>
      <div class="modal-actions">
        ${x ? '<button class="btn btn-danger" id="e-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="e-cancel">취소</button>
        <button class="btn btn-primary" id="e-save">저장</button>
      </div>`, { wide: true });

    function logCollect() {
      $$("#e-logs .ifd-row").forEach((row, i) => {
        logs[i].date = row.querySelector("input[type=date]").value;
        logs[i].kind = row.querySelector("select").value;
        logs[i].text = row.querySelector("input[type=text]").value;
      });
    }
    function logPaint() {
      $("#e-logs").innerHTML = logs.map((l, i) => `
        <div class="ifd-row" data-log="${i}">
          <input type="date" value="${esc(l.date || "")}" style="width:130px;flex-shrink:0">
          <select class="ifd-type">${LOG_KINDS.map(k => `<option ${l.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select>
          <input type="text" class="ifd-text" value="${esc(l.text || "")}" maxlength="200" placeholder="내용 (예: 정기 캘리브레이션 실시)">
          <button type="button" class="btn btn-ghost btn-sm" data-log-del="${i}" title="삭제">🗑</button>
        </div>`).join("") || '<div class="form-hint">등록된 이력이 없습니다.</div>';
      $$("#e-logs [data-log-del]").forEach(b => b.onclick = () => {
        logCollect(); logs.splice(Number(b.dataset.logDel), 1); logPaint();
      });
    }
    logPaint();
    $("#elog-add").onclick = () => {
      logCollect();
      logs.push({ id: uid("el"), date: todayISO(), kind: "점검", text: "", by: (SeMIS.user && SeMIS.user.name) || "" });
      logPaint();
    };

    $("#e-cancel").onclick = closeModal;
    if (x) $("#e-del").onclick = () =>
      confirmModal(`장비 "${x.name}"을(를) 삭제하시겠습니까?`, () => {
        D().equipment = list().filter(e => e.id !== x.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    $("#e-save").onclick = () => {
      const name = $("#e-name").value.trim();
      if (!name) { toast("장비명을 입력하세요.", true); return; }
      logCollect();
      const cleanLogs = logs.filter(l => String(l.text || "").trim() || l.date)
        .map(l => ({ id: l.id || uid("el"), date: l.date || "", kind: LOG_KINDS.includes(l.kind) ? l.kind : "기타",
                     text: String(l.text || "").trim(), by: l.by || "" }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      // 최근 점검일 자동 갱신: '점검' 이력 최신 일자가 입력값보다 나중이면 반영
      let lastCheck = $("#e-lastcheck").value || "";
      const lastInspLog = cleanLogs.filter(l => l.kind === "점검" && l.date).map(l => l.date).sort().pop();
      if (lastInspLog && lastInspLog > lastCheck) lastCheck = lastInspLog;
      const rec = {
        type: $("#e-type").value, name,
        serial: $("#e-serial").value.trim(),
        location: $("#e-location").value.trim(),
        vendor: $("#e-vendor").value.trim(),
        installed: $("#e-installed").value || "",
        lastCheck,
        cycleM: Math.max(0, Number($("#e-cycle").value) || 0),
        status: $("#e-status").value,
        logs: cleanLogs,
        note: $("#e-note").value.trim()
      };
      if (x) Object.assign(x, rec);
      else D().equipment.push(Object.assign({ id: uid("eq") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ─────── 상세 (읽기 전용) ─────── */
  function eqDetail(id) {
    const x = list().find(e => e.id === id);
    if (!x) return;
    openModal(`
      <h3>${esc(TYPE_ICON[x.type] || "🔧")} ${esc(x.name)} <span class="badge ${ST_BADGE[x.status] || "badge-gray"}">${esc(x.status)}</span></h3>
      <table class="tbl" style="font-size:.88rem">
        <tr><td style="width:100px;color:var(--text-2)">유형</td><td>${esc(x.type)}</td></tr>
        <tr><td style="color:var(--text-2)">S/N</td><td>${esc(x.serial || "-")}</td></tr>
        <tr><td style="color:var(--text-2)">위치</td><td>${esc(x.location || "-")}</td></tr>
        <tr><td style="color:var(--text-2)">업체</td><td>${esc(x.vendor || "-")}</td></tr>
        <tr><td style="color:var(--text-2)">도입일</td><td>${esc(x.installed || "-")}</td></tr>
        <tr><td style="color:var(--text-2)">점검</td><td>최근 ${esc(x.lastCheck || "-")} · 주기 ${esc(x.cycleM || "-")}개월 · 차기 ${esc(nextCheck(x) || "-")} ${checkBadge(x)}</td></tr>
        ${x.note ? `<tr><td style="color:var(--text-2)">비고</td><td>${esc(x.note)}</td></tr>` : ""}
      </table>
      ${(x.logs || []).length ? `<div style="font-size:.78rem;font-weight:700;color:var(--text-3);margin:12px 0 4px">이력</div>
        ${x.logs.map(l => `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid var(--border);font-size:.84rem">
          <span style="color:var(--text-3);white-space:nowrap">${esc(l.date || "-")}</span>
          <span class="badge ${LOG_BADGE[l.kind] || "badge-gray"}">${esc(l.kind)}</span>
          <span style="flex:1">${esc(l.text)}</span>${l.by ? `<span style="font-size:.74rem;color:var(--text-3)">${esc(l.by)}</span>` : ""}
        </div>`).join("")}` : ""}
      <div class="modal-actions"><button class="btn btn-ghost" id="e-close">닫기</button></div>`);
    $("#e-close").onclick = closeModal;
  }

  /* ─────── 목록 ─────── */
  function tableHTML() {
    const items = filtered();
    if (!items.length) return '<div class="empty">해당하는 장비가 없습니다.</div>';
    return `<div class="table-wrap"><table class="tbl"><thead><tr>
        <th style="width:130px">유형</th><th>장비명 / 위치</th><th style="width:110px">최근 점검</th>
        <th style="width:120px">차기 점검</th><th style="width:60px">이력</th><th style="width:76px">상태</th></tr></thead><tbody>
      ${items.map(x => `<tr data-eq-row="${esc(x.id)}" style="cursor:pointer" class="${x.status === "폐기" ? "insp-cancel" : ""}">
        <td>${esc(TYPE_ICON[x.type] || "▪")} ${esc(x.type)}</td>
        <td><b>${esc(x.name)}</b>${x.location ? `<div style="font-size:.76rem;color:var(--text-3)">${esc(x.location)}</div>` : ""}</td>
        <td style="font-size:.84rem">${esc(x.lastCheck || "-")}</td>
        <td>${checkBadge(x)}</td>
        <td style="font-size:.84rem">${(x.logs || []).length ? (x.logs || []).length + "건" : "-"}</td>
        <td><span class="badge ${ST_BADGE[x.status] || "badge-gray"}">${esc(x.status)}</span></td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  /* ─────── 모듈 렌더 ─────── */
  SeMIS.registerModule("equipment", {
    title: "보안장비 유지관리",
    render(root) {
      const canWrite = SeMIS.roleRank() >= 2;
      const s = stats();
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🔧 보안장비 유지관리</div>
          <span class="spacer"></span>
          ${canWrite ? '<button class="btn btn-primary" id="eq-add">+ 장비 등록</button>' : ""}
          <div class="page-desc">보안검색 장비 대장 · 점검주기 · 고장/수리 이력</div>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-label">운용 장비</div><div class="stat-value">${s.total}</div><div class="stat-sub">폐기 제외</div></div>
          <div class="stat"><div class="stat-label">정상</div><div class="stat-value" style="color:var(--success)">${s.ok}</div><div class="stat-sub">점검주기 이내</div></div>
          <div class="stat"><div class="stat-label">점검 도래</div><div class="stat-value" style="color:var(--warning)">${s.due}</div><div class="stat-sub">점검 필요</div></div>
          <div class="stat"><div class="stat-label">고장/수리중</div><div class="stat-value" style="color:var(--danger)">${s.broken}</div><div class="stat-sub">조치 진행</div></div>
        </div>
        <div class="card">
          <div class="cal-toolbar">
            <input id="eq-search" class="ct-search" type="search" style="max-width:280px"
              placeholder="🔍 장비명 · 위치 · S/N 검색" value="${esc(query)}" autocomplete="off">
            <span class="spacer"></span>
            <div class="cal-views">${["전체", "점검도래", "고장", "수리중", "폐기"].map(f =>
              `<button class="cal-viewbtn${stFilter === f ? " active" : ""}" data-efilter="${f}">${f}</button>`).join("")}</div>
          </div>
          <div id="eq-body">${tableHTML()}</div>
        </div>`;

      const wire = () => {
        $$("#eq-body [data-eq-row]").forEach(el => el.onclick = () => {
          canWrite ? eqForm(el.dataset.eqRow) : eqDetail(el.dataset.eqRow);
        });
      };
      $("#eq-search").oninput = () => {
        query = $("#eq-search").value.trim();
        $("#eq-body").innerHTML = tableHTML(); wire();
      };
      $$("[data-efilter]").forEach(b => b.onclick = () => { stFilter = b.dataset.efilter; SeMIS.renderView(); });
      if (canWrite) $("#eq-add").onclick = () => eqForm(null);
      wire();
    }
  });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisEquipment = {
    TYPES, STATUSES, addMonths, nextCheck, isDue, stats, list,
    setFilter: (f) => { stFilter = f; }, setQuery: (q) => { query = String(q || ""); }
  };
})();
