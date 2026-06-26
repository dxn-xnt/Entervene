import { BookOpen, ChevronDown, ChevronRight, ClipboardList, Eye, FileText, Pencil, Plus, Search } from "lucide-react";
import type { Lesson, LinkedClasswork } from "./types";

type LessonClassworkListProps = {
  lessonSearch: string;
  setLessonSearch: (value: string) => void;
  filteredLessons: Lesson[];
  totalLessons: number;
  expandedLessonId: number | null;
  linkedClassworks: Record<number, LinkedClasswork[]>;
  loadingClassworkId: number | null;
  toggleLesson: (lessonId: number) => void;
  openLessonManager: (lesson: Lesson) => void;
  openClassworkForm: (lesson: Lesson) => void;
  openClassworkDetail: (classwork: LinkedClasswork) => void;
};

export default function LessonClassworkList({
  lessonSearch,
  setLessonSearch,
  filteredLessons,
  totalLessons,
  expandedLessonId,
  linkedClassworks,
  loadingClassworkId,
  toggleLesson,
  openLessonManager,
  openClassworkForm,
  openClassworkDetail,
}: LessonClassworkListProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 md:w-80">
          <Search size={16} className="text-gray-500" />
          <input
            type="search"
            value={lessonSearch}
            onChange={(event) => setLessonSearch(event.target.value)}
            className="w-full bg-transparent text-sm outline-none placeholder:text-gray-500"
            placeholder="Search lessons"
          />
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium"
        >
          <ChevronDown size={16} />
          Sort By
        </button>
      </div>

      {filteredLessons.length > 0 ? (
        filteredLessons.map((lesson) => {
          const isExpanded = expandedLessonId === lesson.lesson_id;
          const classworks = linkedClassworks[lesson.lesson_id] || [];

          return (
            <div key={lesson.lesson_id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-black bg-[#F6E9B2] px-4 py-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <button
                  type="button"
                  onClick={() => toggleLesson(lesson.lesson_id)}
                  className="flex min-w-0 flex-1 items-center justify-between text-left"
                >
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <p className="truncate text-2xl font-bold text-gray-950">{lesson.title}</p>
                      <span className="rounded-full border border-black bg-white px-2 py-0.5 text-[10px] font-bold">
                        {lesson.is_published ? "Published" : "Draft"}
                      </span>
                      {lesson.attachments.length > 0 && (
                        <span className="rounded-full border border-black bg-[#7ABA78] px-2 py-0.5 text-[10px] font-bold">
                          {lesson.attachments.length} material{lesson.attachments.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs font-medium text-gray-700">
                      {lesson.description ||
                        (lesson.created_at
                          ? `Created ${new Date(lesson.created_at).toLocaleDateString()}`
                          : "Lesson folder")}
                    </p>
                  </div>
                  {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>
                <button
                  type="button"
                  onClick={() => openLessonManager(lesson)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-black bg-white px-3 py-2 text-xs font-bold hover:bg-gray-50"
                >
                  <Pencil size={14} />
                  Manage
                </button>
              </div>

              {isExpanded && (
                <div className="ml-3 flex flex-col gap-2 border-l-2 border-black pl-3">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => openClassworkForm(lesson)}
                      className="inline-flex items-center gap-2 rounded-lg border border-black bg-[#7ABA78] px-3 py-2 text-sm font-semibold shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <Plus size={16} />
                      Add Classwork
                    </button>
                  </div>
                  {loadingClassworkId === lesson.lesson_id ? (
                    <div className="rounded-lg border border-black bg-white px-4 py-3 text-sm font-medium shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                      Loading classworks...
                    </div>
                  ) : classworks.length > 0 ? (
                    classworks.map((classwork) => (
                      <button
                        type="button"
                        key={classwork.classwork_assignment_id}
                        onClick={() => openClassworkDetail(classwork)}
                        className="grid w-full grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-3 rounded-lg border border-black bg-white px-4 py-3 text-left shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-0.5"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <FileText size={20} />
                          <div className="min-w-0">
                            <p className="truncate text-lg font-bold">{classwork.title}</p>
                            <p className="text-xs font-medium text-gray-700">
                              {classwork.classwork_type || "Classwork"}
                              {classwork.due_date ? ` | Due ${new Date(classwork.due_date).toLocaleDateString()}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex min-w-28 justify-center">
                          {classwork.attachment_count ? (
                            <span className="whitespace-nowrap rounded-full bg-[#7ABA78] px-3 py-1 text-xs font-semibold">
                              File {classwork.attachment_count}
                            </span>
                          ) : (
                            <span aria-hidden="true" className="h-7 w-20" />
                          )}
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold">
                          <Eye size={14} />
                          Details
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="flex items-center justify-between rounded-lg border border-black bg-white px-4 py-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                      <div className="flex items-center gap-3">
                        <ClipboardList size={20} />
                        <div>
                          <p className="text-lg font-bold">No classworks yet</p>
                          <p className="text-xs font-medium">
                            Readings, activities, assignments, and quizzes linked to this lesson will appear here.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      ) : totalLessons > 0 ? (
        <div className="flex items-center justify-between rounded-lg border border-black bg-white px-4 py-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div>
            <p className="text-lg font-bold">No matching lessons</p>
            <p className="text-xs font-medium">Try a different lesson name or description.</p>
          </div>
          <Search size={20} />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-lg border border-black bg-[#F6E9B2] px-4 py-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div>
              <p className="text-2xl font-bold">No lessons yet</p>
              <p className="text-xs font-medium">Use Add Lesson to create the first lesson for this subject.</p>
            </div>
            <BookOpen size={20} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-black bg-white px-4 py-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex items-center gap-3">
              <ClipboardList size={20} />
              <div>
                <p className="text-lg font-bold">Classwork</p>
                <p className="text-xs font-medium">Assignments and activities for this subject appear here.</p>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
