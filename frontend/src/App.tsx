import Navbar from "./components/Navbar";
import StoryBoard from "./pages/Storyboard";
import ToDo from "./pages/ToDo";
import { useState } from "react";

const App = () => {
  const [activeNav, setActiveNav] = useState("Study Board");

  return (
    <div className="flex min-h-screen">
      <Navbar activeNav={activeNav} setActiveNav={setActiveNav} />
      <main className="flex-1 bg-[#FFFDF5]">
        {activeNav === "Study Board" && <StoryBoard />}
        {activeNav === "To Do" && <ToDo />}
      </main>
    </div>
  );
};

export default App;