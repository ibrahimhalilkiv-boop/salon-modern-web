create index if not exists appointments_checked_in_by_idx
  on public.appointments(checked_in_by) where checked_in_by is not null;
