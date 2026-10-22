# CivicSignal deployment readiness

This repository contains a working report-to-staff workflow, but it is not yet configured for automatic municipal jurisdiction or external notifications. The app reports those capabilities as unavailable; it does not substitute guessed locations, fabricated staff coverage, or pretend messages.

## Configure the existing report workflow

1. Complete first-run setup to create the deployment administrator.
2. In Administration, create the real receiving organizations and issue categories. Each category is routed to the organization selected by the administrator.
3. Register staff accounts and verify each person into the correct organization. A verified staff member may claim a report; only members of that organization can act on its queue.
4. Publish the operator identity, a verified organization contact route, applicable privacy terms, and a retention policy before inviting real residents.

When a resident submits a report, CivicSignal records the category, receiving organization, status, report history, and optional photo. A guest report returns a random access token once. The browser places it in a URL fragment so it is not sent with ordinary page or referrer requests; report and photo API reads require the token in a request header. The database stores only the token hash. Guest links expire after 90 days. The report and photo themselves are not automatically deleted.

## Provider and operational configuration still required

| Capability | Current behavior | Required setup before enabling |
| --- | --- | --- |
| Municipality and service-area routing | Unavailable. The resident selects a category; CivicSignal sends it to that category's configured organization. The app does not infer a municipality from free text. | Implement a `JurisdictionAdapter` in `server/jurisdiction.ts` for a selected geocoding/boundary provider, provide authoritative service-area polygons and organization coverage, and add administrator management for that data. Ambiguous and unmapped results must enter staff review. |
| Photo classification or AI routing | Unavailable. The resident chooses an editable category; no image facts or AI decisions are generated. | Configure a real provider behind an adapter and limit outputs to configured categories and service areas. Persist recommendation confidence/reason and require staff review for low confidence. |
| Staff availability, skills, workload, and proximity assignment | Unavailable. Verified staff can claim a report from their organization's queue; CivicSignal does not claim who is on duty. | Configure and maintain verified staff coverage, skills, and availability before automated assignment. |
| Duplicate detection and nearby confirmations | Unavailable. Reports are not blocked by a similarity score, and resident coordinates are not shared as public confirmation data. | Implement category, location, time, status, and report-detail matching with resident override; configure a confirmation radius, expiry, and rate limit before collecting aggregate confirmations. |
| Email or text notifications | Unavailable. Account holders receive in-app notifications. Guest reporters revisit by secure link. | Connect a real provider, verify sender identity and organization contact routes, add explicit opt-in preferences, and show delivery states only after provider confirmation. |
| Review estimates and overdue follow-up | Unavailable. The report detail page gives status guidance and the last-update time but no deadline or external contact claim. | Configure a real review window and verified contact route per organization. |
| Community impact metrics | Verified staff can see organization-scoped report counts, median time to first staff review, median age of open reports, exact normalized category/location repeat groups, and still-happening confirmations. No public metrics or municipality/category breakdown is exposed. | Review the definitions, time range, source, and submitted-versus-verified distinction before sharing or adding any public aggregate. |
| Automated retention and resident deletion | Unavailable. Guest access expires after 90 days; report records, photos, and account records have no automated deletion schedule. | Set an operator-approved retention schedule and implement deletion/archival behavior across both database adapters and photo storage. |

The adapter contract in `server/jurisdiction.ts` is a typed seam only. No geocoder, boundary dataset, AI provider, staff schedule, email/text sender, or municipal integration is bundled or claimed as operational. The public routing-readiness API and report form identify unavailable features explicitly.

## Privacy and safety checks before launch

- Keep photo storage private and verify provider-side settings, including legacy object migration.
- Confirm the receiving organization has an authorized staff account before routing real reports.
- Set a retention schedule and publish who operates the deployment and how residents can contact that operator.
- Keep the emergency warning visible. This service is not monitored for urgent response and is not a substitute for 911 or the receiving organization's urgent contact channel.
- Do not present a submitted report or an authorized status update as independently verified damage or completed government work.
