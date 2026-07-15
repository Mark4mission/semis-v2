/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 일정관리 캘린더 모듈 (v2.2)
   기간(시작-종료) · 종일/시간 · 14색 팔레트 · 완료/차량/회의실 체크
   담당자 팀 태그 · 리마인더(2주/1주/1일/1시간 전) · 구글캘린더 연동
   보기: 일 / 주 / 2주 / 월 / 년 · 드래그앤드롭 이동/기간 조정

   데이터 스키마: { id, title, memo, start, end, allDay, time, timeEnd,
                    color, done, assignee, vehicle, room, reminders[], gcalId? }
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ─────── 날짜 유틸 ─────── */
  const p2 = (n) => String(n).padStart(2, "0");
  const toISO = (d) => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  const fromISO = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => toISO(new Date());
  const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
  const diffDays = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 86400000);
  const startOfWeek = (iso) => addDays(iso, -fromISO(iso).getDay()); // 일요일 시작
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const dowName = (iso) => DOW[fromISO(iso).getDay()];

  /* ─────── 색상 팔레트 (14색, 고대비) ─────── */
  const COLORS = [
    { id: "blue",   label: "파랑" }, { id: "sky",    label: "하늘" },
    { id: "teal",   label: "청록" }, { id: "green",  label: "초록" },
    { id: "lime",   label: "연두" }, { id: "yellow", label: "노랑" },
    { id: "amber",  label: "황갈" }, { id: "orange", label: "주황" },
    { id: "red",    label: "빨강" }, { id: "pink",   label: "분홍" },
    { id: "purple", label: "보라" }, { id: "indigo", label: "남색" },
    { id: "brown",  label: "갈색" }, { id: "gray",   label: "회색" }
  ];

  /* ─────── 항공보안파트 팀 (담당자 태그) ─────── */
  const TEAM = [
    { name: "박철성", title: "항공보안파트장", emoji: "🧭", short: "박" },
    { name: "최상일", title: "프로",           emoji: "🛡️", short: "최" },
    { name: "이은우", title: "프로",           emoji: "✈️", short: "은" },
    { name: "이윤민", title: "프로",           emoji: "🔒", short: "윤" }
  ];
  const memberOf = (name) => TEAM.find(t => t.name === name);
  const tagOf = (name) => {
    if (!name) return "";
    const m = memberOf(name);
    return m ? m.emoji + m.short : name.slice(0, 2);
  };

  /* ─────── 리마인더 정의 ─────── */
  const REMINDER_DEFS = [
    { id: "2w", label: "2주일 전", ms: 14 * 86400000 },
    { id: "1w", label: "1주일 전", ms: 7 * 86400000 },
    { id: "1d", label: "1일 전",   ms: 86400000 },
    { id: "1h", label: "1시간 전", ms: 3600000 }
  ];
  const LS_FIRED = "semis2:firedRem";

  function eventStartMs(e) {
    const d = fromISO(e.start);
    if (!e.allDay && e.time) {
      const [h, m] = String(e.time).split(":").map(Number);
      d.setHours(h || 0, m || 0, 0, 0);
    } else d.setHours(9, 0, 0, 0); // 종일 일정은 당일 09:00 기준
    return d.getTime();
  }
  function firedMap() {
    try { return JSON.parse(localStorage.getItem(LS_FIRED)) || {}; } catch (e) { return {}; }
  }
  function markFired(key) {
    const m = firedMap();
    m[key] = Date.now();
    Object.keys(m).forEach(k => { if (Date.now() - m[k] > 60 * 86400000) delete m[k]; }); // 60일 경과분 정리
    localStorage.setItem(LS_FIRED, JSON.stringify(m));
  }
  function dueReminders(nowMs) {
    nowMs = nowMs || Date.now();
    const fired = firedMap();
    const out = [];
    D().schedules.forEach(e => {
      if (e.done || !Array.isArray(e.reminders) || !e.reminders.length) return;
      const startMs = eventStartMs(e);
      e.reminders.forEach(r => {
        const def = REMINDER_DEFS.find(d => d.id === r);
        if (!def) return;
        if (fired[e.id + "|" + r]) return;
        if (nowMs >= startMs - def.ms && nowMs < startMs) out.push({ event: e, offset: r, label: def.label });
      });
    });
    return out;
  }
  function checkReminders() {
    dueReminders().forEach(d => {
      const when = d.event.start + (d.event.allDay ? " (종일)" : " " + (d.event.time || ""));
      try { toast("⏰ " + d.label + " 알림: " + d.event.title + " — " + when); } catch (e) {}
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted")
          new Notification("SeMIS 일정 알림", { body: d.label + " · " + d.event.title + "\n" + when });
      } catch (e) {}
      markFired(d.event.id + "|" + d.offset);
    });
  }
  let remTimer = null;
  function startReminders() {
    if (remTimer) return;
    try { checkReminders(); } catch (e) {}
    remTimer = setInterval(() => { try { checkReminders(); } catch (e) {} }, 60000);
  }
  function stopReminders() { if (remTimer) { clearInterval(remTimer); remTimer = null; } }

  /* ─────── 구글캘린더 연동 (Google → SeMIS 표시) ─────── */
  const ICS_URL = "https://mzyuzrxkdcpzxojenwat.supabase.co/functions/v1/semis-ics?t=azs-e8f4c1d97b2a4f60b3519c";
  const GCOLOR = { "1": "indigo", "2": "green", "3": "purple", "4": "pink", "5": "yellow",
                   "6": "orange", "7": "sky", "8": "gray", "9": "blue", "10": "teal", "11": "red" };
  let gcalEvents = (() => {
    try { const c = JSON.parse(localStorage.getItem("semis2:gcalCache")); return (c && c.items) || []; }
    catch (e) { return []; }
  })();
  let gcalAt = 0, gcalLoading = false;
  const gcalCfg = () => D().gcal || {};

  function mapGcalItem(it) {
    if (!it || !it.start || it.status === "cancelled") return null;
    const allDay = !!it.start.date;
    let start, end, time = "", timeEnd = "";
    if (allDay) {
      start = String(it.start.date).slice(0, 10);
      end = addDays(String((it.end && it.end.date) || it.start.date).slice(0, 10), -1); // ICS DTEND는 exclusive
      if (end < start) end = start;
    } else {
      const sd = String(it.start.dateTime || "");
      const ed = String((it.end && it.end.dateTime) || sd);
      start = sd.slice(0, 10); end = ed.slice(0, 10) || start;
      time = sd.slice(11, 16); timeEnd = ed.slice(11, 16);
    }
    return { gcalId: it.id, title: it.summary || "(제목 없음)", memo: it.description || "",
             start, end, allDay, time, timeEnd, color: GCOLOR[it.colorId] || "" };
  }

  function fetchGcal(force) {
    const cfg = gcalCfg();
    if (!cfg.enabled || !cfg.apiKey || !cfg.calendarId) return Promise.resolve(false);
    if (typeof fetch === "undefined") return Promise.resolve(false);
    if (!force && (gcalLoading || Date.now() - gcalAt < 5 * 60000)) return Promise.resolve(false);
    gcalLoading = true;
    const tMin = addDays(todayISO(), -400) + "T00:00:00Z";
    const tMax = addDays(todayISO(), 500) + "T00:00:00Z";
    const u = "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(cfg.calendarId) +
      "/events?key=" + encodeURIComponent(cfg.apiKey) +
      "&singleEvents=true&orderBy=startTime&maxResults=2500" +
      "&timeMin=" + encodeURIComponent(tMin) + "&timeMax=" + encodeURIComponent(tMax);
    return fetch(u)
      .then(r => { if (!r.ok) throw new Error("gcal " + r.status); return r.json(); })
      .then(j => {
        gcalEvents = (j.items || []).map(mapGcalItem).filter(Boolean);
        gcalAt = Date.now(); gcalLoading = false;
        try { localStorage.setItem("semis2:gcalCache", JSON.stringify({ at: gcalAt, items: gcalEvents })); } catch (e) {}
        if (String(location.hash).indexOf("schedule") >= 0) SeMIS.renderView();
        return true;
      })
      .catch(() => { gcalLoading = false; return false; });
  }

  /* ─────── 뷰 상태 (uiState에 지속) ─────── */
  const VIEWS = [
    { id: "day",   label: "일" }, { id: "week",  label: "주" },
    { id: "2week", label: "2주" }, { id: "month", label: "월" },
    { id: "year",  label: "년" }
  ];
  const ui = () => { try { return JSON.parse(localStorage.getItem("semis2:ui")) || {}; } catch (e) { return {}; } };
  const setUi = (patch) => localStorage.setItem("semis2:ui", JSON.stringify(Object.assign(ui(), patch)));

  let view = VIEWS.some(v => v.id === ui().calView) ? ui().calView : "month";
  let anchor = todayISO();
  let fAssignee = ui().calAssignee || "";   // "" = 전체
  let fHideDone = !!ui().calHideDone;
  let dragCtx = null;

  function setView(v) { if (VIEWS.some(x => x.id === v)) { view = v; setUi({ calView: v }); } }
  function setAnchor(iso) { if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) anchor = iso; }
  function setFilter(assignee, hideDone) {
    if (assignee !== undefined && assignee !== null) fAssignee = assignee;
    if (hideDone !== undefined && hideDone !== null) fHideDone = !!hideDone;
    setUi({ calAssignee: fAssignee, calHideDone: fHideDone });
  }

  /* ─────── 이벤트 질의 ─────── */
  function filteredEvents() {
    return D().schedules.filter(e =>
      (!fAssignee || e.assignee === fAssignee) && (!fHideDone || !e.done));
  }
  function evCompare(a, b) {
    const am = (a.allDay || a.end !== a.start) ? 0 : 1;
    const bm = (b.allDay || b.end !== b.start) ? 0 : 1;
    if (am !== bm) return am - bm;
    const at = a.allDay ? "" : (a.time || "");
    const bt = b.allDay ? "" : (b.time || "");
    if (at !== bt) return at < bt ? -1 : 1;
    return String(a.title).localeCompare(String(b.title));
  }
  function gcalOnDay(iso) {
    if (!gcalCfg().enabled || fAssignee) return [];
    const own = new Set(D().schedules.map(e => e.gcalId).filter(Boolean));
    return gcalEvents.filter(e => !own.has(e.gcalId) && e.start <= iso && iso <= (e.end || e.start));
  }
  function eventsOnDay(iso) {
    const native = filteredEvents().filter(e => e.start <= iso && iso <= (e.end || e.start));
    return native.concat(gcalOnDay(iso)).sort(evCompare);
  }
  function assigneeList() {
    const used = Array.from(new Set(D().schedules.map(e => e.assignee).filter(Boolean)));
    const extra = used.filter(n => !memberOf(n)).sort();
    return TEAM.map(t => t.name).concat(extra);
  }

  /* ─────── 데이터 조작 (DnD·완료 토글에서 사용, 테스트 노출) ─────── */
  function moveEvent(id, newStart) {
    const e = D().schedules.find(x => x.id === id);
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(String(newStart))) return false;
    const dur = diffDays(e.start, e.end || e.start);
    e.start = newStart;
    e.end = addDays(newStart, dur);
    SeMIS.save(); SeMIS.renderView();
    return true;
  }
  function resizeEvent(id, newEnd) {
    const e = D().schedules.find(x => x.id === id);
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(String(newEnd))) return false;
    e.end = newEnd < e.start ? e.start : newEnd;
    SeMIS.save(); SeMIS.renderView();
    return true;
  }
  function toggleDone(id) {
    const e = D().schedules.find(x => x.id === id);
    if (!e) return false;
    e.done = !e.done;
    SeMIS.save(); SeMIS.renderView();
    return e.done;
  }

  /* ─────── 제목(기간 표시) ─────── */
  function rangeTitle() {
    const a = fromISO(anchor);
    if (view === "day")   return a.getFullYear() + "년 " + (a.getMonth() + 1) + "월 " + a.getDate() + "일 (" + dowName(anchor) + ")";
    if (view === "month") return a.getFullYear() + "년 " + (a.getMonth() + 1) + "월";
    if (view === "year")  return a.getFullYear() + "년";
    const s = startOfWeek(anchor);
    const e = addDays(s, view === "week" ? 6 : 13);
    const sd = fromISO(s), ed = fromISO(e);
    return sd.getFullYear() + "년 " + (sd.getMonth() + 1) + "월 " + sd.getDate() + "일 ~ " +
      (ed.getFullYear() !== sd.getFullYear() ? ed.getFullYear() + "년 " : "") +
      (ed.getMonth() + 1) + "월 " + ed.getDate() + "일";
  }
  function moveAnchor(dir) {
    const d = fromISO(anchor);
    if (view === "day") d.setDate(d.getDate() + dir);
    else if (view === "week") d.setDate(d.getDate() + dir * 7);
    else if (view === "2week") d.setDate(d.getDate() + dir * 14);
    else if (view === "month") { d.setDate(1); d.setMonth(d.getMonth() + dir); }
    else d.setFullYear(d.getFullYear() + dir);
    anchor = toISO(d);
  }

  /* ─────── 칩(이벤트 조각) 렌더 ─────── */
  function chipHTML(e, dayIso, canWrite, compact) {
    const isGcal = !e.id && e.gcalId;
    const cont = (e.start < dayIso ? "‹" : "");
    const cont2 = ((e.end || e.start) > dayIso ? "›" : "");
    const isLastDay = dayIso === (e.end || e.start);
    const timeTxt = (!e.allDay && e.time && e.start === dayIso)
      ? `<span class="chip-time">${esc(e.time)}</span>` : "";
    const icons = (e.vehicle ? "🚗" : "") + (e.room ? "🏢" : "");
    const remIco = (Array.isArray(e.reminders) && e.reminders.length) ? "⏰" : "";
    if (isGcal) {
      return `<div class="cal-chip ev-gcal" data-gcal="${esc(e.gcalId)}" title="Google 캘린더: ${esc(e.title)}">
        <span class="chip-g">G</span>${timeTxt}
        <span class="chip-title">${cont}${esc(e.title)}${cont2}</span></div>`;
    }
    return `<div class="cal-chip ev-${esc(e.color || "blue")}${e.done ? " done" : ""}"
        data-ev="${esc(e.id)}" data-from="${esc(dayIso)}" ${canWrite ? 'draggable="true"' : ""} title="${esc(e.title)}${e.assignee ? " · " + esc(e.assignee) : ""}${e.memo ? "\n" + esc(e.memo) : ""}">
      ${canWrite ? `<span class="chip-check" data-donetoggle="${esc(e.id)}" title="완료 표시">${e.done ? "✓" : "○"}</span>` : (e.done ? '<span class="chip-check">✓</span>' : "")}
      ${timeTxt}
      <span class="chip-title">${cont}${icons}${remIco}${esc(e.title)}${cont2}</span>
      ${e.assignee ? `<span class="chip-tag" title="${esc(e.assignee)}">${esc(tagOf(e.assignee))}</span>` : ""}
      ${canWrite && isLastDay && !compact ? `<span class="chip-resize" draggable="true" data-resize="${esc(e.id)}" title="드래그하여 기간 조정">⇥</span>` : ""}
    </div>`;
  }

  /* ─────── 그리드 뷰 (주 / 2주 / 월) ─────── */
  function gridHTML(days, monthRef, canWrite, maxChips) {
    const today = todayISO();
    let html = `<div class="cal-grid-head">${DOW.map((d, i) =>
      `<div class="${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</div>`).join("")}</div>`;
    html += `<div class="cal-grid rows-${Math.ceil(days.length / 7)}">`;
    days.forEach(iso => {
      const d = fromISO(iso);
      const other = monthRef && iso.slice(0, 7) !== monthRef;
      const evs = eventsOnDay(iso);
      const shown = evs.slice(0, maxChips);
      const over = evs.length - shown.length;
      html += `<div class="cal-cell${other ? " other" : ""}${iso === today ? " today" : ""}" data-day="${iso}">
        <div class="cal-daynum${d.getDay() === 0 ? " sun" : d.getDay() === 6 ? " sat" : ""}">${d.getDate() === 1 ? (d.getMonth() + 1) + "월 " : ""}${d.getDate()}</div>
        <div class="cal-chips">${shown.map(e => chipHTML(e, iso, canWrite, maxChips <= 4)).join("")}
        ${over > 0 ? `<button class="cal-more" data-more="${iso}">+${over}개 더보기</button>` : ""}</div>
      </div>`;
    });
    return html + "</div>";
  }

  function daysRange(startIso, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(addDays(startIso, i));
    return out;
  }

  /* ─────── 일(日) 뷰 ─────── */
  function dayHTML(canWrite) {
    const evs = eventsOnDay(anchor);
    const alldays = evs.filter(e => e.allDay);
    const timed = evs.filter(e => !e.allDay);
    const row = (e) => `
      <div class="cal-agenda-row">
        <div class="ag-time">${e.allDay ? "종일" : esc(e.time || "") + (e.timeEnd ? "~" + esc(e.timeEnd) : "")}</div>
        <div class="ag-chip">${chipHTML(e, anchor, canWrite && !!e.id, false)}
          ${e.vehicle ? '<span class="badge badge-amber">🚗 차량</span>' : ""}
          ${e.room ? '<span class="badge badge-blue">🏢 회의실</span>' : ""}
          ${e.assignee ? `<span class="badge badge-gray">${esc(tagOf(e.assignee))} ${esc(e.assignee)}</span>` : ""}
          ${e.memo ? `<div class="ag-memo">${esc(e.memo)}</div>` : ""}</div>
      </div>`;
    return `<div class="cal-dayview" data-day="${esc(anchor)}">
      ${alldays.length ? `<div class="cal-sec-label">종일 / 기간</div>` + alldays.map(row).join("") : ""}
      ${timed.length ? `<div class="cal-sec-label">시간 일정</div>` + timed.map(row).join("") : ""}
      ${!evs.length ? '<div class="empty">이 날짜에 일정이 없습니다.</div>' : ""}
    </div>`;
  }

  /* ─────── 년(年) 뷰 ─────── */
  function yearHTML() {
    const y = fromISO(anchor).getFullYear();
    const today = todayISO();
    let html = '<div class="cal-year">';
    for (let m = 0; m < 12; m++) {
      const first = y + "-" + p2(m + 1) + "-01";
      const gs = startOfWeek(first);
      html += `<div class="cal-mini"><button class="cal-mini-title" data-gomonth="${first}">${m + 1}월</button>
        <div class="cal-mini-grid">${DOW.map(d => `<span class="mini-dow">${d}</span>`).join("")}`;
      for (let i = 0; i < 42; i++) {
        const iso = addDays(gs, i);
        if (iso.slice(0, 7) !== first.slice(0, 7)) { html += "<span></span>"; continue; }
        const has = eventsOnDay(iso).length > 0;
        html += `<button class="mini-day${iso === today ? " today" : ""}${has ? " has-ev" : ""}" data-goday="${iso}">${fromISO(iso).getDate()}</button>`;
      }
      html += "</div></div>";
    }
    return html + "</div>";
  }

  /* ─────── 일정 등록/수정 폼 ─────── */
  function eventForm(id, presetDay) {
    const e = id ? D().schedules.find(x => x.id === id) : null;
    const start = e ? e.start : (presetDay || todayISO());
    const end = e ? (e.end || e.start) : start;
    const allDay = e ? !!e.allDay : true;
    const rems = e && Array.isArray(e.reminders) ? e.reminders : [];
    openModal(`
      <h3>${e ? "일정 수정" : "일정 등록"}</h3>
      <div class="form-row"><label>일정명</label>
        <input id="f-title" value="${esc(e ? e.title : "")}" maxlength="120" placeholder="예: OO지점 보안점검"></div>
      <div class="form-grid">
        <div class="form-row"><label>시작일</label><input type="date" id="f-start" value="${esc(start)}"></div>
        <div class="form-row"><label>종료일</label><input type="date" id="f-end" value="${esc(end)}"></div>
      </div>
      <div class="form-row" style="display:flex;gap:18px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-weight:600">
          <input type="checkbox" id="f-allday" style="width:auto" ${allDay ? "checked" : ""}> 종일 일정</label>
        <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-weight:600">
          <input type="checkbox" id="f-vehicle" style="width:auto" ${e && e.vehicle ? "checked" : ""}> 🚗 차량 예약</label>
        <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-weight:600">
          <input type="checkbox" id="f-room" style="width:auto" ${e && e.room ? "checked" : ""}> 🏢 회의실 예약</label>
      </div>
      <div class="form-grid" id="row-time" ${allDay ? 'style="display:none"' : ""}>
        <div class="form-row"><label>시작 시간</label><input type="time" id="f-time" value="${esc(e && e.time ? e.time : "09:00")}"></div>
        <div class="form-row"><label>종료 시간 (선택)</label><input type="time" id="f-timeend" value="${esc(e ? e.timeEnd || "" : "")}"></div>
      </div>
      <div class="form-row"><label>리마인더 (알림)</label>
        <div class="rem-picker">${REMINDER_DEFS.map(r =>
          `<label class="rem-opt"><input type="checkbox" data-rem="${r.id}" style="width:auto" ${rems.includes(r.id) ? "checked" : ""}> ${r.label}</label>`).join("")}</div>
        <div class="form-hint">접속 중인 브라우저에서 알림(토스트/시스템 알림)으로 안내됩니다. 종일 일정은 당일 09:00 기준.</div></div>
      <div class="form-row"><label>색상</label>
        <div class="color-picker" id="f-colors">${COLORS.map(c =>
          `<button type="button" class="color-swatch ev-${c.id}${(e ? e.color : "blue") === c.id ? " sel" : ""}" data-color="${c.id}" title="${c.label}"></button>`).join("")}</div></div>
      <div class="form-row"><label>담당자 (카테고리)</label>
        <div class="team-picker">${TEAM.map(t =>
          `<button type="button" class="cal-fchip team-btn" data-team="${esc(t.name)}">${t.emoji} ${esc(t.name)}</button>`).join("")}</div>
        <input id="f-assignee" value="${esc(e ? e.assignee || "" : "")}" maxlength="20" list="assignee-list" placeholder="위 버튼 선택 또는 직접 입력">
        <datalist id="assignee-list">${assigneeList().map(a => `<option value="${esc(a)}">`).join("")}</datalist></div>
      <div class="form-row"><label>메모</label><textarea id="f-memo" rows="3" maxlength="500">${esc(e ? e.memo || "" : "")}</textarea></div>
      <div class="form-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="f-done" style="width:auto" ${e && e.done ? "checked" : ""}> 완료된 일정</label></div>
      <div class="modal-actions">
        ${e ? '<button class="btn btn-danger" id="f-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">저장</button>
      </div>`);

    let color = e ? (e.color || "blue") : "blue";
    $$("#f-colors .color-swatch").forEach(b => b.onclick = () => {
      color = b.dataset.color;
      $$("#f-colors .color-swatch").forEach(x => x.classList.toggle("sel", x === b));
    });
    $$(".team-btn").forEach(b => b.onclick = () => { $("#f-assignee").value = b.dataset.team; });
    $("#f-allday").onchange = () => {
      $("#row-time").style.display = $("#f-allday").checked ? "none" : "";
    };
    $("#f-cancel").onclick = closeModal;
    if (e) $("#f-del").onclick = () =>
      confirmModal("이 일정을 삭제하시겠습니까?", () => {
        D().schedules = D().schedules.filter(x => x.id !== e.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    $("#f-save").onclick = () => {
      const title = $("#f-title").value.trim();
      let s = $("#f-start").value, en = $("#f-end").value || s;
      if (!title) { toast("일정명을 입력하세요.", true); return; }
      if (!s) { toast("시작일을 입력하세요.", true); return; }
      if (en < s) { const t = s; s = en; en = t; } // 자동 교정
      const allday = $("#f-allday").checked;
      const reminders = $$("#modal-box [data-rem]").filter(x => x.checked).map(x => x.dataset.rem);
      const rec = {
        title, memo: $("#f-memo").value.trim(),
        start: s, end: en, allDay: allday,
        time: allday ? "" : ($("#f-time").value || "09:00"),
        timeEnd: allday ? "" : ($("#f-timeend").value || ""),
        color, done: $("#f-done").checked,
        assignee: $("#f-assignee").value.trim(),
        vehicle: $("#f-vehicle").checked,
        room: $("#f-room").checked,
        reminders
      };
      if (e) Object.assign(e, rec);
      else D().schedules.push(Object.assign({ id: uid("s") }, rec));
      // 리마인더 사용 시 브라우저 알림 권한 요청 (1회)
      try {
        if (reminders.length && typeof Notification !== "undefined" && Notification.permission === "default")
          Notification.requestPermission();
      } catch (err) {}
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ─────── 일정 상세 (읽기 전용) ─────── */
  function eventDetail(id) {
    const e = D().schedules.find(x => x.id === id);
    if (!e) return;
    const remTxt = (e.reminders || []).map(r => (REMINDER_DEFS.find(d => d.id === r) || {}).label).filter(Boolean).join(", ");
    openModal(`
      <h3><span class="cal-dot ev-${esc(e.color || "blue")}"></span> ${esc(e.title)} ${e.done ? '<span class="badge badge-green">완료</span>' : ""}</h3>
      <table class="tbl" style="font-size:.88rem">
        <tr><td style="width:90px;color:var(--text-2)">기간</td><td>${esc(e.start)}${e.end && e.end !== e.start ? " ~ " + esc(e.end) : ""}</td></tr>
        <tr><td style="color:var(--text-2)">시간</td><td>${e.allDay ? "종일" : esc(e.time || "") + (e.timeEnd ? " ~ " + esc(e.timeEnd) : "")}</td></tr>
        ${e.vehicle || e.room ? `<tr><td style="color:var(--text-2)">예약</td><td>${e.vehicle ? "🚗 차량 " : ""}${e.room ? "🏢 회의실" : ""}</td></tr>` : ""}
        ${remTxt ? `<tr><td style="color:var(--text-2)">리마인더</td><td>⏰ ${esc(remTxt)}</td></tr>` : ""}
        ${e.assignee ? `<tr><td style="color:var(--text-2)">담당자</td><td>${esc(tagOf(e.assignee))} ${esc(e.assignee)}</td></tr>` : ""}
        ${e.memo ? `<tr><td style="color:var(--text-2)">메모</td><td style="white-space:pre-wrap">${esc(e.memo)}</td></tr>` : ""}
      </table>
      <div class="modal-actions"><button class="btn btn-ghost" id="f-close">닫기</button></div>`);
    $("#f-close").onclick = closeModal;
  }

  function gcalDetail(gid) {
    const e = gcalEvents.find(x => x.gcalId === gid);
    if (!e) return;
    openModal(`
      <h3><span class="chip-g" style="position:static">G</span> ${esc(e.title)} <span class="badge badge-blue">Google 캘린더</span></h3>
      <table class="tbl" style="font-size:.88rem">
        <tr><td style="width:90px;color:var(--text-2)">기간</td><td>${esc(e.start)}${e.end !== e.start ? " ~ " + esc(e.end) : ""}</td></tr>
        <tr><td style="color:var(--text-2)">시간</td><td>${e.allDay ? "종일" : esc(e.time || "") + (e.timeEnd ? " ~ " + esc(e.timeEnd) : "")}</td></tr>
        ${e.memo ? `<tr><td style="color:var(--text-2)">설명</td><td style="white-space:pre-wrap">${esc(e.memo)}</td></tr>` : ""}
      </table>
      <p class="form-hint" style="margin-top:8px">Google 캘린더에서 관리되는 일정입니다. 수정은 Google 캘린더에서 해주세요.</p>
      <div class="modal-actions"><button class="btn btn-ghost" id="f-close">닫기</button></div>`);
    $("#f-close").onclick = closeModal;
  }

  /* ─────── 구글 연동 설정 모달 ─────── */
  function gcalForm() {
    const cfg = gcalCfg();
    openModal(`
      <h3>🔗 구글캘린더 연동</h3>
      <div class="form-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="g-enabled" style="width:auto" ${cfg.enabled ? "checked" : ""}>
        Google → SeMIS 일정 표시 사용</label></div>
      <div class="form-row"><label>구글 캘린더 ID</label>
        <input id="g-calid" value="${esc(cfg.calendarId || "airzetaavsec@gmail.com")}" placeholder="airzetaavsec@gmail.com"></div>
      <div class="form-row"><label>Google API 키</label>
        <input type="password" id="g-apikey" value="${esc(cfg.apiKey || "")}" placeholder="AIza...">
        <div class="form-hint">발급: console.cloud.google.com → API 및 서비스 → 사용자 인증 정보 → API 키 만들기
        → Google Calendar API 사용 설정. 캘린더가 <b>공개</b> 상태여야 조회됩니다.</div></div>
      <div class="form-row"><label>SeMIS → Google (구독 주소)</label>
        <div style="display:flex;gap:6px">
          <input id="g-ics" value="${esc(ICS_URL)}" readonly style="font-size:.78rem">
          <button type="button" class="btn btn-ghost btn-sm" id="g-copy">복사</button></div>
        <div class="form-hint">Google 캘린더 → 설정 → 캘린더 추가 → <b>URL로 추가</b>에 붙여넣으면
        SeMIS 일정이 구글캘린더에 표시됩니다. (갱신 주기는 Google이 결정, 수 시간 간격)</div></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="g-cancel">취소</button>
        <button class="btn btn-primary" id="g-save">저장</button>
      </div>`);
    $("#g-copy").onclick = () => {
      const inp = $("#g-ics");
      inp.select();
      try { document.execCommand("copy"); toast("복사되었습니다."); } catch (e) {
        try { navigator.clipboard.writeText(inp.value); toast("복사되었습니다."); } catch (e2) { toast("수동으로 복사해주세요.", true); }
      }
    };
    $("#g-cancel").onclick = closeModal;
    $("#g-save").onclick = () => {
      D().gcal = {
        enabled: $("#g-enabled").checked,
        calendarId: $("#g-calid").value.trim() || "airzetaavsec@gmail.com",
        apiKey: $("#g-apikey").value.trim()
      };
      SeMIS.save(); closeModal();
      gcalAt = 0;
      fetchGcal(true);
      SeMIS.renderView();
      toast("저장되었습니다.");
    };
  }

  /* ─────── 모듈 렌더 ─────── */
  SeMIS.registerModule("schedule", {
    title: "일정관리",
    render(root) {
      const canWrite = SeMIS.roleRank() >= 2;
      const assignees = assigneeList();
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">📅 항공보안 일정관리</div>
          <span class="spacer"></span>
          ${canWrite ? '<button class="btn btn-ghost" id="cal-gcal" title="구글캘린더 연동 설정">🔗</button>' : ""}
          ${canWrite ? '<button class="btn btn-primary" id="cal-add">+ 일정 등록</button>' : ""}
          <div class="page-desc">보안점검 · 교육 · 회의 등 항공보안파트 주요 일정${canWrite ? " — 일정을 드래그하여 이동, ⇥ 핸들 드래그로 기간 조정" : ""}</div>
        </div>
        <div class="card cal-card">
          <div class="cal-toolbar">
            <button class="btn btn-ghost btn-sm" id="cal-today">오늘</button>
            <button class="btn btn-ghost btn-sm" id="cal-prev" aria-label="이전">◀</button>
            <button class="btn btn-ghost btn-sm" id="cal-next" aria-label="다음">▶</button>
            <div class="cal-title" id="cal-title">${esc(rangeTitle())}</div>
            <span class="spacer"></span>
            <div class="cal-views">${VIEWS.map(v =>
              `<button class="cal-viewbtn${view === v.id ? " active" : ""}" data-view="${v.id}">${v.label}</button>`).join("")}</div>
          </div>
          <div class="cal-filters">
            <span class="cal-filter-label">담당자:</span>
            <button class="cal-fchip${!fAssignee ? " active" : ""}" data-assignee="">전체</button>
            ${assignees.map(a => {
              const m = memberOf(a);
              return `<button class="cal-fchip${fAssignee === a ? " active" : ""}" data-assignee="${esc(a)}">${m ? m.emoji + " " : ""}${esc(a)}</button>`;
            }).join("")}
            <span class="spacer"></span>
            <button class="cal-fchip${fHideDone ? " active" : ""}" id="cal-hidedone">완료 숨기기</button>
          </div>
          <div id="cal-body"></div>
        </div>`;

      // 본문
      const body = $("#cal-body");
      if (view === "day") body.innerHTML = dayHTML(canWrite);
      else if (view === "week") body.innerHTML = gridHTML(daysRange(startOfWeek(anchor), 7), null, canWrite, 8);
      else if (view === "2week") body.innerHTML = gridHTML(daysRange(startOfWeek(anchor), 14), null, canWrite, 5);
      else if (view === "year") body.innerHTML = yearHTML();
      else {
        const first = anchor.slice(0, 8) + "01";
        body.innerHTML = gridHTML(daysRange(startOfWeek(first), 42), anchor.slice(0, 7), canWrite, 4);
      }

      /* ── 툴바 ── */
      $("#cal-today").onclick = () => { anchor = todayISO(); SeMIS.renderView(); };
      $("#cal-prev").onclick = () => { moveAnchor(-1); SeMIS.renderView(); };
      $("#cal-next").onclick = () => { moveAnchor(1); SeMIS.renderView(); };
      $$(".cal-viewbtn").forEach(b => b.onclick = () => { setView(b.dataset.view); SeMIS.renderView(); });
      if (canWrite) {
        $("#cal-add").onclick = () => eventForm(null, view === "day" ? anchor : todayISO());
        $("#cal-gcal").onclick = gcalForm;
      }

      /* ── 필터 ── */
      $$(".cal-fchip[data-assignee]").forEach(b => b.onclick = () => {
        setFilter(b.dataset.assignee, undefined); SeMIS.renderView();
      });
      $("#cal-hidedone").onclick = () => { setFilter(undefined, !fHideDone); SeMIS.renderView(); };

      /* ── 칩 클릭(수정/상세) · 완료 토글 · 더보기 · 년뷰 이동 ── */
      $$("[data-donetoggle]", body).forEach(el => el.onclick = (ev) => {
        ev.stopPropagation(); toggleDone(el.dataset.donetoggle);
      });
      $$(".cal-chip[data-ev]", body).forEach(el => el.onclick = (ev) => {
        if (ev.target.closest("[data-donetoggle],[data-resize]")) return;
        canWrite ? eventForm(el.dataset.ev) : eventDetail(el.dataset.ev);
      });
      $$(".cal-chip[data-gcal]", body).forEach(el => el.onclick = () => gcalDetail(el.dataset.gcal));
      $$("[data-more]", body).forEach(el => el.onclick = () => {
        setAnchor(el.dataset.more); setView("day"); SeMIS.renderView();
      });
      $$("[data-gomonth]", body).forEach(el => el.onclick = () => {
        setAnchor(el.dataset.gomonth); setView("month"); SeMIS.renderView();
      });
      $$("[data-goday]", body).forEach(el => el.onclick = () => {
        setAnchor(el.dataset.goday); setView("day"); SeMIS.renderView();
      });

      /* ── 빈 칸 클릭 → 해당 일자 신규 등록 ── */
      if (canWrite) $$(".cal-cell", body).forEach(cell => cell.onclick = (ev) => {
        if (ev.target.closest(".cal-chip,.cal-more")) return;
        eventForm(null, cell.dataset.day);
      });

      /* ── 드래그앤드롭 (이동 / 기간 조정) ── */
      if (canWrite) {
        $$(".cal-chip[draggable]", body).forEach(el => {
          el.addEventListener("dragstart", (ev) => {
            dragCtx = { id: el.dataset.ev, from: el.dataset.from, mode: "move" };
            el.classList.add("dragging");
            if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = "move"; try { ev.dataTransfer.setData("text/plain", el.dataset.ev); } catch (e) {} }
          });
          el.addEventListener("dragend", () => { el.classList.remove("dragging"); dragCtx = null; });
        });
        $$("[data-resize]", body).forEach(h => {
          h.addEventListener("dragstart", (ev) => {
            ev.stopPropagation();
            dragCtx = { id: h.dataset.resize, mode: "resize" };
            if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = "move"; try { ev.dataTransfer.setData("text/plain", h.dataset.resize); } catch (e) {} }
          });
          h.addEventListener("dragend", () => { dragCtx = null; });
        });
        $$(".cal-cell", body).forEach(cell => {
          cell.addEventListener("dragover", (ev) => { ev.preventDefault(); cell.classList.add("drop-hover"); });
          cell.addEventListener("dragleave", () => cell.classList.remove("drop-hover"));
          cell.addEventListener("drop", (ev) => {
            ev.preventDefault();
            cell.classList.remove("drop-hover");
            if (!dragCtx) return;
            const day = cell.dataset.day;
            if (dragCtx.mode === "resize") { resizeEvent(dragCtx.id, day); toast("기간이 조정되었습니다."); }
            else {
              const e = D().schedules.find(x => x.id === dragCtx.id);
              if (e) { moveEvent(dragCtx.id, addDays(e.start, diffDays(dragCtx.from, day))); toast("일정이 이동되었습니다."); }
            }
            dragCtx = null;
          });
        });
      }

      /* ── 구글캘린더 새로고침 (백그라운드) ── */
      fetchGcal(false);
    }
  });

  /* ─────── 테스트/외부 노출 API ─────── */
  window.SemisCalendar = {
    setView, getView: () => view,
    setAnchor, getAnchor: () => anchor,
    setFilter, getFilter: () => ({ assignee: fAssignee, hideDone: fHideDone }),
    moveEvent, resizeEvent, toggleDone,
    eventsOnDay, filteredEvents, assigneeList,
    addDays, diffDays, startOfWeek, rangeTitle,
    COLORS, VIEWS, TEAM, tagOf,
    REMINDER_DEFS, eventStartMs, dueReminders, checkReminders, startReminders, stopReminders,
    mapGcalItem, fetchGcal, ICS_URL,
    _setGcalEvents(list) { gcalEvents = list || []; } // 테스트용
  };
})();
