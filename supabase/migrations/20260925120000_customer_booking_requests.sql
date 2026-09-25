-- Extend the existing production online-booking queue; do not create a second source of truth.
alter table public.online_booking_requests
  add column if not exists public_token uuid not null default gen_random_uuid(),
  add column if not exists note text,
  add column if not exists rejection_reason text,
  add column if not exists request_ip_hash text;

create unique index if not exists online_booking_requests_public_token_uidx
  on public.online_booking_requests(public_token);
create index if not exists online_booking_requests_ip_created_idx
  on public.online_booking_requests(request_ip_hash, created_at desc)
  where request_ip_hash is not null;

comment on column public.online_booking_requests.public_token is
  'Opaque token used by the public status page; never exposes the request primary key.';

-- Public traffic reaches this table only through the customer-booking-request Edge Function.
alter table public.online_booking_requests enable row level security;
revoke all on table public.online_booking_requests from anon;
grant select, insert, update on table public.online_booking_requests to authenticated;
grant all on table public.online_booking_requests to service_role;
