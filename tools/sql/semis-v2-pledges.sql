/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 보안서약서(SSI 취급자) 관리 (v2.55.0, 2026-09-27)
   마이그레이션 semis_v2_security_14_pledges 로 적용. 이 파일은 참고용 사본이다.

   - 서약 기록은 공용 DB(semis_store)가 아니라 비공개 표 semis_v2_private.pledges 에 둔다.
     · 누구나(로그인 없이) 제출하는 기록이 관리자의 컬렉션 저장과 겹쳐 사라지지 않게(행 단위 저장)
     · 서명 이미지(PNG)를 명단 동기화에 싣지 않게(상세 · 인쇄에서만 따로 받음)
   - 제출: 서약서 작성 화면(pledge.html)이 RPC semis_v2_pledge_submit 을 부른다.
     작업증명(로그인과 같은 semis_v2_challenge) · IP별 시도 제한 · 서버 검증 · 같은 날 같은 사번 중복 차단.
     재서약은 새 기록(이전 기록은 이력으로 남음).
   - 관리(항공보안HQ 이상 내부 계정): semis_v2_pledges(명단) · semis_v2_pledge_signs(서명) ·
     semis_v2_pledge_save(수정 · 종이 서약 등록) · semis_v2_pledge_delete(시스템관리자)
   - Logistics: semis_logi_pledges — Logistics 세션(manager 이상)에 사람별 최신 서약의
     성명 · 소속 · 직위 · 서약일 · 상태만(사번 · 서명 · IP 제외)
   - 변경 알림: 'semis-sync' 채널에 key 'pledges'(값 없음)
   ═══════════════════════════════════════════════════════ */

/* 사번 대조 키 — 영문·숫자만, 소문자, 앞의 항공사 코드 KJ 는 뺀다 (KJ100418 = 100418, 1974-07-27 = 19740727) */
create or replace function semis_v2_private.emp_key(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(lower(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')), '^kj(?=[0-9])', '')
$$;
/* 사람 키 — 사번이 없으면 성명 */
create or replace function semis_v2_private.pledge_pkey(p_emp text, p_name text) returns text
language sql immutable set search_path = '' as $$
  select case when semis_v2_private.emp_key(p_emp) <> '' then semis_v2_private.emp_key(p_emp)
              else 'n:' || lower(regexp_replace(coalesce(p_name, ''), '[[:space:]]', '', 'g')) end
$$;

create table if not exists semis_v2_private.pledges (
  id          text primary key,
  submit_id   text not null unique,
  at          timestamptz not null,                 -- 서약 일시
  name        text not null,
  dept        text not null default '',
  position    text not null default '',
  emp_id      text not null default '',             -- 사번 · (직원이 아니면) 생년월일
  lang        text not null default 'ko' check (lang in ('ko', 'en')),
  agreed      boolean not null default true,
  ip          text not null default '',
  ua          text not null default '',
  sign        text,                                 -- data:image/png;base64,…
  src         text not null default 'web' check (src in ('web', 'sheet', 'paper')),
  state       text not null default 'valid' check (state in ('valid', 'left', 'void')),
  state_at    date,
  state_note  text not null default '',
  note        text not null default '',
  files       jsonb not null default '[]'::jsonb,   -- 종이 서약서 스캔 등 [{name,size,url}]
  orig        jsonb,                                -- 처음 제출 값(성명·소속·직위·사번·일시를 고친 경우)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text not null default ''
);
create index if not exists pledges_pkey_idx on semis_v2_private.pledges (semis_v2_private.pledge_pkey(emp_id, name));
create index if not exists pledges_at_idx on semis_v2_private.pledges (at desc);
create table if not exists semis_v2_private.pledge_hits (
  id bigserial primary key,
  at timestamptz not null default now(),
  ip text,
  ok boolean not null default false
);
create index if not exists pledge_hits_ip_at_idx on semis_v2_private.pledge_hits (ip, at);
create index if not exists pledge_hits_at_idx on semis_v2_private.pledge_hits (at);
alter table semis_v2_private.pledges enable row level security;
alter table semis_v2_private.pledge_hits enable row level security;
revoke all on semis_v2_private.pledges, semis_v2_private.pledge_hits from public, anon, authenticated;
revoke all on sequence semis_v2_private.pledge_hits_id_seq from public, anon, authenticated;

/* 관리 권한 — 항공보안HQ 이상 내부 계정(협력업체 · 서명 세션 제외) */
create or replace function semis_v2_private.pledge_ctx() returns table(login_id text, rank int, role text)
language sql stable security definer set search_path = '' as $$
  select c.login_id, c.rank, c.role from semis_v2_private.ctx() c
   where c.kind = 'user' and c.role in ('admin', 'hq') limit 1
$$;

/* 한 건 → 화면용 JSON (서명 원본은 싣지 않음) */
create or replace function semis_v2_private.pledge_json(r semis_v2_private.pledges) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'submitId', r.submit_id, 'at', r.at, 'name', r.name, 'dept', r.dept, 'position', r.position,
    'empId', r.emp_id, 'lang', r.lang, 'agreed', r.agreed, 'ip', r.ip, 'ua', r.ua, 'src', r.src,
    'state', r.state, 'stateAt', r.state_at, 'stateNote', r.state_note, 'note', r.note, 'files', r.files,
    'orig', r.orig, 'hasSign', r.sign is not null and r.sign <> '',
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'updatedBy', r.updated_by)
$$;

/* 서명 이미지 확인 — PNG data URL · 400KB 이하 · 파일 머리 확인 */
create or replace function semis_v2_private.png_ok(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare head bytea;
begin
  if p is null or length(p) > 400000 or p !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then return false; end if;
  head := decode(substr(p, 23, 16), 'base64');
  return substr(head, 1, 8) = '\x89504e470d0a1a0a'::bytea;
exception when others then
  return false;
end $$;

/* ─── 변경 알림 · 작성자 기록 ─── */
create or replace function semis_v2_private.pledge_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  new.updated_at := now();
  select c.login_id into who from semis_v2_private.ctx() c where c.kind = 'user' limit 1;
  new.updated_by := left(coalesce(who, case when coalesce(current_setting('request.headers', true), '') = '' then 'sql' else 'anon' end)
                         || '/' || regexp_replace(coalesce(new.updated_by, ''), '^.*/', ''), 80);
  return new;
end $$;
drop trigger if exists pledges_a_stamp on semis_v2_private.pledges;
create trigger pledges_a_stamp before insert or update on semis_v2_private.pledges
  for each row execute function semis_v2_private.pledge_stamp();
create or replace function semis_v2_private.pledge_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('key', 'pledges',
                          'by', regexp_replace(coalesce(case when tg_op = 'DELETE' then old.updated_by else new.updated_by end, ''), '^.*/', ''),
                          'at', now()), 'change', 'semis-sync', false);
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists pledges_notify on semis_v2_private.pledges;
create trigger pledges_notify after insert or update or delete on semis_v2_private.pledges
  for each row execute function semis_v2_private.pledge_notify();

/* ═════════════ 제출 (로그인 없이 — 서약서 작성 화면) ═════════════ */
create or replace function public.semis_v2_pledge_submit(p jsonb, p_pow jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ip   text := semis_v2_private.client_ip();
  v_hit  bigint;
  v_err  text;
  n      int;
  v_name text; v_dept text; v_pos text; v_emp text; v_lang text; v_sign text; v_key text;
  v_prev timestamptz;
  v_id   text := 'pl' || encode(extensions.gen_random_bytes(8), 'hex');
  v_sub  text := gen_random_uuid()::text;
  v_now  timestamptz := now();
begin
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  delete from semis_v2_private.pledge_hits where at < now() - interval '7 days';
  select count(*) into n from semis_v2_private.pledge_hits h where h.ip = v_ip and h.at > now() - interval '10 minutes';
  if n >= 8 then return jsonb_build_object('ok', false, 'error', 'limit', 'wait', 10); end if;
  select count(*) into n from semis_v2_private.pledge_hits h where h.ip = v_ip and h.at > now() - interval '1 day';
  if n >= 80 then return jsonb_build_object('ok', false, 'error', 'limit', 'wait', 60); end if;
  select count(*) into n from semis_v2_private.pledge_hits h where h.at > now() - interval '1 hour';
  if n >= 400 then return jsonb_build_object('ok', false, 'error', 'busy', 'wait', 10); end if;
  insert into semis_v2_private.pledge_hits(ip) values (v_ip) returning id into v_hit;

  v_err := semis_v2_private.pow_check(p_pow);
  if v_err is not null then return jsonb_build_object('ok', false, 'error', v_err); end if;

  v_name := btrim(coalesce(p ->> 'name', ''));
  v_dept := btrim(coalesce(p ->> 'dept', ''));
  v_pos  := btrim(coalesce(p ->> 'position', ''));
  v_emp  := btrim(coalesce(p ->> 'empId', ''));
  v_lang := case when p ->> 'lang' = 'en' then 'en' else 'ko' end;
  v_sign := p ->> 'sign';
  if v_name = '' or v_dept = '' or v_pos = '' or v_emp = '' then return jsonb_build_object('ok', false, 'error', 'required'); end if;
  if length(v_name) > 60 or length(v_dept) > 80 or length(v_pos) > 60 or length(v_emp) > 40 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;
  if (p ->> 'agreed') is distinct from 'true' then return jsonb_build_object('ok', false, 'error', 'agree'); end if;
  if not semis_v2_private.png_ok(v_sign) then return jsonb_build_object('ok', false, 'error', 'sign'); end if;
  v_key := semis_v2_private.emp_key(v_emp);
  if v_key = '' then return jsonb_build_object('ok', false, 'error', 'emp'); end if;

  /* 같은 날(한국 시각) 같은 사번의 유효 서약이 있으면 새로 만들지 않는다(두 번 누름 · 재전송) */
  select max(x.at) into v_prev from semis_v2_private.pledges x
   where semis_v2_private.pledge_pkey(x.emp_id, x.name) = v_key and x.state = 'valid'
     and (x.at at time zone 'Asia/Seoul')::date = (v_now at time zone 'Asia/Seoul')::date;
  if v_prev is not null then
    update semis_v2_private.pledge_hits set ok = true where id = v_hit;
    return jsonb_build_object('ok', false, 'error', 'dup', 'at', to_char(v_prev at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'));
  end if;

  insert into semis_v2_private.pledges(id, submit_id, at, name, dept, position, emp_id, lang, agreed, ip, ua, sign, src)
  values (v_id, v_sub, v_now, v_name, v_dept, v_pos, v_emp, v_lang, true, v_ip,
          left(coalesce(semis_v2_private.hdr('user-agent'), ''), 300), v_sign, 'web');
  update semis_v2_private.pledge_hits set ok = true where id = v_hit;
  return jsonb_build_object('ok', true, 'receipt', upper(left(replace(v_sub, '-', ''), 8)),
                            'at', to_char(v_now at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'));
end $$;

/* ═════════════ 관리 (항공보안HQ 이상) ═════════════ */
create or replace function public.semis_v2_pledges() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from semis_v2_private.pledge_ctx()) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(semis_v2_private.pledge_json(x) order by x.at desc) from semis_v2_private.pledges x), '[]'::jsonb));
end $$;

create or replace function public.semis_v2_pledge_signs(p_ids text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from semis_v2_private.pledge_ctx()) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_ids is null or cardinality(p_ids) > 500 then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  return jsonb_build_object('ok', true, 'signs', coalesce((
    select jsonb_object_agg(x.id, x.sign) from semis_v2_private.pledges x
     where x.id = any(p_ids) and x.sign is not null and x.sign <> ''), '{}'::jsonb));
end $$;

/* 수정(p.id 있음) · 종이 서약 등록(p.id 없음). 제출 기록의 성명·소속·직위·사번·일시를 고치면 처음 값을 orig 에 남긴다 */
create or replace function public.semis_v2_pledge_save(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me record; r semis_v2_private.pledges%rowtype;
  v_id text := nullif(btrim(coalesce(p ->> 'id', '')), '');
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_dept text := btrim(coalesce(p ->> 'dept', ''));
  v_pos  text := btrim(coalesce(p ->> 'position', ''));
  v_emp  text := btrim(coalesce(p ->> 'empId', ''));
  v_state text := coalesce(nullif(p ->> 'state', ''), 'valid');
  v_at   timestamptz;
  v_sign text := p ->> 'sign';
  v_files jsonb := coalesce(p -> 'files', '[]'::jsonb);
begin
  select * into me from semis_v2_private.pledge_ctx();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if v_name = '' then return jsonb_build_object('ok', false, 'error', 'required'); end if;
  if length(v_name) > 60 or length(v_dept) > 80 or length(v_pos) > 60 or length(v_emp) > 40
     or length(coalesce(p ->> 'note', '')) > 2000 or length(coalesce(p ->> 'stateNote', '')) > 500 then
    return jsonb_build_object('ok', false, 'error', 'too_long');
  end if;
  if v_state not in ('valid', 'left', 'void') then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if jsonb_typeof(v_files) <> 'array' or jsonb_array_length(v_files) > 20 or length(v_files::text) > 20000 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  begin
    v_at := nullif(p ->> 'at', '')::timestamptz;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'date');
  end;
  if v_at is not null and (v_at > now() + interval '1 day' or v_at < timestamptz '2000-01-01') then
    return jsonb_build_object('ok', false, 'error', 'date');
  end if;
  if v_sign is not null and v_sign <> '' and not semis_v2_private.png_ok(v_sign) then
    return jsonb_build_object('ok', false, 'error', 'sign');
  end if;

  if v_id is null then
    if v_at is null then return jsonb_build_object('ok', false, 'error', 'date'); end if;
    insert into semis_v2_private.pledges(id, submit_id, at, name, dept, position, emp_id, lang, agreed, sign, src,
                                         state, state_at, state_note, note, files)
    values ('pl' || encode(extensions.gen_random_bytes(8), 'hex'), gen_random_uuid()::text, v_at, v_name, v_dept, v_pos, v_emp,
            case when p ->> 'lang' = 'en' then 'en' else 'ko' end, true, nullif(v_sign, ''), 'paper',
            v_state, nullif(p ->> 'stateAt', '')::date, coalesce(p ->> 'stateNote', ''), coalesce(p ->> 'note', ''), v_files)
    returning * into r;
    insert into semis_v2_private.audit(actor, action, detail, ip)
    values ((select a.id from semis_v2_private.accounts a where a.login_id = me.login_id), 'pledge_add',
            jsonb_build_object('id', r.id, 'name', r.name), semis_v2_private.client_ip());
    return jsonb_build_object('ok', true, 'row', semis_v2_private.pledge_json(r));
  end if;

  select * into r from semis_v2_private.pledges x where x.id = v_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.orig is null and r.src <> 'paper'
     and (r.name <> v_name or r.dept <> v_dept or r.position <> v_pos or r.emp_id <> v_emp or (v_at is not null and v_at <> r.at)) then
    r.orig := jsonb_build_object('name', r.name, 'dept', r.dept, 'position', r.position, 'empId', r.emp_id, 'at', r.at);
  end if;
  update semis_v2_private.pledges x set
    name = v_name, dept = v_dept, position = v_pos, emp_id = v_emp,
    at = coalesce(v_at, x.at),
    lang = case when p ? 'lang' then (case when p ->> 'lang' = 'en' then 'en' else 'ko' end) else x.lang end,
    state = v_state, state_at = case when v_state = 'valid' then null else coalesce(nullif(p ->> 'stateAt', '')::date, x.state_at, (now() at time zone 'Asia/Seoul')::date) end,
    state_note = case when v_state = 'valid' then '' else coalesce(p ->> 'stateNote', '') end,
    note = coalesce(p ->> 'note', ''), files = v_files, orig = r.orig,
    sign = case when x.src = 'paper' and p ? 'sign' then nullif(v_sign, '') else x.sign end
   where x.id = v_id
   returning * into r;
  insert into semis_v2_private.audit(actor, action, detail, ip)
  values ((select a.id from semis_v2_private.accounts a where a.login_id = me.login_id), 'pledge_edit',
          jsonb_build_object('id', r.id, 'name', r.name, 'state', r.state), semis_v2_private.client_ip());
  return jsonb_build_object('ok', true, 'row', semis_v2_private.pledge_json(r));
end $$;

create or replace function public.semis_v2_pledge_delete(p_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me record; r semis_v2_private.pledges%rowtype;
begin
  select * into me from semis_v2_private.admin_ctx();
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  delete from semis_v2_private.pledges x where x.id = p_id returning * into r;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  insert into semis_v2_private.audit(actor, action, detail, ip)
  values (me.account_id, 'pledge_delete', jsonb_build_object('id', r.id, 'name', r.name, 'at', r.at, 'src', r.src), semis_v2_private.client_ip());
  return jsonb_build_object('ok', true);
end $$;

/* 저장소 관리(미참조 파일 정리) — 서약서 첨부도 참조로 센다 */
create or replace function public.semis_v2_file_refs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from semis_v2_private.admin_ctx()) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'paths', coalesce((
    select jsonb_agg(distinct m[1])
      from (select s.value::text as t from public.semis_store s
            union all select x.files::text from semis_v2_private.pledges x) src,
           regexp_matches(src.t, '/object/public/semis-files/([A-Za-z0-9._\-]+(?:/[A-Za-z0-9._\-]+)*)', 'g') m), '[]'::jsonb));
end $$;

/* ═════════════ Logistics — 서약 명단 조회 (manager 이상, 사람별 최신 1건) ═════════════ */
create or replace function public.semis_logi_pledges() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if semis_logi_private.rank_now() < 2 then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object('ok', true, 'asOf', now(), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('name', z.name, 'dept', z.dept, 'position', z.position,
                                        'date', to_char(z.at at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
                                        'state', z.state, 'n', z.n) order by z.at desc)
      from (select distinct on (semis_v2_private.pledge_pkey(x.emp_id, x.name))
                   x.name, x.dept, x.position, x.at, x.state,
                   count(*) over (partition by semis_v2_private.pledge_pkey(x.emp_id, x.name)) as n
              from semis_v2_private.pledges x
             order by semis_v2_private.pledge_pkey(x.emp_id, x.name), (x.state = 'valid') desc, x.at desc) z), '[]'::jsonb));
end $$;

/* 실행 권한 — 공개 RPC 는 anon · service_role 만 (함수 안에서 세션 확인) */
revoke all on function semis_v2_private.emp_key(text), semis_v2_private.pledge_pkey(text, text), semis_v2_private.pledge_ctx(),
  semis_v2_private.pledge_json(semis_v2_private.pledges), semis_v2_private.png_ok(text),
  semis_v2_private.pledge_stamp(), semis_v2_private.pledge_notify() from public, anon, authenticated;
revoke execute on function public.semis_v2_pledge_submit(jsonb, jsonb), public.semis_v2_pledges(), public.semis_v2_pledge_signs(text[]),
  public.semis_v2_pledge_save(jsonb), public.semis_v2_pledge_delete(text), public.semis_v2_file_refs(), public.semis_logi_pledges()
  from public, authenticated;
grant execute on function public.semis_v2_pledge_submit(jsonb, jsonb), public.semis_v2_pledges(), public.semis_v2_pledge_signs(text[]),
  public.semis_v2_pledge_save(jsonb), public.semis_v2_pledge_delete(text), public.semis_v2_file_refs(), public.semis_logi_pledges()
  to anon, service_role;
