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
  getSubjectDetail,
  getSubjectOfferings,
  getSubjects,
  type SubjectListItem,
  type SubjectOfferingListItem,
} from "@/lib/api";

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" }).format(new Date(value));
}

function pathwayLabel(value: string) {
  if (value === "general") return "General";
  if (value === "stem_medical") return "STEM Medical";
  if (value === "stem_engineering") return "STEM Engineering";
  return "Both";
}

export default function AdminSubjectView() {
  const { grade, subject } = useParams<{ grade: string; subject: string }>();
  const decodedGrade = decodeURIComponent(grade || "Grade 11");
  const decodedSubjectParam = decodeURIComponent(subject || "");
  const [subjectDetail, setSubjectDetail] = useState<SubjectListItem | null>(null);
  const [offerings, setOfferings] = useState<SubjectOfferingListItem[]>([]);
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

        const offeringData = await getSubjectOfferings({
          search: loadedSubject.subject_codename || loadedSubject.subject_name,
        });
        const matchingOfferings = offeringData.subject_offerings.filter(
          (offering) => offering.subject.subject_id === loadedSubject.subject_id
        );

        if (isMounted) {
          setSubjectDetail(loadedSubject);
          setOfferings(matchingOfferings);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Unable to load subject.");
          setSubjectDetail(null);
          setOfferings([]);
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
                      <Breadcrumb.Link href="/admin/subjects" className="text-2xl">
                        Subjects
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Link href={`/admin/subjects/${encodeURIComponent(decodedGrade)}`}>
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
            <div className="-mx-4 md:-mx-6 border-b border-black/40" />

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
                <RetroCard className="py-3 px-4 bg-accent">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-row flex-wrap gap-3 items-center">
                      <Text as="h1" className="font-sans text-2xl font-bold">
                        {subjectDetail.subject_name}
                      </Text>
                      <Badge size="sm" variant={subjectDetail.status === "active" ? "surface" : "outline"}>
                        {subjectDetail.status}
                      </Badge>
                    </div>
                    <Text as="p" className="text-sm font-normal">
                      {(subjectDetail.subject_codename || "No code")} | {subjectDetail.subject_group || "Ungrouped"} | {subjectDetail.hours ?? 0} hours
                    </Text>
                    <Text as="p" className="text-sm font-normal">
                      Created since {formatDate(subjectDetail.created_at)}
                    </Text>
                    {subjectDetail.description ? (
                      <Text as="p" className="text-sm font-normal">
                        {subjectDetail.description}
                      </Text>
                    ) : null}
                  </div>
                </RetroCard>

                <div className="flex flex-col gap-1 px-0">
                  <Text as="h3" className="font-sans text-xl font-bold px-2">
                    Offerings
                  </Text>
                  <div className="flex flex-col gap-3">
                    {offerings.length === 0 ? (
                      <RetroCard className="px-4 py-3">
                        <p>This subject is not yet available for any school year, term, or pathway.</p>
                        <p className="text-sm text-black/70">
                          Create an offering when this subject should be used in a specific academic year or term.
                        </p>
                      </RetroCard>
                    ) : (
                      offerings.map((offering) => (
                        <ClassItemLine
                          key={offering.subject_offering_id}
                          subject={`${offering.academic_year.year_label} | ${pathwayLabel(offering.pathway)}`}
                          date={`${offering.academic_level.level_name} | ${offering.academic_period.period_name} | ${offering.status}`}
                          time={offering.academic_period.period_type}
                          schedule={[`Term ${offering.academic_period.period_sequence}`]}
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
