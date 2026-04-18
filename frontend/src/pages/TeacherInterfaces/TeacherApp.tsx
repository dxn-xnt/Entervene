import Dashboard from "./Dashboard";
import ClassesPage from "./Classes/ClassesPage";
import Subject from "./Classes/Subjects"
import Navbar from "../../components/Navbar";
import { useEffect, useState } from "react";
import Classworks from "./Classworks";
import Notifications from "./Notifications";

const TeacherApp = () => {
  const [activeNav, setActiveNav] = useState("Dashboard");

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7485/ingest/3a9a3448-1bd9-405f-8357-a95cb0abb46c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ccf95c'},body:JSON.stringify({sessionId:'ccf95c',runId:'pre-fix',hypothesisId:'H3',location:'TeacherApp.tsx:13',message:'TeacherApp activeNav changed',data:{activeNav},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [activeNav]);

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
