-- The authenticated manager update policy permits changes to public.clients,
-- whose phone index evaluates this private normalizer on every phone write.
-- Keep the helper private and unavailable to anonymous callers while allowing
-- authenticated staff writes to maintain the expression index.
grant execute on function private.normalize_tr_phone(text) to authenticated;
