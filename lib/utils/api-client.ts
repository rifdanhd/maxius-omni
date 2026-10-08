"use client";

const LOGIN_PATH = "/login";
const SESSION_EXPIRED_PATH = "/login?reason=session_expired";

let redirecting = false;

export function getAuthToken(): string | null {
  return null;
}

export const DEFAULT_BUSINESS_ID = "business-default";

// Brand aktif pilihan user (fase multi-brand). Default = Maxius.
export function getActiveBusinessId(): string {
  if (typeof window === "undefined") return DEFAULT_BUSINESS_ID;
  return localStorage.getItem("activeBusinessId") ?? DEFAULT_BUSINESS_ID;
}

export async function setActiveBusinessId(id: string): Promise<void> {
  if (typeof window === "undefined") return;
  const res = await authFetch("/api/auth/business", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: id }) });
  if (!res.ok) throw new Error("Gagal mengganti brand.");
  localStorage.setItem("activeBusinessId", id);
}

export function clearAuth(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("token");
  localStorage.removeItem("username");
}

export function handleUnauthorized(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === LOGIN_PATH) return;
  if (redirecting) return;
  redirecting = true;
  clearAuth();
  // Di luar konteks React — window.location disengaja agar 401 dari
  // pemanggilan API mana pun (termasuk non-component) tetap redirect.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = SESSION_EXPIRED_PATH;
  setTimeout(() => {
    redirecting = false;
  }, 3000);
}

export function authHeaders(init?: HeadersInit): HeadersInit {
  const base: Record<string, string> = {};
  if (init) {
    new Headers(init).forEach((v, k) => {
      base[k] = v;
    });
  }
  delete base.authorization;
  delete base.Authorization;
  return base;
}

export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const headers = authHeaders(init?.headers);
  let res: Response;
  try {
    res = await fetch(input, { ...init, headers, credentials: "same-origin" });
  } catch (e) {
    throw e;
  }
  if (res.status === 401) {
    handleUnauthorized();
  }
  return res;
}
