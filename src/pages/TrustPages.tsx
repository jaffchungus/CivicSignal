import { Link } from "react-router-dom";

export function PrivacyPage() {
  return (
    <article className="card legal-page">
      <p className="eyebrow">CivicSignal · plain-language notice</p>
      <h1>Privacy</h1>
      <p className="muted">This notice describes the application code in this project. A deployment operator must publish its identity, contact details, hosting providers, and retention policy before inviting the public to submit real reports.</p>

      <h2>Information the app stores</h2>
      <ul>
        <li>Account display name and email address. Passwords are stored as password hashes, not as readable passwords.</li>
        <li>A session cookie in your browser; the server stores a hash of the session token and an expiry time.</li>
        <li>Report issue type, optional summary and details, exact location, status history, official updates, and related notifications.</li>
        <li>An optional photo, if you choose to upload one. Text drafts are stored in this browser; selected photos are not saved in drafts.</li>
        <li>If photo suggestions are available, a selected photo may be sent to an external image-processing service to prepare suggested report details, even if you cancel before submitting. Avoid sensitive information in photos.</li>
        <li>If you use the current-location button, your device coordinates are sent to the configured address lookup service to find a readable address. The coordinates are not included in the report; the returned address is editable before submission.</li>
        <li>For a report sent without an account, a random secure tracking token is issued. The server stores only its hash. The link grants access to that report for 90 days.</li>
      </ul>

      <h2>Who can see a report</h2>
      <p>Account holders can see their own reports. A guest report can be viewed by anyone with its private tracking link. Active staff in the configured receiving organization and administrators can access reports for their work. Reports are not listed publicly. Photos and exact locations are shared with those authorized viewers. Account display names appear on account reports; CivicSignal does not ask for contact details on guest reports, and staff report views do not include account email addresses.</p>

      <h2>Updates and contact</h2>
      <p>Account holders receive in-app notifications. Guest reporters follow updates through their private tracking link. This deployment has no configured email or text-message sender, so it does not send those notifications or collect contact details for that purpose.</p>

      <h2>Storage and retention</h2>
      <p>The application writes account and report records to the deployment's configured database. Guest tracking tokens expire after 90 days; report data and photos do not have an automatic deletion schedule in this project. Photos use the configured private storage provider, with a private database-backed fallback. Older deployments may contain legacy public Blob objects; those objects need a provider-side migration before they can be treated as private. This project does not implement account deletion or a resident self-service report deletion tool.</p>

      <h2>Before using a live deployment</h2>
      <p>The current public page does not name a deployment operator or provide a support contact. Until the operator publishes that information and confirms the applicable retention and storage settings, do not submit sensitive personal information, images of people, license plates, or information about emergencies.</p>
      <p>For emergencies, call 911. CivicSignal is not an emergency service and does not guarantee that a configured organization will respond.</p>
      <p><Link to="/terms">Read the terms and limitations</Link>.</p>
    </article>
  );
}

export function TermsPage() {
  return (
    <article className="card legal-page">
      <p className="eyebrow">CivicSignal · plain-language notice</p>
      <h1>Terms and limitations</h1>
      <p>CivicSignal is an independent, nonpartisan community-reporting project. It is not a government agency, 311 service, or official public record, and no government endorsement or integration is represented.</p>

      <h2>Use it for non-emergency issues only</h2>
      <p>CivicSignal is not continuously monitored and cannot dispatch emergency help. If someone is in immediate danger, call 911. For urgent local service, use the responsible organization's established public contact channels.</p>

      <h2>How routing and status work</h2>
      <p>Reports are routed only to organizations and categories configured by the operator of a particular deployment. Statuses and updates show what an authorized CivicSignal account recorded. A status such as “Resolved” is not an independent inspection or a guarantee that a government agency completed work.</p>

      <h2>Share only information needed to explain the issue</h2>
      <p>Do not submit passwords, financial or medical information, private documents, or other sensitive personal information. Avoid photos that show faces, license plates, or identifying details. Administrators may moderate reports that are inappropriate or no longer part of the workflow.</p>

      <h2>Operator and support</h2>
      <p>This deployment does not currently publish a named operator or a support contact. The operator should add those details and review deployment-specific privacy, retention, and service terms before opening the service to real community reports.</p>
      <p><Link to="/privacy">Read the privacy notice</Link>.</p>
    </article>
  );
}
