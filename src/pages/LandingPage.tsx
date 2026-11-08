import { useEffect, useState } from "react";
import { ArrowRight, Download } from "lucide-react";
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
      <button className="install-button" type="button" onClick={() => void install()}>
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
          <h1>Report a local issue. Follow its updates.</h1>
          <p className="landing-lede">
            Send a photo and your location. AI identifies the issue, writes the report, and routes it to the right organization and staff member. Come back here to see any updates they record.
          </p>
          <div className="button-row landing-actions">
            <Link className="button primary" to="/reports/new">
              Start a report <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <InstallAction />
          </div>
          <p className="landing-note">No account needed. Keep the private tracking link to return to a guest report.</p>
          {setupRequired && <p className="warning" role="status">This community still needs an administrator to configure report categories before reports can be sent.</p>}
          <p className="landing-signin"><Link to="/signin">Already have an account? Sign in</Link></p>
        </div>
      </div>

      <section className="landing-process" aria-labelledby="process-title">
        <div className="landing-process-heading">
          <span className="eyebrow">What to expect</span>
          <h2 id="process-title">A report, then a record of what happens.</h2>
        </div>
        <ol className="landing-steps">
          <li>
            <span className="landing-step-number">01</span>
            <div>
              <h3>Take one photo</h3>
              <p>Show the problem. AI identifies the issue and writes the title and description, so there are no long fields to fill in.</p>
            </div>
          </li>
          <li>
            <span className="landing-step-number">02</span>
            <div>
              <h3>Attach your location</h3>
              <p>Tap the location button and send. CivicSignal routes the report to the right organization and the nearest available verified staff member.</p>
            </div>
          </li>
          <li>
            <span className="landing-step-number">03</span>
            <div>
              <h3>Check for an update</h3>
              <p>See timestamped status changes and notes recorded by authorized staff. CivicSignal does not independently verify completed work.</p>
            </div>
          </li>
        </ol>
      </section>

      <aside className="emergency-notice landing-notice" role="note">
        <strong>Not an emergency service.</strong>
        <span>CivicSignal is not monitored for urgent situations and does not guarantee a response. If someone is in immediate danger, call 911. For urgent local service, contact the responsible organization directly.</span>
      </aside>
      <p className="landing-disclaimer">
        CivicSignal is an independent prototype, not a government service or municipal 311 integration. Reports go only to organizations configured for this deployment; no government endorsement or response is implied.
      </p>
    </section>
  );
}
