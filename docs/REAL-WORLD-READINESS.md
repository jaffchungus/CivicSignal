# CivicSignal deployment readiness

This repository contains a working report-to-staff workflow, but it is not configured for automatic municipal jurisdiction or email/text delivery. Account holders can opt in to browser push alerts on supported devices; the app does not substitute guessed locations, fabricated staff coverage, or pretend messages.

## Configure the existing report workflow

1. Complete first-run setup to create the deployment administrator.
2. In Administration, create the real receiving organizations and issue categories. Each category is routed to the organization selected by the administrator.
3. Register staff accounts and verify each person into the correct organization. A verified staff member may claim a report; only members of that organization can act on its queue.
4. Publish the operator identity, a verified organization contact route, applicable privacy terms, and a retention policy before inviting real residents.

When a resident submits a report, CivicSignal records the category, receiving organization, status, report history, and optional photo. A guest report returns a random access token once. The browser places it in a URL fragment so it is not sent with ordinary page or referrer requests; report and photo API reads require the token in a request header. The database stores only the token hash. Guest links expire after 90 days. Administrator removal makes the report and its photos inaccessible through the guest link as well. The report and photo themselves are not automatically deleted.

## Provider and operational configuration still required

| Capability | Current behavior | Required setup before enabling |
| --- | --- | --- |
| Municipality and service-area routing | Unavailable. Gemini selects an active configured category from the photo; CivicSignal sends it to that category's configured organization. The app does not infer a municipality from free text. | Implement a `JurisdictionAdapter` in `server/jurisdiction.ts` for a selected geocoding/boundary provider, provide authoritative service-area polygons and organization coverage, and add administrator management for that data. Ambiguous and unmapped results must enter staff review. |
| Exact GPS pin | Available when the resident grants location permission. Coordinates are saved with the private report independently of the optional address lookup and are visible only to the reporter, receiving organization's active staff, and administrators. | Configure the address lookup provider deliberately. The public Nominatim service is rate-limited and must be switchable; set an identifiable app origin/contact, show its attribution and policy, and use a suitable provider before broad public use. |
| Photo classification or AI routing | When the server-only `GEMINI_API_KEY` is set, selecting a photo automatically sends it for classification with `gemini-3-flash-preview`; `DISABLE_GEMINI_PHOTO_ANALYSIS=true` turns classification off and prevents report submission. Gemini selects an active configured category, and its mapped organization receives the report. CivicSignal's Terms state an adult-only intended audience, based on the product owner's direction. | Before launch, verify actual audience, operator/API account age, and purpose meet Google's current [Gemini API terms](https://ai.google.dev/gemini-api/terms?hl=en), which disallow API clients likely to be accessed by under-18s and specify professional/business purpose. The adult-only Terms statement is not age verification or proof of eligibility. Keep the key private and clearly tell residents that selecting a photo sends it to Gemini for classification. |
| Staff availability, skills, workload, and proximity assignment | Unavailable. Verified staff can claim a report from their organization's queue; CivicSignal does not claim who is on duty. | Configure and maintain verified staff coverage, skills, and availability before automated assignment. |
| Duplicate detection and nearby confirmations | Unavailable. Reports are not blocked by a similarity score, and resident coordinates are not shared as public confirmation data. | Implement category, location, time, status, and report-detail matching with resident override; configure a confirmation radius, expiry, and rate limit before collecting aggregate confirmations. |
| Background phone and computer alerts | Available through opt-in Web Push. VAPID keys are persisted in the database unless configured explicitly. Delivery still depends on browser permission, device support, network availability, and the browser's push service. Guest reporters revisit by secure link. | Set `WEB_PUSH_SUBJECT` to a real operator URL or contact email, use HTTPS, test each supported browser/device, and keep in-app notification history available as the record of delivery-independent events. On iOS/iPadOS 16.4 or later, users must add the web app to their Home Screen. |
| Email or text notifications | Unavailable. | Connect a real provider, verify sender identity and organization contact routes, add explicit opt-in preferences, and show delivery states only after provider confirmation. |
| Review estimates and overdue follow-up | Unavailable. The report detail page gives status guidance and the last-update time but no deadline or external contact claim. | Configure a real review window and verified contact route per organization. |
| Community impact metrics | Verified staff can see organization-scoped report counts, median time to first staff review, median age of open reports, exact normalized category/location repeat groups, and still-happening confirmations. No public metrics or municipality/category breakdown is exposed. | Review the definitions, time range, source, and submitted-versus-verified distinction before sharing or adding any public aggregate. |
| Automated retention and resident deletion | Unavailable. Guest access expires after 90 days; report records, photos, and account records have no automated deletion schedule. | Set an operator-approved retention schedule and implement deletion/archival behavior across both database adapters and photo storage. |

The adapter contract in `server/jurisdiction.ts` is a typed seam only. No geocoder, boundary dataset, staff schedule, email/text sender, or municipal integration is bundled or claimed as operational. Gemini photo classification becomes available when a server key is configured, unless the disable switch is set; the public routing-readiness API and report form identify when it is unavailable. Classification is required for report submission, and the selected category's administrator-configured organization receives the report.

## Privacy and safety checks before launch

- Keep photo storage private and verify provider-side settings, including legacy object migration.
- Confirm the receiving organization has an authorized staff account before routing real reports.
- Set a retention schedule and publish who operates the deployment and how residents can contact that operator.
- Keep the emergency warning visible. This service is not monitored for urgent response and is not a substitute for 911 or the receiving organization's urgent contact channel.
- Do not present a submitted report or an authorized status update as independently verified damage or completed government work.
