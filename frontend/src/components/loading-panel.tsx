import { Loader } from "@/components/retroui/Loader";
import { cn } from "@/lib/utils";

type LoadingPanelProps = {
  label: string;
  className?: string;
};

export function LoadingPanel({ label, className }: LoadingPanelProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-3 border border-black bg-background py-12 text-sm text-muted-foreground shadow-[4px_5px_0_#000]",
        className,
      )}
    >
      <Loader size="sm" />
      {label}
    </div>
  );
}
