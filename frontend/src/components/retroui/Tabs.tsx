import { useEffect, useRef, useState, type ComponentType } from "react";

export type TabItem<T extends string = string> = {
  id: T;
  label: string;
  icon?: ComponentType<{ size?: number | string; className?: string }>;
};

type TabsProps<T extends string = string> = {
  tabs: Array<TabItem<T>>;
  activeTab: T;
  onTabChange: (tab: T) => void;
  counts?: Partial<Record<T, number>>;
  className?: string;
};

export function Tabs<T extends string = string>({
  tabs,
  activeTab,
  onTabChange,
  counts = {},
  className = "",
}: TabsProps<T>) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const mobileQuery = window.matchMedia("(max-width: 639px)");
    if (!sentinel) return;

    const updatePinnedState = () => {
      setIsPinned(mobileQuery.matches && sentinel.getBoundingClientRect().top < 0);
    };
    const observer = new IntersectionObserver(updatePinnedState, { threshold: 0 });

    observer.observe(sentinel);
    mobileQuery.addEventListener("change", updatePinnedState);
    window.addEventListener("scroll", updatePinnedState, { passive: true });
    updatePinnedState();

    return () => {
      observer.disconnect();
      mobileQuery.removeEventListener("change", updatePinnedState);
      window.removeEventListener("scroll", updatePinnedState);
    };
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
      {isPinned ? <div aria-hidden="true" className="h-[50px] sm:hidden" /> : null}
      <div
        className={`${isPinned ? "fixed inset-x-0 top-0 z-50 mx-0" : "-mx-3"} min-w-0 border-b-2 border-border bg-background sm:static sm:-mx-4 md:-mx-6 ${className}`}
      >
      <div
        role="tablist"
        aria-label="Page sections"
        className="no-scrollbar flex w-full flex-nowrap gap-1.5 overflow-x-auto overscroll-x-contain px-3 pt-2 sm:gap-2 sm:px-4 md:px-6"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const count = counts[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onTabChange(tab.id)}
              className={`flex min-h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border-2 border-b-0 px-3 py-2 text-sm font-semibold shadow-[3px_0_0_#000] transition-colors sm:px-4 ${isActive
                ? "bg-primary text-primary-foreground"
                : "bg-background text-foreground hover:bg-accent"
                }`}
            >
              {tab.icon && <tab.icon size={16} className="shrink-0" />}
              <span>{tab.label}</span>
              {typeof count === "number" ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>
      </div>
    </>
  );
}
