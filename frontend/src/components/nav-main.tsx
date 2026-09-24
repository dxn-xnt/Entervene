import { Link, useLocation } from "react-router-dom";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/retroui/Badge";

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
          {items.map((item) => {
            const count = badgeCounts[item.title] ?? 0;
            return (
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
                    {count > 0 && (
                      <Badge
                        variant="solid"
                        size="sm"
                        className="ml-auto shrink-0 font-bold group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:right-0 group-data-[collapsible=icon]:top-0"
                        aria-label={`${count} unread ${item.title.toLowerCase()}`}
                      >
                        {count > 99 ? "99+" : count}
                      </Badge>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
