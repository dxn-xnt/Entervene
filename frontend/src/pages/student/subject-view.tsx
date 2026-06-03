import { useState } from "react";
import { ChevronRight } from "lucide-react";
import Tabs from "../../components/Tabs";
import AppLayout from "@/layouts/app-layout";
import SubjectLessonTab from "./Subjects/tabs/SubjectLessonTab";
import SubjectClassworkTab from "./Subjects/tabs/SubjectClassworkTab";

type SubjectDetailProps = {
  subject: string;
  classId?: number;
  subjectId?: number;
  onBack: () => void;
};

const tabs = [
  { id: "lessons", label: "Lessons" },
  { id: "classwork", label: "Classwork" },
];

const SubjectDetail = ({ subject, classId, subjectId }: SubjectDetailProps) => {
  const [activeTab, setActiveTab] = useState("lessons");

  return (
    <AppLayout>
      <header className="px-5 py-5 flex items-center gap-3">
        <ChevronRight size={40} />
        <h1 className="text-3xl">{subject}</h1>
      </header>
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      <main className="px-5 py-5">
        <div>
          {activeTab === "lessons" && (
            <SubjectLessonTab
              subject={subject}
              classId={classId}
              subjectId={subjectId}
            />
          )}
          {activeTab === "classwork" && (
            <SubjectClassworkTab classId={classId} subjectId={subjectId} />
          )}
        </div>
      </main>
    </AppLayout>
  );
};

export default SubjectDetail;
