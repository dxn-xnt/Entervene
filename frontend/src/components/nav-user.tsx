import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  MoonIcon,
  PaletteIcon,
  SunIcon,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { routes } from "@/../routes";
import { Avatar } from "./retroui/Avatar";
import { colorThemes, isColorTheme, useColorTheme } from "@/context/ColorThemeContext";
import { RoleBadge } from "@/components/role-badge";

export function NavUser() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { isMobile } = useSidebar();
  const [loggingOut, setLoggingOut] = useState(false);
  const { theme, setTheme, appearance, setAppearance } = useColorTheme();

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
              <div className="min-w-0 flex-1 text-left leading-tight">
                <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-semibold">
                  {user?.fullName || "Loading…"}
                </span>
                  <RoleBadge role={user?.role} />
                </div>
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
                  <RoleBadge role={user?.role} className="mt-1" />
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
            <DropdownMenuLabel className="flex items-center gap-1.5 px-2 py-1.5 text-foreground">
              <PaletteIcon className="size-4" />
              Color theme
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => {
                if (isColorTheme(value)) setTheme(value);
              }}
            >
              {colorThemes.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  className="gap-2 p-2 pr-8"
                >
                  <span
                    aria-hidden="true"
                    className="size-3 border border-black"
                    style={{ backgroundColor: option.swatch }}
                  />
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator className="bg-black" />
            <DropdownMenuLabel className="px-2 py-1.5 text-foreground">
              Appearance
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={appearance}
              onValueChange={(value) => {
                if (value === "light" || value === "dark") setAppearance(value);
              }}
            >
              <DropdownMenuRadioItem value="light" className="gap-2 p-2 pr-8">
                <SunIcon />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark" className="gap-2 p-2 pr-8">
                <MoonIcon />
                Dark
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator className="bg-border" />

            <DropdownMenuItem
              onClick={handleLogout}
              disabled={loggingOut}
              className="p-2 text-destructive "
            >

              <LogOutIcon className="text-destructive" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
