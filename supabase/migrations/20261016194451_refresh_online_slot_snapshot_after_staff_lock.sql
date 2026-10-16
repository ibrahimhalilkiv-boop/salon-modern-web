-- Recheck the latest committed calendar rows after an employee advisory lock wait.
-- STABLE SQL functions reuse the caller's earlier statement snapshot.
alter function private.online_slot_available(uuid,timestamptz,integer,uuid) volatile;
