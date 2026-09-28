# CivicSignal — Implementation Plan

## Task the repository is awaiting

`docs/PRODUCT-BRIEF.md` is the authoritative product baseline the PRD suite said was
missing. The scaffolding added alongside it is a partially built CivicSignal MVP:
first-run setup and session lookup exist (`server/app.ts`, `server/database.ts`), and
`src/lib/types.ts` defines the frontend data shapes for the whole product. The rest of
the MVP described in the brief is not implemented yet, and the build is broken because
`server/index.ts` (referenced by `dev`/`build` scripts) and `src/main.tsx` (referenced by
`index.html`) do not exist. `pnpm test` also fails (test cleanup leaves the SQLite
handle open on Windows).

**Goal:** implement the CivicSignal MVP end-to-end per `docs/PRODUCT-BRIEF.md`:
resident reports an issue → the responsible organization handles it → an authorized
official manages/resolves it → the resident tracks it. Enforce role-based authorization
server-side, record an audit trail of official actions, and give users clear in-app
notification/feedback. Make the acceptance criteria in the brief demonstrable from a
clean database through the UI and the API.

## Constraints / conventions to follow

- Express 5 + better-sqlite3 + Zod server; React 19 + Vite + react-router-dom client;
  vitest + supertest for API tests (existing pattern in `tests/api/setup.api.test.ts`).
- Shared types live in `shared/contracts.ts` — the single contract owner (wire shapes,
  `isStaffRole`, `reportStatusLabel`, `REPORT_TRANSITIONS`). `src/lib/types.ts` was
  removed during the architecture pass; the client imports directly from `shared/`.
- IDs are `randomUUID()`; timestamps stored as integer ms and serialized as ISO strings;
  errors are `{ error: { code, message, fieldErrors? } }`; Zod validation errors → 422.
- Small, understandable status set (`REPORT_STATUSES` in `shared/contracts.ts`):
  SUBMITTED → UNDER_REVIEW → IN_PROGRESS → RESOLVED → CLOSED.
- Keep the LF text-normalization convention. Do not add dependencies beyond the ones
  already in `package.json`.

## Implementation steps

1. **Fix the failing test.** Give `createApp` a database-close seam and close handles in
   test teardown before removing temp dirs. Verify `pnpm test` passes.
2. **Extend the schema** in `server/database.ts`: `reports`, `report_events` (timeline /
   history), `report_updates` (official responses), `attachments`, `notifications`, with
   indexes. Keep existing tables untouched.
3. **Authentication & roles:** resident self-registration (`POST /api/auth/register`),
   login/logout, session (exists). Server-side auth middleware: suspended users blocked;
   official actions require verified OFFICIAL/LAW_ENFORCEMENT account with an
   organization. Rate-limit auth/setup endpoints.
4. **Reports:** `POST /api/reports` (category, title, description, location, optional
   photo via multer → `attachments`), `GET /api/reports` (scope `mine` / `queue` with
   status/category/text filters), `GET /api/reports/:id` (updates, timeline,
   `allowedTransitions`, `canClaim`, `capabilities`). Category determines the handling
   organization. Generate a human-friendly `referenceCode`.
5. **Official workflow:** claim, status change (only allowed transitions), official
   updates. Every action writes `report_events` (who/what/when) and
   official actions write `audit_events`.
6. **Notifications (simplest reliable mechanism):** in-app notifications created on new
   report (org officials), status change (reporter), official update (reporter),
   claim (reporter). `GET /api/notifications`, mark-read endpoints.
7. **Admin:** overview counts, user list, official verification (admin-controlled role +
   organization + verified_at), suspend/reinstate, organization/category management,
   report moderation (hide/restore/remove), audit listing.
8. **`server/index.ts` entry:** env config (`PORT`, `DATABASE_PATH`, `UPLOAD_DIR`,
   `APP_ORIGIN`, `SESSION_TTL_DAYS`), helmet, compression, rate limiting, static uploads,
   production static client + SPA fallback, graceful shutdown that closes the DB.
9. **Frontend:** API client, auth context, router with role-aware pages: first-run setup,
   sign in / sign up, resident dashboard (my reports + report an issue), report detail
   (status, updates, history, official actions), official department queue with
   filters/search, admin console (users/verification, organizations, categories,
   moderation, audit), notifications. Clean civic styling; no decorative complexity.
10. **Tests** (API-level, matching the existing supertest pattern): auth/registration,
    RBAC denials via direct API calls (resident cannot perform official actions),
    full report lifecycle through resolution with timeline + audit + notifications,
    admin verification/suspension/moderation.

## Verification

- `pnpm check` (typecheck + vitest + full build) passes.
- New API tests cover the brief's acceptance criteria (registration, report creation with
  persistent record + timestamp, official queue visibility, direct-API authorization
  denial, status change, official updates, resident tracking/history, audit records,
  resolution, admin verification, law-enforcement role restrictions).
- Manual end-to-end walkthrough via the dev server: from a clean database — setup admin →
  verify an official → resident signs up and submits a report → official claims, updates,
  and resolves it → resident sees status, updates, and history → admin views audit —
  with no manual database edits or hidden setup steps.

## Status

- [x] Plan written
- [x] Step 1 — failing test fixed (close seam in `createApp`, teardown in `tests/api/helpers.ts`)
- [x] Step 2 — schema extended (reports, report_events, report_updates, attachments, notifications)
- [x] Steps 3–7 — server API complete (auth, reports, workflow, notifications, admin, audit)
- [x] Step 8 — server entry point (`server/index.ts` with env config, helmet/compression/rate limit, static + SPA fallback)
- [x] Step 9 — frontend complete (setup/sign-in/sign-up, role dashboards, report create/detail, notifications, admin console)
- [x] Step 10 — tests added (auth, workflow, admin — 9 tests, all passing)
- [x] Scope tightened — admin report assignment and the `DECISIONS.md` D-005 entry were
  removed as unrequested additions; the claim flow is unchanged and `docs/prds/` is
  left as found.
- [x] Verification complete — `pnpm check` green (typecheck, 9/9 tests, client + server build);
  browser end-to-end walkthrough from a clean database done: setup admin → official
  self-registration (PENDING) → admin verification → resident report `CS-2026-0001` →
  official claims/posts update/advances SUBMITTED→…→CLOSED → resident sees status,
  updates, and full 7-entry history → notifications (6, mark-all-read) → admin audit log
  (8 entries with actor + timestamp). No manual database edits required.
- [x] Architecture pass — one owner per concern (see “Resulting structure” below):
  duplicated policy collapsed into `shared/contracts.ts`, `server/{http,session,users,
  activity}.ts`, `src/lib/hooks.ts`, `src/lib/notifications.tsx`; per-page fetch/submit
  state and the duplicated notifications fetch deleted. Behavior preserved: `pnpm check`
  green (17/17 tests after the proof-of-life pass), browser smoke re-verified (filters,
  claim/status/update flows, upload, badge/list consistency).

## Resulting structure

Later passes should build with this shape, not against it. One owner per concern:

**Shared**

- `shared/contracts.ts` — the contract: primitives + wire shapes, `isStaffRole`,
  `REPORT_STATUS_LABELS`/`reportStatusLabel`, `REPORT_TRANSITIONS`. Both sides import
  from here; nothing re-declares a wire shape.

**Server** (dependencies point inward: routes → {session, users, activity, http} →
{database, contracts})

- `server/http.ts` — protocol only: `ApiError`, `sendError`, `pathId`, `isoTime`.
- `server/session.ts` — the auth boundary: session cookie/verification,
  `userForSessionToken`, `Express.Request.authUser` declaration.
- `server/users.ts` — user rows: `UserRow`, `USER_SELECT`, `serializeUser`,
  `serializeAdminUser`, `findUser`.
- `server/activity.ts` — recording side effects: `recordAudit`, `recordReportEvent`,
  `createNotification`, `notifyOrganization`.
- `server/routes/{auth,catalog,reports,notifications,admin}.ts` — route owners.
  `reports.ts` owns report visibility policy (`canView`/`assertCanView`/
  `assertCanManage`) and report serialization.
- `server/app.ts` — composition root only (mounts routes, `/uploads` static,
  middleware). `server/index.ts` — process entry (env config, client static, SPA
  fallback, graceful shutdown).

**Client** (UI reads server state via `api.ts` → hooks/providers; no client-side domain
state)

- `src/main.tsx` — composition root: Router → `AuthProvider` → `NotificationsProvider`
  → `App`.
- `src/lib/hooks.ts` — fetch/action state: `useFetch` (fresh load on path change,
  silent `reload()`, stale-response guard) and `useAction` (pending/fieldErrors/error/
  notice). Pages never hand-roll this.
- `src/lib/notifications.tsx` — the notifications store: `NotificationsProvider` +
  `useNotifications()`. The header badge and the notifications page read the same
  state, so they cannot disagree.
- `src/lib/api.ts` — HTTP client (`api.get/post/postForm`, `ApiRequestError`,
  `errorDetails`). `src/lib/auth.tsx` — session state. `src/lib/format.ts` — dates.
- `src/pages/*` + `src/components/*` — rendering and wiring only.

**Data flow:** request → `routes/*` (policy) → `session`/`users`/`activity` (access +
recording) → `database` + `shared/contracts` (shape) → JSON. Client: `api.ts` →
`useFetch`/`useAction` or a provider → pages render.
