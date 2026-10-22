import { useEffect, useState } from "react";
import { ArrowRight, Camera, Download, Eye, MapPin } from "lucide-react";
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
          <p className="eyebrow">A simple way to help your community</p>
          <h1>See it. Snap it. Help fix it.</h1>
          <p className="landing-lede">
            Send a non-emergency local issue to a configured organization, then follow its recorded status and updates.
          </p>
          <div className="button-row landing-actions">
            <Link className="button primary" to="/reports/new">
              Report an issue <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <InstallAction />
          </div>
          <p className="muted">No account is needed to send a report. Save the secure link to follow it later.</p>
          {setupRequired && <p className="warning" role="status">This community still needs an administrator to configure report categories before reports can be sent.</p>}
          <p className="landing-signin"><Link to="/signin">Already have an account? Sign in</Link></p>
        </div>
        <div className="landing-panel" aria-label="How CivicSignal works">
          <div className="landing-panel-heading">
            <span className="landing-mark"><Camera aria-hidden="true" size={20} /></span>
            <div>
              <span className="reference">THREE SIMPLE STEPS</span>
              <strong>Help staff understand what needs attention</strong>
            </div>
          </div>
          <ol className="journey-list">
            <li><span>1</span><div><strong>Show the issue</strong><small>Choose a photo if it helps. A photo is optional.</small></div></li>
            <li><span>2</span><div><strong>Confirm where it is</strong><small>Use your location or enter an address or landmark.</small></div></li>
            <li><span>3</span><div><strong>Follow what happens</strong><small>Save your reference and secure tracking link.</small></div></li>
          </ol>
          <div className="landing-panel-foot"><Eye aria-hidden="true" size={16} /> Reports are shared with the configured receiving organization and authorized staff.</div>
        </div>
      </div>

      <div className="landing-value-grid">
        <article className="card landing-value">
          <MapPin aria-hidden="true" size={22} />
          <h2>Send it to the right place</h2>
          <p>Each report category is connected to an organization configured by the local CivicSignal administrator.</p>
        </article>
        <article className="card landing-value">
          <Eye aria-hidden="true" size={22} />
          <h2>Keep a clear record</h2>
          <p>See the current status, the organization responsible, and updates recorded by authorized staff.</p>
        </article>
      </div>

      <aside className="emergency-notice landing-notice" role="note">
        <strong>Not an emergency service.</strong>
        <span>CivicSignal is not monitored for urgent situations and does not guarantee a response. If someone is in immediate danger, call 911. For urgent local service, contact the responsible organization directly.</span>
      </aside>
      <p className="landing-disclaimer">
        CivicSignal is an independent, nonpartisan community-reporting service. It is not a government service and does not connect to municipal 311 systems or government records. Only organizations explicitly configured for this deployment can receive reports.
      </p>
    </section>
  );
}
