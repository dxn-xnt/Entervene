import Navbar from "../../components/Navbar";
import StoryBoard from "./Storyboard";
import ToDo from "./ToDo";
import Grades from "./Grades/Grades";
import Subjects from "./Subjects/Subjects";
import SubjectDetail from "./Subjects/SubjectDetail";
import Notifications from "./Notifications";
import { useState } from "react";

const StudentApp = () => {
  const [activeNav, setActiveNav] = useState("Study Board");
  const [activeSubject, setActiveSubject] = useState<string | null>(null);

  return (
    <div className="flex min-h-screen">
      <Navbar
        activeNav={activeNav}
        setActiveNav={(nav) => {
          setActiveNav(nav);
          setActiveSubject(null);
        }}
      />
      <main className="flex-1 bg-[#FFFDF5]">
        {activeNav === "Study Board" &&
          (activeSubject ? (
            <SubjectDetail subject={activeSubject} onBack={() => setActiveSubject(null)} />
          ) : (
            <StoryBoard
              setActiveNav={setActiveNav}
              onSelectSubject={(subject) => {
                setActiveSubject(subject);
                setActiveNav("Subjects");
              }}
            />
          ))}
        {activeNav === "To Do" && <ToDo />}
        {activeNav === "Subjects" &&
          (activeSubject ? (
            <SubjectDetail subject={activeSubject} onBack={() => setActiveSubject(null)} />
          ) : (
            <Subjects onSelectSubject={setActiveSubject} />
          ))}
        {activeNav === "Grades" && <Grades />}
        {activeNav === "Notifications" && <Notifications />}
      </main>
    </div>
  );
};

export default StudentApp;