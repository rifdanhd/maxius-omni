type User = {
  name: string
  email: string
  avatar: string
}

type Team = {
  name: string
  logo: React.ElementType
  plan: string
}

type BaseNavItem = {
  title: string
  badge?: string
  icon?: React.ElementType
  /** Sembunyikan dari navigasi (sidebar & command menu) tanpa menghapus rute. */
  hidden?: boolean
}

type NavLink = BaseNavItem & {
  url: string | (string & {})
  items?: never
}

type NavCollapsible = BaseNavItem & {
  items: (BaseNavItem & { url: string | (string & {}) })[]
  url?: never
}

type NavItem = NavCollapsible | NavLink

type NavGroup = {
  title: string
  items: NavItem[]
}

type SidebarData = {
  user: User
  teams: Team[]
  navGroups: NavGroup[]
}

export type { SidebarData, NavGroup, NavItem, NavCollapsible, NavLink }
