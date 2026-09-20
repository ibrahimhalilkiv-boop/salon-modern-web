-- Customer identities and debt rows stay independent. This schema only groups
-- customer_id values for a shared household/account summary.
create table if not exists public.debt_account_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.debt_account_group_members (
  group_id uuid not null references public.debt_account_groups(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  relationship_label text,
  created_at timestamptz not null default now(),
  primary key (group_id, client_id),
  constraint debt_account_member_one_group unique (client_id),
  constraint debt_account_member_label_length check (
    relationship_label is null or char_length(trim(relationship_label)) <= 60
  )
);

create index if not exists debt_account_group_members_group_id_idx
  on public.debt_account_group_members(group_id);

alter table public.debt_account_groups enable row level security;
alter table public.debt_account_group_members enable row level security;

drop policy if exists "managers can read debt account groups" on public.debt_account_groups;
create policy "managers can read debt account groups"
on public.debt_account_groups for select to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.active is true and p.role = 'manager'
));

drop policy if exists "managers can manage debt account groups" on public.debt_account_groups;
create policy "managers can manage debt account groups"
on public.debt_account_groups for all to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.active is true and p.role = 'manager'
))
with check (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.active is true and p.role = 'manager'
));

drop policy if exists "managers can read debt account members" on public.debt_account_group_members;
create policy "managers can read debt account members"
on public.debt_account_group_members for select to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.active is true and p.role = 'manager'
));

drop policy if exists "managers can manage debt account members" on public.debt_account_group_members;
create policy "managers can manage debt account members"
on public.debt_account_group_members for all to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.active is true and p.role = 'manager'
))
with check (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.active is true and p.role = 'manager'
));

revoke all on public.debt_account_groups from anon;
revoke all on public.debt_account_group_members from anon;
grant select, insert, update, delete on public.debt_account_groups to authenticated;
grant select, insert, update, delete on public.debt_account_group_members to authenticated;

