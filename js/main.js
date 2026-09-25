/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 시작 (v2.53)
   콘텐츠 보안 정책(CSP: 인라인 스크립트 금지)으로 index.html 에 있던 시작 코드를 옮겼다.
   동기화는 로그인·세션 확인 뒤 app.js 가 시작한다.
   ═══════════════════════════════════════════════════════ */
"use strict";
SeMIS.boot();
if (window.SemisSearch) SemisSearch.init();
if (window.SemisCalendar) SemisCalendar.startReminders();
