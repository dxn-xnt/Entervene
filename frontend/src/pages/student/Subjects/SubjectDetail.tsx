import { useState } from "react";
import { ChevronRight } from "lucide-react";
<<<<<<<< HEAD:frontend/src/pages/student/subject-view.tsx
import Tabs from "../../components/Tabs";
import SubjectLessonTab from "../StudentInterfaces/Subjects/tabs/SubjectLessonTab";
import SubjectClassworkTab from "../StudentInterfaces/Subjects/tabs/SubjectClassworkTab";
========
import Tabs from "../../../components/Tabs";
import SubjectLessonTab from "./tabs/SubjectLessonTab";
import SubjectClassworkTab from "./tabs/SubjectClassworkTab";
import AppLayout from "@/layouts/app-layout";
>>>>>>>> 9c5e4e84b21793047b3bdafa6bccde4f1fa77064:frontend/src/pages/student/Subjects/SubjectDetail.tsx

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
      <header className="px-5 py-5 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-4xl font-semibold cursor-pointer"
        >
          Subjects
        </button>
        <ChevronRight size={40} />
        <h1 className="text-3xl">{subject}</h1>
      </header>
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      <main className="px-5 py-5">
        <div>
          {activeTab === "lessons" && <SubjectLessonTab subject={subject} />}
          {activeTab === "classwork" && <SubjectClassworkTab />}
        </div>
      </main>
    </AppLayout>
  );
};

export default SubjectDetail;
