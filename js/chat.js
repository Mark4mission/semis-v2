/* ═══════════════════════════════════════════════════════
   SeMIS v2.35 — 세미(Semi) · 팀 채팅 위젯 (js/chat.js)
   우하단 플로팅 버튼 → 패널(탭 2개)
   - 🤖 세미: Edge Function "semi-chat"(Claude) — 사이트 데이터 조회·요약·안내
   - 💬 팀 채팅: chat_messages 테이블 + Supabase Realtime(폴백 폴링)
   내부 계정(admin/hq/manager/user) 전용 — vendor/signer 미노출.
   라우트 모듈이 아닌 전역 오버레이 — app.js enterApp()에서 onLogin() 호출.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const SUPA_URL = "https://mzyuzrxkdcpzxojenwat.supabase.co";
  const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eXV6cnhrZGNwenhvamVud2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTQ1MTYsImV4cCI6MjA5OTY5MDUxNn0.YqcCnEY8Bn-Bc2cbUHWl4m9GLMIifZbH5KqrbamU0YI";
  const CHAT_REST = SUPA_URL + "/rest/v1/chat_messages";
  const EDGE_URL = SUPA_URL + "/functions/v1/semi-chat";
  const EDGE_TOKEN = "azs-semi-9f2c47b1e6d3";
  const HEADERS = { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY, "Content-Type": "application/json" };

  const LS_TAB = "semis2:chatTab";           // 마지막 사용 탭
  const LS_READ = "semis2:chatRead:";        // + uid → 마지막 읽은 created_at
  const SS_CONV = "semis2:semiConv:";        // + uid → 세미 대화 이력(세션)
  const MAX_LOAD = 100;                       // 팀 채팅 로드 건수
  const MAX_CONV = 20;                        // 세미 대화 이력 상한(요청 전송분)
  const POLL_MS = 25000;

  const S = () => window.SeMIS;
  const $id = (id) => document.getElementById(id);

  let built = false;          // DOM 생성 여부
  let open = false;
  let tab = "semi";           // "semi" | "team"
  let teamMsgs = [];          // [{id, created_at, author, author_id, role, text}]
  let semiBusy = false;
  let rtClient = null, rtOn = false, pollTimer = null;

  /* ─── 접근 대상: 내부 계정만 ─── */
  function canUse(u) {
    return !!(u && ["admin", "hq", "manager", "user"].indexOf(u.role) >= 0);
  }
  const me = () => (S() && S().user) || null;
  const uid = () => (me() && me().id) || "_anon";

  /* ─── 유틸 ─── */
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  /* 세미 답변용 초경량 마크다운: 굵게·코드·불릿·줄바꿈만 (HTML은 전부 이스케이프) */
  function mdLite(s) {
    const lines = esc(s).split("\n").map((ln) => {
      const m = ln.match(/^\s*[-•]\s+(.*)$/);
      return m ? '<span class="chat-li">• ' + m[1] + "</span>" : ln;
    });
    return lines.join("<br>")
      .replace(/<\/span><br>/g, "</span>")          // 불릿(블록) 뒤 <br> 중복 여백 제거
      .replace(/<br>(<span class="chat-li">)/g, "$1") // 불릿 앞 <br>도 제거 (display:block)
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }
  function hhmm(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function dayOf(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  const ROLE_BADGE = { admin: "관리자", hq: "HQ", manager: "보안관리자", user: "" };

  /* ─── 읽음/안읽음 ─── */
  function readAt() { try { return localStorage.getItem(LS_READ + uid()) || ""; } catch (e) { return ""; } }
  function setReadNow() {
    if (!teamMsgs.length) return;
    const latest = teamMsgs[teamMsgs.length - 1].created_at || "";
    try { localStorage.setItem(LS_READ + uid(), latest); } catch (e) {}
    paintBadge();
  }
  /* 순수 계산(테스트 노출): 내 글 제외, readAt 이후 메시지 수 */
  function unreadCount(list, read, myId) {
    return (list || []).filter((m) => m && m.author_id !== myId &&
      (!read || String(m.created_at || "") > read)).length;
  }
  function paintBadge() {
    const n = unreadCount(teamMsgs, readAt(), uid());
    const show = n > 0 && !(open && tab === "team");
    [["chat-badge", show], ["chat-tab-badge", n > 0 && tab !== "team"]].forEach(([id, vis]) => {
      const el = $id(id);
      if (!el) return;
      el.textContent = n > 9 ? "9+" : String(n);
      el.classList.toggle("hidden", !vis);
    });
  }

  /* ─── 세미 대화 이력 (세션 저장) ─── */
  function convLoad() {
    try { return JSON.parse(sessionStorage.getItem(SS_CONV + uid())) || []; } catch (e) { return []; }
  }
  function convSave(conv) {
    try { sessionStorage.setItem(SS_CONV + uid(), JSON.stringify(conv.slice(-MAX_CONV))); } catch (e) {}
  }

  /* ─── DOM 구축 ─── */
  const CHAT_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  function build() {
    destroy();
    const root = document.createElement("div");
    root.id = "chat-root";
    root.className = "chat-root";
    root.innerHTML =
      '<div id="chat-panel" class="chat-panel hidden" role="dialog" aria-label="세미 · 팀 채팅">' +
        '<div class="chat-head">' +
          '<div class="chat-tabs">' +
            '<button type="button" class="chat-tab" data-tab="semi"><span class="chat-semi-face">🤖</span> 세미</button>' +
            '<button type="button" class="chat-tab" data-tab="team">💬 팀 채팅' +
              '<span id="chat-tab-badge" class="chat-badge hidden"></span></button>' +
          '</div>' +
          '<button type="button" id="semi-reset" class="chat-x" title="세미와 새 대화 시작">↺</button>' +
          '<button type="button" id="chat-close" class="chat-x" aria-label="닫기">✕</button>' +
        '</div>' +
        '<div id="chat-body-semi" class="chat-body">' +
          '<div id="semi-msgs" class="chat-msgs"></div>' +
          '<form id="semi-form" class="chat-form">' +
            '<input id="semi-input" type="text" placeholder="세미에게 물어보세요…" autocomplete="off" maxlength="2000">' +
            '<button type="submit" class="chat-send" aria-label="전송">➤</button>' +
          '</form>' +
        '</div>' +
        '<div id="chat-body-team" class="chat-body hidden">' +
          '<div id="team-msgs" class="chat-msgs"></div>' +
          '<form id="team-form" class="chat-form">' +
            '<input id="team-input" type="text" placeholder="팀에게 메시지 남기기…" autocomplete="off" maxlength="2000">' +
            '<button type="submit" class="chat-send" aria-label="전송">➤</button>' +
          '</form>' +
        '</div>' +
      '</div>' +
      '<button type="button" id="chat-fab" class="chat-fab" aria-label="세미 · 팀 채팅 열기" title="세미 · 팀 채팅">' +
        CHAT_SVG + '<span id="chat-badge" class="chat-badge hidden"></span>' +
      '</button>';
    document.body.appendChild(root);
    built = true;

    $id("chat-fab").onclick = toggle;
    $id("chat-close").onclick = close;
    $id("semi-reset").onclick = resetSemi;
    Array.from(root.querySelectorAll(".chat-tab")).forEach((b) => {
      b.onclick = () => setTab(b.dataset.tab);
    });
    $id("semi-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $id("semi-input").value.trim();
      if (v) { $id("semi-input").value = ""; askSemi(v); }
    });
    $id("team-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $id("team-input").value.trim();
      if (v) { $id("team-input").value = ""; sendTeam(v); }
    });
    // window 캡처 단계 — app.js(모달 닫기)·calendar(전체화면 해제)보다 먼저 실행되어
    // "모달 열림 → 모달 우선 / 아니면 패널만 닫고 전파 중단" 순서를 보장
    window.addEventListener("keydown", onEsc, true);

    try { tab = localStorage.getItem(LS_TAB) === "team" ? "team" : "semi"; } catch (e) { tab = "semi"; }
    applyTab();
    renderSemi();
    renderTeam();
    paintBadge();
  }
  function destroy() {
    const old = $id("chat-root");
    if (old) old.remove();
    window.removeEventListener("keydown", onEsc, true);
    stopPoll();
    try { if (rtClient) rtClient.removeAllChannels(); } catch (e) {}
    rtClient = null; rtOn = false;
    built = false; open = false;
  }
  function onEsc(e) {
    if (e.key !== "Escape" || !open) return;
    const mo = $id("modal-overlay");
    if (mo && !mo.classList.contains("hidden")) return; // 모달이 열려 있으면 모달 우선
    close();
    e.stopPropagation(); // 패널만 닫고 캘린더 전체화면 해제 등 후속 핸들러 중단
  }

  /* ─── 열기/닫기/탭 ─── */
  function toggle() { open ? close() : openPanel(); }
  function openPanel() {
    if (!built) return;
    open = true;
    $id("chat-panel").classList.remove("hidden");
    $id("chat-fab").classList.add("chat-fab-open");
    if (tab === "team") { setReadNow(); scrollBottom("team-msgs"); }
    else scrollBottom("semi-msgs");
    loadTeam(); // 열 때마다 최신화 (Realtime 미작동 대비)
    const inp = $id(tab === "team" ? "team-input" : "semi-input");
    if (inp) setTimeout(() => inp.focus(), 60);
  }
  function close() {
    if (!built) return;
    open = false;
    $id("chat-panel").classList.add("hidden");
    $id("chat-fab").classList.remove("chat-fab-open");
    paintBadge();
  }
  function setTab(t) {
    tab = t === "team" ? "team" : "semi";
    try { localStorage.setItem(LS_TAB, tab); } catch (e) {}
    applyTab();
    if (tab === "team") { setReadNow(); scrollBottom("team-msgs"); }
    else scrollBottom("semi-msgs");
    const inp = $id(tab === "team" ? "team-input" : "semi-input");
    if (inp && open) inp.focus();
  }
  function applyTab() {
    const root = $id("chat-root");
    if (!root) return;
    Array.from(root.querySelectorAll(".chat-tab")).forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === tab));
    $id("chat-body-semi").classList.toggle("hidden", tab !== "semi");
    $id("chat-body-team").classList.toggle("hidden", tab !== "team");
    $id("semi-reset").classList.toggle("hidden", tab !== "semi");
    paintBadge();
  }
  function scrollBottom(id) {
    const el = $id(id);
    if (el) setTimeout(() => { el.scrollTop = el.scrollHeight; }, 30);
  }

  /* ═══════════ 팀 채팅 ═══════════ */
  async function loadTeam() {
    if (typeof fetch === "undefined") return;
    try {
      const res = await fetch(CHAT_REST + "?select=*&order=created_at.desc&limit=" + MAX_LOAD, { headers: HEADERS });
      if (!res.ok) throw new Error("GET " + res.status);
      const rows = await res.json();
      if (Array.isArray(rows)) {
        teamMsgs = rows.reverse();
        renderTeam();
        if (open && tab === "team") setReadNow();
        paintBadge();
      }
    } catch (e) { /* 오프라인 — 기존 표시 유지 */ }
  }
  async function sendTeam(text) {
    const u = me();
    if (!u) return;
    if (typeof fetch === "undefined") { toastSafe("오프라인 상태라 메시지를 보낼 수 없어요.", true); return; }
    const body = { author: u.name, author_id: u.id, role: u.role, text: String(text).slice(0, 2000) };
    try {
      const res = await fetch(CHAT_REST, {
        method: "POST",
        headers: Object.assign({}, HEADERS, { Prefer: "return=representation" }),
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error("POST " + res.status);
      const rows = await res.json().catch(() => null);
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row && row.id) addIncoming(row);
    } catch (e) {
      toastSafe("전송에 실패했어요. 연결 상태를 확인해 주세요.", true);
    }
  }
  async function deleteTeam(id) {
    if (typeof fetch === "undefined") return;
    try {
      const res = await fetch(CHAT_REST + "?id=eq." + encodeURIComponent(id), { method: "DELETE", headers: HEADERS });
      if (!res.ok) throw new Error("DEL " + res.status);
      removeMsg(id);
    } catch (e) { toastSafe("삭제에 실패했어요.", true); }
  }
  function addIncoming(row) {
    if (!row || !row.id || teamMsgs.some((m) => m && m.id === row.id)) return;
    teamMsgs.push(row);
    teamMsgs.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (teamMsgs.length > MAX_LOAD * 2) teamMsgs = teamMsgs.slice(-MAX_LOAD);
    renderTeam();
    if (open && tab === "team") { setReadNow(); scrollBottom("team-msgs"); }
    paintBadge();
  }
  function removeMsg(id) {
    const before = teamMsgs.length;
    teamMsgs = teamMsgs.filter((m) => m && m.id !== id);
    if (teamMsgs.length !== before) { renderTeam(); paintBadge(); }
  }
  function renderTeam() {
    const box = $id("team-msgs");
    if (!box) return;
    const myId = uid();
    const isAdmin = !!(me() && me().role === "admin");
    if (!teamMsgs.length) {
      box.innerHTML = '<div class="chat-empty">아직 메시지가 없어요.<br>팀에 첫 메시지를 남겨보세요! ✍️</div>';
      return;
    }
    let html = "", lastDay = "";
    teamMsgs.forEach((m) => {
      if (!m) return;
      const day = dayOf(m.created_at);
      if (day && day !== lastDay) {
        lastDay = day;
        html += '<div class="chat-day"><span>' + esc(day) + "</span></div>";
      }
      const mine = m.author_id === myId;
      const badge = ROLE_BADGE[m.role] || "";
      const del = (mine || isAdmin)
        ? '<button type="button" class="chat-del" data-del="' + esc(m.id) + '" title="삭제">✕</button>' : "";
      html += '<div class="chat-row' + (mine ? " mine" : "") + '">' +
        (mine ? "" : '<div class="chat-who">' + esc(m.author) +
          (badge ? ' <span class="chat-role">' + esc(badge) + "</span>" : "") + "</div>") +
        '<div class="chat-line">' + del +
          '<div class="chat-bubble">' + esc(m.text).replace(/\n/g, "<br>") + "</div>" +
          '<span class="chat-time">' + esc(hhmm(m.created_at)) + "</span>" +
        "</div></div>";
    });
    box.innerHTML = html;
    Array.from(box.querySelectorAll("[data-del]")).forEach((b) => {
      b.onclick = () => {
        const id = b.getAttribute("data-del");
        if (S() && S().confirmModal) S().confirmModal("이 메시지를 삭제할까요?", () => deleteTeam(id));
        else deleteTeam(id);
      };
    });
    scrollBottom("team-msgs");
  }

  /* ─── Realtime 구독 (실패 시 폴링 폴백) ─── */
  function subscribe() {
    if (rtOn) return;
    if (typeof window === "undefined" || !window.supabase || !window.supabase.createClient) { startPoll(); return; }
    try {
      rtClient = window.supabase.createClient(SUPA_URL, SUPA_KEY);
      rtClient.channel("semis-chat")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" },
          (p) => { if (p && p.new) addIncoming(p.new); })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" },
          (p) => { const id = p && p.old && p.old.id; if (id) removeMsg(id); })
        .subscribe((st) => {
          if (st === "SUBSCRIBED") { rtOn = true; stopPoll(); }
          else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") { rtOn = false; startPoll(); }
        });
    } catch (e) { startPoll(); }
  }
  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(loadTeam, POLL_MS);
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ═══════════ 세미 (AI 도우미) ═══════════ */
  function suggestions() {
    const rank = (S() && S().roleRank && S().roleRank()) || 1;
    const list = ["최근 공지사항 요약해줘", "현재 보안등급 알려줘"];
    if (rank >= 2) list.unshift("이번 주 팀 일정 알려줘");
    if (rank >= 2) list.push("보안장비 현황 어때?");
    if (rank >= 3) list.push("KPI 진행 상황 요약해줘");
    return list.slice(0, 4);
  }
  function renderSemi() {
    const box = $id("semi-msgs");
    if (!box) return;
    const conv = convLoad();
    const u = me();
    let html = '<div class="chat-row semi"><div class="chat-who"><span class="chat-semi-face">🤖</span> 세미</div>' +
      '<div class="chat-line"><div class="chat-bubble semi-bubble">' +
      "안녕하세요" + (u ? ", <b>" + esc(u.name) + "</b>님" : "") + "! 저는 SeMIS 도우미 <b>세미</b>예요 🙌<br>" +
      "일정·점검·장비·규정 같은 사이트 자료를 찾아드리고, 사용법도 안내해 드려요. 편하게 물어보세요!" +
      "</div></div></div>";
    conv.forEach((m) => {
      if (!m || !m.content) return;
      if (m.role === "user") {
        html += '<div class="chat-row mine"><div class="chat-line">' +
          '<div class="chat-bubble">' + esc(m.content).replace(/\n/g, "<br>") + "</div></div></div>";
      } else {
        html += '<div class="chat-row semi"><div class="chat-who"><span class="chat-semi-face">🤖</span> 세미</div>' +
          '<div class="chat-line"><div class="chat-bubble semi-bubble">' + mdLite(m.content) + "</div></div></div>";
      }
    });
    if (!conv.length) {
      html += '<div class="chat-sugg">' + suggestions().map((s) =>
        '<button type="button" class="chat-chip" data-sugg="' + esc(s) + '">' + esc(s) + "</button>").join("") + "</div>";
    }
    if (semiBusy) {
      html += '<div class="chat-row semi"><div class="chat-who"><span class="chat-semi-face">🤖</span> 세미</div>' +
        '<div class="chat-line"><div class="chat-bubble semi-bubble chat-typing">생각하는 중<span class="d1">.</span><span class="d2">.</span><span class="d3">.</span></div></div></div>';
    }
    box.innerHTML = html;
    Array.from(box.querySelectorAll("[data-sugg]")).forEach((b) => {
      b.onclick = () => askSemi(b.getAttribute("data-sugg"));
    });
    scrollBottom("semi-msgs");
  }
  async function askSemi(text) {
    if (semiBusy) return;
    const u = me();
    if (!u) return;
    const conv = convLoad();
    conv.push({ role: "user", content: String(text).slice(0, 2000) });
    convSave(conv);
    semiBusy = true;
    const si = $id("semi-input");
    if (si) si.disabled = true;
    renderSemi();
    let reply = "";
    try {
      if (typeof fetch === "undefined") throw new Error("offline");
      const res = await fetch(EDGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          t: EDGE_TOKEN,
          user: { name: u.name, role: u.role },
          messages: convLoad().slice(-MAX_CONV)
        })
      });
      const data = await res.json().catch(() => ({}));
      reply = (data && data.reply) ||
        "응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.";
    } catch (e) {
      reply = "연결이 어려워요 😢 네트워크 상태를 확인하고 다시 시도해 주세요.";
    }
    const conv2 = convLoad();
    conv2.push({ role: "assistant", content: reply });
    convSave(conv2);
    semiBusy = false;
    if (si) { si.disabled = false; if (open && tab === "semi") si.focus(); }
    renderSemi();
  }
  function resetSemi() {
    try { sessionStorage.removeItem(SS_CONV + uid()); } catch (e) {}
    semiBusy = false;
    renderSemi();
  }

  function toastSafe(msg, err) {
    try { if (S() && S().toast) S().toast(msg, err); } catch (e) {}
  }

  /* ─── 진입점: app.js enterApp()에서 호출 ─── */
  function onLogin() {
    const u = me();
    if (!canUse(u)) { destroy(); return; }
    build();
    loadTeam();
    subscribe();
  }

  window.SemisChat = {
    onLogin, canUse, toggle, close, setTab, openPanel,
    sendTeam, askSemi, resetSemi, loadTeam,
    unreadCount, mdLite,
    addIncoming, removeMsg,
    get teamMsgs() { return teamMsgs; },
    get tab() { return tab; },
    get isOpen() { return open; },
    EDGE_URL, EDGE_TOKEN,
    _destroy: destroy
  };
})();
