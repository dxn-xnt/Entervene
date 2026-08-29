import {
  ArrowLeft,
  Award,
  BookOpen,
  Calendar,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Eye,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import type { CompetencyItem } from "./types";

export interface CompetencyLessonItem {
  lesson_id: number;
  title: string;
  description?: string | null;
  content?: string | null;
  competency_id?: number | null;
  competency_code?: string | null;
  competency_statement?: string | null;
  order_index?: number;
  created_at?: string;
  updated_at?: string;
  is_published: boolean;
  show_scores?: boolean;
  is_draft?: boolean;
  is_archived?: boolean;
  attachments?: Array<{
    lesson_attachment_id: number;
    file_name: string;
    file_type?: string;
    file_size: number;
  }>;
}

export interface CompetencyLinkedClasswork {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  classwork_type?: string | null;
  classwork_category?: string | null;
  due_date?: string | null;
  total_points?: number | null;
  attachment_count?: number;
  is_published?: boolean;
  is_locked?: boolean;
}

interface TeacherCompetencyDetailScreenProps {
  competency: CompetencyItem;
  lessons: CompetencyLessonItem[];
  linkedClassworks: Record<number, CompetencyLinkedClasswork[]>;
  loadingClassworkId: number | null;
  expandedLessonId: number | null;
  toggleLesson: (lessonId: number) => void;
  onBack: () => void;
  onAddLesson: (competencyId: number) => void;
  onEditCompetency: (competency: CompetencyItem) => void;
  onArchiveCompetency?: (competencyId: number) => void;
  onOpenClassworkForm?: (lesson: CompetencyLessonItem) => void;
  onOpenClassworkDetail?: (classwork: CompetencyLinkedClasswork) => void;
  onOpenLessonDetail?: (lesson: CompetencyLessonItem) => void;
  onOpenLessonManager?: (lesson: CompetencyLessonItem) => void;
}

function ClassworkIcon({
  type,
  size = 16,
}: {
  type?: string | null;
  size?: number;
}) {
  switch (type?.toLowerCase()) {
    case "quiz":
      return <ClipboardList size={size} />;
    case "assignment":
      return <BookOpen size={size} />;
    default:
      return <FileText size={size} />;
  }
}

export default function TeacherCompetencyDetailScreen({
  competency,
  lessons,
  linkedClassworks,
  loadingClassworkId,
  expandedLessonId,
  toggleLesson,
  onBack,
  onAddLesson,
  onEditCompetency,
  onArchiveCompetency,
  onOpenClassworkForm,
  onOpenClassworkDetail,
  onOpenLessonDetail,
  onOpenLessonManager,
}: TeacherCompetencyDetailScreenProps) {
  // Count total classworks across all lessons in this competency
  const totalClassworks = lessons.reduce((acc, l) => {
    return acc + (linkedClassworks[l.lesson_id]?.length || 0);
  }, 0);

  const totalMaterials = lessons.reduce((acc, l) => {
    return acc + (l.attachments?.length || 0);
  }, 0);

  return (
    <div className="flex flex-col gap-4 min-w-0 w-full">
      {/* ── Simple Top Back Button ── */}
      <div className="flex items-center justify-start min-w-0">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBack}
          className="gap-2 border-2 border-black bg-white hover:bg-yellow-50 text-black font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
        >
          <ArrowLeft size={16} />
          Back
        </Button>
      </div>

      {/* ── Hero Competency Information Banner ── */}
      <Card className="block w-full border-2 border-black bg-[#F6E9B2] p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2.5 mb-2.5">
                <span className="inline-flex items-center gap-1.5 rounded border-2 border-black bg-white px-2.5 py-1 text-xs font-bold text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                  <Award size={14} className="text-black shrink-0" />
                  Learning Competency
                </span>
                {competency.competency_code && (
                  <span className="inline-flex items-center rounded border-2 border-black bg-white px-2.5 py-1 text-xs font-black text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                    {competency.competency_code}
                  </span>
                )}
                {(competency.target_hours || 0) > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded border-2 border-black bg-white px-3 py-1 text-xs font-bold text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                    <Clock size={13} className="text-black shrink-0" />
                    {competency.target_hours} Target Hours
                  </span>
                )}
              </div>

              <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-gray-950 leading-tight break-words">
                {competency.statement}
              </h2>
            </div>

            {/* Quick Action Toolbar on Competency */}
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onEditCompetency(competency)}
                className="gap-1.5 border-2 border-black bg-white hover:bg-yellow-50 text-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                title="Edit Competency statement or code"
              >
                <Pencil size={14} />
                Edit
              </Button>
              {onArchiveCompetency && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onArchiveCompetency(competency.competency_id)}
                  className="gap-1.5 border-2 border-black bg-red-100 hover:bg-red-200 text-red-800 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  title="Archive Competency"
                >
                  <Trash2 size={14} />
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onAddLesson(competency.competency_id)}
                className="gap-1.5 border-2 border-black bg-white hover:bg-yellow-50 text-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              >
                <Plus size={14} />
                Add Lesson
              </Button>
            </div>
          </div>

          {/* Metrics summary bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t-2 border-black/20 pt-3 text-xs">
            <div className="flex flex-col">
              <span className="font-semibold text-gray-700">Target Duration</span>
              <span className="text-base font-extrabold text-black">
                {(competency.target_hours || 0) > 0 ? `${competency.target_hours} hours` : "Not set"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-gray-700">Assigned Lessons</span>
              <span className="text-base font-extrabold text-black">
                {lessons.length} lesson{lessons.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-gray-700">Linked Classworks</span>
              <span className="text-base font-extrabold text-black">
                {totalClassworks} classwork{totalClassworks === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-gray-700">Reference Materials</span>
              <span className="text-base font-extrabold text-black">
                {totalMaterials} file{totalMaterials === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Lessons & Classworks List Section ── */}
      <div className="flex flex-col gap-4 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-black" />
            <h3 className="text-lg sm:text-xl font-bold text-black">
              Lessons & Classwork in this Competency
            </h3>
            <Badge
              variant="secondary"
              size="sm"
              className="border-2 border-black bg-white text-black font-bold text-xs shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
            >
              {lessons.length}
            </Badge>
          </div>
        </div>

        {lessons.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-black bg-white p-8 text-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
            <BookOpen size={36} className="text-gray-400 mb-2" />
            <h4 className="text-base font-bold text-black mb-1">
              No lessons created for this competency yet
            </h4>
            <p className="text-xs text-gray-600 max-w-sm mb-4">
              Add your first lesson notes, attached materials, and assign quizzes or activities to this learning competency.
            </p>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => onAddLesson(competency.competency_id)}
              className="gap-1.5 border-2 border-black bg-[#F6E9B2] hover:bg-[#fae498] text-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              <Plus size={14} />
              Create First Lesson
            </Button>
          </div>
        ) : (
          <div className="space-y-4 min-w-0">
            {lessons.map((lesson) => {
              const isExpanded = expandedLessonId === lesson.lesson_id;
              const classworks = linkedClassworks[lesson.lesson_id] || [];
              const isLoadingCw = loadingClassworkId === lesson.lesson_id;

              return (
                <div
                  key={lesson.lesson_id}
                  className="flex flex-col gap-2 min-w-0 w-full"
                >
                  {/* Lesson Card with Warm Yellow Theme */}
                  <div className="w-full min-w-0 rounded-lg border-2 border-black bg-[#F6E9B2] p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:border-black transition-all">
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1.5 min-w-0">
                          <h4
                            role="button"
                            tabIndex={0}
                            onClick={() => onOpenLessonDetail && onOpenLessonDetail(lesson)}
                            className="text-base sm:text-lg font-bold text-black hover:underline cursor-pointer break-words line-clamp-2"
                          >
                            {lesson.title}
                          </h4>
                          <Badge
                            variant="outline"
                            size="sm"
                            className="border-2 border-black bg-white text-black font-bold text-xs shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] shrink-0"
                          >
                            {lesson.is_published ? "Published" : "Draft"}
                          </Badge>
                          {lesson.attachments && lesson.attachments.length > 0 && (
                            <Badge
                              size="sm"
                              className="border-2 border-black bg-white text-black font-bold text-xs shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] shrink-0 gap-1"
                            >
                              <Paperclip size={10} />
                              {lesson.attachments.length} material{lesson.attachments.length === 1 ? "" : "s"}
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            size="sm"
                            className="border-2 border-black bg-white text-black font-bold text-xs shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] shrink-0"
                          >
                            {classworks.length} classwork{classworks.length === 1 ? "" : "s"}
                          </Badge>
                        </div>

                        <p className="text-xs font-medium text-gray-800 break-words line-clamp-2 mb-2">
                          {lesson.description || lesson.content || "Lesson folder"}
                        </p>

                        <div className="flex items-center gap-3 text-[11px] text-gray-600 font-semibold flex-wrap">
                          {lesson.created_at && (
                            <span className="flex items-center gap-1">
                              <Calendar size={12} />
                              Created {new Date(lesson.created_at).toLocaleDateString()}
                            </span>
                          )}
                          {lesson.attachments && lesson.attachments.length > 0 && (
                            <span className="truncate max-w-xs text-gray-700">
                              Files: {lesson.attachments.map((a) => a.file_name).join(", ")}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons on Lesson */}
                      <div className="flex items-center gap-2 shrink-0">
                        {onOpenClassworkForm && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenClassworkForm(lesson)}
                            className="gap-1 border-2 border-black bg-white hover:bg-yellow-50 text-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                            title="Add Classwork to this lesson"
                          >
                            <Plus size={14} />
                            Classwork
                          </Button>
                        )}
                        {onOpenLessonManager && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenLessonManager(lesson)}
                            className="p-1.5 border-2 border-black bg-white hover:bg-yellow-50 text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                            title="Manage Lesson Details & Materials"
                          >
                            <Pencil size={14} />
                          </Button>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleLesson(lesson.lesson_id)}
                          className="p-1.5 rounded-full border-2 border-black bg-white hover:bg-yellow-50 transition-colors cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] shrink-0"
                          title={isExpanded ? "Hide classworks" : "Show classworks"}
                        >
                          {isExpanded ? (
                            <ChevronDown size={16} />
                          ) : (
                            <ChevronRight size={16} />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Linked Classworks (White Card with Yellow Badges) */}
                  {isExpanded && (
                    <div className="ml-4 pl-3 border-l-2 border-black space-y-2 py-1 min-w-0">
                      {isLoadingCw ? (
                        <div className="rounded border-2 border-black bg-white p-4 text-center text-xs font-semibold text-gray-500">
                          Loading classworks...
                        </div>
                      ) : classworks.length === 0 ? (
                        <div className="flex items-center justify-between rounded border-2 border-dashed border-black/40 bg-white p-3 text-xs text-gray-500 font-medium">
                          <span>No classworks assigned to this lesson yet.</span>
                          {onOpenClassworkForm && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => onOpenClassworkForm(lesson)}
                              className="text-[11px] font-bold border-2 border-black bg-[#F6E9B2] hover:bg-[#fae498] text-black h-7"
                            >
                              <Plus size={12} className="mr-1" />
                              Add First Classwork
                            </Button>
                          )}
                        </div>
                      ) : (
                        classworks.map((cw) => (
                          <div
                            key={cw.classwork_assignment_id}
                            onClick={() => onOpenClassworkDetail && onOpenClassworkDetail(cw)}
                            className="flex items-center justify-between gap-3 border-2 border-black bg-white p-3.5 rounded-lg shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFFDF0] hover:translate-x-0.5 transition-all cursor-pointer min-w-0 group"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="shrink-0 text-black">
                                <ClassworkIcon type={cw.classwork_type} size={18} />
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-bold truncate text-black group-hover:underline">
                                  {cw.title}
                                </p>
                                <p className="text-[11px] text-gray-600 font-bold uppercase tracking-wider">
                                  {cw.classwork_type || "Classwork"}
                                  {cw.due_date
                                    ? ` • Due ${new Date(cw.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                                    : " • No due date"}
                                  {cw.total_points !== null && cw.total_points !== undefined
                                    ? ` • ${cw.total_points} pts`
                                    : ""}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {cw.classwork_category && (
                                <span className="border-2 border-black bg-[#F6E9B2] px-3 py-1 text-[11px] font-black text-black uppercase shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                                  {cw.classwork_category.replace(/_/g, " ")}
                                </span>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenClassworkDetail && onOpenClassworkDetail(cw);
                                }}
                                className="h-7 px-2 border-2 border-black bg-white hover:bg-gray-100 text-[11px] font-bold"
                              >
                                <Eye size={12} className="mr-1" />
                                View Details
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
