import Card from "../../components/TeacherUIComponents/DashboardCard";
import AnnouncementCard from "../../components/TeacherUIComponents/AnnouncementCard";
import { ArrowUpRight } from "lucide-react";
const Dashboard = () => {
  return (
    <div>
      <header className="px-5 py-5 flex flex-col gap-2 border-b border-gray-500">
        <h1 className="text-4xl font-semibold">Dashboard</h1>
        <p className="text-sm text-gray-500">Good morning, teacher Dan!</p>
      </header>
      <main className="px-5 py-5 flex flex-col gap-4 min-h-screen">
        <div className="grid grid-cols-4 gap-4 w-full self-start">
          <Card title="Subjects" count="3" stat="16" />
          <Card title="Classes" count="3" stat="12" />
          <Card title="Students" count="67" stat="1" />
          <Card title="Ungraded Classwork" count="56" stat="2" />
        </div>
        <div className="flex flex-row items-stretch flex-1 gap-5">
          <div className="flex flex-col flex-1 gap-5">
            <div className="flex-1 border rounded px-5 py-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex flex-row justify-between items-center">
                <p className="text-3xl font-semibold">Performance Rate</p>
                <div className="flex flex-row gap-2">
                  <select className="border rounded px-3 py-1 text-sm cursor-pointer">
                    <option>Science</option>
                    <option>Math</option>
                    <option>English</option>
                  </select>
                  <select className="border rounded px-3 py-1 text-sm cursor-pointer">
                    <option>All Section</option>
                    <option>Section A</option>
                    <option>Section B</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 flex-1 border rounded px-5 py-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div className="flex flex-row justify-between">
                <p className="text-3xl font-semibold">Announcement</p>
                <button className="px-3 border rounded bg-[#7ABA78]">
                  + New Announcement
                </button>
              </div>
              <div className="flex flex-col gap-3">
                <AnnouncementCard
                  title="Second Quarter Exam"
                  category="General"
                  dateTime="Nov. 25, 2026 - 11:45 PM"
                />
                <AnnouncementCard
                  title="1st Quarter Grade Computing"
                  category="Teachers"
                  dateTime="Nov. 25, 2026 - 11:45 PM"
                />
              </div>
            </div>
          </div>
          <div className="w-[35%] border rounded px-5 py-5 self-stretch shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex flex-row justify-between items-center">
              <h2 className="text-3xl font-semibold">Class Activity</h2>
              <div className="border border-black rounded-full p-1 cursor-pointer">
                <ArrowUpRight size={18} />
              </div>

              {/* <button
                onClick={() => setActiveNav("To Do")}
                className="border border-black rounded-full p-1 cursor-pointer"
              >
                <ArrowUpRight size={18} />
              </button> */}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
