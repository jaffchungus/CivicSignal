# Prompt: make CivicSignal feel intentionally designed

Copy this prompt into Cursor or another AI coding assistant with access to the CivicSignal repository. It guides the assistant from product purpose to UI decisions, then implementation and UX review. It is about making the experience specific, clear, and trustworthy—not fooling AI detectors or making unsupported claims about how something was written.

```text
Help me improve CivicSignal's website so it feels deliberately designed for its real users and purpose, rather than like a generic AI-generated template. Work through the five steps below in order. Inspect the existing product before proposing or changing the UI. Keep the scope focused on user experience and visual design; do not change the product's underlying behavior.

The phrase "looks AI-generated" describes an impression, not verified authorship. Do not claim that any existing text or code was written by AI. Look for observable problems such as generic copy, predictable template patterns, weak hierarchy, needless repetition, or visual choices that do not serve the user's task. Do not add quirks, forced informality, deliberate imperfections, trendy effects, or decorative elements merely to seem human.

## Step 1 — Identify the message

First inspect the actual application, including its pages, shared components, styles, routes, and product documentation. If a browser preview is available, use it to see the current experience at desktop and mobile sizes. Do not infer the design from filenames or screenshots alone.

For each key screen, answer:
- What should the user feel or understand at first glance?
- What is this screen for: guiding, reassuring, informing, or prompting an action?
- What is the one thing the user most needs to notice?

Write a one-sentence design north star for the website as a whole, then a short one for each screen you intend to change. Ground these in the product's verified purpose and behavior. For CivicSignal, preserve the core idea: residents can submit a non-emergency community issue to an organization configured for the community, then return to see updates recorded by authorized staff. Do not imply that every report will receive a response or that CivicSignal is a government service.

Before changing files, check the working tree and existing diff. Preserve pre-existing and concurrent user changes; never reset, discard, overwrite, or include them in your work.

## Step 2 — Identify the user and their context

Use the repository and product documentation to identify who uses each screen and what they need to do. At minimum, consider:
- A resident who may be reporting a frustrating local problem, may be on a phone, may be short on time, and needs to understand what happens after submission.
- A returning resident who wants to find their report, understand its current status, and see any recorded updates without guessing.
- An authorized public-service staff member, where applicable, who needs to review reports and record actions clearly.
- An administrator, where applicable, who configures the service and needs to understand system settings without confusing them with resident tasks.

State what each user likely knows, what they may not know, and any relevant constraints such as stress, limited attention, small screens, accessibility needs, or uncertainty about whether a service is official. Do not invent research, interviews, demographics, or user evidence. Label assumptions as assumptions and use existing product evidence where available.

## Step 3 — Translate the message into UI principles

Turn each north star into a small, concrete set of design principles before choosing components or styling. Explain how each principle improves the user's task. Examples:
- Reassure with factual, plain-language explanations and a calm, consistent layout—not promises.
- Guide with an obvious primary action, useful section headings, and a clear next step.
- Help users track progress with visible status, dates, and staff updates where the product actually provides them.
- Reduce effort with concise forms, predictable labels, and mobile-friendly controls.
- Support trust with accurate disclosures, clear distinction between CivicSignal and public agencies, and no unsupported impact claims.

Review the existing brand and design system first. Reuse existing typography, colors, components, and interaction patterns when they work. Avoid defaulting to common AI-template signals such as a gradient hero, a row of identical rounded cards, excessive pills/badges, generic icon decoration, centered everything, repeated slogans, or oversized marketing claims. These are not automatically wrong; keep them only when there is a concrete reason they help this product and its users.

Do not make a visual change just to make the page different. Each proposed change should improve clarity, hierarchy, task completion, consistency, accessibility, or trust.

## Step 4 — Generate and implement deliberately

Before editing, summarize:
1. The north star.
2. The user and context for each screen in scope.
3. The design principles you will apply.
4. The specific screens/files and the intended changes.
5. Any assumptions or product facts that need verification.

Then make the smallest coherent set of implementation changes that achieves the goal. Keep existing routes, workflows, permissions, authentication, report creation, report status/history, integrations, and data handling intact. Do not add dependencies or replace the design system for a cosmetic preference. If a worthwhile change would alter behavior or require expanding scope, explain it and ask before proceeding.

When editing:
- Use concrete, natural language that explains the real action or outcome. Remove filler and repetition only when the information is genuinely redundant.
- Keep headings, labels, calls to action, and empty/error states specific to the task and screen.
- Preserve all accurate product disclosures, safety information, privacy explanations, errors, and user guidance.
- Do not invent government partnerships, endorsements, service coverage, guaranteed response times, testimonials, user counts, impact metrics, or capabilities.
- Do not imply that CivicSignal is an emergency service, a government service, or a 311 integration. Keep the existing emergency notice and non-affiliation/independent-prototype disclosure clear and accurate.
- Keep resident, official, and administrator tasks distinct. Do not expose or imply permissions that the product does not provide.
- Preserve semantic HTML, keyboard access, visible focus, readable contrast, accessible labels, responsive behavior, and reduced-motion support where relevant.
- Follow existing code conventions and localization patterns. Avoid unrelated refactors.

If you discover that a change would affect a critical disclosure, safety behavior, privacy, accessibility, or product functionality, stop and explain the issue before making that change.

## Step 5 — Iterate with UX eyes

After implementation, inspect the result rather than assuming the first version is good. Review each changed screen at a narrow mobile width and a wider desktop width if practical. Check the actual page in a browser when available.

Ask and answer:
- Is the main message clear within a few seconds?
- Is the most important action or information the most noticeable?
- Does the layout reflect the user's context and task, rather than a generic template?
- Is the next step obvious? Are there unnecessary steps, repeated content, or confusing labels?
- Are status, updates, uncertainty, and limitations explained accurately?
- Do mobile layout, keyboard use, focus, contrast, labels, and text sizing remain usable?
- Did any change accidentally weaken a disclosure or alter existing behavior?

Make a follow-up adjustment only when the review identifies a concrete problem; do not keep changing the page for novelty. Run the smallest relevant safe checks (for example, focused tests, lint, or build checks if available). Do not run commands that could alter databases, uploads, or user data unless their effects are understood and necessary.

Finish with:
1. The north star and user context you used.
2. The design principles applied and a concise summary of changes, with file links.
3. Any assumptions or findings that were not verified.
4. The UX review performed, including viewport/browser checks if actually completed.
5. Checks run and their actual results. Never claim a check or visual review passed if it was not performed.
6. Any remaining friction or suggested next iteration.

If the existing experience already serves its purpose well and you cannot identify evidence-backed improvements, say so and leave it unchanged. The goal is a more useful and specific CivicSignal—not novelty, a particular aesthetic trend, or the appearance of human authorship.
```
