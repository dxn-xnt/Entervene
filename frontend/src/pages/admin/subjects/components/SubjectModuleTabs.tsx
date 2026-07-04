import { Tabs, type TabItem } from "@/components/retroui/Tabs";

export type SubjectModuleTabId = "catalog" | "offerings" | "grading" | "archived";

type SubjectModuleTabsProps = {
  activeTab: SubjectModuleTabId;
  onTabChange: (tab: SubjectModuleTabId) => void;
  counts?: Partial<Record<SubjectModuleTabId, number>>;
};

const tabs: Array<TabItem<SubjectModuleTabId>> = [
  { id: "catalog", label: "Subject Catalog" },
  { id: "offerings", label: "Curriculum Plan" },
  { id: "grading", label: "Grading Templates" },
  { id: "archived", label: "Archived" },
];

export function SubjectModuleTabs({ activeTab, onTabChange, counts = {} }: SubjectModuleTabsProps) {
  return (
    <Tabs
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
      counts={counts}
      className="border-b-2 border-black"
    />
  );
}
