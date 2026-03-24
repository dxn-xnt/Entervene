import Dashboard from "./Dashboard";
import Classes from "./Classes";
import Navbar from "../../components/StudentUIComponents/Navbar";
import { useState } from "react";

const TeacherApp = () => {
  const [activeNav, setActiveNav] = useState("Dashboard");

  return (
    <div className="flex min-h-screen">
      <Navbar
        activeNav={activeNav}
        setActiveNav={(nav) => {
          setActiveNav(nav);
        }}
      />
      <main className="flex-1 bg-[#FFFDF5]">
        {activeNav === "Dashboard" && <Dashboard />}
        {activeNav === "Classes" && <Classes />}
      </main>
    </div>
  );
};

export default TeacherApp;