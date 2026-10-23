import type { ReactNode } from "react";
import { Button } from "@/components/retroui/Button";
import { Avatar } from "@/components/retroui/Avatar";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

type TeacherEmptyStateProps = {
  icon?: ReactNode;
  illustration?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void; icon?: ReactNode };
  className?: string;
  compact?: boolean;
};

export function TeacherEmptyAvatarGroup() {
  return (
    <div className="flex -space-x-2 *:data-[slot=avatar]:size-12 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background *:data-[slot=avatar]:grayscale" aria-hidden="true">
      {[3, 2, 1].map((avatar) => (
        <Avatar key={avatar} variant="student">
          <Avatar.Image src={`/avatars/student-avatars/${avatar}.svg`} alt="" />
          <Avatar.Fallback>ST</Avatar.Fallback>
        </Avatar>
      ))}
    </div>
  );
}

export function TeacherEmptyState({ icon, illustration, title, description, action, className, compact = false }: TeacherEmptyStateProps) {
  return <Empty className={cn("shadow-md hover:shadow-none transition-shadow", compact && "flex-none px-4 py-6", className)}>
    <EmptyHeader>
      <EmptyMedia>
        {illustration ?? <div className="flex size-10 items-center justify-center border-2 border-black bg-primary text-black [&_svg]:size-5" aria-hidden="true">{icon}</div>}
      </EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      {description && <EmptyDescription className="text-center">{description}</EmptyDescription>}
    </EmptyHeader>
    {action && <EmptyContent><Button size="sm" className="gap-1.5" onClick={action.onClick}>{action.icon}{action.label}</Button></EmptyContent>}
  </Empty>;
}
