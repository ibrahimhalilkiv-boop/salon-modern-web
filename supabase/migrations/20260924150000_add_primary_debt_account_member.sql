alter table public.debt_account_group_members
  add column if not exists is_primary boolean not null default false;

with ranked as (
  select group_id,
         client_id,
         row_number() over (
           partition by group_id
           order by created_at, client_id
         ) as member_order
  from public.debt_account_group_members
)
update public.debt_account_group_members member
set is_primary = ranked.member_order = 1
from ranked
where member.group_id = ranked.group_id
  and member.client_id = ranked.client_id
  and member.is_primary is distinct from (ranked.member_order = 1);

create unique index if not exists debt_account_group_one_primary_idx
  on public.debt_account_group_members(group_id)
  where is_primary;

