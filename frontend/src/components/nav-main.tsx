import { Link, useLocation } from "react-router-dom";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NavigationBadge } from "@/components/navigation-badge";

export function NavMain({
  items,
  badgeCounts = {},
}: {
  items: {
    title: string;
    url: string;
    icon?: React.ReactNode;
    activePaths?: string[];
  }[];
  badgeCounts?: Record<string, number | undefined>;
}) {
  const { pathname } = useLocation();

  const matchesPath = (path: string) =>
    pathname === path || pathname.startsWith(path + "/");

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={
                  item.url === "/"
                    ? pathname === item.url
                    : matchesPath(item.url) ||
                      item.activePaths?.some(matchesPath) === true
                }
                asChild
              >
                <Link to={item.url} className="relative flex w-full items-center gap-2">
                  {item.icon}
                  <span>{item.title}</span>
                  <NavigationBadge
                    count={badgeCounts[item.title] ?? 0}
                    label={`unread ${item.title.toLowerCase()}`}
                  />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
