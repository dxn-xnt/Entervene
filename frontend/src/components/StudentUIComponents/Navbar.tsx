import { useState } from "react";
import {
  ChevronDown,
  LayoutDashboard,
  BookOpen,
  Shield,
  BarChart2,
  CheckSquare,
  Bell,
  School,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";

const quarters = [
  "1st Quarter (2025-2026)",
  "2nd Quarter (2025-2026)",
  "3rd Quarter (2025-2026)",
  "4th Quarter (2025-2026)",
];

const NAV_ITEMS = {
  student: [
    { label: "Study Board", icon: <LayoutDashboard size={16} /> },
    { label: "Subjects", icon: <BookOpen size={16} /> },
    { label: "Interventions", icon: <Shield size={16} /> },
    { label: "Grades", icon: <BarChart2 size={16} /> },
    { label: "To Do", icon: <CheckSquare size={16} /> },
    { label: "Notifications", icon: <Bell size={16} /> },
  ],
  teacher: [
    { label: "Dashboard", icon: <LayoutDashboard size={16} /> },
    { label: "Classes", icon: <School size={16} /> },
    { label: "Classworks", icon: <ClipboardList size={16} /> },
    { label: "Interventions", icon: <Shield size={16} /> },
    { label: "Grades", icon: <BarChart2 size={16} /> },
    { label: "Notifications", icon: <Bell size={16} /> },
  ],
  admin: [],
};

interface NavbarProps {
  activeNav: string;
  setActiveNav: (nav: string) => void;
}

const Navbar = ({ activeNav, setActiveNav }: NavbarProps) => {
  const { role } = useAuth();
  const [selectedQuarter, setSelectedQuarter] = useState(quarters[0]);
  const [isOpen, setIsOpen] = useState(false);

  const items = NAV_ITEMS[role as keyof typeof NAV_ITEMS] ?? [];

  return (
    <aside className="w-64 h-screen sticky top-0 bg-[#FFFDF5] border-r border-gray-500 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 flex flex-col items-center">
        <div className="inline-block">
          <h1
            style={{ fontFamily: "'Press Start 2P', cursive" }}
            className="text-lg text-gray-900 leading-loose"
          >
            ENTERVENE
          </h1>
          <p
            style={{ fontFamily: "'Press Start 2P', cursive" }}
            className="text-[7px] font-bold text-right"
          >
            MNSTS EDUHUB
          </p>
        </div>
      </div>

      {/* Quarter Dropdown */}
      <div className="border-t border-b relative shadow-[0_6px_0px_0px_rgba(0,0,0,1)]">
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="flex flex-row items-center justify-between cursor-pointer"
        >
          <p className="px-4 py-2 text-sm">{selectedQuarter}</p>
          <div className="bg-black px-3 py-2 flex items-center self-stretch">
            <ChevronDown size={16} className="text-white" />
          </div>
        </div>

        {isOpen && (
          <div className="absolute left-0 right-0 bg-white border shadow-md z-10">
            {quarters.map((quarter) => (
              <div
                key={quarter}
                onClick={() => {
                  setSelectedQuarter(quarter);
                  setIsOpen(false);
                }}
                className="px-4 py-2 text-sm text-black hover:bg-gray-100 cursor-pointer"
              >
                {quarter}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Nav Links */}
      <nav className="flex flex-col flex-1">
        <p className="pl-4 pt-6">Menu</p>
        {items.map(({ label, icon }) => (
          <div
            key={label}
            onClick={() => setActiveNav(label)}
            className={`flex flex-row py-2 px-6 items-center gap-3 cursor-pointer transition-colors duration-150 text-sm
              ${activeNav === label ? "text-black border-t border-b border-black shadow-[0_2px_0px_0px_rgba(0,0,0,1)]" : "text-black"}`}
          >
            {icon} {label}
          </div>
        ))}
      </nav>

      {/* Profile */}
      <div className="flex flex-row items-center justify-between px-4 pb-10">
        <div className="flex flex-row items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gray-300" />
          <p className="text-sm font-bold">John Doe</p>
        </div>
        <ChevronDown size={16} />
      </div>
    </aside>
  );
};

export default Navbar;
