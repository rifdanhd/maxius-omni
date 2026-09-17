"use client";

const LOGIN_PATH = "/login";
const SESSION_EXPIRED_PATH = "/login?reason=session_expired";

let redirecting = false;

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export const DEFAULT_BUSINESS_ID = "business-default";

// Brand aktif pilihan user (fase multi-brand). Default = Maxius.
export function getActiveBusinessId(): string {
  if (typeof window === "undefined") return DEFAULT_BUSINESS_ID;
  return localStorage.getItem("activeBusinessId") ?? DEFAULT_BUSINESS_ID;
}

export function setActiveBusinessId(id: string): void {
  if (typeof window === "undefined") return;
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
  const token = getAuthToken();
  const base: Record<string, string> = {};
  if (init) {
    new Headers(init).forEach((v, k) => {
      base[k] = v;
    });
  }
  if (token && !base["authorization"] && !base["Authorization"]) {
    base["Authorization"] = `Bearer ${token}`;
  }
  return base;
}

export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const headers = authHeaders(init?.headers);
  // Scoping brand otomatis: semua /api/* (kecuali auth & businesses)
  // membawa ?businessId= brand aktif — server memvalidasi keanggotaan.
  if (typeof input === "string" && input.startsWith("/api/")) {
    const skip = input.startsWith("/api/auth/") || input.startsWith("/api/businesses");
    if (!skip) {
      const sep = input.includes("?") ? "&" : "?";
      const m = input.match(/([?&])businessId=/);
      if (!m) input = `${input}${sep}businessId=${encodeURIComponent(getActiveBusinessId())}`;
    }
  }
  let res: Response;
  try {
    res = await fetch(input, { ...init, headers });
  } catch (e) {
    throw e;
  }
  if (res.status === 401) {
    handleUnauthorized();
  }
  return res;
}
