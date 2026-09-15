import { cn } from "@/lib/utils";

type NavigationBadgeProps = {
  count: number;
  label: string;
  className?: string;
};

export function NavigationBadge({ count, label, className }: NavigationBadgeProps) {
  if (count <= 0) return null;

  const displayCount = count > 99 ? "99+" : String(count);

  return (
    <span
      className={cn(
        "ml-auto inline-flex min-w-5 shrink-0 items-center justify-center border border-black bg-primary px-1 py-0.5 text-[10px] font-bold leading-none text-primary-foreground group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:right-0 group-data-[collapsible=icon]:top-0",
        className,
      )}
      aria-label={`${count} ${label}`}
    >
      {displayCount}
    </span>
  );
}
