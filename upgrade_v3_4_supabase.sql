-- v3.4 雲端升級：只有已執行過舊版 setup_supabase.sql 的專案才需要執行。
-- 請先備份資料庫。本腳本保留原有進度與班級資料。
BEGIN;
ALTER TABLE public.day_plans DROP CONSTRAINT IF EXISTS day_plans_goal_check;
ALTER TABLE public.day_plans ADD CONSTRAINT day_plans_goal_check CHECK (goal BETWEEN 1 AND 2005);
ALTER TABLE public.daily_completions DROP CONSTRAINT IF EXISTS daily_completions_goal_check;
ALTER TABLE public.daily_completions ADD CONSTRAINT daily_completions_goal_check CHECK (goal BETWEEN 1 AND 2005);
create or replace function public.begin_day(p_goal integer)
returns integer language plpgsql security definer set search_path='' as $$
declare v_goal integer; v_today date := (now() at time zone 'Asia/Taipei')::date;
begin
 if auth.uid() is null then raise exception '請先登入'; end if;
 if p_goal < 1 or p_goal > 2005 then raise exception '每日配額須介於 1 至 2005'; end if;
 insert into public.day_plans(user_id,study_date,goal) values(auth.uid(),v_today,p_goal) on conflict do nothing;
 select goal into v_goal from public.day_plans where user_id=auth.uid() and study_date=v_today;
 return v_goal;
end;$$;
COMMIT;
