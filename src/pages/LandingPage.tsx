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
          <p className="eyebrow">Congressional App Challenge Participant</p>
          <h1>Report a local issue. Follow its updates.</h1>
          <p className="landing-lede">
            Send a non-emergency report to an organization configured for this community. Come back here to see any updates its staff record.
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
              <h3>Choose what needs attention</h3>
              <p>Pick from the categories available in this community. Each one is connected to a receiving organization by an administrator.</p>
            </div>
          </li>
          <li>
            <span className="landing-step-number">02</span>
            <div>
              <h3>Send the details</h3>
              <p>Submit a required photo and description, plus location. If enabled, an AI suggestion can help draft the description for you to review.</p>
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
