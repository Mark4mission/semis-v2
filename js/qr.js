/* ═══════════════════════════════════════════════════════
   SeMIS v2 — QR 코드 생성기 (v2.40)
   외부 라이브러리·CDN 없이 동작하는 순수 JS QR 인코더.
   (사내망/CDN 차단 환경에서도 서명 QR이 반드시 떠야 하므로 자체 구현)

   지원: QR Model 2 / 8-bit Byte 모드(UTF-8) / 버전 1~10 / ECC L·M·Q·H
        마스크 0~7 자동 선택(ISO/IEC 18004 벌점 규칙)
   용도: 회의 서명 접속 URL(≈40자)·짧은 링크 — 버전 3 이하로 충분

   API:
     SemisQR.matrix(text, {ecc})      → { size, get(r,c) } 불리언 모듈 배열
     SemisQR.svg(text, {ecc,size,margin,dark,light,label})  → SVG 문자열
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  /* ─── 버전별 총 코드워드 수 (데이터+ECC) ─── */
  const TOTAL_CW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

  /* ─── 버전·ECC별 블록 구성: [ecPerBlock, blocks1, data1, blocks2, data2] ─── */
  const ECB = {
    L: [null,
      [7, 1, 19], [10, 1, 34], [15, 1, 55], [20, 1, 80], [26, 1, 108],
      [18, 2, 68], [20, 2, 78], [24, 2, 97], [30, 2, 116], [18, 2, 68, 2, 69]],
    M: [null,
      [10, 1, 16], [16, 1, 28], [26, 1, 44], [18, 2, 32], [24, 2, 43],
      [16, 4, 27], [18, 4, 31], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]],
    Q: [null,
      [13, 1, 13], [22, 1, 22], [18, 2, 17], [26, 2, 24], [18, 2, 15, 2, 16],
      [24, 4, 19], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19], [20, 4, 16, 4, 17], [24, 6, 19, 2, 20]],
    H: [null,
      [17, 1, 9], [28, 1, 16], [22, 2, 13], [16, 4, 9], [22, 2, 11, 2, 12],
      [28, 4, 15], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15], [24, 4, 12, 4, 13], [28, 6, 15, 2, 16]]
  };

  /* ─── 정렬 패턴 중심 좌표 (버전 1~10) ─── */
  const ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  /* ─── 버전 정보 18비트 (버전 7~10) ─── */
  const VER_INFO = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };

  /* ─── ECC 지시자 2비트 ─── */
  const ECC_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  /* ══════════ GF(256) 산술 ══════════ */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;           // 원시다항식 x^8+x^4+x^3+x^2+1
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /* 생성 다항식 g(x) = ∏(x - α^i) */
  function rsPoly(deg) {
    let p = [1];
    for (let i = 0; i < deg; i++) {
      const np = new Array(p.length + 1).fill(0);
      for (let j = 0; j < p.length; j++) {
        np[j] ^= gmul(p[j], 1);            // ×x 항
        np[j + 1] ^= gmul(p[j], EXP[i]);
      }
      // 위 루프는 (p*x) + (p*α^i) 를 계산 — 자리 이동 보정
      p = np;
    }
    return p;
  }
  /* 리드-솔로몬 ECC 코드워드 */
  function rsEncode(data, ecLen) {
    const gen = rsPoly(ecLen);
    const res = new Array(ecLen).fill(0);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ res[0];
      res.shift(); res.push(0);
      if (factor !== 0) for (let j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j + 1], factor);
    }
    return res;
  }

  /* ══════════ 인코딩 ══════════ */
  function utf8Bytes(str) {
    const s = String(str);
    if (typeof TextEncoder !== "undefined") return Array.from(new TextEncoder().encode(s));
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        const c2 = s.charCodeAt(++i);
        c = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  const dataCapacity = (ver, ecc) => {
    const b = ECB[ecc][ver];
    const blocks = b[1] + (b[3] || 0);
    return TOTAL_CW[ver] - b[0] * blocks;
  };
  /* Byte 모드 문자수 지시자 길이: 버전 1~9 = 8비트, 10 이상 = 16비트 */
  const lenBits = (ver) => (ver < 10 ? 8 : 16);

  function pickVersion(byteLen, ecc) {
    for (let v = 1; v <= 10; v++) {
      const need = 4 + lenBits(v) + byteLen * 8;
      if (need <= dataCapacity(v, ecc) * 8) return v;
    }
    return 0;
  }

  /* 비트 스트림 → 데이터 코드워드 */
  function buildData(bytes, ver, ecc) {
    const cap = dataCapacity(ver, ecc);
    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(4, 4);                       // 모드: 8-bit byte
    push(bytes.length, lenBits(ver)); // 문자 수
    bytes.forEach(b => push(b, 8));
    // 종단자 0000 (최대 4비트)
    for (let i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      cw.push(v);
    }
    const PAD = [0xEC, 0x11];
    for (let i = 0; cw.length < cap; i++) cw.push(PAD[i % 2]);
    return cw;
  }

  /* 블록 분할 → 인터리브 (데이터 + ECC) */
  function interleave(data, ver, ecc) {
    const b = ECB[ecc][ver];
    const ecLen = b[0];
    const spec = [];
    for (let i = 0; i < b[1]; i++) spec.push(b[2]);
    for (let i = 0; i < (b[3] || 0); i++) spec.push(b[4]);
    const dBlocks = [], eBlocks = [];
    let p = 0;
    spec.forEach(n => {
      const blk = data.slice(p, p + n); p += n;
      dBlocks.push(blk);
      eBlocks.push(rsEncode(blk, ecLen));
    });
    const out = [];
    const maxD = Math.max.apply(null, spec);
    for (let i = 0; i < maxD; i++) dBlocks.forEach(blk => { if (i < blk.length) out.push(blk[i]); });
    for (let i = 0; i < ecLen; i++) eBlocks.forEach(blk => out.push(blk[i]));
    return out;
  }

  /* ══════════ 매트릭스 배치 ══════════ */
  function newGrid(size) {
    const m = [], f = [];
    for (let i = 0; i < size; i++) { m.push(new Array(size).fill(0)); f.push(new Array(size).fill(false)); }
    return { m, f };
  }
  function setFinder(g, size, r0, c0) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const r1 = r0 + r, c1 = c0 + c;
      if (r1 < 0 || c1 < 0 || r1 >= size || c1 >= size) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      g.m[r1][c1] = (inRing || inCore) ? 1 : 0;
      g.f[r1][c1] = true;
    }
  }
  function setAlign(g, ver) {
    const pos = ALIGN[ver];
    const last = pos.length - 1;
    for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      const r0 = pos[i], c0 = pos[j];
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
        const ring = Math.max(Math.abs(r), Math.abs(c));
        g.m[r0 + r][c0 + c] = (ring !== 1) ? 1 : 0;
        g.f[r0 + r][c0 + c] = true;
      }
    }
  }
  function setTiming(g, size) {
    for (let i = 8; i < size - 8; i++) {
      const v = (i % 2 === 0) ? 1 : 0;
      if (!g.f[6][i]) { g.m[6][i] = v; g.f[6][i] = true; }
      if (!g.f[i][6]) { g.m[i][6] = v; g.f[i][6] = true; }
    }
  }
  /* 포맷 정보 자리 예약(다크 모듈 포함) */
  function reserveFormat(g, size) {
    for (let i = 0; i <= 8; i++) {
      if (i !== 6) { g.f[8][i] = true; g.f[i][8] = true; }
    }
    g.f[8][6] = true; g.f[6][8] = true;
    for (let i = 0; i < 8; i++) { g.f[8][size - 1 - i] = true; g.f[size - 1 - i][8] = true; }
    g.m[size - 8][8] = 1; g.f[size - 8][8] = true;   // 항상 검정인 다크 모듈
  }
  function reserveVersion(g, size, ver) {
    if (ver < 7) return;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
      g.f[i][size - 11 + j] = true;
      g.f[size - 11 + j][i] = true;
    }
  }
  function placeVersion(g, size, ver) {
    if (ver < 7) return;
    const bits = VER_INFO[ver];
    for (let i = 0; i < 18; i++) {
      const b = (bits >> i) & 1;
      const r = Math.floor(i / 3), c = i % 3;
      g.m[r][size - 11 + c] = b;
      g.m[size - 11 + c][r] = b;
    }
  }
  /* 데이터 비트 지그재그 배치 */
  function placeData(g, size, cw) {
    let bitIdx = 0, up = true;
    const bitAt = (i) => (i >> 3) < cw.length ? ((cw[i >> 3] >> (7 - (i & 7))) & 1) : 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;            // 세로 타이밍 열 건너뜀
      for (let vert = 0; vert < size; vert++) {
        const row = up ? (size - 1 - vert) : vert;
        for (let k = 0; k < 2; k++) {
          const col = right - k;
          if (g.f[row][col]) continue;
          g.m[row][col] = bitAt(bitIdx++);
          g.f[row][col] = true;
        }
      }
      up = !up;
    }
  }
  const MASK_FN = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];
  /* 포맷 정보 15비트 (BCH(15,5) + 마스크 0x5412) */
  function formatBits(ecc, mask) {
    const data = (ECC_BITS[ecc] << 3) | mask;
    let d = data << 10;
    for (let i = 4; i >= 0; i--) if ((d >> (10 + i)) & 1) d ^= 0x537 << i;
    return ((data << 10) | d) ^ 0x5412;
  }
  function placeFormat(g, size, ecc, mask) {
    const bits = formatBits(ecc, mask);
    for (let i = 0; i < 15; i++) {
      const b = (bits >> i) & 1;
      // 좌상단 사본 — 비트 역순 배치 (MSB가 (8,0))
      const j = 14 - i;
      if (j < 6) g.m[8][j] = b;
      else if (j === 6) g.m[8][7] = b;
      else if (j === 7) g.m[8][8] = b;
      else if (j === 8) g.m[7][8] = b;
      else g.m[14 - j][8] = b;
      // 우상단(가로) / 좌하단(세로) 사본
      if (i < 8) g.m[8][size - 1 - i] = b;
      else g.m[size - 15 + i][8] = b;
    }
    g.m[size - 8][8] = 1;
  }
  /* 벌점 계산 (ISO 규칙 1~4) */
  function penalty(m, size) {
    let score = 0;
    // 규칙 1: 같은 색 5칸 이상 연속
    for (let i = 0; i < size; i++) {
      let rRun = 1, cRun = 1;
      for (let j = 1; j < size; j++) {
        rRun = (m[i][j] === m[i][j - 1]) ? rRun + 1 : 1;
        if (rRun === 5) score += 3; else if (rRun > 5) score += 1;
        cRun = (m[j][i] === m[j - 1][i]) ? cRun + 1 : 1;
        if (cRun === 5) score += 3; else if (cRun > 5) score += 1;
      }
    }
    // 규칙 2: 2×2 동색 블록
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
    // 규칙 3: 1:1:3:1:1 패턴 + 4칸 공백
    const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const match = (get, i, j, pat) => {
      for (let k = 0; k < 11; k++) if (get(i, j + k) !== pat[k]) return false;
      return true;
    };
    const rowGet = (i, j) => m[i][j], colGet = (i, j) => m[j][i];
    for (let i = 0; i < size; i++) for (let j = 0; j + 11 <= size; j++) {
      if (match(rowGet, i, j, P1) || match(rowGet, i, j, P2)) score += 40;
      if (match(colGet, i, j, P1) || match(colGet, i, j, P2)) score += 40;
    }
    // 규칙 4: 흑백 비율 편차
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  /* ══════════ 공개 API ══════════ */
  function matrix(text, opts) {
    const o = opts || {};
    const ecc = ECB[o.ecc] ? o.ecc : "M";
    const bytes = utf8Bytes(text);
    let ver = o.version && ECB[ecc][o.version] ? o.version : pickVersion(bytes.length, ecc);
    if (!ver) throw new Error("QR: 내용이 너무 깁니다 (버전 10 초과)");
    const size = ver * 4 + 17;
    const cw = interleave(buildData(bytes, ver, ecc), ver, ecc);

    // 기능 패턴 (마스크 후보 공통)
    const base = newGrid(size);
    setFinder(base, size, 0, 0);
    setFinder(base, size, 0, size - 7);
    setFinder(base, size, size - 7, 0);
    setAlign(base, ver);
    setTiming(base, size);
    reserveFormat(base, size);
    reserveVersion(base, size, ver);

    // 기능·예약 모듈 지도 — 마스크 적용 대상에서 제외 (데이터 배치 전에 복사)
    const isFunc = base.f.map(row => row.slice());

    placeData(base, size, cw);
    placeVersion(base, size, ver);

    // 마스크 자동 선택 (벌점 최소)
    let best = null;
    for (let mk = 0; mk < 8; mk++) {
      const g = { m: base.m.map(r => r.slice()) };
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
        if (!isFunc[r][c] && MASK_FN[mk](r, c)) g.m[r][c] ^= 1;
      }
      placeFormat(g, size, ecc, mk);
      const s = penalty(g.m, size);
      if (!best || s < best.score) best = { score: s, m: g.m, mask: mk };
    }
    const M = best.m;
    return {
      size, version: ver, ecc, mask: best.mask,
      get: (r, c) => !!(M[r] && M[r][c]),
      rows: M
    };
  }

  /* SVG 문자열 (인쇄·화면 공용, 확대해도 깨지지 않음) */
  function svg(text, opts) {
    const o = opts || {};
    const qr = matrix(text, o);
    const margin = o.margin == null ? 4 : o.margin;   // quiet zone (모듈 단위)
    const dim = qr.size + margin * 2;
    const px = o.size || 220;
    const dark = o.dark || "#0f172a";
    const light = o.light || "#ffffff";
    let path = "";
    for (let r = 0; r < qr.size; r++) {
      let c = 0;
      while (c < qr.size) {
        if (!qr.get(r, c)) { c++; continue; }
        let len = 1;
        while (c + len < qr.size && qr.get(r, c + len)) len++;
        path += `M${c + margin} ${r + margin}h${len}v1h-${len}z`;
        c += len;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${dim} ${dim}" ` +
      `shape-rendering="crispEdges" role="img" aria-label="${(o.label || "QR 코드").replace(/[<>&"]/g, "")}">` +
      `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
      `<path d="${path}" fill="${dark}"/></svg>`;
  }

  /* data: URI (img src 용) */
  function dataUri(text, opts) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg(text, opts));
  }

  const api = { matrix, svg, dataUri, _formatBits: formatBits, _pickVersion: pickVersion, _dataCapacity: dataCapacity };
  if (typeof window !== "undefined") window.SemisQR = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
