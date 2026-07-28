"use client";

import { cn } from "@/lib/utils";
import { Card } from "@/components/retroui/Card";
import { Avatar } from "@/components/retroui/Avatar";
import { Badge } from "@/components/retroui/Badge";
import { Pen } from "lucide-react";

// ─── Simple avatar-only variant (used on profile pages) ─────────────────────

export type ProfileHeaderProps = {
  user?: {
    fullName?: string;
    email?: string;
    avatar?: string;
  } | null;
  onAvatarClick?: () => void;
  className?: string;
};

export function ProfileHeader({ user, onAvatarClick, className }: ProfileHeaderProps) {
  return (
    <Card className={cn("flex flex-row items-center gap-4 p-2 md:p-4", className)}>
      <Avatar
        className="cursor-pointer relative group h-16 w-16 rounded-full overflow-hidden border-2 border-black transition-transform hover:scale-105 shrink-0"
        onClick={onAvatarClick}
        title="Click to change avatar"
      >
        <Avatar.Image src={user?.avatar || "/avatars/teacher-avatars/12.svg"} alt={user?.fullName || "User"} />
        <Avatar.Fallback>{user?.fullName?.charAt(0) || "U"}</Avatar.Fallback>
        <div className="absolute inset-0 bg-black/45 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Pen className="size-4 text-white" />
        </div>
      </Avatar>
      <div className="flex flex-col">
        <p className="text-lg font-bold">
          {user?.fullName ?? "John Doe"}
        </p>
        <p className="text-sm text-muted-foreground">
          {user?.email ?? "johndoe@example.com"}
        </p>
      </div>
    </Card>
  );
}

// ─── Rich variant used on user-detail / management pages ────────────────────

type BadgeVariant = "default" | "secondary" | "outline" | "solid" | "surface" | "ghost";
type AvatarVariant = "student" | "teacher" | "default";

export type UserProfileHeaderProps = {
  /** Display name shown in the header. */
  name: string;
  /** Sub-text shown below the name (e.g. grade + section, or email). */
  subtitle?: string;
  /** Extra line shown for student role (e.g. email). */
  extra?: string;
  /** Avatar variant controlling the retroui Avatar style. */
  avatarVariant?: AvatarVariant;
  /** Status badge label. */
  statusLabel?: string;
  /** Status badge variant. */
  statusVariant?: BadgeVariant;
  /** When true, shows the "Pending accounts" notice. */
  isPending?: boolean;
  className?: string;
};

const AVATAR_SRC: Record<AvatarVariant, string | null> = {
  student: "/avatars/student-avatars/1.svg",
  teacher: "/avatars/teacher-avatars/12.svg",
  default: "/avatars/teacher-avatars/18.svg",
};

export function UserProfileHeader({
  name,
  subtitle,
  extra,
  avatarVariant = "default",
  statusLabel,
  statusVariant = "default",
  isPending,
  className,
}: UserProfileHeaderProps) {
  const avatarSrc = AVATAR_SRC[avatarVariant];

  return (
    <Card className={cn("flex items-center justify-between gap-4 p-4 shadow-[4px_5px_0_#000]", className)}>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar variant={avatarVariant} className="size-12 shrink-0">
          {avatarSrc && <Avatar.Image src={avatarSrc} alt={name} />}
          <Avatar.Fallback className="bg-amber-200 text-amber-900 font-bold text-lg">
            {name.charAt(0).toUpperCase()}
          </Avatar.Fallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-lg font-bold">{name}</div>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
          {extra && <div className="truncate text-xs text-muted-foreground">{extra}</div>}
        </div>
      </div>
      {(statusLabel || isPending) && (
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {statusLabel && (
            <Badge variant={statusVariant}>
              {statusLabel}
            </Badge>
          )}
          {isPending && (
            <div className="max-w-[360px] text-right text-[10px] font-medium leading-snug text-muted-foreground">
              Pending accounts can be managed after the invitation is accepted.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}