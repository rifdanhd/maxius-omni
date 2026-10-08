export function maskEmail(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const [local, domain, extra] = value.trim().split("@");
  if (!domain || extra) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPii(value: string | null | undefined): string | null {
  return value?.trim() ? "***" : null;
}
