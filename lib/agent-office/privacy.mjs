const messages = { working: "Agen sedang bekerja.", waiting: "Agen menunggu persetujuan.", done: "Tugas selesai.", error: "Sesi mengalami error. Tutup setelah diperiksa." };

export function safeTitle(value, fallback = "Tugas agen", limit = 64) {
  if (typeof value !== "string") return fallback;
  return value.split(/[\r\n]/)[0]
    .replace(/(?:Bearer\s+\S+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)/gi, "[disensor]")
    .replace(/(?:sk[-_]\S+|eyJ[A-Za-z0-9_.-]+|[A-Za-z0-9_-]{25,})/g, "[disensor]")
    .replace(/(?:[A-Za-z]:\\\S+|(?:~\/|\/)[^\s,;]+)/g, "[path]")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim().split(/\s+/).slice(0, 8).join(" ").slice(0, limit) || fallback;
}

const allowedEvents = new Set([
  "process.started", "process.output", "process.completed", "process.failed", "approval.requested", "approval.accepted", "approval.failed",
  "thread.started", "turn.started", "turn.completed", "turn.failed", "item.started", "item.completed", "error",
  "turn/started", "turn/completed", "item/started", "item/completed", "item/commandExecution/requestApproval", "item/fileChange/requestApproval",
]);
export function safeEvent(value) { return allowedEvents.has(value) ? value : "process.output"; }
export function safeMessage(status, event) { return `${messages[status] || messages.error} (${safeEvent(event)})`; }
export function safeRecord(record) {
  const event = safeEvent(record.event);
  return {
    id: record.id, name: safeTitle(record.name, "Agen", 32), role: safeTitle(record.role, "Coding agent", 32),
    task: safeTitle(record.task), status: record.status, message: safeMessage(record.status, event), event,
    startedAt: record.startedAt, updatedAt: record.updatedAt,
    ...(record.endedAt ? { endedAt: record.endedAt } : {}), canResume: record.canResume === true,
  };
}
