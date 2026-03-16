type Tab = {
  id: string;
  label: string;
  icon?: React.ReactNode;
};

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
}

const Tabs = ({ tabs, activeTab, onChange }: TabsProps) => {
  return (
    <div className="px-5 flex border-b">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors
              ${
                isActive
                  ? "border border-b-0 -mb-px bg-[#FFFDF5] font-medium rounded-t-lg"
                  : "border border-transparent hover:text-gray-700"
              }`}
          >
            {tab.icon && tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

export default Tabs;
