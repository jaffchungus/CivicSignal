import { Link } from "react-router-dom";

export function AboutPage() {
  return (
    <article className="card legal-page">
      <p className="eyebrow">Project overview</p>
      <h1>About this civic app</h1>
      <p className="muted">
        This civic app helps solve community issues by making it easy to report non-emergency problems. A resident can submit a report to an organization configured for the selected category, then view the status and updates recorded in the app.
      </p>

      <h2>Who it is for</h2>
      <p>
        The intended users are residents of a community whose deployment has configured receiving organizations, and the authorized staff who record report updates. The application does not identify a resident’s municipality or determine which agency has jurisdiction.
      </p>

      <h2>Service area and scope</h2>
      <p>
        CivicSignal does not check municipal, county, or congressional-district boundaries. Any service area depends on
        the organizations and categories configured by the deployment operator. A report goes only to the configured
        organization connected to the category the resident chooses.
      </p>

      <h2>How it works</h2>
      <ul>
        <li><strong>Choose:</strong> The resident selects an active category. A deployment administrator has already connected that category to a receiving organization.</li>
        <li><strong>Submit:</strong> The form requires a title, description, location, and category. A photo is optional. A guest can submit without creating an account and receives a private link to save.</li>
        <li><strong>Follow the history:</strong> Residents see the report status, recorded timeline, and updates entered by authorized accounts. Each event shows who acted and when.</li>
        <li><strong>Get alerted:</strong> Account holders can opt in to phone or computer notifications for report activity on supported browsers.</li>
        <li><strong>Understand the record:</strong> A status such as “Resolved” reflects what staff recorded in CivicSignal. It is not an independent inspection or proof that a public agency completed work.</li>
      </ul>

      <h2>Optional AI suggestions</h2>
      <p>
        When the deployment has configured Gemini photo analysis, choosing a photo can produce an editable category,
        title, and description suggestion. The resident can change every field or ignore the suggestion. The AI is not
        required: reports can be submitted with text only, and the resident always chooses the final category.
      </p>

      <p>
        If a resident uses device location, the exact GPS pin is saved with the report and shared with the configured receiving organization and authorized staff. Coordinates are also sent to the configured address lookup provider only when the app tries to suggest a readable address. A lookup failure does not discard the pin. See the <Link to="/privacy">privacy notice</Link> for details.
      </p>

      <p>
        Account holders can enable browser notifications from the Notifications page. The browser asks for permission, and system alerts can arrive while the site is closed on supported devices. On iPhone and iPad, add CivicSignal to the Home Screen first.
      </p>

      <h2>Scope and limits</h2>
      <ul>
        <li>CivicSignal is an independent project and is not affiliated with or endorsed by a municipality or government agency.</li>
        <li>It does not connect to 311, government records, or municipal service-area data.</li>
        <li>Receiving organizations, categories, and staff must be configured by each deployment operator. This project does not verify that a configured organization is a government agency.</li>
        <li>It does not guarantee that a report will be read or answered, and it is not an emergency channel. Use the responsible organization’s established contact method for urgent local service; call 911 for emergencies.</li>
        <li>Guest tracking links expire after 90 days, but this project has no automatic deletion schedule for report records and photos.</li>
      </ul>

      <h2>Technology</h2>
      <p>
        The web app uses React and TypeScript with an Express API. Local development uses SQLite; configured production deployments can use PostgreSQL. Photo analysis is an optional server-side integration, not a requirement for choosing a category or routing a report.
      </p>

      <p className="muted">
        <Link to="/privacy">Read our privacy policy</Link> · <Link to="/terms">Read terms and limitations</Link>
      </p>
    </article>
  );
}
