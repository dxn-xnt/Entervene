import { useState } from "react";
import {
    Archive,
    ClipboardList,
    Pencil,
    Plus,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/retroui/Badge";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { formatDate } from "@/lib/formatters";
import ClassworkItemLine from "@/components/item-line/classwork";
import type { Lesson, LinkedClasswork } from "./subject-details/types";

export interface TeacherLessonViewProps {
    lesson: Lesson;
    subjectName?: string;
    sectionName?: string;
    onSubjectClick?: () => void;
    closeLessonDetail: () => void;
    openLessonManager: (lesson: Lesson) => void;
    openClassworkForm: (lesson: Lesson) => void;
    openClassworkDetail: (classwork: LinkedClasswork) => void;
    onArchiveLesson?: (lesson: Lesson) => Promise<void> | void;
    linkedClassworks: LinkedClasswork[];
    isLoadingClasswork?: boolean;
}

export function TeacherLessonView({
    lesson,
    subjectName = "Subject",
    sectionName,
    onSubjectClick,
    closeLessonDetail,
    openLessonManager,
    openClassworkForm,
    openClassworkDetail,
    onArchiveLesson,
    linkedClassworks = [],
    isLoadingClasswork = false,
}: TeacherLessonViewProps) {
    const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
    const [isArchivingLesson, setIsArchivingLesson] = useState(false);

    return (
        <div className="flex flex-col flex-1 min-w-0 w-full animate-in fade-in-50 duration-200">
            {/* ── Universal Header ── */}
            <div data-page-tabs-sticky-region>
                <header className="flex min-w-0 flex-col gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                        <SidebarTrigger className="shrink-0 md:hidden" />
                        <Breadcrumb className="min-w-0">
                            <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-1.5 sm:gap-2">
                                <Breadcrumb.Item>
                                    <Breadcrumb.Link href="/teacher/classes" className="whitespace-nowrap">
                                        Classes
                                    </Breadcrumb.Link>
                                </Breadcrumb.Item>

                                <Breadcrumb.Separator />
                                <Breadcrumb.Item className="min-w-0 shrink-0">
                                    <Breadcrumb.Link
                                        onClick={onSubjectClick || closeLessonDetail}
                                        className="cursor-pointer block max-w-[150px] sm:max-w-[200px] truncate"
                                    >
                                        {subjectName}
                                    </Breadcrumb.Link>
                                </Breadcrumb.Item>

                                {sectionName && (
                                    <>
                                        <Breadcrumb.Separator />
                                        <Breadcrumb.Item className="min-w-0 shrink-0">
                                            <Breadcrumb.Link
                                                onClick={closeLessonDetail}
                                                className="cursor-pointer block max-w-[150px] sm:max-w-[200px] truncate"
                                            >
                                                {sectionName}
                                            </Breadcrumb.Link>
                                        </Breadcrumb.Item>
                                    </>
                                )}

                                <Breadcrumb.Separator />
                                <Breadcrumb.Item className="min-w-0 flex-1">
                                    <Breadcrumb.Page
                                        className="block max-w-[220px] sm:max-w-[360px] truncate font-bold text-black"
                                        title={lesson.title}
                                    >
                                        {lesson.title}
                                    </Breadcrumb.Page>
                                </Breadcrumb.Item>
                            </Breadcrumb.List>
                        </Breadcrumb>
                    </div>

                    <div className="flex flex-wrap w-full gap-2 md:flex md:w-auto md:flex-nowrap md:items-center">
                        <Button
                            type="button"
                            size="header"
                            variant="outline"
                            onClick={() => openLessonManager(lesson)}
                            className="w-full whitespace-nowrap md:w-auto"
                        >
                            <Pencil size={16} />
                            Edit Lesson
                        </Button>
                        {onArchiveLesson && (
                            <Button
                                type="button"
                                size="header"
                                variant="outline"
                                onClick={() => setShowArchiveConfirm(true)}
                                disabled={isArchivingLesson}
                                className="w-full whitespace-nowrap md:w-auto"
                            >
                                <Archive size={16} />
                                Archive Lesson
                            </Button>
                        )}
                        <Button
                            type="button"
                            size="header"
                            variant="default"
                            onClick={() => openClassworkForm(lesson)}
                            className="w-full whitespace-nowrap md:w-auto"
                        >
                            <Plus size={16} />
                            Add Classwork
                        </Button>
                    </div>
                </header>
            </div>

            <div className="-mt-[3px] flex min-w-0 flex-col gap-3 border-t-2! border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
                {/* ── Hero Lesson Information Card ── */}
                <Card className="block w-full border-2 border-black bg-primary p-4 sm:p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2 justify-between">
                            <div className="flex flex-row gap-3 items-center">
                                {/* Lesson Title */}
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-black leading-tight break-words">
                                    {lesson.title}
                                </h1>
                                <Badge variant="outline" size="sm" className="h-fit">
                                    Lesson
                                </Badge>
                            </div>

                            <Badge
                                variant={lesson.is_published ? "solid" : "default"}
                                size="sm"
                                className="py-1"
                            >
                                {lesson.is_published ? "Published" : "Draft"}
                            </Badge>

                        </div>

                        <div className="flex flex-row gap-2 items-center">
                            <p className="text-xs sm:text-sm text-foreground">
                                Competency:
                            </p>
                            {(lesson.competency_code || lesson.competency_statement) && (
                                <p className="text-sm sm:text-base font-semibold text-foreground">
                                    {lesson.competency_code || lesson.competency_statement}
                                </p>
                            )}
                        </div>

                        {/* Timestamps */}
                        {(lesson.updated_at || lesson.created_at) && (
                            <div className="flex items-center text-xs sm:text-sm text-foreground">
                                <span className="inline-flex items-center gap-1">
                                    {lesson.updated_at && (!lesson.created_at || lesson.updated_at !== lesson.created_at)
                                        ? `Updated ${formatDate(lesson.updated_at)}`
                                        : `Created ${formatDate(lesson.created_at)}`}
                                </span>
                            </div>
                        )}
                    </div>
                </Card>

                <section className="flex flex-col gap-3 px-1">
                    {/* Lesson Content / Notes */}
                    {lesson.content && (
                        <Card className="shadow-none">
                            <p className="mb-1 text-sm text-muted-foreground">
                                Lesson Content
                            </p>
                            <div className="whitespace-pre-wrap text-sm text-foreground font-medium">
                                {lesson.content}
                            </div>
                        </Card>
                    )}
                    {/* Description
                    {lesson.description && (
                        <p className="text-sm text-muted-foreground">
                            {lesson.description}
                        </p>
                    )} */}
                </section>

                {/* ── Classwork Section ── */}
                <section className="mt-2 flex flex-col gap-3 px-1">
                    {/* Loading State */}
                    {isLoadingClasswork ? (
                        <Card className="block border-2 border-black bg-white p-8 text-center text-sm font-semibold shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                            <div className="flex flex-col items-center gap-2">
                                <ClipboardList className="size-8 text-gray-400 animate-pulse" />
                                <span>Loading classworks...</span>
                            </div>
                        </Card>
                    ) : linkedClassworks.length > 0 ? (
                        /* Classworks List */
                        <div className="flex flex-col gap-3">
                            {linkedClassworks.map((classwork) => (
                                <ClassworkItemLine
                                    key={classwork.classwork_assignment_id}
                                    item={classwork}
                                    onOpen={openClassworkDetail}
                                />
                            ))}
                        </div>
                    ) : (
                        /* Empty State when Lesson has no Classworks */
                        <Empty className="border-2 bg-white p-8 shadow-none">
                            <EmptyHeader>
                                <EmptyMedia>
                                    <div className="flex size-12 items-center justify-center border-2 border-black bg-primary">
                                        <ClipboardList className="size-6 text-black" />
                                    </div>
                                </EmptyMedia>
                                <EmptyTitle className="text-lg">No classworks yet</EmptyTitle>
                                <EmptyDescription className="whitespace-nowrap">
                                    Assign readings, quizzes, activities, or homework to this lesson.
                                </EmptyDescription>
                            </EmptyHeader>
                            <EmptyContent className="mt-2">
                                <Button
                                    variant="default"
                                    size="sm"
                                    onClick={() => openClassworkForm(lesson)}
                                    className="gap-2"
                                >
                                    <Plus size={16} />
                                    Add Classwork
                                </Button>
                            </EmptyContent>
                        </Empty>
                    )}
                </section>
            </div>

            {/* ── Archive Confirmation Modal ── */}
            {showArchiveConfirm && (
                <div
                    role="dialog"
                    aria-modal="true"
                    onClick={(e) => e.stopPropagation()}
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4"
                >
                    <Card className="block w-full max-w-md border-2 border-black bg-background text-foreground shadow-[4px_4px_0_#000]">
                        <div className="flex items-center justify-between border-b-2 border-black bg-red-100 px-5 py-3">
                            <div className="flex items-center gap-2 text-red-800">
                                <Archive size={18} />
                                <Card.Title className="mb-0 text-base font-bold text-red-800">
                                    Archive Lesson?
                                </Card.Title>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowArchiveConfirm(false)}
                                disabled={isArchivingLesson}
                                className="rounded p-1 hover:bg-white/60 disabled:opacity-50 cursor-pointer"
                                aria-label="Close archive confirmation"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <Card.Content className="space-y-3 p-5">
                            <p className="text-sm font-medium">
                                Are you sure you want to archive{" "}
                                <span className="font-bold">"{lesson.title}"</span>?
                            </p>
                            <p className="text-xs text-gray-600">
                                This hides the lesson from the teacher lesson list and student
                                lesson views. You can restore it later from the backend archive
                                flow.
                            </p>
                        </Card.Content>
                        <div className="flex justify-end gap-3 border-t-2 border-black px-5 py-4 bg-gray-50">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setShowArchiveConfirm(false)}
                                disabled={isArchivingLesson}
                                className="border-black font-bold"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                onClick={async () => {
                                    if (!onArchiveLesson) return;
                                    setIsArchivingLesson(true);
                                    try {
                                        await onArchiveLesson(lesson);
                                        setShowArchiveConfirm(false);
                                        closeLessonDetail();
                                    } catch (err) {
                                        toast.error(
                                            err instanceof Error
                                                ? err.message
                                                : "Unable to archive lesson."
                                        );
                                    } finally {
                                        setIsArchivingLesson(false);
                                    }
                                }}
                                disabled={isArchivingLesson}
                                className="border-2 border-black bg-red-600 text-white font-bold hover:bg-red-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                            >
                                {isArchivingLesson ? "Archiving..." : "Archive Lesson"}
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}

export const TeacherLessonDetailScreen = TeacherLessonView;
export const LessonView = TeacherLessonView;
export default TeacherLessonView;
