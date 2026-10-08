export function tokenMatchesUser(payload: { sub?: unknown; tokenVersion?: unknown }, user: { id: string; tokenVersion: number } | null): boolean {
  return !!user && typeof payload.sub === "string" && payload.sub === user.id &&
    Number.isInteger(payload.tokenVersion) && payload.tokenVersion === user.tokenVersion;
}

export function mayViewPii(payload: { canViewFullPii?: unknown }, user: { canViewFullPii: boolean }): boolean {
  return payload.canViewFullPii === true && user.canViewFullPii === true;
}
