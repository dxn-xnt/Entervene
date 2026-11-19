import { useId, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/retroui/Switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/retroui/Tooltip";

export interface ClassworkSettingRowProps {
  /** Optional element ID for associating label with switch */
  id?: string;
  /** Primary label text */
  label: string;
  /** Informational tooltip text explaining the setting */
  tooltip?: ReactNode;
  /** Whether the setting switch is currently enabled */
  checked: boolean;
  /** Callback when switch value changes */
  onCheckedChange: (checked: boolean) => void;
  /** Whether the setting is disabled from editing */
  disabled?: boolean;
  /** Optional explanation displayed when setting is disabled */
  disabledReason?: ReactNode;
  /** Optional custom container CSS classes */
  className?: string;
  /** Optional accessible name for the switch (defaults to label) */
  ariaLabel?: string;
}

export function ClassworkSettingRow({
  id,
  label,
  tooltip,
  checked,
  onCheckedChange,
  disabled = false,
  disabledReason,
  className,
  ariaLabel,
}: ClassworkSettingRowProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  return (
    <div className={cn("flex items-center justify-between gap-3 py-1", className)}>
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <label
            htmlFor={inputId}
            className={cn(
              "text-sm font-medium text-foreground select-none",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            )}
          >
            {label}
          </label>
          {tooltip && (
            <Tooltip open={isTooltipOpen} onOpenChange={setIsTooltipOpen}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setIsTooltipOpen((prev) => !prev);
                    }}
                    className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black cursor-help shrink-0"
                    aria-label={`${label} information`}
                  >
                    <Info className="size-3.5" />
                  </button>
                }
              />
              <TooltipContent
                side="top"
                align="start"
                className="max-w-xs text-xs font-normal leading-relaxed text-foreground"
              >
                {tooltip}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {disabled && disabledReason && (
          <p className="text-xs font-medium text-amber-700 mt-0.5">
            {disabledReason}
          </p>
        )}
      </div>

      <Switch
        id={inputId}
        aria-label={ariaLabel ?? label}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}

export default ClassworkSettingRow;
