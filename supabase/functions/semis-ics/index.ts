// SeMIS v2 — ICS 구독 피드 (SeMIS 일정 → Google 캘린더 'URL로 추가')
// v2.5: 반복 일정 RRULE 지원
// v2.53: 구독 토큰은 서버 전용 표(semis_v2_private.settings)에만 둔다 — 코드에 토큰 없음.
//   토큰 확인 · 일정 조회는 RPC semis_v2_ics_feed(p_t)(서비스 권한 전용)가 한다. '나에게만 보이기' 일정은 빠진다.
//   주소 확인·교체: SeMIS 일정관리 › 구글캘린더 연동 (항공보안HQ 이상 확인, 시스템관리자 교체)
// 배포: Supabase MCP deploy_edge_function (verify_jwt false — Google 구독은 헤더를 보낼 수 없다). 이 파일이 원본.

interface Ev {
  id: string; title: string; memo?: string; start: string; end?: string;
  allDay?: boolean; time?: string; timeEnd?: string; done?: boolean;
  assignee?: string; vehicle?: boolean; room?: boolean;
  repeat?: { freq?: string; until?: string };
}

function icsEscape(s: string): string {
  return String(s || "")
    .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
const d8 = (iso: string) => iso.replace(/-/g, "");
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function kstToUtc(dateIso: string, hm: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [h, mi] = (hm || "09:00").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, (h || 0) - 9, mi || 0, 0))
    .toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}
function rrule(e: Ev): string {
  const f = e.repeat?.freq;
  if (!f || f === "none") return "";
  const map: Record<string, string> = {
    daily: "FREQ=DAILY", weekly: "FREQ=WEEKLY", "2week": "FREQ=WEEKLY;INTERVAL=2",
    monthly: "FREQ=MONTHLY", yearly: "FREQ=YEARLY"
  };
  if (!map[f]) return "";
  let r = "RRULE:" + map[f];
  if (e.repeat?.until) {
    // UNTIL 타입은 DTSTART와 일치해야 함: 종일=DATE, 시간=UTC datetime(KST 말일 23:59)
    r += (e.allDay || !e.time)
      ? ";UNTIL=" + d8(addDaysISO(e.repeat.until, 1))
      : ";UNTIL=" + kstToUtc(e.repeat.until, "23:59");
  }
  return r;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const t = url.searchParams.get("t") || "";
  if (!/^[0-9a-f]{20,80}$/.test(t)) return new Response("Unauthorized", { status: 401 });

  const supaUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const r = await fetch(`${supaUrl}/rest/v1/rpc/semis_v2_ics_feed`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_t: t })
  });
  if (!r.ok) return new Response("Upstream error", { status: 502 });
  const feed = await r.json();
  if (!Array.isArray(feed)) return new Response("Unauthorized", { status: 401 });
  const events: Ev[] = feed as Ev[];

  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AirZeta//SeMIS v2//KO",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:SeMIS 항공보안 일정", "X-WR-TIMEZONE:Asia/Seoul"
  ];

  for (const e of events) {
    if (!e || !e.id || !e.start) continue;
    const end = e.end && e.end >= e.start ? e.end : e.start;
    const flags = `${e.vehicle ? "\u{1F697} 차량 예약 " : ""}${e.room ? "\u{1F3E2} 회의실 예약" : ""}`.trim();
    const descParts = [e.memo || "", e.assignee ? `담당: ${e.assignee}` : "", flags].filter(Boolean);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${icsEscape(e.id)}@semis.airzeta`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`SUMMARY:${e.done ? "✅ " : ""}${icsEscape(e.title)}`);
    if (descParts.length) lines.push(`DESCRIPTION:${icsEscape(descParts.join("\n"))}`);
    if (e.allDay || !e.time) {
      lines.push(`DTSTART;VALUE=DATE:${d8(e.start)}`);
      lines.push(`DTEND;VALUE=DATE:${d8(addDaysISO(end, 1))}`);
    } else {
      lines.push(`DTSTART:${kstToUtc(e.start, e.time)}`);
      if (e.timeEnd) lines.push(`DTEND:${kstToUtc(end, e.timeEnd)}`);
      else {
        const [h, mi] = e.time.split(":").map(Number);
        const eh = String(Math.min((h || 0) + 1, 23)).padStart(2, "0");
        lines.push(`DTEND:${kstToUtc(end, `${eh}:${String(mi || 0).padStart(2, "0")}`)}`);
      }
    }
    const rr = rrule(e);
    if (rr) lines.push(rr);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-cache",
      "Content-Disposition": "inline; filename=semis.ics"
    }
  });
});
