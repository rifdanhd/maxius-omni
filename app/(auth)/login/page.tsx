"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { authFetch, setActiveBusinessId, DEFAULT_BUSINESS_ID } from "@/lib/utils/api-client";

// Pesan error OAuth Google dari redirect callback (?error=...).
const AUTH_ERRORS: Record<string, string> = {
  google_disabled: "Login Google belum diaktifkan di server (GOOGLE_CLIENT_ID/SECRET belum diisi).",
  google_state: "Login Google gagal: sesi tidak cocok — coba lagi.",
  google_denied: "Login Google dibatalkan.",
  google_token_exchange: "Login Google gagal: menukar kode dengan Google — coba lagi.",
  google_unverified: "Login Google ditolak: email tidak terverifikasi.",
  google_not_invited:
    "Email ini belum terdaftar — minta admin mengundangnya dulu. Sementara, tetap bisa login pakai username/password.",
};
import Image from "next/image";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionExpired = searchParams.get("reason") === "session_expired";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Selesaikan login (password ATAU handoff Google): simpan token →
  // init brand aktif → redirect. Dipakai handleSubmit & efek google_handoff.
  async function finishLogin(token: string, uname: string) {
    localStorage.setItem("token", token);
    localStorage.setItem("username", uname);
    useAuthStore.getState().auth.setAccessToken(token);

    // Init brand aktif SEBELUM navigasi — localStorage tidak pernah kosong,
    // sehingga connect OAuth selalu membawa brand yang benar. Pilihan =
    // paritas dgn resolveRequestBusiness: brand default bila user anggota,
    // selain itu brand pertama (daftar urut nama).
    try {
      const bizRes = await authFetch("/api/businesses");
      if (bizRes.ok) {
        const biz = (await bizRes.json()) as { businesses?: { id: string }[] };
        const ids = (biz.businesses ?? []).map((b) => b.id);
        const preferred = ids.includes(DEFAULT_BUSINESS_ID) ? DEFAULT_BUSINESS_ID : ids[0];
        if (preferred) setActiveBusinessId(preferred);
      }
    } catch {
      // Gagal → biarkan fallback business-default; BrandSwitcher mengoreksi nanti.
    }

    // Redirect hanya setelah token tersimpan
    router.push("/dashboard");
  }

  // Callback Google: (?google_handoff=1) pindahkan token dari cookie httpOnly
  // ke localStorage; (?error=...) tampilkan pesan. Keduanya dibersihkan dari URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authErr = params.get("error");
    const handoff = params.get("google_handoff");
    if (!authErr && handoff !== "1") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    url.searchParams.delete("google_handoff");
    const clean = () => window.history.replaceState(null, "", url.toString());
    if (authErr) {
      // queueMicrotask: setError tidak boleh sinkron di dalam effect
      // (react-hooks/set-state-in-effect) — tetap tampil sebelum paint.
      queueMicrotask(() => setError(AUTH_ERRORS[authErr] ?? `Login gagal: ${authErr}.`));
      clean();
    }
    if (handoff === "1") {
      (async () => {
        try {
          const res = await fetch("/api/auth/google/session");
          const d = (await res.json().catch(() => null)) as {
            token?: string;
            user?: { username?: string };
            error?: string;
          } | null;
          if (!res.ok || !d?.token) {
            throw new Error(d?.error ?? "Sesi Google tidak valid — coba lagi.");
          }
          clean();
          await finishLogin(d.token, d.user?.username ?? "");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Login Google gagal.");
          clean();
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!username.trim() || !password) {
      setError("Isi username dan password dulu.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!res.ok) {
        if (contentType.includes("application/json")) {
          const data = await res.json();
          throw new Error(data.error || "Gagal login.");
        }
        throw new Error(
          `Login gagal (HTTP ${res.status}). Server mengembalikan respons non-JSON.`
        );
      }
      if (!contentType.includes("application/json")) {
        throw new Error("Server mengembalikan respons yang tidak valid.");
      }

      const data = await res.json();

      if (!data.token) {
        throw new Error("Server tidak mengembalikan token.");
      }

      await finishLogin(data.token, data.user.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-gray-100 to-gray-200 relative overflow-hidden px-4">
      {/* Decorative background elements */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-gray-300 rounded-full mix-blend-multiply filter blur-3xl opacity-40 animate-blob"></div>
      <div className="absolute top-[20%] right-[-10%] w-72 h-72 bg-gray-400 rounded-full mix-blend-multiply filter blur-3xl opacity-40 animate-blob animation-delay-2000"></div>
      <div className="absolute bottom-[-20%] left-[20%] w-80 h-80 bg-gray-200 rounded-full mix-blend-multiply filter blur-3xl opacity-40 animate-blob animation-delay-4000"></div>

      <div className="w-full max-w-md bg-white/80 backdrop-blur-xl border border-white/50 shadow-2xl rounded-3xl p-8 relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="relative h-24 mb-6 aspect-[278/307]">
            <Image 
              src="/Logo/Logo_backroundNO.png" 
              alt="Maxius.id Logo" 
              fill
              className="object-contain drop-shadow-md"
              priority
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Selamat Datang</h1>
          <p className="text-sm text-gray-500 mt-2 text-center">Masuk ke dashboard Maxius.id untuk mulai mengelola inventori Anda.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {sessionExpired && !error && (
            <div className="bg-amber-50 text-amber-700 text-xs px-4 py-3 rounded-xl border border-amber-200">
              Sesi Anda berakhir, silakan login kembali.
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider block mb-2">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-white/50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all placeholder:text-gray-400"
              placeholder="Masukkan username"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider block mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white/50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all placeholder:text-gray-400"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 text-xs px-4 py-3 rounded-xl border border-red-100 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full flex items-center justify-center gap-2 text-sm font-semibold bg-gray-900 text-white rounded-xl px-4 py-3 hover:bg-black transition-all shadow-lg shadow-gray-300 disabled:opacity-70 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <span>Masuk Sekarang</span>
                <LogIn className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-400 uppercase">atau</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>
          <button
            type="button"
            onClick={() => {
              // Navigasi penuh disengaja: route server membalas 302 ke Google.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.assign("/api/auth/google");
            }}
            className="w-full flex items-center justify-center gap-3 text-sm font-semibold bg-white text-gray-700 border border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50 transition-all shadow-sm"
          >
            <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
              <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
              <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
              <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
            </svg>
            Masuk dengan Google
          </button>
        </div>

      </div>

      <style jsx>{`
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
    </div>
  );
}
