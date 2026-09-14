import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Progress } from "@/components/retroui/Progress";

type StaffUsage = {
  used_today: number;
  daily_limit: number;
  enabled: boolean;
  configured: boolean;
};

/**
 * Compact sidebar widget showing the teacher's personal AI credit usage.
 * Hidden entirely when AI is not configured (no provider API keys set).
 */
export function AICreditsWidget() {
  const [usage, setUsage] = useState<StaffUsage | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/v1/ai/my-usage", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return;
        return res.json() as Promise<StaffUsage>;
      })
      .then((data) => {
        if (data && !controller.signal.aborted) setUsage(data);
      })
      .catch(() => {
        /* silently ignore — widget is non-critical */
      });
    return () => controller.abort();
  }, []);

  // Don't render anything if we haven't loaded, AI is unconfigured, or disabled
  if (!usage || !usage.configured || !usage.enabled) return null;

  const remaining = Math.max(0, usage.daily_limit - usage.used_today);
  const pct = Math.round((remaining / usage.daily_limit) * 100);

  return (
    <div className="px-3 pb-2" aria-label="AI credits remaining">
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles className="size-3.5 text-amber-500 shrink-0" />
        <span className="text-xs font-semibold tracking-tight">
          AI: {remaining}/{usage.daily_limit}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {remaining === 0 ? "resets daily" : "credits left"}
        </span>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}
