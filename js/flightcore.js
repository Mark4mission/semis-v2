/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 운항 현황 계산 계층 (v2.54, SeMIS · Logistics v1.14 의 js/flightcore.js 와 같은 파일)
   화면 없이 계산만 한다 — 공항 좌표 · 대권 거리/방위 · 기체 상태 판정 · 입출항 기록 정리.
   화면은 js/flight.js 가 그린다. 공항 목록·판정 규칙을 고칠 때는 Logistics 와 함께 고친다.

   데이터: Supabase Edge Function "semis-logi-adsb" (adsb.lol ADS-B, ODbL)
     ac[]     기체별 마지막 상태 { hex, reg, type, flight, lat, lon, alt, gnd, gnd_inferred, gs, trk, vr, sqk, emg,
                                   pos_at, seen_at, gnd_since, air_since, trail? }
     events[] 입출항 기록 { hex, reg, flight, kind: dep|arr, apt, at, inferred } — 지상↔공중 전환을 서버가 감지
   스케줄 파일에 기대지 않는다(매달 바뀌는 스케줄을 손으로 넣지 않도록). 기체 목록만 관리한다.
   ═══════════════════════════════════════════════════════ */
"use strict";

(() => {
  const HOME = "ICN";

  /* 공항 — [위도, 경도, 한글 이름]. 입출항 판정(반경 12km)과 이름 표시에 쓴다.
     에어제타 취항지 + 대체·경유로 쓸 만한 화물 공항. 서버(semis-logi-adsb)에도 같은 목록이 있다. */
  const AIRPORTS = {
    ICN: [37.4602, 126.4407, "인천"], GMP: [37.5583, 126.7906, "김포"], PUS: [35.1795, 128.9382, "김해"],
    CJU: [33.5113, 126.493, "제주"], CJJ: [36.7166, 127.4991, "청주"], TAE: [35.8941, 128.6589, "대구"], MWX: [34.9914, 126.3828, "무안"],
    NRT: [35.772, 140.3929, "나리타"], HND: [35.5494, 139.7798, "하네다"], KIX: [34.4347, 135.244, "간사이"],
    NGO: [34.8584, 136.8054, "주부"], FUK: [33.5859, 130.4507, "후쿠오카"], CTS: [42.7752, 141.6923, "신치토세"], OKA: [26.1958, 127.6459, "나하"],
    PVG: [31.1443, 121.8083, "상하이 푸둥"], SHA: [31.1979, 121.3363, "상하이 훙차오"], PEK: [40.0799, 116.6031, "베이징"],
    PKX: [39.5098, 116.4105, "베이징 다싱"], TSN: [39.1244, 117.3464, "톈진"], YNT: [37.6572, 120.9872, "옌타이"],
    TAO: [36.3619, 120.0883, "칭다오"], CTU: [30.5785, 103.9471, "청두"], TFU: [30.3197, 104.445, "청두 톈푸"],
    CAN: [23.3924, 113.2988, "광저우"], SZX: [22.6393, 113.8107, "선전"], XMN: [24.544, 118.1277, "샤먼"],
    HGH: [30.2295, 120.4344, "항저우"], NKG: [31.742, 118.862, "난징"], CGO: [34.5197, 113.8409, "정저우"],
    WUH: [30.7838, 114.2081, "우한"], SHE: [41.6398, 123.4834, "선양"], DLC: [38.9657, 121.5386, "다롄"],
    CKG: [29.7192, 106.6417, "충칭"], XIY: [34.4471, 108.7516, "시안"], KMG: [25.1019, 102.9292, "쿤밍"], TNA: [36.8572, 117.2158, "지난"],
    HKG: [22.308, 113.9185, "홍콩"], MFM: [22.1496, 113.5916, "마카오"], TPE: [25.0797, 121.2342, "타이베이"], KHH: [22.5771, 120.35, "가오슝"],
    HAN: [21.2212, 105.8072, "하노이"], SGN: [10.8188, 106.6519, "호찌민"], DAD: [16.0439, 108.1994, "다낭"],
    BKK: [13.69, 100.7501, "방콕"], DMK: [13.9126, 100.6067, "방콕 돈므앙"], SIN: [1.3644, 103.9915, "싱가포르"],
    KUL: [2.7456, 101.7072, "쿠알라룸푸르"], MNL: [14.5086, 121.0198, "마닐라"], CRK: [15.186, 120.56, "클라크"],
    CGK: [-6.1256, 106.6559, "자카르타"], DAC: [23.8433, 90.3978, "다카"], DEL: [28.5562, 77.1, "델리"],
    BOM: [19.0896, 72.8656, "뭄바이"], MAA: [12.9941, 80.1709, "첸나이"],
    ALA: [43.3521, 77.0405, "알마티"], NQZ: [51.0222, 71.4669, "아스타나"], TAS: [41.2579, 69.2812, "타슈켄트"],
    NVI: [40.1172, 65.1708, "나보이"], DXB: [25.2532, 55.3657, "두바이"], DWC: [24.8961, 55.1614, "두바이 알막툼"],
    DOH: [25.2731, 51.6081, "도하"], IST: [41.2753, 28.7519, "이스탄불"],
    STN: [51.885, 0.235, "런던 스탠스테드"], LHR: [51.47, -0.4543, "런던 히스로"], FRA: [50.0379, 8.5622, "프랑크푸르트"],
    HHN: [49.9487, 7.2639, "프랑크푸르트 한"], VIE: [48.1103, 16.5697, "비엔나"], MXP: [45.6306, 8.7281, "밀라노"],
    BRU: [50.9014, 4.4844, "브뤼셀"], LGG: [50.6374, 5.4432, "리에주"], AMS: [52.3105, 4.7683, "암스테르담"],
    CDG: [49.0097, 2.5479, "파리"], LUX: [49.6233, 6.2044, "룩셈부르크"], MUC: [48.3538, 11.7861, "뮌헨"],
    BUD: [47.4298, 19.2611, "부다페스트"], WAW: [52.1657, 20.9671, "바르샤바"], PRG: [50.1008, 14.26, "프라하"],
    LEJ: [51.4239, 12.2363, "라이프치히"], CGN: [50.8659, 7.1427, "쾰른"], MAD: [40.4983, -3.5676, "마드리드"],
    ANC: [61.1743, -149.9982, "앵커리지"], FAI: [64.8151, -147.8561, "페어뱅크스"], SEA: [47.4502, -122.3088, "시애틀"],
    LAX: [33.9416, -118.4085, "로스앤젤레스"], SFO: [37.6213, -122.379, "샌프란시스코"], ONT: [34.056, -117.6012, "온타리오"],
    LAS: [36.084, -115.1537, "라스베이거스"], ORD: [41.9742, -87.9073, "시카고"], RFD: [42.1954, -89.0972, "록퍼드"],
    DFW: [32.8998, -97.0403, "댈러스"], IAH: [29.9902, -95.3368, "휴스턴"], ATL: [33.6407, -84.4277, "애틀랜타"],
    JFK: [40.6413, -73.7781, "뉴욕"], EWR: [40.6895, -74.1745, "뉴어크"], MIA: [25.7959, -80.287, "마이애미"],
    CVG: [39.0488, -84.6678, "신시내티"], IND: [39.7173, -86.2944, "인디애나폴리스"], MEM: [35.0421, -89.9792, "멤피스"],
    SDF: [38.1744, -85.736, "루이빌"], HNL: [21.3187, -157.9225, "호놀룰루"], GUM: [13.4834, 144.796, "괌"],
    YVR: [49.1967, -123.1815, "밴쿠버"], YYZ: [43.6777, -79.6248, "토론토"]
  };
  const apt = (c) => {
    const a = AIRPORTS[c];
    return a ? { code: c, lat: a[0], lon: a[1], name: a[2] } : null;
  };
  const aptName = (c) => (AIRPORTS[c] ? AIRPORTS[c][2] : (c || ""));

  const AC_TYPES = { B744: "B747-400F", B763: "B767-300F", B738: "B737-800SF" };

  /* 에어제타 기체 15대 기본값(2026-09 기준) — 등록부호 · ICAO 24비트 주소는 공개 정보(tar1090-db로 대조).
     기체가 들고 나면 운항 현황 화면의 '기체 목록'에서 고친다(공용 DB fleet). */
  const DEFAULT_FLEET = [
    ["HL7417", "71bc17", "B744", "747-400BDSF"], ["HL7419", "71bc19", "B744", "747-400F"],
    ["HL7420", "71bc20", "B744", "747-400F"], ["HL7421", "71bc21", "B744", "747-400SF"],
    ["HL7423", "71bc23", "B744", "747-400BDSF"], ["HL7436", "71bc36", "B744", "747-400F"],
    ["HL7616", "71be16", "B744", "747-400F"], ["HL7620", "71be20", "B744", "747-400SF"],
    ["HL7645", "71be45", "B744", "747-400F"], ["HL7646", "71be46", "B744", "747-400F"],
    ["HL7507", "71bd07", "B763", "767-300F"],
    ["HL8319", "71c319", "B738", "737-800SF"], ["HL8338", "71c338", "B738", "737-800SF"],
    ["HL8355", "71c355", "B738", "737-800SF"], ["HL8503", "71c503", "B738", "737-800SF"]
  ].map(r => ({ reg: r[0], hex: r[1], type: r[2], model: r[3] }));

  /* 한국 등록부호 → ICAO 24비트 주소 (확인된 규칙만: HL7Nyy → 71B{8+N}yy, HL8xyz → 71Cxyz). 그 밖은 "" */
  function hlHex(reg) {
    const r = String(reg || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    let m = /^HL7([2-7])(\d{2})$/.exec(r);
    if (m) return "71b" + (8 + Number(m[1])).toString(16) + m[2];
    m = /^HL8(\d{3})$/.exec(r);
    if (m) return "71c" + m[1];
    return "";
  }
  const normHex = (h) => String(h || "").toLowerCase().replace(/[^0-9a-f]/g, "");

  /* 콜사인 AIH970 → 편명 KJ970 */
  const fnoOf = (cs) => {
    const s = String(cs || "").trim().toUpperCase();
    const m = /^AIH0*(\d{1,4})([A-Z]?)$/.exec(s);
    return m ? "KJ" + m[1] + m[2] : s;
  };

  /* ─────────── 시각 (한국 시간) ─────────── */
  const KST = 9 * 3600000;
  const kstISO = (ms) => new Date(ms + KST).toISOString().slice(0, 10);
  const kstHM = (ms) => new Date(ms + KST).toISOString().slice(11, 16);
  const kstDayStart = (ms) => Date.parse(kstISO(ms) + "T00:00:00+09:00");
  function ago(ms, now) {
    const s = Math.max(0, Math.round(((now || Date.now()) - ms) / 1000));
    if (s < 90) return "방금";
    const m = Math.round(s / 60);
    if (m < 60) return m + "분 전";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "시간" + (m % 60 && h < 6 ? " " + (m % 60) + "분" : "") + " 전";
    return Math.floor(h / 24) + "일 전";
  }
  const until = (ms, now) => {
    const m = Math.max(0, Math.round((ms - (now || Date.now())) / 60000));
    return m < 60 ? m + "분" : Math.floor(m / 60) + "시간 " + (m % 60) + "분";
  };

  /* ─────────── 대권 항로 ─────────── */
  const R = 6371.0088, rad = Math.PI / 180, deg = 180 / Math.PI;
  function dist(a, b) {
    const p1 = a.lat * rad, p2 = b.lat * rad, dp = p2 - p1, dl = (b.lon - a.lon) * rad;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function bearing(a, b) {
    const p1 = a.lat * rad, p2 = b.lat * rad, dl = (b.lon - a.lon) * rad;
    const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * deg + 360) % 360;
  }
  /* 점 p에서 방위 brg(도)로 km 만큼 간 지점 */
  function destPoint(p, brg, km) {
    const d = km / R, t = brg * rad, p1 = p.lat * rad, l1 = p.lon * rad;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
    const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 * deg, lon: ((l2 * deg + 540) % 360) - 180 };
  }
  const angDiff = (x, y) => Math.abs(((x - y) % 360 + 540) % 360 - 180);
  function nearestApt(p, maxKm) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return "";
    let best = "", bd = Infinity;
    Object.keys(AIRPORTS).forEach(c => { const d = dist(p, apt(c)); if (d < bd) { bd = d; best = c; } });
    return bd <= (maxKm == null ? 12 : maxKm) ? best : "";
  }
  /* 방위 → 8방위 한글 */
  const DIR8 = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  const dir8 = (b) => DIR8[Math.round(((b % 360) + 360) % 360 / 45) % 8];

  /* ─────────── 기체 상태 판정 ───────────
     code: emg 비상 부호 · appr 인천 접근 중 · air 비행 중 · gnd 지상 · lost 신호 없음(마지막이 비행 중) · none 수신 기록 없음
     인천 접근 중 = 비행 중 · 인천 250km 안 · 인천 쪽으로 진행(방위 차 60° 이하) · 강하 중(-300ft/min 이하)이거나 15,000ft 이하(상승 중 제외) */
  const LIVE_MS = 4 * 60000;
  const APPR_KM = 250;
  const DR_MAX_MS = 3 * 3600000;   // 신호가 끊긴 뒤 직진 추정은 3시간까지만
  const EMG = { "7500": "7500 불법 간섭", "7600": "7600 통신 두절", "7700": "7700 비상" };

  function status(row, now) {
    now = now || Date.now();
    if (!row || !row.seen_at) return { code: "none", label: "수신 기록 없음", tone: "gray", live: false };
    const seen = Date.parse(row.seen_at);
    const age = now - seen;
    const live = age <= LIVE_MS;
    const has = Number.isFinite(row.lat) && Number.isFinite(row.lon);
    const p = has ? { lat: row.lat, lon: row.lon } : null;
    const home = apt(HOME);
    const st = { live, age, seen, pos: p, dHome: p ? dist(p, home) : null };
    if (live && row.emg) return Object.assign(st, { code: "emg", tone: "red", label: EMG[row.sqk] || "비상 부호" });
    if (row.gnd) {
      const at = nearestApt(p, 15);
      return Object.assign(st, { code: "gnd", at, tone: at === HOME ? "blue" : "gray",
        label: (at ? aptName(at) : "공항") + " 지상", since: row.gnd_since ? Date.parse(row.gnd_since) : null });
    }
    if (!p) return Object.assign(st, { code: "none", label: "위치 없음", tone: "gray" });
    if (live) {
      const toHome = row.trk != null ? angDiff(row.trk, bearing(p, home)) : 999;
      const vr = row.vr == null ? null : Number(row.vr);
      const low = row.alt != null && row.alt <= 15000 && (vr == null || vr < 300);
      if (st.dHome <= APPR_KM && toHome <= 60 && ((vr != null && vr <= -300) || low)) {
        const v = Math.max(180, row.gs || 0) * 1.852 / 3600000;
        return Object.assign(st, { code: "appr", tone: "amber", label: "인천 접근 중", eta: seen + st.dHome / v + 4 * 60000 });
      }
      return Object.assign(st, { code: "air", tone: "green", label: "비행 중" });
    }
    // 공항 15km 안 · 3,000ft 이하에서 끊김 → 착륙으로 본다(서버도 10분 뒤 지상으로 확정)
    const at = row.alt != null && row.alt <= 3000 ? nearestApt(p, 15) : "";
    if (at) return Object.assign(st, { code: "gnd", at, tone: at === HOME ? "blue" : "gray", inferred: true,
      label: aptName(at) + " 착륙 추정", since: seen });
    // 신호 없음 — 순항 고도(10,000ft 이상)에서 끊겼으면 마지막 방위·속도로 직진했다고 보고 3시간까지만 추정
    const out = Object.assign(st, { code: "lost", tone: "gray", label: "신호 없음" });
    if (row.trk != null && row.gs > 150 && row.alt != null && row.alt >= 10000 && age <= DR_MAX_MS) {
      out.est = destPoint(p, row.trk, row.gs * 1.852 * age / 3600000);
    }
    return out;
  }

  /* 입출항 기록 정리 — 오늘(한국 시간) 인천 도착·출발, 기체별 마지막 출발 */
  function eventsOf(events, opts) {
    const o = opts || {};
    const t0 = o.since || 0;
    return (events || []).filter(e => e && e.at && Date.parse(e.at) >= t0 &&
      (!o.kind || e.kind === o.kind) && (!o.apt || e.apt === o.apt) && (!o.hex || e.hex === o.hex))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }
  /* 기체의 이번 비행 출발지 — 마지막 출발 기록이 마지막 도착 기록보다 뒤면 그 출발 */
  function lastDep(events, hex) {
    const ev = eventsOf(events, { hex });
    const d = ev.find(e => e.kind === "dep"), a = ev.find(e => e.kind === "arr");
    if (!d) return null;
    if (a && Date.parse(a.at) > Date.parse(d.at)) return null;
    return d;
  }

  const api = {
    HOME, AIRPORTS, AC_TYPES, DEFAULT_FLEET, EMG, LIVE_MS, APPR_KM, DR_MAX_MS,
    apt, aptName, hlHex, normHex, fnoOf, kstISO, kstHM, kstDayStart, ago, until,
    dist, bearing, destPoint, angDiff, nearestApt, dir8, status, eventsOf, lastDep
  };
  if (typeof window !== "undefined") window.SemisFlightCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
