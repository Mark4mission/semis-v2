/* ═══════════════════════════════════════════════════════
   SeMIS v2.35 — 세미(Semi) AI 도우미 Edge Function
   Claude API 프록시 + semis_store 조회 도구(읽기 전용)

   - 인증: verify_jwt off + 고정 토큰(body.t) — semis-news 패턴
   - 비밀키: ANTHROPIC_API_KEY (Supabase 대시보드 → Edge Functions → Secrets)
   - 모델: SEMI_MODEL 환경변수로 교체 가능(기본 claude-sonnet-5,
     미지원 시 claude-sonnet-4-5 자동 폴백)
   - 데이터 접근: 사용자 역할(rank)별 허용 키만 도구에 노출 + 서버 이중 검증
     (vault·pwOverrides·userOverrides·customUsers·gcal은 어떤 등급에도 미노출)
   ═══════════════════════════════════════════════════════ */

const TOKEN = "azs-semi-9f2c47b1e6d3";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODELS = ["claude-sonnet-5", "claude-sonnet-4-5"]; // 앞에서부터 시도
const MAX_TOOL_ROUNDS = 5;
const MAX_RESULT_CHARS = 42000;   // 도구 결과 1건 최대 길이(≈ 15k 토큰)
const MAX_MSGS = 24;              // 대화 이력 상한
const MAX_MSG_CHARS = 4000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const ROLE_RANK: Record<string, number> = { admin: 4, hq: 3, manager: 2, user: 1 };
const ROLE_LABEL: Record<string, string> = {
  admin: "시스템관리자", hq: "항공보안HQ", manager: "보안관리자", user: "일반사용자",
};

/* 조회 가능 컬렉션 카탈로그 — rank: 최소 등급 */
const CATALOG: Record<string, { desc: string; rank: number }> = {
  menus:           { desc: "사이트 메뉴 구조(내부 모듈·외부 링크 목록)", rank: 1 },
  notices:         { desc: "공지사항", rank: 1 },
  levelHistory:    { desc: "국가 항공보안등급 이력(기간형 — 최신 유효 항목이 현재 등급)", rank: 1 },
  regulations:     { desc: "보안규정 목록(국제/국가 scope=intl, 자체 scope=own, 개정 아이디어 노트 포함)", rank: 1 },
  policy:          { desc: "에어제타 보안정책 PDF 등록 정보(국문/영문)", rank: 1 },
  schedules:       { desc: "항공보안파트 일정(반복 일정 repeat 포함) — 양이 많으니 from/to 필터 권장", rank: 2 },
  inspections:     { desc: "보안점검 연간 일정·실적(국내정기/불시평가/해외공항/주요일정)", rank: 2 },
  contacts:        { desc: "비정상상황 보고체계 연락망", rank: 2 },
  branches:        { desc: "해외지점 정보(지점장·보안담당자·교육이력 등)", rank: 2 },
  passes:          { desc: "출입증 관리 대장", rank: 2 },
  equipment:       { desc: "보안장비 대장(X-Ray·ETD·WTMD·HHMD, 내용연수·이력)", rank: 2 },
  trainings:       { desc: "보안교육 실시 기록", rank: 2 },
  certs:           { desc: "교육 이수증(보안책임자/감독자 과정, 만료일 관리)", rank: 2 },
  council:         { desc: "보안장비 협의회 회의록(사례·결정사항·참석자)", rank: 2 },
  supervisors:     { desc: "보안감독자 발령 현황(본부별)", rank: 2 },
  stationOfficers: { desc: "지점 보안담당자 명단(지역별)", rank: 2 },
  contracts:       { desc: "계약서 관리 목록 [대외비]", rank: 3 },
  equipMaint:      { desc: "장비 유지보수 계약·월별 비용 [대외비]", rank: 3 },
  billing:         { desc: "협력업체 대금 청구 내역 [대외비]", rank: 3 },
  kpis:            { desc: "KPI(CSI 과제) 진행 현황(액션플랜·상태)", rank: 3 },
  cars:            { desc: "부적합·시정조치 CAR→CAP→FAT 기록(위험도·기한·서명)", rank: 3 },
  carCfg:          { desc: "CAR 프로세스 설정(기한·위험매트릭스)", rank: 3 },
};

function allowedKeys(rank: number): string[] {
  return Object.keys(CATALOG).filter((k) => CATALOG[k].rank <= rank);
}

/* ─── semis_store 조회 ─── */
async function fetchStore(key: string): Promise<unknown> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const res = await fetch(
    url + "/rest/v1/semis_store?key=eq." + encodeURIComponent(key) + "&select=key,value",
    { headers: { apikey: anon, Authorization: "Bearer " + anon } },
  );
  if (!res.ok) throw new Error("store " + res.status);
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows.find((r) => r && r.key === key) : null;
  return row ? row.value : null;
}

/* ─── 도구 결과 가공: 날짜 범위 / 키워드 필터 + 용량 제한 ─── */
function filterItems(key: string, val: unknown, inp: Record<string, unknown>): unknown {
  if (!Array.isArray(val)) return val;
  let arr = val as Record<string, unknown>[];
  const from = typeof inp.from === "string" ? inp.from : "";
  const to = typeof inp.to === "string" ? inp.to : "";
  if (from || to) {
    arr = arr.filter((it) => {
      const dates = (JSON.stringify(it).match(/\d{4}-\d{2}-\d{2}/g) || []) as string[];
      const hit = dates.some((d) => (!from || d >= from) && (!to || d <= to));
      const rep = key === "schedules" && it && (it as { repeat?: { freq?: string } }).repeat &&
        (it as { repeat?: { freq?: string } }).repeat!.freq && (it as { repeat?: { freq?: string } }).repeat!.freq !== "none";
      return hit || !!rep;
    });
  }
  const q = typeof inp.query === "string" ? inp.query.trim() : "";
  if (q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    arr = arr.filter((it) => {
      const js = JSON.stringify(it).toLowerCase();
      return terms.every((t) => js.includes(t));
    });
  }
  return arr;
}
function serializeCapped(val: unknown): string {
  let body = JSON.stringify(val);
  if (body.length <= MAX_RESULT_CHARS) return body;
  if (Array.isArray(val)) {
    const total = val.length;
    let items = val.slice();
    while (items.length > 1 && JSON.stringify(items).length > MAX_RESULT_CHARS) {
      items = items.slice(Math.ceil(items.length * 0.25)); // 앞(오래된)쪽부터 제거
    }
    return JSON.stringify({
      _note: "전체 " + total + "건 중 뒤쪽 " + items.length +
        "건만 포함(용량 제한). from/to 또는 query로 좁혀 다시 조회 가능.",
      items,
    });
  }
  return JSON.stringify({ _note: "용량 제한으로 잘림", raw: body.slice(0, MAX_RESULT_CHARS) });
}

/* ─── 세미 페르소나 시스템 프롬프트 ─── */
function buildSystem(name: string, role: string, rank: number): string {
  const now = new Date(Date.now() + 9 * 3600 * 1000); // KST
  const today = now.toISOString().slice(0, 10);
  const yo = ["일", "월", "화", "수", "목", "금", "토"][now.getUTCDay()];
  const keys = allowedKeys(rank).map((k) => "- " + k + ": " + CATALOG[k].desc).join("\n");
  return `당신은 "세미(Semi)"입니다. 에어제타 항공보안팀 보안종합정보시스템 SeMIS(semis.pe.kr)의 AI 도우미이자 마스코트예요.

[성격·말투]
- 친근하고 따뜻한 팀 동료. 밝고 편안한 해요체(존댓말). 짧고 명확하게.
- 이모지는 어울릴 때 한 개 정도만. 인사·잡담엔 다정하게, 업무 질문엔 정확하게.

[할 수 있는 일]
1. SeMIS 데이터 조회·검색·요약 — semis_data 도구(읽기 전용)
2. SeMIS 메뉴·사용법 안내
3. 항공보안 일반 지식 답변

[규칙]
- 사이트 데이터에 관한 질문은 반드시 semis_data로 실제 데이터를 조회한 뒤 답하세요. 추측으로 지어내지 마세요.
- 조회 결과에 없으면 "기록에서 찾지 못했다"고 솔직히 말하세요.
- 데이터 등록·수정·삭제는 아직 할 수 없어요. 요청받으면 해당 기능이 있는 메뉴 위치를 안내하세요.
- 오늘은 ${today}(${yo}요일)입니다. 날짜 계산(D-day·만료 등)은 이 기준으로 정확히.
- 답변은 대체로 2~8문장. 목록이 필요하면 "- " 불릿으로 간결하게.
- 지금 대화 상대의 권한 밖 데이터는 도구에 없습니다. 요청 시 "권한이 필요한 자료"라고 정중히 안내하세요.

[현재 사용자] ${name} (${ROLE_LABEL[role] || role})

[조회 가능한 데이터 키]
${keys}

[사이트 개요]
SeMIS v2는 에어제타 항공보안팀의 통합 시스템으로 공지·일정·KPI·보안규정·지점/계약·보안감독자·보안점검·CAR(부적합 시정조치)·출입증·보안장비(유지관리/협의회/대금청구)·보안교육/이수증·보고체계 연락망·보안정책·암호 관리 메뉴로 구성돼요. 장비 실시간 관제는 별도 CARES 시스템이 담당해요.`;
}

/* ─── Anthropic API 호출(모델 폴백 포함) ─── */
async function callClaude(apiKey: string, model: string, system: string, tools: unknown[], messages: unknown[]) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 1500, system, tools, messages }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (body.t !== TOKEN) return json({ error: "forbidden" }, 403);

  const user = (body.user || {}) as { name?: string; role?: string };
  const role = String(user.role || "");
  const rank = ROLE_RANK[role] || 0;
  if (rank < 1) return json({ error: "forbidden_role" }, 403);
  const name = String(user.name || "사용자").slice(0, 40);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!apiKey) {
    return json({
      reply: "아직 저를 깨울 준비가 안 됐어요 😴 관리자가 Supabase의 semi-chat 함수에 ANTHROPIC_API_KEY를 등록하면 바로 대화할 수 있어요!",
      noKey: true,
    });
  }

  /* 대화 이력 정리 */
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const msgs: { role: string; content: unknown }[] = [];
  for (const m of raw.slice(-MAX_MSGS)) {
    const r = (m as { role?: string }).role;
    const c = (m as { content?: unknown }).content;
    if ((r === "user" || r === "assistant") && typeof c === "string" && c.trim()) {
      msgs.push({ role: r, content: c.slice(0, MAX_MSG_CHARS) });
    }
  }
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return json({ error: "no_message" }, 400);

  const allowed = allowedKeys(rank);
  const tools = [{
    name: "semis_data",
    description: "SeMIS 공용 데이터베이스에서 컬렉션을 조회합니다(읽기 전용). 필요하면 from/to(YYYY-MM-DD, 항목 내 날짜 교차 검사)와 query(공백 구분 AND 키워드)로 결과를 좁힐 수 있습니다.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", enum: allowed, description: "조회할 컬렉션 키" },
        from: { type: "string", description: "날짜 필터 시작(YYYY-MM-DD)" },
        to: { type: "string", description: "날짜 필터 끝(YYYY-MM-DD)" },
        query: { type: "string", description: "키워드 필터(공백 구분 AND)" },
      },
      required: ["key"],
    },
  }];
  const system = buildSystem(name, role, rank);

  const envModel = Deno.env.get("SEMI_MODEL");
  const modelList = envModel ? [envModel, ...MODELS.filter((m) => m !== envModel)] : MODELS.slice();
  let mi = 0;
  let usage = { input: 0, output: 0 };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let r = await callClaude(apiKey, modelList[mi], system, tools, msgs);
      // 모델 미지원 → 다음 후보로 폴백
      while (r.status === 404 && mi + 1 < modelList.length) {
        mi++;
        r = await callClaude(apiKey, modelList[mi], system, tools, msgs);
      }
      if (r.status === 401) return json({ reply: "API 키가 유효하지 않은 것 같아요. 관리자에게 키 확인을 부탁드려 주세요 🙏" });
      if (r.status === 429) return json({ reply: "지금 요청이 몰려서 잠시 숨을 고르는 중이에요. 조금 뒤에 다시 물어봐 주실래요?" });
      if (r.status === 529) return json({ reply: "AI 서버가 잠시 붐비고 있어요. 잠깐 뒤에 다시 시도해 주세요!" });
      if (r.status !== 200) {
        const em = (r.data as { error?: { message?: string } }).error?.message || ("HTTP " + r.status);
        return json({ reply: "앗, 응답 중에 문제가 생겼어요. (" + String(em).slice(0, 120) + ")" });
      }
      const d = r.data as {
        content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
        stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number };
      };
      usage.input += d.usage?.input_tokens || 0;
      usage.output += d.usage?.output_tokens || 0;

      if (d.stop_reason === "tool_use") {
        const results: unknown[] = [];
        for (const blk of d.content || []) {
          if (blk.type !== "tool_use") continue;
          const inp = (blk.input || {}) as Record<string, unknown>;
          const key = String(inp.key || "");
          let out: string;
          if (!allowed.includes(key)) {
            out = JSON.stringify({ error: "이 사용자 권한으로 조회할 수 없는 키입니다." });
          } else {
            try {
              const val = await fetchStore(key);
              out = val === null ? JSON.stringify({ error: "데이터 없음" })
                : serializeCapped(filterItems(key, val, inp));
            } catch (_e) {
              out = JSON.stringify({ error: "조회 실패(일시적 오류)" });
            }
          }
          results.push({ type: "tool_result", tool_use_id: blk.id, content: out });
        }
        msgs.push({ role: "assistant", content: d.content });
        msgs.push({ role: "user", content: results });
        continue;
      }

      const text = (d.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("\n").trim();
      return json({ reply: text || "…뭐라고 답해야 할지 모르겠어요. 다시 한번 물어봐 주실래요?", usage, model: modelList[mi] });
    }
    return json({ reply: "자료를 찾다가 길을 잃었어요 😅 질문을 조금 더 좁혀서 다시 물어봐 주실래요?", usage });
  } catch (_e) {
    return json({ reply: "연결에 문제가 생겼어요. 잠시 후 다시 시도해 주세요." });
  }
});
