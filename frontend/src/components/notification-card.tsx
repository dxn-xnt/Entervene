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

export function NotificationCard({ title, description, date, user, badge, className }: NotificationCardProps) {
    return (
        <Card className={cn("@container/card p-3", className)}>
            <Card.Header>
                <div className="flex flex-row justify-between">
                    <Card.Description className="text-lg font-medium -mb-3">{title}</Card.Description>
                    {badge &&
                        <Badge
                            variant={
                                badge === "Pending Approval"
                                    ? "surface"
                                    : badge === "Passed"
                                        ? "default"
                                        : "outline"
                            }
                            size="sm"
                        >
                            {badge}
                        </Badge>
                    }
                </div>
            </Card.Header>
            <Card.Content>
                <Text as="p" className="text-md">{description}</Text>
                <Text as="p" className="text-sm">{date} - {user}</Text>
            </Card.Content>
        </Card>
    );
}