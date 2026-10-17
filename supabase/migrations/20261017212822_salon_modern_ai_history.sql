create table if not exists public.salon_ai_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists salon_ai_messages_user_session_created_idx
  on public.salon_ai_messages (user_id, session_id, created_at desc);

alter table public.salon_ai_messages enable row level security;
revoke all on public.salon_ai_messages from anon, authenticated;
grant select on public.salon_ai_messages to authenticated;
create policy "Users read their own recent AI history"
  on public.salon_ai_messages for select to authenticated
  using (user_id = (select auth.uid()) and created_at >= now() - interval '30 days');

select cron.schedule(
  'salon-ai-history-retention',
  '17 2 * * *',
  $$delete from public.salon_ai_messages where created_at < now() - interval '30 days'$$
);
