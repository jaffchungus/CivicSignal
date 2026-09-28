# CivicSignal Decisions

This log is the source of truth for product and architecture decisions that affect multiple PRDs.

## D-001 — Do not infer the product from the repository name

- **Status:** Accepted
- **Decision:** The term “CivicSignal” will be treated only as the repository/product name. It will not be used to infer users, features, civic workflows, government relationships, reporting behavior, alerts, location use, or data sources.
- **Context:** The repository contains no product description or requirements. The specification instructions explicitly prohibit inventing the product concept, core requirements, users, or major features.
- **Reason:** A name is insufficient evidence for testable product behavior. Inference would create a fictional source of truth and could drive incompatible architecture and privacy choices.
- **Affected PRDs:** All current and future PRDs.

## D-002 — Defer technology and architecture selection

- **Status:** Accepted
- **Decision:** No application language, framework, frontend, backend, database, authentication provider, API style, infrastructure, or deployment platform will be selected until requirements establish the constraints those choices must satisfy.
- **Context:** The repository contains only `.gitattributes`; there is no implemented stack or architecture to preserve.
- **Reason:** Any selection now would be arbitrary and could unnecessarily constrain the actual product.
- **Affected PRDs:** `00-project-context.md`, `01-architecture.md`, and all future functional PRDs.

## D-003 — Do not create speculative functional PRDs

- **Status:** Accepted
- **Decision:** The current PRD suite will contain the requested context, architecture baseline, decision log, index, and consistency review, but no feature PRDs. Feature PRDs will be created after a product baseline exists.
- **Context:** There are no documented users, user journeys, features, domain entities, or acceptance criteria. A substantive PRD must be concrete, testable, and implementation-ready.
- **Reason:** Creating feature documents from the repository name would violate scope control and the stated source-of-truth requirement. Empty feature documents would be placeholders, which are also prohibited.
- **Affected PRDs:** `PRD-INDEX.md`, `PRD-CONSISTENCY-REVIEW.md`, and the future functional PRD set.

## D-004 — Application implementation is not authorized by this specification state

- **Status:** Accepted
- **Decision:** No application code should be implemented from the current documents. Repository scaffolding, schema creation, identity integration, API design, and UI implementation remain blocked on approved product requirements.
- **Context:** The task prohibits implementing application code, and the product scope is unknown.
- **Reason:** Even apparently reversible scaffolding would encode unsupported technical and product choices.
- **Affected PRDs:** `00-project-context.md`, `01-architecture.md`, and all future functional PRDs.

## D-005 — Production runs on Vercel with external data and photo storage

- **Status:** Accepted
- **Decision:** Production deployments run CivicSignal as a single serverless Express function (`api/index.ts`) on Vercel, with Postgres (e.g. Neon via `DATABASE_URL`) as the database and Vercel Blob for photo attachments. Local development and tests keep SQLite and on-disk photos through the same `CivicDatabase` and `PhotoStore` seams, and all SQL stays within the shared SQLite/Postgres subset.
- **Context:** Vercel Functions have no persistent filesystem, so the SQLite-on-disk data layer and local upload directory cannot survive deploys or instance recycling. The previous deployment also served the wrong output root (`dist/` instead of `dist/client`), so `/` returned the platform 404.
- **Reason:** Externalizing state makes the app deployable on serverless hosting without changing any product behavior; keeping both drivers behind one seam preserves the zero-infrastructure local workflow and the existing test suite. Known trade-offs: the in-memory rate limiter is per-instance, and Vercel's 4.5 MB request-body cap binds below the 5 MB attachment limit in production.
- **Affected PRDs:** `01-architecture.md`.

## Unresolved decisions requiring source material

The following are deliberately unresolved rather than silently assumed:

| ID | Decision needed | Minimum context required | Affected PRDs |
|---|---|---|---|
| U-001 | Product problem and outcome | Product brief or equivalent requirement source | All |
| U-002 | Users and roles | Actor definitions and trust relationships | All functional PRDs; architecture |
| U-003 | MVP scope and priority | User journeys and acceptance outcomes | Functional PRD structure; index |
| U-004 | Domain model | Information concepts, ownership, and lifecycle | Architecture; data-bearing features |
| U-005 | Authentication model | Whether identity is required and for whom | Account and protected-resource features |
| U-006 | Authorization model | Roles, resources, tenant boundaries, privileged actions | All protected workflows |
| U-007 | Data classification and privacy | Data collected, purpose, visibility, retention, deletion, jurisdiction | Architecture; all data-bearing features |
| U-008 | Client platforms | Required interaction surfaces and supported environments | Architecture; UI PRDs |
| U-009 | Integrations | Required external systems and data exchange | Architecture; integration PRDs |
| U-010 | Operational targets | Scale, latency, availability, recovery, observability | Architecture; deployment requirements |
| U-011 | Accessibility and localization | Applicable standards, languages, and regions | UI PRDs |
| U-012 | Testing and release constraints | Required quality gates and deployment environments | Architecture; definition of done |

