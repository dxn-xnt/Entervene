export type SubjectModuleTabId = "catalog" | "offerings" | "grading" | "archived";

type SubjectModuleTabsProps = {
  activeTab: SubjectModuleTabId;
  onTabChange: (tab: SubjectModuleTabId) => void;
  counts?: Partial<Record<SubjectModuleTabId, number>>;
};

const tabs: Array<{ id: SubjectModuleTabId; label: string }> = [
  { id: "catalog", label: "Subject Catalog" },
  { id: "offerings", label: "Curriculum Plan" },
  { id: "grading", label: "Grading Templates" },
  { id: "archived", label: "Archived" },
];

export function SubjectModuleTabs({ activeTab, onTabChange, counts = {} }: SubjectModuleTabsProps) {
  return (
    <div className="-mx-4 border-b border-black/40 px-4 md:-mx-6 md:px-6">
      <div className="flex flex-wrap gap-2 pt-2">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const count = counts[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`min-h-10 border-2 border-b-0 px-4 py-2 text-sm font-semibold shadow-[3px_0_0_#000] transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-foreground hover:bg-muted"
              }`}
            >
              {tab.label}
              {typeof count === "number" ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
