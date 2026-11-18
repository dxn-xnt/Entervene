import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { cn } from "@/lib/utils";

const STRENGTH_OPTIONS = [
  { code: "STRUCTURE", label: "Clear Structure" },
  { code: "EVIDENCE", label: "Strong Evidence" },
  { code: "ANALYSIS", label: "Thorough Analysis" },
  { code: "CALCULATIONS", label: "Accurate Calculations" },
  { code: "CREATIVITY", label: "Creative Approach" },
] as const;

const IMPROVEMENT_OPTIONS = [
  { code: "DEEPEN_ANALYSIS", label: "Deepen Analysis" },
  { code: "CITATIONS", label: "Add Citations" },
  { code: "CLARITY", label: "Improve Clarity" },
  { code: "REVIEW_CALCULATIONS", label: "Review Calculations" },
  { code: "CONCLUSION", label: "Strengthen Conclusion" },
] as const;

const MAX_PER_CATEGORY = 2;

export interface FeedbackFocusSelectorProps {
  selectedCodes: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
  className?: string;
}

export default function FeedbackFocusSelector({
  selectedCodes,
  onChange,
  disabled = false,
  className = "",
}: FeedbackFocusSelectorProps) {
  const selectedSet = new Set(selectedCodes);

  const selectedStrengths = STRENGTH_OPTIONS.filter((opt) => selectedSet.has(opt.code));
  const selectedImprovements = IMPROVEMENT_OPTIONS.filter((opt) => selectedSet.has(opt.code));

  const strengthsAtMax = selectedStrengths.length >= MAX_PER_CATEGORY;
  const improvementsAtMax = selectedImprovements.length >= MAX_PER_CATEGORY;

  const toggleCode = (code: string, isStrength: boolean) => {
    if (disabled) return;
    if (selectedSet.has(code)) {
      onChange(selectedCodes.filter((c) => c !== code));
    } else {
      if (isStrength && strengthsAtMax) return;
      if (!isStrength && improvementsAtMax) return;
      onChange([...selectedCodes, code]);
    }
  };

  const handleClear = () => {
    if (disabled) return;
    onChange([]);
  };

  return (
    <Card
      className={cn("border-2 border-black bg-white p-3 shadow-none rounded!", className)}
      data-testid="feedback-focus-selector"
    >
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-black/20">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-tight">Feedback Focus Points</span>
          <Badge size="sm" variant="outline" className="text-xs bg-white text-muted-foreground">
            Optional
          </Badge>
        </div>
        {selectedCodes.length > 0 && !disabled && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs font-semibold"
            onClick={handleClear}
            data-testid="clear-focus-points"
          >
            Clear
          </Button>
        )}
      </div>

      <div className="mt-2.5 space-y-2.5">
        {/* Strengths Category */}
        <div>
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground mb-1.5">
            <span>Strengths</span>
            <span className={strengthsAtMax ? "font-bold text-foreground" : ""}>
              {selectedStrengths.length}/{MAX_PER_CATEGORY}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Strengths focus points">
            {STRENGTH_OPTIONS.map((opt) => {
              const isSelected = selectedSet.has(opt.code);
              const isBlocked = !isSelected && strengthsAtMax;
              return (
                <button
                  key={opt.code}
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-disabled={disabled || isBlocked}
                  disabled={disabled || isBlocked}
                  onClick={() => toggleCode(opt.code, true)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded border-2 font-medium transition-all",
                    isSelected
                      ? "bg-primary text-foreground font-bold border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                      : "bg-white text-foreground hover:bg-retro border-black/40",
                    isBlocked && "opacity-40 cursor-not-allowed hover:bg-white border-dashed",
                    disabled && "opacity-50 cursor-not-allowed"
                  )}
                  data-testid={`focus-chip-${opt.code.toLowerCase()}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Areas for Improvement Category */}
        <div>
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground mb-1.5">
            <span>Areas for Improvement</span>
            <span className={improvementsAtMax ? "font-bold text-foreground" : ""}>
              {selectedImprovements.length}/{MAX_PER_CATEGORY}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Areas for Improvement focus points">
            {IMPROVEMENT_OPTIONS.map((opt) => {
              const isSelected = selectedSet.has(opt.code);
              const isBlocked = !isSelected && improvementsAtMax;
              return (
                <button
                  key={opt.code}
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-disabled={disabled || isBlocked}
                  disabled={disabled || isBlocked}
                  onClick={() => toggleCode(opt.code, false)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded border-2 font-medium transition-all",
                    isSelected
                      ? "bg-primary text-foreground font-bold border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                      : "bg-white text-foreground hover:bg-retro border-black/40",
                    isBlocked && "opacity-40 cursor-not-allowed hover:bg-white border-dashed",
                    disabled && "opacity-50 cursor-not-allowed"
                  )}
                  data-testid={`focus-chip-${opt.code.toLowerCase()}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
