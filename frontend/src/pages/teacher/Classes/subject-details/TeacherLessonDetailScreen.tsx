import {
  BookOpen,
  ClipboardList,
  Eye,
  FileText,
  Pencil,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import type { Lesson, LinkedClasswork } from "./types";

interface TeacherLessonDetailScreenProps {
  lesson: Lesson;
  subjectName: string;
  closeLessonDetail: () => void;
  openLessonManager: (lesson: Lesson) => void;
  openClassworkForm: (lesson: Lesson) => void;
  openClassworkDetail: (classwork: LinkedClasswork) => void;
  linkedClassworks: LinkedClasswork[];
  isLoadingClasswork: boolean;
}

function ClassworkIcon({
  type,
  size = 20,
}: {
  type?: string | null;
  size?: number;
}) {
  switch (type?.toUpperCase()) {
    case "QUIZ":
      return <ClipboardList size={size} className="shrink-0 text-black" />;
    case "ASSIGNMENT":
      return <BookOpen size={size} className="shrink-0 text-black" />;
    default:
      return <FileText size={size} className="shrink-0 text-black" />;
  }
}

export default function TeacherLessonDetailScreen({
  lesson,
  subjectName,
  closeLessonDetail,
  openLessonManager,
  openClassworkForm,
  openClassworkDetail,
  linkedClassworks,
  isLoadingClasswork,
}: TeacherLessonDetailScreenProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* ── Breadcrumb Navigation ── */}
      <header className="flex items-center justify-between">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item>
              <Breadcrumb.Link
                onClick={closeLessonDetail}
                className="cursor-pointer text-2xl md:text-4xl text-black/50 hover:text-black"
              >
                Subjects
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator />
            <Breadcrumb.Item>
              <Breadcrumb.Link
                onClick={closeLessonDetail}
                className="cursor-pointer text-2xl md:text-4xl text-black/50 hover:text-black"
              >
                {subjectName}
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator />
            <Breadcrumb.Item>
              <Breadcrumb.Page className="text-xl md:text-3xl">
                {lesson.title}
              </Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </header>

      {/* ── Full-width border ── */}
      <div className="-mx-4 border-b-2 border-border md:-mx-6" />

      {/* ── Hero Lesson Card ── */}
      <Card className="block w-full bg-primary p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Card.Title className="text-3xl font-extrabold text-gray-950">
                {lesson.title}
              </Card.Title>
              <Badge
                variant="secondary"
                size="sm"
                className="border border-black bg-white font-bold"
              >
                {lesson.is_published ? "Published" : "Draft"}
              </Badge>
              {lesson.attachments && lesson.attachments.length > 0 && (
                <Badge
                  size="sm"
                  className="border border-black bg-[#7ABA78] font-bold text-black"
                >
                  {lesson.attachments.length} material
                  {lesson.attachments.length === 1 ? "" : "s"}
                </Badge>
              )}
            </div>

            <p className="text-sm font-medium leading-relaxed text-gray-800">
              {lesson.description ||
                lesson.content ||
                "No lesson description provided."}
            </p>

            {lesson.content && lesson.description && (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 border-t border-black/10 pt-3">
                {lesson.content}
              </p>
            )}

            <p className="mt-4 text-xs font-semibold text-gray-600">
              {lesson.created_at
                ? `Created ${new Date(lesson.created_at).toLocaleDateString(
                    "en-US",
                    {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    },
                  )}`
                : ""}
            </p>
          </div>

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => openLessonManager(lesson)}
            className="shrink-0 gap-1.5 bg-white hover:bg-white font-bold"
            title="Edit lesson details"
          >
            <Pencil size={15} />
            Edit
          </Button>
        </div>
      </Card>

      {/* ── Classwork Section ── */}
      <div className="flex flex-col gap-4 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-bold text-black">Classwork</h3>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => openClassworkForm(lesson)}
            className="gap-2 border-2 border-black bg-[#7ABA78] font-bold hover:bg-[#68a966]"
          >
            <Plus size={16} />
            Add Classwork
          </Button>
        </div>

        {isLoadingClasswork ? (
          <Card className="block p-6 text-center text-sm font-semibold">
            Loading classwork...
          </Card>
        ) : linkedClassworks.length > 0 ? (
          <div className="flex flex-col gap-3">
            {linkedClassworks.map((cw) => (
              <Card
                key={cw.classwork_assignment_id}
                className="block cursor-pointer"
                onClick={() => openClassworkDetail(cw)}
              >
                <Card.Content className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* <ClassworkIcon type={cw.classwork_type} size={24} /> */}
                    <div className="flex flex-col min-w-0">
                      <Card.Title className="text-lg font-bold text-black truncate">
                        {cw.title}
                      </Card.Title>
                      <p className="text-xs font-medium">
                        {cw.classwork_type || "Classwork"}
                        {cw.due_date
                          ? ` | Due ${new Date(cw.due_date).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              },
                            )}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {cw.attachment_count ? (
                      <Badge
                        size="sm"
                        className="bg-[#7ABA78] border border-black text-black font-semibold"
                      >
                        File {cw.attachment_count}
                      </Badge>
                    ) : null}
                    <Button
                      variant="default"
                      size="sm"
                      className="text-xs font-bold gap-2 bg-white shadow-none hover:bg-white"
                    >
                      <Eye size={14} />
                      Details
                    </Button>
                  </div>
                </Card.Content>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="block border-2 border-dashed border-gray-400 bg-white p-6 shadow-none">
            <Card.Content className="flex items-center gap-3">
              <ClipboardList size={22} className="shrink-0 text-gray-400" />
              <div>
                <Card.Title className="text-lg font-bold">
                  No classworks yet
                </Card.Title>
                <p className="text-xs font-medium text-gray-600">
                  Click "+ Add Classwork" to assign readings, activities, or
                  quizzes to this lesson.
                </p>
              </div>
            </Card.Content>
          </Card>
        )}
      </div>
    </div>
  );
}
