import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/retroui/Button";

type Usage = {
  enabled: boolean;
  configured: boolean;
  reserved_usd: number;
  monthly_budget_usd: number;
  calls_today: number;
  budget_alert: boolean;
  provider_alert: boolean;
  burst_alert: boolean;
};

export function AIUsageCard() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    apiFetch("/api/v1/ai/usage", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("AI usage information is unavailable. Contact your system administrator.");
        return response.json() as Promise<Usage>;
      })
      .then((data) => { if (!controller.signal.aborted) setUsage(data); })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load AI usage.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  // Hide the entire card when AI is not configured (no API keys set)
  if (usage && !usage.configured) return null;

  return (
    <section className="border-2 border-black bg-white p-5 space-y-3" aria-label="AI usage">
      <h2 className="text-lg font-semibold">AI usage and budget</h2>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {usage && !error && <>
        <p>{usage.enabled ? "AI generation enabled" : "AI generation paused"} · {usage.calls_today} provider attempts today</p>
        <p>${usage.reserved_usd.toFixed(2)} reserved of ${usage.monthly_budget_usd.toFixed(2)} monthly allowance.</p>
        <p className="text-sm">Reservations include failed attempts and are higher than estimated charges. Check the provider dashboard for your actual bill. This view updates when opened or refreshed.</p>
        {usage.budget_alert && <p role="alert" className="text-red-700">At least 80% of the AI allowance is reserved. Generation stops when the allowance is exhausted.</p>}
        {usage.provider_alert && <p role="alert" className="text-red-700">Repeated provider errors detected. AI requests are temporarily paused.</p>}
        {usage.burst_alert && <p role="alert" className="text-red-700">AI requests are approaching the school’s per-minute limit. Check for repeated generation attempts.</p>}
      </>}
      <Button disabled={loading} onClick={() => setRevision((value) => value + 1)}>
        {loading ? "Loading usage…" : "Refresh AI usage"}
      </Button>
    </section>
  );
}
