import Card from "../components/Card";

const StoryBoard = () => {
  return (
    <div>
      <header className="px-5 py-5 border-b border-gray-500">
        <h1 className="text-4xl font-semibold">Story Board</h1>
      </header>
      <main className="px-5 py-5 flex flex-row gap-4 min-h-screen">
        <div className="grid grid-cols-2 gap-4 w-[65%] self-start">
          <Card
            title="Computer Programming"
            teacher="Juan Dela Cruz"
            badges={[
              { label: "Quizzes", count: 1 },
              { label: "Assignments", count: 2 },
              { label: "Activities", count: 1 },
            ]}
          />
          <Card
            title="English"
            teacher="Marie Tess"
            badges={[
              { label: "Assignments", count: 1 },
              { label: "Readings", count: 1 },
            ]}
          />
          <Card
            title="Science & Technology"
            teacher="Jose Rizal"
            badges={[{ label: "Tasks All Completed", count: 0 }]}
          />
          <Card
            title="Mathematics"
            teacher="Maria Clara"
            badges={[
              { label: "Activities", count: 1 },
              { label: "Readings", count: 1 },
            ]}
          />
          <Card
            title="Filipino"
            teacher="Maripusa"
            badges={[
              { label: "Quizzes", count: 1 },
              { label: "Readings", count: 1 },
            ]}
          />
          <Card
            title="System Designs"
            teacher="Alden Richards"
            badges={[{ label: "Tasks All Completed", count: 0 }]}
          />
        </div>

        <div className="w-[35%] border rounded px-3 py-3 self-stretch shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <h2 className="text-xl font-bold">To Do</h2>
        </div>
      </main>
    </div>
  );
};

export default StoryBoard;
