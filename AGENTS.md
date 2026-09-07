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
- **Styling**: Tailwind CSS v4
- **Charts**: Recharts
- **Icons**: Lucide React
- **Auth**: JWT & bcryptjs

## 📝 Code Conventions
- **TypeScript**: Use strict typing and define interfaces/types for data structures.
- **Next.js**: Follow the App Router structure (`app/page.tsx`, `app/layout.tsx`, `app/api/...`). Use Server Components by default; add `"use client"` only when necessary for interactivity.
- **Styling**: Use Tailwind CSS utility classes.
- **Database**: Use Prisma Client for database queries. Keep database logic in `lib/` or within Server Actions / API routes.
- **Imports**: Group imports logically (React/Next first, then third-party, then local aliases/relative imports).

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