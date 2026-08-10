"use client";

import { cn } from "@/lib/utils";
import { Card } from "@/components/retroui/Card";
import { Text } from "@/components/retroui/Text";
import { Badge } from "./retroui/Badge";

type NotificationCardProps = {
    title: string;
    description: string;
    date: string;
    user: string;
    badge?: string;
    isRead: boolean;
    className?: string;
};

export function NotificationCard({ title, description, date, user, badge, isRead, className }: NotificationCardProps) {
    return (
        <Card className={cn("@container/card p-4 w-full flex flex-col gap-2", isRead ? "bg-muted/30" : "bg-card border-2 border-black", className)}>
            <Card.Header className="mb-0">
                <div className="flex flex-row justify-between items-start gap-4">
                    <Card.Description className="text-lg font-bold leading-snug text-foreground break-words flex-1">{title}</Card.Description>
                    {badge && (
                        <Badge
                            variant={
                                badge === "Unread" || badge === "New"
                                    ? "default"
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
                {description && <Text as="p" className="text-sm text-muted-foreground break-words">{description}</Text>}
                <Text as="p" className="text-xs text-muted-foreground/80 mt-1">{date} {user ? `• ${user}` : ""}</Text>
            </Card.Content>
        </Card>
    );
}