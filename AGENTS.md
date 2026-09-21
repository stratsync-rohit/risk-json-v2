# Risk JSON Builder v2 — Agent Instructions

## Quick Commands

```bash
pnpm dev          # Start dev server (Next.js)
pnpm build        # Production build
pnpm start        # Run production server
pnpm test         # Run Vitest tests (headless)
pnpm typecheck    # TypeScript check (tsc --noEmit)
```

## Project Overview

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4. A tool for building **Risk JSON objects (schema v2)** used by StratSync. Features:
- **Form mode**: Guided builder for risk fields + three generic views (notification, details, mitigation)
- **JSON mode**: Raw JSON editor with live validation
- **Database mode**: CRUD against external API (`NEXT_PUBLIC_API_URL`)
- **Auth**: Firebase Google Sign-In, restricted to `@stratsync.ai` domain
- **Persistence**: localStorage for drafts, edits, and database-saved state

## Required Environment Variables (`.env.local`)

```
NEXT_PUBLIC_API_URL=https://your-api.example.com        # Risk CRUD API base
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

Without Firebase vars, auth is disabled and shows a config error. Without `NEXT_PUBLIC_API_URL`, database mode fails.

## Architecture Highlights

### Entry Point
- `app/page.tsx` → `RiskJsonBuilder` (client component, ~1000 lines) — single-page app with three panes (form | JSON | preview) and mode switcher.

### Core Library (`lib/`)
| File | Purpose |
|------|---------|
| `risk-utils.ts` | Zod schema (`riskSchema`), `normalizeRisk()` (legacy → v2), `toJson()`, `sampleRisk` |
| `types/risk.ts` | TypeScript types: `Risk`, `RiskBlock`, `RiskView`, `Severity`, `BlockType` |
| `firebase.ts` | Firebase init + auth (client-only), exports `auth`, `googleProvider` |
| `utils.ts` | `cn()` helper (clsx + tailwind-merge) |

### Key Types
- **Risk** (schema_version: 2): `risk_id`, `title`, `severity`, `sender`, `entity`, `views` (notification/details/mitigation), `metadata`, etc.
- **BlockType**: `text | callout | metrics | key_value | bullet_list | numbered_list | table | action_list | divider`
- **Legacy fields** (ignored on export): `metrics`, `details`, `mitigation`, `sku`, `product`, `actions`, `impact`, `alert`, `assign`, `detected_time` — used only during import via `normalizeRisk()`.

### Normalization Flow
```
Input (legacy or v2) → normalizeRisk() → validated v2 Risk → toJson() → canonical JSON
```
- `normalizeRisk()` detects `schema_version >= 2` with `views` → treats as canonical.
- Otherwise maps legacy `metrics/details/mitigation` → generic views via `legacyViews()`.
- Exported JSON **never includes legacy fields**.

### Auth Gate
- `AuthGate` wraps the builder (`app/page.tsx` line 13).
- Only `@stratsync.ai` emails authorized; others signed out with error.
- `useAuth()` hook provides `user` + `signOut()`.

## Testing

- **Framework**: Vitest + jsdom + Testing Library
- **Config**: `vitest.config.ts` (alias `@` → root), `vitest.setup.ts` (jest-dom + localStorage mock)
- **Run single test**: `pnpm test -- lib/risk-utils.test.ts`
- **Test file**: `lib/risk-utils.test.ts` — covers canonical serialization, legacy import, trimming.

## Common Tasks

### Add a New Block Type
1. Add to `BlockType` union in `types/risk.ts`
2. Add to `types` array in `generic-views-editor.tsx` (line 6)
3. Add `empty()` case in same file (line 7)
4. Add render case in `BlockEditor` (line 13)
5. Add preview render in `risk-preview.tsx` `Block` component

### Modify Risk Schema
- Edit `riskSchema` in `lib/risk-utils.ts` (Zod object).
- Update `Risk` type in `types/risk.ts` to match.
- Run `pnpm typecheck` and `pnpm test`.

### API Integration
- Risk CRUD expects endpoints at `${NEXT_PUBLIC_API_URL}/api/risks`:
  - `GET /api/risks` — list
  - `POST /api/risks` — create (returns 201, 409 on duplicate risk_id)
  - `PUT /api/risks/:riskId` — update (400 if risk_id changed, 422 validation error)
  - `DELETE /api/risks/:riskId` — delete
- Request/response body = canonical Risk JSON (schema_version: 2).
- `checkRiskIdExists()` used during ID generation (GET `/api/risks/:riskId` → 200 exists, 404 not found).

## Gotchas

- **`@ts-nocheck`** used in `app/page.tsx`, `generic-views-editor.tsx`, `risk-preview.tsx` — type errors in these files won't surface in `typecheck`.
- **Next.js config** ignores TypeScript errors during build (`ignoreBuildErrors: true` in `next.config.mjs`). Run `pnpm typecheck` separately.
- **localStorage keys** (see `app/page.tsx` lines 35–40): `risk-json-builder-current-risk`, `risk-json-builder-current-json`, `risk-json-builder-saved-at`, `risk-json-builder-active-status`, `risk-json-builder-database-saved-risk-id`, `risk-json-builder-editing-risk-id`.
- **Risk ID generation**: `RSK-XXXX-XXXX` format, verified against API for uniqueness (10 attempts max).
- **Autosave**: 1s debounce for drafts (only in form mode, `activeRiskStatus === 'draft'`).
- **Panel widths**: Resizable via drag handles (form/json/preview), persisted in component state only.
- **Images**: `next.config.mjs` sets `images.unoptimized: true` — no Image Optimization API needed.
- **No lint script** — only `typecheck` and `test` for CI verification.

## File Layout (Relevant)

```
app/
  page.tsx              # Main builder page (RiskJsonBuilder)
components/
  auth/
    AuthGate.tsx        # Firebase auth wrapper + domain restriction
    LoginScreen.tsx     # Sign-in UI
  risk-builder/
    generic-views-editor.tsx  # Three-view block editor
  risk-preview.tsx      # Read-only preview with view tabs
  ui/button.tsx         # shadcn-style button
lib/
  risk-utils.ts         # Schema, normalization, serialization
  firebase.ts           # Firebase client init
  utils.ts              # cn() helper
types/
  risk.ts               # All Risk-related types
```

## Verification Before Commit

```bash
pnpm typecheck && pnpm test && pnpm build
```