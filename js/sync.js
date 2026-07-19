/* ═══════════════════════════════════════════════════════
   SeMIS v2 — Supabase Sync Layer (v2.1)
   localStorage(오프라인 폴백) ↔ Supabase 공용 DB 실시간 동기화

   - 컬렉션 단위 KV 동기화: public.semis_store (key, value jsonb, updated_at, updated_by)
   - 읽기/쓰기: PostgREST fetch (외부 라이브러리 불필요)
   - 실시간: supabase-js CDN 로드 시 Realtime 구독, 실패 시 주기 폴링 폴백
   - 오프라인: localStorage 그대로 사용, 변경분은 pending 큐에 보관 후 재접속 시 자동 push
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const SUPA_URL = "https://mzyuzrxkdcpzxojenwat.supabase.co";
  // anon(publishable) key — 공개용으로 설계된 키이며, 데이터 접근 권한은 앱 레벨 인증으로 관리
  const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eXV6cnhrZGNwenhvamVud2F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTQ1MTYsImV4cCI6MjA5OTY5MDUxNn0.YqcCnEY8Bn-Bc2cbUHWl4m9GLMIifZbH5KqrbamU0YI";
  const TABLE = "semis_store";
  const REST = SUPA_URL + "/rest/v1/" + TABLE;
  const HEADERS = { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY, "Content-Type": "application/json" };

  const SYNC_KEYS = ["menus", "notices", "schedules", "levelHistory", "pwOverrides", "userOverrides", "customUsers", "gcal", "inspections", "contacts", "branches", "passes", "equipment", "equipMaint", "trainings", "contracts", "regulations", "policy", "certs", "certOpts", "billing", "vault", "kpis"];
  const LS_PENDING = "semis2:pendingSync";
  const LS_FORCE = "semis2:forcePush";
  const CLIENT_ID = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const DEBOUNCE_MS = 800;
  const RETRY_MS = 30000;
  const POLL_MS = 30000;

  let status = "init";            // init | online | syncing | offline
  let snapshots = {};             // key → canonical JSON (마지막 동기화 시점)
  let pushTimer = null, retryTimer = null, pollTimer = null;
  let realtimeClient = null, realtimeOn = false;
  let lastPulledAt = null;

  const D = () => SeMIS.data;

  /* ─── canonical stringify (jsonb는 객체 키를 정렬하므로 비교용 정규화) ─── */
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  }

  /* ─── 상태 표시 ─── */
  const STATUS_META = {
    online:  { cls: "online",  txt: "실시간", title: "공용 DB 연결됨 — 변경 사항이 실시간 공유됩니다. (클릭: 수동 동기화)" },
    syncing: { cls: "syncing", txt: "동기화", title: "동기화 진행 중…" },
    offline: { cls: "offline", txt: "오프라인", title: "오프라인 — 로컬(localStorage)에 저장 중입니다. 재연결 시 자동 동기화됩니다. (클릭: 재시도)" },
    init:    { cls: "syncing", txt: "연결 중", title: "공용 DB 연결 중…" }
  };
  function setStatus(s) {
    status = s;
    try {
      const el = document.getElementById("sync-status");
      if (!el) return;
      const m = STATUS_META[s] || STATUS_META.init;
      el.className = "sync-dot " + m.cls;
      el.innerHTML = '<span class="sync-dot-ico"></span>' + m.txt;
      el.title = m.title;
    } catch (e) { /* 헤더 미존재(테스트 등) 무시 */ }
  }

  /* ─── pending 큐 (오프라인 변경분) ─── */
  function pendingKeys() {
    try { return JSON.parse(localStorage.getItem(LS_PENDING)) || []; } catch (e) { return []; }
  }
  function setPending(keys) {
    if (keys.length) localStorage.setItem(LS_PENDING, JSON.stringify(Array.from(new Set(keys))));
    else localStorage.removeItem(LS_PENDING);
  }

  /* ─── 스냅샷 / 변경 감지 ─── */
  function snapAll() { SYNC_KEYS.forEach(k => { snapshots[k] = canon(D()[k]); }); }
  function dirtyKeys() { return SYNC_KEYS.filter(k => canon(D()[k]) !== snapshots[k]); }

  /* ─── REST 통신 ─── */
  async function restGet() {
    const res = await fetch(REST + "?select=key,value,updated_at,updated_by", { headers: HEADERS });
    if (!res.ok) throw new Error("GET " + res.status);
    return res.json();
  }
  async function restUpsert(rows) {
    const res = await fetch(REST + "?on_conflict=key", {
      method: "POST",
      headers: Object.assign({}, HEADERS, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(rows)
    });
    if (!res.ok) throw new Error("POST " + res.status);
  }

  /* ─── push: 로컬 변경분 → 서버 ─── */
  async function push(keys) {
    const targets = Array.from(new Set((keys || []).concat(dirtyKeys(), pendingKeys())))
      .filter(k => SYNC_KEYS.includes(k));
    if (!targets.length) return;
    setStatus("syncing");
    const now = new Date().toISOString();
    const rows = targets.map(k => ({ key: k, value: D()[k], updated_at: now, updated_by: CLIENT_ID }));
    try {
      await restUpsert(rows);
      targets.forEach(k => { snapshots[k] = canon(D()[k]); });
      setPending([]);
      setStatus(realtimeOn ? "online" : "online");
    } catch (e) {
      setPending(targets);
      setStatus("offline");
      scheduleRetry();
      throw e;
    }
  }

  /* ─── pull: 서버 → 로컬 ─── */
  async function pull(initial) {
    const rows = await restGet();
    const pend = pendingKeys();
    const force = initial && localStorage.getItem(LS_FORCE) === "1";
    let changed = false;
    const present = {};
    rows.forEach(row => {
      if (!SYNC_KEYS.includes(row.key)) return;
      present[row.key] = true;
      if (row.updated_at && (!lastPulledAt || row.updated_at > lastPulledAt)) lastPulledAt = row.updated_at;
      const remote = canon(row.value);
      if (force) return; // 강제 push 모드(백업 복원)면 로컬 우선
      if (pend.includes(row.key)) {
        // 로컬 미전송 변경 + 서버 데이터 공존 → id 기준 병합(로컬 우선) 후 push
        const merged = mergeById(row.value, D()[row.key]);
        if (merged) { D()[row.key] = merged; changed = true; }
        return;
      }
      if (remote !== canon(D()[row.key])) {
        D()[row.key] = row.value;
        changed = true;
      }
      snapshots[row.key] = remote;
    });
    // 서버 데이터 반영 후 정규화 — 구버전 서버 데이터가 로컬 마이그레이션(신규 메뉴/필드)을
    // 되돌리지 않도록 보정하고, 보정분은 dirty로 잡혀 서버에 push됨
    try { if (SeMIS.normalizeData && SeMIS.normalizeData()) changed = true; } catch (e) {}
    // 서버에 없는 컬렉션은 로컬 데이터로 시드
    const missing = SYNC_KEYS.filter(k => !present[k]);
    const toPush = force ? SYNC_KEYS.slice()
      : Array.from(new Set(missing.concat(pend.filter(k => present[k]), dirtyKeys())));
    if (changed) {
      SeMIS.saveSilent();
      rerender();
    }
    if (toPush.length) await push(toPush);
    if (force) localStorage.removeItem(LS_FORCE);
    setStatus("online");
    return changed;
  }

  /* ─── id 기준 병합: 서버에만 있는 항목 + 로컬 항목(로컬 우선) ─── */
  function mergeById(serverVal, localVal) {
    if (!Array.isArray(serverVal) || !Array.isArray(localVal)) return null;
    if (!serverVal.every(x => x && x.id) || !localVal.every(x => x && x.id)) return null;
    const localIds = new Set(localVal.map(x => x.id));
    const merged = serverVal.filter(x => !localIds.has(x.id)).concat(localVal);
    return merged;
  }

  /* ─── 원격 변경 반영 (Realtime/폴링 공용) ─── */
  function applyRemote(key, value) {
    if (!SYNC_KEYS.includes(key)) return false;
    const remote = canon(value);
    if (remote === canon(D()[key])) { snapshots[key] = remote; return false; }
    D()[key] = value;
    snapshots[key] = remote;
    // 원격 반영 후 정규화 — 보정이 생기면 디바운스 push로 서버에 반영 (idempotent라 루프 없음)
    try { if (SeMIS.normalizeData && SeMIS.normalizeData()) queuePush(); } catch (e) {}
    SeMIS.saveSilent();
    rerender();
    return true;
  }

  function rerender() {
    try {
      if (!SeMIS.user) return; // 로그인 전에는 화면 갱신 불필요
      SeMIS.renderHeader();
      SeMIS.renderNav();
      SeMIS.renderView();
    } catch (e) { /* 렌더 실패가 동기화를 막지 않도록 */ }
  }

  /* ─── Realtime 구독 (supabase-js CDN 로드 시) ─── */
  function subscribe() {
    if (realtimeOn) return;
    if (typeof window === "undefined" || !window.supabase || !window.supabase.createClient) {
      startPolling(); // CDN 차단 등 → 폴링 폴백
      return;
    }
    try {
      realtimeClient = window.supabase.createClient(SUPA_URL, SUPA_KEY);
      realtimeClient.channel("semis-store-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, (payload) => {
          const row = payload && payload.new;
          if (!row || row.updated_by === CLIENT_ID) return;
          if (applyRemote(row.key, row.value)) {
            try { SeMIS.toast("다른 사용자의 변경 사항이 반영되었습니다."); } catch (e) {}
          }
        })
        .subscribe((st) => {
          if (st === "SUBSCRIBED") { realtimeOn = true; stopPolling(); setStatus("online"); }
          else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") {
            realtimeOn = false; startPolling();
          }
        });
    } catch (e) { startPolling(); }
  }

  /* ─── 폴링 폴백 ─── */
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      pull(false).catch(() => { setStatus("offline"); scheduleRetry(); });
    }, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ─── 재시도 ─── */
  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; reconnect(); }, RETRY_MS);
  }
  function reconnect() {
    pull(false).then(() => { if (!realtimeOn) subscribe(); })
      .catch(() => { setStatus("offline"); scheduleRetry(); });
  }

  /* ─── save 후크: 변경 감지 → 디바운스 push ─── */
  function queuePush() {
    const dk = dirtyKeys();
    if (!dk.length) return;
    setPending(pendingKeys().concat(dk)); // push 성공 시 비워짐 — 새로고침 유실 방지
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      push().catch(() => {});
    }, DEBOUNCE_MS);
  }

  /* ─── 파일 업로드 (Supabase Storage, 공지 첨부/이미지용) ─── */
  async function uploadFile(file, prefix) {
    if (typeof fetch === "undefined") throw new Error("offline");
    const safe = String(file.name || "file").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "file";
    const path = (prefix || "files") + "/" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + "_" + safe;
    const res = await fetch(SUPA_URL + "/storage/v1/object/semis-files/" + path, {
      method: "POST",
      headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY,
                 "Content-Type": file.type || "application/octet-stream" },
      body: file
    });
    if (!res.ok) throw new Error("upload " + res.status);
    return { name: file.name, size: file.size || 0,
             url: SUPA_URL + "/storage/v1/object/public/semis-files/" + path };
  }

  /* ─── 단일 KV 조회 (SYNC_KEYS 외 설정 행 — 예: caresCfg) ─── */
  async function fetchKV(key) {
    if (typeof fetch === "undefined") return null;
    const res = await fetch(REST + "?key=eq." + encodeURIComponent(key) + "&select=key,value", { headers: HEADERS });
    if (!res.ok) throw new Error("GET " + res.status);
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows.find(r => r && r.key === key) : null;
    return row ? row.value : null;
  }

  /* ─── 수동 동기화 ─── */
  async function syncNow() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    await push().catch(() => {});
    await pull(false);
    if (!realtimeOn) subscribe();
    return status;
  }

  /* ─── 초기화 ─── */
  function init() {
    if (typeof SeMIS === "undefined") return;
    if (typeof fetch === "undefined") { setStatus("offline"); return; }
    SeMIS.onSave(queuePush);
    snapAll();
    setStatus("init");
    const el = document.getElementById("sync-status");
    if (el) el.onclick = () => { setStatus("syncing"); syncNow().catch(() => setStatus("offline")); };
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => reconnect());
      window.addEventListener("offline", () => setStatus("offline"));
    }
    return pull(true)
      .then(() => subscribe())
      .catch(() => { setStatus("offline"); scheduleRetry(); });
  }

  function stop() { // 테스트/정리용
    stopPolling();
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    try { if (realtimeClient) realtimeClient.removeAllChannels(); } catch (e) {}
  }

  window.SemisSync = {
    init, stop, syncNow, uploadFile, fetchKV,
    push, pull, applyRemote,
    dirtyKeys, pendingKeys, snapAll,
    get status() { return status; },
    CLIENT_ID, SYNC_KEYS,
    _flush() { if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; } return push(); },
    _canon: canon
  };
})();
