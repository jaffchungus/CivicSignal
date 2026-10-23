# CivicSignal

CivicSignal is an independent, nonpartisan community-reporting app. Residents can submit non-emergency issues, see which configured organization received them, and follow the status, official updates, and recorded history. It is not a 311 integration, a government record system, or an emergency service.

## Architecture

- **Web client:** React 19, React Router, Vite, TypeScript, and custom CSS. Vite builds static assets to `dist/client`; route content is a single-page app.
- **API:** Express 5 in `server/app.ts`. Vercel invokes it through `api/index.ts`; local development runs `server/index.ts` and Vite together.
- **Contracts:** `shared/contracts.ts` owns shared API types, report statuses, and allowed status transitions.
- **Database:** `CivicDatabase` is the shared async data-access seam. Local development and tests use SQLite; production uses PostgreSQL. Existing schema initialization is performed by the database adapters at startup.
- **Authentication:** Express issues random session tokens in an HttpOnly, SameSite=Lax cookie (Secure in production). Only a SHA-256 token hash is stored in the database. Report and staff authorization is enforced in API routes.
- **Photos:** The API checks the declared MIME type against the file signature before storage and serves attachments only after the report authorization check. Supabase Storage buckets must be private. Vercel Blob writes use private access; pre-existing public Blob objects need a separate provider-side migration.
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

## Environment variables

Copy `.env.example` and replace placeholders only in your local ignored `.env.local` or the hosting provider's secret settings. Never commit a real secret.

| Variable | Purpose |
| --- | --- |
| `PORT` | Local Express port (default `3001`). |
| `DATABASE_PATH` | SQLite file for local development (default `./data/civicsignal.db`). |
| `UPLOAD_DIR` | Local photo directory (default `./uploads`). |
| `SESSION_TTL_DAYS` | Local session expiry in days (local entry defaults to 14). |
| `GEMINI_API_KEY` | Optional server-only Google Gemini API key for photo analysis. Add it to Vercel's environment settings to enable AI suggestions; never use a `VITE_` or `NEXT_PUBLIC_` prefix. |
| `CONNECTION_STRING` | PostgreSQL URL; takes precedence over `DATABASE_URL` and `POSTGRES_URL`. Use a TLS-enabled Supabase Postgres connection in production. |
| `DB_PASSWORD` | Alternative for the configured Supabase database host; the server builds a TLS-enabled Postgres URL. |
| `PHOTO_STORAGE` | Production provider: `supabase` or `blob`. With no explicit choice, a configured Supabase secret selects Supabase; otherwise Blob is used. |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | HTTPS Supabase project URL (server reads it; no Supabase Auth is used). |
| `SUPABASE_SECRET_KEY` | Server-only credential for private Supabase Storage. Never use a publishable key for privileged storage operations. |
| `SUPABASE_PHOTO_BUCKET` | Private photo bucket name (default `civicsignal-photos`). |
| `BLOB_READ_WRITE_TOKEN` | Server-only Blob credential when using Blob; connect a **private** Blob store. Vercel OIDC may be available when the store is connected. |
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

Use local SQLite rather than the public deployment. Create the admin through first-run setup, configure a fictional public-service organization and issue category, verify a staff account, then submit a fictional road or park issue as a resident. Show the report reference, status guidance, an official update, and the actor-and-time history after moving the status. Do not place credentials in source code or use real resident data. The detailed sequence and submission drafts are in [docs/CAC-SUBMISSION-PACKAGE.md](docs/CAC-SUBMISSION-PACKAGE.md).
