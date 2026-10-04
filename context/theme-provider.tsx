"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, useRef, useCallback } from 'react'

type Theme = 'dark' | 'light' | 'system'
type ResolvedTheme = Exclude<Theme, 'system'>

const DEFAULT_THEME = 'system'
const THEME_COOKIE_NAME = 'vite-ui-theme'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  defaultTheme: Theme
  resolvedTheme: ResolvedTheme
  theme: Theme
  setTheme: (theme: Theme) => void
  resetTheme: () => void
}

const initialState: ThemeProviderState = {
  defaultTheme: DEFAULT_THEME,
  resolvedTheme: 'light',
  theme: DEFAULT_THEME,
  setTheme: () => null,
  resetTheme: () => null,
}

const ThemeContext = createContext<ThemeProviderState>(initialState)

function applyTheme(preference: Theme) {
  const resolved = preference === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    : preference
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.style.colorScheme = resolved
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
  storageKey = THEME_COOKIE_NAME,
  ...props
}: ThemeProviderProps) {
  const fallbackTheme = useRef<Theme | null>(null)

  const readTheme = useCallback((): Theme => {
    if (fallbackTheme.current) return fallbackTheme.current
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
    } catch {}
    return defaultTheme
  }, [storageKey, defaultTheme])

  const subscribe = useCallback((notify: () => void) => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) notify()
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener('maxius-theme-change', notify)
    media.addEventListener('change', notify)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('maxius-theme-change', notify)
      media.removeEventListener('change', notify)
    }
  }, [storageKey])

  const theme = useSyncExternalStore(subscribe, readTheme, () => defaultTheme)
  const resolvedTheme = useSyncExternalStore(subscribe, (): ResolvedTheme => {
    const preference = readTheme()
    return preference === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      : preference
  }, () => 'light' as ResolvedTheme)

  useEffect(() => {
    applyTheme(readTheme())
  }, [resolvedTheme, readTheme])

  const setTheme = (preference: Theme) => {
    try {
      localStorage.setItem(storageKey, preference)
      fallbackTheme.current = null
    } catch {
      fallbackTheme.current = preference
    }
    applyTheme(preference)
    window.dispatchEvent(new Event('maxius-theme-change'))
  }

  const resetTheme = () => {
    try {
      localStorage.removeItem(storageKey)
      fallbackTheme.current = null
    } catch {
      fallbackTheme.current = defaultTheme
    }
    applyTheme(defaultTheme)
    window.dispatchEvent(new Event('maxius-theme-change'))
  }

  const contextValue = {
    defaultTheme,
    resolvedTheme,
    resetTheme,
    theme,
    setTheme,
  }

  return (
    <ThemeContext value={contextValue} {...props}>
      {children}
    </ThemeContext>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)

  if (!context) throw new Error('useTheme must be used within a ThemeProvider')

  return context
}
