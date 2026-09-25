/* SeMIS v2 — Supabase Edge Function "semis-files" (v2.53)
   비공개 버킷 semis-files 의 출입구. 잠금 뒤에는 브라우저가 버킷에 직접 접근하지 못한다.
   - 인증: 요청 헤더 x-semis-token (로그인 세션) → public.semis_v2_file_auth() 로 확인
   - op "sign"   : 파일 열람용 서명 URL(1시간) — 폴더별 열람 등급 확인
   - op "upload" : 업로드용 서명 URL — 폴더별 작성 등급 확인, 저장 경로는 이 함수가 정한다
   - op "list" / "delete" : 시스템관리자만 (시스템 설정 › 저장소 관리)
   - 협력업체는 업체 분류(ops·mfg·bill)별 폴더만, 회의 서명 세션은 그 회의의 서명 폴더만
   - 배포: Supabase MCP deploy_edge_function (verify_jwt false — 위의 세션 확인으로 대신). 이 파일이 원본. */

const SUPA = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "semis-files";
const STORAGE = SUPA + "/storage/v1";
const PUBLIC_PREFIX = "https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/" + BUCKET + "/";
const ORIGINS = ["https://semis.pe.kr", "https://www.semis.pe.kr", "https://mark4mission.github.io"];
const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const EXPIRES = 3600;
const MAX_SIZE = 50 * 1024 * 1024;
const MAX_SIGN = 200;
/* 폴더별 등급 — 권한 서열 admin 4 · hq 3 · manager 2 · user 1 (공용 DB 권한표 key_acl 과 맞춘다) */
const READ_RANK: Record<string, number> = {
  notices: 1, attach: 1, policy: 1, regs: 1, "regs-diff": 1, minutes: 1, "minutes-sign": 1,
  schedules: 2, council: 2, "council-sign": 2, "car-att": 2, "car-sign": 2, certs: 2, "branch-train": 2,
  billing: 3
};
const WRITE_RANK: Record<string, number> = {
  minutes: 2, "minutes-sign": 2, schedules: 2, council: 2, "council-sign": 2, "car-att": 2, "car-sign": 2, certs: 2,
  notices: 3, attach: 3, policy: 3, regs: 3, "regs-diff": 3, "branch-train": 3, billing: 3
};
const DEFAULT_READ = 3, DEFAULT_WRITE = 3;
/* 협력업체 분류별 폴더 (js/app.js VENDOR_ACCESS · 서버 vendor_acl 과 같은 범위) */
const VENDOR_READ: Record<string, string[]> = {
  ops: ["billing", "regs", "regs-diff", "council", "council-sign"],
  mfg: ["regs", "regs-diff", "council", "council-sign"],
  bill: ["billing"]
};
const VENDOR_WRITE: Record<string, string[]> = {
  ops: ["billing", "regs", "regs-diff", "council", "council-sign"],
  mfg: ["regs", "regs-diff", "council", "council-sign"],
  bill: ["billing"]
};
const SIGN_FOLDER: Record<string, string> = { minutes: "minutes-sign", council: "council-sign" };
const BLOCK_TYPES = /^(text\/html|application\/xhtml\+xml|text\/javascript|application\/(x-)?javascript|image\/svg\+xml)/i;
const BLOCK_EXT = /\.(html?|xhtml|js|mjs|svg)$/i;

type Who = { ok: boolean; kind?: string; rank?: number; role?: string; vclass?: string; sign?: string; who?: string };

function cors(origin: string): Record<string, string> {
  const allow = ORIGINS.includes(origin) || LOCAL_RE.test(origin) ? origin : ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "content-type, x-semis-token, apikey, authorization, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "3600",
    "Vary": "Origin"
  };
}
function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
const svc = (extra: Record<string, string> = {}) =>
  ({ apikey: SERVICE, Authorization: "Bearer " + SERVICE, ...extra });

/* 저장소 경로 — 상대 경로만, 상위 이동·제어문자 금지 */
function cleanPath(p: unknown): string | null {
  const s = String(p ?? "");
  if (!s || s.length > 300) return null;
  if (s.startsWith("/") || s.includes("..") || s.includes("\\") || /[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}
const folderOf = (p: string) => (p.indexOf("/") > 0 ? p.slice(0, p.indexOf("/")) : "");
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

async function whoAmI(req: Request): Promise<Who> {
  const tok = req.headers.get("x-semis-token") || "";
  if (!/^[0-9a-f]{64}$/.test(tok)) return { ok: false };
  try {
    const r = await fetch(SUPA + "/rest/v1/rpc/semis_v2_file_auth", {
      method: "POST",
      headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json", "x-semis-token": tok },
      body: "{}"
    });
    if (!r.ok) return { ok: false };
    const d = await r.json();
    return d && d.ok
      ? { ok: true, kind: String(d.kind), rank: Number(d.rank) || 0, role: String(d.role || ""), vclass: String(d.vclass || ""),
          sign: String(d.sign || ""), who: String(d.who || "") }
      : { ok: false };
  } catch (_e) {
    return { ok: false };
  }
}
function canRead(w: Who, path: string): boolean {
  const f = folderOf(path);
  if (w.kind === "signer") return f === SIGN_FOLDER[w.sign || "minutes"];
  if (w.role === "vendor") return (VENDOR_READ[w.vclass || "bill"] || []).includes(f);
  return (w.rank ?? 0) >= (READ_RANK[f] ?? DEFAULT_READ);
}
function canWrite(w: Who, folder: string): boolean {
  if (w.kind === "signer") return folder === SIGN_FOLDER[w.sign || "minutes"];
  if (w.role === "vendor") return (VENDOR_WRITE[w.vclass || "bill"] || []).includes(folder);
  return (w.rank ?? 0) >= (WRITE_RANK[folder] ?? DEFAULT_WRITE);
}

async function signPaths(paths: string[]): Promise<Record<string, string>> {
  const r = await fetch(STORAGE + "/object/sign/" + BUCKET, {
    method: "POST", headers: svc({ "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: EXPIRES, paths })
  });
  if (!r.ok) throw new Error("sign " + r.status);
  const rows = await r.json() as { path?: string; signedURL?: string | null; error?: string | null }[];
  const out: Record<string, string> = {};
  (Array.isArray(rows) ? rows : []).forEach((x) => {
    if (x && x.path && x.signedURL && !x.error) out[x.path] = encodeURI(STORAGE + x.signedURL);
  });
  return out;
}

async function listFolder(prefix: string) {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const r = await fetch(STORAGE + "/object/list/" + BUCKET, {
      method: "POST", headers: svc({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } })
    });
    if (!r.ok) throw new Error("list " + r.status);
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    rows.forEach((x: Record<string, unknown>) => out.push(x));
    if (rows.length < 100) break;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, origin);
  if (origin && !ORIGINS.includes(origin) && !LOCAL_RE.test(origin)) return json({ ok: false, error: "origin" }, 403, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch (_e) { return json({ ok: false, error: "bad_json" }, 400, origin); }
  const w = await whoAmI(req);
  if (!w.ok) return json({ ok: false, error: "auth" }, 401, origin);
  const op = String(body.op || "");

  try {
    if (op === "sign") {
      const raw = Array.isArray(body.paths) ? body.paths.slice(0, MAX_SIGN) : [];
      const paths = Array.from(new Set(raw.map(cleanPath).filter((p): p is string => !!p)));
      const allowed = paths.filter((p) => canRead(w, p));
      const urls = allowed.length ? await signPaths(allowed) : {};
      const denied = paths.filter((p) => allowed.indexOf(p) < 0);
      return json({ ok: true, expires: EXPIRES, urls, denied }, 200, origin);
    }

    if (op === "upload") {
      const folder = String(body.prefix || "files");
      if (!/^[a-z0-9-]{2,30}$/.test(folder)) return json({ ok: false, error: "prefix" }, 400, origin);
      if (!canWrite(w, folder)) return json({ ok: false, error: "forbidden" }, 403, origin);
      const size = Number(body.size) || 0;
      if (size > MAX_SIZE) return json({ ok: false, error: "too_large" }, 413, origin);
      const type = String(body.type || "");
      const name = String(body.name || "file");
      if (BLOCK_TYPES.test(type) || BLOCK_EXT.test(name)) return json({ ok: false, error: "type" }, 415, origin);
      const safe = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "file";
      const rand = crypto.getRandomValues(new Uint8Array(9));
      const tag = Date.now().toString(36) + Array.from(rand, (b) => (b % 36).toString(36)).join("");
      const path = folder + "/" + tag + "_" + safe;
      const r = await fetch(STORAGE + "/object/upload/sign/" + BUCKET + "/" + encPath(path), {
        method: "POST", headers: svc({ "Content-Type": "application/json" }), body: "{}"
      });
      if (!r.ok) return json({ ok: false, error: "upload_sign " + r.status }, 502, origin);
      const d = await r.json() as { url?: string };
      if (!d || !d.url) return json({ ok: false, error: "upload_sign" }, 502, origin);
      return json({ ok: true, path, url: PUBLIC_PREFIX + path, upload: STORAGE + d.url }, 200, origin);
    }

    if (op === "list") {
      if ((w.rank ?? 0) < 4 || w.kind !== "user" || w.role !== "admin") return json({ ok: false, error: "forbidden" }, 403, origin);
      const roots = await listFolder("");
      const files: Record<string, unknown>[] = [];
      const mk = (folder: string, x: Record<string, unknown>) => {
        const meta = (x.metadata || {}) as Record<string, unknown>;
        return { path: (folder ? folder + "/" : "") + String(x.name), name: String(x.name), folder,
                 size: Number(meta.size || 0), updated: String(x.updated_at || x.created_at || "") };
      };
      for (const x of roots) {
        if (!x || !x.name) continue;
        if (x.id) { files.push(mk("", x)); continue; }
        const kids = await listFolder(String(x.name) + "/");
        kids.forEach((k) => { if (k && k.id && k.name) files.push(mk(String(x.name), k)); });
      }
      return json({ ok: true, files }, 200, origin);
    }

    if (op === "delete") {
      if ((w.rank ?? 0) < 4 || w.kind !== "user" || w.role !== "admin") return json({ ok: false, error: "forbidden" }, 403, origin);
      const raw = Array.isArray(body.paths) ? body.paths.slice(0, 100) : [];
      const paths = raw.map(cleanPath).filter((p): p is string => !!p);
      if (!paths.length) return json({ ok: true, deleted: [] }, 200, origin);
      const r = await fetch(STORAGE + "/object/" + BUCKET, {
        method: "DELETE", headers: svc({ "Content-Type": "application/json" }), body: JSON.stringify({ prefixes: paths })
      });
      if (!r.ok) return json({ ok: false, error: "delete " + r.status }, 502, origin);
      const rows = await r.json();
      const deleted = (Array.isArray(rows) ? rows : []).map((x: Record<string, unknown>) => String(x.name || ""));
      return json({ ok: true, deleted }, 200, origin);
    }

    return json({ ok: false, error: "op" }, 400, origin);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 500, origin);
  }
});
