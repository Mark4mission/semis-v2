/* SeMIS v2 — 대금청구 연간 비교표 브라우저 검증 하네스 (v2.39)
   사용: node tests/billing-year-harness.cjs  → /tmp/billing-year-verify.html 생성 후 브라우저로 확인
   로그인 없이 실제 billing.js 를 jsdom 으로 렌더해 유지보수비 대장 실측치와 표 형태를 대조한다. */
const path = require("path"); process.chdir(path.join(__dirname, ".."));

// run-tests 는 실행 시 즉시 테스트를 돌리므로 재사용 대신 최소 복제
const fs = require("fs");
const { JSDOM, VirtualConsole } = require("jsdom");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const HTML = read("index.html");
const files = ["app.js","modules.js","calendar.js","inspection.js","carcap.js","contracts.js","branches.js","passes.js","equipment.js","training.js","certs.js","regulations.js","officers.js","seclevel.js","iosa.js","passdocs.js","policy.js","contacts.js","billing.js","council.js","vault.js","cares.js","news.js","chat.js","search.js","kpi.js","sync.js"];
const src = files.map(f => read("js/" + f)).join("\n;");
const vc = new VirtualConsole();
const dom = new JSDOM(HTML, { url: "https://semis.test/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
try { const wc = require("crypto").webcrypto; if (!w.crypto || !w.crypto.subtle) Object.defineProperty(w, "crypto", { value: wc, configurable: true }); } catch(e){}

// 대장 실측치 (2024 OZ+BX 단독 / 2025 통합출범 병행 / 2026 KJ 단독)
const L = {
 "2024-10": {"OZ+BX":[12433667,13000000,0]}, "2024-11": {"OZ+BX":[12394333,0,0]},
 "2024-12": {"OZ+BX":[12355000,0,0]},
 "2025-01": {"OZ+BX":[12315667,0,14500000]}, "2025-02": {"OZ+BX":[12276333,8300000,0]},
 "2025-03": {"OZ+BX":[13194000,9100000,0]}, "2025-04": {"OZ+BX":[13154667,19100000,0]},
 "2025-05": {"OZ+BX":[13115333,9500000,0]}, "2025-06": {"OZ+BX":[13076000,8500000,0]},
 "2025-07": {"OZ+BX":[13036667,9500000,9500000]},
 "2025-08": {"OZ+BX":[8590667,8900000,0], "KJ":[5270000,0,5000000]},
 "2025-09": {"OZ+BX":[8564667,0,0], "KJ":[5253333,0,0]},
 "2025-10": {"OZ+BX":[8538667,0,0], "KJ":[5236667,0,0]},
 "2025-11": {"OZ+BX":[8512667,0,0], "KJ":[5220000,0,0]},
 "2025-12": {"OZ+BX":[8486667,0,0], "KJ":[5203333,0,0]},
 "2026-01": {"KJ":[5186667,0,6125000]}, "2026-02": {"KJ":[5170000,4500000,0]},
 "2026-03": {"KJ":[1320000,6000000,0]}, "2026-04": {"KJ":[1320000,0,6125000]},
 "2026-05": {"KJ":[1320000,0,0]}, "2026-06": {"KJ":[1320000,0,0]}, "2026-07": {"KJ":[1320000,0,6125000]}
};
const KIND = ["정기 유지보수","수리/부품","소모품"];
const TITLE = ["장비 잔존가+수선유지비","부품교체건","소모품비"];
const bl = []; let n = 0;
Object.keys(L).forEach(m => Object.keys(L[m]).forEach(g => L[m][g].forEach((amt, i) => {
  if (amt) bl.push({ id: "d"+(n++), vendor:"프로에스콤", month:m, category:"ETD 유지보수",
    title: TITLE[i]+" ("+g+")", amount: amt, costKind: KIND[i], equipGroup: g,
    files:[], fileUrl:"", fileName:"", note:"", by:"대장", updated:"2026-08-05T00:00:00.000Z" });
})));
w.eval(src);
const S = w.SeMIS; S.boot();
S.data.customUsers.push({ id:"thq", name:"검증HQ", role:"hq", hash: S.pwHash("verifypw-1") });
S.data.billing = bl; S.saveSilent();
w.document.querySelector("#login-pw").value = "verifypw-1";
w.document.querySelector("#login-form").dispatchEvent(new w.Event("submit", { bubbles:true, cancelable:true }));
w.SemisBilling.setVendor("프로에스콤"); w.SemisBilling.setMonth("2026-07"); w.SemisBilling.setView("year");
w.location.hash = "#/billing"; S.renderView();
const view = w.document.querySelector("#view") || w.document.body;
const css = read("css/main.css");
const yearHTML = (y, cap) => { w.SemisBilling.setYear(y); S.renderView();
  return `<hr style="margin:32px 0"><h2 style="font:700 1rem/1.4 system-ui;margin:0 0 12px">${y}년 — ${cap}</h2>`
    + (w.document.querySelector("#view") || w.document.body).innerHTML; };
const out = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>연간 비교표 검증</title><style>${css}</style>
<style>body{padding:24px;background:var(--bg,#fff)}</style></head><body class="">
<h2 style="font:700 1rem/1.4 system-ui;margin:0 0 12px">2026년 — KJ 단독 (OZ+BX 열 없음)</h2>
${view.innerHTML}
${yearHTML(2025, "통합출범 전환 구간 · OZ+BX / KJ 병행")}
${yearHTML(2024, "통합 이전 · OZ+BX 단독")}
</body></html>`;
const outPath = process.env.OUT || "/tmp/billing-year-verify.html";
fs.writeFileSync(outPath, out);
console.log("rows:", bl.length, "→", outPath, out.length, "bytes");

process.exit(0);
