// Signed webhook helpers. Never process Business App echoes/history as customers.
export function extractMetaEvents(body) {
  const events = { messages: [], statuses: [], templateChanges: [] };
  if (body?.object !== 'whatsapp_business_account') return events;
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field === 'messages') {
        if (Array.isArray(change.value?.messages)) events.messages.push(...change.value.messages);
        if (Array.isArray(change.value?.statuses)) events.statuses.push(...change.value.statuses);
      } else if (change?.field === 'message_template_status_update') {
        events.templateChanges.push(change.value ?? {});
      }
    }
  }
  return events;
}

export function receiptUpdate(receipt, now = new Date()) {
  const id = String(receipt?.id ?? '');
  const predecessors = {
    sent: ['sending', 'delivery_unknown'],
    delivered: ['sending', 'delivery_unknown', 'sent'],
    read: ['sending', 'delivery_unknown', 'sent', 'delivered'],
    failed: ['sending', 'delivery_unknown', 'sent'],
  };
  const status = String(receipt?.status ?? '');
  const timestamp = Number(receipt?.timestamp);
  if (!id || !predecessors[status] || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return { id, predecessors: predecessors[status], patch: {
    status, status_at: date.toISOString(), updated_at: now.toISOString(),
    last_error: status === 'failed' ? JSON.stringify(receipt.errors ?? []).slice(0,4000) : null,
  } };
}

// APPROVED is deliberately not trusted as a body/hash approval. Reconcile the
// real template through Graph before enabling a mapping. Revocation is fail-closed.
export function templateRevocation(value) {
  const name = String(value?.message_template_name ?? '');
  const language = String(value?.message_template_language ?? '');
  const event = String(value?.event ?? '').toUpperCase();
  if (!name || !language || !['REJECTED','PAUSED','DISABLED','PENDING_DELETION','DELETED'].includes(event)) return null;
  return { name, language, patch: { approval_status: 'rejected', approved_content_hash: null, approved_at: null } };
}

export function assistantEnabled(env) {
  return (env.get('WHATSAPP_ASSISTANT_ENABLED') ?? 'false').toLowerCase() === 'true';
}
