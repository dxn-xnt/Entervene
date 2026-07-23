import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  EllipsisVerticalIcon,
  CircleUserRoundIcon,
  BellIcon,
  LogOutIcon,
  Loader2Icon,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { routes } from "@/../routes";
import { Avatar } from "./retroui/Avatar";

export function NavUser() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { isMobile } = useSidebar();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    navigate("/login", { replace: true });
  };

  const initials = user?.fullName
    ? user.fullName
      .split(" ")
      .filter((part) => part.length > 0)
      .map((part, index, array) => {
        if (index === 0) return part[0];
        if (index === array.length - 1) return part[0];
        return "";
      })
      .join("")
      .toUpperCase()
    : "?";

  const avatarVariant =
    user?.role === "teacher"
      ? "teacher"
      : user?.role === "student"
        ? "student"
        : "default";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground border-t-2 border-b-0! border-border p-6 py-8"
            >
              <Avatar className="h-10 w-10 p-0" variant={avatarVariant}>
                <Avatar.Image
                  src={user?.avatar ?? ""}
                  alt={user?.fullName ?? ""}
                />
                <Avatar.Fallback className="rounded-full">
                  {initials}
                </Avatar.Fallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">
                  {user?.fullName || "Loading…"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {user?.email || ""}
                </span>
              </div>
              <EllipsisVerticalIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="min-w-56 border-2 border-border mb-2"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-1 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-foreground">
                <Avatar className="h-8 w-8" variant={avatarVariant}>
                  <Avatar.Image
                    src={user?.avatar ?? ""}
                    alt={user?.fullName ?? ""}
                  />
                  <Avatar.Fallback className="rounded-full">
                    {initials}
                  </Avatar.Fallback>
                </Avatar>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">
                    {user?.fullName || "Loading…"}
                  </span>
                  <span className="truncate text-xs">
                    {user?.email || ""}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator className="bg-black" />

            <DropdownMenuGroup>
              <DropdownMenuItem className="p-2"
                onClick={() => {
                  if (user?.role === "student") {
                    navigate(routes.student.profile);
                  } else if (user?.role === "teacher") {
                    navigate(routes.teacher.profile);
                  } else if (user?.role === "admin") {
                    navigate(routes.admin.profile);
                  }
                }}
              >
                <CircleUserRoundIcon />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem className="p-2">
                <BellIcon />
                Notifications
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator className="bg-black" />

            <DropdownMenuItem
              onClick={handleLogout}
              disabled={loggingOut}
              className="p-2 text-destructive focus:text-destructive"
            >
              {loggingOut ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <LogOutIcon />
              )}
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
