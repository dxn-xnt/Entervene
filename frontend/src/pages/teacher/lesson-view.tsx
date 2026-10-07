import {
    Calendar,
    ClipboardList,
    Clock,
    Eye,
    FileText,
    Paperclip,
    Pencil,
    Plus,
} from "lucide-react";
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
import { formatDate, formatFileSize, toTitleCase } from "@/lib/formatters";
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
    linkedClassworks = [],
    isLoadingClasswork = false,
}: TeacherLessonViewProps) {
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

            <div className="-mt-[3px] flex min-w-0 flex-col gap-5 border-t-2! border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">

                {/* ── Hero Lesson Information Card ── */}
                <Card className="block w-full border-2 border-black bg-primary p-5 sm:p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex flex-col gap-3">
                        {/* Badges Ribbon */}
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" size="sm" className="border-1 border-black bg-white text-black">
                                Lesson
                            </Badge>

                            <Badge
                                variant={lesson.is_published ? "solid" : "default"}
                                size="sm"
                                className="py-1 rounded font-bold"
                            >
                                {lesson.is_published ? "Published" : "Draft"}
                            </Badge>

                            {(lesson.competency_code || lesson.competency_statement) && (
                                <Badge variant="outline" size="sm" className="border-1 border-black bg-white text-black">
                                    {lesson.competency_code || lesson.competency_statement}
                                </Badge>
                            )}

                            <Badge
                                variant="surface"
                                size="sm"
                                className="border-1 border-black bg-white text-black"
                            >
                                {linkedClassworks.length} {linkedClassworks.length === 1 ? "classwork" : "classworks"}
                            </Badge>

                            {lesson.attachments && lesson.attachments.length > 0 && (
                                <Badge
                                    size="sm"
                                    className="border-1 border-black bg-[#7ABA78] text-black font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                                >
                                    <Paperclip size={12} className="mr-1 inline" />
                                    {lesson.attachments.length} {lesson.attachments.length === 1 ? "material" : "materials"}
                                </Badge>
                            )}
                        </div>

                        {/* Lesson Title */}
                        <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-black leading-tight break-words">
                            {lesson.title}
                        </h1>

                        {/* Description */}
                        {lesson.description && (
                            <p className="text-sm sm:text-base font-medium leading-relaxed text-gray-900 break-words">
                                {lesson.description}
                            </p>
                        )}

                        {/* Lesson Content / Notes */}
                        {lesson.content && (
                            <div className="mt-2 rounded border-2 border-black bg-white/70 p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                <p className="text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                                    Lesson Content
                                </p>
                                <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-900 font-medium">
                                    {lesson.content}
                                </div>
                            </div>
                        )}

                        {/* Lesson Attachments / Files */}
                        {lesson.attachments && lesson.attachments.length > 0 && (
                            <div className="mt-2 flex flex-col gap-2">
                                <p className="text-xs font-bold uppercase tracking-wider text-gray-700">
                                    Attached Materials ({lesson.attachments.length})
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {lesson.attachments.map((file) => (
                                        <div
                                            key={file.lesson_attachment_id}
                                            className="inline-flex items-center gap-2 rounded border-2 border-black bg-white px-3 py-1.5 text-xs font-bold text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                        >
                                            <FileText size={14} className="shrink-0 text-black" />
                                            <span className="max-w-[180px] sm:max-w-[260px] truncate" title={file.file_name}>
                                                {file.file_name}
                                            </span>
                                            <span className="text-[11px] font-normal text-muted-foreground">
                                                ({formatFileSize(file.file_size)})
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Timestamps */}
                        {(lesson.updated_at || lesson.created_at) && (
                            <div className="mt-1 flex items-center text-xs font-semibold text-gray-700">
                                <span className="inline-flex items-center gap-1">
                                    <Clock size={12} />
                                    {lesson.updated_at && (!lesson.created_at || lesson.updated_at !== lesson.created_at)
                                        ? `Updated ${formatDate(lesson.updated_at)}`
                                        : `Created ${formatDate(lesson.created_at)}`}
                                </span>
                            </div>
                        )}
                    </div>
                </Card>

                {/* ── Classwork Section ── */}
                <section className="flex flex-col gap-3 pt-2">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl sm:text-2xl font-bold text-black">
                                Classwork
                            </h2>
                        </div>
                    </div>

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
                                <Card
                                    key={classwork.classwork_assignment_id}
                                    tabIndex={0}
                                    role="button"
                                    onClick={() => openClassworkDetail(classwork)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            openClassworkDetail(classwork);
                                        }
                                    }}
                                    className="group flex w-full cursor-pointer items-center justify-between gap-4 border-2 border-black bg-white p-3.5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 hover:bg-yellow-50/50 transition-all"
                                >
                                    <div className="flex min-w-0 flex-1 items-center gap-3">
                                        <div className="flex flex-col min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-sm sm:text-base font-bold text-black break-words line-clamp-2 group-hover:underline">
                                                    {classwork.title}
                                                </p>
                                                {classwork.classwork_type && (
                                                    <Badge size="sm" variant="surface" className="font-semibold text-[11px]">
                                                        {toTitleCase(classwork.classwork_type)}
                                                    </Badge>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs font-medium text-gray-600">
                                                {classwork.due_date ? (
                                                    <span className="inline-flex items-center gap-1 text-gray-700">
                                                        <Calendar size={12} className="text-gray-500" />
                                                        Due {formatDate(classwork.due_date)}
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground">No due date</span>
                                                )}

                                                {classwork.created_at && (
                                                    <span>
                                                        Created {formatDate(classwork.created_at)}
                                                    </span>
                                                )}

                                                {classwork.attachment_count ? (
                                                    <Badge
                                                        size="sm"
                                                        className="bg-[#7ABA78] border border-black text-black font-semibold text-[11px] py-0"
                                                    >
                                                        <Paperclip size={10} className="mr-0.5 inline" />
                                                        {classwork.attachment_count} file{classwork.attachment_count === 1 ? "" : "s"}
                                                    </Badge>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <Button
                                            type="button"
                                            variant="default"
                                            size="sm"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openClassworkDetail(classwork);
                                            }}
                                            className="gap-1.5 border-2 border-black bg-white text-black font-bold text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-100"
                                        >
                                            <Eye size={14} />
                                            <span>View</span>
                                        </Button>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    ) : (
                        /* Empty State when Lesson has no Classworks */
                        <Empty className="border-2 border-dashed border-black/40 bg-white p-8 shadow-none">
                            <EmptyHeader>
                                <EmptyMedia>
                                    <div className="flex size-12 items-center justify-center border-2 border-black bg-primary shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                                        <ClipboardList className="size-6 text-black" />
                                    </div>
                                </EmptyMedia>
                                <EmptyTitle className="text-lg">No classworks yet</EmptyTitle>
                                <EmptyDescription className="max-w-md">
                                    Click "+ Add Classwork" to assign readings, quizzes, activities, or homework to this lesson.
                                </EmptyDescription>
                            </EmptyHeader>
                            <EmptyContent className="mt-2">
                                <Button
                                    type="button"
                                    variant="default"
                                    size="sm"
                                    onClick={() => openClassworkForm(lesson)}
                                    className="gap-2 border-2 border-black bg-[#7ABA78] text-black font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#68a966]"
                                >
                                    <Plus size={16} />
                                    Add First Classwork
                                </Button>
                            </EmptyContent>
                        </Empty>
                    )}
                </section>
            </div>
        </div>
    );
}

export const TeacherLessonDetailScreen = TeacherLessonView;
export const LessonView = TeacherLessonView;
export default TeacherLessonView;
