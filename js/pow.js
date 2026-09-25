/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 로그인 작업증명(PoW) (v2.53)
   서버가 서명한 문제 c 와 난이도 d 를 받아, sha256(c + ":" + x) 의 앞 d 비트가 0 인
   정수 x 를 찾는다. 자동 대입 공격의 비용을 올리려는 것이고, 사람에게는 보이지 않는다
   (로그인 창이 뜨면 암호를 입력하는 동안 미리 푼다).

   - 이 파일 하나가 두 역할을 한다: 화면에서는 window.SemisPow, Web Worker 안에서는 계산기.
     (CSP script-src 'self' — 같은 출처 파일이라 Worker 로 다시 불러올 수 있다)
   - 앞부분(c 의 첫 64바이트)은 한 번만 계산해 두고, 후보마다 뒷부분 블록만 계산한다.
   - Worker 를 쓸 수 없으면 화면에서 잘게 나눠 계산한다(화면이 멈추지 않게).
   ═══════════════════════════════════════════════════════ */
"use strict";

(function (root) {
  const K = new Int32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const IV = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const W = new Int32Array(64);

  /* 64바이트 블록 하나를 state(Int32Array 8)에 반영 */
  function block(st, b, off) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      W[i] = (b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15], y = W[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = st[0], bb = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], h = st[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const mj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    st[0] = (st[0] + a) | 0; st[1] = (st[1] + bb) | 0; st[2] = (st[2] + c) | 0; st[3] = (st[3] + d) | 0;
    st[4] = (st[4] + e) | 0; st[5] = (st[5] + f) | 0; st[6] = (st[6] + g) | 0; st[7] = (st[7] + h) | 0;
  }

  /* 문제 준비 — 접두 "c:" 의 완전한 블록은 미리 계산 */
  function prep(c) {
    const p = String(c) + ":";
    const bytes = [];
    for (let i = 0; i < p.length; i++) bytes.push(p.charCodeAt(i) & 0xff);   // 문제는 ASCII
    const full = Math.floor(bytes.length / 64);
    const mid = new Int32Array(IV);
    const arr = Uint8Array.from(bytes);
    for (let i = 0; i < full; i++) block(mid, arr, i * 64);
    return { mid, rest: arr.slice(full * 64), total: bytes.length, done: full * 64 };
  }
  const buf = new Uint8Array(192);
  const st = new Int32Array(8);
  /* 후보 x 의 해시 첫 32비트 */
  function firstWord(P, xs) {
    const rl = P.rest.length, xl = xs.length, n = rl + xl;
    buf.set(P.rest, 0);
    for (let i = 0; i < xl; i++) buf[rl + i] = xs.charCodeAt(i);
    const len = P.total + xl;                       // 전체 길이(바이트)
    const blocks = n + 9 <= 64 ? 1 : n + 9 <= 128 ? 2 : 3;
    const end = blocks * 64;
    buf[n] = 0x80;
    for (let i = n + 1; i < end; i++) buf[i] = 0;
    const bits = len * 8;
    buf[end - 4] = (bits >>> 24) & 0xff; buf[end - 3] = (bits >>> 16) & 0xff;
    buf[end - 2] = (bits >>> 8) & 0xff; buf[end - 1] = bits & 0xff;
    st.set(P.mid);
    for (let b = 0; b < blocks; b++) block(st, buf, b * 64);
    return st[0] >>> 0;
  }
  function ok(P, x, d) { return (firstWord(P, String(x)) >>> (32 - d)) === 0; }

  /* from 부터 limit 개 후보를 검사 — 찾으면 x, 없으면 -1 */
  function scan(P, d, from, limit) {
    const shift = 32 - d;
    for (let x = from, end = from + limit; x < end; x++) {
      if ((firstWord(P, String(x)) >>> shift) === 0) return x;
    }
    return -1;
  }

  /* 전체 sha256 (확인·테스트용) */
  function sha256hex(s) {
    const bytes = [];
    const u = unescape(encodeURIComponent(String(s)));
    for (let i = 0; i < u.length; i++) bytes.push(u.charCodeAt(i));
    const n = bytes.length, blocks = Math.ceil((n + 9) / 64), out = new Uint8Array(blocks * 64);
    out.set(bytes); out[n] = 0x80;
    const bits = n * 8;
    out[out.length - 4] = (bits >>> 24) & 0xff; out[out.length - 3] = (bits >>> 16) & 0xff;
    out[out.length - 2] = (bits >>> 8) & 0xff; out[out.length - 1] = bits & 0xff;
    const h = new Int32Array(IV);
    for (let b = 0; b < blocks; b++) block(h, out, b * 64);
    return Array.from(h, v => (v >>> 0).toString(16).padStart(8, "0")).join("");
  }

  /* ─── Web Worker 로 실행 중이면: 계산기 ─── */
  const inWorker = typeof root.importScripts === "function" && typeof root.document === "undefined";
  if (inWorker) {
    root.onmessage = function (ev) {
      const m = ev.data || {};
      const P = prep(m.c);
      const d = Number(m.d) || 16;
      let x = Number(m.from) || 0;
      const step = 200000;
      for (;;) {
        const r = scan(P, d, x, step);
        if (r >= 0) { root.postMessage({ x: r }); return; }
        x += step;
        if (x > 4e9) { root.postMessage({ error: "none" }); return; }
      }
    };
    return;
  }

  /* ─── 화면: SemisPow.solve(c, d) → Promise<x> ─── */
  function solveInline(c, d, from) {
    const P = prep(c);
    let x = from || 0;
    return new Promise((resolve, reject) => {
      const tick = () => {
        const r = scan(P, d, x, 20000);             // 약 5~20ms 씩
        if (r >= 0) { resolve(r); return; }
        x += 20000;
        if (x > 4e9) { reject(new Error("pow")); return; }
        setTimeout(tick, 0);
      };
      tick();
    });
  }
  function workerUrl() {
    try {
      const s = root.document && root.document.querySelector('script[src*="js/pow.js"]');
      if (s) return s.getAttribute("src");
    } catch (e) { /* 무시 */ }
    return "js/pow.js";
  }
  function solve(c, d) {
    const from = 0;
    if (typeof root.Worker === "function") {
      return new Promise((resolve) => {
        let w = null, done = false;
        const fallback = () => { if (done) return; done = true; try { if (w) w.terminate(); } catch (e) {} solveInline(c, d, from).then(resolve, () => resolve(-1)); };
        try {
          w = new root.Worker(workerUrl());
          w.onmessage = (ev) => {
            if (done) return;
            const m = ev.data || {};
            if (typeof m.x === "number") { done = true; try { w.terminate(); } catch (e) {} resolve(m.x); }
            else fallback();
          };
          w.onerror = fallback;
          w.postMessage({ c, d, from });
        } catch (e) { fallback(); }
      }).then(x => { if (x < 0) throw new Error("pow"); return x; });
    }
    return solveInline(c, d, from);
  }

  root.SemisPow = { solve, solveInline, scan, prep, ok, firstWord, sha256hex };
})(typeof self !== "undefined" ? self : this);
