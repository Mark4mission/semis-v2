/* ═══════════════════════════════════════════════════════
   SeMIS v2 — 잠금(2단계, 2026-09-26) · v2.53.0 클라이언트 배포·확인 뒤 적용
   마이그레이션 이름: semis_v2_security_12_lockdown

   - semis_store: 익명(anon) 읽기·쓰기 정책 제거 → 데이터는 세션 RPC(semis_v2_pull/push)로만
     (남는 정책: "v2 session read" — 가림 없이 볼 수 있는 컬렉션만 REST 읽기 허용)
   - chat_messages: 익명 정책 제거 → 세션 정책(chat session read/insert/delete)만
   - semis-files 버킷 비공개 + 익명 storage 정책 제거 → 파일은 Edge Function semis-files 가 서명 URL 발급
   - Realtime publication 에서 semis_store · chat_messages 제거 → 값 방송 중단
     (변경 알림은 트리거가 realtime.send 로 '컬렉션 이름'만 보낸다: semis-sync · semis-chat-sync)
   - semis_store_history: v2 행 익명 읽기 정책 제거 → 이력은 관리자 RPC(semis_v2_history)로만
   - 공용 DB 의 옛 계정 자료(pwOverrides · userOverrides · customUsers) 삭제 + 삭제 시 생긴 이력 삭제
     (계정은 semis_v2_private.accounts 로 이관 완료 — 2026-09-25)

   되돌리기(비상시): 아래 정책을 다시 만들면 옛 방식이 동작한다. 단, 계정 자료는 복구하지 않는다(서버 계정 사용).
     create policy "anon read" on public.semis_store for select using (true);  … (insert/update/delete 동일)
     update storage.buckets set public = true where id = 'semis-files';
   ═══════════════════════════════════════════════════════ */

-- 1) semis_store 익명 정책
drop policy if exists "anon read"   on public.semis_store;
drop policy if exists "anon insert" on public.semis_store;
drop policy if exists "anon update" on public.semis_store;
drop policy if exists "anon delete" on public.semis_store;

-- 2) chat_messages 익명 정책
drop policy if exists "chat anon select" on public.chat_messages;
drop policy if exists "chat anon insert" on public.chat_messages;
drop policy if exists "chat anon delete" on public.chat_messages;

-- 3) semis-files 버킷 비공개 + 익명 storage 정책
update storage.buckets set public = false where id = 'semis-files';
drop policy if exists "anon read semis-files"   on storage.objects;
drop policy if exists "anon insert semis-files" on storage.objects;
drop policy if exists "anon delete semis-files" on storage.objects;

-- 4) Realtime 값 방송 중단
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'semis_store') then
    alter publication supabase_realtime drop table public.semis_store;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime drop table public.chat_messages;
  end if;
end $$;

-- 5) 변경 이력 익명 읽기 제거 (Logistics 행도 원래 막혀 있음 — 양쪽 모두 관리자 RPC 로만)
drop policy if exists "history read (v2 only)" on public.semis_store_history;

-- 6) 변경 이력 트리거 수정 (마이그레이션 semis_store_snapshot_fix_delete)
--    BEFORE DELETE 에서 NEW(=NULL)를 돌려주어 행 삭제가 조용히 취소되던 문제 — 삭제는 OLD 를 돌려준다.
--    (semis_store · semis_logi_store 공용 함수. v2.50 도입 때부터 있던 문제로, 앱은 행을 지우지 않아 드러나지 않았다)
create or replace function public.semis_store_snapshot() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare ol int; nl int;
begin
  ol := case when jsonb_typeof(old.value) = 'array' then jsonb_array_length(old.value) else null end;
  nl := case when tg_op = 'DELETE' then null
             when jsonb_typeof(new.value) = 'array' then jsonb_array_length(new.value) else null end;
  if tg_op = 'DELETE' or old.value is distinct from new.value then
    insert into public.semis_store_history (src, key, old_value, old_len, new_len, changed_by)
    values (tg_table_name, old.key, old.value, ol, nl, case when tg_op = 'DELETE' then old.updated_by else coalesce(new.updated_by, old.updated_by) end);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $function$;

-- 7) 옛 계정 자료 삭제 (삭제 트리거가 남긴 이력까지 — 6) 적용 뒤에 실행해야 실제로 지워진다)
delete from public.semis_store where key in ('pwOverrides', 'userOverrides', 'customUsers');
delete from public.semis_store_history where src = 'semis_store' and key in ('pwOverrides', 'userOverrides', 'customUsers');
