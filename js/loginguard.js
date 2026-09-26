/* ═══════════════════════════════════════════════════════
   SeMIS — 로그인 창 보호 (v2.54.1 · Logistics v1.17.1, 두 시스템 같은 파일)
   로그인 창은 앱 스크립트보다 먼저 화면에 나온다. 스크립트가 다 읽히기 전에 암호를 넣고
   Enter·로그인을 누르면 브라우저가 폼을 그대로 보내 페이지가 새로고침되고 암호가 지워졌다
   (반응이 없는 것처럼 보여 두세 번 눌러야 접속되던 문제).
   이 파일만 <head> 에서 먼저 읽혀 그 제출을 붙잡아 두고, 앱이 준비되면 app.js 가 이어서 로그인한다.
   ═══════════════════════════════════════════════════════ */
"use strict";
(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__semisReady === undefined) window.__semisReady = false;
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (!f || f.id !== "login-form" || window.__semisReady) return;
    e.preventDefault();
    var pw = document.getElementById("login-pw");
    if (!pw || !pw.value) return;
    window.__semisLoginQueued = true;
    var er = document.getElementById("login-error");
    if (er) er.textContent = "확인 중…";
  }, true);
})();
