import { useState } from "react";
import { ChevronRight } from "lucide-react";
import Tabs from "../../components/Tabs";
import SubjectLessonTab from "./tabs/SubjectLessonTab";

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
    <div>
      <header className="px-5 py-5 flex items-center gap-3">
        <button onClick={onBack} className="text-4xl font-semibold cursor-pointer">
          Subjects
        </button>
        <ChevronRight size={40} />
        <h1 className="text-3xl">{subject}</h1>
      </header>
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      <main className="px-5 py-5">
        {activeTab === "lessons" && <SubjectLessonTab subject={subject} />}
        {activeTab === "classwork" && <div />}
      </main>
    </div>
  );
};

export default SubjectDetail;