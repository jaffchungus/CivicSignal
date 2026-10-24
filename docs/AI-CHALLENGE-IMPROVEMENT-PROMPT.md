# Prompt: improve CivicSignal for the Congressional App Challenge

Use this after the [explainer prompt](AI-EXPLAINER-PROMPT.md). Paste it into an AI coding assistant with access to the repository and web research.

```text
First follow the factual grounding in docs/AI-EXPLAINER-PROMPT.md, then help me make CivicSignal a much stronger 2026 Congressional App Challenge entry for NJ-05.

My goal is to create an entry that can stand out to Representative Josh Gottheimer, who has the final say for this district. Aim for work that would impress a fair judge on the published criteria; do not promise a win or claim to know Gottheimer's private preferences. Use his public statements only as context: the competition is a student STEM showcase, and his public AI-in-education comments describe AI as a tool that should support, not replace, students' own critical thinking. Keep the app nonpartisan and independent. Do not put Gottheimer's name, political slogans, or judge-targeting copy in the product UI.

Before changing code:
1. Inspect the actual app, git diff, README, privacy/terms, CAC submission package, and relevant API and database behavior. Treat prior explanations as context, not a substitute for checking the repository.
2. Read the current official 2026 CAC rules and official Gottheimer/NJ-05 pages. Report the current judging criteria, video requirements, deadlines, and any conflicts with source links. Do not invent a hidden rubric.
3. Score the current entry against the published dimensions: idea quality/creativity/originality; implementation/user experience/design; and demonstrated coding/programming skill. For each score, cite evidence and label uncertainty. Identify the three changes most likely to improve the entry.
4. Check eligibility and authorship risk before proposing large AI-generated rewrites. The student must be able to truthfully explain and demonstrate significant personal effort and technical understanding; disclose all AI use fully. Coach me to own the work rather than representing generated code as mine.

Then improve the app in ways that make its value obvious in a short live demo:
- Lead with CivicSignal's distinctive strength: a resident can follow the recorded report history, staff action, and updates after submission.
- Make the demo path clear, fast, accessible, polished on phone and desktop, and resilient when data or optional providers are unavailable.
- Prefer concrete, demonstrable improvements over speculative AI claims, visual gimmicks, or features that require unverified municipal partnerships, user data, or production infrastructure.
- Keep routing honest: the resident chooses a category, an administrator maps it to a receiving organization, and the app does not infer jurisdiction or connect to 311 unless the code demonstrably changes.
- Preserve the manual reporting path. Gemini photo suggestions are available automatically when the server-side GEMINI_API_KEY is configured, unless DISABLE_GEMINI_PHOTO_ANALYSIS=true. Selecting a photo alone must not send it; the resident must request suggestions and separately choose whether to apply them. Do not silently remove, disable by default, or misrepresent this feature.
- The owner says CivicSignal is intended for adults 18+; its age eligibility belongs in the Terms of Service. Do not add an 18+ claim to the landing-page headline, promotional copy, challenge pitch, or demo script. Distinguish the stated intended audience from age verification or actual usage evidence. Review Google's current Gemini API terms, including API-user age, audience, and professional/business-use restrictions; an 18+ Terms clause alone does not prove that a deployment is eligible.

Make the strongest small set of changes you can complete responsibly. Preserve working behavior and data. Do not create fake accounts, testimonials, partnerships, interviews, user counts, impact statistics, official endorsements, district-wide coverage, deployment verification, or test results. Do not claim AI suggestions are factual or automatically route reports. Keep CAC disclosure drafts accurate and leave placeholders where I must supply my real contribution or experience.

After editing, give me:
1. A prioritized changelog tied to the official judging criteria, with file links.
2. The exact demo story in 5–7 beats and a concise 1–3 minute script based only on verified features.
3. Five likely judge questions with honest answers and the code area I should personally study for each.
4. A short student-work checklist: what I need to code, inspect, change, and demonstrate myself so I can explain the app without guessing.
5. A candid remaining-risk list, including eligibility, AI disclosure, audience/provider terms, and anything not actually deployed or verified.

Use current primary sources for time-sensitive facts and cite them inline. Label recommendations and inferences. If an important fact is unknown, say so instead of filling it in. Never say that Gottheimer will love it or that any change guarantees a win.
```
