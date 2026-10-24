# Prompt: explain CivicSignal and the App Challenge

Copy this into an AI assistant that can read this repository and browse official sources. Fill in the bracketed details first.

```text
Explain this project and its Congressional App Challenge situation to me in plain English, like a patient teammate. I am [name/grade], and I personally worked on [what I actually built, changed, tested, and understand].

Start by inspecting the current repository and its actual behavior. Explain:
1. What CivicSignal does in a normal report flow, in five short steps.
2. What works in the code versus what is only a prototype, configuration seam, planned feature, or unverified production claim. Check the landing page, About/privacy pages, report form, API, deployment notes, and submission package. Do not rely on old marketing copy.
3. What a “configured organization,” report status, private guest tracking link, and staff timeline mean. Be explicit that the app is not a 311 or government integration, has no response guarantee, and a “Resolved” status means staff recorded it.
4. What information a report shares, why the current form requires a photo, how device location is used, and what the 90-day guest link expiry does and does not mean about data deletion.
5. The Gemini photo feature’s current behavior and configuration. It is available automatically when the server-side `GEMINI_API_KEY` is set unless `DISABLE_GEMINI_PHOTO_ANALYSIS=true`; selecting a photo alone does not send it. The owner says the intended users are adults and the Terms state the service is for users 18+. Distinguish that stated policy from verified age checks or user analytics. Explain Google's current age, audience, and professional/business-use terms accurately, cite the official terms, and do not treat the Terms statement as proof of eligibility.
6. The 2026 Congressional App Challenge requirements relevant to this app: the 1–3 minute public demo video, required items to show, the stated judging dimensions, required disclosure of all AI development use, and the student’s need to show significant personal effort and technical understanding. Link and cite the official rules.
7. Josh Gottheimer’s role: he represents NJ-05 and, under the rules, the Member of Congress and office review the entries; a panel is optional and the final judging process is at the Member’s discretion. Gottheimer is the ultimate decision-maker for this district’s result. Distinguish that from public facts about his policy statements. His office page describes the challenge as a student STEM competition; his public statements support AI literacy and critical thinking. These are context, not a secret rubric or evidence of his private preferences. Do not flatter, pander, or invent a judging preference.
8. Note the published deadline conflict: the official rule PDF says October 26, 2026 at noon EDT; the student registration page says 9 PM ET; Gottheimer’s page says 8 PM. Tell me to submit before noon and verify the portal deadline directly.

Use current official sources for rules, district scope, Gottheimer statements, and Google terms. Prefer the Congressional App Challenge, Gottheimer’s House website, and Google AI for Developers. Provide a Markdown source link near each time-sensitive claim and label inference as inference.

Finish with three sections:
- “What I should understand before explaining it”: the 5 most important technical concepts in beginner-friendly language.
- “Risks that could hurt the entry”: only evidenced risks, prioritized by severity, including eligibility/production claims and truthful AI disclosure.
- “My next three actions”: concrete steps I can personally complete before submission.

Do not invent student contributions, app users, interviews, user counts, impact measurements, municipal partners, government endorsement, test results, deployment verification, response guarantees, or a special Gottheimer preference. If information is unknown, say so and ask me. Keep the explanation concise, use short paragraphs, and distinguish fact from recommendation.
```
