# Prompt: audit and refine CivicSignal's design

Copy this prompt into an AI coding assistant with access to the CivicSignal repository. It asks the assistant to identify design and copy that feel generic or plausibly AI-generated, propose concrete replacements, and make only safe, explicitly approved refinements.

```text
Audit CivicSignal for parts of the product that feel generic, formulaic, over-polished, or plausibly AI-generated. Suggest specific fixes, but do not edit any repository files until I have reviewed the audit and explicitly approved the exact changes. The goal is to make the app feel more deliberately made for its actual civic-reporting purpose—not to fool AI detectors, disguise AI use, or claim that you can determine who or what wrote something.

Treat "AI-generated" as a design impression, not a verified fact about authorship. Never label a line, component, or page as AI-written unless the repository explicitly documents that provenance. Instead, describe observable traits that can make it feel generic and explain why they may not fit CivicSignal. Do not make changes just to be quirky, less polished, or more "human." Do not add fake personality, forced informality, intentional imperfections, decorative gimmicks, or unsupported claims.

FAIL-CLOSED RULE: This prompt begins in AUDIT-ONLY mode. In that mode you may inspect files and run read-only checks, but you must not create, edit, delete, rename, format, stage, commit, deploy, or otherwise mutate repository files or data. Do not interpret the request to "audit," "suggest," "improve," or "make it better" as permission to edit. Only leave audit-only mode after I explicitly approve specific findings, intended changes, and the exact files allowed to change. If approval is ambiguous, incomplete, or broader than the proposed scope, ask for clarification and do nothing.

Phase 1 — Audit only; make no changes:
1. Check the current git status and diff. Record existing changes and preserve them. Do not stash, reset, checkout, clean, or overwrite anything.
2. Inspect the actual app in the browser if practical, and read its pages, shared components, styles, product documentation, and relevant tests. Follow the real user journey from landing page through report submission and report follow-up, as well as relevant account/navigation screens. Do not infer appearance or behavior from filenames alone.
3. Look for specific signals such as:
   - vague, interchangeable marketing copy, grand claims, repeated slogans, or headings that do not explain the actual feature;
   - repeated or redundant explanations, generic filler, unnatural transitions, and overly uniform sentence rhythms;
   - stock-template visual patterns that appear without a product reason (for example, repeated cards, badges, gradients, oversized rounded panels, decorative icons, or identical hero/feature sections);
   - inconsistent spacing, typography, button styles, hierarchy, alignment, or page layouts that make the experience feel assembled rather than cohesive;
   - generic placeholder language, empty states, or calls to action that do not tell a resident what will happen next.
   These are investigation prompts, not assumptions that CivicSignal necessarily has these problems. Cite the exact text, page/component, or visual pattern you observed.
4. For each suspected issue, separate observation from interpretation. Explain what feels generic, why it may weaken clarity or trust for this product, and what a more specific alternative would accomplish. Do not make unsupported authorship claims.
5. Produce a concise audit table with exact file paths and line numbers where possible:

   | Location | Observed issue | Why it feels generic or mismatched | Proposed fix | Risk |
   |---|---|---|---|---|

   Include only evidence-backed findings. Mark subjective judgments as subjective. Prioritize fixes that improve clarity, trust, accessibility, or consistency. Exclude purely cosmetic changes with no clear benefit.
6. Record the behavior, copy disclosures, and product facts that must remain unchanged. Treat the report journey and follow-up/history experience as especially important.
7. End with a proposed change list: for each proposed change, name the exact file(s), the specific edit, the reason, and the verification needed. Separate low-risk copy/style edits from any change with functional, privacy, accessibility, or data risk.
8. Stop and wait for my approval. Do not edit files in this phase. The audit and recommendations are the deliverable until I approve a specific change list.

Phase 2 — Implement only after explicit approval:
Proceed only if I explicitly approve the proposed changes and allowed files. Approval of one item does not approve other findings. If my approval does not clearly identify the approved items/files, ask before editing.

For approved items only, make the smallest coherent set of low-risk fixes:
- Replace vague copy with short, concrete language grounded in verified CivicSignal behavior. Preserve factual meaning, disclosures, and user intent. Do not invent a more compelling feature or promise.
- Remove repeated or filler copy only when it is genuinely redundant; retain instructions, context, privacy explanations, and information needed to complete a task.
- Refine visual patterns only when the observed design is inconsistent, confusing, or unsupported by the product. Prefer the existing brand, components, and dependencies when they work.
- Keep layout, controls, and copy specific to the resident's task. Make sure each action explains what happens next when that is not already clear.
- Preserve responsive behavior and accessibility, including semantic structure, keyboard operation, visible focus, readable contrast, useful labels, and reduced-motion preferences where relevant.
- Apply shared changes consistently to the affected screens, but do not expand the scope to unrelated screens simply to make everything look alike.

Implementation safety rules:
- Change only the exact files and findings approved by me. If implementation reveals that another file or a broader change is needed, stop and request approval before touching it.
- Make small, reviewable edits. Before each edit, confirm the target file still matches the version inspected; if it changed, stop and ask rather than overwriting it.
- Do not run auto-formatters or bulk-edit tools across unapproved files. Do not stage, commit, deploy, delete, rename, or move files.
- Do not run tests or commands that may modify databases, uploads, user data, generated assets, or other project state unless their effects are known and necessary; explain the risk and get approval first.
- If a check fails or a regression appears, stop, report it, and propose a repair. Do not conceal the failure or perform a broad rollback. Never discard pre-existing or concurrent changes.

Hard product boundaries:
- Do not change routes, workflows, permissions, authentication, report submission, report status/history, API contracts, data handling, storage, or integrations.
- Do not remove, weaken, or obscure error handling, privacy disclosures, notices, safety information, or accessibility behavior.
- Do not invent municipal or government partnerships, endorsements, response guarantees, service coverage, users, testimonials, impact metrics, or capabilities. Do not imply official government affiliation unless the product already verifies and states it.
- Do not add dependencies, replace the design system, or rewrite whole pages for stylistic preference. Avoid unrelated refactors and leave unrelated files untouched.
- Do not introduce a meaningful user-visible behavior change. If a proposed improvement requires one, it is out of scope unless separately explained and explicitly approved.

After approved edits:
1. Review the final status and diff against the baseline. Confirm every changed line belongs to an approved finding and file; call out any unexpected change and stop.
2. Check the edited screens at relevant narrow and wide viewports if practical. Verify the main report and follow-up flows remain intact. Run only safe, relevant checks. Report exactly what was and was not verified; never claim tests, visual checks, or runtime behavior passed if they were not checked.
3. Finish with:
   - a brief audit table showing each finding and the fix made (or why a suggested fix was not made);
   - a prioritized list of files changed and the reason for each;
   - any approved findings intentionally left unchanged, with the reason;
   - an explicit statement of which product behavior and claims were preserved;
   - checks run and their actual results;
   - remaining concerns or unverified items.

If you cannot find evidence-backed, worthwhile improvements that fit these boundaries, say so and leave the code unchanged. Do not manufacture findings to justify edits. No prompt can guarantee zero risk; when uncertain, stop before making a change and ask me.
```
