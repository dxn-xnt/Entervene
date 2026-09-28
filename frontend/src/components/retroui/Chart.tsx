import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/retroui/Card";

export interface RetroChartDataPoint {
  label: string;
  value: number;
  highlight?: boolean;
  color?: string;
  tooltipValue?: string | number;
}

export interface RetroChartPeriodOption {
  value: string;
  label: string;
}

export interface RetroBarChartProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  data: RetroChartDataPoint[];
  periods?: RetroChartPeriodOption[];
  activePeriod?: string;
  onPeriodChange?: (period: string) => void;
  yAxisTicks?: number[];
  maxY?: number;
  barColor?: string;
  highlightColor?: string;
  height?: number;
  valuePrefix?: string;
  valueSuffix?: string;
}

export function RetroBarChart({
  title = "Monthly Sales",
  description = "Revenue in thousands ($K)",
  data = [],
  periods,
  activePeriod,
  onPeriodChange,
  yAxisTicks,
  maxY: customMaxY,
  barColor = "#facc15",
  highlightColor,
  className,
  valuePrefix = "",
  valueSuffix = "",
  ...props
}: RetroBarChartProps) {
  const [internalPeriod, setInternalPeriod] = React.useState(
    activePeriod || (periods && periods.length > 0 ? periods[periods.length - 1].value : "")
  );
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);

  const currentPeriod = activePeriod !== undefined ? activePeriod : internalPeriod;

  const handlePeriodChange = (val: string) => {
    setInternalPeriod(val);
    onPeriodChange?.(val);
  };

  // Determine Max Y value and ticks
  const dataMax = Math.max(...data.map((d) => d.value), 0);
  const calculatedMaxY = customMaxY || (dataMax > 0 ? Math.ceil((dataMax * 1.15) / 10) * 10 : 80);
  const effectiveMaxY = Math.max(calculatedMaxY, 10);

  const ticks = React.useMemo(() => {
    if (yAxisTicks && yAxisTicks.length > 0) return yAxisTicks;
    const step = effectiveMaxY / 4;
    return [
      effectiveMaxY,
      Math.round(step * 3),
      Math.round(step * 2),
      Math.round(step * 1),
      0,
    ];
  }, [yAxisTicks, effectiveMaxY]);

  // Chart coordinate constants for SVG viewBox
  const viewBoxWidth = 480;
  const viewBoxHeight = 220;
  const paddingLeft = 36;
  const paddingRight = 16;
  const paddingTop = 20;
  const paddingBottom = 185;

  const chartWidth = viewBoxWidth - paddingLeft - paddingRight;
  const chartHeight = paddingBottom - paddingTop;

  const numBars = data.length || 1;
  const slotWidth = chartWidth / numBars;
  const barWidth = Math.min(Math.max(slotWidth * 0.48, 14), 28);

  return (
    <Card
      className={cn(
        "@container/chart flex flex-col justify-between border-2 border-border bg-card p-4 sm:p-5 shadow-md hover:shadow-none transition-all",
        className
      )}
      {...props}
    >
      {/* Header with Title, Description and Period Switcher */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          {title && (
            <h3 className="font-head text-lg sm:text-xl font-bold tracking-tight text-foreground">
              {title}
            </h3>
          )}
          {description && (
            <p className="text-xs sm:text-sm text-muted-foreground font-normal mt-0.5">
              {description}
            </p>
          )}
        </div>

        {periods && periods.length > 0 && (
          <div className="flex self-start sm:self-auto rounded border-2 border-black dark:border-border bg-background shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] overflow-hidden shrink-0">
            {periods.map((p) => {
              const isSelected = currentPeriod === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => handlePeriodChange(p.value)}
                  className={cn(
                    "px-3 py-1 text-xs font-bold transition-all border-r-2 border-black dark:border-border last:border-r-0 cursor-pointer select-none",
                    isSelected
                      ? "bg-primary text-black font-extrabold"
                      : "bg-background text-foreground/80 hover:bg-muted font-semibold"
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* SVG Bar Chart Area */}
      <div className="relative w-full overflow-visible">
        <svg
          viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
          className="w-full h-auto overflow-visible"
        >
          {/* Y Axis Gridlines and Ticks */}
          {ticks.map((tickVal) => {
            const tickY = paddingBottom - (tickVal / effectiveMaxY) * chartHeight;
            const isBase = tickVal === 0;

            return (
              <g key={tickVal}>
                {/* Y Tick Label */}
                <text
                  x={paddingLeft - 8}
                  y={tickY + 4}
                  textAnchor="end"
                  className="text-[11px] font-medium fill-muted-foreground select-none"
                >
                  {tickVal}
                </text>

                {/* Grid Line */}
                {isBase ? (
                  <line
                    x1={paddingLeft}
                    x2={viewBoxWidth - paddingRight}
                    y1={tickY}
                    y2={tickY}
                    className="stroke-black dark:stroke-border stroke-2"
                  />
                ) : (
                  <line
                    x1={paddingLeft}
                    x2={viewBoxWidth - paddingRight}
                    y1={tickY}
                    y2={tickY}
                    className="stroke-border/70 dark:stroke-border/40 stroke-1 stroke-dasharray-3"
                    strokeDasharray="3 3"
                  />
                )}
              </g>
            );
          })}

          {/* Bars */}
          {data.map((item, idx) => {
            const barHeight = Math.max(
              0,
              Math.min((item.value / effectiveMaxY) * chartHeight, chartHeight)
            );
            const barX = paddingLeft + idx * slotWidth + (slotWidth - barWidth) / 2;
            const barY = paddingBottom - barHeight;
            const isHovered = hoveredIdx === idx;
            const activeColor = item.color || (item.highlight && highlightColor ? highlightColor : barColor);

            return (
              <g
                key={item.label + idx}
                className="cursor-pointer transition-transform duration-200"
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {/* Clickable / Hoverable wide background area */}
                <rect
                  x={paddingLeft + idx * slotWidth}
                  y={paddingTop}
                  width={slotWidth}
                  height={paddingBottom - paddingTop + 24}
                  fill="transparent"
                />

                {/* Bar rectangle with crisp black outline */}
                <rect
                  x={barX}
                  y={barY}
                  width={barWidth}
                  height={barHeight}
                  fill={activeColor}
                  className={cn(
                    "stroke-black dark:stroke-border stroke-2 transition-all duration-200",
                    isHovered && "brightness-105 -translate-y-0.5"
                  )}
                  style={{
                    transformOrigin: `${barX + barWidth / 2}px ${paddingBottom}px`,
                  }}
                />

                {/* X Axis Label */}
                <text
                  x={barX + barWidth / 2}
                  y={paddingBottom + 16}
                  textAnchor="middle"
                  className={cn(
                    "text-[11px] select-none transition-colors",
                    isHovered
                      ? "fill-foreground font-bold"
                      : "fill-muted-foreground font-medium"
                  )}
                >
                  {item.label}
                </text>

                {/* Hover value indicator bubble */}
                {isHovered && (
                  <g className="animate-in fade-in zoom-in-90 duration-150 pointer-events-none">
                    <rect
                      x={barX + barWidth / 2 - 24}
                      y={Math.max(barY - 26, 4)}
                      width={48}
                      height={20}
                      rx={3}
                      className="fill-black dark:fill-background stroke-2 stroke-primary"
                    />
                    <text
                      x={barX + barWidth / 2}
                      y={Math.max(barY - 12, 18)}
                      textAnchor="middle"
                      className="text-[10px] font-bold fill-white dark:fill-foreground select-none"
                    >
                      {item.tooltipValue !== undefined
                        ? item.tooltipValue
                        : `${valuePrefix}${item.value}${valueSuffix}`}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </Card>
  );
}

export default RetroBarChart;
