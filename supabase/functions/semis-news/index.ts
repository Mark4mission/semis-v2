// SeMIS v2 — 보안 뉴스 수집 (guest 대시보드 뉴스 카드, v2.19)
// 소스(모두 보안뉴스 boannews.com, EUC-KR):
//   1) 최신기사 RSS → 사이버·일반 보안 (키워드 매칭 시 항공 분류)
//   2) 제목 검색 "항공"/"공항" (EUC-KR 하드코딩 쿼리) → 항공보안 기사
//   ※ Google News RSS는 Supabase Edge IP 차단(503)으로 사용 불가 확인 (2026-07)
// 인증: 브라우저 직접 호출 → 비공개 토큰(?t=...)으로 제한 (공개 뉴스 데이터, 저민감)
const TOKEN = "azs-news-7d3f9a2c";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type"
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const BASE = "https://www.boannews.com";

interface Item { title: string; link: string; date: string | null; src: string; cat: "aviation" | "cyber"; }

// 항공보안 관련 키워드 (RSS 기사 제목/본문 매칭 → cat=aviation)
const AVIA_RE = /항공|공항|기내 반입|하이재킹|보안검색|검색요원|화물터미널|드론 테러/;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
const stripCdata = (s: string) => s.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim();
const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function fetchEuckr(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("http " + r.status + " " + url);
  return new TextDecoder("euc-kr").decode(await r.arrayBuffer());
}

/* ── 소스 1: 최신기사 RSS ── */
function parseRss(xml: string): Item[] {
  const out: Item[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const pick = (tag: string) => {
      const mm = b.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">"));
      return mm ? decodeEntities(stripCdata(mm[1])) : "";
    };
    const title = pick("title");
    const link = pick("link");
    const desc = stripTags(pick("description"));
    const d = new Date(pick("pubDate") || pick("dc:date"));
    if (!title || !link) continue;
    out.push({
      title, link, date: isNaN(d.getTime()) ? null : d.toISOString(), src: "보안뉴스",
      cat: AVIA_RE.test(title + " " + desc) ? "aviation" : "cyber"
    });
  }
  return out;
}

/* ── 소스 2: 제목 검색 (news_total.asp, EUC-KR 쿼리 하드코딩) ── */
// "항공"=%C7%D7%B0%F8, "공항"=%B0%F8%C7%D7
const SEARCH_QS = ["%C7%D7%B0%F8", "%B0%F8%C7%D7"];

function parseSearch(html: string): Item[] {
  const out: Item[] = [];
  const re = /<div class="news_list">\s*<a href="([^"]+)">[\s\S]*?class="news_txt"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<span class="news_writer">([\s\S]*?)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const link = BASE + decodeEntities(m[1]);
    const title = decodeEntities(stripTags(m[2]));
    // "홍길동 기자 | 2026년 07월 10일 11:10" → ISO (KST → UTC)
    const dm = m[3].match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2}):(\d{2})/);
    let date: string | null = null;
    if (dm) date = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +dm[4] - 9, +dm[5])).toISOString();
    if (title && link) out.push({ title, link, date, src: "보안뉴스", cat: "aviation" });
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  if (url.searchParams.get("t") !== TOKEN)
    return new Response("Unauthorized", { status: 401, headers: CORS });

  const jobs: Promise<Item[]>[] = [
    fetchEuckr(BASE + "/media/news_rss.xml").then(parseRss),
    ...SEARCH_QS.map(q =>
      fetchEuckr(BASE + "/search/news_total.asp?search=title&find=" + q).then(parseSearch))
  ];
  const settled = await Promise.allSettled(jobs);
  const raw: Item[] = [];
  settled.forEach(s => { if (s.status === "fulfilled") raw.push(...s.value); });

  // 중복 제거 (제목 정규화) + 90일 이내
  const seen = new Set<string>();
  const cutoff = Date.now() - 90 * 86400000;
  const items: Item[] = [];
  for (const it of raw) {
    const norm = it.title.replace(/[\s\p{P}]/gu, "").toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    if (it.date && new Date(it.date).getTime() < cutoff) continue;
    items.push(it);
  }
  const byDate = (a: Item, b: Item) => String(b.date || "").localeCompare(String(a.date || ""));
  const aviation = items.filter(x => x.cat === "aviation").sort(byDate).slice(0, 8);
  const cyber = items.filter(x => x.cat === "cyber").sort(byDate).slice(0, 8);

  return new Response(JSON.stringify({ updated: new Date().toISOString(), items: [...aviation, ...cyber] }), {
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=900" }
  });
});
