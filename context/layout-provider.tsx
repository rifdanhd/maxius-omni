import { createContext, useContext, useState } from 'react'

export type Collapsible = 'offcanvas' | 'icon' | 'none'
type Variant = 'inset' | 'sidebar' | 'floating'

const LAYOUT_COLLAPSIBLE_KEY = 'layout_collapsible'
const LAYOUT_VARIANT_KEY = 'layout_variant'
const DEFAULT_VARIANT = 'inset'
const DEFAULT_COLLAPSIBLE = 'icon'

type LayoutContextType = {
  resetLayout: () => void
  defaultCollapsible: Collapsible
  collapsible: Collapsible
  setCollapsible: (collapsible: Collapsible) => void
  defaultVariant: Variant
  variant: Variant
  setVariant: (variant: Variant) => void
}

const LayoutContext = createContext<LayoutContextType | null>(null)

type LayoutProviderProps = {
  children: React.ReactNode
}

export function LayoutProvider({ children }: LayoutProviderProps) {
  const [collapsible, _setCollapsible] = useState<Collapsible>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LAYOUT_COLLAPSIBLE_KEY)
      return (saved as Collapsible) || DEFAULT_COLLAPSIBLE
    }
    return DEFAULT_COLLAPSIBLE
  })
  const [variant, _setVariant] = useState<Variant>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LAYOUT_VARIANT_KEY)
      return (saved as Variant) || DEFAULT_VARIANT
    }
    return DEFAULT_VARIANT
  })

  const setCollapsible = (newCollapsible: Collapsible) => {
    _setCollapsible(newCollapsible)
    if (typeof window !== 'undefined') {
      localStorage.setItem(LAYOUT_COLLAPSIBLE_KEY, newCollapsible)
    }
  }
  const setVariant = (newVariant: Variant) => {
    _setVariant(newVariant)
    if (typeof window !== 'undefined') {
      localStorage.setItem(LAYOUT_VARIANT_KEY, newVariant)
    }
  }
  const resetLayout = () => {
    setCollapsible(DEFAULT_COLLAPSIBLE)
    setVariant(DEFAULT_VARIANT)
  }

  const contextValue: LayoutContextType = {
    resetLayout,
    defaultCollapsible: DEFAULT_COLLAPSIBLE,
    collapsible,
    setCollapsible,
    defaultVariant: DEFAULT_VARIANT,
    variant,
    setVariant,
  }

  return <LayoutContext value={contextValue}>{children}</LayoutContext>
}

export function useLayout() {
  const context = useContext(LayoutContext)
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider')
  }
  return context
}
