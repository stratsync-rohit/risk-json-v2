# Destination-Specific Risk Customization Design

**Date:** 2026-09-21  
**Status:** Design approved in chat; awaiting written-spec review  
**Scope:** Frontend only

## Goal

Extend the Risk JSON Builder with a separate `Customize Existing Risk` workflow for client/destination-specific overrides while preserving the existing `Create New Risk` and `Database Risks` behavior. The frontend will select existing base risks, edit partial or complete override content, persist overrides through the existing API, and display the backend-authoritative resolved risk.

## Constraints

- Do not change backend code, notification delivery, Teams/Slack renderers, or the Risk V2 schema.
- Do not implement base-plus-override merge logic in the frontend.
- Do not send, render, log, or store webhook URLs.
- Do not create or change `risk_id` values while customizing an existing risk.
- Keep the existing create flow, local autosave, JSON editor, database CRUD, and preview behavior intact.
- Reuse the existing visual language, `GenericViewsEditor`, `Preview`, and existing API base URL configuration.
- No new UI framework or unrelated refactoring.

## Existing Context

- `app/page.tsx` owns the current create/form, JSON, and database workflows.
- `components/risk-builder/generic-views-editor.tsx` edits the three generic Risk V2 views and all supported block types.
- `components/risk-preview.tsx` renders a Risk V2 preview.
- `lib/risk-utils.ts` provides `normalizeRisk`, `riskSchema`, and canonical `toJson` serialization.
- `lib/api.ts` already contains untracked client/destination/risk/override/resolved API helpers. It will be normalized and completed as part of this feature rather than introducing another API layer.

## User Experience

Add a top-level workflow switch with:

- `Create New Risk`
- `Customize Existing Risk`

The existing create workflow keeps its current `Form → JSON`, `JSON → UI`, and `Database Risks` controls and actions. Selecting `Create New Risk` returns to the existing builder state without asking for a client or destination.

The customization workflow is a staged page in the existing builder shell:

1. Client selector, populated from `GET /api/clients`.
2. Existing risk selector, populated from `GET /api/risks`; each option/card shows title, risk ID, and severity. Selecting a risk may fetch its full record with `GET /api/risks/{risk_id}`.
3. Unified destination selector, populated after client selection from `GET /api/clients/{client_id}/destinations`. Each option visibly identifies `Teams` or `Slack` and displays only safe platform metadata:
   - Teams: `member_name`, `team_name`, `channel_name`.
   - Slack: `member_name`, `workspace_domain`, `channel_name`.
4. Customization type selector: `Partial Override` or `Complete Override`.
5. Reused Risk V2 editor and JSON editor for the editable content.
6. Base/override/resolved preview states where the resolved panel is populated only from the backend resolved endpoint.
7. Save/update and reset actions.

Selectors and actions are disabled until prerequisites exist. Changing the client clears destinations, destination override state, and resolved preview. Changing the risk clears destination-specific editor state, then loads risk-specific active override summaries. Changing the destination loads that destination's override and resolved preview.

## State Isolation

`app/page.tsx` will retain ownership of current create-mode state. A new customization component will own its client, risk, destination, override-editor, loading, and save state. The page will only choose which workflow shell to render and will not copy customization state into create-mode state.

The customization component will use a request sequence/token per dependent fetch. Responses are applied only if their token still matches the current client/risk/destination selection. This prevents an earlier request from overwriting a newer selection.

No customization state will be written to the existing create-mode localStorage keys. Switching back to create mode leaves the current create draft and autosave behavior unchanged.

## Override Editing and Payloads

The editor uses a Risk-shaped editable draft so the existing generic editor can be reused. The selected base risk is the source for `Partial Override` and `Start from Base`. `Start Blank` uses a valid empty/default Risk V2-style draft with the selected base `risk_id` retained only in local editor state.

### Partial Override

The editor starts from the selected base risk or an existing override representation. On save, a pure helper compares editable draft content with the selected base and returns only changed fields. Nested objects are recursively reduced so unchanged fields inside `views` or `metadata` are omitted. Empty strings, empty arrays, and explicit false values remain when they differ from the base so users can intentionally clear or disable content.

The helper strips protected identity/database fields before producing the payload. Protected keys are `_id`, `id`, `risk_id`, `card_id`, `created_at`, and `updated_at`; `sender.risk_id` is also removed because it is derived identity data. The request body is:

```json
{
  "overrides": { "...only changed editable fields...": "..." },
  "is_active": true
}
```

### Complete Override

The editor starts from the selected base or a blank default. On save, the complete draft is sanitized to remove the same protected identity/database fields. The selected base `risk_id` is never written inside `overrides`, and no risk creation/update endpoint is called.

### Existing Override

When risk and destination are selected, call:

`GET /api/risks/{risk_id}/destinations/{destination_id}/override`

A successful response is loaded into the editor and marks the destination as customized; the primary action is `Update Override`. A 404 is converted to a normal no-override state with primary action `Save Override`, not an application error. Other failures are shown as actionable errors.

Because an override is stored as a partial object, the frontend will hydrate the editor for an existing override by overlaying its editable fields onto the selected base draft for editing. This is editor hydration only; it is not used to create the resolved preview and is never sent as a frontend-computed resolved risk.

## API Integration

All requests use `NEXT_PUBLIC_API_URL` and URL-encode IDs. API helpers will normalize supported response envelopes (`data`, `risks`, or direct arrays/objects) and throw for non-success responses, except `fetchOverride`, which returns `null` on 404.

Integrated endpoints:

- `GET /api/clients`
- `GET /api/clients/{client_id}/destinations`
- `GET /api/risks`
- `GET /api/risks/{risk_id}`
- `GET /api/risks/{risk_id}/destinations/{destination_id}/override`
- `PUT /api/risks/{risk_id}/destinations/{destination_id}/override`
- `GET /api/risks/{risk_id}/destinations/{destination_id}/resolved`
- `GET /api/risks/{risk_id}/destination-overrides`
- `DELETE /api/risks/{risk_id}/destinations/{destination_id}/override`

The save action disables itself while the request is in flight. On success it refreshes the override status and resolved preview. Reset requires confirmation, deletes the override, clears the editor override state, and refreshes so the UI reports that the destination resolves to the base risk.

## Preview Behavior

The customization view may show the selected base risk for reference. If an active override exists, it may show an editor/reference view for the override. The authoritative `Resolved Risk` preview always renders `data.risk` from:

`GET /api/risks/{risk_id}/destinations/{destination_id}/resolved`

The frontend will not deep-merge the base risk and override to produce this preview. Before a resolved response exists, the UI shows a loading/empty state rather than guessing the merged result.

## File Boundaries

- `app/page.tsx`: add only the top-level workflow switch and render the customization component; preserve existing create/database state and handlers.
- `components/risk-builder/customize-existing-risk.tsx`: own customization UI/state, staged selectors, editor reuse, API lifecycle, save/reset feedback, and backend resolved preview.
- `lib/api.ts`: complete/strengthen frontend-only endpoint wrappers and safe response normalization; no webhook fields.
- `lib/override-utils.ts`: pure protected-field sanitization, recursive partial-diff generation, editor hydration, and blank editable draft helpers.
- `lib/override-utils.test.ts`: unit tests for payload sanitization, recursive partial diffs, blank drafts, and override hydration.
- `app/page.test.tsx`: regression tests proving create-mode POST behavior remains unchanged and focused customization flow tests for selector dependencies, 404 handling, save/update, resolved preview, and reset.

No changes are planned for `types/risk.ts`, `lib/risk-utils.ts`, `components/risk-builder/generic-views-editor.tsx`, or `components/risk-preview.tsx` unless verification exposes a narrowly scoped compatibility issue.

## Verification

Run the existing project checks after implementation:

```bash
pnpm typecheck
pnpm test
pnpm build
```

The implementation is complete only if the existing create/database tests and the new customization tests pass, typecheck passes, and the production build succeeds.
