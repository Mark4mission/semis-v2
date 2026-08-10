/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 회의록 게시판 (v2.40)
   회의 때마다 "빈 회의록"을 즉시 만들어 그 자리에서 기록하는 범용 게시판.
   (보안장비 협의회는 전용 서식이 있는 별도 모듈 — 이쪽은 모든 회의 공용)

   설계 목표
   1) 자동화 — 새 회의록을 만들면 회차·제목·일시·장소·주재·참석자·전차
      미결사항이 직전 회의에서 자동으로 채워진다. 작성자는 논의 내용만 쓰면 된다.
   2) 분류 — 폴더(그룹)로 회의체를 나눠 저장. 폴더는 사용자가 관리.
   3) 검색 — 제목·본문·참석자·결정사항·태그를 한 번에. 전역 검색에도 연동.
   4) 서명 — 6자리 코드 + QR 코드. 참석자가 휴대폰으로 스캔 → 바로 서명.
   5) 인쇄 — A4 회의록 + QR 안내문(회의실 게시용).

   데이터
     DATA.minuteFolders = [{ id, name, icon, desc, place, chair, seq }]
     DATA.minutes = [{ id, folder, no(회차), title, date, time, place,
       chair(주재), scribe(작성), attendees:[{name,org,role,note,sign}],
       absent(불참), agenda/agendaHtml, body/bodyHtml(논의내용),
       decisions:[{task,owner,due,done}], carry:[{...}](전차 미결 참고),
       nextDate, nextTime, nextPlace, nextPlan, linkCal(차기 일정 연동),
       tags:[], files:[{url,name,size}], status: "draft"|"final",
       by, byId, updated, created }]

   권한: mgr 이상 열람·작성 / 본인 작성분은 본인이 수정, hq 이상은 전체 수정
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const MAX_FILES = 20;
  const FILE_MAX = 20 * 1024 * 1024;   // 20MB
  const MAX_ATT = 60;

  /* ─── 기본 폴더 (최초 1회 시드 · 이후 사용자 관리) ─── */
  function seedFolders() {
    return [
      { id: "mf-part", seq: 1, icon: "📋", name: "항공보안파트 정례회의", desc: "파트 주간·월간 정례회의", place: "본사 회의실", chair: "" },
      { id: "mf-agency", seq: 2, icon: "🏛", name: "유관기관 협의", desc: "국토부·공항공사·경찰 등 대외 협의", place: "", chair: "" },
      { id: "mf-branch", seq: 3, icon: "🏢", name: "지점·협력업체 회의", desc: "지점 보안담당자 및 협력업체 간담회", place: "", chair: "" },
      { id: "mf-edu", seq: 4, icon: "🎓", name: "교육·훈련 강평", desc: "보안교육·비상훈련 사후 강평", place: "", chair: "" },
      { id: "mf-incident", seq: 5, icon: "🚨", name: "사고·이슈 대응", desc: "보안사고 및 현안 대응 회의", place: "", chair: "" },
      { id: "mf-etc", seq: 9, icon: "🗂", name: "기타 회의", desc: "그 밖의 회의", place: "", chair: "" }
    ];
  }

  const all = () => (Array.isArray(D().minutes) ? D().minutes : []);
  const folders = () => (Array.isArray(D().minuteFolders) ? D().minuteFolders : [])
    .slice().sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0) || String(a.name || "").localeCompare(String(b.name || "")));
  const folderOf = (id) => folders().find(f => f.id === id) || null;
  const folderName = (id) => { const f = folderOf(id); return f ? f.name : "미분류"; };
  const folderIcon = (id) => { const f = folderOf(id); return (f && f.icon) || "🗒"; };

  /* 최신순 (회의일 → 회차 → id) */
  const sorted = (list) => (list || all()).slice().sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")) ||
    (Number(b.no) || 0) - (Number(a.no) || 0) ||
    String(b.id || "").localeCompare(String(a.id || "")));

  const inFolder = (fid) => all().filter(x => x && (fid ? x.folder === fid : true));
  /* 회차 채번은 전체 기준 — 열람 못 하는 회차가 있어도 번호가 겹치면 안 되므로 */
  const nextNo = (fid) => inFolder(fid).reduce((mx, x) => Math.max(mx, Number(x.no) || 0), 0) + 1;

  /* 같은 폴더의 직전 회의 (자동 채움 기준) — 승계는 열람 가능한 회의에서만 */
  function prevMeeting(fid, exceptId) {
    return sorted(visibleAll().filter(x => x.folder === fid && x.id !== exceptId))[0] || null;
  }

  const rank = () => SeMIS.roleRank();
  const me = () => (SeMIS.user && (SeMIS.user.origId || SeMIS.user.id)) || "";
  const canWrite = () => rank() >= 2;                       // 작성: 보안관리자 이상
  const canEditRec = (x) => rank() >= 3 || (!!x && x.byId && x.byId === me());
  const canDelRec = (x) => SeMIS.canDelete() || (canWrite() && !!x && x.byId && x.byId === me());
  const canManageFolders = () => rank() >= 3;

  /* ══════════ 열람 권한 (v2.40.2) ══════════
     회의록은 참석자의 기록이므로 "직급"이 아니라 "참석 사실"로 열람 범위를 정한다.

       ① 항공보안HQ 이상          → 전체 열람
       ② 작성자(서기) 본인          → 열람 (참석 명단에 없어도 본인이 쓴 기록)
       ③ 참석자 명단에 본인이 있음  → 열람 (계정 등급과 무관 — 일반사용자도 가능)
       ④ 본인이 한 번이라도 참석한 같은 회의체(폴더) → 그 폴더의 다른 회차도 열람
          (부득이 참석 못한 직전 회의 등을 확인할 수 있도록)
       ⑤ 그 외                     → 차단 (보안관리자여도 남의 회의는 볼 수 없음)

     본인 식별 — 두 경로를 함께 사용한다.
       (가) 로그인 계정 이름이 참석자 이름과 같을 때 (실명 계정)
       (나) QR로 서명한 이력이 있는 기기 (공용 계정 대응)
            서명할 때 그 기기에 이름을 남겨두고, 이후 같은 기기로 접속하면 본인으로 인식.
            실제로 참석해서 서명한 사람만 인식되므로 자가 신고보다 확실하다. */
  const LS_SIGNED = "semis2:signedAs";
  const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

  function signedNames() {
    try { const v = JSON.parse(localStorage.getItem(LS_SIGNED)); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  /* 서명 완료 시 호출 — 이 기기의 '본인'으로 이름을 기억(최근 5명, 기기 공용 사용 대비) */
  function rememberSigner(name) {
    const n = String(name || "").trim();
    if (!n) return;
    const list = signedNames().filter(v => norm(v) !== norm(n));
    list.unshift(n);
    try { localStorage.setItem(LS_SIGNED, JSON.stringify(list.slice(0, 5))); } catch (e) { /* 저장 불가 무시 */ }
  }
  /* 현재 사용자로 인정되는 이름들 (계정 이름 + 이 기기의 서명 이력) */
  function myNames() {
    const out = [];
    const u = SeMIS.user;
    if (u && u.name) out.push(norm(u.name));
    signedNames().forEach(n => { const k = norm(n); if (k && out.indexOf(k) < 0) out.push(k); });
    return out.filter(Boolean);
  }
  const attendedBy = (x, names) => (x.attendees || []).some(a => names.indexOf(norm(a.name)) >= 0);
  /* 본인과 직접 관련된 회의(참석 or 작성) */
  function isMineRec(x, names, uid) {
    return (!!uid && x.byId === uid) || attendedBy(x, names);
  }
  /* 열람 가능한 회의록 목록 — 화면·검색·통계가 모두 이 결과만 사용한다 */
  function visibleAll() {
    if (rank() >= 3) return all();
    const names = myNames(), uid = me();
    const mine = all().filter(x => isMineRec(x, names, uid));
    if (!mine.length) return [];
    const myFolders = new Set(mine.map(x => x.folder));
    return all().filter(x => isMineRec(x, names, uid) || myFolders.has(x.folder));
  }
  function canSeeRec(x) {
    if (!x) return false;
    if (rank() >= 3) return true;
    return visibleAll().some(v => v.id === x.id);
  }

  const nl2br = (s) => esc(String(s || "")).replace(/\n/g, "<br>");
  const todayStr = () => new Date().toISOString().slice(0, 10);

  /* 리치 텍스트 — 공지 에디터 인프라 재사용 (council과 동일 규약) */
  const sanitize = (h) => (window.SemisNotice ? window.SemisNotice.sanitizeHtml(h) : esc(h));
  const hasRich = (html, text) => !!(text && text.trim()) || /<(img|table|a|ul|ol|li)\b/i.test(html || "");
  const richView = (html, text) => html
    ? `<div class="cn-text cn-rich notice-html">${sanitize(html)}</div>`
    : (text ? `<div class="cn-text">${nl2br(text)}</div>` : "");
  const richFieldHTML = (key, labelHTML, ph) => `
        <div class="form-row"><label>${labelHTML}</label>
          <div class="nb-toolbar nb-mini" data-rich-tb="${key}">
            <button type="button" data-cmd="bold" title="굵게"><b>B</b></button>
            <button type="button" data-cmd="insertUnorderedList" title="글머리 목록">•—</button>
            <button type="button" data-rich-link="${key}" title="링크">🔗 링크</button>
            <button type="button" data-rich-img="${key}" title="이미지">🖼 이미지</button>
          </div>
          <div id="mn-${key}" class="nb-editor nb-rich" contenteditable="true" data-ph="${esc(ph || "")}"></div>
          <input type="file" id="mn-${key}-img" accept="image/*" style="display:none"></div>`;
  function wireRich(key, html, text) {
    const ed = $("#mn-" + key);
    if (!ed) return;
    ed.innerHTML = html || (text ? esc(text).replace(/\n/g, "<br>") : "");
    const rich = window.SemisNotice ? window.SemisNotice.wireRichMedia(ed, "minutes") : null;
    $$(`[data-rich-tb="${key}"] [data-cmd]`).forEach(b => {
      b.onmousedown = (ev) => ev.preventDefault();
      b.onclick = () => { ed.focus(); try { document.execCommand(b.dataset.cmd); } catch (e) {} };
    });
    const linkBtn = $(`[data-rich-link="${key}"]`);
    if (linkBtn) linkBtn.onclick = () => {
      let url = ""; try { url = window.prompt("링크 주소(URL)", "https://") || ""; } catch (e) {}
      url = url.trim();
      if (!/^https?:\/\/.+/.test(url)) { if (url) toast("http:// 또는 https:// 로 시작하는 주소를 입력하세요.", true); return; }
      let label = ""; try { label = window.prompt("링크에 표시할 제목 (비우면 주소가 그대로 표시됩니다)", "") || ""; } catch (e) {}
      ed.focus();
      const a = `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label.trim() || url)}</a>&nbsp;`;
      if (rich) rich.insert(a);
      else { try { document.execCommand("insertHTML", false, a); } catch (e) { ed.innerHTML += a; } }
    };
    const imgBtn = $(`[data-rich-img="${key}"]`), imgFile = $("#mn-" + key + "-img");
    if (imgBtn) imgBtn.onclick = () => imgFile.click();
    if (imgFile) imgFile.onchange = (ev) => { if (rich) rich.addFiles(ev.target.files); ev.target.value = ""; };
  }
  function richOut(key) {
    const ed = $("#mn-" + key);
    if (!ed) return { html: "", text: "" };
    const html = sanitize(ed.innerHTML);
    const tmp = document.createElement("div"); tmp.innerHTML = html;
    const text = (tmp.textContent || "").trim();
    return { html: hasRich(html, text) ? html : "", text };
  }

  function copyText(t) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t); return; } } catch (e) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    } catch (e) {}
  }
  function wireCopies(scope) {
    $$((scope || "") + " [data-copy]").forEach(el => el.onclick = (ev) => {
      ev.preventDefault(); copyText(el.dataset.copy);
      toast("복사되었습니다: " + (el.dataset.copyLabel || el.dataset.copy));
    });
  }

  /* ══════════ 참석자 이력 디렉터리 (이름 → 최근 소속·직책) ══════════ */
  function knownPeople() {
    const dir = new Map();
    sorted(visibleAll()).forEach(m => (m.attendees || []).forEach(a => {
      const nm = String(a.name || "").trim();
      if (!nm || dir.has(nm)) return;
      dir.set(nm, { name: nm, org: String(a.org || "").trim(), role: String(a.role || "").trim() });
    }));
    // 협의회 참석 이력도 함께 활용 (같은 사람이 여러 회의체에 참석)
    if (window.SemisCouncil && SemisCouncil.knownPeople) {
      try {
        SemisCouncil.knownPeople().forEach((p, nm) => { if (!dir.has(nm)) dir.set(nm, { name: nm, org: p.org, role: p.role }); });
      } catch (e) { /* 협의회 모듈 미로드 — 무시 */ }
    }
    return dir;
  }
  const orgPresets = () => {
    const s = new Set();
    visibleAll().forEach(m => (m.attendees || []).forEach(a => { const o = String(a.org || "").trim(); if (o) s.add(o); }));
    ["항공보안파트", "인천화물팀", "운항품질팀", "객실승무팀", "지점", "프로에스콤", "인씨스", "국토교통부", "인천국제공항공사", "한국공항공사"]
      .forEach(o => s.add(o));
    return Array.from(s);
  };

  /* ══════════ 통계 ══════════ */
  function stats() {
    const items = visibleAll();
    const yr = new Date().getFullYear();
    const ym = todayStr().slice(0, 7);
    let open = 0, overdue = 0;
    items.forEach(x => (x.decisions || []).forEach(a => {
      if (a.done) return;
      open++;
      if (a.due && a.due < todayStr()) overdue++;
    }));
    return {
      total: items.length,
      thisYear: items.filter(x => String(x.date || "").slice(0, 4) === String(yr)).length,
      thisMonth: items.filter(x => String(x.date || "").slice(0, 7) === ym).length,
      draft: items.filter(x => x.status === "draft").length,
      open, overdue, yr
    };
  }

  /* ══════════ 화면 상태 (폴더/검색/필터) ══════════ */
  const view = { folder: "", q: "", year: "", status: "", tab: "list" };

  function matches(x, q) {
    if (!q) return true;
    const hay = [
      x.title, x.place, x.chair, x.scribe, x.agenda, x.body, x.nextPlan, x.absent,
      folderName(x.folder), (x.tags || []).join(" "),
      (x.attendees || []).map(a => [a.name, a.org, a.role].join(" ")).join(" "),
      (x.decisions || []).map(d => [d.task, d.owner].join(" ")).join(" ")
    ].join(" \n ").toLowerCase();
    return String(q).trim().toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.indexOf(t) >= 0);
  }
  /* 폴더 필터 — "__none__"은 삭제된(없는) 폴더에 속한 회의록 */
  const folderHit = (x) => !view.folder
    || (view.folder === "__none__" ? !folderOf(x.folder) : x.folder === view.folder);
  function filtered() {
    return sorted(visibleAll().filter(x =>
      folderHit(x) &&
      (!view.year || String(x.date || "").slice(0, 4) === view.year) &&
      (!view.status || (x.status || "final") === view.status) &&
      matches(x, view.q)));
  }
  const years = () => Array.from(new Set(visibleAll().map(x => String(x.date || "").slice(0, 4)).filter(Boolean))).sort().reverse();

  /* ══════════ 목록 ══════════ */
  function listHTML() {
    const items = filtered();
    if (!items.length) {
      if (view.q || view.folder || view.year || view.status)
        return '<div class="empty">조건에 맞는 회의록이 없습니다.</div>';
      // 회의록은 있는데 본인에게 보이는 게 없는 경우 — 왜 비었는지 분명히 알린다
      if (all().length && !visibleAll().length) return `<div class="mn-guide">
        <div class="mn-guide-h">🔒 열람 가능한 회의록이 없습니다</div>
        <div class="mn-guide-sub">회의록은 <b>본인이 참석한 회의</b>만 열람할 수 있습니다.</div>
        <div class="mn-guide-steps">
          <div class="mn-gs"><span class="mn-gs-n">1</span><div>
            회의에서 <b>QR로 참석 서명</b>을 하면, 그 회의와 <b>같은 회의체의 다른 회차</b>까지 열람할 수 있게 됩니다
            (부득이 참석하지 못한 직전 회의도 포함).</div></div>
          <div class="mn-gs"><span class="mn-gs-n">2</span><div>
            <b>서명했는데도 보이지 않는다면</b> — 서명한 기기(휴대폰)와 다른 기기로 접속했거나,
            계정 이름이 참석자 명단의 이름과 다른 경우입니다. 서명한 기기에서 다시 접속해 보세요.</div></div>
          <div class="mn-gs"><span class="mn-gs-n">3</span><div>
            그래도 필요하면 <b>항공보안파트</b>에 문의해 주세요. 전체 열람은 항공보안HQ 권한입니다.</div></div>
        </div>
      </div>`;
      // 첫 사용자를 위한 사용법 안내 — 서명 흐름이 어디에 있는지 여기서 알려준다
      return `<div class="mn-guide">
        <div class="mn-guide-h">🗒️ 아직 등록된 회의록이 없습니다</div>
        <div class="mn-guide-sub">회의 시작 전에 회의록을 하나 열어두고, 참석자에게는 QR만 보여주면 됩니다.</div>
        <div class="mn-guide-steps">
          <div class="mn-gs"><span class="mn-gs-n">1</span><div>
            <b>+ 새 회의록</b> — 폴더만 고르면 회차·제목·장소·참석자 명단이 지난 회의에서 자동으로 채워집니다.</div></div>
          <div class="mn-gs"><span class="mn-gs-n">2</span><div>
            <b>✍️ 서명 받기</b> — 회의록을 열면 <b>QR 코드</b>가 나옵니다. 회의실 화면에 크게 띄우거나 안내문으로 인쇄해 두세요.</div></div>
          <div class="mn-gs"><span class="mn-gs-n">3</span><div>
            참석자는 <b>휴대폰 카메라로 QR을 비추기만</b> 하면 됩니다. 암호 입력 없이 서명 화면이 열리고, 서명 현황이 실시간으로 표시됩니다.</div></div>
          <div class="mn-gs"><span class="mn-gs-n">4</span><div>
            논의 내용과 결정사항을 적고 <b>확정</b>하면, A4 회의록으로 바로 인쇄됩니다.</div></div>
        </div>
        ${canWrite() ? '<button class="btn btn-primary" id="mn-guide-add">+ 첫 회의록 만들기</button>' : ""}
      </div>`;
    }
    return `<div class="table-wrap"><table class="tbl mn-list-tbl tbl-cap" style="--cap:1420px"><thead><tr>
        <th style="width:150px">분류</th>
        <th style="width:112px">회의일</th>
        <th>제목<span class="col-sub"> / 장소</span></th>
        <th class="col-ext" style="width:120px">장소</th>
        <th class="col-ext" style="width:96px">주재</th>
        <th style="width:104px">참석 · 서명</th>
        <th style="width:96px">서명 받기</th>
        <th style="width:104px">결정</th>
        <th style="width:66px">첨부</th>
        <th class="col-ext" style="width:110px">작성</th></tr></thead><tbody>
      ${items.map(x => {
        const att = (x.attendees || []).length;
        const signed = (x.attendees || []).filter(a => a.sign).length;
        const dec = (x.decisions || []);
        const openN = dec.filter(d => !d.done).length;
        return `<tr data-mn-row="${esc(x.id)}" style="cursor:pointer">
          <td><span class="mn-fchip">${esc(folderIcon(x.folder))} ${esc(folderName(x.folder))}</span></td>
          <td style="font-size:.86rem;white-space:nowrap">${x.date ? esc(x.date) : '<span style="color:var(--text-3)">미정</span>'}
            ${x.time ? `<div style="font-size:.74rem;color:var(--text-3)">${esc(x.time)}</div>` : ""}</td>
          <td><b>${esc(x.title || "(제목 없음)")}</b>
            ${x.status === "draft" ? ' <span class="badge badge-orange" style="font-size:.66rem">초안</span>' : ""}
            <div class="col-sub" style="font-size:.76rem;color:var(--text-3)">📍 ${esc(x.place || "-")}</div>
            ${(x.tags || []).length ? `<div class="mn-tags">${(x.tags || []).map(t => `<span class="mn-tag">#${esc(t)}</span>`).join("")}</div>` : ""}</td>
          <td class="col-ext" style="font-size:.82rem">${esc(x.place || "-")}</td>
          <td class="col-ext" style="font-size:.82rem">${esc(x.chair || "-")}</td>
          <td style="font-size:.82rem">${att
            ? `${att}명<div class="mn-signpill${signed && signed === att ? " ok" : (signed ? " part" : "")}">✍ ${signed}/${att}</div>`
            : '<span style="color:var(--text-3)">-</span>'}</td>
          <td>${canWrite()
            ? `<button class="btn btn-ghost btn-sm mn-signbtn" data-mn-sign="${esc(x.id)}" title="QR 서명 화면 띄우기">✍️ QR</button>`
            : "-"}</td>
          <td style="font-size:.82rem">${dec.length
            ? `${dec.length}건${openN ? `<div style="font-size:.72rem;color:var(--warning)">미완 ${openN}</div>` : '<div style="font-size:.72rem;color:var(--success)">완료</div>'}`
            : "-"}</td>
          <td style="font-size:.82rem">${(x.files || []).length ? `📎 ${(x.files || []).length}` : "-"}</td>
          <td class="col-ext" style="font-size:.78rem;color:var(--text-3)">${esc(x.by || "-")}
            ${x.updated ? `<div style="font-size:.72rem">${esc(String(x.updated).slice(0, 10))}</div>` : ""}</td>
        </tr>`; }).join("")}</tbody></table></div>`;
  }

  /* ══════════ 결정사항 추적 (전체 회의 통합) ══════════ */
  function actionsHTML() {
    const rows = [];
    sorted(visibleAll()).forEach(x => (x.decisions || []).forEach((d, i) => {
      if (folderHit(x)) rows.push({ x, d, i });
    }));
    const open = rows.filter(r => !r.d.done);
    const done = rows.filter(r => r.d.done);
    if (!rows.length) return '<div class="empty">등록된 결정사항이 없습니다.</div>';
    const t = todayStr();
    const rowHTML = (r) => {
      const late = !r.d.done && r.d.due && r.d.due < t;
      return `<tr data-mn-act="${esc(r.x.id)}" style="cursor:pointer" class="${r.d.done ? "cn-act-done" : ""}">
        <td style="text-align:center">${r.d.done ? "✅" : (late ? "⚠️" : "⬜")}</td>
        <td>${nl2br(r.d.task)}</td>
        <td style="font-size:.82rem">${esc(r.d.owner || "-")}</td>
        <td style="font-size:.82rem;white-space:nowrap;${late ? "color:var(--danger);font-weight:700" : ""}">${esc(r.d.due || "-")}</td>
        <td style="font-size:.8rem;color:var(--text-3)">${esc(folderIcon(r.x.folder))} ${esc(r.x.title || "")}<div>${esc(r.x.date || "")}</div></td></tr>`;
    };
    return `<div class="table-wrap"><table class="tbl cn-act-tbl"><thead><tr>
        <th style="width:44px"></th><th>결정 / 조치 사항</th>
        <th style="width:96px">담당</th><th style="width:104px">기한</th>
        <th style="width:230px">회의</th></tr></thead><tbody>
      ${open.map(rowHTML).join("")}${done.map(rowHTML).join("")}
      </tbody></table></div>
      <div class="form-hint" style="margin-top:8px">미완료 ${open.length}건 · 완료 ${done.length}건 — 행을 누르면 해당 회의록이 열립니다.</div>`;
  }

  /* ══════════ 서명 코드 · QR ══════════ */
  const signCode = (x) => SeMIS.signCodeFor(x);
  const signUrl = (x) => SeMIS.signUrlFor(x);
  function qrSvg(text, px) {
    if (!window.SemisQR) return "";
    try { return SemisQR.svg(text, { size: px || 150, ecc: "M", margin: 3 }); }
    catch (e) { return ""; }
  }
  /* 상세용 QR 안내 박스 — 박스 전체가 [서명 받기] 진입점 */
  function signBoxHTML(x, opts) {
    const o = opts || {};
    const url = signUrl(x), code = signCode(x);
    const qr = qrSvg(url, o.qrSize || 132);
    const att = x.attendees || [];
    const signed = att.filter(a => a.sign).length;
    return `<div class="mn-signbox">
      <div class="mn-qr">${qr || '<div class="mn-qr-na">QR 생성 불가</div>'}</div>
      <div class="mn-signbox-body">
        <div class="mn-signbox-h">📱 참석자 서명 받기
          <span class="mn-sign-stat${att.length && signed === att.length ? " ok" : ""}">${signed}/${att.length}명 서명 완료</span></div>
        <ol class="mn-signbox-steps">
          <li>휴대폰 카메라로 <b>왼쪽 QR</b>을 비추면 서명 화면이 바로 열립니다.</li>
          <li>QR이 안 될 때는 <b>semis.pe.kr</b> 접속 후 암호 <b class="cn-signcode-code">${esc(code)}</b> 입력.</li>
          <li>명단에서 본인 이름을 눌러 서명 (명단에 없으면 직접 입력).</li>
        </ol>
        ${o.noBtn ? "" : `<div class="mn-signbox-act">
          <button class="btn btn-primary btn-sm" id="mn-signbig">🔍 QR 크게 띄우기</button>
          <span class="cn-signcode-copy" data-copy="${esc(code)}" title="코드 복사">📋 코드 복사</span>
          <span class="cn-signcode-copy" data-copy="${esc(url)}" data-copy-label="접속 주소" title="주소 복사">🔗 주소 복사</span>
          <button class="btn btn-ghost btn-sm" id="mn-qr-print">🖨 안내문 인쇄</button>
        </div>`}
      </div></div>`;
  }

  /* ══════════ 서명 받기 화면 (대형 QR) ══════════
     회의실 화면·빔프로젝터에 띄워 두면 참석자들이 각자 스캔해서 서명한다.
     서명이 들어오는 대로 현황이 자동으로 갱신된다(공용 DB 실시간 동기화 → 3초 폴링 재렌더). */
  let signTimer = null;
  function signModal(id) {
    const x = all().find(c => c.id === id);
    if (!x) { toast("회의록을 찾을 수 없습니다.", true); return; }
    if (!canWrite() || !canSeeRec(x)) { toast("서명 화면을 열 권한이 없습니다.", true); return; }
    const url = signUrl(x), code = signCode(x);

    openModal(`<div class="mn-signview" id="mn-signview"></div>`, { wide: true });
    paint();
    if (signTimer) clearInterval(signTimer);
    signTimer = setInterval(() => {
      // 모달이 닫혔으면 타이머 정리
      if (!document.getElementById("mn-signview")) { clearInterval(signTimer); signTimer = null; return; }
      paint();
    }, 3000);

    function paint() {
      const cur = all().find(c => c.id === id) || x;
      const att = cur.attendees || [];
      const signed = att.filter(a => a.sign).length;
      const done = att.length > 0 && signed === att.length;
      const box = document.getElementById("mn-signview");
      if (!box) return;
      box.innerHTML = `
        <h3>✍️ 참석자 서명 받기</h3>
        <div class="mn-sv-sub">${esc(folderIcon(cur.folder))} ${esc(cur.title || "회의")}
          · ${esc(cur.date || "")}${cur.time ? " " + esc(cur.time) : ""}${cur.place ? " · " + esc(cur.place) : ""}</div>
        <div class="mn-sv-grid">
          <div class="mn-sv-left">
            <div class="mn-sv-qr">${qrSvg(url, 300) || '<div class="mn-qr-na">QR 생성 불가</div>'}</div>
            <div class="mn-sv-codelabel">QR이 안 될 때 · semis.pe.kr 접속 후 입력</div>
            <div class="mn-sv-code">${esc(code)}</div>
            <div class="mn-sv-url">${esc(url)}</div>
          </div>
          <div class="mn-sv-right">
            <div class="mn-sv-progress${done ? " done" : ""}">
              <span class="mn-sv-pnum">${signed}<span class="mn-sv-pof"> / ${att.length}</span></span>
              <span class="mn-sv-plabel">${done ? "전원 서명 완료 ✅" : "명 서명 완료"}</span>
              <div class="mn-sv-bar"><i style="width:${att.length ? Math.round(signed / att.length * 100) : 0}%"></i></div>
            </div>
            <div class="mn-sv-list">
              ${att.length ? att.map(a => `
                <div class="mn-sv-item${a.sign ? " ok" : ""}">
                  <span class="mn-sv-mark">${a.sign ? "✅" : "⬜"}</span>
                  <span class="mn-sv-who"><b>${esc(a.name || "(이름 없음)")}</b>
                    <span>${esc(a.org || "")}${a.role ? " · " + esc(a.role) : ""}</span></span>
                  ${a.sign ? `<img class="cn-sign-thumb" src="${esc(a.sign)}" alt="서명">` : '<span class="mn-sv-wait">대기</span>'}
                </div>`).join("")
                : `<div class="mn-sv-empty">등록된 참석자가 없습니다.<br>
                     참석자가 QR로 접속해 <b>직접 입력 후 서명</b>하면 명단에 자동으로 추가됩니다.</div>`}
            </div>
            <div class="mn-sv-hint">① 휴대폰 카메라로 QR 비추기 → ② 뜨는 링크 누르기 → ③ 본인 이름 눌러 서명<br>
              서명이 들어오면 이 화면이 자동으로 갱신됩니다.</div>
          </div>
        </div>
        <div class="modal-actions">
          <span class="cn-signcode-copy" data-copy="${esc(code)}" title="코드 복사" style="margin-right:auto">📋 코드 복사</span>
          <span class="cn-signcode-copy" data-copy="${esc(url)}" data-copy-label="접속 주소" title="주소 복사">🔗 주소 복사</span>
          <button class="btn btn-ghost" id="mn-sv-print">🖨 안내문 인쇄</button>
          <button class="btn btn-primary" id="mn-sv-close">닫기</button>
        </div>`;
      wireCopies("#mn-signview");
      const pb = document.getElementById("mn-sv-print");
      if (pb) pb.onclick = () => printQrSheet(id);
      const cb = document.getElementById("mn-sv-close");
      if (cb) cb.onclick = () => {
        if (signTimer) { clearInterval(signTimer); signTimer = null; }
        closeModal(); SeMIS.renderView();
      };
    }
  }

  /* ══════════ 모듈 렌더 ══════════ */
  SeMIS.registerModule("minutes", {
    title: "회의록 게시판",
    render(root) {
      const u = SeMIS.user;
      if (u && u.role === "signer" && u.signMinuteId) { renderSigning(root, u.signMinuteId); return; }

      const s = stats();
      const vis = visibleAll();
      const counts = {};
      vis.forEach(x => { counts[x.folder] = (counts[x.folder] || 0) + 1; });
      // hq 이상은 전체 폴더, 그 외는 본인이 열람 가능한 폴더만 노출
      const fs = rank() >= 3 ? folders() : folders().filter(f => counts[f.id]);

      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🗒️ 회의록 게시판</div>
          <span class="spacer"></span>
          ${canManageFolders() ? '<button class="btn btn-ghost" id="mn-folders">🗂 폴더 관리</button>' : ""}
          ${canWrite() ? '<button class="btn btn-primary" id="mn-add">+ 새 회의록</button>' : ""}
          <div class="page-desc">회의마다 빈 회의록을 열어 바로 기록 — 폴더 분류 · 참석자 QR 서명 · A4 인쇄
            ${rank() >= 3 ? "" : " · <b>본인이 참석한 회의</b>만 표시됩니다"}</div>
        </div>

        <div class="stat-row">
          <div class="stat"><div class="stat-label">전체 회의록</div><div class="stat-value">${s.total}</div><div class="stat-sub">누적 기록</div></div>
          <div class="stat"><div class="stat-label">${s.yr}년</div><div class="stat-value" style="color:var(--primary)">${s.thisYear}</div><div class="stat-sub">이번 달 ${s.thisMonth}건</div></div>
          <div class="stat"><div class="stat-label">미완료 결정</div><div class="stat-value" style="color:${s.open ? "var(--warning)" : "var(--success)"}">${s.open}</div><div class="stat-sub">${s.overdue ? "기한 초과 " + s.overdue + "건" : "기한 초과 없음"}</div></div>
          <div class="stat"><div class="stat-label">작성 중(초안)</div><div class="stat-value" style="color:${s.draft ? "var(--accent)" : "var(--text-3)"}">${s.draft}</div><div class="stat-sub">확정 전 회의록</div></div>
        </div>

        <div class="mn-wrap">
          <aside class="mn-side">
            <div class="mn-side-h">🗂 분류 폴더</div>
            <button class="mn-fitem${view.folder ? "" : " active"}" data-fid="">
              <span class="mn-fi-ico">📚</span><span class="mn-fi-name">전체 회의록</span><span class="mn-fi-n">${vis.length}</span></button>
            ${fs.map(f => `<button class="mn-fitem${view.folder === f.id ? " active" : ""}" data-fid="${esc(f.id)}" title="${esc(f.desc || f.name)}">
              <span class="mn-fi-ico">${esc(f.icon || "🗒")}</span><span class="mn-fi-name">${esc(f.name)}</span><span class="mn-fi-n">${counts[f.id] || 0}</span></button>`).join("")}
            ${Object.keys(counts).some(k => !folderOf(k)) ? `<button class="mn-fitem${view.folder === "__none__" ? " active" : ""}" data-fid="__none__">
              <span class="mn-fi-ico">❔</span><span class="mn-fi-name">미분류</span><span class="mn-fi-n">${vis.filter(x => !folderOf(x.folder)).length}</span></button>` : ""}
          </aside>

          <section class="mn-main card">
            <div class="mn-toolbar">
              <div class="mn-tabs">
                <button class="mn-tab${view.tab === "list" ? " active" : ""}" data-mn-tab="list">📄 회의록 목록</button>
                <button class="mn-tab${view.tab === "act" ? " active" : ""}" data-mn-tab="act">✅ 결정사항 추적${s.open ? ` <span class="mn-tab-n">${s.open}</span>` : ""}</button>
              </div>
              <span class="spacer"></span>
              <div class="mn-search"><span class="mn-search-ico">🔍</span>
                <input id="mn-q" type="search" value="${esc(view.q)}" placeholder="제목 · 본문 · 참석자 · 결정사항 · 태그 검색" aria-label="회의록 검색"></div>
              <select id="mn-year" aria-label="연도 필터"><option value="">전체 연도</option>
                ${years().map(y => `<option value="${esc(y)}"${view.year === y ? " selected" : ""}>${esc(y)}년</option>`).join("")}</select>
              <select id="mn-status" aria-label="상태 필터"><option value="">전체 상태</option>
                <option value="final"${view.status === "final" ? " selected" : ""}>확정</option>
                <option value="draft"${view.status === "draft" ? " selected" : ""}>초안</option></select>
            </div>
            <div id="mn-body">${view.tab === "act" ? actionsHTML() : listHTML()}</div>
          </section>
        </div>`;

      if (canWrite() && $("#mn-add")) $("#mn-add").onclick = () => newMinute();
      if (canManageFolders() && $("#mn-folders")) $("#mn-folders").onclick = () => folderModal();
      $$(".mn-fitem").forEach(b => b.onclick = () => { view.folder = b.dataset.fid; SeMIS.renderView(); });
      $$("[data-mn-tab]").forEach(b => b.onclick = () => { view.tab = b.dataset.mnTab; SeMIS.renderView(); });

      const q = $("#mn-q");
      if (q) {
        let tm = null;
        q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { view.q = q.value; repaint(); }, 200); };
        q.onkeydown = (e) => { if (e.key === "Escape") { q.value = ""; view.q = ""; repaint(); } };
      }
      if ($("#mn-year")) $("#mn-year").onchange = (e) => { view.year = e.target.value; repaint(); };
      if ($("#mn-status")) $("#mn-status").onchange = (e) => { view.status = e.target.value; repaint(); };
      bindRows();
    }
  });

  /* 목록만 다시 그리기 (검색어 입력 중 포커스 유지) */
  function repaint() {
    const box = $("#mn-body");
    if (!box) { SeMIS.renderView(); return; }
    box.innerHTML = view.tab === "act" ? actionsHTML() : listHTML();
    bindRows();
  }
  function bindRows() {
    $$("#mn-body [data-mn-row]").forEach(el => el.onclick = () => detail(el.dataset.mnRow));
    $$("#mn-body [data-mn-act]").forEach(el => el.onclick = () => detail(el.dataset.mnAct));
    // 목록의 ✍️ QR 버튼 — 행 클릭(상세 열기)과 충돌하지 않도록 전파 차단
    $$("#mn-body [data-mn-sign]").forEach(el => el.onclick = (ev) => {
      ev.stopPropagation(); signModal(el.dataset.mnSign);
    });
    const ga = $("#mn-guide-add");
    if (ga) ga.onclick = () => newMinute();
  }

  /* ══════════ 폴더 관리 ══════════ */
  function folderModal() {
    let list = folders().map(f => Object.assign({}, f));
    const ICONS = ["📋", "🏛", "🏢", "🎓", "🚨", "🗂", "🤝", "✈️", "🛡️", "📊", "🔧", "🪪"];
    openModal(`
      <h3>🗂 회의록 폴더 관리</h3>
      <div class="form-hint" style="margin-bottom:10px">회의체별로 폴더를 만들어 두면 새 회의록 작성 시 장소·주재자가 자동으로 채워집니다.
        폴더를 지워도 안에 있던 회의록은 <b>미분류</b>로 남습니다.</div>
      <div id="mn-fl"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="mn-fadd" style="margin-top:8px">+ 폴더 추가</button>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="mn-fcancel">취소</button>
        <button class="btn btn-primary" id="mn-fsave">저장</button>
      </div>`, { wide: true });

    function collect() {
      $$("#mn-fl .mn-frow").forEach((row, i) => {
        list[i].icon = row.querySelector(".mn-f-icon").value;
        list[i].name = row.querySelector(".mn-f-name").value;
        list[i].desc = row.querySelector(".mn-f-desc").value;
        list[i].place = row.querySelector(".mn-f-place").value;
        list[i].chair = row.querySelector(".mn-f-chair").value;
      });
    }
    function paint() {
      $("#mn-fl").innerHTML = list.map((f, i) => `
        <div class="mn-frow">
          <select class="mn-f-icon">${ICONS.concat(ICONS.indexOf(f.icon) < 0 && f.icon ? [f.icon] : [])
            .map(ic => `<option${ic === f.icon ? " selected" : ""}>${ic}</option>`).join("")}</select>
          <input class="mn-f-name" value="${esc(f.name || "")}" maxlength="40" placeholder="폴더 이름 *">
          <input class="mn-f-desc" value="${esc(f.desc || "")}" maxlength="60" placeholder="설명 (선택)">
          <input class="mn-f-place" value="${esc(f.place || "")}" maxlength="40" placeholder="기본 장소">
          <input class="mn-f-chair" value="${esc(f.chair || "")}" maxlength="24" placeholder="기본 주재">
          <div class="mn-frow-btns">
            <button type="button" class="mt-btn" data-fup="${i}" title="위로"${i === 0 ? " disabled" : ""}>▲</button>
            <button type="button" class="mt-btn" data-fdn="${i}" title="아래로"${i === list.length - 1 ? " disabled" : ""}>▼</button>
            <button type="button" class="mt-btn danger" data-fdel="${i}" title="삭제">✕</button>
          </div>
        </div>`).join("") || '<span class="form-hint">폴더가 없습니다. 아래 버튼으로 추가하세요.</span>';
      $$("#mn-fl [data-fdel]").forEach(b => b.onclick = () => {
        collect();
        const i = Number(b.dataset.fdel);
        const f = list[i];
        const n = all().filter(x => x.folder === f.id).length;
        list.splice(i, 1); paint();
        // 저장 전이므로 [취소]로 되돌릴 수 있음 — 확인 모달 대신 안내만
        if (n) toast(`"${f.name}" 폴더 제거 — 저장하면 회의록 ${n}건이 미분류가 됩니다.`, true);
      });
      $$("#mn-fl [data-fup]").forEach(b => b.onclick = () => {
        collect(); const i = Number(b.dataset.fup);
        if (i > 0) { const t = list[i - 1]; list[i - 1] = list[i]; list[i] = t; }
        paint();
      });
      $$("#mn-fl [data-fdn]").forEach(b => b.onclick = () => {
        collect(); const i = Number(b.dataset.fdn);
        if (i < list.length - 1) { const t = list[i + 1]; list[i + 1] = list[i]; list[i] = t; }
        paint();
      });
    }
    paint();
    $("#mn-fadd").onclick = () => { collect(); list.push({ id: uid("mf"), icon: "🗒", name: "", desc: "", place: "", chair: "", seq: list.length + 1 }); paint(); };
    $("#mn-fcancel").onclick = () => { closeModal(); SeMIS.renderView(); };
    $("#mn-fsave").onclick = () => {
      collect();
      const clean = list.filter(f => String(f.name || "").trim());
      D().minuteFolders = clean.map((f, i) => ({
        id: f.id || uid("mf"), seq: i + 1, icon: f.icon || "🗒",
        name: String(f.name).trim(), desc: String(f.desc || "").trim(),
        place: String(f.place || "").trim(), chair: String(f.chair || "").trim()
      }));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("폴더가 저장되었습니다.");
    };
  }

  /* ══════════ 새 회의록 — 폴더 선택 + 자동 채움 안내 ══════════ */
  function newMinute() {
    const fs = folders();
    if (!fs.length) { toast("먼저 폴더를 만들어 주세요.", true); if (canManageFolders()) folderModal(); return; }
    const defFolder = view.folder && folderOf(view.folder) ? view.folder : fs[0].id;
    openModal(`
      <h3>🗒️ 새 회의록 만들기</h3>
      <div class="form-hint" style="margin-bottom:10px">폴더를 고르면 <b>회차·제목·장소·주재자·참석자 명단·전차 미결사항</b>이
        직전 회의 기록에서 자동으로 채워집니다. 회의 중에는 논의 내용만 적으면 됩니다.</div>
      <div class="form-row"><label>회의 분류 (폴더)</label>
        <select id="mn-nf">${fs.map(f => `<option value="${esc(f.id)}"${f.id === defFolder ? " selected" : ""}>${esc(f.icon || "🗒")} ${esc(f.name)}</option>`).join("")}</select></div>
      <div class="form-row"><label>회의일</label><input id="mn-nd" type="date" value="${todayStr()}"></div>
      <div class="mn-preview" id="mn-np"></div>
      <label class="mn-chk"><input type="checkbox" id="mn-ninherit" checked> 직전 회의 참석자 명단 이어받기 (서명은 초기화)</label>
      <label class="mn-chk"><input type="checkbox" id="mn-ncarry" checked> 직전 회의 미완료 결정사항 이월</label>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="mn-ncancel">취소</button>
        <button class="btn btn-primary" id="mn-ngo">회의록 열기</button>
      </div>`);
    const preview = () => {
      const fid = $("#mn-nf").value;
      const f = folderOf(fid), p = prevMeeting(fid);
      const openN = p ? (p.decisions || []).filter(d => !d.done).length : 0;
      $("#mn-np").innerHTML = `
        <div class="mn-preview-h">자동으로 채워질 내용</div>
        <div><b>회차</b> 제${nextNo(fid)}차</div>
        <div><b>제목</b> ${esc((f && f.name) || "회의")} 제${nextNo(fid)}차 회의</div>
        <div><b>장소</b> ${esc((p && p.place) || (f && f.place) || "— (직접 입력)")}</div>
        <div><b>주재</b> ${esc((p && p.chair) || (f && f.chair) || "— (직접 입력)")}</div>
        <div><b>참석자</b> ${p && (p.attendees || []).length ? "직전 회의 " + (p.attendees || []).length + "명" : "— (없음)"}</div>
        <div><b>전차 미결</b> ${openN ? openN + "건 이월" : "없음"}</div>
        <div class="form-hint" style="margin-top:4px">${p ? "기준 회의: " + esc(p.title || "") + " (" + esc(p.date || "") + ")" : "이 폴더의 첫 회의입니다."}</div>`;
    };
    preview();
    $("#mn-nf").onchange = preview;
    $("#mn-ncancel").onclick = () => { closeModal(); SeMIS.renderView(); };
    $("#mn-ngo").onclick = () => {
      const fid = $("#mn-nf").value, date = $("#mn-nd").value || todayStr();
      const inherit = $("#mn-ninherit").checked, carry = $("#mn-ncarry").checked;
      closeModal();
      form(null, { folder: fid, date, inherit, carry });
    };
  }

  /* 신규 회의록의 초기값 — 폴더 기본값 + 직전 회의 승계 */
  function draftFrom(opt) {
    const fid = opt.folder;
    const f = folderOf(fid), p = prevMeeting(fid);
    const no = nextNo(fid);
    const carried = (opt.carry && p)
      ? (p.decisions || []).filter(d => !d.done).map(d => ({ task: d.task, owner: d.owner || "", due: d.due || "", done: false, from: p.title || "" }))
      : [];
    return {
      folder: fid, no, date: opt.date || todayStr(),
      title: ((f && f.name) || "회의") + " 제" + no + "차 회의",
      time: (p && p.time) || "",
      place: (p && p.place) || (f && f.place) || "",
      chair: (p && p.chair) || (f && f.chair) || "",
      scribe: (SeMIS.user && SeMIS.user.name) || "",
      attendees: (opt.inherit && p)
        ? (p.attendees || []).map(a => ({ name: a.name || "", org: a.org || "", role: a.role || "", note: "", sign: "" }))
        : [],
      absent: "", agenda: "", agendaHtml: "", body: "", bodyHtml: "",
      decisions: carried, tags: [], files: [],
      nextDate: "", nextTime: "", nextPlace: "", nextPlan: "", linkCal: false,
      status: "draft"
    };
  }

  /* ══════════ 차기 회의 → 일정관리 연동 ══════════ */
  const SID = (id) => "mn_" + id;                   // 연동 일정 id (원본은 회의록)
  function syncCalendar(x) {
    if (!Array.isArray(D().schedules)) D().schedules = [];
    const sid = SID(x.id);
    const idx = D().schedules.findIndex(s => s && s.id === sid);
    if (!x.linkCal || !x.nextDate) { if (idx >= 0) D().schedules.splice(idx, 1); return; }
    const rec = {
      id: sid,
      title: "[회의] " + (folderName(x.folder) || "회의") + " 제" + ((Number(x.no) || 0) + 1) + "차",
      memo: [x.nextPlan, x.nextPlace ? "장소: " + x.nextPlace : ""].filter(Boolean).join("\n"),
      start: x.nextDate, end: x.nextDate,
      allDay: !x.nextTime, time: x.nextTime || "", timeEnd: "",
      color: "#0ea5e9", done: false,
      assignee: x.chair || "", vehicle: false, room: true,
      reminders: ["1d"], repeat: { freq: "none", until: "" },
      doneFrom: "", doneDates: [], undoneDates: []
    };
    if (idx >= 0) Object.assign(D().schedules[idx], rec);
    else D().schedules.push(rec);
  }
  function removeCalendar(id) {
    if (!Array.isArray(D().schedules)) return;
    D().schedules = D().schedules.filter(s => !s || s.id !== SID(id));
  }

  /* ══════════ 상세 (읽기) ══════════ */
  function detail(id) {
    const x = all().find(c => c.id === id);
    if (!x) return;
    if (!canSeeRec(x)) { toast("본인이 참석한 회의의 회의록만 열람할 수 있습니다.", true); return; }
    const att = x.attendees || [];
    const dec = x.decisions || [];
    const signed = att.filter(a => a.sign).length;
    const sec = (title, body) => body ? `<div class="cn-sec"><div class="cn-sec-h">${title}</div>${body}</div>` : "";
    const t = todayStr();

    /* 직책 폭은 협의회 표와 동일 기준(5~7자 한 줄) — 셀 패딩 24px 감안 118px */
    const attHTML = att.length ? `<table class="tbl cn-att-tbl"><thead><tr>
        <th style="width:34px">No</th><th style="width:90px">성명</th><th>소속</th>
        <th style="width:118px">직책</th><th style="width:104px">서명</th><th style="width:110px">비고</th></tr></thead><tbody>
      ${att.map((a, i) => `<tr>
        <td style="text-align:center;color:var(--text-3)">${i + 1}</td>
        <td><b>${esc(a.name || "-")}</b></td><td>${esc(a.org || "-")}</td><td class="cn-a-role">${esc(a.role || "-")}</td>
        <td style="text-align:center">${a.sign ? `<img class="cn-sign-img" src="${esc(a.sign)}" alt="서명">` : '<span style="color:var(--text-3)">-</span>'}</td>
        <td>${a.note ? esc(a.note) : "-"}</td></tr>`).join("")}
      </tbody></table>
      <div class="form-hint" style="margin-top:6px">참석 ${att.length}명 · 서명 완료 ${signed}명${x.absent ? " · 불참: " + esc(x.absent) : ""}</div>` : "";

    const decHTML = dec.length ? `<table class="tbl cn-act-tbl"><thead><tr>
        <th style="width:40px"></th><th>결정 / 조치 사항</th><th style="width:92px">담당</th><th style="width:100px">기한</th></tr></thead><tbody>
      ${dec.map(a => {
        const late = !a.done && a.due && a.due < t;
        return `<tr class="${a.done ? "cn-act-done" : ""}">
          <td style="text-align:center">${a.done ? "✅" : (late ? "⚠️" : "⬜")}</td>
          <td>${nl2br(a.task)}${a.from ? `<div class="mn-carry-from">↩ 이월: ${esc(a.from)}</div>` : ""}</td>
          <td>${esc(a.owner || "-")}</td>
          <td style="${late ? "color:var(--danger);font-weight:700" : ""}">${esc(a.due || "-")}</td></tr>`;
      }).join("")}</tbody></table>` : "";

    const nextHTML = (x.nextDate || x.nextPlan) ? `<div class="mn-next">
        ${x.nextDate ? `<b>📅 ${esc(x.nextDate)}</b>${x.nextTime ? " " + esc(x.nextTime) : ""}` : ""}
        ${x.nextPlace ? ` · 📍 ${esc(x.nextPlace)}` : ""}
        ${x.linkCal && x.nextDate ? ' <span class="badge badge-blue" style="font-size:.68rem">일정관리 등록됨</span>' : ""}
        ${x.nextPlan ? `<div class="cn-text" style="margin-top:6px">${nl2br(x.nextPlan)}</div>` : ""}</div>` : "";

    openModal(`
     <div class="cn-view mn-view">
      <h3>${esc(folderIcon(x.folder))} ${esc(x.title || "(제목 없음)")}
        ${x.status === "draft" ? '<span class="badge badge-orange">초안</span>' : '<span class="badge badge-green">확정</span>'}</h3>
      <div class="cn-meta">
        <span class="mn-fchip">${esc(folderIcon(x.folder))} ${esc(folderName(x.folder))}</span>
        <span>📅 <b>${esc(x.date || "미정")}</b>${x.time ? " " + esc(x.time) : ""}</span>
        <span>📍 ${esc(x.place || "-")}</span>
        ${x.chair ? `<span>🧑‍💼 주재 ${esc(x.chair)}</span>` : ""}
        ${x.scribe ? `<span>✍️ 작성 ${esc(x.scribe)}</span>` : ""}
        <span>👥 참석 ${att.length}명</span>
        ${x.no ? `<span>🔢 제${esc(String(x.no))}차</span>` : ""}
      </div>
      ${(x.tags || []).length ? `<div class="mn-tags" style="margin-top:6px">${(x.tags || []).map(tg => `<span class="mn-tag">#${esc(tg)}</span>`).join("")}</div>` : ""}
      ${canWrite() ? signBoxHTML(x) : ""}
      ${sec("참석자", attHTML || `<div class="mn-att-none">아직 등록된 참석자가 없습니다.
        ${canWrite() ? '위 <b>QR 크게 띄우기</b>로 참석자에게 QR을 보여주면, 각자 서명하면서 명단에 자동으로 등록됩니다.' : ""}</div>`)}
      ${sec("안건", richView(x.agendaHtml, x.agenda))}
      ${sec("논의 내용", richView(x.bodyHtml, x.body))}
      ${sec("결정사항 / 조치사항", decHTML)}
      ${sec("차기 회의", nextHTML)}
      ${(x.files || []).length ? `<div class="cn-sec"><div class="cn-sec-h">첨부파일 (${(x.files || []).length})</div>
        <div class="nb-files-view br-files-scroll">${(x.files || []).map(f =>
          `<a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">📄 ${esc(f.name)}</a>`).join("")}</div></div>` : ""}
      ${x.updated ? `<div class="form-hint" style="margin-top:10px">최종 수정 ${esc(String(x.updated).slice(0, 10))}${x.by ? " · " + esc(x.by) : ""}</div>` : ""}
      <div class="modal-actions">
        ${canDelRec(x) ? '<button class="btn btn-danger" id="mn-del" style="margin-right:auto">삭제</button>' : ""}
        ${canWrite() ? '<button class="btn btn-accent" id="mn-signbig2">✍️ 서명 받기</button>' : ""}
        <button class="btn btn-ghost" id="mn-print">🖨 회의록 인쇄</button>
        ${canEditRec(x) ? '<button class="btn btn-ghost" id="mn-edit">✎ 수정</button>' : ""}
        <button class="btn btn-primary" id="mn-close">닫기</button>
      </div>
     </div>`, { wide: true });

    $("#mn-close").onclick = () => { closeModal(); SeMIS.renderView(); };
    $("#mn-print").onclick = () => printMinute(x.id);
    if ($("#mn-qr-print")) $("#mn-qr-print").onclick = () => printQrSheet(x.id);
    if ($("#mn-signbig")) $("#mn-signbig").onclick = () => signModal(x.id);
    if ($("#mn-signbig2")) $("#mn-signbig2").onclick = () => signModal(x.id);
    wireCopies("#modal-box");
    $$("#modal-box .cn-rich a[href]").forEach(a => { a.target = "_blank"; a.rel = "noopener"; });
    if (canEditRec(x)) $("#mn-edit").onclick = () => form(x.id);
    if (canDelRec(x) && $("#mn-del")) $("#mn-del").onclick = () => confirmModal(`"${x.title || "회의록"}"을(를) 삭제하시겠습니까?`, () => {
      removeCalendar(x.id);
      D().minutes = all().filter(c => c.id !== x.id);
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
    });
  }

  /* ══════════ 등록 / 수정 폼 ══════════ */
  function form(id, init) {
    const x = id ? all().find(c => c.id === id) : null;
    const base = x || draftFrom(init || { folder: (folders()[0] || {}).id, date: todayStr(), inherit: true, carry: true });
    let attendees = (base.attendees || []).map(a => Object.assign({}, a));
    let decisions = (base.decisions || []).map(a => Object.assign({}, a));
    let files = (base.files || []).map(f => Object.assign({}, f));
    const fs = folders();
    const dir = knownPeople();
    const orgs = orgPresets();

    openModal(`
     <div class="cn-form mn-form">
      <h3>${x ? "회의록 수정" : "회의록 작성"} <span class="badge badge-gray">${esc(folderName(base.folder))}</span></h3>

      <fieldset class="cn-fs"><legend>📋 회의 정보</legend>
        <div class="form-grid">
          <div class="form-row"><label>분류 (폴더)</label>
            <select id="mn-folder">${fs.map(f => `<option value="${esc(f.id)}"${f.id === base.folder ? " selected" : ""}>${esc(f.icon || "🗒")} ${esc(f.name)}</option>`).join("")}
              ${folderOf(base.folder) ? "" : `<option value="${esc(base.folder || "")}" selected>미분류</option>`}</select></div>
          <div class="form-row"><label>회차</label>
            <input id="mn-no" type="number" min="0" max="9999" value="${esc(String(base.no || ""))}" placeholder="자동"></div>
        </div>
        <div class="form-row"><label>제목 *</label>
          <input id="mn-title" value="${esc(base.title || "")}" maxlength="90" placeholder="예: 항공보안파트 제12차 정례회의"></div>
        <div class="form-grid">
          <div class="form-row"><label>회의일 *</label><input id="mn-date" type="date" value="${esc(base.date || "")}"></div>
          <div class="form-row"><label>시간</label>
            <input id="mn-time" value="${esc(base.time || "")}" maxlength="40" placeholder="예: 14:00~15:30"></div>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>장소</label><input id="mn-place" value="${esc(base.place || "")}" maxlength="80"></div>
          <div class="form-row"><label>주재 (의장)</label><input id="mn-chair" value="${esc(base.chair || "")}" maxlength="40"></div>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>작성자 (서기)</label><input id="mn-scribe" value="${esc(base.scribe || "")}" maxlength="40"></div>
          <div class="form-row"><label>태그 (쉼표 구분 · 검색용)</label>
            <input id="mn-tags" value="${esc((base.tags || []).join(", "))}" maxlength="120" placeholder="예: 정례, 출입증, 2026상반기"></div>
        </div>
      </fieldset>

      <fieldset class="cn-fs"><legend>👥 참석자 <span class="mn-legend-sub">— 이름을 입력하면 지난 회의 소속·직책이 자동으로 채워집니다</span></legend>
        <div id="mn-att"></div>
        <div class="mn-att-bar">
          <button type="button" class="btn btn-ghost btn-sm" id="mn-att-add">+ 참석자 추가</button>
          <button type="button" class="btn btn-ghost btn-sm" id="mn-att-prev">↩ 직전 회의 명단 불러오기</button>
          ${x ? '<button type="button" class="btn btn-accent btn-sm" id="mn-att-qr">✍️ QR로 서명 받기</button>'
              : '<span class="form-hint">저장하면 <b>QR 서명</b> 화면이 바로 열립니다.</span>'}
          <span class="form-hint" id="mn-att-n"></span>
        </div>
        <div class="form-row" style="margin-top:10px"><label>불참자 (선택)</label>
          <input id="mn-absent" value="${esc(base.absent || "")}" maxlength="200" placeholder="예: 홍길동 과장(출장)"></div>
        <datalist id="mn-names">${[...dir.values()].map(p =>
          `<option value="${esc(p.name)}">${esc(p.org || "")}${p.role ? " · " + esc(p.role) : ""}</option>`).join("")}</datalist>
        <datalist id="mn-orgs">${orgs.map(o => `<option value="${esc(o)}"></option>`).join("")}</datalist>
      </fieldset>

      <fieldset class="cn-fs"><legend>🗣 안건 및 논의</legend>
        <div class="form-hint" style="margin:0 0 8px">본문에는 링크·이미지를 붙여넣거나 끌어다 놓을 수 있습니다.</div>
        ${richFieldHTML("agenda", "안건", "이번 회의 안건 (한 줄에 하나씩)")}
        ${richFieldHTML("body", "논의 내용", "발언·논의 내용을 기록하세요")}
      </fieldset>

      <fieldset class="cn-fs"><legend>✅ 결정사항 / 차기 회의</legend>
        <div class="form-row"><label>결정 · 조치 사항</label>
          <div id="mn-dec"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="mn-dec-add" style="margin-top:6px">+ 결정사항 추가</button></div>
        <div class="form-grid">
          <div class="form-row"><label>차기 회의일</label><input id="mn-nextd" type="date" value="${esc(base.nextDate || "")}"></div>
          <div class="form-row"><label>차기 시간</label>
            <input id="mn-nextt" value="${esc(base.nextTime || "")}" maxlength="20" placeholder="예: 14:00"></div>
        </div>
        <div class="form-row"><label>차기 장소</label><input id="mn-nextp" value="${esc(base.nextPlace || "")}" maxlength="80"></div>
        <div class="form-row"><label>차기 회의 안건 / 메모</label>
          <input id="mn-next" value="${esc(base.nextPlan || "")}" maxlength="200"></div>
        <label class="mn-chk"><input type="checkbox" id="mn-linkcal"${base.linkCal ? " checked" : ""}> 차기 회의를 <b>일정관리에 자동 등록</b> (1일 전 알림)</label>
      </fieldset>

      <fieldset class="cn-fs"><legend>📎 첨부파일</legend>
        <div class="form-hint" style="margin:0 0 8px">회의자료·사진 등 · 최대 ${MAX_FILES}개 · 각 20MB 이하</div>
        <div id="mn-dropzone" class="br-dropzone">📎 파일을 이곳에 끌어다 놓거나 <u>클릭하여 선택</u>하세요
          <input type="file" id="mn-file" multiple style="display:none"></div>
        <div id="mn-file-box" class="nb-files-view br-files-scroll"></div>
      </fieldset>

      <fieldset class="cn-fs"><legend>📌 상태</legend>
        <div class="mn-status-pick">
          <label class="mn-chk"><input type="radio" name="mn-st" value="draft"${(base.status || "draft") === "draft" ? " checked" : ""}> <b>초안</b> — 회의 중 작성 중 (계속 수정)</label>
          <label class="mn-chk"><input type="radio" name="mn-st" value="final"${base.status === "final" ? " checked" : ""}> <b>확정</b> — 회의록 확정 (열람·인쇄용)</label>
        </div>
      </fieldset>

      <div class="modal-actions">
        ${x && canDelRec(x) ? '<button class="btn btn-danger" id="mn-fdel" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="mn-cancel">취소</button>
        <button class="btn btn-primary" id="mn-save">저장</button>
      </div>
     </div>`, { wide: true });

    wireRich("agenda", base.agendaHtml, base.agenda);
    wireRich("body", base.bodyHtml, base.body);

    /* ─ 참석자 동적행 ─ */
    function attCollect() {
      $$("#mn-att .mn-att-row").forEach((row, i) => {
        if (!attendees[i]) return;
        attendees[i].name = row.querySelector(".mn-a-name").value;
        attendees[i].org = row.querySelector(".mn-a-org").value;
        attendees[i].role = row.querySelector(".mn-a-role").value;
        attendees[i].note = row.querySelector(".mn-a-note").value;
      });
    }
    function attPaint() {
      $("#mn-att").innerHTML = attendees.map((a, i) => `
        <div class="mn-att-row">
          <span class="cn-a-no">${i + 1}</span>
          <input class="mn-a-name" list="mn-names" value="${esc(a.name || "")}" maxlength="30" placeholder="성명">
          <input class="mn-a-org" list="mn-orgs" value="${esc(a.org || "")}" maxlength="40" placeholder="소속">
          <input class="mn-a-role" value="${esc(a.role || "")}" maxlength="24" placeholder="직책">
          <input class="mn-a-note" value="${esc(a.note || "")}" maxlength="40" placeholder="비고 (선택)">
          <span class="mn-a-sign" title="${a.sign ? "서명 완료" : "미서명"}">${a.sign ? "✍️" : "·"}</span>
          <button type="button" class="mt-btn danger" data-att-del="${i}" title="삭제">✕</button>
        </div>`).join("") || '<span class="form-hint">참석자를 추가하거나, 참석자가 QR로 직접 서명하면 자동 등록됩니다.</span>';
      $("#mn-att-n").textContent = attendees.length ? attendees.length + "명" : "";
      $$("#mn-att [data-att-del]").forEach(btn => btn.onclick = () => {
        attCollect(); attendees.splice(Number(btn.dataset.attDel), 1); attPaint();
      });
      // 이름 입력 시 지난 회의 소속·직책 자동 채움 (비어 있을 때만)
      $$("#mn-att .mn-a-name").forEach((el, i) => el.onchange = () => {
        const p = dir.get(String(el.value || "").trim());
        if (!p) return;
        const row = el.closest(".mn-att-row");
        const og = row.querySelector(".mn-a-org"), rl = row.querySelector(".mn-a-role");
        if (og && !og.value.trim()) og.value = p.org || "";
        if (rl && !rl.value.trim()) rl.value = p.role || "";
      });
    }
    attPaint();
    $("#mn-att-add").onclick = () => {
      attCollect();
      if (attendees.length >= MAX_ATT) { toast("참석자는 최대 " + MAX_ATT + "명까지 등록할 수 있습니다.", true); return; }
      attendees.push({ name: "", org: "", role: "", note: "", sign: "" }); attPaint();
      const rows = $$("#mn-att .mn-a-name");
      if (rows.length) rows[rows.length - 1].focus();
    };
    /* 회의 중 작성하다가 바로 QR을 띄우는 경로 — 입력분을 먼저 저장해 명단이 어긋나지 않게 한다 */
    if ($("#mn-att-qr")) $("#mn-att-qr").onclick = () => {
      if (!save({ silent: true })) return;
      signModal(x.id);
    };
    $("#mn-att-prev").onclick = () => {
      attCollect();
      const p = prevMeeting($("#mn-folder").value, x ? x.id : null);
      if (!p || !(p.attendees || []).length) { toast("직전 회의 명단이 없습니다.", true); return; }
      let added = 0;
      (p.attendees || []).forEach(a => {
        const nm = String(a.name || "").trim();
        if (!nm || attendees.some(b => String(b.name || "").trim() === nm)) return;
        if (attendees.length >= MAX_ATT) return;
        attendees.push({ name: nm, org: a.org || "", role: a.role || "", note: "", sign: "" }); added++;
      });
      attPaint();
      toast(added ? `직전 회의(${p.date || ""})에서 ${added}명을 불러왔습니다.` : "새로 추가할 참석자가 없습니다.");
    };

    /* ─ 결정사항 동적행 ─ */
    function decCollect() {
      $$("#mn-dec .mn-dec-row").forEach((row, i) => {
        if (!decisions[i]) return;
        decisions[i].task = row.querySelector(".mn-d-task").value;
        decisions[i].owner = row.querySelector(".mn-d-owner").value;
        decisions[i].due = row.querySelector(".mn-d-due").value;
        decisions[i].done = row.querySelector(".mn-d-done").checked;
      });
    }
    function decPaint() {
      $("#mn-dec").innerHTML = decisions.map((a, i) => `
        <div class="mn-dec-row">
          <label class="cn-t-donebox" title="완료"><input type="checkbox" class="mn-d-done" ${a.done ? "checked" : ""}></label>
          <input class="mn-d-task" value="${esc(a.task || "")}" maxlength="200" placeholder="결정·조치 사항">
          <input class="mn-d-owner" value="${esc(a.owner || "")}" maxlength="24" placeholder="담당">
          <input class="mn-d-due" type="date" value="${esc(a.due || "")}">
          <button type="button" class="mt-btn danger" data-dec-del="${i}" title="삭제">✕</button>
          ${a.from ? `<div class="mn-carry-from">↩ 이월: ${esc(a.from)}</div>` : ""}
        </div>`).join("") || '<span class="form-hint">결정사항·조치사항을 추가하세요.</span>';
      $$("#mn-dec [data-dec-del]").forEach(btn => btn.onclick = () => {
        decCollect(); decisions.splice(Number(btn.dataset.decDel), 1); decPaint();
      });
    }
    decPaint();
    $("#mn-dec-add").onclick = () => { decCollect(); decisions.push({ task: "", owner: "", due: "", done: false }); decPaint(); };

    /* ─ 폴더 변경 시 회차 재계산 (신규 작성일 때만) ─ */
    $("#mn-folder").onchange = () => {
      if (x) return;
      const fid = $("#mn-folder").value, f = folderOf(fid);
      $("#mn-no").value = nextNo(fid);
      const ti = $("#mn-title");
      if (ti) ti.value = ((f && f.name) || "회의") + " 제" + nextNo(fid) + "차 회의";
      const pl = $("#mn-place");
      if (pl && !pl.value.trim() && f && f.place) pl.value = f.place;
      const ch = $("#mn-chair");
      if (ch && !ch.value.trim() && f && f.chair) ch.value = f.chair;
    };

    /* ─ 첨부 ─ */
    function renderFiles() {
      $("#mn-file-box").innerHTML = files.length
        ? files.map((f, i) => `<span class="nb-file"><a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>
            <button type="button" class="mt-btn danger" data-mn-frm="${i}" title="첨부 제거">✕</button></span>`).join("")
          + `<span class="form-hint" style="align-self:center">${files.length}/${MAX_FILES}</span>`
        : '<span class="form-hint">첨부된 파일이 없습니다.</span>';
      $$("#mn-file-box [data-mn-frm]").forEach(btn => btn.onclick = () => {
        files.splice(Number(btn.dataset.mnFrm), 1); renderFiles();
      });
    }
    renderFiles();
    async function addFiles(picked) {
      if (!picked || !picked.length) return;
      if (!window.SemisSync || typeof fetch === "undefined") { toast("오프라인에서는 파일을 첨부할 수 없습니다.", true); return; }
      for (const f of picked) {
        if (files.length >= MAX_FILES) { toast("첨부는 최대 " + MAX_FILES + "개까지 가능합니다.", true); break; }
        if ((f.size || 0) > FILE_MAX) { toast(f.name + ": 20MB를 초과합니다.", true); continue; }
        toast("업로드 중: " + f.name);
        try {
          const up = await SemisSync.uploadFile(f, "minutes");
          files.push({ url: up.url, name: f.name, size: f.size || 0 }); renderFiles();
          toast("업로드되었습니다: " + f.name);
        } catch (err) { toast(f.name + ": 업로드 실패 — 네트워크를 확인하세요.", true); }
      }
    }
    const dz = $("#mn-dropzone"), fi = $("#mn-file");
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

    /* ─ 저장 / 취소 / 삭제 ─ */
    $("#mn-cancel").onclick = () => (x ? detail(x.id) : (closeModal(), SeMIS.renderView()));
    if (x && $("#mn-fdel")) $("#mn-fdel").onclick = () => confirmModal(`"${x.title || "회의록"}"을(를) 삭제하시겠습니까?`, () => {
      removeCalendar(x.id);
      D().minutes = all().filter(c => c.id !== x.id);
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
    });
    /* 저장 — opts.silent 면 모달을 닫지 않고 값만 반영(QR 띄우기 경로). 성공 시 true */
    function save(opts) {
      const o = opts || {};
      attCollect(); decCollect();
      const title = $("#mn-title").value.trim();
      const date = $("#mn-date").value;
      if (!title) { toast("제목을 입력하세요.", true); return false; }
      if (!date) { toast("회의일을 입력하세요.", true); return false; }
      const stEl = $('input[name="mn-st"]:checked');
      const ag = richOut("agenda"), bd = richOut("body");
      const rec = {
        folder: $("#mn-folder").value,
        no: Number($("#mn-no").value) || 0,
        title, date,
        time: $("#mn-time").value.trim(),
        place: $("#mn-place").value.trim(),
        chair: $("#mn-chair").value.trim(),
        scribe: $("#mn-scribe").value.trim(),
        tags: $("#mn-tags").value.split(",").map(s => s.trim()).filter(Boolean).slice(0, 12),
        attendees: attendees.filter(a => String(a.name || "").trim() || String(a.org || "").trim()).map(a => ({
          name: String(a.name || "").trim(), org: String(a.org || "").trim(),
          role: String(a.role || "").trim(), note: String(a.note || "").trim(), sign: a.sign || "" })),
        absent: $("#mn-absent").value.trim(),
        agenda: ag.text, agendaHtml: ag.html,
        body: bd.text, bodyHtml: bd.html,
        decisions: decisions.filter(a => String(a.task || "").trim()).map(a => {
          const o = { task: String(a.task || "").trim(), owner: String(a.owner || "").trim(), due: a.due || "", done: !!a.done };
          if (a.from) o.from = a.from;
          return o;
        }),
        nextDate: $("#mn-nextd").value,
        nextTime: $("#mn-nextt").value.trim(),
        nextPlace: $("#mn-nextp").value.trim(),
        nextPlan: $("#mn-next").value.trim(),
        linkCal: !!$("#mn-linkcal").checked,
        files: files.slice(0, MAX_FILES),
        status: (stEl && stEl.value) === "final" ? "final" : "draft",
        by: (SeMIS.user && SeMIS.user.name) || "",
        byId: (x && x.byId) || me(),
        updated: new Date().toISOString()
      };
      let saved;
      const isNew = !x;
      if (x) { Object.assign(x, rec); saved = x; }
      else { saved = Object.assign({ id: uid("mn"), created: new Date().toISOString() }, rec); D().minutes.push(saved); }
      syncCalendar(saved);
      SeMIS.save();
      if (o.silent) { toast("저장되었습니다."); return true; }
      closeModal();
      if (isNew) {
        // 새 회의록은 상세를 바로 열어 QR 서명 안내가 곧장 눈에 들어오게 한다
        SeMIS.renderView();
        detail(saved.id);
        toast("회의록이 만들어졌습니다. QR을 보여주면 참석자가 바로 서명할 수 있습니다.");
      } else {
        SeMIS.renderView();
        toast(rec.status === "draft" ? "초안으로 저장되었습니다." : "회의록이 확정 저장되었습니다.");
      }
      return true;
    }
    $("#mn-save").onclick = () => save();
  }

  /* ══════════ 인쇄 공통 — 숨김 iframe 으로 인쇄 대화상자 ══════════ */
  function printHTML(html, label) {
    try {
      toast((label || "인쇄 문서") + " 준비 중…");
      const fr = document.createElement("iframe");
      fr.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;border:0;visibility:hidden";
      document.body.appendChild(fr);
      const doc = fr.contentWindow.document;
      doc.open(); doc.write(html); doc.close();
      const fire = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { /* 무시 */ } };
      if (fr.contentWindow.document.readyState === "complete") setTimeout(fire, 300);
      else fr.onload = () => setTimeout(fire, 300);
      setTimeout(() => { try { fr.remove(); } catch (e) { /* 무시 */ } }, 60000);
    } catch (e) { toast("인쇄 대화상자를 열 수 없습니다.", true); }
  }
  const PRINT_CSS = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4 portrait; margin: 14mm 12mm; }
  body { font-family: -apple-system, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif;
    color: #0f172a; font-size: 10.5px; line-height: 1.55; margin: 0; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .doc-head { border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; margin-bottom: 12px; }
  .doc-head .sub { color: #475569; font-size: 10px; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 10px; color: #334155; margin-top: 8px; }
  .meta b { color: #0f172a; }
  .sec { margin: 12px 0; page-break-inside: avoid; }
  .sec-h { font-size: 11px; font-weight: 800; color: #1d4ed8; border-left: 3px solid #1d4ed8;
    padding: 0 0 3px 6px; margin-bottom: 6px; border-bottom: 1px solid #94a3b8; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #94a3b8; padding: 4px 6px; text-align: left; vertical-align: top; font-size: 9.5px; }
  th { background: #eff6ff; color: #1e3a8a; font-weight: 700; border-bottom: 1.5px solid #64748b; text-align: center; }
  table.att, table.dec { table-layout: fixed; }
  table.att td, table.dec td { word-break: break-word; }
  table.att td.role { word-break: keep-all; overflow-wrap: break-word; }
  table.att td img { display: block; margin: 0 auto; max-height: 34px; }
  .ptext { border: 1px solid #94a3b8; border-left: 3px solid #1d4ed8; border-radius: 6px; padding: 8px 10px; background: #fff; }
  .ptext img { max-width: 100%; height: auto; border-radius: 4px; margin: 4px 0; }
  .ptext a { color: #1d4ed8; word-break: break-all; }
  .ptext ul, .ptext ol { margin: 4px 0; padding-left: 18px; }
  .pc-empty { color: #94a3b8; text-align: center; }
  .tagline { font-size: 9px; color: #475569; margin-top: 4px; }
  .foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e2e8f0;
    display: flex; justify-content: space-between; font-size: 8.5px; color: #64748b; }`;

  /* ── A4 회의록 ── */
  function printMinute(id) {
    const x = all().find(c => c.id === id);
    if (!x || !canSeeRec(x)) return;
    const att = x.attendees || [], dec = x.decisions || [];
    const today = new Date().toISOString().slice(0, 10);
    const P = (s) => esc(String(s || "")).replace(/\n/g, "<br>");
    const textSec = (title, html, text) => {
      const inner = html ? sanitize(html) : (text ? P(text) : "");
      return inner ? `<div class="sec"><div class="sec-h">${title}</div><div class="ptext">${inner}</div></div>` : "";
    };
    const attRows = att.length ? att.map((a, i) => `<tr>
        <td style="text-align:center">${i + 1}</td><td>${esc(a.name || "")}</td>
        <td>${esc(a.org || "")}</td><td class="role">${esc(a.role || "")}</td>
        <td>${a.sign ? `<img src="${esc(a.sign)}" style="max-width:70px;max-height:32px">` : ""}</td>
        <td>${esc(a.note || "")}</td></tr>`).join("")
      : '<tr><td colspan="6" class="pc-empty">참석자 기록 없음</td></tr>';
    const decRows = dec.length ? dec.map(a => `<tr>
        <td style="text-align:center">${a.done ? "완료" : "진행"}</td><td>${P(a.task)}</td>
        <td>${esc(a.owner || "")}</td><td>${esc(a.due || "")}</td></tr>`).join("")
      : '<tr><td colspan="4" class="pc-empty">기록 없음</td></tr>';
    const nextTxt = [x.nextDate ? x.nextDate + (x.nextTime ? " " + x.nextTime : "") : "",
      x.nextPlace ? "장소: " + x.nextPlace : "", x.nextPlan].filter(Boolean).join(" · ");

    printHTML(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>${esc(x.title || "회의록")}</title><style>${PRINT_CSS}</style></head><body>
  <div class="doc-head">
    <h1>${esc(x.title || "회의록")}</h1>
    <div class="sub">에어제타 항공보안 · ${esc(folderName(x.folder))}${x.no ? " · 제" + esc(String(x.no)) + "차" : ""}${x.status === "draft" ? " · [초안]" : ""}</div>
    <div class="meta">
      <span>회의일 <b>${esc(x.date || "-")}</b>${x.time ? " " + esc(x.time) : ""}</span>
      <span>장소 <b>${esc(x.place || "-")}</b></span>
      ${x.chair ? `<span>주재 <b>${esc(x.chair)}</b></span>` : ""}
      ${x.scribe ? `<span>작성 <b>${esc(x.scribe)}</b></span>` : ""}
      <span>참석 <b>${att.length}명</b></span>
    </div>
    ${(x.tags || []).length ? `<div class="tagline">태그: ${esc((x.tags || []).join(", "))}</div>` : ""}
  </div>
  <div class="sec"><div class="sec-h">참석자</div>
    <table class="att"><thead><tr><th style="width:26px">No</th><th style="width:70px">성명</th>
      <th style="width:24%">소속</th><th style="width:84px">직책</th>
      <th style="width:80px">서명</th><th>비고</th></tr></thead><tbody>${attRows}</tbody></table>
    ${x.absent ? `<div class="tagline">불참: ${esc(x.absent)}</div>` : ""}</div>
  ${textSec("안건", x.agendaHtml, x.agenda)}
  ${textSec("논의 내용", x.bodyHtml, x.body)}
  <div class="sec"><div class="sec-h">결정사항 / 조치사항</div>
    <table class="dec"><thead><tr><th style="width:44px">상태</th><th>결정·조치 사항</th>
      <th style="width:74px">담당</th><th style="width:80px">기한</th></tr></thead><tbody>${decRows}</tbody></table></div>
  ${nextTxt ? `<div class="sec"><div class="sec-h">차기 회의</div><div class="ptext">${esc(nextTxt)}</div></div>` : ""}
  <div class="foot">
    <span>에어제타 보안종합정보시스템(SeMIS v2) · 회의록 게시판</span>
    <span>출력 ${esc(today)}${SeMIS.user ? " · " + esc(SeMIS.user.name) : ""}</span>
  </div>
</body></html>`, "회의록");
  }

  /* ── QR 안내문 (회의실 게시·배포용) ── */
  function printQrSheet(id, opts) {
    const o = opts || {};
    const x = o.rec || all().find(c => c.id === id);
    if (!x) return;
    if (!o.rec && !canSeeRec(x)) return;   // 회의록 게시판 경로만 검사 (o.rec = 협의회 등 외부 호출)
    const url = o.url || signUrl(x), code = o.code || signCode(x);
    const qr = qrSvg(url, 420);
    const title = o.title || x.title || "회의";
    const sub = o.sub || [folderName(x.folder), x.date, x.time, x.place].filter(Boolean).join(" · ");
    printHTML(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>참석 서명 QR — ${esc(title)}</title><style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4 portrait; margin: 16mm; }
  body { font-family: -apple-system, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif;
    color: #0f172a; margin: 0; text-align: center; }
  .box { border: 3px solid #1d4ed8; border-radius: 18px; padding: 26px 22px; }
  .kicker { font-size: 15px; font-weight: 800; color: #1d4ed8; letter-spacing: .06em; }
  h1 { font-size: 30px; margin: 10px 0 4px; line-height: 1.25; }
  .sub { font-size: 14px; color: #475569; margin-bottom: 18px; }
  .qr { margin: 6px auto 10px; width: 420px; height: 420px; }
  .qr svg { width: 100%; height: 100%; }
  .code-wrap { margin-top: 6px; }
  .code-label { font-size: 13px; color: #475569; }
  .code { font-size: 42px; font-weight: 800; letter-spacing: .16em; color: #1d4ed8; margin: 2px 0 4px; }
  .url { font-size: 12px; color: #64748b; word-break: break-all; }
  .steps { margin: 20px auto 0; max-width: 520px; text-align: left; font-size: 13px; line-height: 1.75; color: #334155; }
  .steps b { color: #0f172a; }
  .foot { margin-top: 18px; font-size: 10px; color: #94a3b8; }
</style></head><body>
  <div class="box">
    <div class="kicker">참 석 자  서 명  안 내</div>
    <h1>${esc(title)}</h1>
    <div class="sub">${esc(sub)}</div>
    <div class="qr">${qr || "<div>QR 생성 불가</div>"}</div>
    <div class="code-wrap">
      <div class="code-label">QR이 안 될 때 — semis.pe.kr 접속 후 아래 번호 입력</div>
      <div class="code">${esc(code)}</div>
      <div class="url">${esc(url)}</div>
    </div>
    <div class="steps">
      <div>① 휴대폰 <b>카메라</b>를 열어 위 QR 코드를 비춥니다.</div>
      <div>② 화면에 뜨는 링크를 누르면 <b>서명 화면</b>이 바로 열립니다.</div>
      <div>③ 명단에서 <b>본인 이름</b>을 찾아 [서명하기]를 누릅니다.</div>
      <div>④ 명단에 없으면 <b>[직접 입력 후 서명]</b>으로 등록하고 서명합니다.</div>
    </div>
    <div class="foot">에어제타 보안종합정보시스템(SeMIS v2) — 이 종이는 회의 종료 후 폐기하세요.</div>
  </div>
</body></html>`, "QR 안내문");
  }

  /* ══════════ 서명 화면 (휴대폰 · signer 계정) ══════════ */
  function renderSigning(root, minuteId) {
    const m = all().find(c => c.id === minuteId);
    if (!m) { root.innerHTML = '<div class="empty">회의 정보를 찾을 수 없습니다. 진행자에게 문의하세요.</div>'; return; }
    const atts = m.attendees || [];
    const signed = atts.filter(a => a.sign).length;
    root.innerHTML = `
      <div class="cn-sign-page">
        <div class="cn-sign-head">
          <div class="cn-sign-title">${esc(folderIcon(m.folder))} ${esc(m.title || "회의")} · 참석 서명</div>
          <div class="cn-sign-meta">📅 ${esc(m.date || "")}${m.time ? " " + esc(m.time) : ""}${m.place ? " · 📍 " + esc(m.place) : ""}</div>
        </div>
        <div class="cn-sign-guide">명단에서 <b>본인 이름</b>을 찾아 <b>[서명하기]</b>를 눌러 주세요.<br>
          명단에 없으면 아래 <b>[직접 입력 후 서명]</b>으로 등록합니다.
          <span class="cn-sign-count">${signed}/${atts.length}명 완료</span></div>
        <div class="cn-sign-list">
          ${atts.length ? atts.map((a, i) => `
            <div class="cn-sign-item${a.sign ? " done" : ""}">
              <div class="cn-sign-who">
                <b>${esc(a.name || "(이름 미입력)")}</b>
                <span class="cn-sign-sub">${esc(a.org || "")}${a.role ? " · " + esc(a.role) : ""}</span>
              </div>
              <div class="cn-sign-act">
                ${a.sign
                  ? `<img class="cn-sign-thumb" src="${esc(a.sign)}" alt="서명"><span class="cn-sign-ok">✅ 완료</span><button class="btn btn-ghost btn-sm" data-sign="${i}">다시</button>`
                  : `<button class="btn btn-primary btn-sm" data-sign="${i}">✍️ 서명하기</button>`}
              </div>
            </div>`).join("") : '<div class="empty">아직 등록된 참석자가 없습니다. 아래 버튼으로 본인 정보를 입력하고 서명해 주세요.</div>'}
        </div>
        <button class="btn btn-ghost cn-sign-addbtn" id="mn-sign-new">➕ 명단에 없어요 — 직접 입력 후 서명</button>
        <div class="cn-sign-foot">서명은 저장 즉시 반영됩니다. 완료 후 창을 닫으셔도 됩니다.</div>
      </div>`;
    $$(".cn-sign-list [data-sign]").forEach(btn => btn.onclick = () => personModal(minuteId, Number(btn.dataset.sign)));
    $("#mn-sign-new").onclick = () => personModal(minuteId, -1);
  }

  /* 본인 정보 확인·입력 → 서명 패드 */
  function personModal(minuteId, idx) {
    const m = all().find(c => c.id === minuteId);
    if (!m) return;
    const a = (idx >= 0 && Array.isArray(m.attendees)) ? m.attendees[idx] : null;
    if (idx >= 0 && !a) return;
    const dir = knownPeople();
    const orgs = orgPresets();
    const init = a ? { name: a.name || "", org: a.org || "", role: a.role || "" } : { name: "", org: "", role: "" };
    openModal(`
      <h3>✍️ 참석 서명${idx < 0 ? " — 참석자 등록" : ""}</h3>
      <div class="form-hint" style="margin-bottom:10px">${idx >= 0
        ? "아래 정보를 확인하고, 바뀐 내용이 있으면 수정한 뒤 서명해 주세요."
        : "본인 이름·소속·직책을 입력해 주세요. 이전에 참석한 적이 있으면 이름 입력 시 자동으로 채워집니다."}</div>
      <div class="form-row"><label>성명 *</label>
        <input id="mn-sp-name" value="${esc(init.name)}" maxlength="30" autocomplete="off" list="mn-sp-names" placeholder="이름 입력">
        <datalist id="mn-sp-names">${[...dir.values()].map(p =>
          `<option value="${esc(p.name)}">${esc(p.org || "")}${p.role ? " · " + esc(p.role) : ""}</option>`).join("")}</datalist></div>
      <div class="form-row"><label>소속 *</label>
        <input id="mn-sp-org" value="${esc(init.org)}" maxlength="40" list="mn-sp-orgs" placeholder="예: 항공보안파트">
        <datalist id="mn-sp-orgs">${orgs.map(o => `<option value="${esc(o)}"></option>`).join("")}</datalist></div>
      <div class="form-row"><label>직책</label>
        <input id="mn-sp-role" value="${esc(init.role)}" maxlength="24" placeholder="예: 과장 / 팀장"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="mn-sp-cancel">취소</button>
        ${a && a.sign ? '<button class="btn btn-ghost" id="mn-sp-save">💾 정보만 저장</button>' : ""}
        <button class="btn btn-primary" id="mn-sp-go">✍️ 서명 진행</button>
      </div>`);
    const nameEl = $("#mn-sp-name"), orgEl = $("#mn-sp-org"), roleEl = $("#mn-sp-role");
    nameEl.onchange = () => {
      if (idx >= 0) return;
      const p = dir.get(String(nameEl.value || "").trim());
      if (!p) return;
      if (!orgEl.value.trim()) orgEl.value = p.org || "";
      if (!roleEl.value.trim()) roleEl.value = p.role || "";
    };
    const collect = () => {
      const nm = String(nameEl.value || "").trim(), og = String(orgEl.value || "").trim();
      if (!nm) { toast("성명을 입력해 주세요.", true); return null; }
      if (!og) { toast("소속을 입력해 주세요.", true); return null; }
      return { name: nm, org: og, role: String(roleEl.value || "").trim() };
    };
    $("#mn-sp-cancel").onclick = () => { closeModal(); SeMIS.renderView(); };
    const saveOnly = $("#mn-sp-save");
    if (saveOnly) saveOnly.onclick = () => {
      const person = collect();
      if (!person) return;
      saveSignEntry(minuteId, idx, person, null);
      closeModal(); toast("정보가 저장되었습니다. (기존 서명 유지)"); SeMIS.renderView();
    };
    $("#mn-sp-go").onclick = () => {
      const person = collect();
      if (!person) return;
      closeModal();
      openSignPad(person, (val) => {
        saveSignEntry(minuteId, idx, person, val);
        closeModal(); toast("서명이 저장되었습니다."); SeMIS.renderView();
      });
    };
  }

  /* 서명·정보 저장 — 실시간 병합분을 덮지 않도록 저장 직전 최신 상태를 다시 조회.
     sign === null 이면 기존 서명 유지(정보만 갱신). idx<0 이면 동명 항목에 병합, 없으면 추가. */
  function saveSignEntry(minuteId, idx, person, sign) {
    const m = all().find(c => c.id === minuteId);
    if (!m) return false;
    if (!Array.isArray(m.attendees)) m.attendees = [];
    let target = (idx >= 0) ? m.attendees[idx] : null;
    if (!target) {
      target = m.attendees.find(p => String(p.name || "").trim() === person.name
        && (!p.org || !person.org || String(p.org).trim() === person.org));
    }
    if (!target) {
      if (m.attendees.length >= MAX_ATT) { toast("참석자 정원을 초과했습니다. 진행자에게 문의하세요.", true); return false; }
      target = { name: "", org: "", role: "", note: "", sign: "" };
      m.attendees.push(target);
    }
    target.name = person.name; target.org = person.org; target.role = person.role;
    if (sign !== null && sign !== undefined) {
      target.sign = sign || "";
      // 실제로 서명한 사람 = 이 기기의 본인. 이후 로그인 시 열람 권한 판정에 쓰인다.
      if (sign) rememberSigner(person.name);
    }
    SeMIS.save();
    return true;
  }

  /* 서명 패드 — 협의회 모듈과 동일 UX (캔버스 → Storage 업로드, 실패 시 dataURL) */
  function openSignPad(p, onDone) {
    openModal(`
      <h3>✍️ ${esc(p.name || "참석자")} 서명</h3>
      <div class="form-hint" style="margin-bottom:8px">${esc(p.org || "")}${p.role ? " · " + esc(p.role) : ""} — 아래 칸에 손가락 또는 마우스로 서명해 주세요.</div>
      <div class="sign-pad-wrap"><canvas id="mn-sign-cv" class="sign-pad"></canvas></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="mn-sign-clear" style="margin-right:auto">지우기</button>
        <button class="btn btn-ghost" id="mn-sign-cancel">취소</button>
        <button class="btn btn-primary" id="mn-sign-ok">저장</button>
      </div>`);
    const cv = $("#mn-sign-cv");
    if (!cv) return;
    const wrapW = (cv.parentElement && cv.parentElement.clientWidth) || 300;
    const cssW = Math.max(240, Math.min(wrapW, 440)), cssH = 180;
    const ratio = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    cv.style.width = cssW + "px"; cv.style.height = cssH + "px";
    cv.width = Math.round(cssW * ratio); cv.height = Math.round(cssH * ratio);
    const ctx = cv.getContext ? cv.getContext("2d") : null;
    if (ctx) { ctx.scale(ratio, ratio); ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a"; }
    let drawing = false, hasDrawn = false, lx = 0, ly = 0;
    const pos = (ev) => { const r = cv.getBoundingClientRect(); const t = (ev.touches && ev.touches[0]) || ev; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
    const down = (ev) => { ev.preventDefault(); drawing = true; const q = pos(ev); lx = q.x; ly = q.y; };
    const moveFn = (ev) => { if (!drawing || !ctx) return; ev.preventDefault(); const q = pos(ev); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(q.x, q.y); ctx.stroke(); lx = q.x; ly = q.y; hasDrawn = true; };
    const up = () => { drawing = false; };
    if (cv.addEventListener) {
      if (window.PointerEvent) {
        cv.addEventListener("pointerdown", down);
        cv.addEventListener("pointermove", moveFn);
        window.addEventListener("pointerup", up);
      } else {
        cv.addEventListener("touchstart", down, { passive: false });
        cv.addEventListener("touchmove", moveFn, { passive: false });
        window.addEventListener("touchend", up);
        cv.addEventListener("mousedown", down);
        cv.addEventListener("mousemove", moveFn);
        window.addEventListener("mouseup", up);
      }
    }
    const cleanup = () => { try { window.removeEventListener("pointerup", up); window.removeEventListener("touchend", up); window.removeEventListener("mouseup", up); } catch (e) {} };
    $("#mn-sign-clear").onclick = () => { if (ctx) ctx.clearRect(0, 0, cssW, cssH); hasDrawn = false; };
    $("#mn-sign-cancel").onclick = () => { cleanup(); closeModal(); SeMIS.renderView(); };
    $("#mn-sign-ok").onclick = () => {
      if (!hasDrawn) { toast("서명을 입력해 주세요.", true); return; }
      const finish = (val) => { cleanup(); onDone(val); };
      const dataFallback = () => { try { finish(cv.toDataURL("image/png")); } catch (e) { toast("서명 저장에 실패했습니다.", true); } };
      try {
        if (cv.toBlob && window.SemisSync && typeof fetch !== "undefined") {
          cv.toBlob((blob) => {
            if (!blob) return dataFallback();
            (async () => {
              try {
                const file = new File([blob], "sign_" + Date.now() + ".png", { type: "image/png" });
                const up = await SemisSync.uploadFile(file, "minutes-sign");
                finish(up.url);
              } catch (e) { dataFallback(); }
            })();
          }, "image/png");
        } else dataFallback();
      } catch (e) { dataFallback(); }
    };
  }

  window.SemisMinutes = { seedFolders, all, sorted, folders, folderOf, folderName, stats,
    nextNo, prevMeeting, draftFrom, matches, knownPeople, signCode, signUrl, view, filtered,
    syncCalendar, removeCalendar, SID, detail, form, newMinute, folderModal,
    printMinute, printQrSheet, renderSigning, saveSignEntry, orgPresets, qrSvg, signBoxHTML,
    signModal, canWrite, listHTML, visibleAll, canSeeRec, myNames, signedNames, rememberSigner };
})();
