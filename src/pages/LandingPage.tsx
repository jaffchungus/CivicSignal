import { useEffect, useState } from "react";
import { ArrowRight, Download, Eye, MapPin } from "lucide-react";
import { Link } from "react-router-dom";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function InstallAction() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const installedEvent = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installedEvent);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installedEvent);
    };
  }, []);

  async function install() {
    if (!installPrompt) {
      setShowInstructions((visible) => !visible);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  }

  const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return (
    <div className="install-action">
      <button className="button" type="button" onClick={() => void install()}>
        <Download aria-hidden="true" size={17} />
        {installed ? "CivicSignal is installed" : "Install CivicSignal"}
      </button>
      {showInstructions && (
        <p className="install-help" role="status">
          {isAppleMobile
            ? "In Safari, tap Share, then Add to Home Screen."
            : "In your browser menu, choose Install app or Add to Home screen if that option is available."}
          {" "}This adds a shortcut to this website; it is not an app-store installation.
        </p>
      )}
    </div>
  );
}

export function LandingPage({ setupRequired }: { setupRequired: boolean }) {
  return (
    <section className="landing">
      <div className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">Non-emergency community reporting</p>
          <h1>Submit an issue. Follow the record.</h1>
          <p className="landing-lede">
            Choose a category, describe the issue, and see the status changes, official updates, and action history recorded for your report.
          </p>
          <div className="button-row landing-actions">
            <Link className="button primary" to="/reports/new">
              Report an issue <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <InstallAction />
          </div>
          <p className="muted">No account is required. Save the private tracking link to return to a guest report.</p>
          {setupRequired && <p className="warning" role="status">This community still needs an administrator to configure report categories before reports can be sent.</p>}
          <p className="landing-signin"><Link to="/signin">Already have an account? Sign in</Link></p>
        </div>
        <div className="landing-panel" aria-label="How CivicSignal works">
          <div className="landing-panel-heading">
            <span className="landing-mark"><Eye aria-hidden="true" size={20} /></span>
            <div>
              <span className="reference">REPORT → RECORDED UPDATE</span>
              <strong>Follow the record in one place</strong>
            </div>
          </div>
          <ol className="journey-list">
            <li><span>1</span><div><strong>Choose a category</strong><small>An administrator connects each category to a receiving organization.</small></div></li>
            <li><span>2</span><div><strong>Submit your report</strong><small>This version requires a photo. Enter the details yourself, or request optional AI suggestions if configured.</small></div></li>
            <li><span>3</span><div><strong>Follow the history</strong><small>See status changes, official updates, and who recorded each action—all in one place.</small></div></li>
          </ol>
          <div className="landing-panel-foot"><Eye aria-hidden="true" size={16} /> A “Resolved” status is what staff recorded; CivicSignal does not independently inspect the work.</div>
        </div>
      </div>

      <div className="landing-value-grid">
        <article className="card landing-value">
          <MapPin aria-hidden="true" size={22} />
          <h2>Routing is configured, not guessed</h2>
          <p>Residents choose an issue category. An administrator maps each category to an organization; CivicSignal does not infer a town or connect to 311.</p>
        </article>
        <article className="card landing-value">
          <Eye aria-hidden="true" size={22} />
          <h2>A history residents can follow</h2>
          <p>See the report status, timestamped history, and updates recorded by authorized accounts. The record is not a government record or a response guarantee.</p>
        </article>
      </div>

      <aside className="emergency-notice landing-notice" role="note">
        <strong>Not an emergency service.</strong>
        <span>CivicSignal is not monitored for urgent situations and does not guarantee a response. If someone is in immediate danger, call 911. For urgent local service, contact the responsible organization directly.</span>
      </aside>
      <p className="landing-disclaimer">
        CivicSignal is an independent prototype, not a government service or a municipal 311 integration. Only organizations explicitly configured for a deployment can receive reports; no government endorsement or response is implied.
      </p>
    </section>
  );
}
