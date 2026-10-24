import { Link } from "react-router-dom";

export function AboutPage() {
  return (
    <article className="card legal-page">
      <p className="eyebrow">Project overview · 2026 Congressional App Challenge, NJ-05</p>
      <h1>About this civic app</h1>
      <p className="muted">
        This civic app helps solve community issues by making it easy to report non-emergency problems. A resident can submit a report to an organization configured for the selected category, then view the status and updates recorded in the app.
      </p>

      <h2>Who it is for</h2>
      <p>
        The intended users are residents of a community whose deployment has configured receiving organizations, and the authorized staff who record report updates. The application does not identify a resident’s municipality or determine which agency has jurisdiction.
      </p>

      <h2>Competition and service area</h2>
      <p>
        The NJ-05 label is the Congressional App Challenge district, not a claim that CivicSignal serves every town in that district. NJ-05 includes parts of Bergen, Passaic, and Sussex Counties. This app does not check congressional-district or municipal boundaries; any service area depends on the organizations configured by a deployment operator.
      </p>

      <h2>How it works</h2>
      <ul>
        <li><strong>Choose:</strong> The resident selects an active category. A deployment administrator has already connected that category to a receiving organization.</li>
        <li><strong>Submit:</strong> The current form requires a photo, location, and category. A guest can submit without creating an account and receives a private link to save.</li>
        <li><strong>Follow the history:</strong> Residents see the report status, recorded timeline, and updates entered by authorized accounts. Each event shows who acted and when.</li>
        <li><strong>Understand the record:</strong> A status such as “Resolved” reflects what staff recorded in CivicSignal. It is not an independent inspection or proof that a public agency completed work.</li>
      </ul>

      <h2>Automatic AI description</h2>
      <p>
        When the deployment has configured Gemini photo analysis, the app automatically generates a description when a photo is selected. The AI also detects and blocks spam images. If photo analysis is unavailable, report details can be entered manually.
      </p>

      <p>
        If a resident uses device location to fill in an address, the device coordinates are sent to the configured address lookup provider. The returned address is editable. On submission, the report location and photo are shared with the configured receiving organization and authorized CivicSignal staff. See the <Link to="/privacy">privacy notice</Link> for details.
      </p>

      <h2>Scope and limits</h2>
      <ul>
        <li>CivicSignal is not affiliated with or endorsed by Representative Gottheimer, his office, a municipality, or a government agency.</li>
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
