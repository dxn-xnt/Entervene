import { useEffect, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SubjectCard } from "../../components/subject-card";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import {
  ArrowUpRight,
  Loader2,
  Search,
  X,
  CheckCircle2,
  FileText,
  Calendar,
  Check,
  Zap,
} from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useNavigate } from "react-router-dom";
import { routes } from "@/../routes";
import {
  apiFetch,
  getMyClass,
  getMyClassmates,
  getStudentTodos,
  type StudentClassmateItem,
  type StudentClassmatesResponse,
  type StudentMyClassSummary,
  type TodoItem,
} from "@/lib/api";
import { Badge } from "@/components/retroui/Badge";

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
  const [isClassmatesOpen, setIsClassmatesOpen] = useState(false);
  const [classmates, setClassmates] =
    useState<StudentClassmatesResponse | null>(null);
  const [isClassmatesLoading, setIsClassmatesLoading] = useState(false);
  const [classmatesError, setClassmatesError] = useState("");
  const [classmatesSearch, setClassmatesSearch] = useState("");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [isTodosLoading, setIsTodosLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/v1/students/me/subjects")
      .then((r) => r.json())
      .then((data) => setSubjects(data))
      .catch(() => { })
      .finally(() => setIsLoading(false));

    getMyClass()
      .then((data) => setMyClass(data))
      .catch(() => { });

    getStudentTodos()
      .then((data) => {
        const urgent = [...data.pastdue, ...data.pending].slice(0, 3);
        setTodos(urgent);
      })
      .catch(() => { })
      .finally(() => setIsTodosLoading(false));
  }, []);

  const openTodo = async (item: TodoItem) => {
    let targetClassId = item.class_id;

    if (!targetClassId && item.subject_id) {
      try {
        const res = await apiFetch("/api/v1/students/me/subjects");
        if (res.ok) {
          const subjects = await res.json();
          const match = subjects.find(
            (s: { subject_id: number; class_id: number }) =>
              s.subject_id === item.subject_id,
          );
          if (match) targetClassId = match.class_id;
        }
      } catch { }
    }

    if (targetClassId && item.subject_id) {
      navigate(
        `/student/subjects/${targetClassId}/${item.subject_id}?tab=classwork&classworkAssignmentId=${item.assignment_id}`,
      );
    } else {
      navigate(routes.student.todo);
    }
  };

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
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                  Study Board
                </h1>
              </div>
              <div className="flex items-center gap-2">
                {myClass && (
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={openClassmates}
                    className="whitespace-nowrap"
                  >
                    Classmates ({myClass.classmate_count})
                  </Button>
                )}
                <Button
                  type="button"
                  size="md"
                  onClick={() => navigate(routes.student.profile)}
                  className="gap-2 whitespace-nowrap"
                >
                  <Calendar className="size-4" />
                  View My Schedule
                </Button>
              </div>
            </header>

            <div className="-mx-4 md:-mx-6 border-b-2 border-border -mt-[1px]" />

            <div className="flex flex-1 flex-col gap-3">
              <div className="flex flex-col lg:flex-row lg:items-start gap-4 flex-1">
                {/* Left side: Subject cards */}
                <div className="grid grid-cols-2 gap-4 flex-1 content-start">
                  {isLoading ? (
                    <div className="col-span-2 flex justify-center py-16">
                      <Loader2
                        className="animate-spin text-gray-400"
                        size={36}
                      />
                    </div>
                  ) : subjects.length === 0 ? (
                    <Card className="flex flex-col items-center p-12">
                      <p className="text-sm">No enrolled subjects found.</p>
                    </Card>
                  ) : (
                    subjects.map((subject) => (
                      <SubjectCard
                        key={subject.subject_load_id}
                        title={subject.subject_name}
                        onClick={() => handleSubjectClick(subject)}
                        teacher={subject.teacher_name}
                        badges={[
                          {
                            label: subject.section_name || "Section",
                            count: 0,
                          },
                        ]}
                      />
                    ))
                  )}
                </div>

                {/* Right side: Top Card + To do Card */}
                <div className="flex flex-col gap-4 w-full lg:w-[30%] shrink-0">
                  <Card className="block w-full">
                    <Card.Content className="">
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-row gap-2 items-center">
                          <Zap size={20} fill="#ffdb33" />
                          <Text as="p" className="text-md font-semibold">
                            1 week streak
                          </Text>
                        </div>

                        <Text as="p" className="text-sm font-normal">
                          1-day streak — keep going, build the habit!
                        </Text>
                      </div>
                      <div className="flex flex-row mt-2 items-center w-full ">
                        <div className="flex flex-row gap-2 justify-between w-full">
                          <Badge
                            size="md"
                            variant="secondary"
                            className="items-center justify-center"
                          >
                            <Check size={17} className="mt-0.5" />
                          </Badge>
                          <Badge size="md" variant="default">
                            Tu
                          </Badge>
                          <Badge size="md" variant="default">
                            We
                          </Badge>
                          <Badge size="md" variant="secondary">
                            Th
                          </Badge>
                          <Badge size="md" variant="outline">
                            Fr
                          </Badge>
                          <Badge size="md" variant="outline">
                            Sa
                          </Badge>
                          <Badge size="md" variant="outline">
                            Su
                          </Badge>
                        </div>
                      </div>
                    </Card.Content>
                  </Card>

                  <Card className="block w-full">
                    <Card.Content>
                      <div className="flex items-center justify-between mb-4">
                        <Card.Title className="mb-0 text-2xl md:text-3xl">
                          To do
                        </Card.Title>

                        <button
                          type="button"
                          onClick={() => navigate(routes.student.todo)}
                          className="rounded-full border-2 border-black cursor-pointer p-1 transition-all hover:shadow-none"
                        >
                          <ArrowUpRight size={18} />
                        </button>
                      </div>

                      {isTodosLoading ? (
                        <div className="flex justify-center py-8">
                          <Loader2
                            className="animate-spin text-gray-400"
                            size={28}
                          />
                        </div>
                      ) : todos.length === 0 ? (
                        <div className="flex flex-col items-center py-6 text-gray-500 gap-1.5">
                          <CheckCircle2 size={32} className="text-green-500" />
                          <p className="text-sm font-semibold">
                            All caught up!
                          </p>
                          <p className="text-xs text-gray-400">
                            No pending tasks
                          </p>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2.5">
                          {todos.map((item) => (
                            <div
                              key={item.assignment_id}
                              onClick={() => openTodo(item)}
                              className="flex items-center gap-3 border-2 border-black bg-white p-3 rounded shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer hover:bg-yellow-50 transition-colors"
                            >
                              <FileText
                                size={20}
                                className="shrink-0 text-black/70"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-semibold text-sm">
                                  {item.title}
                                </p>
                                <p className="truncate text-xs text-gray-600">
                                  {item.subject} · {item.deadline}
                                </p>
                              </div>
                              {item.status === "pastdue" && (
                                <span className="shrink-0 text-[10px] uppercase font-bold text-red-700 bg-red-100 border border-red-400 px-1.5 py-0.5 rounded">
                                  Past Due
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </Card.Content>
                  </Card>
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
