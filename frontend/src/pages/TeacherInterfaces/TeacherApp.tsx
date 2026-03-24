import Dashboard from "./Dashboard";
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
        <Dashboard />
      
    </div>
  );
};

export default TeacherApp;