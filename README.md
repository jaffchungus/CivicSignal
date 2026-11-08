# CivicSignal

CivicSignal is a civic app that helps solve community issues. Residents can submit non-emergency issues, see which configured organization received them, and follow the status, official updates, and recorded history. It is not a 311 integration, a government record system, or an emergency service.

## Architecture

- **Web client:** React 19, React Router, Vite, TypeScript, and custom CSS. Vite builds static assets to `dist/client`; route content is a single-page app.
- **API:** Express 5 in `server/app.ts`. Vercel invokes it through `api/index.ts`; local development runs `server/index.ts` and Vite together.
- **Contracts:** `shared/contracts.ts` owns shared API types, report statuses, and allowed status transitions.
- **Database:** `CivicDatabase` is the shared async data-access seam. Local development and tests use SQLite; production uses PostgreSQL. Existing schema initialization is performed by the database adapters at startup.
- **Authentication:** Express issues random session tokens in an HttpOnly, SameSite=Lax cookie (Secure in production). Only a SHA-256 token hash is stored in the database. Report and staff authorization is enforced in API routes.
- **Photos:** The API checks the declared MIME type against the file signature before storage and serves attachments only after the report authorization check. Production uses private Supabase Storage or private Vercel Blob when configured, and falls back to a private Postgres table when those providers are unavailable.
- **Report history:** Each report stores status events, responsible staff, and official updates. The resident view combines that persisted history with plain-language guidance tied to the current status.

## Local setup

Requirements: Node.js 22 or later and pnpm 11 (the package manager version is recorded in `package.json`).

```powershell
Copy-Item .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev
```

Open the Vite URL printed by the client process (normally `http://localhost:5173`). The first user completes first-run setup to create the local administrator. In the app, create an organization and issue categories, register a staff account, verify it as the administrator, then register a resident. Use fictional names, locations, and report content in demos.

Local defaults use `./data/civicsignal.db` and `./uploads`; both are ignored by Git. No demo credentials or seeded real-world reports are included. To start over locally, stop the app and remove only those local development files.

## Security headers

Every response carries a strict Content-Security-Policy (`script-src 'self'` and `style-src 'self'`, no inline or eval script/styles), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `strict-origin-when-cross-origin`, a restrictive `Permissions-Policy` (geolocation is limited to this origin because the location button uses it), and same-origin COOP/CORP. Production HTTPS responses add `Strict-Transport-Security` and `upgrade-insecure-requests`; plain-HTTP local development omits both so localhost keeps working. The standalone server sets the policy in Express; Vercel serves `dist/client` from its CDN, so `vercel.json` mirrors the same values for those responses.

## Environment variables

Copy `.env.example` and replace placeholders only in your local ignored `.env.local` or the hosting provider's secret settings. Never commit a real secret.

| Variable | Purpose |
| --- | --- |
| `PORT` | Local Express port (default `3001`). |
| `DATABASE_PATH` | SQLite file for local development (default `./data/civicsignal.db`). |
| `UPLOAD_DIR` | Local photo directory (default `./uploads`). |
| `APP_ORIGIN` | Public origin (for example `https://civicsignal.example`). Requests that change data must come from this origin or the host that served them; comma-separate multiple origins. Needed behind a TLS-terminating proxy that does not forward `X-Forwarded-Proto`. |
| `SESSION_TTL_HOURS` | Absolute session lifetime in hours (default `2`). Invalid or non-positive values fall back to the default. |
| `GEMINI_API_KEY` | Server-only Google Gemini API key. When configured, submitting a report sends the required photo to Gemini 3 Flash Preview, which writes the title and problem description and selects the active category. That category determines the receiving organization, and the server assigns the nearest eligible verified staff member, preferring the report’s municipality and otherwise the closest eligible person in any organization. A cross-organization assignee can open, update, queue, and read attachments for the assigned report. Report submission is unavailable without AI classification. Never use a `VITE_` or `NEXT_PUBLIC_` prefix; the deployment operator must verify the audience and API use meet Google's current terms. |
| `DISABLE_GEMINI_PHOTO_ANALYSIS` | Optional emergency switch. Set to `true` to disable classification even when `GEMINI_API_KEY` is configured; report submission is unavailable while classification is disabled. |
| `CONNECTION_STRING` | PostgreSQL URL; takes precedence over `DATABASE_URL` and `POSTGRES_URL`. Use a TLS-enabled Supabase Postgres connection in production. |
| `DB_PASSWORD` | Alternative for the configured Supabase database host; the server builds a TLS-enabled Postgres URL. |
| `PHOTO_STORAGE` | Production provider: `database`, `supabase`, or `blob`. Without cloud storage credentials, photos use the private `report_photos` table in Postgres. |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | HTTPS Supabase project URL (server reads it; no Supabase Auth is used). |
| `SUPABASE_SECRET_KEY` | Server-only credential for private Supabase Storage. Never use a publishable key for privileged storage operations. |
| `SUPABASE_PHOTO_BUCKET` | Private photo bucket name (default `civicsignal-photos`). |
| `BLOB_READ_WRITE_TOKEN` | Server-only Blob credential when using Blob; connect a **private** Blob store. Vercel OIDC may be available when the store is connected. |
| `REVERSE_GEOCODER_URL` | Optional HTTPS reverse-geocoding endpoint. Defaults to OpenStreetMap Nominatim. Lookups are user-triggered, cached, and rate-limited. |
| `REVERSE_GEOCODER_NAME` and attribution settings | Set the provider name, attribution, policy URL, and usage note when changing the reverse-geocoding endpoint. |
| `REVERSE_GEOCODER_CONTACT` | Optional operator contact placed in the identifiable address-lookup `User-Agent`. Set one when using the public Nominatim service. |
| `WEB_PUSH_VAPID_PUBLIC_KEY` / `WEB_PUSH_VAPID_PRIVATE_KEY` | Optional Web Push credentials. If omitted, CivicSignal creates one persistent VAPID key pair in the configured database. Keep an explicitly configured private key server-only. |
| `WEB_PUSH_SUBJECT` | Operator URL or contact email used to identify the Web Push sender. Set a real contact for production. |
| `SUPABASE_DB_POOLER_HOST` | Optional Supavisor pooler host override for Vercel. |

The Supabase and Vercel configuration details, including private storage requirements and limitations, are in [docs/SUPABASE-DEPLOYMENT.md](docs/SUPABASE-DEPLOYMENT.md). `.env.example` contains placeholders only.

See [docs/REAL-WORLD-READINESS.md](docs/REAL-WORLD-READINESS.md) for the current provider/configuration gaps, guest report link behavior, and launch requirements.

## Database and deployment safety

The application creates/updates its own schema through adapter initialization. Review `server/database-sqlite.ts` and `server/database-postgres.ts` before changing schema behavior. Do not point local setup, migrations, or test code at production. Back up any populated database before changing the deployed schema or storage provider. There is no production-data seeding command.

Vercel builds with `pnpm run build`, serves `dist/client`, forwards `/api/*` to the Express function, and rewrites application routes to `index.html`. Files in `public/` are copied into the static output and take precedence over rewrites. Preview deployment and authenticated workflow checks require the project owner's Vercel access; this repository does not contain those credentials.

## Checks

```powershell
pnpm typecheck
pnpm test
pnpm build
```

`pnpm check` runs those checks in sequence. Tests use temporary SQLite databases and synthetic accounts. Optional Postgres integration coverage requires a disposable test database; never use production credentials.

## Safe judge demo

Use local SQLite rather than the public deployment. Create the admin through first-run setup, configure a clearly fictional organization and issue category, verify a fictional staff account, then submit a fictional road or park issue as a resident. If the server API key is configured and the operator has verified that the use meets Google's terms, demonstrate the required photo-and-location submission and show the AI-written title, chosen organization, and assigned staff member. Show the report reference, status guidance, a staff update, and the actor-and-time history after moving the status. Do not place credentials in source code or use real resident data. The detailed sequence and submission drafts are in [docs/CAC-SUBMISSION-PACKAGE.md](docs/CAC-SUBMISSION-PACKAGE.md). The reusable [explainer prompt](docs/AI-EXPLAINER-PROMPT.md) and [challenge-improvement prompt](docs/AI-CHALLENGE-IMPROVEMENT-PROMPT.md) are in `docs/`.

## Student contribution checklist for the Congressional App Challenge

Before submitting, review and be prepared to explain these areas to demonstrate your personal effort and technical understanding:

**Code areas to study:**
- `server/database-sqlite.ts` and `server/database-postgres.ts` - how the dual database adapters work
- `shared/contracts.ts` - the shared status policy and type definitions
- `server/app.ts` routes - how authentication and authorization are enforced
- `server/ai-photo-analyzer.ts` - how Gemini integration works when configured
- Test files in `tests/` - how the test suite verifies behavior

**What to demonstrate you personally did:**
- Ran the app locally with `pnpm dev` and completed first-run setup
- Created an organization, category, staff account, and submitted a test report
- Observed the report history, status changes, and timeline display
- Ran `pnpm test` and saw the tests pass
- Reviewed the authentication flow (session cookies, bcrypt hashing)
- Read the privacy and terms pages to understand data handling

**What AI tools assisted with (disclose accurately):**
- [Fill in: which AI tools you used, when, and for what specific code/features]
- [Example: "OpenAI Codex helped with the photo-and-location report submission, AI classification, and test updates in November 2026. I reviewed the changes and can explain the AI classification, organization routing, and nearest-staff assignment flow."]

**What you must not claim:**
- You wrote all the code yourself if AI generated substantial portions
- The app has verified municipal partnerships or government endorsement
- Real users, user counts, or impact statistics
- Deployed production infrastructure verified from Vercel credentials
