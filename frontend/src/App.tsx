import Navbar from "./components/Navbar";

const App = () => {
  return (
    <div className="flex min-h-screen">
      <Navbar />
      <main className="flex-1 bg-white p-8">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
      </main>
    </div>
  );
};

export default App;