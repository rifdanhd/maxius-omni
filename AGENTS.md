<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Maxius Platform Guidelines

## 🚀 Commands
- **Start Dev Server**: `npm run dev`
- **Build Production**: `npm run build`
- **Lint Code**: `npm run lint`
- **Database Studio**: `npx prisma studio`
- **Database Migrate**: `npx prisma migrate dev`
- **Database Push**: `npx prisma db push`

## 🛠️ Tech Stack
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Database/ORM**: Prisma (`@prisma/client` v5.22.0)
- **Styling**: Tailwind CSS v4 (with `@tailwindcss/postcss`)
- **UI Components**: shadcn/ui with custom Sidebar, theme switching, command menu
- **Charts**: Recharts
- **Icons**: Lucide React
- **Auth**: JWT & bcryptjs (localStorage-based session)
- **State Management**: Zustand (auth-store), React Context (theme, layout, search)
- **State**: zustand, class-variance-authority, clsx, tailwind-merge

## 📝 Code Conventions
- **TypeScript**: Use strict typing and define interfaces/types for data structures.
- **Next.js**: Follow the App Router structure (`app/page.tsx`, `app/layout.tsx`, `app/api/...`). Use Server Components by default; add `"use client"` directive for client components that use `useState`, `useEffect`, `useContext`, `localStorage`, or browser APIs.
- **Styling**: Use Tailwind CSS utility classes. Theme CSS variables defined in `app/theme.css`.
- **Database**: Use Prisma Client for database queries. Keep database logic in `lib/` or within Server Actions / API routes.
- **Imports**: Group imports logically (React/Next first, then third-party, then local aliases/relative imports).
- **UI Components**: Use `@/components/ui/` for shadcn components. Use `@/components/layout/` for layout components (Sidebar, Header, AppSidebar). Use `@/stores/` for Zustand stores. Use `@/context/` for React context providers. Use `@/hooks/` for custom hooks.
- **Client Components**: Always mark components using browser APIs (localStorage, window, useTheme, etc.) with `"use client"` directive at the top.
- **SSR Safety**: Never access `localStorage`, `window`, or `document` during server-side render. Use `typeof window !== 'undefined'` guards.

## 🏗️ Project Structure
```
app/
  layout.tsx          # Root layout with ThemeProvider
  page.tsx            # Landing page
  theme.css           # Theme CSS variables (light/dark)
  globals.css         # Tailwind + theme imports
  api/                # 18+ API route directories
  (dashboard)/        # Protected dashboard routes
    layout.tsx        # Dashboard layout with sidebar
    page.tsx          # Dashboard home
    products/, orders/, settings/, etc.
  (auth)/
    login/page.tsx    # Login page
components/
  ui/                 # 26 shadcn UI components
  layout/             # Layout components (Sidebar, Header, NavGroup, etc.)
  search.tsx          # Command menu search trigger
  theme-switch.tsx    # Dark/light/system theme toggle
  command-menu.tsx    # Global command palette
stores/
  auth-store.ts       # Zustand auth store (localStorage)
context/
  theme-provider.tsx  # Theme context (localStorage)
  layout-provider.tsx # Layout context (sidebar state)
  search-provider.tsx # Search/command menu context
hooks/
  use-mobile.tsx      # Mobile breakpoint detection
  use-dialog-state.ts # Dialog open/close state
lib/
  utils.ts            # cn() utility, pagination helpers
  cookies.ts          # Cookie utilities
  db/, integrations/, services/  # Backend logic
```

## 🏗️ Domain Context (stock-sync core logic)
- One product (parent SKU) can have multiple variants (child SKU) — e.g. color/size. Stock is tracked per variant, not per parent.
- Each variant maps to a different SKU/ID on each marketplace (Shopee, Tokopedia, TikTok Shop) via a `PlatformSkuMapping` table — never assume SKU IDs match across platforms.
- Stock updates must be triggered by webhooks (real-time), not polling, to avoid overselling.
- Client's core pain point: stock discrepancies causing financial loss (oversell → refunds/penalties, or stale low-stock display → lost sales). Prioritize correctness of stock sync over new features.
- Consider safety-stock buffer and queue-based batching for platform API updates to avoid rate limits and race conditions at scale (client has tens of thousands of SKUs).

## ⚡ Token Efficiency Rules
- **Output**: Code only, no explanation unless asked.
- **Format**: Bullets over paragraphs. Don't restate what was already said.
- **File reading**: Never scan the whole repo. Only read files explicitly mentioned or directly imported by them.
- **Search**: Prefer targeted grep/glob over reading entire directories.
- **Edits**: Use diffs/patches instead of rewriting whole files when only a few lines change.

## 🚫 Do Not
- Don't add comments explaining obvious code.
- Don't generate boilerplate not asked for (tests, docs, README updates) unless requested.
- Don't assume SKU/variant IDs are consistent across marketplaces — always go through `PlatformSkuMapping`.
