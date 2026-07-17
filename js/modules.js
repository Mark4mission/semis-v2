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
      const upcoming = [];
      d.schedules.forEach(s => {
        const rep = s.repeat && s.repeat.freq && s.repeat.freq !== "none";
        if (rep && window.SemisCalendar) {
          const occ = SemisCalendar.nextOccurrence(s, todayISO());
          if (occ) upcoming.push(Object.assign({}, s, { start: occ.start, end: occ.end }));
        } else if ((s.end || s.start) >= todayISO()) upcoming.push(s);
      });
      upcoming.sort((a, b) => String(a.start).localeCompare(String(b.start)));
      upcoming.length = Math.min(upcoming.length, 5);
      const quicks = SeMIS.sortedMenus().filter(m => (m.type === "link" || m.type === "module") && m.quick && SeMIS.canSee(m));

      const cur = SeMIS.secCurrent();
      const nxt = SeMIS.secNext();
      root.innerHTML = `
        <div class="page-head">
          <div class="page-title">🏠 대시보드</div>
          <div class="page-desc">에어제타 보안종합정보시스템 — ${esc(fmtDate(new Date().toISOString()))}</div>
        </div>
        <div class="dash-grid">
          <div class="dash-col">
            <div class="card">
              <div class="card-title">📢 공지사항 <span class="spacer"></span>
                ${canWrite ? '<button class="btn btn-primary btn-sm" id="btn-add-notice">+ 새 공지</button>' : ""}
              </div>
              <div id="notice-list"></div>
            </div>
            ${window.SemisEquipment && SemisEquipment.renderDash ? `<div class="card">
              <div class="card-title">🔧 보안장비 · 고장신고 <span class="spacer"></span>
                <button class="btn btn-ghost btn-sm" id="btn-go-equip">전체보기</button>
                <a class="btn btn-ghost btn-sm" href="https://airzeta-security-system.web.app" target="_blank" rel="noopener">CARES ↗</a>
              </div>
              <div id="equip-box"></div>
            </div>` : ""}
            ${window.SemisCares ? `<div class="card">
              <div class="card-title">🌡 CARES 환경센서 <span class="spacer"></span>
                ${canWrite ? '<button class="btn btn-ghost btn-sm" id="btn-cares-cfg" title="연동 설정">⚙</button>' : ""}
                <a class="btn btn-ghost btn-sm" href="https://airzeta-security-system.web.app" target="_blank" rel="noopener">CARES ↗</a>
              </div>
              <div id="cares-box"></div>
            </div>` : ""}
          </div>
          <div class="dash-col">
            <div class="card">
              <div class="card-title">🚨 보안등급 <span class="spacer"></span>
                ${canWrite ? '<button class="btn btn-ghost btn-sm" id="btn-edit-level">변경</button>' : ""}
              </div>
              <div id="level-box"></div>
            </div>
            <div class="card">
              <div class="card-title">🕵️ 보안점검 실적 <span class="spacer"></span>
                <button class="btn btn-ghost btn-sm" id="btn-go-insp">전체보기</button></div>
              <div id="insp-box"></div>
            </div>
            <div class="card">
              <div class="card-title">⏳ 만료 · 점검 도래</div>
              <div id="expiry-box"></div>
            </div>
            <div class="card">
              <div class="card-title">⚡ 바로가기</div>
              <div class="quick-links">
                ${quicks.map(m => m.type === "module"
                  ? `<a class="quick-link" href="#/${esc(m.module)}">
                  <span>${esc(m.icon || "▪")}</span><span>${esc(m.label)}</span></a>`
                  : `<a class="quick-link" href="${esc(m.url)}" target="_blank" rel="noopener">
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
      const hist = SeMIS.levelSorted().slice().reverse().slice(0, 6);
      const lvRange = (e2) => {
        if (!e2.date) return "";
        if (!e2.end) return e2.date + " ~";
        const sameYear = e2.end.slice(0, 4) === e2.date.slice(0, 4);
        return e2.date + " ~ " + (sameYear ? e2.end.slice(5) : e2.end);
      };
      $("#level-box").innerHTML = `
        <p style="font-size:.9rem"><b>현재 등급:</b> <span class="badge ${lvColor(cur.level)}">${esc(cur.level)}</span>
          <span style="font-size:.78rem;color:var(--text-3)">${esc(lvRange(cur))}</span></p>
        <p style="font-size:.82rem;color:var(--text-2);margin-top:5px">${esc(cur.note || "비고 없음")}</p>
        ${nxt ? `<p style="font-size:.82rem;margin-top:8px;padding:7px 10px;background:var(--primary-soft);border-radius:6px">
          ⏰ <b>변경 예약:</b> ${esc(nxt.date)}부터 <span class="badge ${lvColor(nxt.level)}">${esc(nxt.level)}</span>${nxt.end ? " (" + esc(nxt.end) + "까지)" : ""}</p>` : ""}
        <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px">
          <div style="font-size:.74rem;font-weight:700;color:var(--text-3);margin-bottom:4px">변경 이력</div>
          ${hist.map(e => `<div class="lv-row${e.end && e.end < todayISO() ? " expired" : ""}">
            <span class="lv-range">${esc(lvRange(e))}</span>
            <span class="badge ${lvColor(e.level)} lv-badge">${esc(e.level)}</span>
            <span class="lv-note">${esc(e.note || "")}</span>
            ${canWrite && hist.length > 1 ? `<button class="mt-btn danger" data-lvdel="${esc(e.id)}" title="삭제">✕</button>` : "<span></span>"}
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
        const filesHtml = (n.files && n.files.length)
          ? `<div class="nb-files-view">${n.files.map(f =>
              `<a class="nb-file" href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>`).join("")}</div>` : "";
        item.innerHTML = `
          <div class="notice-title">${n.pinned ? '<span class="badge badge-red">고정</span>' : ""}${n.files && n.files.length ? "📎" : ""}<span>${esc(n.title)}</span></div>
          <div class="notice-meta">${esc(n.author)} · ${esc(fmtDate(n.created))}</div>
          <div class="notice-body">${n.bodyHtml ? `<div class="notice-html">${sanitizeHtml(n.bodyHtml)}</div>` : esc(n.body)}
            ${filesHtml}
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

      // 보안점검 실적
      const insp = (d.inspections || []).filter(x => x.category !== "주요일정" && x.status !== "취소");
      const done = insp.filter(x => x.status === "완료").length;
      const thisMonth = new Date().getMonth() + 1;
      const monthList = (d.inspections || []).filter(x => x.month === thisMonth && x.category !== "주요일정");
      // 점검 결과 유형별 통계 (시정조치/개선권고/현장시정/관찰사항)
      const fdCnt = {};
      (d.inspections || []).forEach(x => (x.findings || []).forEach(f => { fdCnt[f.type] = (fdCnt[f.type] || 0) + 1; }));
      const FD_ORDER = (window.SemisInspection && SemisInspection.FINDING_TYPES) || ["시정조치", "개선권고", "현장시정", "관찰사항"];
      $("#insp-box").innerHTML = `
        <div style="display:flex;align-items:baseline;gap:8px">
          <span style="font-size:1.25rem;font-weight:800">${done}<span style="font-size:.85rem;color:var(--text-3)"> / ${insp.length}건</span></span>
          <span style="font-size:.78rem;color:var(--text-2)">완료 (계획 대비 ${insp.length ? Math.round(done / insp.length * 100) : 0}%)</span>
        </div>
        <div class="insp-bar"><div class="insp-bar-fill" style="width:${insp.length ? Math.round(done / insp.length * 100) : 0}%"></div></div>
        <div class="insp-fdgrid">${FD_ORDER.map((t, i) =>
          `<div class="insp-fdcell"><b class="fd-c${i + 1}">${fdCnt[t] || 0}</b><span>${esc(t)}</span></div>`).join("")}</div>
        <div style="font-size:.74rem;font-weight:700;color:var(--text-3);margin:10px 0 4px">이번 달 (${thisMonth}월)</div>
        ${monthList.length ? monthList.map(x => `
          <div class="insp-dash-row" data-insp-open="${esc(x.id)}" title="클릭하여 세부 확인"
            style="display:flex;align-items:center;gap:6px;font-size:.8rem;padding:3px 0;cursor:pointer">
            <span class="badge ${x.status === "완료" ? "badge-green" : x.status === "연기" ? "badge-amber" : x.status === "취소" ? "badge-gray" : "badge-blue"}" style="flex-shrink:0">${esc(x.status)}</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">[${esc(x.category)}] ${esc(x.target)}</span>
            ${window.SemisInspection ? `<span style="flex-shrink:0;white-space:nowrap">${SemisInspection.fdSummary(x)}</span>` : ""}
          </div>`).join("") : '<div style="font-size:.8rem;color:var(--text-3)">이번 달 예정 점검이 없습니다.</div>'}`;
      $("#btn-go-insp").onclick = () => SeMIS.navigate("inspection");
      $$("#insp-box [data-insp-open]").forEach(el => el.onclick = () => {
        if (window.SemisInspection) SemisInspection.open(el.dataset.inspOpen);
      });

      // 만료 · 점검 도래 (출입증/계약/장비 통합, v2.8)
      {
        const dl = (ds) => ds ? Math.round((new Date(ds) - new Date(todayISO())) / 86400000) : null;
        const items = [];
        (d.passes || []).forEach(x => {
          if (x.status !== "사용중" || !x.expire) return;
          const dd = dl(x.expire);
          if (dd <= 30) items.push({ d: dd, route: "passes", ico: "🪪", label: `출입증 · ${x.holder}${x.company ? " (" + x.company + ")" : ""}` });
        });
        if (canWrite) (d.contracts || []).forEach(x => {
          if (x.status === "해지" || !x.end) return;
          const dd = dl(x.end);
          if (dd <= 60) items.push({ d: dd, route: "contracts-mgmt", ico: "💼", label: `계약 · ${x.name}` });
        });
        (d.equipment || []).forEach(x => {
          if (x.status === "폐기" || !window.SemisEquipment || !SemisEquipment.replaceDue) return;
          const n = SemisEquipment.replaceDue(x);
          const dd = dl(n);
          if (dd !== null && dd <= 90) items.push({ d: dd, route: "equipment", ico: "🔧", label: `장비 내용연수 · ${x.name}` });
        });
        items.sort((a, b) => a.d - b.d);
        items.length = Math.min(items.length, 8);
        $("#expiry-box").innerHTML = items.length
          ? items.map(it => `<div class="insp-dash-row" data-exp-go="${esc(it.route)}" title="클릭하여 이동"
              style="display:flex;align-items:center;gap:6px;font-size:.8rem;padding:3px 0;cursor:pointer">
              <span class="badge ${it.d < 0 ? "badge-red" : it.d <= 30 ? "badge-amber" : "badge-gray"}" style="flex-shrink:0">${it.d < 0 ? "D+" + (-it.d) : "D-" + it.d}</span>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${it.ico} ${esc(it.label)}</span>
            </div>`).join("")
          : '<div style="font-size:.8rem;color:var(--text-3)">30일 내 만료 예정 항목이 없습니다.</div>';
        $$("#expiry-box [data-exp-go]").forEach(el => el.onclick = () => SeMIS.navigate(el.dataset.expGo));
      }

      // 보안장비 · 고장신고 위젯 (CARES 마스터)
      if (window.SemisEquipment && SemisEquipment.renderDash && $("#equip-box")) {
        SemisEquipment.renderDash($("#equip-box"));
        if ($("#btn-go-equip")) $("#btn-go-equip").onclick = () => SeMIS.navigate("equipment");
      }

      // CARES 환경센서 위젯
      if (window.SemisCares && $("#cares-box")) {
        SemisCares.renderInto($("#cares-box"), canWrite);
        if (canWrite && $("#btn-cares-cfg")) $("#btn-cares-cfg").onclick = () => SemisCares.settingsForm();
      }

      // 일정
      $("#upcoming-box").innerHTML = upcoming.length
        ? upcoming.map(s => `<div style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid var(--border);font-size:.86rem">
            <span class="cal-dot ev-${esc(s.color || "blue")}"></span>
            <b style="color:var(--primary);white-space:nowrap">${esc(String(s.start).slice(5))}${s.end && s.end !== s.start ? "~" + esc(String(s.end).slice(5)) : ""}</b>
            ${!s.allDay && s.time ? `<span style="font-size:.76rem;color:var(--text-3);white-space:nowrap">${esc(s.time)}</span>` : ""}
            <span style="${s.done ? "text-decoration:line-through;color:var(--text-3);" : ""}flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.done ? "✓ " : ""}${s.vehicle ? "🚗" : ""}${s.room ? "🏢" : ""}${(s.reminders && s.reminders.length) ? "⏰" : ""}${esc(s.title)}</span>
            ${s.assignee ? `<span class="badge badge-gray" style="margin-left:auto;flex-shrink:0;white-space:nowrap">${esc(s.assignee)}</span>` : ""}</div>`).join("")
        : '<div class="empty">예정된 일정이 없습니다.</div>';
      $("#btn-go-schedule").onclick = () => SeMIS.navigate("schedule");

      if (canWrite) {
        $("#btn-add-notice").onclick = () => noticeForm(null);
        $("#btn-edit-level").onclick = levelForm;
      }
    }
  });

  /* ───── 공지 HTML 살균 (script/이벤트핸들러/javascript: 제거) ───── */
  function sanitizeHtml(html) {
    const box = document.createElement("div");
    box.innerHTML = String(html || "");
    box.querySelectorAll("script,style,iframe,object,embed,form,link,meta,base").forEach(x => x.remove());
    box.querySelectorAll("*").forEach(el => {
      Array.from(el.attributes).forEach(a => {
        const nm = a.name.toLowerCase();
        if (nm.indexOf("on") === 0) el.removeAttribute(a.name);
        else if ((nm === "href" || nm === "src" || nm === "xlink:href") && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      });
    });
    return box.innerHTML;
  }
  /* ───── 리치 에디터 공용: 붙여넣기/드래그앤드롭 파일·이미지 삽입 ───── */
  function wireRichMedia(ed, prefix) {
    const insert = (html) => {
      ed.focus();
      try { if (!document.execCommand("insertHTML", false, html)) ed.innerHTML += html; }
      catch (e) { ed.innerHTML += html; }
    };
    async function addFiles(fileList) {
      for (const f of Array.from(fileList || [])) {
        try {
          if (/^image\//.test(f.type)) {
            const slim = await shrinkImage(f, 1400);
            if (window.SemisSync && typeof fetch !== "undefined") {
              const up = await SemisSync.uploadFile(slim, prefix);
              insert(`<img src="${esc(up.url)}" alt="${esc(f.name)}">`);
            } else {
              await new Promise((res) => {
                const r = new FileReader();
                r.onload = () => { insert(`<img src="${r.result}" alt="">`); res(); };
                r.onerror = () => res();
                r.readAsDataURL(slim);
              });
            }
          } else {
            if (f.size > 10 * 1024 * 1024) { toast(f.name + ": 10MB를 초과합니다.", true); continue; }
            if (!window.SemisSync || typeof fetch === "undefined") { toast("오프라인에서는 파일 첨부가 불가합니다.", true); continue; }
            const up = await SemisSync.uploadFile(f, prefix);
            insert(`<a class="nb-file" href="${esc(up.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>&nbsp;`);
          }
          toast("추가되었습니다: " + f.name);
        } catch (err) { toast("업로드 실패: " + f.name, true); }
      }
    }
    ed.addEventListener("paste", (ev) => {
      const files = ev.clipboardData && ev.clipboardData.files;
      if (files && files.length) { ev.preventDefault(); addFiles(files); }
    });
    ed.addEventListener("dragover", (ev) => ev.preventDefault());
    ed.addEventListener("drop", (ev) => {
      const files = ev.dataTransfer && ev.dataTransfer.files;
      if (files && files.length) { ev.preventDefault(); addFiles(files); }
    });
    return { insert, addFiles };
  }

  window.SemisNotice = { sanitizeHtml, shrinkImage, wireRichMedia };

  /* ───── 이미지 축소(1400px, JPEG) — 실패 시 원본 유지 ───── */
  function shrinkImage(file, maxW) {
    return new Promise((resolve) => {
      if (!/^image\//.test(file.type) || /gif|svg/.test(file.type) || file.size < 300 * 1024) return resolve(file);
      let url;
      try { url = URL.createObjectURL(file); } catch (e) { return resolve(file); }
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, (maxW || 1400) / img.width);
          const cv = document.createElement("canvas");
          cv.width = Math.round(img.width * scale);
          cv.height = Math.round(img.height * scale);
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(url);
          cv.toBlob(b => resolve(b ? new File([b], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file), "image/jpeg", 0.82);
        } catch (e) { resolve(file); }
      };
      img.onerror = () => { try { URL.revokeObjectURL(url); } catch (e) {} resolve(file); };
      img.src = url;
    });
  }

  function noticeForm(id) {
    const n = id ? D().notices.find(x => x.id === id) : null;
    let files = n && Array.isArray(n.files) ? n.files.slice() : [];
    openModal(`
      <h3>${n ? "공지 수정" : "새 공지 작성"}</h3>
      <div class="form-row"><label>제목</label><input id="f-title" value="${esc(n ? n.title : "")}" maxlength="120"></div>
      <div class="form-row"><label>내용</label>
        <div class="nb-toolbar">
          <button type="button" data-cmd="bold" title="굵게"><b>B</b></button>
          <button type="button" data-cmd="italic" title="기울임"><i>I</i></button>
          <button type="button" data-cmd="underline" title="밑줄"><u>U</u></button>
          <button type="button" data-cmd="strikeThrough" title="취소선"><s>S</s></button>
          <span class="nb-sep"></span>
          <button type="button" data-cmd="insertUnorderedList" title="글머리 목록">•—</button>
          <button type="button" data-cmd="insertOrderedList" title="번호 목록">1.—</button>
          <span class="nb-sep"></span>
          <button type="button" id="nb-table" title="표 삽입 (3×3)">⊞ 표</button>
          <button type="button" id="nb-img" title="이미지 삽입">🖼 이미지</button>
          <button type="button" id="nb-link" title="선택 영역에 링크">🔗 링크</button>
        </div>
        <div id="nb-editor" class="nb-editor" contenteditable="true"></div>
        <input type="file" id="nb-imgfile" accept="image/*" style="display:none">
        <div class="form-hint">서식·표·이미지를 지원합니다. 이미지는 공용 저장소에 업로드되어 모든 사용자에게 표시됩니다.</div></div>
      <div class="form-row"><label>파일 첨부</label>
        <div id="nb-filelist" class="nb-files-view"></div>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer">📎 파일 추가 (10MB 이하)
          <input type="file" id="nb-attach" style="display:none" multiple></label></div>
      <div class="form-row"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="f-pinned" style="width:auto" ${n && n.pinned ? "checked" : ""}> 상단 고정</label></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">저장</button>
      </div>`, { wide: true });

    const ed = $("#nb-editor");
    ed.innerHTML = n ? (n.bodyHtml || esc(n.body || "").replace(/\n/g, "<br>")) : "";
    wireRichMedia(ed, "notices"); // 붙여넣기/드래그앤드롭 이미지·파일

    const exec = (cmd, val) => { ed.focus(); try { document.execCommand(cmd, false, val); } catch (e) {} };
    const insertHTML = (h) => {
      ed.focus();
      try { if (!document.execCommand("insertHTML", false, h)) ed.innerHTML += h; }
      catch (e) { ed.innerHTML += h; }
    };
    $$(".nb-toolbar [data-cmd]").forEach(b => {
      b.onmousedown = (ev) => ev.preventDefault(); // 에디터 선택 영역 유지
      b.onclick = () => exec(b.dataset.cmd);
    });
    $("#nb-table").onclick = () => {
      const row = "<tr>" + "<td>&nbsp;</td>".repeat(3) + "</tr>";
      insertHTML(`<table class="nb-table"><tbody>${row.repeat(3)}</tbody></table><p><br></p>`);
    };
    $("#nb-link").onclick = () => {
      let url = "";
      try { url = window.prompt("링크 주소(URL)를 입력하세요", "https://") || ""; } catch (e) {}
      if (/^https?:\/\/.+/.test(url)) exec("createLink", url);
    };
    $("#nb-img").onclick = () => $("#nb-imgfile").click();
    $("#nb-imgfile").onchange = async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = "";
      if (!file) return;
      toast("이미지 처리 중…");
      try {
        const slim = await shrinkImage(file, 1400);
        if (!window.SemisSync) throw new Error("no-sync");
        const up = await SemisSync.uploadFile(slim, "notices");
        insertHTML(`<img src="${esc(up.url)}" alt="${esc(file.name)}">`);
        toast("이미지가 삽입되었습니다.");
      } catch (err) {
        // 오프라인 폴백: 문서 내장 (500KB 이하만)
        try {
          const slim = await shrinkImage(file, 800);
          if (slim.size > 500 * 1024) throw new Error("too big");
          const reader = new FileReader();
          reader.onload = () => { insertHTML(`<img src="${reader.result}" alt="">`); toast("오프라인: 이미지를 문서에 내장했습니다."); };
          reader.onerror = () => toast("이미지 삽입 실패", true);
          reader.readAsDataURL(slim);
        } catch (e2) { toast("이미지 삽입 실패 — 네트워크를 확인하세요.", true); }
      }
    };

    const renderFileList = () => {
      $("#nb-filelist").innerHTML = files.map((f, i) =>
        `<span class="nb-file">📎 ${esc(f.name)} <button type="button" class="mt-btn danger" data-frm="${i}" title="첨부 삭제">✕</button></span>`).join("") ||
        '<span class="form-hint">첨부된 파일이 없습니다.</span>';
      $$("#nb-filelist [data-frm]").forEach(b => b.onclick = () => { files.splice(Number(b.dataset.frm), 1); renderFileList(); });
    };
    renderFileList();
    $("#nb-attach").onchange = async (ev) => {
      const list = Array.from(ev.target.files || []);
      ev.target.value = "";
      for (const f of list) {
        if (f.size > 10 * 1024 * 1024) { toast(f.name + ": 10MB를 초과합니다.", true); continue; }
        if (!window.SemisSync) { toast("오프라인에서는 파일을 첨부할 수 없습니다.", true); break; }
        try {
          toast("업로드 중: " + f.name);
          const up = await SemisSync.uploadFile(f, "attach");
          files.push(up); renderFileList();
          toast("첨부되었습니다: " + f.name);
        } catch (err) { toast("업로드 실패: " + f.name, true); }
      }
    };

    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const title = $("#f-title").value.trim();
      if (!title) { toast("제목을 입력하세요.", true); return; }
      const bodyHtml = sanitizeHtml(ed.innerHTML);
      const tmp = document.createElement("div");
      tmp.innerHTML = bodyHtml;
      const body = (tmp.textContent || "").trim(); // 검색/구버전 호환용 텍스트 (살균 후 추출)
      const pinned = $("#f-pinned").checked;
      if (n) Object.assign(n, { title, body, bodyHtml, pinned, files });
      else D().notices.push({ id: uid("n"), title, body, bodyHtml, pinned, files,
        author: SeMIS.user.name, created: new Date().toISOString() });
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
      <div class="form-grid">
        <div class="form-row"><label>시작일 (적용일)</label><input type="date" id="f-date" value="${esc(todayISO())}"></div>
        <div class="form-row"><label>종료일 (선택)</label><input type="date" id="f-end"></div>
      </div>
      <div class="form-hint" style="margin:-6px 0 12px">미래 시작일을 지정하면 <b>변경 예약</b>이 됩니다.
        종료일을 지정하면 그 다음 날부터 이전의 무기한 등급으로 자동 복귀하며, 비우면 다음 변경 시까지 적용됩니다.</div>
      <div class="form-row"><label>비고 (근거 등)</label><input id="f-note" maxlength="100" placeholder="예: 국토부 지침 제2026-OO호"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="f-cancel">취소</button>
        <button class="btn btn-primary" id="f-save">저장</button>
      </div>`);
    $("#f-cancel").onclick = closeModal;
    $("#f-save").onclick = () => {
      const date = $("#f-date").value;
      const end = $("#f-end").value;
      if (!date) { toast("시작일을 입력하세요.", true); return; }
      if (end && end < date) { toast("종료일이 시작일보다 빠릅니다.", true); return; }
      D().levelHistory.push({
        id: uid("lv"), date, end: end || "", level: $("#f-level").value,
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
      <div class="form-row" id="row-quick" ${type !== "link" && type !== "module" ? 'style="display:none"' : ""}>
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
        // 내부 모듈: 이름/아이콘/권한/그룹/바로가기만 수정 가능
        Object.assign(m, { label, icon, parent: $("#f-parent").value || null, vis: $("#f-vis").value,
          quick: $("#f-quick") ? $("#f-quick").checked : !!m.quick });
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
