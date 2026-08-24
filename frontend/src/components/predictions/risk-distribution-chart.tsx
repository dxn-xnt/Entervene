import type { RiskSummary } from "@/lib/prediction-api";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface RiskDistributionChartProps {
  summary: RiskSummary;
}

const COLORS: Record<string, string> = {
  HIGH_RISK: "#ef4444",
  MODERATE_RISK: "#f59e0b",
  NEEDS_MONITORING: "#eab308",
  LOW_RISK: "#10b981",
  INSUFFICIENT_DATA: "#9ca3af",
};

const LABELS: Record<string, string> = {
  HIGH_RISK: "High Risk",
  MODERATE_RISK: "Moderate",
  NEEDS_MONITORING: "Monitoring",
  LOW_RISK: "Low Risk",
  INSUFFICIENT_DATA: "No Data",
};

export default function RiskDistributionChart({
  summary,
}: RiskDistributionChartProps) {
  const data = Object.entries(COLORS)
    .map(([key, color]) => ({
      name: LABELS[key],
      value: summary[key as keyof RiskSummary] as number,
      color,
    }))
    .filter((d) => d.value > 0);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">
        No prediction data available
      </div>
    );
  }

  return (
    <div className="flex items-center gap-6">
      <div className="w-[180px] h-[180px]">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: any, name: any) => [`${value ?? 0} students`, String(name ?? "")]}
              contentStyle={{
                borderRadius: "0px",
                border: "2px solid #000000",
                boxShadow: "3px 3px 0px 0px #000000",
                fontWeight: "bold",
                fontSize: "12px",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col gap-1.5 flex-1">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2 text-xs font-bold">
            <span
              className="inline-block w-3 h-3 border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
              style={{ backgroundColor: d.color }}
            />
            <span className="text-black uppercase">{d.name}</span>
            <span className="font-extrabold text-black font-mono ml-auto pl-2">
              {d.value}
            </span>
          </div>
        ))}
        <div className="border-t-2 border-black pt-1.5 mt-1.5 flex items-center gap-2 text-xs uppercase font-extrabold">
          <span className="text-black">Total</span>
          <span className="font-black text-black font-mono ml-auto pl-2">
            {summary.total}
          </span>
        </div>
      </div>
    </div>
  );
}
