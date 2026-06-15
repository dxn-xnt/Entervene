import Card from "../../components/TeacherUIComponents/DashboardCard";
import AnnouncementCard from "../../components/TeacherUIComponents/AnnouncementCard";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ArrowUpRight } from "lucide-react";
import AppLayout from "@/layouts/app-layout";

const Grades = () => {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <div>
                <h1 className="text-2xl md:text-4xl font-semibold">Grades</h1>
                <p className="text-sm text-gray-500">
                  Good morning, teacher Dan!
                </p>
              </div>
            </header>

            <div className="-mx-4 md:-mx-6 border-b border-gray-500" />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
              <Card title="Subjects" count="3" stat="16" />
              <Card title="Classes" count="3" stat="12" />
              <Card title="Students" count="67" stat="1" />
              <Card title="Ungraded Classwork" count="56" stat="2" />
            </div>

            <div className="flex flex-col lg:flex-row items-stretch gap-5">
              <div className="flex flex-col flex-1 gap-5">
                <div className="border rounded px-5 py-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
                    <p className="text-2xl md:text-3xl font-semibold">
                      Performance Rate
                    </p>
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

                <div className="flex flex-col gap-3 border rounded px-5 py-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
                    <p className="text-2xl md:text-3xl font-semibold">
                      Announcement
                    </p>
                    <button className="self-start sm:self-auto px-3 py-1 border rounded bg-[#7ABA78] text-sm">
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

              <div className="lg:w-[35%] border rounded px-5 py-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex flex-row justify-between items-center">
                  <h2 className="text-2xl md:text-3xl font-semibold">
                    Class Activity
                  </h2>
                  <div className="border border-black rounded-full p-1 cursor-pointer">
                    <ArrowUpRight size={18} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Grades;
