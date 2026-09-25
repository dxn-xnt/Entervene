"use client";

import { cn } from "@/lib/utils";
import { Card } from "@/components/retroui/Card";
import { Text } from "@/components/retroui/Text";
import { Badge } from "./retroui/Badge";

type NotificationCardProps = {
    title: string;
    description: string;
    date: string;
    user?: string;
    type?: string;
    category?: string;
    badge?: string;
    isRead: boolean;
    className?: string;
};

export function NotificationCard({
    title,
    description,
    date,
    user,
    type,
    category,
    badge,
    isRead,
    className,
}: NotificationCardProps) {
    const itemType =
        type ||
        category ||
        (user === "Lesson" || user === "Classwork" || user === "Intervention" || user === "Announcement"
            ? user
            : undefined);

    return (
        <Card className={cn("@container/card p-4 w-full flex flex-col gap-1", isRead ? "bg-background" : "bg-accent", className)}>
            <Card.Header className="mb-0">
                <div className="flex flex-row justify-between items-start gap-4">
                    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                        <Card.Description className="text-lg font-bold leading-snug text-foreground break-words">{title}</Card.Description>
                        {itemType && (
                            <Badge
                                variant="solid"
                                size="sm"
                                className="shrink-0 font-bold"
                            >
                                {itemType}
                            </Badge>
                        )}
                    </div>
                    {badge && (
                        <Badge
                            variant={
                                badge === "Unread" || badge === "New"
                                    ? "surface"
                                    : "outline"
                            }
                            size="sm"
                            className="shrink-0"
                        >
                            {badge}
                        </Badge>
                    )}
                </div>
            </Card.Header>
            <Card.Content className="flex flex-col gap-1">
                {description && <Text as="p" className="text-sm text-foreground break-words">{description}</Text>}
                <Text as="p" className="text-xs text-muted-foreground/80 mt-1">
                    {date}
                    {user && user !== itemType ? ` • ${user}` : ""}
                </Text>
            </Card.Content>
        </Card>
    );
}