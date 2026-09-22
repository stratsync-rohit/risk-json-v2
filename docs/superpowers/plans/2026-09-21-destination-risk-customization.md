# Destination-Specific Risk Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a destination-specific customization workflow for existing Risk V2 records without changing the existing create/database workflows or computing resolved risks in the frontend.

**Architecture:** Keep create-mode state in `app/page.tsx` and render a separate customization component with isolated state. Reuse the existing generic views editor and preview, centralize endpoint calls in `lib/api.ts`, and build payloads with pure override utilities that recurse through plain objects while treating arrays as atomic replacement values.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Testing Library, Zod, Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-09-21-destination-risk-customization-design.md`

## Global Constraints

- Frontend only; do not change backend merge semantics, notification delivery, renderers, or the Risk V2 schema.
- `/resolved` is the only authoritative source for the resolved preview.
- Recursively diff plain objects; arrays are replacement values and are never item-diffed or item-merged.
- Never expose, model, log, or store webhook URLs.
- Strip `_id`, `id`, `risk_id`, `card_id`, `created_at`, `updated_at`, and `sender.risk_id` from override payloads.
- Preserve existing Create New Risk, Database Risks, local autosave, JSON editor, and Add to Database behavior.
- Do not add a UI framework or perform unrelated refactoring.

## Review Focus

- Rapidly switching client/risk/destination must not allow stale responses to overwrite the current selection.
- Empty arrays and empty strings that differ from base must remain in partial overrides as intentional replacements.
- A 404 from the single-override endpoint must produce a normal `Save Override` state, not an error.
- Failed PUT/DELETE responses must not report success or mutate the UI into a saved/reset state.
- Response envelopes may be direct values or wrapped in `data`; the editor and preview must receive the normalized object.

---

### Task 1: Override Payload Semantics

**Files:**
- Create: `lib/override-utils.ts`
- Create: `lib/override-utils.test.ts`

**Interfaces:**
- Produces: `buildPartialOverride(base: Risk, edited: Risk): Record<string, unknown>`
- Produces: `buildCompleteOverride(edited: Risk): Record<string, unknown>`
- Produces: `hydrateOverrideDraft(base: Risk, overrides: Record<string, unknown>): Risk`
- Produces: `createBlankCustomizationDraft(base: Risk): Risk`

- [ ] **Step 1: Write failing tests** for protected-field removal, nested plain-object diffing, whole-array replacement (including empty arrays), explicit empty/false values, editor hydration, and blank drafts retaining only local editor identity.
- [ ] **Step 2: Run `pnpm test -- lib/override-utils.test.ts`** and verify failure because the module does not exist.
- [ ] **Step 3: Implement plain-object helpers.** `diffValue` returns unchanged sentinel values for deep-equal primitives/arrays, recursively diffs plain objects, and returns a cloned entire array whenever arrays differ. `sanitizeOverride` recursively removes protected keys and `sender.risk_id`.
- [ ] **Step 4: Implement the four exported functions** using the helpers; hydration may overlay override fields for editing but must never be exported or displayed as a resolved result.
- [ ] **Step 5: Run `pnpm test -- lib/override-utils.test.ts`** and verify all utility tests pass.

### Task 2: API Contract Helpers

**Files:**
- Modify: `lib/api.ts`
- Create: `lib/api.test.ts`

**Interfaces:**
- Produces typed `fetchClients`, `fetchDestinations`, `fetchRisks`, `fetchRisk`, `fetchOverride`, `saveOverride`, `deleteOverride`, `fetchDestinationOverrides`, and `fetchResolvedRisk` helpers.
- `fetchOverride` returns `OverrideResponse | null`, where only HTTP 404 maps to `null`.
- `fetchResolvedRisk` returns the normalized object containing `risk`.

- [ ] **Step 1: Write failing API tests** for wrapped/direct response normalization, override 404 handling, PUT/DELETE error propagation, encoded IDs, and resolved `data` unwrapping.
- [ ] **Step 2: Run `pnpm test -- lib/api.test.ts`** and verify the new contract tests fail against the current helper implementation.
- [ ] **Step 3: Implement a status-aware request helper** that reads JSON/text safely and throws an error carrying HTTP status.
- [ ] **Step 4: Normalize endpoint envelopes** without adding webhook fields to destination types; require successful PUT/DELETE responses.
- [ ] **Step 5: Run `pnpm test -- lib/api.test.ts`** and verify all API helper tests pass.

### Task 3: Customization Workflow Component

**Files:**
- Create: `components/risk-builder/customize-existing-risk.tsx`
- Create: `components/risk-builder/customize-existing-risk.test.tsx`

**Interfaces:**
- Consumes Task 1 override builders and Task 2 API helpers.
- Produces `CustomizeExistingRisk` React component with no create-mode state dependency.

- [ ] **Step 1: Write failing component tests** covering staged selector disabling, safe Teams/Slack labels, override 404 as `Save Override`, existing override as `Update Override`, partial payload arrays as replacements, duplicate-save prevention, authoritative resolved preview, existing override list selection, and confirmed reset.
- [ ] **Step 2: Run `pnpm test -- components/risk-builder/customize-existing-risk.test.tsx`** and verify failure because the component does not exist.
- [ ] **Step 3: Implement isolated selection/loading state** with request tokens for clients/risks, destinations, selected base risk, override, summaries, and resolved preview.
- [ ] **Step 4: Implement the staged setup UI** using the existing Tailwind visual style and only safe destination metadata.
- [ ] **Step 5: Implement partial/complete editor state** with Start from Base/Start Blank, editable basic presentation fields, metadata JSON, `GenericViewsEditor`, and override JSON preview/editing without allowing protected fields into save payloads.
- [ ] **Step 6: Implement save/update/reset** with in-flight guards, clear feedback, confirmation before DELETE, post-action override refresh, and post-action `/resolved` refresh.
- [ ] **Step 7: Render Base and backend Resolved previews** with `Preview`; never use hydrated/editor state as the resolved preview.
- [ ] **Step 8: Run `pnpm test -- components/risk-builder/customize-existing-risk.test.tsx`** and verify all component tests pass.

### Task 4: Integrate the Top-Level Workflow Without Regressions

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/page.test.tsx`

**Interfaces:**
- Consumes `CustomizeExistingRisk` from Task 3.
- Preserves existing internal `BuilderMode = 'form' | 'json' | 'database'` and all create/database handlers.

- [ ] **Step 1: Add failing page tests** asserting the top-level workflow controls exist, customization renders separately, switching back restores the current create draft, and existing Add to Database and Database Risks flows still use their original endpoints.
- [ ] **Step 2: Run the focused page tests** and verify they fail because the workflow switch is absent.
- [ ] **Step 3: Add `workflowMode = 'create' | 'customize'`** to `RiskJsonBuilder`, render the existing header actions/submodes/content only for create, and render `CustomizeExistingRisk` for customize without resetting current create state.
- [ ] **Step 4: Run `pnpm test -- app/page.test.tsx`** and verify the existing and new page tests pass.

### Task 5: Full Verification and Review

**Files:**
- Review all files changed by Tasks 1-4.

**Interfaces:**
- Consumes the completed feature and all regression tests.
- Produces a verified frontend implementation ready for user review.

- [ ] **Step 1: Run `pnpm typecheck`** and fix only errors caused by this feature.
- [ ] **Step 2: Run `pnpm test`** and fix only regressions caused by this feature.
- [ ] **Step 3: Run `pnpm build`** and fix only build failures caused by this feature.
- [ ] **Step 4: Review the diff against every spec requirement**, especially protected fields, array replacement semantics, stale response guards, and backend-only resolved preview.
- [ ] **Step 5: Report changed files, integrated endpoints, preserved flows, override behavior, resolved/reset behavior, verification results, and remaining limitations.**
