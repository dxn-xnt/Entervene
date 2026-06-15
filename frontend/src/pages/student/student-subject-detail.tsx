import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { BookOpen, ClipboardList, Loader2 } from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import Tabs from "@/components/Tabs";
import SubjectLessonTab from "./Subjects/tabs/subject-lesson-tab";
import SubjectClassworkTab from "./Subjects/tabs/subject-classwork-tab";
import { routes } from "@/../routes";
import { apiFetch } from "@/lib/api";

interface SubjectInfo {
  subject_name: string;
  teacher_name: string;
  class_id: number;
  subject_id: number;
}

const tabs = [
  { id: "lessons", label: "Lessons", icon: <BookOpen size={14} /> },
  { id: "classwork", label: "Classwork", icon: <ClipboardList size={14} /> },
];

const StudentSubjectDetail = () => {
  const { classId, subjectId } = useParams<{ classId: string; subjectId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("lessons");
  const [subjectInfo, setSubjectInfo] = useState<SubjectInfo | null>(null);

  const numericClassId = classId ? parseInt(classId, 10) : undefined;
  const numericSubjectId = subjectId ? parseInt(subjectId, 10) : undefined;

  useEffect(() => {
    if (!numericClassId || !numericSubjectId) return;
    apiFetch("/api/v1/students/me/subjects")
      .then((r) => r.json())
      .then((data: SubjectInfo[]) => {
        const match = data.find(
          (s) => s.class_id === numericClassId && s.subject_id === numericSubjectId,
        );
        if (match) setSubjectInfo(match);
      })
      .catch(() => {});
  }, [numericClassId, numericSubjectId]);

  // Guard: invalid URL params
  if (!numericClassId || !numericSubjectId) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-screen gap-3">
          <p className="text-red-500 text-lg">Invalid subject or class.</p>
          <button
            onClick={() => navigate(routes.student.subjects)}
            className="text-sm underline text-gray-500 hover:text-gray-800"
          >
            Back to Subjects
          </button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {/* ── Page header: subject title ── */}
      <header className="px-5 py-5 border-b border-gray-200">
        {subjectInfo ? (
          <h1 className="text-4xl font-bold">{subjectInfo.subject_name}</h1>
        ) : (
          <div className="flex items-center gap-3">
            <Loader2 className="animate-spin text-gray-400" size={24} />
            <span className="text-gray-400 text-xl">Loading subject...</span>
          </div>
        )}
      </header>

      {/* ── Tab bar ── */}
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* ── Tab content ── */}
      <main className="px-5 py-5">
        {activeTab === "lessons" && (
          <SubjectLessonTab
            classId={numericClassId}
            subjectId={numericSubjectId}
            subjectName={subjectInfo?.subject_name}
            teacherName={subjectInfo?.teacher_name}
          />
        )}
        {activeTab === "classwork" && (
          <SubjectClassworkTab
            classId={numericClassId}
            subjectId={numericSubjectId}
          />
        )}
      </main>
    </AppLayout>
  );
};

export default StudentSubjectDetail;
