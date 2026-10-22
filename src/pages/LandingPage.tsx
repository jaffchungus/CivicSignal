import { ArrowRight, ClipboardList, Eye, MapPin } from "lucide-react";
import { Link } from "react-router-dom";

export function LandingPage({ setupRequired }: { setupRequired: boolean }) {
  const startPath = setupRequired ? "/setup" : "/signup";

  return (
    <section className="landing">
      <div className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">Community reports, with follow-through</p>
          <h1>Report a neighborhood issue. See what happens next.</h1>
          <p className="landing-lede">
            CivicSignal helps residents send non-emergency issues to the organizations
            configured for this community, then follow recorded status changes and
            official updates in one place.
          </p>
          <div className="button-row landing-actions">
            <Link className="button primary" to={startPath}>
              {setupRequired ? "Set up this community" : "Create a resident account"}
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <Link className="button" to="/signin">Sign in</Link>
          </div>
        </div>
        <div className="landing-panel" aria-label="CivicSignal report journey">
          <div className="landing-panel-heading">
            <span className="landing-mark"><MapPin aria-hidden="true" size={20} /></span>
            <div>
              <span className="reference">REPORT JOURNEY</span>
              <strong>One clear record, from report to response</strong>
            </div>
          </div>
          <ol className="journey-list">
            <li><span>1</span><div><strong>Describe the issue</strong><small>Add the location and details that help staff act.</small></div></li>
            <li><span>2</span><div><strong>Follow the recorded status</strong><small>See when the organization changes the report.</small></div></li>
            <li><span>3</span><div><strong>Read official updates</strong><small>Understand what changed and what comes next.</small></div></li>
          </ol>
          <div className="landing-panel-foot"><Eye aria-hidden="true" size={16} /> Report details are limited to authorized accounts.</div>
        </div>
      </div>

      <div className="landing-value-grid">
        <article className="card landing-value">
          <ClipboardList aria-hidden="true" size={22} />
          <h2>A report with a history</h2>
          <p>Each report keeps its status changes, the official who recorded them, and any updates together.</p>
        </article>
        <article className="card landing-value">
          <MapPin aria-hidden="true" size={22} />
          <h2>Routed by configured categories</h2>
          <p>An administrator connects issue categories to organizations for this deployment. CivicSignal does not assume every town uses the same setup.</p>
        </article>
      </div>

      <aside className="emergency-notice landing-notice" role="note">
        <strong>Not an emergency service.</strong>
        <span>CivicSignal is not monitored for urgent situations and does not guarantee a response. If someone is in immediate danger, call 911. For urgent or time-sensitive local service, contact the responsible organization directly.</span>
      </aside>
      <p className="landing-disclaimer">
        CivicSignal is an independent, nonpartisan project. It is not a government service,
        and this application does not connect to municipal 311 systems or government records.
        Only organizations explicitly configured by the deployment operator can receive reports.
      </p>
    </section>
  );
}
