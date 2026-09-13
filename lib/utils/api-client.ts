"use client";

const LOGIN_PATH = "/login";
const SESSION_EXPIRED_PATH = "/login?reason=session_expired";

let redirecting = false;

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
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
