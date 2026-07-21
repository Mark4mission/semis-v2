/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 보안장비 협의회 회의록 모듈 (v2.24)
   인천화물터미널 B동 보안검색장비(X-ray·ETD 등) 관리 협의회.
   KPI 과제 C6-1「내부 보안 관리 체계 보완」의 '보안장비 협의체 신설'
   활동 기반. 월 1회 정기 개최 — 제조사/유지보수/운영사/본사 참석.

   일반 회의록 포맷(참석자·안건·논의·결정) + 협의회 특화 3대 안건:
     1. 최근 고장/수리/유지보수 사례 근본원인
     2. 장비 사용환경 개선 방안
     3. 분야별 제안 및 토의

   데이터: DATA.council = [{ id, round(회차), date, time, place,
     chair(주재), scribe(작성),
     attendees:[{ cat(구분), org(소속), name(성명), role(직책) }],
     agenda(안건),
     cases:[{ equip(장비), symptom(증상), cause(근본원인), action(조치) }],
     env(사용환경 개선), proposals(제안·토의),
     actions:[{ task(내용), owner(담당), due(기한), done(완료) }],
     nextPlan(차기),
     files:[{url,name,size}](최대 20), by, updated }]
   접근: manager 이상 열람(vis=mgr) / hq 이상 편집(canEdit)
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const { $, $$, esc, toast, openModal, closeModal, confirmModal } = SeMIS;
  const D = () => SeMIS.data;
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* 참석자 구분 (거버넌스 이해관계자) */
  const CATS = ["제조사", "유지보수", "운영사", "본사", "기타"];
  const CAT_BADGE = { "제조사": "badge-blue", "유지보수": "badge-green", "운영사": "badge-orange", "본사": "badge-red", "기타": "badge-gray" };
  const CAT_HINT = "제조사=뉴원S&T·인씨스 등 / 유지보수=프로에스콤 등 / 운영사=화물터미널 / 본사=항공화물·항공보안파트";

  const DEFAULT_PLACE = "인천화물터미널 B동";

  /* 첨부 제약 (branches 교육현황과 동일) */
  const MAX_FILES = 20;
  const FILE_MAX = 20 * 1024 * 1024;   // 20MB

  const all = () => (Array.isArray(D().council) ? D().council : []);
  const sorted = () => all().slice().sort((a, b) =>
    (Number(b.round) || 0) - (Number(a.round) || 0) ||
    String(b.date || "").localeCompare(String(a.date || "")) ||
    String(b.id || "").localeCompare(String(a.id || "")));
  const nextRound = () => (all().reduce((mx, x) => Math.max(mx, Number(x.round) || 0), 0) + 1);
  const canWrite = () => SeMIS.canEdit();
  const canSeeKpi = () => SeMIS.roleRank() >= 3;

  const nl2br = (s) => esc(String(s || "")).replace(/\n/g, "<br>");
  const meetTitle = (x) => (x.round ? "제" + x.round + "차 " : "") + "보안장비 협의회";

  /* ─── 리치 텍스트(링크·이미지 붙여넣기) 공용 — 공지 에디터 인프라 재사용 ─── */
  const sanitize = (h) => (window.SemisNotice ? window.SemisNotice.sanitizeHtml(h) : esc(h));
  const hasRich = (html, text) => !!(text && text.trim()) || /<(img|table|a|ul|ol|li)\b/i.test(html || "");
  /* 읽기: html 있으면 살균 렌더(.notice-html), 없으면 텍스트 줄바꿈 */
  const richView = (html, text) => html
    ? `<div class="cn-text cn-rich notice-html">${sanitize(html)}</div>`
    : (text ? `<div class="cn-text">${nl2br(text)}</div>` : "");
  /* 편집 폼: 미니 툴바 + contenteditable 에디터 HTML */
  const richFieldHTML = (key, labelHTML, ph, labelCls) => `
        <div class="form-row"><label class="${labelCls || ""}">${labelHTML}</label>
          <div class="nb-toolbar nb-mini" data-rich-tb="${key}">
            <button type="button" data-cmd="bold" title="굵게"><b>B</b></button>
            <button type="button" data-cmd="insertUnorderedList" title="글머리 목록">•—</button>
            <button type="button" data-rich-link="${key}" title="링크">🔗 링크</button>
            <button type="button" data-rich-img="${key}" title="이미지">🖼 이미지</button>
            <button type="button" data-rich-file="${key}" title="파일">📎 파일</button>
          </div>
          <div id="cn-${key}" class="nb-editor nb-rich" contenteditable="true" data-ph="${esc(ph || "")}"></div>
          <input type="file" id="cn-${key}-img" accept="image/*" style="display:none">
          <input type="file" id="cn-${key}-file" style="display:none" multiple></div>`;
  /* 에디터에 초기값 주입 + 툴바/붙여넣기 배선 */
  function wireRich(key, html, text) {
    const ed = $("#cn-" + key);
    if (!ed) return;
    ed.innerHTML = html || (text ? esc(text).replace(/\n/g, "<br>") : "");
    const rich = window.SemisNotice ? window.SemisNotice.wireRichMedia(ed, "council") : null;
    $$(`[data-rich-tb="${key}"] [data-cmd]`).forEach(b => {
      b.onmousedown = (ev) => ev.preventDefault();
      b.onclick = () => { ed.focus(); try { document.execCommand(b.dataset.cmd); } catch (e) {} };
    });
    const linkBtn = $(`[data-rich-link="${key}"]`);
    if (linkBtn) linkBtn.onclick = () => {
      let url = ""; try { url = window.prompt("링크 주소(URL)를 입력하세요", "https://") || ""; } catch (e) {}
      if (!/^https?:\/\/.+/.test(url)) return;
      ed.focus();
      const a = `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`;
      try { if (!document.execCommand("createLink", false, url) && rich) rich.insert(a); }
      catch (e) { if (rich) rich.insert(a); }
    };
    const imgBtn = $(`[data-rich-img="${key}"]`), imgFile = $("#cn-" + key + "-img");
    if (imgBtn) imgBtn.onclick = () => imgFile.click();
    if (imgFile) imgFile.onchange = (ev) => { if (rich) rich.addFiles(ev.target.files); ev.target.value = ""; };
    const fileBtn = $(`[data-rich-file="${key}"]`), anyFile = $("#cn-" + key + "-file");
    if (fileBtn) fileBtn.onclick = () => anyFile.click();
    if (anyFile) anyFile.onchange = (ev) => { if (rich) rich.addFiles(ev.target.files); ev.target.value = ""; };
  }
  /* 저장: 에디터 → { html(살균·내용없으면 빈문자), text } */
  function richOut(key) {
    const ed = $("#cn-" + key);
    if (!ed) return { html: "", text: "" };
    const html = sanitize(ed.innerHTML);
    const tmp = document.createElement("div"); tmp.innerHTML = html;
    const text = (tmp.textContent || "").trim();
    return { html: hasRich(html, text) ? html : "", text };
  }

  function stats() {
    const items = all();
    const yr = new Date().getFullYear();
    const thisYear = items.filter(x => String(x.date || "").slice(0, 4) === String(yr)).length;
    const cases = items.reduce((s, x) => s + ((x.cases || []).length), 0);
    let openAct = 0;
    items.forEach(x => (x.actions || []).forEach(a => { if (!a.done) openAct++; }));
    return { total: items.length, thisYear, cases, openAct, yr };
  }

  /* ══════════ 목록 ══════════ */
  function listHTML() {
    const items = sorted();
    if (!items.length) return '<div class="empty">등록된 회의록이 없습니다.' +
      (canWrite() ? ' 우측 상단 <b>+ 회의록 작성</b>으로 첫 회의를 기록하세요.' : '') + '</div>';
    return `<div class="table-wrap"><table class="tbl cn-list-tbl"><thead><tr>
        <th style="width:60px">회차</th><th style="width:104px">회의일</th>
        <th>회의명 / 장소</th><th style="width:210px">참석</th>
        <th style="width:190px">사례·결정</th><th style="width:56px">첨부</th></tr></thead><tbody>
      ${items.map(x => {
        const att = (x.attendees || []).length;
        const cats = Array.from(new Set((x.attendees || []).map(a => a.cat).filter(Boolean)));
        const nCase = (x.cases || []).length;
        const nAct = (x.actions || []).length;
        const nFile = (x.files || []).length;
        return `<tr data-cn-row="${esc(x.id)}" style="cursor:pointer">
          <td><b>제${esc(String(x.round || "-"))}차</b></td>
          <td style="font-size:.86rem">${x.date ? esc(x.date) : '<span style="color:var(--text-3)">미정</span>'}${x.time ? `<div style="font-size:.74rem;color:var(--text-3)">${esc(x.time)}</div>` : ""}</td>
          <td><b>${esc(meetTitle(x))}</b><div style="font-size:.76rem;color:var(--text-3)">📍 ${esc(x.place || "-")}</div></td>
          <td style="font-size:.82rem">${att ? `${att}명` : "-"}${cats.length ? `<div style="margin-top:2px;display:flex;flex-wrap:wrap;gap:2px">${cats.map(c => `<span class="badge ${CAT_BADGE[c] || "badge-gray"}" style="font-size:.66rem">${esc(c)}</span>`).join("")}</div>` : ""}</td>
          <td style="font-size:.82rem">${nCase ? `사례 ${nCase}` : ""}${nCase && nAct ? " · " : ""}${nAct ? `결정 ${nAct}` : ""}${!nCase && !nAct ? "-" : ""}</td>
          <td style="font-size:.82rem">${nFile ? `📎 ${nFile}` : "-"}</td>
        </tr>`; }).join("")}</tbody></table></div>`;
  }

  /* ══════════ 상세 (읽기 전용) ══════════ */
  function detail(id) {
    const x = all().find(c => c.id === id);
    if (!x) return;
    const att = (x.attendees || []);
    const cases = (x.cases || []);
    const acts = (x.actions || []);
    const sec = (title, body) => body ? `<div class="cn-sec"><div class="cn-sec-h">${title}</div>${body}</div>` : "";

    const attHTML = att.length ? `<table class="tbl cn-att-tbl"><thead><tr>
        <th style="width:34px">No</th><th style="width:92px">구분</th><th style="width:82px">성명</th>
        <th style="width:82px">직책</th><th>소속</th><th style="width:104px">서명</th><th>비고</th></tr></thead><tbody>
      ${att.map((a, i) => `<tr>
        <td style="text-align:center;color:var(--text-3)">${i + 1}</td>
        <td>${a.cat ? `<span class="badge ${CAT_BADGE[a.cat] || "badge-gray"}">${esc(a.cat)}</span>` : "-"}</td>
        <td>${esc(a.name || "-")}</td><td>${esc(a.role || "-")}</td>
        <td>${esc(a.org || "-")}</td>
        <td style="text-align:center">${a.sign ? `<img class="cn-sign-img" src="${esc(a.sign)}" alt="서명">` : '<span style="color:var(--text-3)">-</span>'}</td>
        <td>${a.note ? esc(a.note) : "-"}</td></tr>`).join("")}
      </tbody></table>` : "";

    const caseHTML = cases.length ? `<table class="tbl cn-case-tbl"><thead><tr>
        <th style="width:15%">장비</th><th style="width:18%">증상</th>
        <th style="width:34%">근본원인</th><th style="width:33%">조치</th></tr></thead><tbody>
      ${cases.map(c => `<tr>
        <td><b>${esc(c.equip || "-")}</b></td><td>${nl2br(c.symptom)}</td>
        <td>${nl2br(c.cause)}</td><td>${nl2br(c.action)}</td></tr>`).join("")}
      </tbody></table>` : "";

    const actHTML = acts.length ? `<table class="tbl cn-act-tbl"><thead><tr>
        <th style="width:40px"></th><th>결정 / 조치 사항</th><th style="width:92px">담당</th><th style="width:96px">기한</th></tr></thead><tbody>
      ${acts.map(a => `<tr class="${a.done ? "cn-act-done" : ""}">
        <td style="text-align:center">${a.done ? "✅" : "⬜"}</td>
        <td>${nl2br(a.task)}</td><td>${esc(a.owner || "-")}</td><td>${esc(a.due || "-")}</td></tr>`).join("")}
      </tbody></table>` : "";

    openModal(`
     <div class="cn-view">
      <h3>🤝 ${esc(meetTitle(x))}</h3>
      <div class="cn-meta">
        <span>📅 <b>${esc(x.date || "미정")}</b>${x.time ? " " + esc(x.time) : ""}</span>
        <span>📍 ${esc(x.place || "-")}</span>
        ${x.chair ? `<span>🧑‍💼 주재 ${esc(x.chair)}</span>` : ""}
        ${x.scribe ? `<span>✍️ 작성 ${esc(x.scribe)}</span>` : ""}
        <span>👥 참석 ${att.length}명</span>
      </div>
      ${canWrite() && /^\d{4}-\d{2}-\d{2}$/.test(x.date || "") ? `<div class="cn-signcode">
        <span class="cn-signcode-ic">📱</span>
        <div>참석자 서명 안내 — 모바일에서 <b>${esc(location.host || "semis.pe.kr")}</b> 접속 후 암호 <b class="cn-signcode-code">${esc((x.date || "").replace(/-/g, ""))}</b> 입력 → 이 회의 서명 화면에서 본인 서명을 그려 넣습니다.</div>
      </div>` : ""}
      ${sec("참석자", attHTML)}
      ${sec("안건", richView(x.agendaHtml, x.agenda))}
      ${sec("① 고장·수리·유지보수 사례 근본원인", caseHTML)}
      ${sec("② 장비 사용환경 개선 방안", richView(x.envHtml, x.env))}
      ${sec("③ 분야별 제안 및 토의", richView(x.proposalsHtml, x.proposals))}
      ${sec("결정사항 / 액션 아이템", actHTML)}
      ${sec("차기 회의", x.nextPlan ? `<div class="cn-text">${nl2br(x.nextPlan)}</div>` : "")}
      ${(x.files || []).length ? `<div class="cn-sec"><div class="cn-sec-h">첨부파일 (${(x.files || []).length})</div>
        <div class="nb-files-view br-files-scroll">${(x.files || []).map(f =>
          `<a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">📄 ${esc(f.name)}</a>`).join("")}</div></div>` : ""}
      ${x.updated ? `<div class="form-hint" style="margin-top:10px">최종 수정 ${esc(String(x.updated).slice(0, 10))}${x.by ? " · " + esc(x.by) : ""}</div>` : ""}
      <div class="modal-actions">
        ${canWrite() ? '<button class="btn btn-danger" id="cn-del" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="cn-print">🖨 인쇄</button>
        ${canWrite() ? '<button class="btn btn-ghost" id="cn-edit">✎ 수정</button>' : ""}
        <button class="btn btn-primary" id="cn-close">닫기</button>
      </div>
     </div>`, { wide: true });

    $("#cn-close").onclick = closeModal;
    $("#cn-print").onclick = () => printMinutes(x.id);
    if (canWrite()) {
      $("#cn-edit").onclick = () => form(x.id);
      $("#cn-del").onclick = () => confirmModal(`"${meetTitle(x)}" 회의록을 삭제하시겠습니까?`, () => {
        D().council = all().filter(c => c.id !== x.id);
        SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
      });
    }
  }

  /* ══════════ 등록/수정 폼 (hq+) ══════════ */
  function form(id) {
    const x = id ? all().find(c => c.id === id) : null;
    let attendees = x ? (x.attendees || []).map(a => Object.assign({}, a)) : [];
    let cases = x ? (x.cases || []).map(c => Object.assign({}, c)) : [];
    let actions = x ? (x.actions || []).map(a => Object.assign({}, a)) : [];
    let files = x ? (x.files || []).map(f => Object.assign({}, f)) : [];

    openModal(`
     <div class="cn-form">
      <h3>${x ? "회의록 수정" : "회의록 작성"} <span class="badge badge-gray">보안장비 협의회</span></h3>

      <fieldset class="cn-fs"><legend>📋 회의 정보</legend>
        <div class="form-grid">
          <div class="form-row"><label>회차</label>
            <input id="cn-round" type="number" min="1" max="999" value="${esc(x ? x.round || "" : nextRound())}"></div>
          <div class="form-row"><label>회의일</label>
            <input id="cn-date" type="date" value="${esc(x ? x.date || "" : "")}"></div>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>시간 (선택)</label>
            <input id="cn-time" value="${esc(x ? x.time || "" : "")}" maxlength="40" placeholder="예: 14:00~16:00"></div>
          <div class="form-row"><label>장소</label>
            <input id="cn-place" value="${esc(x ? x.place || "" : DEFAULT_PLACE)}" maxlength="80"></div>
        </div>
        <div class="form-grid">
          <div class="form-row"><label>주재 (의장)</label>
            <input id="cn-chair" value="${esc(x ? x.chair || "" : "")}" maxlength="40" placeholder="예: 최상일 프로"></div>
          <div class="form-row"><label>작성자 (서기)</label>
            <input id="cn-scribe" value="${esc(x ? x.scribe || "" : "")}" maxlength="40"></div>
        </div>
      </fieldset>

      <fieldset class="cn-fs"><legend>👥 참석자</legend>
        <div class="form-hint" style="margin:0 0 8px">${CAT_HINT}</div>
        <div id="cn-att"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="cn-att-add" style="margin-top:6px">+ 참석자 추가</button>
      </fieldset>

      <fieldset class="cn-fs"><legend>🗣 협의 안건</legend>
        <div class="form-hint" style="margin:0 0 8px">본문에는 링크·이미지를 붙여넣거나 드래그앤드롭으로 넣을 수 있습니다.</div>
        ${richFieldHTML("agenda", "안건 (선택)", "이번 회의 안건 (한 줄에 하나씩)")}
        <div class="form-row"><label class="cn-flabel">① 고장·수리·유지보수 사례 근본원인</label>
          <div id="cn-cases"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="cn-case-add" style="margin-top:6px">+ 사례 추가</button></div>
        ${richFieldHTML("env", "② 장비 사용환경 개선 방안", "온·습도·먼지 등 사용환경 개선 논의 및 방안", "cn-flabel")}
        ${richFieldHTML("proposals", "③ 분야별 제안 및 토의", "제조사·유지보수·운영사·본사 각 분야 제안 및 토의 내용", "cn-flabel")}
      </fieldset>

      <fieldset class="cn-fs"><legend>✅ 결정 및 차기</legend>
        <div class="form-row"><label>결정사항 / 액션 아이템</label>
          <div id="cn-acts"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="cn-act-add" style="margin-top:6px">+ 결정사항 추가</button></div>
        <div class="form-row"><label>차기 회의 (선택)</label>
          <input id="cn-next" value="${esc(x ? x.nextPlan || "" : "")}" maxlength="200" placeholder="예: 2026-08-20 / 부품 교체주기 데이터 검토"></div>
      </fieldset>

      <fieldset class="cn-fs"><legend>📎 첨부파일</legend>
        <div class="form-hint" style="margin:0 0 8px">회의자료·사진 등 · 최대 ${MAX_FILES}개 · 각 20MB 이하</div>
        <div id="cn-dropzone" class="br-dropzone">📎 파일을 이곳에 끌어다 놓거나 <u>클릭하여 선택</u>하세요
          <input type="file" id="cn-file" multiple style="display:none"></div>
        <div id="cn-file-box" class="nb-files-view br-files-scroll"></div>
      </fieldset>

      <div class="modal-actions">
        ${x ? '<button class="btn btn-danger" id="cn-fdel" style="margin-right:auto">삭제</button>' : ""}
        <button class="btn btn-ghost" id="cn-cancel">취소</button>
        <button class="btn btn-primary" id="cn-save">저장</button>
      </div>
     </div>`, { wide: true });

    /* ─ 본문 리치 에디터(안건·②·③) 초기값 주입 + 배선 ─ */
    wireRich("agenda", x ? x.agendaHtml : "", x ? x.agenda : "");
    wireRich("env", x ? x.envHtml : "", x ? x.env : "");
    wireRich("proposals", x ? x.proposalsHtml : "", x ? x.proposals : "");

    /* ─ 참석자 동적행 ─ */
    function attCollect() {
      $$("#cn-att .cn-att-row").forEach((row, i) => {
        attendees[i].cat = row.querySelector(".cn-a-cat").value;
        attendees[i].org = row.querySelector(".cn-a-org").value;
        attendees[i].name = row.querySelector(".cn-a-name").value;
        attendees[i].role = row.querySelector(".cn-a-role").value;
        attendees[i].note = row.querySelector(".cn-a-note").value;
      });
    }
    function attPaint() {
      $("#cn-att").innerHTML = attendees.map((a, i) => `
        <div class="cn-att-row">
          <span class="cn-a-no">${i + 1}</span>
          <select class="cn-a-cat">${CATS.map(c => `<option ${(a.cat || "제조사") === c ? "selected" : ""}>${c}</option>`).join("")}</select>
          <input class="cn-a-org" value="${esc(a.org || "")}" maxlength="40" placeholder="소속">
          <input class="cn-a-name" value="${esc(a.name || "")}" maxlength="24" placeholder="성명">
          <input class="cn-a-role" value="${esc(a.role || "")}" maxlength="24" placeholder="직책">
          <input class="cn-a-note" value="${esc(a.note || "")}" maxlength="40" placeholder="비고 (선택)">
          <button type="button" class="mt-btn danger" data-att-del="${i}" title="삭제">✕</button>
        </div>`).join("") || '<span class="form-hint">참석자를 추가하세요.</span>';
      $$("#cn-att [data-att-del]").forEach(btn => btn.onclick = () => {
        attCollect(); attendees.splice(Number(btn.dataset.attDel), 1); attPaint();
      });
    }
    attPaint();
    $("#cn-att-add").onclick = () => { attCollect(); attendees.push({ cat: "제조사", org: "", name: "", role: "", note: "", sign: "" }); attPaint(); };

    /* ─ 사례 동적행 ─ */
    function caseCollect() {
      $$("#cn-cases .cn-case-row").forEach((row, i) => {
        cases[i].equip = row.querySelector(".cn-c-equip").value;
        cases[i].symptom = row.querySelector(".cn-c-symptom").value;
        cases[i].cause = row.querySelector(".cn-c-cause").value;
        cases[i].action = row.querySelector(".cn-c-action").value;
      });
    }
    function casePaint() {
      $("#cn-cases").innerHTML = cases.map((c, i) => `
        <div class="cn-case-row">
          <div class="cn-case-top">
            <input class="cn-c-equip" value="${esc(c.equip || "")}" maxlength="40" placeholder="장비 (예: ETD 3호기)">
            <button type="button" class="mt-btn danger" data-case-del="${i}" title="사례 삭제">✕</button>
          </div>
          <input class="cn-c-symptom" value="${esc(c.symptom || "")}" maxlength="120" placeholder="증상 (예: 잦은 알람 오류)">
          <input class="cn-c-cause" value="${esc(c.cause || "")}" maxlength="200" placeholder="근본원인 (예: 멤브레인 노즐 오염)">
          <input class="cn-c-action" value="${esc(c.action || "")}" maxlength="200" placeholder="조치 / 대책">
        </div>`).join("") || '<span class="form-hint">고장·수리 사례를 추가하세요.</span>';
      $$("#cn-cases [data-case-del]").forEach(btn => btn.onclick = () => {
        caseCollect(); cases.splice(Number(btn.dataset.caseDel), 1); casePaint();
      });
    }
    casePaint();
    $("#cn-case-add").onclick = () => { caseCollect(); cases.push({ equip: "", symptom: "", cause: "", action: "" }); casePaint(); };

    /* ─ 결정/액션 동적행 ─ */
    function actCollect() {
      $$("#cn-acts .cn-act-row").forEach((row, i) => {
        actions[i].task = row.querySelector(".cn-t-task").value;
        actions[i].owner = row.querySelector(".cn-t-owner").value;
        actions[i].due = row.querySelector(".cn-t-due").value;
        actions[i].done = row.querySelector(".cn-t-done").checked;
      });
    }
    function actPaint() {
      $("#cn-acts").innerHTML = actions.map((a, i) => `
        <div class="cn-act-row">
          <label class="cn-t-donebox" title="완료"><input type="checkbox" class="cn-t-done" ${a.done ? "checked" : ""}></label>
          <input class="cn-t-task" value="${esc(a.task || "")}" maxlength="200" placeholder="결정·조치 사항">
          <input class="cn-t-owner" value="${esc(a.owner || "")}" maxlength="24" placeholder="담당">
          <input class="cn-t-due" type="date" value="${esc(a.due || "")}">
          <button type="button" class="mt-btn danger" data-act-del="${i}" title="삭제">✕</button>
        </div>`).join("") || '<span class="form-hint">결정사항·액션 아이템을 추가하세요.</span>';
      $$("#cn-acts [data-act-del]").forEach(btn => btn.onclick = () => {
        actCollect(); actions.splice(Number(btn.dataset.actDel), 1); actPaint();
      });
    }
    actPaint();
    $("#cn-act-add").onclick = () => { actCollect(); actions.push({ task: "", owner: "", due: "", done: false }); actPaint(); };

    /* ─ 첨부 ─ */
    function renderFiles() {
      $("#cn-file-box").innerHTML = files.length
        ? files.map((f, i) => `<span class="nb-file"><a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>
            <button type="button" class="mt-btn danger" data-cn-frm="${i}" title="첨부 제거">✕</button></span>`).join("")
          + `<span class="form-hint" style="align-self:center">${files.length}/${MAX_FILES}</span>`
        : '<span class="form-hint">첨부된 파일이 없습니다.</span>';
      $$("#cn-file-box [data-cn-frm]").forEach(btn => btn.onclick = () => {
        files.splice(Number(btn.dataset.cnFrm), 1); renderFiles();
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
          const up = await SemisSync.uploadFile(f, "council");
          files.push({ url: up.url, name: f.name, size: f.size || 0 }); renderFiles();
          toast("업로드되었습니다: " + f.name);
        } catch (err) { toast(f.name + ": 업로드 실패 — 네트워크를 확인하세요.", true); }
      }
    }
    const dz = $("#cn-dropzone"), fi = $("#cn-file");
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

    /* ─ 저장/취소/삭제 ─ */
    $("#cn-cancel").onclick = () => (x ? detail(x.id) : (closeModal(), SeMIS.renderView()));
    if (x) $("#cn-fdel").onclick = () => confirmModal(`"${meetTitle(x)}" 회의록을 삭제하시겠습니까?`, () => {
      D().council = all().filter(c => c.id !== x.id);
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("삭제되었습니다.");
    });
    $("#cn-save").onclick = () => {
      attCollect(); caseCollect(); actCollect();
      const round = Number($("#cn-round").value) || 0;
      const date = $("#cn-date").value;
      if (!round) { toast("회차를 입력하세요.", true); return; }
      if (!date) { toast("회의일을 입력하세요.", true); return; }
      const clean = (arr, keys) => arr.filter(o => keys.some(k => String(o[k] || "").trim() !== ""));
      const ag = richOut("agenda"), en = richOut("env"), pr = richOut("proposals");
      const rec = {
        round, date,
        time: $("#cn-time").value.trim(),
        place: $("#cn-place").value.trim() || DEFAULT_PLACE,
        chair: $("#cn-chair").value.trim(),
        scribe: $("#cn-scribe").value.trim(),
        attendees: clean(attendees, ["org", "name"]).map(a => ({
          cat: a.cat || "기타", org: (a.org || "").trim(), name: (a.name || "").trim(),
          role: (a.role || "").trim(), note: (a.note || "").trim(), sign: a.sign || "" })),
        agenda: ag.text, agendaHtml: ag.html,
        cases: clean(cases, ["equip", "symptom", "cause", "action"]).map(c => ({
          equip: (c.equip || "").trim(), symptom: (c.symptom || "").trim(),
          cause: (c.cause || "").trim(), action: (c.action || "").trim() })),
        env: en.text, envHtml: en.html,
        proposals: pr.text, proposalsHtml: pr.html,
        actions: clean(actions, ["task"]).map(a => ({
          task: (a.task || "").trim(), owner: (a.owner || "").trim(), due: a.due || "", done: !!a.done })),
        nextPlan: $("#cn-next").value.trim(),
        files: files.slice(0, MAX_FILES),
        by: (SeMIS.user && SeMIS.user.name) || "",
        updated: new Date().toISOString()
      };
      if (x) Object.assign(x, rec);
      else D().council.push(Object.assign({ id: uid("cn") }, rec));
      SeMIS.save(); closeModal(); SeMIS.renderView(); toast("저장되었습니다.");
    };
  }

  /* ══════════ 인쇄 (A4 회의록) ══════════ */
  function printMinutes(id) {
    const x = all().find(c => c.id === id);
    if (!x) return;
    const P = (s) => nl2br(s);
    const att = (x.attendees || []), cases = (x.cases || []), acts = (x.actions || []);
    const today = new Date().toISOString().slice(0, 10);

    const attRows = att.length ? att.map((a, i) => `<tr>
        <td style="text-align:center">${i + 1}</td><td>${esc(a.cat || "-")}</td>
        <td>${esc(a.name || "-")}</td><td>${esc(a.role || "-")}</td>
        <td>${esc(a.org || "-")}</td>
        <td style="text-align:center">${a.sign ? `<img src="${esc(a.sign)}" style="height:26px;max-width:100%">` : ""}</td>
        <td>${esc(a.note || "")}</td></tr>`).join("")
      : '<tr><td colspan="7" class="pc-empty">기록 없음</td></tr>';
    const caseRows = cases.length ? cases.map(c => `<tr>
        <td><b>${esc(c.equip || "-")}</b></td><td>${P(c.symptom)}</td>
        <td>${P(c.cause)}</td><td>${P(c.action)}</td></tr>`).join("")
      : '<tr><td colspan="4" class="pc-empty">기록 없음</td></tr>';
    const actRows = acts.length ? acts.map(a => `<tr>
        <td style="text-align:center">${a.done ? "✔" : "□"}</td><td>${P(a.task)}</td>
        <td>${esc(a.owner || "-")}</td><td>${esc(a.due || "-")}</td></tr>`).join("")
      : '<tr><td colspan="4" class="pc-empty">기록 없음</td></tr>';
    const textSec = (title, html, text) => {
      const inner = html ? sanitize(html) : (text ? P(text) : "");
      return inner ? `<div class="sec"><div class="sec-h">${title}</div><div class="ptext">${inner}</div></div>` : "";
    };

    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>보안장비 협의회 회의록 · 제${esc(String(x.round || ""))}차</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4 portrait; margin: 14mm 12mm; }
  body { font-family: -apple-system, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", sans-serif; color: #0f172a; font-size: 10.5px; line-height: 1.55; margin: 0; }
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
  table.att, table.cases { table-layout: fixed; }
  table.att td, table.cases td { word-break: break-word; }
  table.att td img { display: block; margin: 0 auto; }
  .ptext { border: 1px solid #94a3b8; border-left: 3px solid #1d4ed8; border-radius: 6px; padding: 8px 10px; background: #fff; white-space: normal; }
  .ptext img { max-width: 100%; height: auto; border-radius: 4px; margin: 4px 0; }
  .ptext a { color: #1d4ed8; word-break: break-all; }
  .ptext ul, .ptext ol { margin: 4px 0; padding-left: 18px; }
  .ptext table { border-collapse: collapse; margin: 4px 0; }
  .ptext td, .ptext th { border: 1px solid #cbd5e1; padding: 3px 5px; }
  .pc-empty { color: #94a3b8; text-align: center; }
  .foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 8.5px; color: #64748b; }
</style></head><body>
  <div class="doc-head">
    <h1>보안장비 협의회 회의록 — 제${esc(String(x.round || ""))}차</h1>
    <div class="sub">에어제타 항공보안 · 인천화물터미널 B동 보안검색장비 관리 협의회 (KPI C6-1 기반)</div>
    <div class="meta">
      <span>회의일 <b>${esc(x.date || "-")}</b>${x.time ? " " + esc(x.time) : ""}</span>
      <span>장소 <b>${esc(x.place || "-")}</b></span>
      ${x.chair ? `<span>주재 <b>${esc(x.chair)}</b></span>` : ""}
      ${x.scribe ? `<span>작성 <b>${esc(x.scribe)}</b></span>` : ""}
      <span>참석 <b>${att.length}명</b></span>
    </div>
  </div>
  <div class="sec"><div class="sec-h">참석자</div>
    <table class="att"><thead><tr><th style="width:24px">No</th><th style="width:52px">구분</th>
      <th style="width:60px">성명</th><th style="width:62px">직책</th><th style="width:26%">소속</th>
      <th style="width:74px">서명</th><th>비고</th></tr></thead>
      <tbody>${attRows}</tbody></table></div>
  ${textSec("안건", x.agendaHtml, x.agenda)}
  <div class="sec"><div class="sec-h">① 고장·수리·유지보수 사례 근본원인</div>
    <table class="cases"><thead><tr><th style="width:15%">장비</th><th style="width:18%">증상</th>
      <th style="width:34%">근본원인</th><th style="width:33%">조치</th></tr></thead>
      <tbody>${caseRows}</tbody></table></div>
  ${textSec("② 장비 사용환경 개선 방안", x.envHtml, x.env)}
  ${textSec("③ 분야별 제안 및 토의", x.proposalsHtml, x.proposals)}
  <div class="sec"><div class="sec-h">결정사항 / 액션 아이템</div>
    <table><thead><tr><th style="width:34px">완료</th><th>결정·조치 사항</th><th style="width:80px">담당</th><th style="width:84px">기한</th></tr></thead>
      <tbody>${actRows}</tbody></table></div>
  ${textSec("차기 회의", x.nextPlan)}
  <div class="foot">
    <span>에어제타 보안종합정보시스템(SeMIS v2) · 보안장비 협의회</span>
    <span>출력 ${esc(today)}${SeMIS.user ? " · " + esc(SeMIS.user.name) : ""}</span>
  </div>
</body></html>`;

    try {
      toast("인쇄 문서 준비 중…");
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

  /* ══════════ 서명 모드 (모바일 참석자) ══════════ */
  /* 특정 협의회 회의일(YYYYMMDD) 코드로 로그인한 참석자에게 보이는 서명 전용 화면 */
  function renderSigning(root, meetingId) {
    const m = all().find(c => c.id === meetingId);
    if (!m) { root.innerHTML = '<div class="empty">회의 정보를 찾을 수 없습니다. 진행자에게 문의하세요.</div>'; return; }
    const atts = m.attendees || [];
    const signed = atts.filter(a => a.sign).length;
    root.innerHTML = `
      <div class="cn-sign-page">
        <div class="cn-sign-head">
          <div class="cn-sign-title">🤝 ${esc(meetTitle(m))} · 참석 서명</div>
          <div class="cn-sign-meta">📅 ${esc(m.date || "")}${m.time ? " " + esc(m.time) : ""} · 📍 ${esc(m.place || "")}</div>
        </div>
        <div class="cn-sign-guide">아래에서 <b>본인 이름</b>을 찾아 <b>[서명하기]</b>를 누르고 화면에 서명해 주세요. <span class="cn-sign-count">${signed}/${atts.length}명 완료</span></div>
        <div class="cn-sign-list">
          ${atts.length ? atts.map((a, i) => `
            <div class="cn-sign-item${a.sign ? " done" : ""}">
              <div class="cn-sign-who">
                <b>${esc(a.name || "(이름 미입력)")}</b>
                <span class="cn-sign-sub">${a.cat ? `<span class="badge ${CAT_BADGE[a.cat] || "badge-gray"}">${esc(a.cat)}</span> ` : ""}${esc(a.org || "")}${a.role ? " · " + esc(a.role) : ""}</span>
              </div>
              <div class="cn-sign-act">
                ${a.sign
                  ? `<img class="cn-sign-thumb" src="${esc(a.sign)}" alt="서명"><span class="cn-sign-ok">✅ 완료</span><button class="btn btn-ghost btn-sm" data-sign="${i}">다시</button>`
                  : `<button class="btn btn-primary btn-sm" data-sign="${i}">✍️ 서명하기</button>`}
              </div>
            </div>`).join("") : '<div class="empty">등록된 참석자가 없습니다. 진행자에게 문의하세요.</div>'}
        </div>
        <div class="cn-sign-foot">서명은 저장 즉시 반영됩니다. 완료 후 창을 닫으셔도 됩니다.</div>
      </div>`;
    $$(".cn-sign-list [data-sign]").forEach(btn => btn.onclick = () => openSignPad(meetingId, Number(btn.dataset.sign)));
  }

  /* 서명 저장 — 최신 상태(실시간 병합분 포함) 재조회 후 해당 참석자에만 기록 */
  function setSign(meetingId, idx, val) {
    const m = all().find(c => c.id === meetingId);
    if (!m || !Array.isArray(m.attendees) || !m.attendees[idx]) return false;
    m.attendees[idx].sign = val || "";
    SeMIS.save();
    return true;
  }

  /* 서명 패드 — 캔버스에 손가락/마우스로 그린 뒤 Storage 업로드(실패 시 dataURL) */
  function openSignPad(meetingId, idx) {
    const m = all().find(c => c.id === meetingId);
    if (!m || !Array.isArray(m.attendees) || !m.attendees[idx]) return;
    const a = m.attendees[idx];
    openModal(`
      <h3>✍️ ${esc(a.name || "참석자")} 서명</h3>
      <div class="form-hint" style="margin-bottom:8px">${a.org ? esc(a.org) : ""}${a.role ? " · " + esc(a.role) : ""} — 아래 칸에 손가락 또는 마우스로 서명해 주세요.</div>
      <div class="sign-pad-wrap"><canvas id="cn-sign-cv" class="sign-pad"></canvas></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cn-sign-clear" style="margin-right:auto">지우기</button>
        <button class="btn btn-ghost" id="cn-sign-cancel">취소</button>
        <button class="btn btn-primary" id="cn-sign-ok">저장</button>
      </div>`);
    const cv = $("#cn-sign-cv");
    if (!cv) return;
    const wrapW = (cv.parentElement && cv.parentElement.clientWidth) || 300;
    const cssW = Math.max(240, Math.min(wrapW, 440));
    const cssH = 180;
    const ratio = window.devicePixelRatio || 1;
    cv.style.width = cssW + "px"; cv.style.height = cssH + "px";
    cv.width = Math.round(cssW * ratio); cv.height = Math.round(cssH * ratio);
    const ctx = cv.getContext ? cv.getContext("2d") : null;
    if (ctx) { ctx.scale(ratio, ratio); ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a"; }
    let drawing = false, hasDrawn = false, lx = 0, ly = 0;
    const pos = (ev) => { const r = cv.getBoundingClientRect(); const t = (ev.touches && ev.touches[0]) || ev; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
    const down = (ev) => { ev.preventDefault(); drawing = true; const p = pos(ev); lx = p.x; ly = p.y; };
    const moveFn = (ev) => { if (!drawing || !ctx) return; ev.preventDefault(); const p = pos(ev); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(p.x, p.y); ctx.stroke(); lx = p.x; ly = p.y; hasDrawn = true; };
    const up = () => { drawing = false; };
    if (cv.addEventListener) {
      if (window.PointerEvent) {
        // 포인터 이벤트 하나로 터치·마우스·펜 모두 처리(중복 방지)
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
    $("#cn-sign-clear").onclick = () => { if (ctx) ctx.clearRect(0, 0, cssW, cssH); hasDrawn = false; };
    $("#cn-sign-cancel").onclick = () => { cleanup(); closeModal(); SeMIS.renderView(); };
    $("#cn-sign-ok").onclick = () => {
      if (!hasDrawn) { toast("서명을 입력해 주세요.", true); return; }
      const finish = (val) => { cleanup(); setSign(meetingId, idx, val); closeModal(); toast("서명이 저장되었습니다."); SeMIS.renderView(); };
      const dataFallback = () => { try { finish(cv.toDataURL("image/png")); } catch (e) { toast("서명 저장에 실패했습니다.", true); } };
      try {
        if (cv.toBlob && window.SemisSync && typeof fetch !== "undefined") {
          cv.toBlob((blob) => {
            if (!blob) return dataFallback();
            (async () => {
              try {
                const file = new File([blob], "sign_" + Date.now() + ".png", { type: "image/png" });
                const up = await SemisSync.uploadFile(file, "council-sign");
                finish(up.url);
              } catch (e) { dataFallback(); }
            })();
          }, "image/png");
        } else dataFallback();
      } catch (e) { dataFallback(); }
    };
  }

  /* ══════════ 모듈 렌더 ══════════ */
  SeMIS.registerModule("council", {
    title: "보안장비 협의회",
    render(root) {
      const u = SeMIS.user;
      if (u && u.role === "signer") { renderSigning(root, u.signMeetingId); return; }
      const s = stats();
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🤝 보안장비 협의회</div>
          <span class="spacer"></span>
          ${canWrite() ? '<button class="btn btn-primary" id="cn-add">+ 회의록 작성</button>' : ""}
          <div class="page-desc">인천화물터미널 B동 보안검색장비 관리 협의회 회의록 — 총 ${s.total}회</div>
        </div>
        <div class="council-banner">
          <span class="cb-ico">🎯</span>
          <div class="cb-body">
            <b>KPI 과제 C6-1 기반 운영</b>
            <div>「내부 보안 관리 체계 보완」(안전보안 C6-1)의 <i>보안장비 협의체 신설</i> 활동입니다. 제조사·유지보수·운영사·본사가 매월 모여 X-ray·ETD 등 보안검색장비의 고장 원인 분석과 사용환경 개선을 공동 논의합니다.</div>
          </div>
          ${canSeeKpi() ? '<button class="btn btn-ghost btn-sm" id="cn-kpi">C6-1 과제 보기 →</button>' : ""}
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-label">총 회의</div><div class="stat-value">${s.total}</div><div class="stat-sub">누적 개최</div></div>
          <div class="stat"><div class="stat-label">${s.yr}년 개최</div><div class="stat-value" style="color:var(--primary)">${s.thisYear}</div><div class="stat-sub">올해 회의</div></div>
          <div class="stat"><div class="stat-label">누적 사례</div><div class="stat-value">${s.cases}</div><div class="stat-sub">고장·수리 분석</div></div>
          <div class="stat"><div class="stat-label">미완료 결정</div><div class="stat-value" style="color:${s.openAct ? "var(--warning)" : "var(--success)"}">${s.openAct}</div><div class="stat-sub">액션 아이템</div></div>
        </div>
        <div class="card"><div id="cn-body">${listHTML()}</div></div>`;

      if (canWrite()) $("#cn-add").onclick = () => form(null);
      if (canSeeKpi() && $("#cn-kpi")) $("#cn-kpi").onclick = () => SeMIS.navigate("kpi");
      $$("#cn-body [data-cn-row]").forEach(el => el.onclick = () => detail(el.dataset.cnRow));
    }
  });

  /* ══════════ 테스트/외부 노출 ══════════ */
  window.SemisCouncil = { CATS, stats, all, sorted, nextRound, printMinutes, setSign, renderSigning };
})();
