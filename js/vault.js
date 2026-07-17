/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 암호 관리 모듈 (v2.9, 메뉴 vis: mgr)
   항공보안파트 전용 암호 저장소. 기존 구글시트(4명 제한 공유)를 내재화.

   ◆ 보안 설계 (서버에 평문이 절대 저장되지 않음):
   - 항목 데이터는 AES-256-GCM으로 클라이언트에서 암호화 후 동기화.
     공용 DB(semis_store)에는 암호문(iv+ct)과 래핑된 키만 저장되므로
     anon 키로 DB를 직접 읽어도 해독 불가.
   - 엔벨로프 암호화: 무작위 vaultKey(32B)가 데이터를 암호화하고,
     멤버별 개인 비밀번호에서 PBKDF2(SHA-256, 31만회)로 유도한 KEK가
     vaultKey를 각각 래핑. 개인 비밀번호는 어디에도 저장되지 않으며
     GCM 인증 태그로 검증(언랩 실패 = 잘못된 비밀번호).
   - 복호화된 데이터는 메모리에만 존재. localStorage/DB에 평문 기록 없음.
   - 모듈 진입 시마다 개인 비밀번호 재입력, 해제 5분 후 자동 잠금 +
     대시보드 이동, 다른 화면으로 이동 시 즉시 잠금(키 제로화).

   데이터: DATA.vault = { v, members:[{id,name,salt,iter,wrap:{iv,ct}}],
                          data:{iv,ct}|null, updated }
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const AUTO_LOCK_MS = 5 * 60 * 1000;   // 5분 자동 잠금
  const PBKDF2_ITER = 310000;
  const CATS = ["시스템", "웹사이트", "장비", "문서/파일", "기타"];
  const SHEET_URL = "https://docs.google.com/spreadsheets/d/1hx4QFtqfvPS8o2DZkVlAzwHU7dVl-VQrsZDfmXGno24/edit";

  const hasCrypto = () => typeof crypto !== "undefined" && !!crypto.subtle && !!crypto.getRandomValues;
  const V = () => D().vault;

  /* ─────── 인코딩 헬퍼 (TextEncoder 미의존 — 구형/테스트 환경 호환) ─────── */
  function strBytes(s) {
    const bin = unescape(encodeURIComponent(String(s)));
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function bytesStr(u) {
    let bin = "";
    for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return decodeURIComponent(escape(bin));
  }
  function b64(u) {
    let bin = "";
    for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function unb64(s) {
    const bin = atob(String(s || ""));
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  /* ─────── 암호화 프리미티브 ─────── */
  const importRaw = (raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  async function deriveKEK(pw, salt, iter) {
    const km = await crypto.subtle.importKey("raw", strBytes(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: iter || PBKDF2_ITER, hash: "SHA-256" },
      km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function aesEnc(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
    return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }
  async function aesDec(key, box) { // 실패(잘못된 키/변조) 시 예외
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct));
    return new Uint8Array(pt);
  }

  /* ─────── 해제 세션 (메모리 전용 — 어디에도 직렬화 금지) ─────── */
  let rawKey = null;      // Uint8Array(32) vaultKey
  let entries = null;     // 복호화된 항목 배열
  let unlockedBy = null;  // 해제한 멤버 이름
  let lockTimer = null, tickTimer = null, expireAt = 0;
  let query = "";

  const isUnlocked = () => !!rawKey;
  function lock() {
    if (rawKey) rawKey.fill(0);
    rawKey = null; entries = null; unlockedBy = null; expireAt = 0; query = "";
    if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }
  function onExpire() {
    const onVault = (typeof location !== "undefined") && location.hash.replace(/^#\//, "") === "vault";
    lock();
    if (onVault) {
      SeMIS.navigate("dashboard");
      try { toast("🔐 보안을 위해 암호 관리 세션이 종료되었습니다. (5분 경과)"); } catch (e) {}
    }
  }
  function startLockTimer() {
    expireAt = Date.now() + AUTO_LOCK_MS;
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = setTimeout(onExpire, AUTO_LOCK_MS);
  }
  function extend() { // 잠금 시간 5분 연장 (지금부터 5분으로 재설정)
    if (!isUnlocked()) return;
    startLockTimer();
    const el = typeof document !== "undefined" && document.getElementById("vault-timer");
    if (el) el.textContent = "⏳ " + fmtRemain();
  }
  // 다른 화면으로 이동하면 즉시 잠금 (키 제로화)
  if (typeof window !== "undefined") {
    window.addEventListener("hashchange", () => {
      if (location.hash.replace(/^#\//, "") !== "vault" && isUnlocked()) lock();
    });
  }

  /* ─────── 저장(암호화 후 동기화) ─────── */
  async function persist() {
    const key = await importRaw(rawKey);
    V().data = await aesEnc(key, strBytes(JSON.stringify(entries)));
    V().updated = new Date().toISOString();
    SeMIS.save();
  }

  /* ─────── 핵심 동작: 설정/해제/멤버 ─────── */
  async function setup(name, pw) { // 최초 저장소 생성
    if (V().members.length) throw new Error("이미 설정된 저장소입니다.");
    rawKey = crypto.getRandomValues(new Uint8Array(32));
    entries = []; unlockedBy = name;
    await addMember(name, pw);
    await persist();
    startLockTimer();
  }
  async function unlock(memberId, pw) {
    const m = V().members.find(x => x.id === memberId);
    if (!m) throw new Error("멤버를 선택하세요.");
    const kek = await deriveKEK(pw, unb64(m.salt), m.iter);
    const raw = await aesDec(kek, m.wrap);   // 잘못된 비밀번호 → 예외
    rawKey = raw; unlockedBy = m.name;
    if (V().data) {
      const key = await importRaw(rawKey);
      entries = JSON.parse(bytesStr(await aesDec(key, V().data)));
    } else entries = [];
    startLockTimer();
  }
  async function addMember(name, pw) { // 해제 상태에서만 (vaultKey 필요)
    if (!isUnlocked()) throw new Error("잠금 해제 후 가능합니다.");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kek = await deriveKEK(pw, salt, PBKDF2_ITER);
    const wrap = await aesEnc(kek, rawKey);
    V().members.push({ id: uid("vm"), name: String(name).trim(), salt: b64(salt), iter: PBKDF2_ITER, wrap });
    SeMIS.save();
  }
  function removeMember(memberId) {
    if (!isUnlocked()) return;
    if (V().members.length <= 1) { toast("최소 1명의 멤버가 필요합니다.", true); return; }
    V().members = V().members.filter(m => m.id !== memberId);
    SeMIS.save();
  }
  async function changeMemberPw(memberId, newPw) { // 해제 상태에서 재래핑
    if (!isUnlocked()) throw new Error("잠금 해제 후 가능합니다.");
    const m = V().members.find(x => x.id === memberId);
    if (!m) return;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kek = await deriveKEK(newPw, salt, PBKDF2_ITER);
    m.salt = b64(salt); m.iter = PBKDF2_ITER; m.wrap = await aesEnc(kek, rawKey);
    SeMIS.save();
  }

  /* ─────── 유틸 ─────── */
  function copyText(txt, label) {
    const done = () => toast((label || "내용") + " 복사됨 — 사용 후 다른 내용을 복사해 지우세요.");
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(() => toast("복사에 실패했습니다.", true));
    } else toast("이 환경에서는 복사할 수 없습니다.", true);
  }
  function genPw(len) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*-_=+";
    const r = crypto.getRandomValues(new Uint8Array(len || 16));
    let out = "";
    for (let i = 0; i < r.length; i++) out += chars[r[i] % chars.length];
    return out;
  }
  const fmtRemain = () => {
    const s = Math.max(0, Math.ceil((expireAt - Date.now()) / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };

  /* ─────── 항목 편집 폼 ─────── */
  function entryForm(id) {
    const x = id ? entries.find(en => en.id === id) : null;
    openModal(`
      <h3>${x ? "항목 수정" : "항목 추가"} <span class="badge badge-gray">암호 관리</span></h3>
      <div class="form-grid">
        <div class="form-row"><label>분류</label>
          <select id="v-cat">${CATS.map(c => `<option ${(x ? x.category : CATS[0]) === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div class="form-row"><label>제목</label>
          <input id="v-title" value="${esc(x ? x.title : "")}" maxlength="60" placeholder="예: 문자의 신 (보안동보)"></div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>계정 / ID</label>
          <input id="v-account" value="${esc(x ? x.account || "" : "")}" maxlength="80" autocomplete="off"></div>
        <div class="form-row"><label>비밀번호</label>
          <div style="display:flex;gap:6px">
            <input id="v-pw" value="${esc(x ? x.pw || "" : "")}" maxlength="120" autocomplete="off" style="flex:1">
            <button type="button" class="btn btn-ghost btn-sm" id="v-gen" title="무작위 생성">🎲</button>
          </div></div>
      </div>
      <div class="form-row"><label>URL (선택)</label>
        <input id="v-url" value="${esc(x ? x.url || "" : "")}" maxlength="300" placeholder="https://..."></div>
      <div class="form-row"><label>비고</label><input id="v-note" value="${esc(x ? x.note || "" : "")}" maxlength="200"></div>
      <div class="modal-actions">
        ${x ? '<button class="btn btn-danger" id="v-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="v-cancel">취소</button>
        <button class="btn btn-primary" id="v-save">저장</button>
      </div>`);
    $("#v-gen").onclick = () => { $("#v-pw").value = genPw(16); };
    $("#v-cancel").onclick = closeModal;
    if (x) $("#v-del").onclick = () =>
      confirmModal(`항목 "${x.title}"을(를) 삭제하시겠습니까?`, async () => {
        if (!isUnlocked()) return;
        entries = entries.filter(en => en.id !== x.id);
        await persist(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    $("#v-save").onclick = async () => {
      if (!isUnlocked()) { closeModal(); SeMIS.renderView(); return; }
      const title = $("#v-title").value.trim();
      if (!title) { toast("제목을 입력하세요.", true); return; }
      const rec = {
        category: $("#v-cat").value, title,
        account: $("#v-account").value.trim(),
        pw: $("#v-pw").value,
        url: $("#v-url").value.trim(),
        note: $("#v-note").value.trim(),
        updated: new Date().toISOString().slice(0, 10)
      };
      if (x) Object.assign(x, rec);
      else entries.push(Object.assign({ id: uid("ve") }, rec));
      await persist(); closeModal(); SeMIS.renderView(); toast("저장되었습니다. (암호화 동기화)");
    };
  }

  /* ─────── 멤버 관리 모달 ─────── */
  function membersModal() {
    if (!isUnlocked()) return;
    openModal(`
      <h3>👥 멤버 관리 <span class="badge badge-gray">암호 관리</span></h3>
      <p class="form-hint">멤버는 각자의 개인 비밀번호로 저장소를 열 수 있습니다. (현재 ${V().members.length}명)</p>
      <div id="vm-list">${V().members.map(m => `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid var(--border);font-size:.88rem">
          <b>${esc(m.name)}</b>${m.name === unlockedBy ? ' <span class="badge badge-blue">나</span>' : ""}
          <span class="spacer" style="flex:1"></span>
          <button class="btn btn-ghost btn-sm" data-vm-pw="${esc(m.id)}">비밀번호 변경</button>
          <button class="btn btn-danger btn-sm" data-vm-del="${esc(m.id)}">제거</button>
        </div>`).join("")}</div>
      <div class="form-grid" style="margin-top:14px">
        <div class="form-row"><label>새 멤버 이름</label><input id="vm-name" maxlength="20" placeholder="예: 최상일"></div>
        <div class="form-row"><label>개인 비밀번호</label><input id="vm-newpw" type="password" maxlength="60" autocomplete="new-password"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="vm-close">닫기</button>
        <button class="btn btn-primary" id="vm-add">+ 멤버 추가</button>
      </div>`);
    $("#vm-close").onclick = closeModal;
    $("#vm-add").onclick = async () => {
      const name = $("#vm-name").value.trim(), pw = $("#vm-newpw").value;
      if (!name || pw.length < 4) { toast("이름과 4자 이상의 비밀번호를 입력하세요.", true); return; }
      if (V().members.some(m => m.name === name)) { toast("이미 등록된 이름입니다.", true); return; }
      await addMember(name, pw);
      closeModal(); toast(name + " 멤버가 추가되었습니다.");
    };
    $$("#vm-list [data-vm-del]").forEach(b => b.onclick = () => {
      const m = V().members.find(x => x.id === b.dataset.vmDel);
      confirmModal(`멤버 "${m ? m.name : ""}"을(를) 제거하시겠습니까? 해당 비밀번호로 더 이상 열 수 없습니다.`, () => {
        removeMember(b.dataset.vmDel); closeModal(); toast("제거되었습니다.");
      });
    });
    $$("#vm-list [data-vm-pw]").forEach(b => b.onclick = () => {
      const m = V().members.find(x => x.id === b.dataset.vmPw);
      if (!m) return;
      openModal(`
        <h3>🔑 ${esc(m.name)} 비밀번호 변경</h3>
        <div class="form-row"><label>새 개인 비밀번호</label>
          <input id="vp-new" type="password" maxlength="60" autocomplete="new-password"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="vp-cancel">취소</button>
          <button class="btn btn-primary" id="vp-save">변경</button>
        </div>`);
      $("#vp-cancel").onclick = closeModal;
      $("#vp-save").onclick = async () => {
        const pw = $("#vp-new").value;
        if (pw.length < 4) { toast("4자 이상 입력하세요.", true); return; }
        await changeMemberPw(m.id, pw);
        closeModal(); toast("비밀번호가 변경되었습니다.");
      };
    });
  }

  /* ─────── 잠금 화면 / 해제 화면 렌더 ─────── */
  function lockedHTML() {
    const members = V().members;
    return `
      <div class="card" style="max-width:460px;margin:24px auto;text-align:center">
        <div style="font-size:2.2rem;margin:6px 0">🔐</div>
        <div style="font-weight:800;font-size:1.05rem">암호 관리 저장소</div>
        <p style="font-size:.84rem;color:var(--text-2);margin:8px 0 16px">
          항공보안파트 전용 — 본인 확인을 위해 <b>개인 비밀번호</b>를 다시 입력하세요.<br>
          <span style="font-size:.78rem;color:var(--text-3)">해제 후 5분이 지나면 자동으로 잠기고 대시보드로 이동합니다.</span></p>
        ${!hasCrypto() ? '<p class="login-error">이 브라우저는 암호화(WebCrypto)를 지원하지 않아 사용할 수 없습니다.<br>HTTPS 접속(https://semis.pe.kr) 여부를 확인하세요.</p>' :
        members.length ? `
          <form id="vault-unlock-form" autocomplete="off" style="display:flex;flex-direction:column;gap:10px;max-width:300px;margin:0 auto">
            <select id="vu-member">${members.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select>
            <input type="password" id="vu-pw" placeholder="개인 비밀번호" autocomplete="current-password">
            <button type="submit" class="btn btn-primary">🔓 잠금 해제</button>
            <p id="vu-error" class="login-error"></p>
          </form>` : `
          <form id="vault-setup-form" autocomplete="off" style="display:flex;flex-direction:column;gap:10px;max-width:300px;margin:0 auto">
            <p style="font-size:.82rem;color:var(--text-2)">최초 설정 — 저장소를 생성합니다.</p>
            <input id="vs-name" placeholder="본인 이름 (예: 박철성)" maxlength="20">
            <input type="password" id="vs-pw" placeholder="개인 비밀번호 (4자 이상)" autocomplete="new-password">
            <input type="password" id="vs-pw2" placeholder="비밀번호 확인" autocomplete="new-password">
            <button type="submit" class="btn btn-primary">저장소 생성</button>
            <p id="vs-error" class="login-error"></p>
          </form>`}
        <p style="font-size:.76rem;color:var(--text-3);margin-top:16px">
          데이터는 AES-256 암호화 후 저장되며 개인 비밀번호는 서버에 저장되지 않습니다.<br>
          <a href="${SHEET_URL}" target="_blank" rel="noopener">구버전 시트 열기 ↗</a></p>
      </div>`;
  }

  function rowHTML(en, i) {
    return `<tr>
      <td><span class="badge badge-gray">${esc(en.category)}</span></td>
      <td><b>${esc(en.title)}</b>${en.note ? `<div style="font-size:.74rem;color:var(--text-3)">${esc(en.note)}</div>` : ""}</td>
      <td style="font-size:.84rem">${en.account ? `${esc(en.account)} <button class="ct-copy" data-vc-acc="${i}" title="계정 복사">📋</button>` : "-"}</td>
      <td style="font-size:.84rem;white-space:nowrap">${en.pw ? `<span class="v-mask" data-vp-span="${i}">••••••••</span>
        <button class="ct-copy" data-vp-eye="${i}" title="표시/숨김">👁</button>
        <button class="ct-copy" data-vc-pw="${i}" title="비밀번호 복사">📋</button>` : "-"}</td>
      <td>${en.url ? `<a href="${esc(en.url)}" target="_blank" rel="noopener">열기 ↗</a>` : "-"}</td>
      <td style="font-size:.7rem;color:var(--text-3);white-space:nowrap">${esc(en.updated || "")}</td>
      <td><button class="btn btn-ghost btn-sm" data-ve-edit="${esc(en.id)}">✎</button></td>
    </tr>`;
  }

  function unlockedBody() {
    const q = query.toLowerCase();
    const items = entries
      .map((en, i) => ({ en, i }))
      .filter(({ en }) => !q || [en.title, en.category, en.account, en.url, en.note]
        .some(v => String(v || "").toLowerCase().includes(q)))
      .sort((a, b) => String(a.en.category).localeCompare(b.en.category) || String(a.en.title).localeCompare(b.en.title));
    if (!items.length) return '<div class="empty">등록된 항목이 없습니다. "+ 항목 추가"로 시트 내용을 옮겨오세요.</div>';
    return `<div class="table-wrap"><table class="tbl"><thead><tr>
        <th style="width:86px">분류</th><th>제목</th><th>계정</th><th style="width:150px">비밀번호</th>
        <th style="width:60px">URL</th><th style="width:86px">수정일</th><th style="width:44px"></th></tr></thead>
      <tbody>${items.map(({ en, i }) => rowHTML(en, i)).join("")}</tbody></table></div>`;
  }

  /* ─────── 모듈 렌더 ─────── */
  SeMIS.registerModule("vault", {
    title: "암호 관리",
    render(root) {
      if (SeMIS.roleRank() < 3) { root.innerHTML = '<div class="empty">접근 권한이 없습니다.</div>'; return; } // v2.11: 대외비 — hq 이상

      if (!isUnlocked()) {
        root.innerHTML = `
          <div class="page-head">
            <div class="page-title">🔐 암호 관리</div>
            <div class="page-desc">항공보안파트 공용 암호 저장소 (클라이언트 암호화)</div>
          </div>` + lockedHTML();
        const uf = $("#vault-unlock-form");
        if (uf) uf.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const btn = uf.querySelector("button[type=submit]");
          btn.disabled = true; $("#vu-error").textContent = "";
          try {
            await unlock($("#vu-member").value, $("#vu-pw").value);
            SeMIS.renderView();
          } catch (e) {
            $("#vu-error").textContent = "비밀번호가 올바르지 않습니다.";
            $("#vu-pw").value = ""; $("#vu-pw").focus();
            btn.disabled = false;
          }
        });
        const sf = $("#vault-setup-form");
        if (sf) sf.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const name = $("#vs-name").value.trim(), pw = $("#vs-pw").value;
          if (!name) { $("#vs-error").textContent = "이름을 입력하세요."; return; }
          if (pw.length < 4) { $("#vs-error").textContent = "비밀번호는 4자 이상이어야 합니다."; return; }
          if (pw !== $("#vs-pw2").value) { $("#vs-error").textContent = "비밀번호 확인이 일치하지 않습니다."; return; }
          try { await setup(name, pw); SeMIS.renderView(); toast("저장소가 생성되었습니다."); }
          catch (e) { $("#vs-error").textContent = "생성 실패: " + e.message; }
        });
        return;
      }

      /* 해제 상태 */
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🔐 암호 관리</div>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" id="vault-extend" title="잠금 시간을 지금부터 5분으로 연장">🕐 5분 연장</button>
          <span class="badge badge-amber" id="vault-timer" title="남은 시간 후 자동 잠금">⏳ ${fmtRemain()}</span>
          <button class="btn btn-ghost btn-sm" id="vault-members">👥 멤버</button>
          <button class="btn btn-ghost btn-sm" id="vault-lock">🔒 잠그기</button>
          <button class="btn btn-primary" id="vault-add">+ 항목 추가</button>
          <div class="page-desc">${esc(unlockedBy)} 해제 중 · 5분 후 자동 잠금 · 항목 ${entries.length}건 ·
            <a href="${SHEET_URL}" target="_blank" rel="noopener">구버전 시트 ↗</a></div>
        </div>
        <div class="card">
          <div class="cal-toolbar">
            <input id="vault-search" class="ct-search" type="search" style="max-width:280px"
              placeholder="🔍 제목 · 계정 · 분류 검색" value="${esc(query)}" autocomplete="off">
          </div>
          <div id="vault-body">${unlockedBody()}</div>
        </div>`;

      const wire = () => {
        $$("#vault-body [data-ve-edit]").forEach(b => b.onclick = () => entryForm(b.dataset.veEdit));
        $$("#vault-body [data-vc-acc]").forEach(b => b.onclick = () => {
          const en = entries[Number(b.dataset.vcAcc)];
          if (en) copyText(en.account, "계정");
        });
        $$("#vault-body [data-vc-pw]").forEach(b => b.onclick = () => {
          const en = entries[Number(b.dataset.vcPw)];
          if (en) copyText(en.pw, "비밀번호");
        });
        $$("#vault-body [data-vp-eye]").forEach(b => b.onclick = () => {
          const i = Number(b.dataset.vpEye);
          const span = $(`[data-vp-span="${i}"]`);
          const en = entries[i];
          if (!span || !en) return;
          const shown = span.dataset.shown === "1";
          span.textContent = shown ? "••••••••" : en.pw;
          span.dataset.shown = shown ? "" : "1";
        });
      };
      $("#vault-search").oninput = () => {
        query = $("#vault-search").value.trim();
        $("#vault-body").innerHTML = unlockedBody(); wire();
      };
      $("#vault-add").onclick = () => entryForm(null);
      $("#vault-extend").onclick = () => { extend(); toast("🕐 잠금 시간이 5분 연장되었습니다."); };
      $("#vault-members").onclick = membersModal;
      $("#vault-lock").onclick = () => { lock(); SeMIS.renderView(); };
      wire();

      // 남은 시간 카운트다운 (요소가 사라지면 자동 해제)
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(() => {
        const el = document.getElementById("vault-timer");
        if (!el || !isUnlocked()) { clearInterval(tickTimer); tickTimer = null; return; }
        el.textContent = "⏳ " + fmtRemain();
      }, 1000);
    }
  });

  /* ─────── 테스트/외부 노출 (키·평문은 노출하지 않음) ─────── */
  window.SemisVault = {
    CATS, AUTO_LOCK_MS, PBKDF2_ITER,
    isUnlocked, lock, extend, setup, unlock, addMember, removeMember, changeMemberPw,
    entryCount: () => (entries ? entries.length : null),
    addEntryForTest: async (rec) => { // 테스트용: 해제 상태에서 항목 추가+암호화 저장
      if (!isUnlocked()) throw new Error("locked");
      entries.push(Object.assign({ id: uid("ve") }, rec));
      await persist();
    },
    findEntry: (title) => (entries ? entries.find(e => e.title === title) || null : null),
    remainingMs: () => (expireAt ? expireAt - Date.now() : 0),
    _fireExpire: () => { if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; } onExpire(); }
  };
})();
