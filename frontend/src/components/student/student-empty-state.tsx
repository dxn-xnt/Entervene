import type { ReactNode } from "react";
import { Button } from "@/components/student/button";
import { Card } from "@/components/retroui/Card";
import { cn } from "@/lib/utils";

type StudentEmptyStateProps = {
  icon: ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  className?: string;
  embedded?: boolean;
  cardless?: boolean;
};

export function StudentEmptyState({ icon, title, description, action, className, embedded = false, cardless = false }: StudentEmptyStateProps) {
  const content = (
      <Card.Content className="mx-auto flex w-full max-w-sm flex-col items-center gap-2 text-balance">
        <div className="mb-2 flex size-10 shrink-0 items-center justify-center border-2 border-border bg-primary text-foreground [&_svg]:size-5 [&_svg]:stroke-2">
          {icon}
        </div>
        <Card.Title className="text-base font-bold tracking-tight">{title}</Card.Title>
        <p className="text-sm/relaxed font-normal text-muted-foreground">{description}</p>
        {action && <Button size="sm" className="mt-2" onClick={action.onClick}>{action.label}</Button>}
      </Card.Content>
  );

  if (cardless) {
    return <div className={cn("w-full min-w-0 py-4 text-center", className)}>{content}</div>;
  }

  return (
    <Card className={cn("block w-full min-w-0 rounded! border-border bg-card px-6 py-12 text-center text-balance shadow-md", embedded && "p-4", className)}>
      {content}
    </Card>
  );
}
