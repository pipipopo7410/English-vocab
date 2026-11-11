-- 單字日課 v3.6：只有個人登入與個人學習進度；沒有導師後台／班級資料需求。
-- 請在「專門給本 App 的 Supabase 專案」SQL Editor 執行一次。
-- 在已使用 v3.2-v3.5 的同專案可執行；不刪除舊學生紀錄或其他舊表。
-- SQL Editor 具有專案管理者權限；請勿把 secret/service_role key 上傳到 GitHub。

create table if not exists public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 nickname text not null check (char_length(nickname) between 1 and 40),
 created_at timestamptz not null default now()
);
create table if not exists public.student_progress (
 user_id uuid primary key references auth.users(id) on delete cascade,
 payload jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.student_progress enable row level security;
revoke all on public.profiles,public.student_progress from anon;
revoke all on public.profiles,public.student_progress from authenticated;
grant select,insert,update on public.profiles,public.student_progress to authenticated;

-- 針對 v3.2-v3.5 既有 schema，移除原本教師查詢學生 profile 的舊 policy。
-- 個人備份表的政策始終只允許本人讀寫。
drop policy if exists profile_self_or_teacher on public.profiles;
drop policy if exists profile_self_select on public.profiles;
drop policy if exists profile_insert_self on public.profiles;
drop policy if exists profile_update_self on public.profiles;
drop policy if exists progress_select_self on public.student_progress;
drop policy if exists progress_insert_self on public.student_progress;
drop policy if exists progress_update_self on public.student_progress;

create policy profile_self_select on public.profiles for select to authenticated using (user_id=(select auth.uid()));
create policy profile_insert_self on public.profiles for insert to authenticated with check (user_id=(select auth.uid()));
create policy profile_update_self on public.profiles for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create policy progress_select_self on public.student_progress for select to authenticated using (user_id=(select auth.uid()));
create policy progress_insert_self on public.student_progress for insert to authenticated with check (user_id=(select auth.uid()));
create policy progress_update_self on public.student_progress for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
