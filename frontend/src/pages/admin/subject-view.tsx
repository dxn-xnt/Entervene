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
  getSubjectDetail,
  getSubjectLoadStudioData,
  getSubjects,
  type SubjectListItem,
  type SubjectLoadItem,
} from "@/lib/api";
import type { ClassListItem } from "@/types/adminClasses";
import { OverviewCard } from "@/components/overview-cards";

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

function loadWeeklyHours(load: SubjectLoadItem): number {
  if (!load.start_time || !load.end_time) return 0;
  const [sh, sm] = load.start_time.split(":").map(Number);
  const [eh, em] = load.end_time.split(":").map(Number);
  if (!Number.isFinite(sh) || !Number.isFinite(sm) || !Number.isFinite(eh) || !Number.isFinite(em)) {
    return 0;
  }
  const minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) return 0;
  const daysCount = Array.isArray(load.days_of_week) && load.days_of_week.length > 0
    ? load.days_of_week.length
    : 5;
  return (minutes * daysCount) / 60;
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
  const [totalHours, setTotalHours] = useState<number>(0);
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
        let computedHours = 0;

        if (studioData) {
          for (const load of studioData.existing_loads) {
            if (load.is_active_version === false) continue;
            if (load.subject_id === loadedSubject.subject_id) {
              loadsForSubject[load.class_id] = load;
              computedHours += loadWeeklyHours(load);
            }
          }
        }

        if (isMounted) {
          setSubjectDetail(loadedSubject);
          setClassesList(matchingActiveClasses);
          setArchivedClassesCount(matchingArchivedClasses.length);
          setSubjectLoadsByClass(loadsForSubject);
          setTotalHours(Math.round(computedHours * 10) / 10);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Unable to load subject.");
          setSubjectDetail(null);
          setClassesList([]);
          setArchivedClassesCount(0);
          setSubjectLoadsByClass({});
          setTotalHours(0);
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
                <RetroCard className="bg-accent">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-row flex-wrap gap-3 items-start justify-between">
                      <div className="flex flex-row gap-2 items-end">
                        <Text as="h2" className="font-sans font-bold">
                          {subjectDetail.subject_name}
                        </Text>
                        <Text as="p" className="font-sans text-xl font-medium pb-1">
                          ( {subjectDetail.subject_codename} )
                        </Text>
                      </div>
                      <div className="flex flex-row gap-2">
                        <Badge size="sm" variant="solid" className="capitalize">
                          {subjectDetail.grading_template.template_name}
                        </Badge>
                        <Badge size="sm" variant={subjectDetail.status === "active" ? "secondary" : "default"} className="capitalize">
                          {subjectDetail.status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-row justify-between">
                      <Text as="p" className="text-sm font-normal">
                        Created since {formatDate(subjectDetail.created_at)}
                      </Text>
                      <Text as="p" className="text-sm font-normal">
                        Passing threshold: {subjectDetail.grading_template.passing_threshold}%
                      </Text>
                    </div>
                  </div>
                </RetroCard>

                <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
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

                  <aside className="flex min-w-0 flex-col gap-3" aria-label="Subject summary">
                    <OverviewCard title="Total Classes" count={String(totalClassesCount)} />
                    <OverviewCard title="Active Classes" count={String(activeClassesCount)} />
                    <OverviewCard title="Archived Classes" count={String(archivedClassesCount)} />
                    <OverviewCard
                      title="Total Hours"
                      count={String(totalHours)}
                      statDescription="Recorded hours across these classes"
                    />
                  </aside>
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
