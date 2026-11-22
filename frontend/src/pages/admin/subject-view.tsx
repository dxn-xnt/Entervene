import { useEffect, useState } from "react";
import { AdminBreadcrumb as Breadcrumb } from "@/components/admin/admin-breadcrumb";
import { Badge } from "@/components/retroui/Badge";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Empty } from "@/components/retroui/Empty";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Text } from "@/components/retroui/Text";
import { useParams } from "react-router-dom";
import ClassItemLine from "@/components/item-line/class";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import {
  getClasses,
  getOverviewStats,
  getSubjectDetail,
  getSubjectLoadStudioData,
  getSubjects,
  type SubjectListItem,
  type SubjectLoadItem,
} from "@/lib/api";
import type { ClassListItem } from "@/types/adminClasses";
import { OverviewCard } from "@/components/overview-cards";
import { SubjectClassHeader } from "@/components/subject-class-header";

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatClock12(hhmm?: string | null): string {
  if (!hhmm) return "";
  const parts = hhmm.split(":");
  if (parts.length < 2) return hhmm;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export default function AdminSubjectView() {
  const { grade, subject } = useParams<{ grade: string; subject: string }>();
  const { selectedPeriodId, selectedYearId } = useAcademicPeriod();
  const decodedGrade = decodeURIComponent(grade || "Grade 11");
  const decodedSubjectParam = decodeURIComponent(subject || "");
  const [subjectDetail, setSubjectDetail] = useState<SubjectListItem | null>(null);
  const [classesList, setClassesList] = useState<ClassListItem[]>([]);
  const [archivedClassesCount, setArchivedClassesCount] = useState<number>(0);
  const [subjectLoadsByClass, setSubjectLoadsByClass] = useState<Record<number, SubjectLoadItem>>({});
  const [overallMastery, setOverallMastery] = useState<string | null>(null);
  const [averageGrade, setAverageGrade] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSubject() {
      setIsLoading(true);
      setError(null);
      try {
        const numericId = Number(decodedSubjectParam);
        const [allSubjectsRes, activeClassesData, archivedClassesData, studioData] = await Promise.all([
          getSubjects().catch(() => ({ subjects: [] as SubjectListItem[] })),
          getClasses("active", selectedYearId).catch(() => ({
            summary: { total_classes: 0, active_classes: 0, archived_classes: 0, students_assigned: 0 },
            classes: [] as ClassListItem[],
          })),
          getClasses("archived", selectedYearId).catch(() => ({
            summary: { total_classes: 0, active_classes: 0, archived_classes: 0, students_assigned: 0 },
            classes: [] as ClassListItem[],
          })),
          getSubjectLoadStudioData(selectedPeriodId ?? undefined).catch(() => null),
        ]);

        const loadedSubject =
          Number.isFinite(numericId) && numericId > 0
            ? await getSubjectDetail(numericId)
            : allSubjectsRes.subjects.find(
                (item) => item.subject_name.toLowerCase() === decodedSubjectParam.toLowerCase(),
              ) ?? null;

        if (!loadedSubject) {
          throw new Error("Subject not found.");
        }

        const matchesLevel = (item: ClassListItem) =>
          item.academic_level.academic_level_id === loadedSubject.academic_level.academic_level_id ||
          item.academic_level.level_name.toLowerCase() === loadedSubject.academic_level.level_name.toLowerCase();

        const matchingActiveClasses = activeClassesData.classes.filter(matchesLevel);
        const matchingArchivedClasses = archivedClassesData.classes.filter(matchesLevel);

        const loadsForSubject: Record<number, SubjectLoadItem> = {};

        if (studioData) {
          for (const load of studioData.existing_loads) {
            if (load.is_active_version === false) continue;
            if (load.subject_id === loadedSubject.subject_id) {
              loadsForSubject[load.class_id] = load;
            }
          }
        }

        if (isMounted) {
          setSubjectDetail(loadedSubject);
          setClassesList(matchingActiveClasses);
          setArchivedClassesCount(matchingArchivedClasses.length);
          setSubjectLoadsByClass(loadsForSubject);
        }

        try {
          const stats = await getOverviewStats({
            scope: "subject",
            subject_id: loadedSubject.subject_id,
            academic_period_id: selectedPeriodId ?? undefined,
            academic_year_id: selectedYearId ?? undefined,
          });
          const masteryCard = stats?.cards?.find((c) => c.title.toLowerCase().includes("mastery"));
          const gradeCard = stats?.cards?.find((c) => c.title.toLowerCase().includes("grade"));
          const resolvedMastery =
            masteryCard?.count && masteryCard.count !== "0"
              ? masteryCard.count
              : stats?.details?.overall_class_mastery != null
                ? `${stats.details.overall_class_mastery}%`
                : null;
          const resolvedGrade =
            gradeCard?.count && gradeCard.count !== "0"
              ? gradeCard.count
              : stats?.details?.students_average_grade != null
                ? `${stats.details.students_average_grade}%`
                : null;
          if (isMounted) {
            setOverallMastery(resolvedMastery);
            setAverageGrade(resolvedGrade);
          }
        } catch {
          if (isMounted) {
            setOverallMastery(null);
            setAverageGrade(null);
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Unable to load subject.");
          setSubjectDetail(null);
          setClassesList([]);
          setArchivedClassesCount(0);
          setSubjectLoadsByClass({});
          setOverallMastery(null);
          setAverageGrade(null);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadSubject();
    return () => {
      isMounted = false;
    };
  }, [decodedSubjectParam, selectedPeriodId, selectedYearId]);

  const displaySubjectName = subjectDetail?.subject_name || decodedSubjectParam || "Subject";
  const activeClassesCount = classesList.length;
  const totalClassesCount = activeClassesCount + archivedClassesCount;

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <Breadcrumb className="min-w-0 overflow-hidden">
                  <Breadcrumb.List className="flex-nowrap">
                    <Breadcrumb.Item>
                      <Breadcrumb.Link href="/admin/subjects" className="">
                        Subjects
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Link href={`/admin/subjects/${encodeURIComponent(decodedGrade)}`} className="text-xl text-muted-foreground font-semibold">
                        {decodedGrade}
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Page>{displaySubjectName}</Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </Breadcrumb.List>
                </Breadcrumb>
              </div>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-3 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              {isLoading ? (
              <Text as="p" role="status" className="text-sm text-muted-foreground">Loading subject...</Text>
            ) : error ? (
              <RetroCard className="py-3 px-4 bg-accent">
                <Text as="h1" className="font-sans text-2xl font-bold">
                  Unable to load subject
                </Text>
                <Text as="p" className="text-sm font-normal">
                  {error}
                </Text>
              </RetroCard>
            ) : subjectDetail ? (
              <>
                <SubjectClassHeader
                  detail={{
                    class_id: subjectDetail.subject_id,
                    academic_level: decodedGrade,
                    is_archived: subjectDetail.status === "archived",
                  }}
                  currentSubject={{
                    subject_id: subjectDetail.subject_id,
                    subject_name: subjectDetail.subject_codename
                      ? `${subjectDetail.subject_name} ( ${subjectDetail.subject_codename} )`
                      : subjectDetail.subject_name,
                  }}
                  statusLabel={subjectDetail.status === "active" ? "Active" : "Archived"}
                  showViewSubjectButton={false}
                  badges={
                    <Badge size="sm" variant="solid" className="capitalize">
                      {subjectDetail.grading_template.template_name}
                    </Badge>
                  }
                  subtitle={
                    <div className="flex flex-row flex-wrap justify-between items-center text-xs sm:text-sm text-foreground/80 mt-1">
                      <span>Created since {formatDate(subjectDetail.created_at)}</span>
                      <span>Passing threshold: {subjectDetail.grading_template.passing_threshold}%</span>
                    </div>
                  }
                />

                <div className="flex min-w-0 flex-col gap-4">
                  {/* Overview Cards at the top of classes, not on the right side */}
                  <section
                    className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
                    aria-label="Subject overview"
                  >
                    <OverviewCard
                      title="Total Classes"
                      count={String(totalClassesCount)}
                    />
                    <OverviewCard
                      title="Active Classes"
                      count={String(activeClassesCount)}
                    />
                    <OverviewCard
                      title="Overall Class Mastery"
                      count={overallMastery || "--"}
                    />
                    <OverviewCard
                      title="Students Average Grade"
                      count={averageGrade || "--"}
                    />
                  </section>

                  <section className="flex min-w-0 flex-col gap-2">
                    <Text as="h3" className="font-sans text-xl font-bold">
                      Classes
                    </Text>
                    <div className="flex flex-col gap-3">
                      {classesList.length === 0 ? (
                        <Empty>
                          <Empty.Content>
                            <Empty.Title>No active classes currently assigned to this subject level ({decodedGrade}).</Empty.Title>
                          </Empty.Content>
                        </Empty>
                      ) : (
                        classesList.map((cls) => {
                          const load = subjectLoadsByClass[cls.class_id];
                          const startFmt = formatClock12(load?.start_time);
                          const endFmt = formatClock12(load?.end_time);
                          const timeLabel =
                            startFmt && endFmt ? `${startFmt} - ${endFmt}` : "Unscheduled";
                          return (
                            <ClassItemLine
                              key={cls.class_id}
                              subject={cls.section_name}
                              date={`${cls.class_status === "Active" || cls.class_status === "active" ? "Active" : "Archived"} since ${formatDate(subjectDetail.created_at)}`}
                              time={timeLabel}
                            />
                          );
                        })
                      )}
                    </div>
                  </section>
                </div>
              </>
            ) : null}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
