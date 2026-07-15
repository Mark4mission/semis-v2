/* ═══════════════════════════════════════════════════════
   SeMIS v2 — Modules
   대시보드 · 일정관리 · 시스템설정
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, fmtDate, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ════════════════ 대시보드 ════════════════ */
  SeMIS.registerModule("dashboard", {
    title: "대시보드",
    render(root) {
      const d = D();
      const canWrite = SeMIS.roleRank() >= 2;
      const notices = d.notices.slice().sort((a, b) =>
        (b.pinned - a.pinned) || String(b.created).localeCompare(String(a.created)));
      const upcoming = d.schedules.filter(s => (s.end || s.start) >= todayISO())
        .sort((a, b) => String(a.start).localeCompare(String(b.start))).slice(0, 5);
      const quicks = SeMIS.sortedMenus().filter(m => m.type === "link" && m.quick && SeMIS.canSee(m));
      const linkCount = d.menus.filter(m => m.type === "link").length;

      const cur = SeMIS.secCurrent();
      const nxt = SeMIS.secNext();
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🏠 대시보드</div>
          <div class="page-desc">에어제타 보안종합정보시스템 — ${esc(fmtDate(new Date().toISOString()))}</div>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-label">국가 항공보안등급</div>
            <div class="stat-value" id="stat-level"></div>
            <div class="stat-sub">${esc(cur.date ? cur.date + "~" : "")} ${esc(cur.note || "")}</div></div>
          <div class="stat"><div class="stat-label">공지사항</div>
            <div class="stat-value">${notices.length}<span style="font-size:.8rem;font-weight:600"> 건</span></div>
            <div class="stat-sub">고정 ${notices.filter(n => n.pinned).length}건</div></div>
          <div class="stat"><div class="stat-label">예정 일정</div>
            <div class="stat-value">${upcoming.length}<span style="font-size:.8rem;font-weight:600"> 건</span></div>
            <div class="stat-sub">오늘 이후</div></div>
          <div class="stat"><div class="stat-label">등록 링크 메뉴</div>
            <div class="stat-value">${linkCount}<span style="font-size:.8rem;font-weight:600"> 개</span></div>
            <div class="stat-sub">외부 자료 연결</div></div>
        </div>
        <div class="dash-grid">
          <div class="dash-col">
            <div class="card">
              <div class="card-title">📢 공지사항 <span class="spacer"></span>
                ${canWrite ? '<button class="btn btn-primary btn-sm" id="btn-add-notice">+ 새 공지</button>' : ""}
              </div>
              <div id="notice-list"></div>
            </div>
          </div>
          <div class="dash-col">
            <div class="card">
              <div class="card-title">🚨 보안등급 <span class="spacer"></span>
                ${canWrite ? '<button class="btn btn-ghost btn-sm" id="btn-edit-level">변경</button>' : ""}
              </div>
              <div id="level-box"></div>
            </div>
            <div class="card">
              <div class="card-title">⚡ 바로가기</div>
              <div class="quick-links">
                ${quicks.map(m => `<a class="quick-link" href="${esc(m.url)}" target="_blank" rel="noopener">
                  <span>${esc(m.icon || "🔗")}</span><span>${esc(m.label)}</span></a>`).join("") ||
                  '<div class="empty">등록된 바로가기가 없습니다.</div>'}
              </div>
            </div>
            <div class="card">
              <div class="card-title">📅 다가오는 일정 <span class="spacer"></span>
                <button class="btn btn-ghost btn-sm" id="btn-go-schedule">전체보기</button></div>
              <div id="upcoming-box"></div>
            </div>
          </div>
        </div>`;

      // 보안등급 (5단계: 평시-관심-주의-경계-심각)
      const lvColor = (l) => ({ "평시": "badge-green", "관심": "badge-blue", "주의": "badge-amber",
        "경계": "badge-orange", "심각": "badge-red" }[l] || "badge-gray");
      $("#stat-level").innerHTML = `<span class="badge ${lvColor(cur.level)}" style="font-size:1rem;padding:4px 14px">${esc(cur.level)}</span>`;
      const hist = SeMIS.levelSorted().slice().reverse().slice(0, 5);
      $("#level-box").innerHTML = `
        <p style="font-size:.9rem"><b>현재 등급:</b> <span class="badge ${lvColor(cur.level)}">${esc(cur.level)}</span>
          <span style="font-size:.78rem;color:var(--text-3)">${esc(cur.date ? cur.date + "~" : "")}</span></p>
        <p style="font-size:.82rem;color:var(--text-2);margin-top:5px">${esc(cur.note || "비고 없음")}</p>
        ${nxt ? `<p style="font-size:.82rem;margin-top:8px;padding:7px 10px;background:var(--primary-soft);border-radius:6px">
          ⏰ <b>변경 예약:</b> ${esc(nxt.date)}부터 <span class="badge ${lvColor(nxt.level)}">${esc(nxt.level)}</span></p>` : ""}
        <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px">
          <div style="font-size:.74rem;font-weight:700;color:var(--text-3);margin-bottom:4px">변경 이력</div>
          ${hist.map(e => `<div style="display:flex;align-items:center;gap:6px;font-size:.78rem;padding:3px 0;color:var(--text-2)">
            <span style="white-space:nowrap">${esc(e.date)}</span>
            <span class="badge ${lvColor(e.level)}">${esc(e.level)}</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.note || "")}</span>
            <span style="color:var(--text-3)">${esc(e.by || "")}</span>
            ${canWrite && hist.length > 1 ? `<button class="mt-btn danger" data-lvdel="${esc(e.id)}" title="삭제">✕</button>` : ""}
          </div>`).join("")}
        </div>`;
      $$("#level-box [data-lvdel]").forEach(b => b.onclick = () =>
        confirmModal("이 등급 기록을 삭제하시겠습니까?", () => {
          D().levelHistory = D().levelHistory.filter(x => x.id !== b.dataset.lvdel);
          SeMIS.save(); SeMIS.renderSecBadge(); SeMIS.renderView(); toast("삭제되었습니다.");
        }));

      // 공지 리스트
      const nl = $("#notice-list");
      if (!notices.length) nl.innerHTML = '<div class="empty">등록된 공지가 없습니다.</div>';
      notices.forEach(n => {
        const item = document.createElement("div");
        item.className = "notice-item";
        item.innerHTML = `
          <div class="notice-title">${n.pinned ? '<span class="badge badge-red">고정</span>' : ""}<span>${esc(n.title)}</span></div>
          <div class="notice-meta">${esc(n.author)} · ${esc(fmtDate(n.created))}</div>
          <div class="notice-body">${esc(n.body)}
            ${canWrite ? `<div style="margin-top:10px;display:flex;gap:6px">
              <button class="btn btn-ghost btn-sm" data-edit="${esc(n.id)}">수정</button>
              <button class="btn btn-danger btn-sm" data-del="${esc(n.id)}">삭제</button></div>` : ""}
          </div>`;
        item.querySelector(".notice-title").parentElement.addEventListener("click", (e) => {
          if (e.target.closest("button")) return;
          item.classList.toggle("open");
        });
        nl.appendChild(item);
      });
      $$("#notice-list [data-edit]").forEach(b => b.onclick = () => noticeForm(b.dataset.edit));
      $$("#notice-list [data-del]").forEach(b => b.onclick = () =>
        confirmModal("이 공지를 삭제하시겠습니까?", () => {
          D().notices = D().notices.filter(x => x.id !== b.dataset.del);
          SeMIS.save(); SeMIS.renderView(); toast("삭제되었습니다.");
        }));

      // 일정
      $("#upcoming-box").innerHTML = upcoming.length
        ? upcoming.map(s => `<div style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid var(--border);font-size:.86rem">
            <span class="cal-dot ev-${esc(s.color || "blue")}"></span>
            <b style="color:var(--primary);white-space:nowrap">${esc(String(s.start).slice(5))}${s.end && s.end !== s.start ? "~" + esc(String(s.end).slice(5)) : ""}</b>
            ${!s.allDay && s.time ? `<span style="font-size:.76rem;color:var(--text-3);white-space:nowrap">${esc(s.time)}</span>` : ""}
            <span style="${s.done ? "text-decoration:line-through;color:var(--text-3)" : ""};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.done ? "✓ " : ""}${s.vehicle ? "🚗" : ""}${s.room ? "🏢" : ""}${(s.reminders && s.reminders.length) ? "⏰" : ""}${esc(s.title)}</span>
            ${s.assignee ? `<span class="badge badge-gray" style="margin-left:auto">${esc(s.assignee)}</span>` : ""}</div>`).join("")
        : '<div class="empty">예정된 일정이 없습니다.</div>';
      $("#btn-go-schedule").onclick = () => SeMIS.navigate("schedule");

      if (canWrite) {
        $("#btn-add-notice").onclick = () => noticeForm(null);
        $("#btn-edit-level").onclick = levelForm;
      }
    }
  });

  function noticeForm(id) {
    const n = id ? D().notices.find(x => x.id === id) : null;
    openModal(`
      <h3>${n ? "공지 수정" : "새 공지 작성"}</h3>
      <div class="form-row"><label>제목</label><input id="f-title" value="${esc(n ? n.title : "")}" maxlength="120"></div>
      <div class="form-row"><label>내용</label><textarea id="f-body" rows="6">${esc(n ? n.body : "")}</textarea></div>
      <div class="form-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="f-pinned" style="width:auto" ${n && n.pinned ? "checked" : ""}> 상단 고정</label></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">저장</button>
      </div>`);
    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const title = $("#f-title").value.trim();
      if (!title) { toast("제목을 입력하세요.", true); return; }
      const body = $("#f-body").value.trim();
      const pinned = $("#f-pinned").checked;
      if (n) Object.assign(n, { title, body, pinned });
      else D().notices.push({ id: uid("n"), title, body, pinned, author: SeMIS.user.name, created: new Date().toISOString() });
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  function levelForm() {
    const cur = SeMIS.secCurrent();
    openModal(`
      <h3>국가 항공보안등급 변경</h3>
      <div class="form-row"><label>등급 (5단계)</label>
        <select id="f-level">${SeMIS.SEC_LEVELS.map(l =>
          `<option ${cur.level === l ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="form-row"><label>적용일</label><input type="date" id="f-date" value="${esc(todayISO())}">
        <div class="form-hint">미래 날짜를 지정하면 해당 일자부터 자동 적용되는 <b>변경 예약</b>이 됩니다.</div></div>
      <div class="form-row"><label>비고 (근거/기간 등)</label><input id="f-note" maxlength="100" placeholder="예: 국토부 지침 제2026-OO호"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">저장</button>
      </div>`);
    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const date = $("#f-date").value;
      if (!date) { toast("적용일을 입력하세요.", true); return; }
      D().levelHistory.push({
        id: uid("lv"), date, level: $("#f-level").value,
        note: $("#f-note").value.trim(), by: SeMIS.user.name, at: new Date().toISOString()
      });
      SeMIS.save(); closeModal(); SeMIS.renderSecBadge(); SeMIS.renderView();
      toast(date > todayISO() ? "등급 변경이 예약되었습니다." : "보안등급이 변경되었습니다.");
    };
  }

  /* ════════════════ 일정관리 ════════════════
     v2.1: 캘린더 고도화 모듈(js/calendar.js)로 이관 — "schedule" 모듈은
     calendar.js에서 SeMIS.registerModule("schedule", ...)로 등록됩니다. */

  /* ════════════════ 시스템 설정 (관리자 전용) ════════════════ */
  SeMIS.registerModule("settings", {
    title: "시스템 설정",
    render(root) {
      if (!SeMIS.isAdmin()) {
        root.innerHTML = '<div class="card"><div class="empty">🔒 시스템관리자 전용 메뉴입니다.</div></div>';
        return;
      }
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">⚙️ 시스템 설정</div>
          <div class="page-desc">메뉴 · 사용자 권한 · 데이터 관리</div>
        </div>
        <div class="tabs">
          <button class="tab active" data-tab="menus">메뉴 관리</button>
          <button class="tab" data-tab="users">사용자 / 암호</button>
          <button class="tab" data-tab="data">데이터 관리</button>
        </div>
        <div id="tab-body"></div>`;
      const tabs = { menus: renderMenuTab, users: renderUserTab, data: renderDataTab };
      $$(".tab").forEach(t => t.onclick = () => {
        $$(".tab").forEach(x => x.classList.remove("active"));
        t.classList.add("active");
        tabs[t.dataset.tab]($("#tab-body"));
      });
      renderMenuTab($("#tab-body"));
    }
  });

  /* ───── 메뉴 관리 탭 ───── */
  function renderMenuTab(box) {
    const menus = SeMIS.sortedMenus();
    const typeBadge = (m) =>
      m.type === "group" ? '<span class="badge badge-gray mt-type">그룹</span>'
      : m.type === "link" ? '<span class="badge badge-blue mt-type">링크</span>'
      : '<span class="badge badge-green mt-type">모듈</span>';

    const row = (m, isChild) => `
      <div class="menu-tree-item ${isChild ? "is-child" : ""}" data-id="${esc(m.id)}">
        <span>${esc(m.icon || (m.type === "group" ? "📂" : "▪"))}</span>
        <span class="mt-label">${esc(m.label)}
          ${m.quick ? '<span class="badge badge-amber mt-type">바로가기</span>' : ""}</span>
        ${typeBadge(m)}
        <span class="badge badge-gray mt-type">${esc(SeMIS.VIS_LABEL[m.vis || "all"] || "전체")}</span>
        <span class="mt-actions">
          <button class="mt-btn" data-up="${esc(m.id)}" title="위로">▲</button>
          <button class="mt-btn" data-down="${esc(m.id)}" title="아래로">▼</button>
          <button class="mt-btn" data-edit="${esc(m.id)}" title="수정">✏️</button>
          ${m.module === "settings" || m.module === "dashboard" ? "" :
            `<button class="mt-btn danger" data-del="${esc(m.id)}" title="삭제">🗑</button>`}
        </span>
      </div>`;

    let html = `
      <div class="card">
        <div class="card-title">메뉴 구성 <span class="spacer"></span>
          <button class="btn btn-primary btn-sm" id="btn-add-menu">+ 메뉴 추가</button></div>
        <p class="form-hint" style="margin-bottom:12px">외부 웹주소를 링크 메뉴로 등록하거나, 그룹을 만들어 메뉴를 분류할 수 있습니다. ▲▼로 순서 변경.</p>
        <div id="menu-tree">`;
    menus.filter(m => !m.parent || m.type === "group").forEach(m => {
      html += row(m, false);
      if (m.type === "group") menus.filter(c => c.parent === m.id).forEach(c => { html += row(c, true); });
    });
    html += `</div></div>`;
    box.innerHTML = html;

    $("#btn-add-menu").onclick = () => menuForm(null);
    $$("#menu-tree [data-edit]").forEach(b => b.onclick = () => menuForm(b.dataset.edit));
    $$("#menu-tree [data-up]").forEach(b => b.onclick = () => moveMenu(b.dataset.up, -1));
    $$("#menu-tree [data-down]").forEach(b => b.onclick = () => moveMenu(b.dataset.down, 1));
    $$("#menu-tree [data-del]").forEach(b => b.onclick = () => {
      const m = D().menus.find(x => x.id === b.dataset.del);
      const msg = m.type === "group"
        ? `그룹 "${m.label}"과 하위 메뉴가 모두 삭제됩니다. 계속하시겠습니까?`
        : `메뉴 "${m.label}"을(를) 삭제하시겠습니까?`;
      confirmModal(msg, () => {
        D().menus = D().menus.filter(x => x.id !== m.id && x.parent !== m.id);
        SeMIS.save(); SeMIS.renderNav(); renderMenuTab($("#tab-body")); toast("삭제되었습니다.");
      });
    });
  }

  function moveMenu(id, dir) {
    const menus = SeMIS.sortedMenus();
    const me = menus.find(m => m.id === id);
    // 형제 그룹: 같은 parent (최상위는 그룹+루트 항목이 하나의 형제 집합)
    const siblings = menus.filter(m =>
      me.parent ? m.parent === me.parent : (!m.parent || m.type === "group"));
    const idx = siblings.findIndex(m => m.id === id);
    const swap = siblings[idx + dir];
    if (!swap) return;
    const real1 = D().menus.find(m => m.id === me.id);
    const real2 = D().menus.find(m => m.id === swap.id);
    const t = real1.seq; real1.seq = real2.seq; real2.seq = t;
    SeMIS.save(); SeMIS.renderNav(); renderMenuTab($("#tab-body"));
  }

  function menuForm(id) {
    const m = id ? D().menus.find(x => x.id === id) : null;
    const groups = SeMIS.sortedMenus().filter(x => x.type === "group");
    const isCore = m && m.type === "module";
    const type = m ? m.type : "link";
    openModal(`
      <h3>${m ? "메뉴 수정" : "메뉴 추가"}</h3>
      ${m ? "" : `<div class="form-row"><label>유형</label>
        <select id="f-type">
          <option value="link">외부 링크 (웹주소 등록)</option>
          <option value="group">그룹 (메뉴 분류)</option>
        </select></div>`}
      <div class="form-row"><label>이름</label><input id="f-label" value="${esc(m ? m.label : "")}" maxlength="40" placeholder="메뉴 이름"></div>
      <div class="form-row" id="row-icon" ${type === "group" && m ? 'style="display:none"' : ""}>
        <label>아이콘 (이모지)</label><input id="f-icon" value="${esc(m ? m.icon || "" : "🔗")}" maxlength="4"></div>
      <div class="form-row" id="row-url" ${type !== "link" ? 'style="display:none"' : ""}>
        <label>웹주소 (URL)</label><input id="f-url" value="${esc(m && m.url ? m.url : "")}" placeholder="https://...">
        <div class="form-hint">기존 구글 문서/사이트 등 외부 주소를 그대로 연결합니다.</div></div>
      <div class="form-row" id="row-parent" ${type === "group" ? 'style="display:none"' : ""}>
        <label>소속 그룹</label>
        <select id="f-parent">
          <option value="">(최상위)</option>
          ${groups.map(g => `<option value="${esc(g.id)}" ${m && m.parent === g.id ? "selected" : ""}>${esc(g.label)}</option>`).join("")}
        </select></div>
      <div class="form-row" id="row-vis" ${type === "group" ? 'style="display:none"' : ""}>
        <label>접근 권한</label>
        <select id="f-vis">
          <option value="all" ${!m || m.vis === "all" ? "selected" : ""}>전체 사용자</option>
          <option value="mgr" ${m && m.vis === "mgr" ? "selected" : ""}>보안관리자 이상</option>
          <option value="admin" ${m && m.vis === "admin" ? "selected" : ""}>시스템관리자만</option>
        </select></div>
      <div class="form-row" id="row-quick" ${type !== "link" ? 'style="display:none"' : ""}>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="f-quick" style="width:auto" ${m && m.quick ? "checked" : ""}> 대시보드 바로가기에 표시</label></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">저장</button>
      </div>`);

    const typeSel = $("#f-type");
    if (typeSel) typeSel.onchange = () => {
      const t = typeSel.value;
      $("#row-url").style.display = t === "link" ? "" : "none";
      $("#row-parent").style.display = t === "group" ? "none" : "";
      $("#row-vis").style.display = t === "group" ? "none" : "";
      $("#row-quick").style.display = t === "link" ? "" : "none";
    };
    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const label = $("#f-label").value.trim();
      if (!label) { toast("이름을 입력하세요.", true); return; }
      const t = m ? m.type : typeSel.value;
      const icon = $("#f-icon") ? $("#f-icon").value.trim() : "";
      if (t === "link") {
        const url = $("#f-url").value.trim();
        if (!/^https?:\/\/.+/.test(url)) { toast("올바른 웹주소(https://...)를 입력하세요.", true); return; }
        if (m) Object.assign(m, { label, icon, url, parent: $("#f-parent").value || null, vis: $("#f-vis").value, quick: $("#f-quick").checked });
        else D().menus.push({ id: uid("mn"), seq: nextSeq(), type: "link", label, icon, url,
          parent: $("#f-parent").value || null, vis: $("#f-vis").value, quick: $("#f-quick").checked });
      } else if (t === "group") {
        if (m) Object.assign(m, { label });
        else D().menus.push({ id: uid("g"), seq: nextSeq(), type: "group", label });
      } else if (isCore) {
        // 내부 모듈: 이름/아이콘/권한/그룹만 수정 가능
        Object.assign(m, { label, icon, parent: $("#f-parent").value || null, vis: $("#f-vis").value });
      }
      SeMIS.save(); closeModal(); SeMIS.renderNav(); renderMenuTab($("#tab-body")); toast("저장되었습니다.");
    };
  }
  function nextSeq() {
    return D().menus.reduce((mx, m) => Math.max(mx, m.seq || 0), 0) + 1;
  }

  /* ───── 사용자 / 암호 탭 ───── */
  function renderUserTab(box) {
    const users = SeMIS.allUsers();
    box.innerHTML = `
      <div class="card">
        <div class="card-title">사용자 계정 <span class="spacer"></span>
          <button class="btn btn-primary btn-sm" id="btn-add-user">+ 사용자 추가</button></div>
        <p class="form-hint" style="margin-bottom:12px">
          로그인은 <b>암호만 입력</b>하는 방식입니다. 암호로 사용자가 식별되므로 사용자별 암호는 서로 달라야 합니다.
          암호는 SHA-256 해시로만 저장되어 코드/데이터에서 평문이 노출되지 않습니다.</p>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>계정</th><th>이름</th><th>권한</th><th style="width:180px">관리</th></tr></thead>
          <tbody>
          ${users.map(u => `<tr>
            <td><b>${esc(u.id)}</b></td>
            <td>${esc(u.name)}</td>
            <td><span class="badge ${u.role === "admin" ? "badge-red" : u.role === "manager" ? "badge-blue" : "badge-gray"}">
              ${esc(SeMIS.ROLE_LABEL[u.role] || u.role)}</span></td>
            <td>
              <button class="btn btn-ghost btn-sm" data-pw="${esc(u.id)}">암호 변경</button>
              ${SeMIS.BASE_USERS.some(b => b.id === u.id) ? "" :
                `<button class="btn btn-danger btn-sm" data-del="${esc(u.id)}">삭제</button>`}
            </td></tr>`).join("")}
          </tbody></table></div>
      </div>`;
    $("#btn-add-user").onclick = () => userForm();
    $$("[data-pw]", box).forEach(b => b.onclick = () => pwForm(b.dataset.pw));
    $$("[data-del]", box).forEach(b => b.onclick = () =>
      confirmModal(`사용자 "${b.dataset.del}"을(를) 삭제하시겠습니까?`, () => {
        D().customUsers = D().customUsers.filter(u => u.id !== b.dataset.del);
        SeMIS.save(); renderUserTab($("#tab-body")); toast("삭제되었습니다.");
      }));
  }

  function hashInUse(hash, exceptId) {
    return SeMIS.allUsers().some(u => u.hash === hash && u.id !== exceptId);
  }

  function pwForm(userId) {
    openModal(`
      <h3>암호 변경 — ${esc(userId)}</h3>
      <div class="form-row"><label>새 암호</label><input type="password" id="f-pw1" autocomplete="new-password"></div>
      <div class="form-row"><label>새 암호 확인</label><input type="password" id="f-pw2" autocomplete="new-password"></div>
      <div class="form-hint">4자 이상. 다른 사용자와 동일한 암호는 사용할 수 없습니다.</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">변경</button>
      </div>`);
    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const p1 = $("#f-pw1").value, p2 = $("#f-pw2").value;
      if (p1.length < 4) { toast("암호는 4자 이상이어야 합니다.", true); return; }
      if (p1 !== p2) { toast("암호가 일치하지 않습니다.", true); return; }
      const h = SeMIS.pwHash(p1);
      if (hashInUse(h, userId)) { toast("다른 사용자가 사용 중인 암호입니다.", true); return; }
      const cu = D().customUsers.find(u => u.id === userId);
      if (cu) cu.hash = h;
      else D().pwOverrides[userId] = h;
      SeMIS.save(); closeModal(); toast("암호가 변경되었습니다.");
    };
  }

  function userForm() {
    openModal(`
      <h3>사용자 추가</h3>
      <div class="form-grid">
        <div class="form-row"><label>계정 ID</label><input id="f-uid" maxlength="20" placeholder="영문/숫자"></div>
        <div class="form-row"><label>이름</label><input id="f-uname" maxlength="20" placeholder="표시 이름"></div>
      </div>
      <div class="form-row"><label>권한</label>
        <select id="f-urole">
          <option value="user">일반사용자</option>
          <option value="manager">보안관리자</option>
          <option value="admin">시스템관리자</option>
        </select></div>
      <div class="form-row"><label>암호</label><input type="password" id="f-upw" autocomplete="new-password"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">추가</button>
      </div>`);
    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const id = $("#f-uid").value.trim(), name = $("#f-uname").value.trim(), pw = $("#f-upw").value;
      if (!/^[A-Za-z0-9_-]{2,20}$/.test(id)) { toast("계정 ID는 영문/숫자 2~20자입니다.", true); return; }
      if (SeMIS.allUsers().some(u => u.id === id)) { toast("이미 존재하는 계정입니다.", true); return; }
      if (!name) { toast("이름을 입력하세요.", true); return; }
      if (pw.length < 4) { toast("암호는 4자 이상이어야 합니다.", true); return; }
      const h = SeMIS.pwHash(pw);
      if (hashInUse(h, id)) { toast("다른 사용자가 사용 중인 암호입니다.", true); return; }
      D().customUsers.push({ id, name, role: $("#f-urole").value, hash: h });
      SeMIS.save(); closeModal(); renderUserTab($("#tab-body")); toast("사용자가 추가되었습니다.");
    };
  }

  /* ───── 데이터 관리 탭 ───── */
  function renderDataTab(box) {
    box.innerHTML = `
      <div class="card">
        <div class="card-title">💾 백업 / 복원</div>
        <p class="form-hint" style="margin-bottom:12px">
          모든 데이터(메뉴, 공지, 일정, 사용자 설정)는 <b>Supabase 공용 DB</b>에 실시간 동기화되며,
          이 브라우저의 localStorage에도 저장되어 오프라인에서도 사용할 수 있습니다.
          백업 파일은 비상 복구용으로 주기적으로 내려받아 두는 것을 권장합니다.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" id="btn-export">⬇ 백업 파일 다운로드</button>
          <label class="btn btn-ghost" style="cursor:pointer">⬆ 백업 파일 복원
            <input type="file" id="btn-import" accept=".json" style="display:none"></label>
        </div>
      </div>
      <div class="card">
        <div class="card-title">🧹 초기화</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" id="btn-reset-menu">메뉴 기본값으로 재설정</button>
          <button class="btn btn-danger" id="btn-reset-all">전체 데이터 초기화</button>
        </div>
        <p class="form-hint" style="margin-top:10px">전체 초기화 시 공지·일정·사용자 설정·암호 변경 내역이 모두 삭제됩니다.</p>
      </div>
      <div class="card">
        <div class="card-title">ℹ️ 시스템 정보</div>
        <table class="tbl">
          <tr><td style="width:140px;color:var(--text-2)">버전</td><td>SeMIS v${esc(SeMIS.VERSION)}</td></tr>
          <tr><td style="color:var(--text-2)">저장 방식</td><td>Supabase 공용 DB 실시간 동기화 + localStorage 오프라인 폴백</td></tr>
          <tr><td style="color:var(--text-2)">동기화</td><td><span id="sysinfo-sync">-</span> <button class="btn btn-ghost btn-sm" id="btn-sync-now" style="margin-left:8px">지금 동기화</button></td></tr>
          <tr><td style="color:var(--text-2)">인증 방식</td><td>SHA-256 해시 대조 (평문 암호 미저장)</td></tr>
          <tr><td style="color:var(--text-2)">구버전</td><td><a href="https://sites.google.com/view/kjsemis/" target="_blank" rel="noopener">sites.google.com/view/kjsemis ↗</a></td></tr>
        </table>
      </div>`;

    $("#btn-export").onclick = () => {
      const blob = new Blob([JSON.stringify(D(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "semis2-backup-" + todayISO().replace(/-/g, "") + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
      toast("백업 파일이 다운로드되었습니다.");
    };
    $("#btn-import").onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          if (!obj || !Array.isArray(obj.menus)) throw new Error("형식 오류");
          confirmModal("현재 데이터를 백업 파일 내용으로 교체합니다. 공용 DB에도 복원 내용이 반영됩니다. 계속하시겠습니까?", () => {
            localStorage.setItem("semis2:data", JSON.stringify(obj));
            localStorage.setItem("semis2:forcePush", "1"); // 복원본을 공용 DB에 우선 반영
            toast("복원되었습니다. 새로고침합니다.");
            setTimeout(() => location.reload(), 700);
          });
        } catch (err) {
          toast("올바른 백업 파일이 아닙니다.", true);
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    };
    $("#btn-reset-menu").onclick = () =>
      confirmModal("메뉴 구성을 기본값으로 재설정합니다. (공지/일정/사용자는 유지)", () => {
        const cur = D();
        localStorage.setItem("semis2:data", JSON.stringify(Object.assign({}, cur, { menus: null })));
        SeMIS.load();
        SeMIS.renderNav(); renderDataTab($("#tab-body")); toast("메뉴가 재설정되었습니다.");
      });
    $("#btn-reset-all").onclick = () =>
      confirmModal("이 브라우저의 로컬 데이터가 초기화됩니다. (공용 DB에 데이터가 있으면 접속 시 다시 동기화됩니다.) 계속하시겠습니까?", () => {
        localStorage.removeItem("semis2:data");
        localStorage.removeItem("semis2:ui");
        localStorage.removeItem("semis2:pendingSync");
        sessionStorage.removeItem("semis2:session");
        location.reload();
      });

    // 동기화 상태 / 수동 동기화 (sync.js 로드 시)
    const syncInfo = $("#sysinfo-sync");
    if (syncInfo) {
      const label = { online: "🟢 연결됨 (실시간)", syncing: "🟡 동기화 중", offline: "🔴 오프라인 (로컬 저장)", init: "⏳ 연결 중" };
      const refresh = () => { syncInfo.textContent = window.SemisSync ? (label[SemisSync.status] || SemisSync.status) : "미사용 (localStorage 전용)"; };
      refresh();
      $("#btn-sync-now").onclick = () => {
        if (!window.SemisSync) { toast("동기화 모듈이 로드되지 않았습니다.", true); return; }
        SemisSync.syncNow().then(() => { refresh(); toast("동기화되었습니다."); })
          .catch(() => { refresh(); toast("동기화 실패 — 네트워크를 확인하세요.", true); });
      };
    }
  }
})();
