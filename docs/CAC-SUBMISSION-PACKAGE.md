# CivicSignal · 2026 Congressional App Challenge package draft

This is a factual draft for the student to review and personalize. Do not submit claims about interviews, endorsements, agency partnerships, real response outcomes, statistics, or independent authorship unless the student can verify them.

## Deadline and submission requirements

Official CAC pages currently disagree about the October 26, 2026 deadline:

- The [student registration page](https://www.congressionalappchallenge.us/students/student-registration/) says **9:00 PM ET**.
- The [2026 official rules PDF](https://www.congressionalappchallenge.us/wp-content/uploads/2026/05/2026-CAC-Rules.pdf) says **12:00 PM EDT (noon)**.

Until CAC staff clarifies the discrepancy, plan to submit by **12:00 PM EDT on Monday, October 26**. Confirm the portal's displayed cutoff and current submission checklist before upload. The rules require a public YouTube or Vimeo demonstration video of 1–3 minutes and ask for the app's purpose, audience, tools, and functionality. The 2026 rules permit AI support only with full disclosure and expect significant student contribution and technical understanding.

## App description

**CivicSignal helps residents report non-emergency neighborhood issues to organizations configured for a community and follow the status changes and official updates recorded for each report.**

CivicSignal is an independent, nonpartisan project. It is not a government service, a 311 integration, or an emergency response channel.

## Problem and inspiration

**Problem statement:** Residents need a clear way to understand whether a non-emergency issue report was routed, who is handling it, what changed, and what action remains. A submission form by itself does not show follow-through.

**Inspiration draft:** “I wanted to explore how software could make the period after a community report more transparent. CivicSignal keeps the report, status changes, and official updates together so the resident can see the recorded history.”

This wording describes the product motivation, not user research. No interviews, surveys, agency feedback, or local service data are documented in this repository. The student should replace or expand the inspiration with their real experience and distinguish personal observations from facts they verified.

## Tools and technologies

- TypeScript, React 19, Vite 7, React Router, and custom CSS for the responsive web app.
- Express 5 API with Zod request validation, bcrypt password hashing, HTTP-only session cookies, role checks, and rate limits.
- SQLite for local development/tests and PostgreSQL for production through a shared database adapter.
- Supabase private Storage or Vercel private Blob for server-side photo storage, depending on deployment configuration.
- Vitest, Testing Library, and Supertest for unit and API tests.
- Vercel static hosting and serverless API deployment.

The student should add any additional tools they personally used and identify the work they personally designed, changed, tested, and can explain.

## Distinctive feature

**The report journey:** every report carries persisted events for submission, claim, status transition, official update, and moderation. The resident view shows the current status, the recorded actor and time for each history event, official update text, and a plain-language next-step explanation. It distinguishes an organization's “Resolved” status from an independent inspection and avoids promising response times.

This feature uses actual per-report records and authorization checks. It does not expose a public dashboard of resident reports or imply that the status is an official government record.

## Reproducible demo sequence

Run the demo on a local SQLite database. Do not seed fake data into the public production deployment.

1. Complete first-run setup using a password chosen privately for the local demo.
2. As administrator, add a clearly fictional organization and category, such as “Demo Public Works” and “Roads and Sidewalks.”
3. Register a fictional staff account, verify it under that organization, then register a resident.
4. As the resident, submit a synthetic issue such as “Demo pothole at Oak Avenue and Cedar Street.” State that the location and report are fictional.
5. Show the confirmation reference and the responsible configured organization.
6. As staff, claim the report, move it to “Under review” or “In progress,” and post a concise update describing the next action.
7. Return to the resident view. Show the new status, the explanation of what happens next, the official update, and the timeline entry with its actor and timestamp.
8. End by explaining that statuses are records entered into CivicSignal and that no response-time guarantee or real municipal integration is claimed.

Do not put demo passwords in source code or video. A second browser profile can demonstrate the resident and official roles without exposing credentials on screen.

## Demo-video script · about 2 minutes

**0:00–0:15 — Introduction**  
“Hi, I’m [student name]. My app is CivicSignal. It helps residents report non-emergency neighborhood issues and follow the response recorded by the organization configured for that community.”

**0:15–0:35 — Problem**  
“Submitting a report is only the first step. People also need to understand whether it reached anyone and what changed afterward. CivicSignal focuses on that transparency. It is not a government service or an emergency channel.”

**0:35–1:05 — Resident report**  
Show the fictional resident account and enter the synthetic pothole report. “The category routes this to the organization configured by the administrator. The app returns a reference so the resident can reopen the saved report.”

**1:05–1:35 — Official action**  
Switch to the fictional verified staff account. Claim the report, change its status, and post an update. “These actions are checked by the API against the staff role and organization, then recorded as report history.”

**1:35–1:55 — Transparency feature**  
Switch back to the resident. Show current status, the next-step guidance, update, and timeline. “The history shows who recorded each action and when. ‘Resolved’ means the organization set that status in CivicSignal; it is not an independent inspection.”

**1:55–2:10 — Engineering and close**  
“The app uses React and TypeScript, an Express API, SQLite locally and PostgreSQL in production, and private photo storage. I used AI for [accurate list]. I personally [describe only work you reviewed, modified, tested, and understand].”

The student should say the closing AI disclosure accurately and keep the recording at or below three minutes.

## AI-assistance disclosure draft

> I used OpenAI Codex as an AI coding assistant during development. For the October 22, 2026 engineering pass, Codex inspected this repository and generated or modified code and documentation for API cache headers, static metadata assets, the public landing and privacy/terms pages, report-status guidance, image-signature validation, private Vercel Blob handling, rate limiting, tests, and submission materials. I reviewed the generated changes and [describe the specific lines or behaviors you personally checked, changed, ran, and can explain]. Earlier AI assistance, if any, was [describe accurately]. I did not use AI to create user research, statistics, endorsements, municipal integrations, or test results. The application was tested using [actual commands and results after final review].

Before submission, replace the bracketed text with the student's actual contribution. Do not claim the AI-generated code was independently written by the student. The rules require significant student effort and technical understanding; the student should review, run, modify, and be able to explain the code they submit.

## Likely judge questions and grounded answers

**Why is this different from a basic complaint form?**  
The report retains a timeline of submission, ownership, status changes, and official updates. Residents see the responsible configured organization and plain-language guidance for the recorded status.

**How does routing work?**  
An administrator connects categories to active organizations. The API reads that configuration when a resident submits a report. The app does not connect to municipal 311 systems or choose a town based on the resident's address.

**How do you stop one resident from reading another's report?**  
The report detail and attachment endpoints authenticate each request and call the same server-side visibility check. A resident can see only their own report; active staff are limited to their organization; administrators have platform access. Tests exercise unauthenticated access and cross-resident denial.

**How are status transitions controlled?**  
The shared contract defines allowed transitions. The server checks the current state before updating the report and writes the transition event, notification, and audit record. The client only displays actions the API says are available; the server remains the authorization boundary.

**How are uploaded photos protected?**  
Uploads are limited to one file of at most 4 MiB, accepted MIME types are checked against file signatures, and the API serves attachments only after report authorization. Supabase buckets are rejected if public. New Vercel Blob uploads request private access and are fetched through the SDK. Legacy public Blob objects may need a separate storage migration.

**What happens if the storage service is down?**  
The production app can start without the optional photo service; a photo submission then returns a sanitized service-unavailable error. Account and report APIs do not claim the upload succeeded.

**How do you handle passwords and sessions?**  
Passwords are bcrypt-hashed. The server creates a random token, stores only its SHA-256 hash and expiry, and sets an HttpOnly, SameSite=Lax cookie with Secure enabled in production. API responses are marked `private, no-store` in this code pass.

**How do you test without modifying real residents' data?**  
The API tests create temporary SQLite databases and synthetic accounts in a temporary directory. Postgres integration tests require a separate disposable database; production is not a test target.

**What are the current limitations?**  
The app has no verified municipal integration, no public aggregate statistics, no service-level response-time guarantee, and no published operator/support contact or retention schedule. Production photo bucket access and a full authenticated production workflow have not been verified in this workspace. Vercel rate limits are per function instance, not a globally coordinated abuse-control system.

**What does the app use AI for?**
When the deployment operator configures `GEMINI_API_KEY`, Google Gemini analyzes a selected issue photo and suggests a description and configured category. Residents can edit the result; it does not automatically route or submit a report. Public statistics remain disabled because they would require explicit privacy thresholds and eligible data; no external-data integration is claimed.

## Scorecard · evidence and remaining gaps

Final scores should be revisited after the student reviews the code and after a real deployment owner performs the manual configuration steps.

| Dimension | Draft rating | Evidence | Remaining gap |
| --- | ---: | --- | --- |
| Idea quality | 4/5 | Clear community need: transparent follow-through after issue submission; nonpartisan, configured-organization model. | No documented interviews or measured community impact. Add only real student research. |
| Implementation and UX | 4/5 | Role-based resident/staff/admin paths, public landing, emergency limits, report details, updates, status history, responsive styles. | No current browser/mobile/keyboard walkthrough of the deployed release. |
| Programming excellence | 4/5 | TypeScript, shared status policy, dual database adapters, API authorization, audit events, private photo adapters, test suite. | Production photo settings and deployment build are not verified from Vercel credentials. |
| Reliability | 3/5 | API cold-start paths, data persistence, report workflow, and photo behavior have local API tests; current public API responds. | Authenticated production report/photo workflow remains unverified; rate limiting is per-instance. |
| Security and privacy | 3/5 | Server-side roles and ownership, private/no-store API responses in this code, image signature checks, private storage for new Blob writes, private Supabase-bucket enforcement. | The fix is not deployed; legacy public Blob objects may remain public; no operator/contact or retention policy is published. |
| Demo clarity | 4/5 | Short local synthetic walkthrough shows the full report-to-update loop and the history differentiator. | The local demo still needs manual organization/staff setup; rehearse with two role sessions and no real resident data. |

These are self-assessment estimates, not official judging outcomes or security certifications.

## Pre-submission checklist

- Confirm the CAC portal's exact cutoff because its public registration page and rules PDF disagree.
- Complete the student's personal/eligibility profile and final application before the portal closes.
- Record and watch the final public video; confirm every claim matches the working app.
- Student reviews and can explain the generated authentication, authorization, storage, validation, database, and test code.
- Fill the AI disclosure with the student's own contribution and include any prior AI use.
- Provide the source code and demo access only in a way that does not expose production credentials or real user data.
