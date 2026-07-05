import { useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SubjectCard } from "../../components/SubjectCard";
import { ArrowUpRight, Loader2, BookOpen, Search, X } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useNavigate } from "react-router-dom";
import { routes } from "@/../routes";
import {
  apiFetch,
  getMyClass,
  getMyClassmates,
  type StudentClassmateItem,
  type StudentClassmatesResponse,
  type StudentMyClassSummary,
} from "@/lib/api";

interface EnrolledSubject {
  subject_load_id: number;
  class_id: number;
  subject_id: number;
  subject_name: string;
  teacher_name: string;
  section_name: string;
}

const StoryBoard = () => {
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState<EnrolledSubject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [myClass, setMyClass] = useState<StudentMyClassSummary | null>(null);
  const [classError, setClassError] = useState("");
  const [isClassmatesOpen, setIsClassmatesOpen] = useState(false);
  const [classmates, setClassmates] =
    useState<StudentClassmatesResponse | null>(null);
  const [isClassmatesLoading, setIsClassmatesLoading] = useState(false);
  const [classmatesError, setClassmatesError] = useState("");
  const [classmatesSearch, setClassmatesSearch] = useState("");

  useEffect(() => {
    apiFetch("/api/v1/students/me/subjects")
      .then((r) => r.json())
      .then((data) => setSubjects(data))
      .catch(() => {})
      .finally(() => setIsLoading(false));

    getMyClass()
      .then((data) => setMyClass(data))
      .catch((error) =>
        setClassError(
          error instanceof Error
            ? error.message
            : "Unable to load your section.",
        ),
      );
  }, []);

  const handleSubjectClick = (subject: EnrolledSubject) => {
    navigate(
      routes.student.subjectDetail
        .replace(":classId", String(subject.class_id))
        .replace(":subjectId", String(subject.subject_id)),
    );
  };

  const openClassmates = () => {
    setIsClassmatesOpen(true);
    if (classmates || isClassmatesLoading) return;
    setIsClassmatesLoading(true);
    setClassmatesError("");
    getMyClassmates()
      .then((data) => setClassmates(data))
      .catch((error) =>
        setClassmatesError(
          error instanceof Error ? error.message : "Unable to load classmates.",
        ),
      )
      .finally(() => setIsClassmatesLoading(false));
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6 flex-1">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                Storyboard
              </h1>
            </header>

            <div className="-mx-4 md:-mx-6 border-b border-gray-500" />

            {myClass ? (
              <section className="flex flex-col gap-4 border-2 border-black bg-[#f7e9aa] px-5 py-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-black bg-[#79c889] text-lg font-bold">
                    {(myClass.section_name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-semibold">
                      {myClass.grade_level} · {myClass.section_name}
                    </h2>
                    <p className="truncate text-sm">
                      Adviser: {myClass.adviser_name || "Not assigned"} ·{" "}
                      {myClass.classmate_count}{" "}
                      {myClass.classmate_count === 1
                        ? "classmate"
                        : "classmates"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openClassmates}
                  className="h-10 border-2 border-black bg-white px-5 text-sm font-semibold shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  View classmates
                </button>
              </section>
            ) : classError ? (
              <p className="text-sm text-gray-500">No section assigned yet.</p>
            ) : null}

            <div className="flex flex-col lg:flex-row lg:items-stretch gap-4 flex-1">
              <div className="grid grid-cols-2 gap-4 flex-1 content-start">
                {isLoading ? (
                  <div className="col-span-2 flex justify-center py-16">
                    <Loader2 className="animate-spin text-gray-400" size={36} />
                  </div>
                ) : subjects.length === 0 ? (
                  <div className="col-span-2 flex flex-col items-center py-16 gap-3 text-gray-400">
                    <BookOpen size={40} className="opacity-50" />
                    <p>No enrolled subjects found</p>
                  </div>
                ) : (
                  subjects.map((subject) => (
                    <SubjectCard
                      key={subject.subject_load_id}
                      title={subject.subject_name}
                      onClick={() => handleSubjectClick(subject)}
                      teacher={subject.teacher_name}
                      badges={[
                        { label: subject.section_name || "Section", count: 0 },
                      ]}
                    />
                  ))
                )}
              </div>

              <div className="lg:w-[35%] border-2 rounded-lg px-5 py-5 shadow-md transition-all hover:shadow-none bg-card">
                <div className="flex flex-row justify-between items-center">
                  <h2 className="text-2xl md:text-3xl font-semibold">To do</h2>
                  <button
                    onClick={() => navigate(routes.student.todo)}
                    className="border border-black rounded-full p-1 cursor-pointer"
                  >
                    <ArrowUpRight size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {isClassmatesOpen && (
        <ClassmatesModal
          classmates={classmates?.classmates ?? []}
          isLoading={isClassmatesLoading}
          error={classmatesError}
          search={classmatesSearch}
          sectionName={
            classmates?.section_name ?? myClass?.section_name ?? "Classmates"
          }
          onSearchChange={setClassmatesSearch}
          onClose={() => setIsClassmatesOpen(false)}
        />
      )}
    </AppLayout>
  );
};

export default StoryBoard;

function ClassmatesModal({
  classmates,
  isLoading,
  error,
  search,
  sectionName,
  onSearchChange,
  onClose,
}: {
  classmates: StudentClassmateItem[];
  isLoading: boolean;
  error: string;
  search: string;
  sectionName: string;
  onSearchChange: (value: string) => void;
  onClose: () => void;
}) {
  const query = search.trim().toLocaleLowerCase();
  const filtered = classmates
    .filter(
      (student) =>
        !query || student.full_name.toLocaleLowerCase().includes(query),
    )
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const groups = groupClassmates(filtered);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
      <section className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border-2 border-black bg-[#fffdf5] shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
        <header className="flex items-center justify-between border-b-2 border-black bg-[#f7e9aa] px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold">{sectionName} Classmates</h2>
            <p className="text-sm text-black/70">Read-only class roster</p>
          </div>
          <button
            type="button"
            aria-label="Close classmates"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full border border-black bg-white"
          >
            <X size={18} />
          </button>
        </header>

        <div className="border-b border-black p-4">
          <label className="flex h-10 items-center gap-2 border border-black bg-white px-3">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search classmates..."
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
        </div>

        <div className="min-h-0 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="animate-spin text-gray-400" size={32} />
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-red-600">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">
              No classmates found.
            </p>
          ) : (
            <div className="grid gap-3">
              {groups.map(([label, students]) => (
                <section
                  key={label}
                  className="overflow-hidden rounded-lg border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                >
                  <div className="flex items-center justify-between bg-[#f7e9aa] px-4 py-2 text-sm font-semibold uppercase">
                    <span>{label}</span>
                    <span className="rounded-full border border-black bg-white px-2 py-0.5 text-xs normal-case">
                      {students.length}
                    </span>
                  </div>
                  {students.map((student) => (
                    <div
                      key={student.student_id}
                      className="flex min-h-12 items-center gap-3 border-t border-black/15 px-4 py-2"
                    >
                      <div className="grid size-8 shrink-0 place-items-center rounded-full border border-[#c97900] bg-[#ffd27a] text-sm font-semibold">
                        {(student.avatar_initial || student.full_name || "?")
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                      <p className="min-w-0 truncate text-sm font-semibold">
                        {student.full_name}
                      </p>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function groupClassmates(
  students: StudentClassmateItem[],
): Array<[string, StudentClassmateItem[]]> {
  const groups: Array<[string, StudentClassmateItem[]]> = [
    ["Male", []],
    ["Female", []],
    ["Other/Unspecified", []],
  ];

  students.forEach((student) => {
    const gender = (student.gender || "").trim().toLocaleLowerCase();
    if (["male", "m", "boy"].includes(gender)) groups[0][1].push(student);
    else if (["female", "f", "girl"].includes(gender))
      groups[1][1].push(student);
    else groups[2][1].push(student);
  });

  return groups.filter(([, items]) => items.length > 0);
}
