import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Tabs } from "@/components/retroui/Tabs";
import SubjectLessonTab from "./tabs/subject-lesson-tab";
import SubjectClassworkTab from "./tabs/subject-classwork-tab";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";

type SubjectDetailProps = {
  subject: string;
  onBack: () => void;
};

const tabs = [
  { id: "lessons", label: "Lessons" },
  { id: "classwork", label: "Classwork" },
];

const SubjectDetail = ({ subject, onBack }: SubjectDetailProps) => {
  const [activeTab, setActiveTab] = useState("lessons");

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
              <SidebarTrigger className="md:hidden" />
              <button
                onClick={onBack}
                className="text-4xl font-semibold cursor-pointer"
              >
                Subjects
              </button>
              <ChevronRight size={40} />
              <h1 className="text-3xl font-bold">{subject}</h1>
            </header>
            <div className="px-4 md:px-6 bg-background -mt-[1px]">
              <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
            </div>

            <div className="border-t-1 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-4">
              <div>
                {activeTab === "lessons" && <SubjectLessonTab subject={subject} />}
                {activeTab === "classwork" && <SubjectClassworkTab />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default SubjectDetail;
