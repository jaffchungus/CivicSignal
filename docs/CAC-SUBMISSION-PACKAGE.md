# CivicSignal · 2026 Congressional App Challenge package draft

This is a factual draft for the student to review and personalize. Do not submit claims about interviews, endorsements, agency partnerships, real response outcomes, statistics, or independent authorship unless the student can verify them.

## Deadline and submission requirements

Official pages currently disagree about the October 26, 2026 deadline:

- The [student registration page](https://www.congressionalappchallenge.us/students/student-registration/) says **9:00 PM ET**.
- The [2026 official rules PDF](https://www.congressionalappchallenge.us/wp-content/uploads/2026/05/2026-CAC-Rules.pdf) says **12:00 PM EDT (noon)**.
- [Representative Gottheimer's district page](https://gottheimer.house.gov/congressional-app-challenge) says **8:00 PM**.

Until the CAC confirms the discrepancy, plan to submit by **12:00 PM EDT on Monday, October 26**. Confirm the portal's displayed cutoff and current submission checklist before upload. The rules require a public YouTube or Vimeo demonstration video of 1–3 minutes and ask for the app's purpose, audience, tools, and functionality. The 2026 rules permit AI support only with full disclosure and expect significant student contribution and technical understanding.

## App description

**CivicSignal lets residents submit a non-emergency issue to an organization configured for the selected category, then see the status changes, official updates, and action history recorded for that report.**

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

Aim for 2:00–2:20, leaving room under the 3-minute limit. Replace every bracketed item with something true for your team. The stage directions are not spoken.

**0:00–0:12 — Open with the app**

**On screen:** Show the CivicSignal landing page. Keep your face in a small corner overlay if you want, but make sure the app stays readable.

**Say:** “Hi, I’m [name], and this is CivicSignal. It helps residents send a non-emergency community issue to the organization configured for that issue category, then follow the updates recorded in the app.”

**0:12–0:30 — State the problem and the focus**

**On screen:** Briefly point to the landing page’s three steps; do not read the page aloud.

**Say:** “A report is more useful when people can see what happened after they sent it. CivicSignal brings the report, its current status, official updates, and activity history together. It’s an independent prototype—not a government service, a 311 integration, or an emergency channel.”

**0:30–0:58 — Submit a fictional resident report**

**On screen:** In the prepared resident session, show the report form. Use a fictional issue and location. Select the demo photo, pause to show the selected category and receiving organization, then submit. If photo suggestions are enabled and working in this demo, show the suggestion and say it is AI-generated and reviewed by the resident; otherwise skip any AI feature claim.

**Say:** “Here I’m submitting a fictional pothole report. The category is connected to this demo organization, so the resident can see where the report is directed. [If applicable: ‘The photo can also generate a category and description suggestion; the resident reviews it before sending.’]”

**0:58–1:12 — Show confirmation and tracking**

**On screen:** Show the confirmation/reference and open the report. Hide browser bookmarks, personal data, and any access token in the URL.

**Say:** “After submission, CivicSignal gives the report a reference and lets the resident return to its updates. A guest tracking link should be kept private.”

**1:12–1:38 — Show the staff workflow**

**On screen:** Switch to the prepared fictional, verified staff session. Claim the report, change it to “In progress” (or another status available in your demo), and post a short update such as “Crew review scheduled.”

**Say:** “Now, as an authorized staff user, I can take ownership, record a status change, and post an update. These are actions recorded in CivicSignal for this report.”

**1:38–1:55 — Return to the resident view**

**On screen:** Switch back to the resident report. Show the new status, update, and timeline entries with their actor and time.

**Say:** “Back on the resident side, the update and activity history are visible together. This is a record of what was entered in the app—not an independent verification that work was completed.”

**1:55–2:15 — Explain the build and close**

**On screen:** Show the app once more, or a simple end card with “CivicSignal” and your name(s).

**Say:** “I built this with [accurate technologies you can explain]. I used [AI tools and what they helped with, stated accurately]. My own contribution was [specific work you personally did and understand]. CivicSignal is designed to make the follow-through on a community report easier to see. Thank you.”

### Before you record

- Rehearse once with a timer. Speak naturally, look at the camera for the opening and closing, and slow down on the feature you most want judges to remember.
- Prepare a local demo with a clearly fictional organization, category, staff account, resident report, photo, and location. Use separate browser profiles for resident and staff; sign in before recording so no password appears.
- Test the exact clicks and screen transitions first. Close unrelated tabs, silence notifications, zoom the browser so labels are legible, and keep the cursor still while you explain a screen.
- Use a screen recording with clear narration and readable app audio/video. If a role switch or loading delay is awkward, record short clips and edit the pauses—do not speed up the important workflow.
- If photo analysis is unavailable or not appropriate to demonstrate, do not imply it ran. Describe only features that work in the recording. Make your AI disclosure accurate and consistent with the written submission.
- Save a backup recording and check the final video's length, sound, privacy, and public link before submitting. Keep the finished video between 1 and 3 minutes.

## AI-assistance disclosure draft

> I used OpenAI Codex as an AI coding assistant during development. For the October 22–23, 2026 engineering passes, Codex inspected this repository and generated or modified code and documentation for API cache headers, static metadata assets, the public landing, About, privacy and terms pages, report-status guidance, image-signature validation, private Vercel Blob handling, rate limiting, tests, submission materials, and the photo-analysis request flow. Codex updated the Gemini model identifier from deprecated Gemini 3.5 Flash to Gemini 3.6 Flash and made the feature available automatically when `GEMINI_API_KEY` is configured, with an emergency disable switch. I reviewed the generated changes and [STUDENT: describe the specific lines or behaviors you personally checked, changed, ran, and can explain—for example, "the photo-suggestion button in ReportCreatePage.tsx, the isPhotoAnalysisConfigured() check in ai-photo-analyzer.ts, and the test that verifies suggestions are optional"]. Earlier AI assistance and any other AI tools used, if any, were [STUDENT: describe accurately or state "none"]. I did not use AI to create user research, statistics, endorsements, municipal integrations, or test results. The application was tested using [STUDENT: actual commands and results—for example, "pnpm test, which passed all 68 tests on October 23, 2026"].

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
Gemini photo classification is available when `GEMINI_API_KEY` is configured; `DISABLE_GEMINI_PHOTO_ANALYSIS=true` turns it off and prevents report submission. Selecting a photo sends it to `gemini-3-flash-preview`, which selects an active configured category; the category's administrator-configured organization receives the report. The owner identifies CivicSignal's intended users as adults, and the Terms state an 18+ eligibility rule. Google's current API terms also require the API user to be 18+, restrict apps likely to be accessed by minors, and specify professional/business purpose. This intended-audience statement is not age verification; the deployment operator must verify actual use and API eligibility. Public statistics remain disabled because they would require explicit privacy thresholds and eligible data; no external-data integration is claimed.

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

## Demo script note for the student

In the demo script above, replace bracketed placeholders with your actual information:
- [name] with your name
- [accurate list] with the specific AI tools you used and what they helped with
- [describe only work you reviewed, modified, tested, and understand] with concrete examples like "ran pnpm test, completed first-run setup, created a test organization and report, and reviewed the authentication flow in server/app.ts"
