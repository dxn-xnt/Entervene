import type { RiskSummary } from "@/lib/prediction-api";
import { Card } from "@/components/retroui/Card";
import {
  AlertTriangle,
  Eye,
  ShieldCheck,
  ShieldAlert,
  HelpCircle,
} from "lucide-react";

interface RiskSummaryCardsProps {
  summary: RiskSummary;
  onRiskClick?: (riskLevel: string | undefined) => void;
  activeRisk?: string;
}

const RISK_CARDS = [
  {
    key: "HIGH_RISK" as const,
    label: "High Risk",
    icon: ShieldAlert,
    bgColor: "bg-red-100 text-red-950",
    badgeBg: "bg-red-500 text-white",
    activeClass: "bg-red-200 ring-2 ring-black",
  },
  {
    key: "MODERATE_RISK" as const,
    label: "Moderate Risk",
    icon: AlertTriangle,
    bgColor: "bg-amber-100 text-amber-950",
    badgeBg: "bg-amber-500 text-white",
    activeClass: "bg-amber-200 ring-2 ring-black",
  },
  {
    key: "NEEDS_MONITORING" as const,
    label: "Monitoring",
    icon: Eye,
    bgColor: "bg-yellow-100 text-yellow-950",
    badgeBg: "bg-yellow-400 text-black",
    activeClass: "bg-yellow-200 ring-2 ring-black",
  },
  {
    key: "LOW_RISK" as const,
    label: "Low Risk",
    icon: ShieldCheck,
    bgColor: "bg-emerald-100 text-emerald-950",
    badgeBg: "bg-emerald-500 text-white",
    activeClass: "bg-emerald-200 ring-2 ring-black",
  },
  {
    key: "INSUFFICIENT_DATA" as const,
    label: "No Data",
    icon: HelpCircle,
    bgColor: "bg-gray-100 text-gray-950",
    badgeBg: "bg-gray-400 text-white",
    activeClass: "bg-gray-200 ring-2 ring-black",
  },
];

export default function RiskSummaryCards({
  summary,
  onRiskClick,
  activeRisk,
}: RiskSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {RISK_CARDS.map((card) => {
        const count = summary[card.key];
        const isActive = activeRisk === card.key;
        const Icon = card.icon;

        return (
          <button
            key={card.key}
            type="button"
            onClick={() => onRiskClick?.(isActive ? undefined : card.key)}
            className="text-left cursor-pointer transition-transform active:translate-x-[2px] active:translate-y-[2px]"
          >
            <Card
              className={`w-full p-4 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all ${
                card.bgColor
              } ${isActive ? `${card.activeClass} shadow-none translate-x-[2px] translate-y-[2px]` : "hover:translate-x-[-1px] hover:translate-y-[-1px]"}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`p-2 rounded border-2 border-black ${card.badgeBg}`}>
                  <Icon size={20} />
                </span>
                {isActive && (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-black text-white px-1.5 py-0.5 rounded">
                    Selected
                  </span>
                )}
              </div>
              <div>
                <p className="text-3xl font-extrabold font-mono text-black leading-none">
                  {count}
                </p>
                <p className="text-xs font-bold text-gray-800 uppercase tracking-wide mt-1">
                  {card.label}
                </p>
              </div>
            </Card>
          </button>
        );
      })}
    </div>
  );
}

