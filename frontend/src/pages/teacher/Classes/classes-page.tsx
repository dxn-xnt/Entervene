import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { ArrowUpRight, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { apiFetch, getTeacherAdvisoryClasses } from "@/lib/api";
import type { TeacherAdvisoryClassListItem } from "@/types/adminClasses";

type TeacherClassLoad = {
  subject_load_id: number;
  subject_id: number;
  subject_name: string;
  subject_codename?: string | null;
  class_id: number;
  section_name: string;
};

function AdvisoryCatalogCard({
  item,
  onClick,
}: {
  item: TeacherAdvisoryClassListItem;
  onClick: () => void;
}) {
  return (
    <Card
      className="group relative flex min-w-80 flex-col justify-between shadow-none p-3 hover:-translate-y-1 cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-2xl font-bold leading-tight mr-5">
            {item.section_name}
          </p>
          <p className="text-sm font-semibold">
            {item.academic_level} · {item.academic_year}
          </p>
        </div>
        <Badge variant="solid">Advisory</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <span className="font-semibold">
          {item.is_archived ? "Archived" : "Active"}
        </span>
        <span className="text-right font-semibold">
          {item.student_count} students
        </span>
        <span className="col-span-2 font-semibold">
          {item.subject_count} subjects
        </span>
      </div>
    </Card>
  );
}

function SubjectClassCatalogCard({
  load,
  isAdvisory,
  onClick,
}: {
  load: TeacherClassLoad;
  isAdvisory: boolean;
  onClick: () => void;
}) {
  return (
    <Card
      className="group relative flex min-w-80 flex-col justify-between shadow-none p-3 hover:-translate-y-1 cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-2xl font-bold leading-tight mr-5">
            {load.section_name}
          </p>
          <p className="text-sm font-semibold">{load.subject_name}</p>
        </div>
        {isAdvisory && <Badge variant="solid">Advisory</Badge>}
      </div>
    </Card>
  );
}

const ClassesPage = () => {
  const navigate = useNavigate();
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [advisoryClasses, setAdvisoryClasses] = useState<
    TeacherAdvisoryClassListItem[]
  >([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadTeacherClasses = async () => {
      setIsLoading(true);
      setError("");

      try {
        const [response, advisoryData] = await Promise.all([
          apiFetch("/api/v1/classwork-assignments/teacher/classes"),
          getTeacherAdvisoryClasses(),
        ]);
        if (!response.ok) {
          throw new Error("Unable to load teacher classes.");
        }

        setLoads((await response.json()) as TeacherClassLoad[]);
        setAdvisoryClasses(advisoryData);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load teacher classes.",
        );
      } finally {
        setIsLoading(false);
      }
    };

    loadTeacherClasses();
  }, []);

  const advisoryByClass = useMemo(() => {
    return new Map(advisoryClasses.map((item) => [item.class_id, item]));
  }, [advisoryClasses]);

  const groupedSubjectLoads = useMemo(() => {
    const groups = new Map<string, TeacherClassLoad[]>();
    loads.forEach((load) => {
      const gradeLabel =
        advisoryByClass.get(load.class_id)?.academic_level ||
        "Teaching Sections";
      groups.set(gradeLabel, [...(groups.get(gradeLabel) || []), load]);
    });

    return Array.from(groups.entries())
      .map(([gradeLabel, classLoads]) => ({
        gradeLabel,
        loads: classLoads.sort(
          (a, b) =>
            a.section_name.localeCompare(b.section_name) ||
            a.subject_name.localeCompare(b.subject_name),
        ),
      }))
      .sort((a, b) => a.gradeLabel.localeCompare(b.gradeLabel));
  }, [advisoryByClass, loads]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-2xl md:text-4xl font-bold">Classes</h1>
            </header>

            <div className="-mx-4 md:-mx-6 border-b-2 border-border -mt-[1px]" />

            {error && (
              <div className="rounded-lg border-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <Card className="block w-full border-black bg-primary transition-none hover:shadow-md">
              <Card.Content>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Card.Title className="mb-0">2024 - 2025</Card.Title>
                    <p className="text-xs font-medium">
                      Sections assigned for this academic year
                    </p>
                  </div>
                  <Info size={16} />
                </div>
              </Card.Content>
            </Card>

            {isLoading ? (
              <p className="py-8 text-center text-gray-500">
                Loading classes...
              </p>
            ) : (
              <>
                <Card className="flex flex-col">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold">Classes</h2>
                    <div className="flex flex-row gap-3">
                      <Badge variant="secondary">
                        {advisoryClasses.length} section
                        {advisoryClasses.length !== 1 ? "s" : ""}
                      </Badge>
                      <Button
                        variant="secondary"
                        className="shadow-none"
                        size="icon"
                        title="View advisory classes"
                      >
                        <ArrowUpRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="pt-3 flex gap-3 overflow-auto pb-2">
                    {advisoryClasses.length === 0 ? (
                      <p className="text-sm font-semibold text-gray-700">
                        No advisory classes assigned.
                      </p>
                    ) : (
                      advisoryClasses.map((item) => (
                        <AdvisoryCatalogCard
                          key={item.class_id}
                          item={item}
                          onClick={() =>
                            navigate(`/teacher/classes/${item.class_id}`)
                          }
                        />
                      ))
                    )}
                  </div>
                </Card>

                {groupedSubjectLoads.length === 0 ? (
                  <Card className="flex justify-center items-center border-black py-8 text-sm font-semibold">
                    No subject teaching sections assigned.
                  </Card>
                ) : (
                  groupedSubjectLoads.map((group) => (
                    <Card
                      key={group.gradeLabel}
                      className="flex flex-col"
                    >
                      <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold">Subjects</h2>
                        <div className="flex flex-row gap-3">
                          <Badge variant="secondary">
                            {group.loads.length} subject
                            {group.loads.length !== 1 ? "s" : ""}
                          </Badge>
                          <Button
                            variant="secondary"
                            className="shadow-none"
                            size="icon"
                            title={`View ${group.gradeLabel}`}
                          >
                            <ArrowUpRight className="size-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="pt-3 flex gap-3 overflow-auto pb-2">
                        {group.loads.map((load) => (
                          <SubjectClassCatalogCard
                            key={load.subject_load_id}
                            load={load}
                            isAdvisory={advisoryByClass.has(load.class_id)}
                            onClick={() =>
                              navigate(
                                `/teacher/classes/${load.class_id}/subjects/${load.subject_id}`,
                              )
                            }
                          />
                        ))}
                      </div>
                    </Card>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default ClassesPage;
