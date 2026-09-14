import { Badge } from "@/components/retroui/Badge";
import { cn } from "@/lib/utils";
type DisplayRole = "student" | "teacher" | "admin";

const ROLE_LABELS: Record<DisplayRole, string> = {
  student: "Student",
  teacher: "Teacher",
  admin: "Administrator",
};

function normalizeDisplayRole(role: string | null | undefined): DisplayRole | null {
  const normalized = role?.trim().toLowerCase();
  if (normalized === "student") return "student";
  if (normalized === "teacher") return "teacher";
  if (normalized === "admin" || normalized === "administrator") return "admin";
  return null;
}

export function RoleBadge({
  role,
  className,
}: {
  role: string | null | undefined;
  className?: string;
}) {
  const normalizedRole = normalizeDisplayRole(role);
  if (!normalizedRole) return null;

  return (
    <Badge
      size="sm"
      variant="default"
      className={cn(
        "inline-flex w-fit self-start shrink-0 items-center whitespace-nowrap rounded-none border border-border bg-primary px-1.5 py-0 text-[9px] font-bold leading-4 text-primary-foreground shadow-none",
        className,
      )}
    >
      {ROLE_LABELS[normalizedRole]}
    </Badge>
  );
}
