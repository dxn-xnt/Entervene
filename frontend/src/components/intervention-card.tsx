import React from "react";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/student/button";
import IconContainer from "@/components/icon-container";
import { BookOpen, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

export type InterventionCategory = "new" | "active" | "resolved";

export interface InterventionCardProps {
  /** Title of the intervention card */
  title: string;
  /** Subtitle (e.g. subject name or teacher name) */
  subtitle?: React.ReactNode;
  /** Category to determine default status badge and styling */
  category?: InterventionCategory;
  /** Explicit status string if not using category defaults */
  status?: string;
  /** Custom badge element (overrides category/status badge) */
  statusBadge?: React.ReactNode;
  /** Subtext or resolution/exploratory message */
  description?: React.ReactNode;
  /** Icon in the header, defaults to Shield icon */
  icon?: React.ReactNode;
  /** Meta information on the bottom-left (e.g., date shared or started) */
  metaText?: React.ReactNode;
  /** Custom action element in the bottom-right (overrides actionLabel) */
  action?: React.ReactNode;
  /** Button label for the bottom-right action */
  actionLabel?: string;
  /** Callback when action button is clicked */
  onAction?: () => void;
  /** Variant of the action button */
  actionVariant?: "default" | "outline" | "secondary" | "destructive" | "ghost" | "link";
  /** Icon inside the action button, defaults to BookOpen */
  actionIcon?: React.ReactNode;
  /** Curated activities or inner content */
  children?: React.ReactNode;
  /** Extra class names for outer Card */
  className?: string;
  /** Accessible label */
  "aria-label"?: string;
}

export function InterventionCard({
  title,
  subtitle,
  category,
  status,
  statusBadge,
  description,
  icon,
  metaText,
  action,
  actionLabel,
  onAction,
  actionVariant,
  actionIcon,
  children,
  className,
  "aria-label": ariaLabel,
}: InterventionCardProps) {
  const badgeElement =
    statusBadge !== undefined ? (
      statusBadge
    ) : status ? (
      <Badge variant="surface" size="sm">
        {status}
      </Badge>
    ) : category === "new" ? (
      <Badge variant="surface" size="sm">
        New
      </Badge>
    ) : category === "active" ? (
      <Badge variant="surface" size="sm">
        Active
      </Badge>
    ) : category === "resolved" ? (
      <Badge variant="surface" size="sm">
        Resolved
      </Badge>
    ) : null;

  const actionElement =
    action !== undefined ? (
      action
    ) : actionLabel && onAction ? (
      <Button
        size="sm"
        variant={actionVariant ?? (category === "new" ? "default" : "outline")}
        autoIcon={false}
        onClick={onAction}
        className="gap-2"
      >
        {actionIcon ?? <BookOpen className="size-4" />}
        {actionLabel}
      </Button>
    ) : null;

  return (
    <Card
      aria-label={ariaLabel}
      className={cn(
        "w-full bg-background border-2 border-border p-4 sm:p-5 shadow-none flex flex-col gap-2 transition-all hover:bg-retro hover:-translate-y-1",
        className
      )}
    >
      {/* Main Card Title and Header */}
      <div className="w-full justify-between flex items-start mb-1 gap-2">
        <div className="flex flex-row gap-3 items-start min-w-0">
          {icon ?? (
            <IconContainer className="bg-primary shrink-0" size="xl">
              <Shield className="text-border" size="36" />
            </IconContainer>
          )}
          <div className="flex flex-col gap-0.5 min-w-0">
            <h4
              className="text-xl sm:text-2xl font-black text-foreground tracking-tight truncate"
              title={title}
            >
              {title}
            </h4>
            {subtitle && (
              <p className="text-sm font-medium text-foreground truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {badgeElement}
      </div>

      {/* Subtext */}
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}

      {/* Curated remediation activities or custom children */}
      {children}

      {/* Meta line and Actions */}
      {(metaText || actionElement) && (
        <div className="flex items-end flex-wrap justify-between gap-2 mt-auto pt-2">
          {metaText ? (
            <span className="text-xs sm:text-sm text-muted-foreground">
              {metaText}
            </span>
          ) : (
            <span />
          )}
          {actionElement}
        </div>
      )}
    </Card>
  );
}

export default InterventionCard;
