import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Badge } from "@/components/retroui/Badge";
import { Card as RetroCard } from "@/components/retroui/Card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Text } from "@/components/retroui/Text";
import { useParams } from "react-router-dom";
import ClassItemLine from "@/components/item-line/class";
import {
  getClasses,
  getSubjectDetail,
  getSubjects,
  type SubjectListItem,
} from "@/lib/api";
import type { ClassListItem } from "@/types/adminClasses";
import { OverviewCard } from "@/components/overview-cards";

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default function AdminSubjectView() {
  const { grade, subject } = useParams<{ grade: string; subject: string }>();
  const decodedGrade = decodeURIComponent(grade || "Grade 11");
  const decodedSubjectParam = decodeURIComponent(subject || "");
  const [subjectDetail, setSubjectDetail] = useState<SubjectListItem | null>(null);
  const [classesList, setClassesList] = useState<ClassListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSubject() {
      setIsLoading(true);
      setError(null);
      try {
        const numericId = Number(decodedSubjectParam);
        const loadedSubject = Number.isFinite(numericId) && numericId > 0
          ? await getSubjectDetail(numericId)
          : (await getSubjects({ search: decodedSubjectParam })).subjects.find(
            (item) => item.subject_name.toLowerCase() === decodedSubjectParam.toLowerCase()
          ) ?? null;

        if (!loadedSubject) {
          throw new Error("Subject not found.");
        }

        const classesData = await getClasses("active").catch(() => ({ summary: { total_classes: 0, active_classes: 0, archived_classes: 0, students_assigned: 0 }, classes: [] }));

        const matchingClasses = classesData.classes.filter(
          (item) => item.academic_level.level_name.toLowerCase() === loadedSubject.academic_level.level_name.toLowerCase()
        );

        if (isMounted) {
          setSubjectDetail(loadedSubject);
          setClassesList(matchingClasses);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Unable to load subject.");
          setSubjectDetail(null);
          setClassesList([]);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadSubject();
    return () => {
      isMounted = false;
    };
  }, [decodedSubjectParam]);

  const displaySubjectName = subjectDetail?.subject_name || decodedSubjectParam || "Subject";

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 p-4">
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <Breadcrumb>
                  <Breadcrumb.List>
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

            <div className="-mx-4 md:-mx-6 border-b-2 border-border mt-[3px]" />

            {isLoading ? (
              <RetroCard className="py-3 px-4 bg-accent">Loading subject...</RetroCard>
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
                        <Badge variant="solid" className="capitalize">
                          {subjectDetail.subject_group}
                        </Badge>
                        <Badge variant={subjectDetail.status === "active" ? "secondary" : "default"} className="capitalize">
                          {subjectDetail.status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-row justify-between">
                      <Text as="p" className="text-sm font-normal">
                        Created since {formatDate(subjectDetail.created_at)}
                      </Text>
                      <Text as="p" className="text-sm font-normal">
                        {subjectDetail.hours ?? 0} hours
                      </Text>
                    </div>
                  </div>
                </RetroCard>

                <section className="flex flex-col gap-2">
                  <Text as="h3" className="font-sans text-xl font-bold">
                    Overview
                  </Text>
                  <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
                    <OverviewCard title="Total Subjects" count={String("12")} />
                    <OverviewCard title="Active Subjects" count={String("8")} />
                    <OverviewCard title="Archived Subjects" count={String("4")} />
                    <OverviewCard title="Total Hours" count={String("135")} />
                  </div>
                </section>

                <div className="flex flex-col gap-1 px-0">
                  <Text as="h3" className="font-sans text-xl font-bold">
                    Classes
                  </Text>
                  <div className="flex flex-col gap-3">
                    {classesList.length === 0 ? (
                      <RetroCard className="px-4 py-3">
                        <p>No active classes currently assigned to this subject level ({decodedGrade}).</p>
                      </RetroCard>
                    ) : (
                      classesList.map((cls) => (
                        <ClassItemLine
                          key={cls.class_id}
                          subject={cls.section_name}
                          date={`${cls.class_status === "Active" || cls.class_status === "active" ? "Active" : "Archived"} since ${formatDate(subjectDetail.created_at)}`}
                          time="10:00 - 11:00 AM"
                        />
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
