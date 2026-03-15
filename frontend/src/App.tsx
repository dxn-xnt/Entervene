import Navbar from "./components/Navbar";
import StoryBoard from "./pages/Storyboard";

const App = () => {
  return (
    <div className="flex min-h-screen">
      <Navbar />
      <main className="flex-1 bg-[#FFFDF5]">
        <StoryBoard />
      </main>
    </div>
  );
};

export default App;
