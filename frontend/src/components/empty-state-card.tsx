import { Card } from "@/components/retroui/Card";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type EmptyStateCardProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function EmptyStateCard({
  icon,
  title,
  description,
  children,
  className,
}: EmptyStateCardProps) {
  return (
    <Card className={cn("flex w-full flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-2">{icon}</div> : null}
      <p className="text-base font-bold">{title}</p>
      {description ? <div className="mt-1 text-sm font-normal text-gray-500">{description}</div> : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </Card>
  );
}
