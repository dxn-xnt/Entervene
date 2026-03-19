import Navbar from "./components/StudentUIComponents/Navbar";
import StoryBoard from "./pages/StudentInterfaces/Storyboard";
import ToDo from "./pages/StudentInterfaces/ToDo";
import Grades from "./pages/StudentInterfaces/Grades/Grades";
import Subjects from "./pages/StudentInterfaces/Subjects/Subjects";
import SubjectDetail from "./pages/StudentInterfaces/Subjects/SubjectDetail";
import { useState } from "react";

const App = () => {
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
            <SubjectDetail
              subject={activeSubject}
              onBack={() => setActiveSubject(null)}
            />
          ) : (
            <StoryBoard
              onSelectSubject={(subject) => {
                setActiveSubject(subject);
                setActiveNav("Subjects");
              }}
            />
          ))}
        {activeNav === "To Do" && <ToDo />}
        {activeNav === "Subjects" &&
          (activeSubject ? (
            <SubjectDetail
              subject={activeSubject}
              onBack={() => setActiveSubject(null)}
            />
          ) : (
            <Subjects onSelectSubject={setActiveSubject} />
          ))}
        {activeNav === "Grades" && <Grades />}  
      </main>
    </div>
  );
};

export default App;
