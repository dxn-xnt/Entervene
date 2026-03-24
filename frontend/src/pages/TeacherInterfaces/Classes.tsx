import Card from "../../components/TeacherUIComponents/ClassesCard";
import { ArrowUpRight } from "lucide-react";

const Classes = () => {
  return (
    <div>
      <header className="px-5 py-5 flex flex-col gap-2 border-b border-gray-500">
        <h1 className="text-4xl font-semibold">Classes</h1>
      </header>
      <main className="px-5 py-5 flex flex-col gap-5">
        <div className="flex flex-col border rounded px-5 py-5 gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex flex-row justify-between">
            <p className="text-3xl font-semibold">Subjects</p>
            <div className="border border-black rounded-full p-1 cursor-pointer">
              <ArrowUpRight size={18} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4 w-full self-start">
            <Card
              title="Computer Programming"
              badges={[
                { label: "Quizzes", count: 1 },
                { label: "Assignemnts", count: 2 },
              ]}
            />
            <Card
              title="English"
              badges={[
                { label: "Quizzes", count: 1 },
                { label: "Assignemnts", count: 2 },
              ]}
            />
          </div>
        </div>
        <div className="flex flex-col border rounded px-5 py-5 gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex flex-row justify-between">
            <p className="text-3xl font-semibold">Classes</p>
            <div className="border border-black rounded-full p-1 cursor-pointer">
              <ArrowUpRight size={18} />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4 w-full self-start">
            <Card
              title="7-Sapphire"
              subtitle="Computer Programming"
              badges={[
                { label: "Quizzes", count: 1 },
                { label: "Assignemnts", count: 2 },
              ]}
            />
            <Card
              title="10-Emerald"
              subtitle="English"
              badges={[
                { label: "Quizzes", count: 1 },
                { label: "Assignemnts", count: 2 },
                { label: "Assignemnts", count: 2 },
                { label: "Assignemnts", count: 2 },
                { label: "Assignemnts", count: 2 },
                { label: "Assignemnts", count: 2 },
              ]}
            />
          </div>
        </div>
      </main>
    </div>
  );
};

export default Classes;
