#!/usr/bin/env node
/* 릴리스 버전 스탬프 — 사용: node tools/bump-version.cjs 2.31.3
   1) js/app.js 의 VERSION 갱신
   2) index.html 의 로컬 css/js 참조에 ?v=<버전> 부여 (브라우저 캐시 무효화)
   ※ 캐시 스탬프가 없으면 배포 후에도 구버전 CSS/JS가 남아 화면이 갱신되지 않습니다. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ver = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(ver || "")) {
  console.error("사용법: node tools/bump-version.cjs <major.minor.patch>");
  process.exit(1);
}

const appPath = path.join(ROOT, "js/app.js");
let app = fs.readFileSync(appPath, "utf8");
const before = app;
app = app.replace(/const VERSION = "\d+\.\d+\.\d+";/, `const VERSION = "${ver}";`);
if (app === before) { console.error("js/app.js 의 VERSION 선언을 찾지 못했습니다."); process.exit(1); }
fs.writeFileSync(appPath, app);

const htmlPath = path.join(ROOT, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");
let n = 0;
html = html.replace(/(href|src)="((?:css|js)\/[\w.-]+\.(?:css|js))(?:\?v=[\d.]+)?"/g, (m, attr, file) => {
  n++;
  return `${attr}="${file}?v=${ver}"`;
});
fs.writeFileSync(htmlPath, html);
console.log(`v${ver} — app.js VERSION 갱신, index.html 캐시 스탬프 ${n}건 적용`);
