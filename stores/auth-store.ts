import { create } from 'zustand'

interface AuthUser {
  accountNo: string
  email: string
  role: string[]
  exp: number
}

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    authenticated: boolean
    checked: boolean
    loadSession: () => Promise<void>
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set) => {
  return {
    auth: {
      user: null,
      setUser: (user) =>
        set((state) => ({ ...state, auth: { ...state.auth, user } })),
      authenticated: false,
      checked: false,
      loadSession: async () => {
        localStorage.removeItem('token');
        try {
          const res = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
          if (!res.ok) throw new Error('No session');
          const data = await res.json();
          localStorage.setItem('activeBusinessId', data.businessId);
          set(state => ({ auth: { ...state.auth, checked: true, authenticated: true, user: { accountNo: data.user.username, email: '', role: [data.user.role], exp: 0 } } }));
        } catch {
          set(state => ({ auth: { ...state.auth, checked: true, authenticated: false, user: null } }));
        }
      },
      reset: () =>
        set((state) => {
          return {
            ...state,
            auth: { ...state.auth, user: null, authenticated: false, checked: true },
          }
        }),
    },
  }
})
