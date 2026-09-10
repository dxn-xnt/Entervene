import { useEffect } from "react";
import { Home, RefreshCw, Wrench, Unplug, MapPinOff } from "lucide-react";
import { Button } from "@/components/retroui/Button";

const states = {
  maintenance: { icon: Wrench, code: "503", label: "Scheduled maintenance", title: "Under maintenance", description: "Entervene is temporarily under maintenance. Please check back in a little while to continue." },
  unavailable: { icon: Unplug, code: "503", label: "Temporarily unavailable", title: "Temporarily unavailable", description: "Entervene is unavailable right now. Please try again in a few minutes." },
  error: { icon: Unplug, code: "500", label: "Something went wrong", title: "Something went wrong", description: "We couldn’t display this page. Try reloading, or head home and start again." },
  "not-found": { icon: MapPinOff, code: "404", label: "Page not found", title: "Page not found", description: "The link may have changed, or the address might have a typo. Let’s get you back to familiar ground." },
} as const;

export default function StatusPage({ variant = "error" }: { variant?: keyof typeof states }) {
  const state = states[variant];
  const Icon = state.icon;
  useEffect(() => {
    const previous = document.title;
    document.title = `${state.label} | Entervene`;
    return () => { document.title = previous; };
  }, [state.label]);

  return (
    <div className="status-shell retro-squares-bg">
      <header className="status-header"><a className="status-brand" href="/">ENTERVENE</a></header>
      <main className="status-main">
        <section className="status-panel" aria-labelledby="status-title">
          <div className="status-content">
            <div className="status-art" aria-hidden="true"><span className="status-code">{state.code}</span><span className="status-icon"><Icon size={32} strokeWidth={2} /></span></div>
            <h1 id="status-title">{state.title}</h1>
            <p className="status-description">{state.description}</p>
            <div className="status-actions">
              {variant !== "not-found" && <Button autoIcon={false} className="status-action" onClick={() => window.location.reload()}><RefreshCw size={17} aria-hidden="true" />Try again</Button>}
              <Button asChild variant={variant === "not-found" ? "default" : "outline"} className="status-action"><a href="/"><Home size={17} aria-hidden="true" />Back to home</a></Button>
            </div>
          </div>
        </section>
      </main>
      <footer className="status-footer">Medellin National Science and Technology School<span>Ad Astra.</span></footer>
    </div>
  );
}
