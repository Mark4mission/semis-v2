/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 서버 보안 (v2.53.0, 2026-09-26)
   계정·세션·권한표·RPC·세션 기반 RLS·변경 알림·로그인 자동공격 방어
   - 1단계(2026-09-25, 마이그레이션 semis_v2_security_1~4): 스키마·계정 이관·RPC(Logistics v1.15 이식)
   - 2단계(2026-09-26, 마이그레이션 semis_v2_security_5~): 이 파일의 최종 형태
       · 읽기는 RPC semis_v2_pull, 쓰기는 RPC semis_v2_push 로만 (서버가 권한·가림·병합)
       · 협력업체(vendor)는 업체 분류(ops·mfg·bill)별 권한표 vendor_acl
       · 작업증명(PoW) 로그인 · 전체 실패 수에 따른 난이도 상승 · 회의 서명 코드 일시 중지
       · 협의회(council) 참석 서명 · 팀 채팅 세션 권한 · ICS 구독 토큰 서버 보관
   - 기존 누구나(anon) 정책 제거는 잠금 단계(semis-v2-lockdown.sql)에서 한다.
   - 이 파일은 참고용 사본이다. 실제 적용은 Supabase 마이그레이션으로 했다.
   ═══════════════════════════════════════════════════════ */

create schema if not exists semis_v2_private;
revoke all on schema semis_v2_private from public;
grant usage on schema semis_v2_private to anon, authenticated, service_role;

/* ─── 계정 · 세션 · 시도 · 감사 · 권한표 ─── */
create table if not exists semis_v2_private.accounts (
  id            text primary key,                 -- 고정 키(구 origId)
  login_id      text not null unique,             -- 화면에 보이는 계정 ID
  name          text not null,
  role          text not null check (role in ('admin','hq','manager','user','vendor')),
  vendor        text not null default '',
  pw_hash       text not null,                    -- bcrypt( sha256('SeMISv2::'||암호) hex )
  base          boolean not null default false,
  disabled      boolean not null default false,
  pw_changed_at timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists semis_v2_private.sessions (
  token_hash      text primary key,               -- sha256(토큰) — 토큰 원문은 저장하지 않음
  account_id      text references semis_v2_private.accounts(id) on delete cascade,
  kind            text not null default 'user' check (kind in ('user','signer')),
  minute_id       text,                           -- 서명 세션: 회의 id
  created_at      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  expires_at      timestamptz not null,
  hard_expires_at timestamptz not null,
  ip              text,
  ua              text
);
alter table semis_v2_private.sessions add column if not exists sign_kind text;   -- 'minutes' | 'council'
create index if not exists sessions_account_idx on semis_v2_private.sessions(account_id);
create table if not exists semis_v2_private.login_attempts (
  id   bigserial primary key,
  at   timestamptz not null default now(),
  ip   text,
  ok   boolean not null,
  kind text
);
create index if not exists login_attempts_ip_at_idx on semis_v2_private.login_attempts(ip, at);
create index if not exists login_attempts_at_idx on semis_v2_private.login_attempts(at);
create table if not exists semis_v2_private.audit (
  id     bigserial primary key,
  at     timestamptz not null default now(),
  actor  text,
  action text not null,
  detail jsonb,
  ip     text
);
create index if not exists audit_at_idx on semis_v2_private.audit(at desc);
create table if not exists semis_v2_private.key_acl (
  key        text primary key,
  read_rank  int not null,
  write_rank int not null
);
alter table semis_v2_private.key_acl add column if not exists part_rank int;   -- 이 등급부터 가린 사본(RPC)
/* 협력업체 권한 — 업체 분류(ops 운영·유지보수 / mfg 제조사·기술지원 / bill 청구 전용)별.
   full_view=false 면 서버가 가린 사본만 준다(자기 업체 자료만 · 대외비 제외). */
create table if not exists semis_v2_private.vendor_acl (
  klass     text not null,
  key       text not null,
  can_read  boolean not null default true,
  can_write boolean not null default false,
  full_view boolean not null default true,
  primary key (klass, key)
);
create table if not exists semis_v2_private.settings (
  k          text primary key,
  v          jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists semis_v2_private.pow_used (
  nonce text primary key,
  at    timestamptz not null default now()
);
alter table semis_v2_private.accounts       enable row level security;
alter table semis_v2_private.sessions       enable row level security;
alter table semis_v2_private.login_attempts enable row level security;
alter table semis_v2_private.audit          enable row level security;
alter table semis_v2_private.key_acl        enable row level security;
alter table semis_v2_private.vendor_acl     enable row level security;
alter table semis_v2_private.settings       enable row level security;
alter table semis_v2_private.pow_used       enable row level security;
revoke all on all tables    in schema semis_v2_private from public, anon, authenticated;
revoke all on all sequences in schema semis_v2_private from public, anon, authenticated;

/* 권한 서열: admin 4 · hq 3 · manager 2 · user 1 · 9 = 앱에서 읽기·쓰기 불가.
   (key, 읽기, 쓰기, 가린 사본) — 가린 사본: 그 등급부터 서버가 일부 항목을 빼고 준다. */
insert into semis_v2_private.key_acl(key, read_rank, write_rank, part_rank) values
  ('menus',1,4,null), ('notices',1,3,null), ('levelHistory',1,3,null), ('minutes',1,2,null), ('minuteFolders',1,2,null),
  ('policy',1,3,null), ('chatRooms',1,3,null), ('caresCfg',1,9,null),
  ('schedules',2,2,null), ('gcal',2,3,null), ('inspections',2,2,null), ('trainings',2,2,null), ('certs',2,2,null), ('certOpts',2,2,null),
  ('council',2,2,null), ('cars',2,2,null), ('carCfg',2,3,null), ('supervisors',2,2,null), ('stationOfficers',2,2,null),
  ('branches',2,3,null), ('contacts',2,3,null), ('passes',2,2,null),
  ('regulations',2,3,1), ('passOwners',2,2,1),
  ('equipment',3,3,1), ('equipMaint',3,3,null), ('billing',3,3,null), ('kpis',3,3,null), ('contracts',3,3,null), ('vault',3,3,null),
  ('pwOverrides',9,9,null), ('userOverrides',9,9,null), ('customUsers',9,9,null), ('zz_backup_billing_20260805',9,9,null)
on conflict (key) do update set read_rank = excluded.read_rank, write_rank = excluded.write_rank, part_rank = excluded.part_rank;

/* (분류, key, 읽기, 쓰기, 전체 보기) */
insert into semis_v2_private.vendor_acl(klass, key, can_read, can_write, full_view) values
  ('ops','menus',true,false,false), ('ops','levelHistory',true,false,true), ('ops','chatRooms',true,false,false), ('ops','caresCfg',true,false,true),
  ('ops','regulations',true,true,false), ('ops','equipment',true,true,true), ('ops','equipMaint',true,true,false),
  ('ops','council',true,true,true), ('ops','billing',true,true,false),
  ('mfg','menus',true,false,false), ('mfg','levelHistory',true,false,true), ('mfg','chatRooms',true,false,false), ('mfg','caresCfg',true,false,true),
  ('mfg','regulations',true,true,false), ('mfg','equipment',true,true,false), ('mfg','council',true,true,true),
  ('bill','menus',true,false,false), ('bill','levelHistory',true,false,true), ('bill','chatRooms',true,false,false),
  ('bill','billing',true,true,false)
on conflict (klass, key) do update set can_read = excluded.can_read, can_write = excluded.can_write, full_view = excluded.full_view;

/* 작업증명 비밀값(서명용) · 기본 난이도 · ICS 구독 토큰 — 서버 전용 */
insert into semis_v2_private.settings(k, v) values
  ('pow', jsonb_build_object('secret', encode(extensions.gen_random_bytes(32), 'hex'), 'base', 18)),
  ('ics', jsonb_build_object('token', encode(extensions.gen_random_bytes(18), 'hex')))
on conflict (k) do nothing;

/* ═════════════ 요청 · 세션 ═════════════ */
create or replace function semis_v2_private.hdr(p_name text) returns text
language sql stable set search_path = '' as $$
  select nullif(btrim(coalesce(nullif(current_setting('request.headers', true), '')::json ->> p_name, '')), '')
$$;
/* 접속 IP — Cloudflare가 넣는 cf-connecting-ip 우선(클라이언트가 위조 불가).
   x-forwarded-for 는 첫 항목을 클라이언트가 꾸밀 수 있어 마지막 항목만 예비로 쓴다 */
create or replace function semis_v2_private.client_ip() returns text
language sql stable set search_path = '' as $$
  select left(coalesce(semis_v2_private.hdr('cf-connecting-ip'),
                       nullif(btrim(reverse(split_part(reverse(coalesce(semis_v2_private.hdr('x-forwarded-for'), '')), ',', 1))), ''),
                       'unknown'), 64)
$$;
create or replace function semis_v2_private.rank_of(p_role text) returns int
language sql immutable set search_path = '' as $$
  select case p_role when 'admin' then 4 when 'hq' then 3 when 'manager' then 2
                     when 'user' then 1 when 'vendor' then 1 else 0 end
$$;
/* 업체명 → 분류 (js/app.js normVendorKey · VENDOR_ACCESS 와 같은 규칙) */
create or replace function semis_v2_private.vendor_key(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(coalesce(p, ''), '[[:space:]㈜()]|주식회사', '', 'g'))
$$;
create or replace function semis_v2_private.vendor_class(p text) returns text
language sql immutable set search_path = '' as $$
  select case semis_v2_private.vendor_key(p)
           when '프로에스콤' then 'ops' when '인씨스' then 'ops'
           when '뉴원s&t' then 'mfg' when '뉴원에스엔티' then 'mfg'
           else 'bill' end
$$;
create or replace function semis_v2_private.vendor_routes(p_class text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_class when 'ops' then array['regs-intl','equipment','council','billing']
                      when 'mfg' then array['regs-intl','equipment','council']
                      else array['billing'] end
$$;
/* 유지보수 계약·비용의 업체명 비교 (js/equipment.js sameVendor 와 같은 규칙 — 표기 편차 흡수) */
create or replace function semis_v2_private.same_vendor(a text, b text) returns boolean
language sql immutable set search_path = '' as $$
  select x <> '' and y <> '' and (strpos(x, y) > 0 or strpos(y, x) > 0)
    from (select lower(regexp_replace(coalesce(a, ''), '[[:space:]㈜()주식회사]', '', 'g')) x,
                 lower(regexp_replace(coalesce(b, ''), '[[:space:]㈜()주식회사]', '', 'g')) y) t
$$;

/* 현재 세션 (x-semis-token 헤더) */
drop function if exists semis_v2_private.ctx();
create function semis_v2_private.ctx()
returns table(token_hash text, account_id text, login_id text, name text, role text, rank int, kind text,
              minute_id text, sign_kind text, vendor text, vclass text)
language plpgsql stable security definer set search_path = '' as $$
declare t text; th text;
begin
  t := semis_v2_private.hdr('x-semis-token');
  if t is null or length(t) <> 64 then return; end if;
  th := encode(extensions.digest(t, 'sha256'), 'hex');
  return query
    select s.token_hash, s.account_id, a.login_id, a.name,
           case when s.kind = 'signer' then 'signer' else a.role end,
           case when s.kind = 'signer' then 0 else semis_v2_private.rank_of(a.role) end,
           s.kind, s.minute_id, coalesce(s.sign_kind, 'minutes'),
           coalesce(a.vendor, ''),
           case when a.role = 'vendor' then semis_v2_private.vendor_class(a.vendor) else '' end
      from semis_v2_private.sessions s
      left join semis_v2_private.accounts a on a.id = s.account_id
     where s.token_hash = th
       and s.expires_at > now() and s.hard_expires_at > now()
       and (s.kind = 'signer' or (a.id is not null and not a.disabled));
end $$;

create or replace function semis_v2_private.rank_now() returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.rank from semis_v2_private.ctx() c where c.kind = 'user' limit 1), -1)
$$;
create or replace function semis_v2_private.read_rank(p_key text) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.read_rank from semis_v2_private.key_acl a where a.key = p_key), 2)
$$;
create or replace function semis_v2_private.write_rank(p_key text) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.write_rank from semis_v2_private.key_acl a where a.key = p_key), 3)
$$;

/* ─── 컬렉션 보기 방식: 'full' 그대로 · 'part' 가린 사본 · 'none' 받지 못함 ─── */
create or replace function semis_v2_private.view_mode_for(p_key text, p_kind text, p_role text, p_rank int, p_vclass text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare a record; v record;
begin
  if p_kind is distinct from 'user' then return 'none'; end if;
  if p_role = 'vendor' then
    select * into v from semis_v2_private.vendor_acl x where x.klass = p_vclass and x.key = p_key;
    if not found or not v.can_read then return 'none'; end if;
    return case when v.full_view then 'full' else 'part' end;
  end if;
  select * into a from semis_v2_private.key_acl x where x.key = p_key;
  if not found then return case when p_rank >= 2 then 'full' else 'none' end; end if;
  if p_rank >= a.read_rank then
    if p_key = 'schedules' then return 'part'; end if;                  -- '나에게만 보이기' 일정은 주인만
    if p_key = 'menus' and p_rank < 4 then return 'part'; end if;       -- 권한 밖 메뉴 항목 제외
    if p_key = 'chatRooms' and p_rank < 3 then return 'part'; end if;   -- 참여한 방만
    return 'full';
  end if;
  if a.part_rank is not null and p_rank >= a.part_rank then return 'part'; end if;
  return 'none';
end $$;
create or replace function semis_v2_private.can_write_for(p_key text, p_kind text, p_role text, p_rank int, p_vclass text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_kind is distinct from 'user' then return false; end if;
  if semis_v2_private.view_mode_for(p_key, p_kind, p_role, p_rank, p_vclass) = 'none' then return false; end if;
  if p_role = 'vendor' then
    return coalesce((select x.can_write from semis_v2_private.vendor_acl x where x.klass = p_vclass and x.key = p_key), false);
  end if;
  return p_rank >= semis_v2_private.write_rank(p_key);
end $$;
/* REST 직접 읽기(RLS)는 가림 없이 볼 수 있는 경우만 — 앱은 semis_v2_pull 을 쓴다 */
create or replace function semis_v2_private.can_read_full(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select semis_v2_private.view_mode_for(p_key, c.kind, c.role, c.rank, c.vclass) = 'full'
                     from semis_v2_private.ctx() c limit 1), false)
$$;
/* 로그인 응답의 권한 요약 — key → 'r'(전체) · 'p'(가린 사본) + 'w'(쓰기) · ''(접근 없음)
   권한표의 모든 컬렉션을 싣는다 — 앱은 여기 없는 컬렉션만 def 규칙(읽기 2·쓰기 3)으로 판단 */
create or replace function semis_v2_private.access_map(p_role text, p_rank int, p_vclass text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(z.key, z.f), '{}'::jsonb) from (
    select k.key,
           (case semis_v2_private.view_mode_for(k.key, 'user', p_role, p_rank, p_vclass) when 'full' then 'r' when 'part' then 'p' else '' end)
        || (case when semis_v2_private.can_write_for(k.key, 'user', p_role, p_rank, p_vclass) then 'w' else '' end) as f
      from (select key from semis_v2_private.key_acl union select key from semis_v2_private.vendor_acl) k
  ) z
$$;

/* ─── 가린 사본 ─── */
create or replace function semis_v2_private.redact(p_key text, v jsonb, p_role text, p_rank int, p_vclass text, p_vendor text, p_account text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare arr jsonb := case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end;
        obj jsonb := case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end;
        vend boolean := p_role = 'vendor';
begin
  if p_key = 'menus' then
    if vend then
      return coalesce((select jsonb_agg(m order by t.ord) from jsonb_array_elements(arr) with ordinality t(m, ord)
        where m ->> 'type' = 'module' and (m ->> 'module') = any(semis_v2_private.vendor_routes(p_vclass))), '[]'::jsonb);
    end if;
    /* 권한 밖 항목은 자리(메뉴 구성)만 남기고 링크 주소를 뺀다 — 화면은 vis 로 거른다 */
    return coalesce((select jsonb_agg(case when jsonb_typeof(m) <> 'object' then m
              when case coalesce(nullif(m ->> 'vis', ''), 'all')
                     when 'all' then true
                     when 'mgr' then p_rank >= 2 or m ->> 'module' = 'minutes'
                     when 'hq' then p_rank >= 3
                     else p_rank >= 4 end then m
              else m - 'url' end order by t.ord)
      from jsonb_array_elements(arr) with ordinality t(m, ord)), '[]'::jsonb);
  elsif p_key = 'schedules' then
    return coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(arr) with ordinality t(e, ord)
      where not (coalesce(e ->> 'priv', '') = 'true' and coalesce(e ->> 'owner', '') <> '' and e ->> 'owner' <> coalesce(p_account, ''))), '[]'::jsonb);
  elsif p_key = 'chatRooms' then
    return coalesce((select jsonb_agg(r order by t.ord) from jsonb_array_elements(arr) with ordinality t(r, ord)
      where jsonb_typeof(r -> 'members') = 'array' and (r -> 'members') ? coalesce(p_account, '')), '[]'::jsonb);
  elsif p_key = 'equipment' then                                         -- 구입가(대외비) 제외
    return coalesce((select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'price' else e end order by t.ord)
      from jsonb_array_elements(arr) with ordinality t(e, ord)), '[]'::jsonb);
  elsif p_key = 'passOwners' then                                        -- 사번 · 출입증 번호 · 동의 여부 제외
    return coalesce((select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'empNo' - 'passNo' - 'consent' else e end order by t.ord)
      from jsonb_array_elements(arr) with ordinality t(e, ord)), '[]'::jsonb);
  elsif p_key = 'regulations' then
    if vend then                                                         -- 협력업체: 국제/국가 규정만
      return coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(arr) with ordinality t(e, ord)
        where e ->> 'scope' = 'intl'), '[]'::jsonb);
    end if;
    return coalesce((select jsonb_agg(case when jsonb_typeof(e) = 'object' then e || '{"ideas":[]}'::jsonb else e end order by t.ord)
      from jsonb_array_elements(arr) with ordinality t(e, ord)), '[]'::jsonb);   -- 개정 아이디어(내부 검토)는 보안관리자 이상
  elsif p_key = 'billing' and vend then                                  -- 자기 업체 청구분만
    return coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(arr) with ordinality t(e, ord)
      where coalesce(e ->> 'vendor', '') = p_vendor and p_vendor <> ''), '[]'::jsonb);
  elsif p_key = 'equipMaint' and vend then                               -- 자기 업체 계약·비용만
    return jsonb_build_object(
      'contracts', coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(
          case when jsonb_typeof(obj -> 'contracts') = 'array' then obj -> 'contracts' else '[]'::jsonb end) with ordinality t(e, ord)
        where semis_v2_private.same_vendor(e ->> 'vendor', p_vendor)), '[]'::jsonb),
      'costs', coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(
          case when jsonb_typeof(obj -> 'costs') = 'array' then obj -> 'costs' else '[]'::jsonb end) with ordinality t(e, ord)
        where semis_v2_private.same_vendor(e ->> 'vendor', p_vendor)), '[]'::jsonb));
  end if;
  return null;   -- 규칙 없는 가림 = 주지 않는다
end $$;

/* ─── 가린 사본을 가진 사용자의 저장: 보이지 않던 부분은 서버 값을 그대로 둔다 ─── */
create or replace function semis_v2_private.merge_part(p_key text, p_old jsonb, p_new jsonb, p_role text, p_vendor text, p_account text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  oa jsonb := case when jsonb_typeof(p_old) = 'array' then p_old else '[]'::jsonb end;
  na jsonb := case when jsonb_typeof(p_new) = 'array' then p_new else '[]'::jsonb end;
  oo jsonb := case when jsonb_typeof(p_old) = 'object' then p_old else '{}'::jsonb end;
  no jsonb := case when jsonb_typeof(p_new) = 'object' then p_new else '{}'::jsonb end;
  keep jsonb; incoming jsonb;
begin
  if p_key = 'schedules' then
    keep := coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(oa) with ordinality t(e, ord)
      where coalesce(e ->> 'priv', '') = 'true' and coalesce(e ->> 'owner', '') <> '' and e ->> 'owner' <> coalesce(p_account, '')), '[]'::jsonb);
    incoming := coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(na) with ordinality t(e, ord)
      where not (coalesce(e ->> 'priv', '') = 'true' and coalesce(e ->> 'owner', '') <> '' and e ->> 'owner' <> coalesce(p_account, ''))
        and not exists (select 1 from jsonb_array_elements(keep) k where k ->> 'id' = e ->> 'id')), '[]'::jsonb);
    return incoming || keep;
  elsif p_key = 'billing' and p_role = 'vendor' then
    return coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(oa) with ordinality t(e, ord)
                      where coalesce(e ->> 'vendor', '') <> p_vendor), '[]'::jsonb)
        || coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(na) with ordinality t(e, ord)
                      where coalesce(e ->> 'vendor', '') = p_vendor and p_vendor <> ''), '[]'::jsonb);
  elsif p_key = 'equipMaint' and p_role = 'vendor' then
    return oo || jsonb_build_object(
      'contracts',
        coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(
            case when jsonb_typeof(oo -> 'contracts') = 'array' then oo -> 'contracts' else '[]'::jsonb end) with ordinality t(e, ord)
          where not semis_v2_private.same_vendor(e ->> 'vendor', p_vendor)), '[]'::jsonb)
     || coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(
            case when jsonb_typeof(no -> 'contracts') = 'array' then no -> 'contracts' else '[]'::jsonb end) with ordinality t(e, ord)
          where semis_v2_private.same_vendor(e ->> 'vendor', p_vendor)), '[]'::jsonb),
      'costs',
        coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(
            case when jsonb_typeof(oo -> 'costs') = 'array' then oo -> 'costs' else '[]'::jsonb end) with ordinality t(e, ord)
          where not semis_v2_private.same_vendor(e ->> 'vendor', p_vendor)), '[]'::jsonb)
     || coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(
            case when jsonb_typeof(no -> 'costs') = 'array' then no -> 'costs' else '[]'::jsonb end) with ordinality t(e, ord)
          where semis_v2_private.same_vendor(e ->> 'vendor', p_vendor)), '[]'::jsonb));
  elsif p_key = 'regulations' and p_role = 'vendor' then
    return coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(oa) with ordinality t(e, ord)
                      where coalesce(e ->> 'scope', '') <> 'intl'), '[]'::jsonb)
        || coalesce((select jsonb_agg(e order by t.ord) from jsonb_array_elements(na) with ordinality t(e, ord)
                      where e ->> 'scope' = 'intl'), '[]'::jsonb);
  elsif p_key = 'equipment' then                                         -- 구입가를 모르는 사용자: 기존 구입가 유지
    return coalesce((select jsonb_agg(
        case when jsonb_typeof(e) <> 'object' then e
             when o.e2 is not null and o.e2 ? 'price' then (e - 'price') || jsonb_build_object('price', o.e2 -> 'price')
             else e - 'price' end order by t.ord)
      from jsonb_array_elements(na) with ordinality t(e, ord)
      left join lateral (select x as e2 from jsonb_array_elements(oa) x where x ->> 'id' = e ->> 'id' limit 1) o on true), '[]'::jsonb);
  end if;
  raise exception 'semis: no merge rule for %', p_key using errcode = '42501';
end $$;

/* ═════════════ 회의 서명 ═════════════ */
/* 회의 서명 코드 (js signCodeFor 와 같은 djb2 파생) */
create or replace function semis_v2_private.sign_code(p_id text) returns text
language plpgsql immutable set search_path = '' as $$
declare h bigint := 5381; i int;
begin
  for i in 1 .. coalesce(length(p_id), 0) loop
    h := ((h * 33) & 4294967295) # ascii(substr(p_id, i, 1));
  end loop;
  return (100000 + (h % 900000))::text;
end $$;

/* 회의록 서명 화면에 필요한 만큼만 (다른 참석자의 서명 이미지는 보내지 않는다) */
create or replace function semis_v2_private.sign_view(p_mid text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m ->> 'id', 'title', coalesce(m ->> 'title', ''), 'date', coalesce(m ->> 'date', ''),
    'time', coalesce(m ->> 'time', ''), 'place', coalesce(m ->> 'place', ''), 'folder', coalesce(m ->> 'folder', ''),
    'folderName', (select f ->> 'name' from public.semis_store s2, jsonb_array_elements(
                     case when jsonb_typeof(s2.value) = 'array' then s2.value else '[]'::jsonb end) f
                    where s2.key = 'minuteFolders' and f ->> 'id' = m ->> 'folder' limit 1),
    'folderIcon', (select f ->> 'icon' from public.semis_store s2, jsonb_array_elements(
                     case when jsonb_typeof(s2.value) = 'array' then s2.value else '[]'::jsonb end) f
                    where s2.key = 'minuteFolders' and f ->> 'id' = m ->> 'folder' limit 1),
    'attendees', case when jsonb_typeof(m -> 'attendees') = 'array' then coalesce((
        select jsonb_agg(jsonb_build_object('name', coalesce(a ->> 'name', ''), 'org', coalesce(a ->> 'org', ''),
                                            'role', coalesce(a ->> 'role', ''), 'signed', coalesce(a ->> 'sign', '') <> '')
                         order by t.ord)
          from jsonb_array_elements(m -> 'attendees') with ordinality as t(a, ord)), '[]'::jsonb)
      else '[]'::jsonb end)
  from public.semis_store s, jsonb_array_elements(
         case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) m
  where s.key = 'minutes' and m ->> 'id' = p_mid
  limit 1
$$;

/* 보안장비 협의회 서명 화면 — 회차 목록과 명단(구분·소속·이름·직책·서명 여부)만 */
create or replace function semis_v2_private.council_view() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m ->> 'id', 'round', m -> 'round', 'date', coalesce(m ->> 'date', ''),
      'time', coalesce(m ->> 'time', ''), 'place', coalesce(m ->> 'place', ''),
      'attendees', case when jsonb_typeof(m -> 'attendees') = 'array' then coalesce((
          select jsonb_agg(jsonb_build_object('cat', coalesce(a ->> 'cat', ''), 'org', coalesce(a ->> 'org', ''),
                                              'name', coalesce(a ->> 'name', ''), 'role', coalesce(a ->> 'role', ''),
                                              'signed', coalesce(a ->> 'sign', '') <> '') order by t.ord)
            from jsonb_array_elements(m -> 'attendees') with ordinality as t(a, ord)), '[]'::jsonb)
        else '[]'::jsonb end) order by mo.ord), '[]'::jsonb)
  from public.semis_store s,
       jsonb_array_elements(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) with ordinality mo(m, ord)
  where s.key = 'council' and coalesce(m ->> 'id', '') <> ''
$$;

/* 로그인·확인 응답 공통 */
drop function if exists semis_v2_private.session_payload(text, text, text);
create or replace function semis_v2_private.session_payload(p_account text, p_kind text, p_minute text, p_sign_kind text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a semis_v2_private.accounts%rowtype; vc text;
begin
  if p_kind = 'signer' then
    if p_sign_kind = 'council' then
      return jsonb_build_object('kind', 'signer',
        'user', jsonb_build_object('id', '__signer__', 'name', '보안장비 협의회', 'role', 'signer', 'signMeetingId', p_minute),
        'council', semis_v2_private.council_view());
    end if;
    return jsonb_build_object('kind', 'signer',
      'user', jsonb_build_object('id', '__signer__', 'name', '회의록 참석 서명', 'role', 'signer', 'signMinuteId', p_minute),
      'minute', semis_v2_private.sign_view(p_minute));
  end if;
  select * into a from semis_v2_private.accounts where id = p_account;
  vc := case when a.role = 'vendor' then semis_v2_private.vendor_class(a.vendor) else '' end;
  return jsonb_build_object('kind', 'user',
    'user', jsonb_build_object('id', a.login_id, 'origId', a.id, 'name', a.name, 'role', a.role,
                               'vendor', a.vendor, 'base', a.base, 'vclass', vc),
    'rank', semis_v2_private.rank_of(a.role),
    'access', semis_v2_private.access_map(a.role, semis_v2_private.rank_of(a.role), vc),
    'def', case when a.role = 'vendor' then 'null'::jsonb else jsonb_build_array(2, 3) end);
end $$;

/* 암호 규칙 · 중복 확인 */
create or replace function semis_v2_private.legacy_hash(p_pw text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest('SeMISv2::' || p_pw, 'sha256'), 'hex')
$$;
create or replace function semis_v2_private.pw_problem(p_pw text, p_login text, p_except text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare lg text;
begin
  if p_pw is null or length(p_pw) < 8 then return 'short'; end if;
  if length(p_pw) > 64 then return 'long'; end if;
  if btrim(p_pw) = '' then return 'short'; end if;
  if lower(p_pw) = lower(coalesce(p_login, '')) then return 'same_as_id'; end if;
  if p_pw ~ '^\d{6}$' then return 'six_digits'; end if;   -- 6자리 숫자는 회의 서명 코드와 겹친다
  lg := semis_v2_private.legacy_hash(p_pw);
  if exists (select 1 from semis_v2_private.accounts a
              where a.id is distinct from p_except and a.pw_hash = extensions.crypt(lg, a.pw_hash)) then
    return 'in_use';
  end if;
  return null;
end $$;

/* ═════════════ 로그인 자동공격 방어 ═════════════
   ① 작업증명(PoW): 서버가 서명한 문제{nonce·만료 2분·난이도}를 브라우저가 풀어 로그인에 첨부(1회용)
   ② 전체 실패 수(모든 IP, 15분)가 늘면 난이도를 올린다 → 공격 비용↑, 서버 자원은 쓰지 않는다
   ③ 회의 서명 코드(6자리)는 전체 실패가 1시간 200회를 넘으면 15분 동안 받지 않는다
   ④ IP별 15분 20회 실패 → 15분 제한 (기존) */
create or replace function semis_v2_private.fail_count(p_minutes int, p_kind text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from semis_v2_private.login_attempts la
   where not la.ok and la.at > now() - make_interval(mins => p_minutes)
     and (p_kind is null or la.kind = p_kind)
$$;
create or replace function semis_v2_private.pow_bits() returns int
language plpgsql stable security definer set search_path = '' as $$
declare base int; f int;
begin
  select coalesce((v ->> 'base')::int, 16) into base from semis_v2_private.settings where k = 'pow';
  base := coalesce(base, 16);
  f := semis_v2_private.fail_count(15, null);
  return base + case when f >= 400 then 6 when f >= 150 then 4 when f >= 50 then 2 else 0 end;
end $$;
create or replace function semis_v2_private.pow_sig(p_body text) returns text
language sql stable security definer set search_path = '' as $$
  select left(encode(extensions.hmac(p_body, (select v ->> 'secret' from semis_v2_private.settings where k = 'pow'), 'sha256'), 'hex'), 32)
$$;
/* sha256(c ':' x) 의 앞 d 비트가 0 인지 */
create or replace function semis_v2_private.pow_ok(p_c text, p_x text, p_d int) returns boolean
language plpgsql immutable set search_path = '' as $$
declare h bytea; v bigint;
begin
  if p_x is null or p_x !~ '^[0-9]{1,16}$' or p_d < 1 or p_d > 30 then return false; end if;
  h := extensions.digest(p_c || ':' || p_x, 'sha256');
  v := (get_byte(h, 0)::bigint << 24) | (get_byte(h, 1)::bigint << 16) | (get_byte(h, 2)::bigint << 8) | get_byte(h, 3)::bigint;
  return (v >> (32 - p_d)) = 0;
end $$;
/* 확인 — 통과면 null, 아니면 오류 코드 */
create or replace function semis_v2_private.pow_check(p_pow jsonb) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare c text; x text; parts text[]; n text; e bigint; d int; base int; cnt int;
begin
  if p_pow is null or jsonb_typeof(p_pow) <> 'object' then return 'pow'; end if;
  c := p_pow ->> 'c'; x := p_pow ->> 'x';
  if c is null or length(c) > 120 then return 'pow'; end if;
  parts := string_to_array(c, '.');
  if array_length(parts, 1) <> 4 or parts[1] !~ '^[0-9a-f]{32}$' or parts[2] !~ '^[0-9]{10}$' or parts[3] !~ '^[0-9]{1,2}$' then
    return 'pow';
  end if;
  n := parts[1]; e := parts[2]::bigint; d := parts[3]::int;
  if parts[4] is distinct from semis_v2_private.pow_sig(n || '.' || e || '.' || d) then return 'pow'; end if;
  if e < extract(epoch from now())::bigint then return 'pow_expired'; end if;
  select coalesce((v ->> 'base')::int, 16) into base from semis_v2_private.settings where k = 'pow';
  if d < coalesce(base, 16) then return 'pow'; end if;
  if not semis_v2_private.pow_ok(c, x, d) then return 'pow'; end if;
  insert into semis_v2_private.pow_used(nonce) values (n) on conflict do nothing;
  get diagnostics cnt = row_count;
  if cnt = 0 then return 'pow_used'; end if;
  return null;
end $$;

/* ═════════════ 공개 RPC ═════════════ */

create or replace function public.semis_v2_challenge() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare n text := encode(extensions.gen_random_bytes(16), 'hex');
        e bigint := extract(epoch from now())::bigint + 120;
        d int := semis_v2_private.pow_bits();
        body text;
begin
  body := n || '.' || e || '.' || d;
  return jsonb_build_object('ok', true, 'c', body || '.' || semis_v2_private.pow_sig(body), 'd', d);
end $$;

drop function if exists public.semis_v2_login(text, text);
create or replace function public.semis_v2_login(p_pw text, p_ua text default null, p_pow jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ip   text := semis_v2_private.client_ip();
  v_now  timestamptz := now();
  v_fail int;
  v_err  text;
  v_acc  semis_v2_private.accounts%rowtype;
  v_tok  text;
  v_mid  text;
  v_kind text;
begin
  if p_pw is null or length(p_pw) = 0 or length(p_pw) > 200 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  v_err := semis_v2_private.pow_check(p_pow);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  delete from semis_v2_private.sessions where hard_expires_at < v_now or expires_at < v_now - interval '1 day';
  delete from semis_v2_private.login_attempts where at < v_now - interval '2 days';
  delete from semis_v2_private.audit where at < v_now - interval '400 days';
  delete from semis_v2_private.pow_used where at < v_now - interval '10 minutes';

  select count(*) into v_fail from semis_v2_private.login_attempts
   where ip = v_ip and not ok and at > v_now - interval '15 minutes';
  if v_fail >= 20 then
    insert into semis_v2_private.audit(actor, action, ip) values (null, 'login_locked', v_ip);
    return jsonb_build_object('ok', false, 'error', 'locked', 'wait', 15);
  end if;

  select * into v_acc from semis_v2_private.accounts a
   where not a.disabled and a.pw_hash = extensions.crypt(semis_v2_private.legacy_hash(p_pw), a.pw_hash)
   limit 1;
  if found then
    v_tok := encode(extensions.gen_random_bytes(32), 'hex');
    insert into semis_v2_private.sessions(token_hash, account_id, kind, expires_at, hard_expires_at, ip, ua)
    values (encode(extensions.digest(v_tok, 'sha256'), 'hex'), v_acc.id, 'user',
            v_now + interval '24 hours', v_now + interval '30 days', v_ip, left(coalesce(p_ua, ''), 200));
    update semis_v2_private.accounts set last_login_at = v_now where id = v_acc.id;
    insert into semis_v2_private.login_attempts(ip, ok, kind) values (v_ip, true, 'user');
    insert into semis_v2_private.audit(actor, action, ip) values (v_acc.id, 'login', v_ip);
    return jsonb_build_object('ok', true, 'token', v_tok) || semis_v2_private.session_payload(v_acc.id, 'user', null, null);
  end if;

  /* 6자리 = 회의 참석 서명 코드 (회의일 ±90일) — 협의회 먼저(최근 회차), 없으면 회의록 */
  if p_pw ~ '^\d{6}$' then
    if semis_v2_private.fail_count(60, 'sign') >= 200
       and exists (select 1 from semis_v2_private.login_attempts la
                    where not la.ok and la.kind = 'sign' and la.at > v_now - interval '15 minutes') then
      insert into semis_v2_private.audit(actor, action, ip) values (null, 'sign_paused', v_ip);
      return jsonb_build_object('ok', false, 'error', 'sign_paused', 'wait', 15);
    end if;
    select m ->> 'id' into v_mid
      from public.semis_store s, jsonb_array_elements(
             case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) m
     where s.key = 'council'
       and coalesce(m ->> 'id', '') <> ''
       and coalesce(m ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
       and (m ->> 'date')::date between (v_now - interval '90 days')::date and (v_now + interval '90 days')::date
       and semis_v2_private.sign_code(m ->> 'id') = p_pw
     order by case when coalesce(m ->> 'round', '') ~ '^\d{1,6}$' then (m ->> 'round')::int else 0 end desc
     limit 1;
    if v_mid is not null then
      v_kind := 'council';
    else
      select m ->> 'id' into v_mid
        from public.semis_store s, jsonb_array_elements(
               case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) m
       where s.key = 'minutes'
         and coalesce(m ->> 'id', '') <> ''
         and coalesce(m ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
         and (m ->> 'date')::date between (v_now - interval '90 days')::date and (v_now + interval '90 days')::date
         and semis_v2_private.sign_code(m ->> 'id') = p_pw
       order by m ->> 'date' desc
       limit 1;
      v_kind := 'minutes';
    end if;
    if v_mid is not null then
      v_tok := encode(extensions.gen_random_bytes(32), 'hex');
      insert into semis_v2_private.sessions(token_hash, account_id, kind, minute_id, sign_kind, expires_at, hard_expires_at, ip, ua)
      values (encode(extensions.digest(v_tok, 'sha256'), 'hex'), null, 'signer', v_mid, v_kind,
              v_now + interval '3 hours', v_now + interval '12 hours', v_ip, left(coalesce(p_ua, ''), 200));
      insert into semis_v2_private.login_attempts(ip, ok, kind) values (v_ip, true, 'sign');
      insert into semis_v2_private.audit(actor, action, detail, ip)
      values ('signer', 'sign_open', jsonb_build_object(case when v_kind = 'council' then 'council' else 'minute' end, v_mid), v_ip);
      return jsonb_build_object('ok', true, 'token', v_tok) || semis_v2_private.session_payload(null, 'signer', v_mid, v_kind);
    end if;
  end if;

  insert into semis_v2_private.login_attempts(ip, ok, kind)
  values (v_ip, false, case when p_pw ~ '^\d{6}$' then 'sign' else 'user' end);
  insert into semis_v2_private.audit(actor, action, ip) values (null, 'login_fail', v_ip);
  return jsonb_build_object('ok', false, 'error', 'invalid');
end $$;

create or replace function public.semis_v2_whoami(p_touch boolean default true) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_v2_private.ctx() limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if p_touch then
    update semis_v2_private.sessions
       set last_seen = now(),
           expires_at = least(hard_expires_at, now() + case when kind = 'signer' then interval '3 hours' else interval '24 hours' end)
     where token_hash = c.token_hash and last_seen < now() - interval '2 minutes';
  end if;
  return jsonb_build_object('ok', true) || semis_v2_private.session_payload(c.account_id, c.kind, c.minute_id, c.sign_kind);
end $$;

/* Edge Function(파일 · 세미 · 뉴스)용 세션 확인 */
create or replace function public.semis_v2_file_auth() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_v2_private.ctx() limit 1;
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'kind', c.kind, 'rank', c.rank, 'who', coalesce(c.login_id, c.kind),
    'role', c.role, 'vclass', c.vclass, 'vendor', c.vendor, 'sign', case when c.kind = 'signer' then c.sign_kind else '' end,
    'id', coalesce(c.login_id, ''), 'origId', coalesce(c.account_id, ''), 'name', coalesce(c.name, ''));
end $$;

create or replace function public.semis_v2_logout() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_v2_private.ctx() limit 1;
  if found then
    delete from semis_v2_private.sessions where token_hash = c.token_hash;
    insert into semis_v2_private.audit(actor, action, ip) values (coalesce(c.account_id, c.kind), 'logout', semis_v2_private.client_ip());
  end if;
  return jsonb_build_object('ok', true);
end $$;

/* ─── 데이터 읽기 · 쓰기 (권한 · 가림 · 병합은 서버가) ─── */
create or replace function public.semis_v2_pull(p_keys text[] default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_v2_private.ctx() limit 1;
  if not found or c.kind <> 'user' then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('key', x.key, 'value', x.val, 'updated_at', x.updated_at,
                                        'updated_by', regexp_replace(coalesce(x.updated_by, ''), '^.*/', '')))
      from (select s.key, s.updated_at, s.updated_by,
                   case when vm.m = 'full' then s.value
                        else semis_v2_private.redact(s.key, s.value, c.role, c.rank, c.vclass, c.vendor, c.account_id) end as val
              from public.semis_store s
              cross join lateral (select semis_v2_private.view_mode_for(s.key, c.kind, c.role, c.rank, c.vclass) as m) vm
             where vm.m <> 'none'
               and (p_keys is null or s.key = any(p_keys))) x
     where x.val is not null), '[]'::jsonb));
end $$;

create or replace function public.semis_v2_push(p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record; r jsonb; k text; v jsonb; oldv jsonb; mode text; denied text[] := '{}'; done text[] := '{}';
begin
  select * into c from semis_v2_private.ctx() limit 1;
  if not found or c.kind <> 'user' then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 60 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    k := r ->> 'key';
    if k is null or k !~ '^[A-Za-z0-9_]{1,40}$' or not (r ? 'value')
       or not semis_v2_private.can_write_for(k, c.kind, c.role, c.rank, c.vclass) then
      denied := denied || coalesce(k, '?');
    end if;
  end loop;
  if cardinality(denied) > 0 then
    return jsonb_build_object('ok', false, 'error', 'forbidden', 'denied', to_jsonb(denied));
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    k := r ->> 'key';
    v := r -> 'value';
    if pg_column_size(v) > 6000000 then return jsonb_build_object('ok', false, 'error', 'too_large', 'key', k); end if;
    mode := semis_v2_private.view_mode_for(k, c.kind, c.role, c.rank, c.vclass);
    if mode = 'part' then
      select s.value into oldv from public.semis_store s where s.key = k for update;
      v := semis_v2_private.merge_part(k, oldv, v, c.role, c.vendor, c.account_id);
    end if;
    insert into public.semis_store(key, value, updated_by)
    values (k, v, left(regexp_replace(coalesce(r ->> 'by', ''), '[^A-Za-z0-9_-]', '', 'g'), 40))
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
    done := done || k;
  end loop;
  return jsonb_build_object('ok', true, 'keys', to_jsonb(done));
end $$;

/* ─── 회의록 참석 서명 (signer 세션 · 그 회의 한 건만) ─── */
create or replace function public.semis_v2_sign_submit(p_idx int, p_expect text, p_name text, p_org text, p_role text, p_sign text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c record; v_list jsonb; v_pos int; v_m jsonb; v_att jsonb; v_n int; v_t int := -1; i int; a jsonb;
  v_name text := btrim(coalesce(p_name, ''));
  v_org  text := btrim(coalesce(p_org, ''));
  v_role text := btrim(coalesce(p_role, ''));
begin
  select * into c from semis_v2_private.ctx() limit 1;
  if not found or c.kind <> 'signer' or c.sign_kind <> 'minutes' then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if v_name = '' or v_org = '' then return jsonb_build_object('ok', false, 'error', 'required'); end if;
  if length(v_name) > 30 or length(v_org) > 40 or length(v_role) > 24 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;
  if p_sign is not null and p_sign <> '' and not (
       (p_sign like 'https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-files/minutes-sign/%'
        and length(p_sign) < 400 and p_sign !~ '[[:space:]"''<>\\]')
    or (p_sign like 'data:image/png;base64,%' and length(p_sign) <= 400000
        and p_sign ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$')) then
    return jsonb_build_object('ok', false, 'error', 'bad_sign');
  end if;

  select s.value into v_list from public.semis_store s where s.key = 'minutes' for update;
  if v_list is null or jsonb_typeof(v_list) <> 'array' then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select (t.ord - 1)::int into v_pos
    from jsonb_array_elements(v_list) with ordinality as t(m, ord)
   where t.m ->> 'id' = c.minute_id limit 1;
  if v_pos is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  v_m := v_list -> v_pos;
  v_att := case when jsonb_typeof(v_m -> 'attendees') = 'array' then v_m -> 'attendees' else '[]'::jsonb end;
  v_n := jsonb_array_length(v_att);
  if p_idx is not null and p_idx >= 0 and p_idx < v_n
     and btrim(coalesce(v_att -> p_idx ->> 'name', '')) = btrim(coalesce(p_expect, '')) then
    v_t := p_idx;
  end if;
  if v_t < 0 then
    for i in 0 .. v_n - 1 loop
      a := v_att -> i;
      if btrim(coalesce(a ->> 'name', '')) = v_name
         and (btrim(coalesce(a ->> 'org', '')) = '' or btrim(a ->> 'org') = v_org) then
        v_t := i; exit;
      end if;
    end loop;
  end if;
  if v_t < 0 then
    if v_n >= 60 then return jsonb_build_object('ok', false, 'error', 'full'); end if;
    v_att := v_att || jsonb_build_array(jsonb_build_object('name', '', 'org', '', 'role', '', 'note', '', 'sign', ''));
    v_t := v_n;
  end if;
  a := (v_att -> v_t) || jsonb_build_object('name', v_name, 'org', v_org, 'role', v_role);
  if p_sign is not null then a := a || jsonb_build_object('sign', p_sign); end if;
  v_att := jsonb_set(v_att, array[v_t::text], a);
  v_m := jsonb_set(v_m, '{attendees}', v_att);
  v_list := jsonb_set(v_list, array[v_pos::text], v_m);
  update public.semis_store set value = v_list, updated_by = 'signer' where key = 'minutes';
  insert into semis_v2_private.audit(actor, action, detail, ip)
  values ('signer', case when p_sign is null then 'sign_info' else 'sign' end,
          jsonb_build_object('minute', c.minute_id, 'name', v_name), semis_v2_private.client_ip());
  return jsonb_build_object('ok', true, 'index', v_t, 'minute', semis_v2_private.sign_view(c.minute_id));
end $$;

/* ─── 보안장비 협의회 참석 서명 (signer 세션 · js/council.js saveSignEntry 와 같은 규칙) ───
   회차 선택으로 지난 회의의 본인 항목도 고칠 수 있고, p_past 면 지난 회의 명단의 소속·직책·구분도 맞춘다 */
create or replace function public.semis_v2_council_sign(p_mid text, p_idx int, p_expect text, p_name text, p_org text,
                                                         p_role text, p_cat text, p_sign text, p_past boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c record; v_list jsonb; v_pos int; v_m jsonb; v_att jsonb; v_n int; v_t int := -1; i int; j int; a jsonb; v_date text; o jsonb; oa jsonb; ch boolean;
  v_name text := btrim(coalesce(p_name, ''));
  v_org  text := btrim(coalesce(p_org, ''));
  v_role text := btrim(coalesce(p_role, ''));
  v_cat  text := btrim(coalesce(p_cat, ''));
begin
  select * into c from semis_v2_private.ctx() limit 1;
  if not found or c.kind <> 'signer' or c.sign_kind <> 'council' then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if v_name = '' or v_org = '' then return jsonb_build_object('ok', false, 'error', 'required'); end if;
  if length(v_name) > 40 or length(v_org) > 60 or length(v_role) > 40 then return jsonb_build_object('ok', false, 'error', 'too_long'); end if;
  if v_cat not in ('제조사', '유지보수', '운영자', '본사', '기타') then v_cat := '기타'; end if;
  if p_sign is not null and p_sign <> '' and not (
       (p_sign like 'https://mzyuzrxkdcpzxojenwat.supabase.co/storage/v1/object/public/semis-files/council-sign/%'
        and length(p_sign) < 400 and p_sign !~ '[[:space:]"''<>\\]')
    or (p_sign like 'data:image/png;base64,%' and length(p_sign) <= 400000
        and p_sign ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$')) then
    return jsonb_build_object('ok', false, 'error', 'bad_sign');
  end if;

  select s.value into v_list from public.semis_store s where s.key = 'council' for update;
  if v_list is null or jsonb_typeof(v_list) <> 'array' then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select (t.ord - 1)::int into v_pos
    from jsonb_array_elements(v_list) with ordinality as t(m, ord)
   where t.m ->> 'id' = coalesce(nullif(p_mid, ''), c.minute_id) limit 1;
  if v_pos is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  v_m := v_list -> v_pos;
  v_date := coalesce(v_m ->> 'date', '');
  v_att := case when jsonb_typeof(v_m -> 'attendees') = 'array' then v_m -> 'attendees' else '[]'::jsonb end;
  v_n := jsonb_array_length(v_att);
  if p_idx is not null and p_idx >= 0 and p_idx < v_n
     and btrim(coalesce(v_att -> p_idx ->> 'name', '')) = btrim(coalesce(p_expect, '')) then
    v_t := p_idx;
  end if;
  if v_t < 0 then
    for i in 0 .. v_n - 1 loop
      if btrim(coalesce(v_att -> i ->> 'name', '')) = v_name then v_t := i; exit; end if;
    end loop;
  end if;
  if v_t < 0 then
    if v_n >= 80 then return jsonb_build_object('ok', false, 'error', 'full'); end if;
    v_att := v_att || jsonb_build_array(jsonb_build_object('note', '', 'sign', ''));
    v_t := v_n;
  end if;
  a := (v_att -> v_t) || jsonb_build_object('cat', v_cat, 'org', v_org, 'name', v_name, 'role', v_role);
  if p_sign is not null and p_sign <> '' then a := a || jsonb_build_object('sign', p_sign); end if;
  v_att := jsonb_set(v_att, array[v_t::text], a);
  v_m := jsonb_set(v_m, '{attendees}', v_att);
  v_list := jsonb_set(v_list, array[v_pos::text], v_m);

  if coalesce(p_past, false) then                       -- 지난 회의(이후 회의 제외) 명단의 소속·직책·구분
    for i in 0 .. jsonb_array_length(v_list) - 1 loop
      o := v_list -> i;
      if i = v_pos or coalesce(o ->> 'id', '') = '' then continue; end if;
      if v_date <> '' and coalesce(o ->> 'date', '') > v_date then continue; end if;
      if jsonb_typeof(o -> 'attendees') <> 'array' then continue; end if;
      oa := o -> 'attendees'; ch := false;
      for j in 0 .. jsonb_array_length(oa) - 1 loop
        if btrim(coalesce(oa -> j ->> 'name', '')) = v_name then
          oa := jsonb_set(oa, array[j::text], (oa -> j) || jsonb_build_object('cat', v_cat, 'org', v_org, 'role', v_role));
          ch := true;
        end if;
      end loop;
      if ch then v_list := jsonb_set(v_list, array[i::text], jsonb_set(o, '{attendees}', oa)); end if;
    end loop;
  end if;

  update public.semis_store set value = v_list, updated_by = 'signer' where key = 'council';
  insert into semis_v2_private.audit(actor, action, detail, ip)
  values ('signer', case when coalesce(p_sign, '') = '' then 'sign_info' else 'sign' end,
          jsonb_build_object('council', v_m ->> 'id', 'name', v_name), semis_v2_private.client_ip());
  return jsonb_build_object('ok', true, 'index', v_t, 'council', semis_v2_private.council_view());
end $$;

/* ═════════════ 시스템관리자 전용 ═════════════ */
create or replace function semis_v2_private.admin_ctx() returns table(account_id text, token_hash text)
language sql stable security definer set search_path = '' as $$
  select c.account_id, c.token_hash from semis_v2_private.ctx() c where c.kind = 'user' and c.rank >= 4 limit 1
$$;

create or replace function public.semis_v2_users() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from semis_v2_private.admin_ctx()) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'users', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.login_id, 'origId', a.id, 'name', a.name, 'role', a.role,
             'vendor', a.vendor, 'base', a.base, 'disabled', a.disabled,
             'pwChangedAt', a.pw_changed_at, 'lastLoginAt', a.last_login_at,
             'sessions', (select count(*) from semis_v2_private.sessions s where s.account_id = a.id and s.expires_at > now()))
           order by a.base desc, a.created_at, a.id)
      from semis_v2_private.accounts a), '[]'::jsonb));
end $$;

create or replace function public.semis_v2_user_save(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me record; v_orig text := nullif(btrim(coalesce(p ->> 'origId', '')), '');
  v_login text := btrim(coalesce(p ->> 'id', '')); v_name text := btrim(coalesce(p ->> 'name', ''));
  v_role text := coalesce(p ->> 'role', ''); v_vendor text := btrim(coalesce(p ->> 'vendor', ''));
  v_pw text := p ->> 'pw'; v_prob text; v_cur semis_v2_private.accounts%rowtype;
begin
  select * into me from semis_v2_private.admin_ctx();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if v_login !~ '^[A-Za-z0-9_-]{2,20}$' then return jsonb_build_object('ok', false, 'error', 'bad_id'); end if;
  if v_name = '' or length(v_name) > 20 then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;
  if v_role not in ('admin','hq','manager','user','vendor') then return jsonb_build_object('ok', false, 'error', 'bad_role'); end if;
  if v_role = 'vendor' and v_vendor = '' then return jsonb_build_object('ok', false, 'error', 'vendor'); end if;
  if v_role <> 'vendor' then v_vendor := ''; end if;
  if length(v_vendor) > 40 then return jsonb_build_object('ok', false, 'error', 'vendor'); end if;

  if v_orig is null then
    if exists (select 1 from semis_v2_private.accounts where login_id = v_login or id = v_login) then
      return jsonb_build_object('ok', false, 'error', 'dup_id');
    end if;
    v_prob := semis_v2_private.pw_problem(v_pw, v_login, null);
    if v_prob is not null then return jsonb_build_object('ok', false, 'error', 'pw_' || v_prob); end if;
    insert into semis_v2_private.accounts(id, login_id, name, role, vendor, pw_hash, base, pw_changed_at)
    values (v_login, v_login, v_name, v_role, v_vendor,
            extensions.crypt(semis_v2_private.legacy_hash(v_pw), extensions.gen_salt('bf', 10)), false, now());
    insert into semis_v2_private.audit(actor, action, detail, ip)
    values (me.account_id, 'user_create', jsonb_build_object('id', v_login, 'role', v_role), semis_v2_private.client_ip());
    return jsonb_build_object('ok', true);
  end if;

  select * into v_cur from semis_v2_private.accounts where id = v_orig;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if exists (select 1 from semis_v2_private.accounts where login_id = v_login and id <> v_orig) then
    return jsonb_build_object('ok', false, 'error', 'dup_id');
  end if;
  if v_orig = 'mark3464' then v_role := 'admin'; v_vendor := ''; end if;
  if v_orig = me.account_id and v_role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'self_role'); end if;
  update semis_v2_private.accounts
     set login_id = v_login, name = v_name, role = v_role, vendor = v_vendor, updated_at = now()
   where id = v_orig;
  insert into semis_v2_private.audit(actor, action, detail, ip)
  values (me.account_id, 'user_update', jsonb_build_object('id', v_orig, 'login', v_login, 'role', v_role), semis_v2_private.client_ip());
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.semis_v2_user_delete(p_orig text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me record;
begin
  select * into me from semis_v2_private.admin_ctx();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_orig = 'mark3464' or p_orig = me.account_id then return jsonb_build_object('ok', false, 'error', 'protected'); end if;
  delete from semis_v2_private.accounts where id = p_orig;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  insert into semis_v2_private.audit(actor, action, detail, ip)
  values (me.account_id, 'user_delete', jsonb_build_object('id', p_orig), semis_v2_private.client_ip());
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.semis_v2_set_password(p_orig text, p_new text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me record; v_acc semis_v2_private.accounts%rowtype; v_prob text; v_n int;
begin
  select * into me from semis_v2_private.admin_ctx();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into v_acc from semis_v2_private.accounts where id = p_orig;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_prob := semis_v2_private.pw_problem(p_new, v_acc.login_id, v_acc.id);
  if v_prob is not null then return jsonb_build_object('ok', false, 'error', 'pw_' || v_prob); end if;
  update semis_v2_private.accounts
     set pw_hash = extensions.crypt(semis_v2_private.legacy_hash(p_new), extensions.gen_salt('bf', 10)),
         pw_changed_at = now(), updated_at = now()
   where id = p_orig;
  delete from semis_v2_private.sessions where account_id = p_orig and token_hash <> me.token_hash;
  get diagnostics v_n = row_count;
  insert into semis_v2_private.audit(actor, action, detail, ip)
  values (me.account_id, 'pw_change', jsonb_build_object('id', p_orig, 'ended', v_n), semis_v2_private.client_ip());
  return jsonb_build_object('ok', true, 'ended', v_n);
end $$;

create or replace function public.semis_v2_history(p_key text default null, p_limit int default 60) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from semis_v2_private.admin_ctx()) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'key', h.key, 'old_len', h.old_len, 'new_len', h.new_len,
                                        'changed_at', h.changed_at, 'changed_by', h.changed_by) order by h.id desc)
      from (select * from public.semis_store_history h
             where h.src = 'semis_store'
               and semis_v2_private.read_rank(h.key) <= 4
               and (p_key is null or p_key = '' or h.key = p_key)
             order by h.id desc
             limit least(greatest(coalesce(p_limit, 60), 1), 300)) h), '[]'::jsonb));
end $$;

create or replace function public.semis_v2_history_value(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record;
begin
  if not exists (select 1 from semis_v2_private.admin_ctx()) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select h.id, h.key, h.old_value into r from public.semis_store_history h
   where h.id = p_id and h.src = 'semis_store' and semis_v2_private.read_rank(h.key) <= 4;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'row', jsonb_build_object('id', r.id, 'key', r.key, 'old_value', r.old_value));
end $$;

create or replace function public.semis_v2_end_sessions() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me record; v_n int;
begin
  select * into me from semis_v2_private.admin_ctx();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  delete from semis_v2_private.sessions where token_hash <> me.token_hash;
  get diagnostics v_n = row_count;
  insert into semis_v2_private.audit(actor, action, detail, ip)
  values (me.account_id, 'sessions_end', jsonb_build_object('ended', v_n), semis_v2_private.client_ip());
  return jsonb_build_object('ok', true, 'ended', v_n);
end $$;

/* 접속 기록 · 활성 세션 · 자동공격 방어 현황 */
create or replace function public.semis_v2_security(p_limit int default 120) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me record;
begin
  select * into me from semis_v2_private.admin_ctx();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true,
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'actor', coalesce(a.login_id, e.actor), 'action', e.action,
                                                             'detail', e.detail, 'ip', e.ip) order by e.id desc)
                          from (select * from semis_v2_private.audit order by id desc
                                 limit least(greatest(coalesce(p_limit, 120), 1), 500)) e
                          left join semis_v2_private.accounts a on a.id = e.actor), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('account', coalesce(a.login_id, s.kind),
                                                               'name', coalesce(a.name, case when s.sign_kind = 'council' then '협의회 서명' else '회의 서명' end),
                                                               'kind', s.kind, 'created', s.created_at, 'lastSeen', s.last_seen,
                                                               'expires', s.expires_at, 'ip', s.ip, 'current', s.token_hash = me.token_hash)
                                           order by s.last_seen desc)
                            from semis_v2_private.sessions s
                            left join semis_v2_private.accounts a on a.id = s.account_id
                           where s.expires_at > now() and s.hard_expires_at > now()), '[]'::jsonb),
    'locked', coalesce((select jsonb_agg(x.ip) from (
                          select la.ip from semis_v2_private.login_attempts la
                           where not la.ok and la.at > now() - interval '15 minutes'
                           group by la.ip having count(*) >= 20) x), '[]'::jsonb),
    'stats', jsonb_build_object(
       'fail15', semis_v2_private.fail_count(15, null),
       'fail60', semis_v2_private.fail_count(60, null),
       'signFail60', semis_v2_private.fail_count(60, 'sign'),
       'powBits', semis_v2_private.pow_bits(),
       'powBase', coalesce((select (v ->> 'base')::int from semis_v2_private.settings where k = 'pow'), 16),
       'signPaused', semis_v2_private.fail_count(60, 'sign') >= 200
                     and exists (select 1 from semis_v2_private.login_attempts la
                                  where not la.ok and la.kind = 'sign' and la.at > now() - interval '15 minutes')));
end $$;

/* 저장소 관리(미참조 파일 정리)용 — 공용 DB 전체가 참조하는 파일 경로 (시스템관리자).
   관리자 화면의 사본은 가린 사본(다른 사람의 개인 일정 제외)이라 이것과 합쳐 판정한다 */
create or replace function public.semis_v2_file_refs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from semis_v2_private.admin_ctx()) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'paths', coalesce((
    select jsonb_agg(distinct m[1])
      from public.semis_store s,
           regexp_matches(s.value::text, '/object/public/semis-files/([A-Za-z0-9._\-]+(?:/[A-Za-z0-9._\-]+)*)', 'g') m), '[]'::jsonb));
end $$;

/* 계정 명단(이름·권한만) — 항공보안HQ 이상 내부 계정. 채팅방 구성원 선택 등 */
create or replace function public.semis_v2_directory() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_v2_private.ctx() limit 1;
  if not found or c.kind <> 'user' or c.role = 'vendor' or c.rank < 3 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'users', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.login_id, 'origId', a.id, 'name', a.name, 'role', a.role, 'vendor', a.vendor)
                     order by a.base desc, a.created_at, a.id)
      from semis_v2_private.accounts a where not a.disabled), '[]'::jsonb));
end $$;

/* ─── ICS 구독 (SeMIS 일정 → Google 캘린더 'URL로 추가') ───
   토큰은 서버에만 둔다. 항공보안HQ 이상은 주소 확인, 시스템관리자는 새 토큰 발급(옛 주소 무효) */
create or replace function public.semis_v2_ics_token(p_rotate boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c record; tok text;
begin
  select * into c from semis_v2_private.ctx() limit 1;
  if not found or c.kind <> 'user' or c.rank < 3 or c.role = 'vendor' then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce(p_rotate, false) then
    if c.rank < 4 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
    tok := encode(extensions.gen_random_bytes(18), 'hex');
    insert into semis_v2_private.settings(k, v, updated_at) values ('ics', jsonb_build_object('token', tok), now())
    on conflict (k) do update set v = excluded.v, updated_at = now();
    insert into semis_v2_private.audit(actor, action, ip) values (c.account_id, 'ics_rotate', semis_v2_private.client_ip());
  else
    select v ->> 'token' into tok from semis_v2_private.settings where k = 'ics';
  end if;
  return jsonb_build_object('ok', true, 'token', tok);
end $$;
/* Edge Function semis-ics 전용(service_role) — '나에게만 보이기' 일정은 빼고 */
create or replace function public.semis_v2_ics_feed(p_t text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare tok text;
begin
  select v ->> 'token' into tok from semis_v2_private.settings where k = 'ics';
  if tok is null or p_t is null or length(p_t) < 20 or p_t <> tok then return null; end if;
  return coalesce((select jsonb_agg(e order by t.ord)
    from public.semis_store s, jsonb_array_elements(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) with ordinality t(e, ord)
   where s.key = 'schedules' and coalesce(e ->> 'priv', '') <> 'true'), '[]'::jsonb);
end $$;

/* ═════════════ 트리거: 저장 시각·작성자(서버 기준) · 변경 알림(이름만) ═════════════ */
create or replace function semis_v2_private.stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  new.updated_at := now();
  select coalesce(c.login_id, c.kind) into who from semis_v2_private.ctx() c limit 1;
  if who is null then
    who := case when semis_v2_private.hdr('x-semis-token') is not null then 'expired'
                when coalesce(current_setting('request.headers', true), '') = '' then 'sql' else 'anon' end;
  end if;
  new.updated_by := left(who || '/' || regexp_replace(coalesce(new.updated_by, ''), '^.*/', ''), 80);
  return new;
end $$;
drop trigger if exists semis_store_b_stamp on public.semis_store;
create trigger semis_store_b_stamp before insert or update on public.semis_store
  for each row execute function semis_v2_private.stamp();

/* 변경 알림: 컬렉션 이름과 보낸 탭 id만 (값·계정은 싣지 않는다) */
create or replace function semis_v2_private.notify_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('key', new.key, 'by', regexp_replace(coalesce(new.updated_by, ''), '^.*/', ''), 'at', new.updated_at),
                        'change', 'semis-sync', false);
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists semis_store_notify on public.semis_store;
create trigger semis_store_notify after insert or update on public.semis_store
  for each row execute function semis_v2_private.notify_change();

/* ─── 팀 채팅 (chat_messages) ─── */
create or replace function semis_v2_private.chat_can(p_room text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare c record; r text := coalesce(nullif(p_room, ''), 'team');
begin
  select * into c from semis_v2_private.ctx() limit 1;
  if not found or c.kind <> 'user' then return false; end if;
  if r = 'team' then return c.role <> 'vendor'; end if;
  if c.role = 'admin' then return true; end if;
  return exists (select 1 from public.semis_store s, jsonb_array_elements(
                   case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) x
                  where s.key = 'chatRooms' and x ->> 'id' = r
                    and jsonb_typeof(x -> 'members') = 'array' and (x -> 'members') ? c.account_id);
end $$;
create or replace function semis_v2_private.chat_is_me(p_author text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.kind = 'user' and c.login_id = p_author from semis_v2_private.ctx() c limit 1), false)
$$;
create or replace function semis_v2_private.chat_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.kind = 'user' and c.role = 'admin' from semis_v2_private.ctx() c limit 1), false)
$$;
/* 보낸 사람은 세션에서 채운다(화면이 보낸 이름·권한은 믿지 않는다) */
create or replace function semis_v2_private.chat_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  select * into c from semis_v2_private.ctx() limit 1;
  if found and c.kind = 'user' then
    new.author := coalesce(c.name, c.login_id); new.author_id := c.login_id; new.role := c.role;
  end if;
  new.text := left(coalesce(new.text, ''), 2000);
  new.room := coalesce(nullif(new.room, ''), 'team');
  new.created_at := now();
  return new;
end $$;
drop trigger if exists chat_messages_a_stamp on public.chat_messages;
create trigger chat_messages_a_stamp before insert on public.chat_messages
  for each row execute function semis_v2_private.chat_stamp();
create or replace function semis_v2_private.chat_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform realtime.send(jsonb_build_object('room', old.room, 'id', old.id, 'op', 'delete'), 'change', 'semis-chat-sync', false);
  else
    perform realtime.send(jsonb_build_object('room', new.room, 'id', new.id, 'op', 'insert'), 'change', 'semis-chat-sync', false);
  end if;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists chat_messages_notify on public.chat_messages;
create trigger chat_messages_notify after insert or delete on public.chat_messages
  for each row execute function semis_v2_private.chat_notify();

/* ═════════════ 세션 기반 RLS 정책 (기존 anon 정책은 잠금 단계에서 제거) ═════════════ */
drop policy if exists "v2 session read"   on public.semis_store;
drop policy if exists "v2 session insert" on public.semis_store;
drop policy if exists "v2 session update" on public.semis_store;
create policy "v2 session read" on public.semis_store for select to anon, authenticated
  using (semis_v2_private.can_read_full(key));
/* 쓰기는 RPC semis_v2_push 로만 (가린 사본 병합 · 권한 확인을 한곳에서) */

drop policy if exists "chat session read"   on public.chat_messages;
drop policy if exists "chat session insert" on public.chat_messages;
drop policy if exists "chat session delete" on public.chat_messages;
create policy "chat session read" on public.chat_messages for select to anon, authenticated
  using (semis_v2_private.chat_can(room));
create policy "chat session insert" on public.chat_messages for insert to anon, authenticated
  with check (semis_v2_private.chat_can(room) and semis_v2_private.chat_is_me(author_id));
create policy "chat session delete" on public.chat_messages for delete to anon, authenticated
  using (semis_v2_private.chat_can(room) and (semis_v2_private.chat_is_me(author_id) or semis_v2_private.chat_is_admin()));

/* ═════════════ 기존 계정 이관 (1단계, 2026-09-25 적용 완료) ═════════════
   기본 계정 4개(mark3464 · avsec · branch · hq)는 옛 js/app.js BASE_USERS 해시(또는 공용 DB pwOverrides)를,
   추가 계정은 공용 DB customUsers 해시를 bcrypt로 한 번 더 감싸 accounts 에 넣었다(기존 암호 그대로 로그인).
   userOverrides.deleted 계정(avsec · hq)은 제외. 해시 값은 이 파일에 옮기지 않는다(마이그레이션 semis_v2_security_3_accounts). */

/* ═════════════ 실행 권한 ═════════════ */
revoke execute on all functions in schema semis_v2_private from public, anon, authenticated;
grant execute on function semis_v2_private.rank_now()            to anon, authenticated, service_role;
grant execute on function semis_v2_private.read_rank(text)       to anon, authenticated, service_role;
grant execute on function semis_v2_private.write_rank(text)      to anon, authenticated, service_role;
grant execute on function semis_v2_private.can_read_full(text)   to anon, authenticated, service_role;
grant execute on function semis_v2_private.chat_can(text)        to anon, authenticated, service_role;
grant execute on function semis_v2_private.chat_is_me(text)      to anon, authenticated, service_role;
grant execute on function semis_v2_private.chat_is_admin()       to anon, authenticated, service_role;

/* 공개 RPC는 공개 키(anon)로만 호출 — 함수 안에서 세션 토큰을 확인한다. Supabase Auth(authenticated)는 쓰지 않는다 */
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'semis\_v2\_%' loop
    execute format('revoke execute on function %s from public, authenticated', f.sig);
    execute format('grant execute on function %s to anon, service_role', f.sig);
  end loop;
end $$;
/* ICS 피드는 Edge Function(서비스 권한)만 */
revoke execute on function public.semis_v2_ics_feed(text) from anon;
