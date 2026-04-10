import Dashboard from "./Dashboard";
import ClassesPage from "./Classes/ClassesPage";
import Subject from "./Classes/Subjects"
import Navbar from "../../components/Navbar";
import { useState } from "react";
import Classworks from "./Classworks";
import Notifications from "./Notifications";

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
        {activeNav === "Classes" && <ClassesPage setActiveNav={setActiveNav} />}
        {activeNav === "Subject" && <Subject setActiveNav={setActiveNav} />}
        {activeNav === "Classworks" && <Classworks />}
        {activeNav === "Notifications" && <Notifications />}
      </main>
    </div>
  );
};

export default TeacherApp;
