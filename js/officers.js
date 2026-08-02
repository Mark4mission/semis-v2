/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 보안 인력 현황 모듈 (v2.34)
   ① supervisors    : 보안감독자 현황 (항공사보안책임자/감독자 발령 현황)
   ② stn-officers   : 지점 보안담당자 (지점보안시스템 계정 부여 현황)

   구글 시트로 운영하던 두 자료를 v2 내부 모듈로 이관.

   데이터
   - DATA.supervisors     = [{ id, div, dept, rank, duty, name, empNo, role, from, to, note }]
       · div  : 본부(부문)  · dept: 부서  · rank: 직위  · duty: 직책
       · role : 항공사보안책임자(정)/(부) · 항공사보안감독자 · "" (미발령)
       · from/to : 발령기간 (ISO)
   - DATA.stationOfficers = [{ id, region, station, name, empNo, uniworks, note }]
       · region: 미주/유럽/일본/중국/아시아 · station: 지점코드 · uniworks: 유니웍스 ID

   열람 mgr 이상(메뉴 vis) · 편집 hq 이상(canEdit) · 삭제 canDelete
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const todayISO = () => new Date().toISOString().slice(0, 10);

  /* ═══════════ ① 보안감독자 현황 ═══════════ */

  const SV_ROLES = ["항공사보안책임자(정)", "항공사보안책임자(부)", "항공사보안감독자", ""];
  const SV_ROLE_BADGE = {
    "항공사보안책임자(정)": "badge-red",
    "항공사보안책임자(부)": "badge-orange",
    "항공사보안감독자": "badge-blue"
  };
  const SV_SHEET = "https://docs.google.com/spreadsheets/d/1RlxvnrjDWMy4lSTDdbF6JTKCgL45EuTW0O1mjGd8RtQ/edit?usp=sharing";
  /* 본부 표시 순서 (그 외는 뒤에 가나다순) */
  const SV_DIV_ORDER = ["안전보안실", "영업본부", "운항본부", "정비본부", "종합통제실"];

  const svList = () => (Array.isArray(D().supervisors) ? D().supervisors : []);

  /* 발령 상태: 미발령 / 만료 / 유효 */
  function svState(x) {
    if (!x || !x.role) return "미발령";
    if (x.to && x.to < todayISO()) return "만료";
    return "유효";
  }
  const SV_STATE_BADGE = { "유효": "badge-green", "만료": "badge-red", "미발령": "badge-gray" };

  function svStats() {
    const l = svList();
    return {
      total: l.length,
      chief: l.filter(x => x.role && x.role.indexOf("책임자") >= 0).length,
      sup: l.filter(x => x.role === "항공사보안감독자").length,
      none: l.filter(x => svState(x) !== "유효").length,
      divs: svDivs().length
    };
  }

  function svDivs() {
    const set = [];
    svList().forEach(x => { if (x.div && set.indexOf(x.div) < 0) set.push(x.div); });
    return set.sort(svDivCmp);
  }
  function svDivCmp(a, b) {
    const ia = SV_DIV_ORDER.indexOf(a), ib = SV_DIV_ORDER.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return String(a).localeCompare(String(b), "ko");
  }

  let svQuery = "", svDiv = "전체";

  function svFiltered() {
    const q = svQuery.toLowerCase();
    return svList().filter(x => {
      if (svDiv !== "전체" && x.div !== svDiv) return false;
      if (!q) return true;
      return [x.name, x.div, x.dept, x.rank, x.duty, x.empNo, x.role, x.note]
        .some(v => String(v || "").toLowerCase().includes(q));
    }).sort((a, b) =>
      svDivCmp(a.div, b.div) ||
      String(a.dept || "").localeCompare(String(b.dept || ""), "ko") ||
      (a.seq || 0) - (b.seq || 0) ||
      String(a.name || "").localeCompare(String(b.name || ""), "ko"));
  }

  const svPeriod = (x) => (x.from || x.to)
    ? (x.from || "?") + " ~ " + (x.to || "?")
    : "-";

  /* ─────── 등록/수정 (hq+) ─────── */
  function svForm(id) {
    const x = id ? svList().find(v => v.id === id) : null;
    const divs = svDivs();
    openModal(`
      <h3>${x ? "발령 정보 수정" : "인원 등록"} <span class="badge badge-gray">보안감독자 현황</span></h3>
      <div class="form-grid">
        <div class="form-row"><label>본부 (부문)</label>
          <input id="sv-div" list="sv-divlist" value="${esc(x ? x.div || "" : "")}" maxlength="40" placeholder="예: 안전보안실 / 영업본부">
          <datalist id="sv-divlist">${divs.map(d => `<option value="${esc(d)}">`).join("")}</datalist></div>
        <div class="form-row"><label>부서</label>
          <input id="sv-dept" value="${esc(x ? x.dept || "" : "")}" maxlength="40" placeholder="예: 항공보안팀"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>직위</label>
          <input id="sv-rank" value="${esc(x ? x.rank || "" : "")}" maxlength="20" placeholder="예: 팀장 / 파트장 / 프로"></div>
        <div class="form-row"><label>직책</label>
          <input id="sv-duty" value="${esc(x ? x.duty || "" : "")}" maxlength="40" placeholder="예: 항공보안팀장 / 팀원"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>성명</label>
          <input id="sv-name" value="${esc(x ? x.name || "" : "")}" maxlength="30"></div>
        <div class="form-row"><label>사번</label>
          <input id="sv-emp" value="${esc(x ? x.empNo || "" : "")}" maxlength="20" placeholder="예: 100046"></div>
      </div>
      <div class="form-row"><label>발령내용</label>
        <select id="sv-role">${SV_ROLES.map(r =>
          `<option value="${esc(r)}" ${(x ? x.role || "" : "항공사보안감독자") === r ? "selected" : ""}>${r || "— 미발령 —"}</option>`).join("")}</select></div>
      <div class="form-grid">
        <div class="form-row"><label>발령 시작일</label><input type="date" id="sv-from" value="${esc(x ? x.from || "" : "")}"></div>
        <div class="form-row"><label>발령 종료일</label><input type="date" id="sv-to" value="${esc(x ? x.to || "" : "")}"></div>
      </div>
      <div class="form-row"><label>비고</label>
        <input id="sv-note" value="${esc(x ? x.note || "" : "")}" maxlength="200"></div>
      <div class="modal-actions">
        ${x && SeMIS.canDelete() ? '<button class="btn btn-danger" id="sv-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="sv-cancel">취소</button>
        <button class="btn btn-primary" id="sv-save">저장</button>
      </div>`);

    $("#sv-cancel").onclick = closeModal;
    if (x && $("#sv-del")) $("#sv-del").onclick = () =>
      confirmModal(`"${x.name || x.duty || "해당 인원"}" 항목을 삭제하시겠습니까?`, () => {
        D().supervisors = svList().filter(v => v.id !== x.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    $("#sv-save").onclick = () => {
      const name = $("#sv-name").value.trim();
      const duty = $("#sv-duty").value.trim();
      if (!name && !duty) { toast("성명 또는 직책을 입력하세요.", true); return; }
      let from = $("#sv-from").value, to = $("#sv-to").value;
      if (from && to && to < from) { const t = from; from = to; to = t; }
      const rec = {
        div: $("#sv-div").value.trim(), dept: $("#sv-dept").value.trim(),
        rank: $("#sv-rank").value.trim(), duty, name,
        empNo: $("#sv-emp").value.trim(), role: $("#sv-role").value,
        from: from || "", to: to || "", note: $("#sv-note").value.trim(),
        updated: new Date().toISOString()
      };
      if (x) Object.assign(x, rec);
      else {
        if (!Array.isArray(D().supervisors)) D().supervisors = [];
        D().supervisors.push(Object.assign({ id: uid("sv"), seq: 999 }, rec));
      }
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ─────── 목록 ─────── */
  function svTableHTML() {
    const items = svFiltered();
    const canWrite = SeMIS.canEdit();
    if (!items.length) return '<div class="empty">해당하는 인원이 없습니다.</div>';
    let rows = "", lastDiv = null;
    const colspan = canWrite ? 8 : 7;
    items.forEach(x => {
      if (x.div !== lastDiv) {
        lastDiv = x.div;
        const n = items.filter(y => y.div === x.div).length;
        rows += `<tr class="grp-row"><td colspan="${colspan}"><b>${esc(x.div || "미지정")}</b>
          <span style="color:var(--text-3);font-weight:500"> · ${n}명</span></td></tr>`;
      }
      const st = svState(x);
      rows += `
      <tr data-sv-row="${esc(x.id)}"${canWrite ? ' style="cursor:pointer" title="클릭하여 수정"' : ""}>
        <td style="font-size:.82rem;color:var(--text-2)">${esc(x.dept || "-")}</td>
        <td style="font-size:.82rem;white-space:nowrap">${esc(x.rank || "-")}</td>
        <td style="font-size:.82rem">${esc(x.duty || "-")}</td>
        <td><b>${esc(x.name || "-")}</b></td>
        <td style="font-size:.82rem;color:var(--text-2);white-space:nowrap">${esc(x.empNo || "-")}</td>
        <td>${x.role
            ? `<span class="badge ${SV_ROLE_BADGE[x.role] || "badge-gray"}" style="white-space:nowrap">${esc(x.role)}</span>`
            : '<span class="badge badge-gray">미발령</span>'}</td>
        <td style="font-size:.8rem;white-space:nowrap">${esc(svPeriod(x))}
          <div style="margin-top:2px"><span class="badge ${SV_STATE_BADGE[st]}">${esc(st)}</span></div></td>
        ${canWrite ? `<td><button class="btn btn-ghost btn-sm" data-sv-edit="${esc(x.id)}" title="수정">✏️</button></td>` : ""}
      </tr>`;
    });
    return `<div class="table-wrap"><table class="tbl tbl-cap" style="--cap:1420px"><thead><tr>
        <th style="width:150px">부서</th><th style="width:76px">직위</th>
        <th style="width:150px">직책</th><th style="width:96px">성명</th>
        <th style="width:82px">사번</th><th style="width:172px">발령내용</th>
        <th style="width:210px">발령기간</th>
        ${canWrite ? '<th style="width:52px">수정</th>' : ""}</tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  SeMIS.registerModule("supervisors", {
    title: "보안감독자 현황",
    render(root) {
      const canWrite = SeMIS.canEdit();
      const s = svStats();
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">👥 보안감독자 현황</div>
          <span class="spacer"></span>
          ${canWrite ? '<button class="btn btn-primary" id="sv-add">+ 인원 등록</button>' : ""}
          <div class="page-desc">항공사보안책임자 · 항공사보안감독자 발령 현황 ·
            <a href="${SV_SHEET}" target="_blank" rel="noopener">원본 시트 ↗</a></div>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-label">전체 인원</div><div class="stat-value">${s.total}</div><div class="stat-sub">${s.divs}개 본부(부문)</div></div>
          <div class="stat"><div class="stat-label">보안책임자</div><div class="stat-value">${s.chief}</div><div class="stat-sub">정 · 부</div></div>
          <div class="stat"><div class="stat-label">보안감독자</div><div class="stat-value">${s.sup}</div><div class="stat-sub">항공사보안감독자</div></div>
          <div class="stat"><div class="stat-label">발령 확인 필요</div><div class="stat-value" style="color:var(--warning)">${s.none}</div><div class="stat-sub">미발령 · 기간 만료</div></div>
        </div>
        <div class="card">
          <div class="cal-toolbar">
            <input id="sv-search" class="ct-search" type="search" style="max-width:280px"
              placeholder="🔍 성명 · 부서 · 직책 · 사번 검색" value="${esc(svQuery)}" autocomplete="off">
            <span class="spacer"></span>
            <div class="cal-views">${["전체"].concat(svDivs()).map(f =>
              `<button class="cal-viewbtn${svDiv === f ? " active" : ""}" data-svfilter="${esc(f)}">${esc(f)}</button>`).join("")}</div>
          </div>
          <div id="sv-body">${svTableHTML()}</div>
        </div>`;

      const wire = () => {
        if (!canWrite) return;
        $$("#sv-body [data-sv-row]").forEach(el => el.onclick = (ev) => {
          if (ev.target.closest("a,button")) return;
          svForm(el.dataset.svRow);
        });
        $$("#sv-body [data-sv-edit]").forEach(b => b.onclick = (ev) => {
          ev.stopPropagation(); svForm(b.dataset.svEdit);
        });
      };
      $("#sv-search").oninput = () => {
        svQuery = $("#sv-search").value.trim();
        $("#sv-body").innerHTML = svTableHTML(); wire();
      };
      $$("[data-svfilter]").forEach(b => b.onclick = () => { svDiv = b.dataset.svfilter; SeMIS.renderView(); });
      if (canWrite) $("#sv-add").onclick = () => svForm(null);
      wire();
    }
  });

  /* ═══════════ ② 지점 보안담당자 ═══════════ */

  const SO_SHEET = "https://docs.google.com/spreadsheets/d/15Qvf5NgdeyfIBBLzFc3BtTGE6kQse-_HTb9u4PvzHt0/edit?usp=sharing";
  const SO_REGION_ORDER = ["미주", "유럽", "일본", "중국", "아시아"];
  const SO_REGION_BADGE = { "미주": "badge-blue", "유럽": "badge-green", "일본": "badge-amber", "중국": "badge-red", "아시아": "badge-orange" };

  const soList = () => (Array.isArray(D().stationOfficers) ? D().stationOfficers : []);

  function soRegions() {
    const set = [];
    soList().forEach(x => { if (x.region && set.indexOf(x.region) < 0) set.push(x.region); });
    return set.sort(soRegionCmp);
  }
  function soRegionCmp(a, b) {
    const ia = SO_REGION_ORDER.indexOf(a), ib = SO_REGION_ORDER.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return String(a).localeCompare(String(b), "ko");
  }

  const isHead = (x) => /지점장|영업소장/.test(String(x.note || ""));

  function soStats() {
    const l = soList();
    const stations = [];
    l.forEach(x => { if (x.station && stations.indexOf(x.station) < 0) stations.push(x.station); });
    return {
      total: l.length,
      stations: stations.length,
      regions: soRegions().length,
      heads: l.filter(isHead).length
    };
  }

  let soQuery = "", soRegion = "전체";

  function soFiltered() {
    const q = soQuery.toLowerCase();
    return soList().filter(x => {
      if (soRegion !== "전체" && x.region !== soRegion) return false;
      if (!q) return true;
      return [x.name, x.region, x.station, x.empNo, x.uniworks, x.note]
        .some(v => String(v || "").toLowerCase().includes(q));
    }).sort((a, b) =>
      soRegionCmp(a.region, b.region) ||
      (a.seq || 0) - (b.seq || 0) ||
      String(a.station || "").localeCompare(String(b.station || "")));
  }

  /* ─────── 등록/수정 (hq+) ─────── */
  function soForm(id) {
    const x = id ? soList().find(v => v.id === id) : null;
    const regions = soRegions();
    openModal(`
      <h3>${x ? "담당자 수정" : "담당자 등록"} <span class="badge badge-gray">지점 보안담당자</span></h3>
      <div class="form-grid">
        <div class="form-row"><label>지역</label>
          <input id="so-region" list="so-reglist" value="${esc(x ? x.region || "" : "")}" maxlength="20" placeholder="예: 미주 / 유럽">
          <datalist id="so-reglist">${regions.map(r => `<option value="${esc(r)}">`).join("")}</datalist></div>
        <div class="form-row"><label>지점코드</label>
          <input id="so-station" value="${esc(x ? x.station || "" : "")}" maxlength="20" placeholder="예: LAX / FRA"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>이름</label>
          <input id="so-name" value="${esc(x ? x.name || "" : "")}" maxlength="60" placeholder="예: 홍길동 / John Doe(홍길동)"></div>
        <div class="form-row"><label>사번</label>
          <input id="so-emp" value="${esc(x ? x.empNo || "" : "")}" maxlength="20"></div>
      </div>
      <div class="form-row"><label>유니웍스 ID</label>
        <input id="so-uw" value="${esc(x ? x.uniworks || "" : "")}" maxlength="40" placeholder="지점보안시스템 로그인 ID"></div>
      <div class="form-row"><label>비고</label>
        <input id="so-note" value="${esc(x ? x.note || "" : "")}" maxlength="200" placeholder="예: 지점장 / KKF / 부여일자"></div>
      <div class="modal-actions">
        ${x && SeMIS.canDelete() ? '<button class="btn btn-danger" id="so-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="so-cancel">취소</button>
        <button class="btn btn-primary" id="so-save">저장</button>
      </div>`);

    $("#so-cancel").onclick = closeModal;
    if (x && $("#so-del")) $("#so-del").onclick = () =>
      confirmModal(`"${x.name}" 담당자를 삭제하시겠습니까?`, () => {
        D().stationOfficers = soList().filter(v => v.id !== x.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    $("#so-save").onclick = () => {
      const name = $("#so-name").value.trim();
      if (!name) { toast("이름을 입력하세요.", true); return; }
      const rec = {
        region: $("#so-region").value.trim(), station: $("#so-station").value.trim().toUpperCase(),
        name, empNo: $("#so-emp").value.trim(), uniworks: $("#so-uw").value.trim(),
        note: $("#so-note").value.trim(), updated: new Date().toISOString()
      };
      if (x) Object.assign(x, rec);
      else {
        if (!Array.isArray(D().stationOfficers)) D().stationOfficers = [];
        D().stationOfficers.push(Object.assign({ id: uid("so"), seq: 999 }, rec));
      }
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  function soTableHTML() {
    const items = soFiltered();
    const canWrite = SeMIS.canEdit();
    if (!items.length) return '<div class="empty">해당하는 담당자가 없습니다.</div>';
    let rows = "", lastRegion = null;
    const colspan = canWrite ? 6 : 5;
    items.forEach(x => {
      if (x.region !== lastRegion) {
        lastRegion = x.region;
        const grp = items.filter(y => y.region === x.region);
        const st = [];
        grp.forEach(y => { if (y.station && st.indexOf(y.station) < 0) st.push(y.station); });
        rows += `<tr class="grp-row"><td colspan="${colspan}">
          <span class="badge ${SO_REGION_BADGE[x.region] || "badge-gray"}">${esc(x.region || "미지정")}</span>
          <span style="color:var(--text-3);font-size:.8rem"> · ${st.length}개 지점 · ${grp.length}명</span></td></tr>`;
      }
      rows += `
      <tr data-so-row="${esc(x.id)}"${canWrite ? ' style="cursor:pointer" title="클릭하여 수정"' : ""}>
        <td style="white-space:nowrap"><b>${esc(x.station || "-")}</b></td>
        <td>${esc(x.name || "-")}${isHead(x) ? ' <span class="badge badge-amber">지점장</span>' : ""}</td>
        <td style="font-size:.82rem;color:var(--text-2);white-space:nowrap">${esc(x.empNo || "-")}</td>
        <td style="font-size:.82rem;white-space:nowrap">${x.uniworks
            ? `<code class="so-uw">${esc(x.uniworks)}</code>` : "-"}</td>
        <td style="font-size:.8rem;color:var(--text-3)">${esc(x.note || "")}</td>
        ${canWrite ? `<td><button class="btn btn-ghost btn-sm" data-so-edit="${esc(x.id)}" title="수정">✏️</button></td>` : ""}
      </tr>`;
    });
    return `<div class="table-wrap"><table class="tbl tbl-cap" style="--cap:1360px"><thead><tr>
        <th style="width:96px">지점</th><th style="width:300px">이름</th>
        <th style="width:90px">사번</th><th style="width:170px">유니웍스 ID</th>
        <th style="min-width:220px">비고</th>
        ${canWrite ? '<th style="width:52px">수정</th>' : ""}</tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  SeMIS.registerModule("stn-officers", {
    title: "지점 보안담당자",
    render(root) {
      const canWrite = SeMIS.canEdit();
      const s = soStats();
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🛫 지점 보안담당자</div>
          <span class="spacer"></span>
          ${canWrite ? '<button class="btn btn-primary" id="so-add">+ 담당자 등록</button>' : ""}
          <div class="page-desc">해외지점 보안담당자 · 지점보안시스템(유니웍스) 계정 부여 현황 ·
            <a href="${SO_SHEET}" target="_blank" rel="noopener">원본 시트 ↗</a></div>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-label">전체 인원</div><div class="stat-value">${s.total}</div><div class="stat-sub">계정 부여 대상</div></div>
          <div class="stat"><div class="stat-label">지점</div><div class="stat-value">${s.stations}</div><div class="stat-sub">${s.regions}개 지역</div></div>
          <div class="stat"><div class="stat-label">지점장 · 영업소장</div><div class="stat-value">${s.heads}</div><div class="stat-sub">지점 책임자</div></div>
          <div class="stat"><div class="stat-label">담당자</div><div class="stat-value">${s.total - s.heads}</div><div class="stat-sub">실무 담당</div></div>
        </div>
        <div class="card">
          <div class="cal-toolbar">
            <input id="so-search" class="ct-search" type="search" style="max-width:280px"
              placeholder="🔍 이름 · 지점 · 사번 · 유니웍스 ID 검색" value="${esc(soQuery)}" autocomplete="off">
            <span class="spacer"></span>
            <div class="cal-views">${["전체"].concat(soRegions()).map(f =>
              `<button class="cal-viewbtn${soRegion === f ? " active" : ""}" data-sofilter="${esc(f)}">${esc(f)}</button>`).join("")}</div>
          </div>
          <div id="so-body">${soTableHTML()}</div>
        </div>`;

      const wire = () => {
        if (!canWrite) return;
        $$("#so-body [data-so-row]").forEach(el => el.onclick = (ev) => {
          if (ev.target.closest("a,button")) return;
          soForm(el.dataset.soRow);
        });
        $$("#so-body [data-so-edit]").forEach(b => b.onclick = (ev) => {
          ev.stopPropagation(); soForm(b.dataset.soEdit);
        });
      };
      $("#so-search").oninput = () => {
        soQuery = $("#so-search").value.trim();
        $("#so-body").innerHTML = soTableHTML(); wire();
      };
      $$("[data-sofilter]").forEach(b => b.onclick = () => { soRegion = b.dataset.sofilter; SeMIS.renderView(); });
      if (canWrite) $("#so-add").onclick = () => soForm(null);
      wire();
    }
  });

  /* ─────── 테스트/외부 노출 ─────── */
  window.SemisOfficers = {
    SV_ROLES, SV_DIV_ORDER, SO_REGION_ORDER,
    svList, svState, svStats, svDivs, svFiltered, svForm,
    soList, soStats, soRegions, soFiltered, soForm, isHead,
    setSvQuery: (q) => { svQuery = String(q || ""); },
    setSvDiv: (d) => { svDiv = d; },
    setSoQuery: (q) => { soQuery = String(q || ""); },
    setSoRegion: (r) => { soRegion = r; }
  };
})();
