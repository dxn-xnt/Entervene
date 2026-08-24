import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { apiFetch, getTeacherAdvisoryClasses } from "@/lib/api";
import type { TeacherAdvisoryClassListItem } from "@/types/adminClasses";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import { Progress } from "@/components/retroui/Progress";

type TeacherClassLoad = {
  subject_load_id: number;
  subject_id: number;
  subject_name: string;
  subject_codename?: string | null;
  class_id: number;
  section_name: string;
  grade_level?: string;
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
      className="group relative flex w-full min-w-0 flex-col justify-between shadow-none p-3 hover:-translate-y-1 cursor-pointer"
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
      <div className="flex flex-col items-start justify-between gap-2">
        <div className="flex flex-row w-full items-center justify-between gap-2">
          <p className="text-2xl font-bold">
            {load.section_name}
          </p>
          {isAdvisory && (
            <Badge size="sm" variant="solid">
              Advisory
            </Badge>
          )}
          <Badge size="sm" variant="secondary">
            {load.grade_level}
          </Badge>
        </div>
        <div className="flex flex-col w-full gap-1">
          <p className="text-xs font-normal">Progress</p>
          <div className="flex flex-row gap-1">
            <Progress className="w-full" value={12} />
            <p className="text-xs font-bold">12%</p>
          </div>
        </div>
        <div className="flex flex-col w-full gap-1 mt-1">
          <Card className="bg-primary w-full shadow-none py-2 px-3">
            <div className="flex flex-col w-full gap-2">
              <div className="flex flex-row justify-between ">
                <p className="text-md font-semibold">Assignments 2</p>
                <Button
                  variant="secondary"
                  className="shadow-none p-1"
                  size="sm">
                  <ArrowUpRight className="size-3" />
                </Button>
              </div>
              <div className="flex flex-row gap-2 items-center">
                <Badge size="sm" variant="outline">
                  Ongoing
                </Badge>
                <Badge size="sm" variant="solid">
                  Due in 2 days
                </Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Card>
  );
}

const TeacherClasses = () => {
  const navigate = useNavigate();
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [advisoryClasses, setAdvisoryClasses] = useState<
    TeacherAdvisoryClassListItem[]
  >([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { selectedPeriodId } = useAcademicPeriod();

  useEffect(() => {
    const loadTeacherClasses = async () => {
      setIsLoading(true);
      setError("");

      try {
        const query = selectedPeriodId ? `?academic_period_id=${selectedPeriodId}` : "";
        const [response, advisoryData] = await Promise.all([
          apiFetch(`/api/v1/classwork-assignments/teacher/classes${query}`),
          getTeacherAdvisoryClasses(selectedPeriodId ?? undefined),
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
  }, [selectedPeriodId]);

  const advisoryByClass = useMemo(() => {
    return new Map(advisoryClasses.map((item) => [item.class_id, item]));
  }, [advisoryClasses]);

  const groupedSubjectLoads = useMemo(() => {
    const groups = new Map<
      number,
      {
        subjectId: number;
        subjectName: string;
        subjectCodename?: string | null;
        gradeLabel?: string;
        loads: TeacherClassLoad[];
      }
    >();

    loads.forEach((load) => {
      const gradeLabel =
        load.grade_level ||
        advisoryByClass.get(load.class_id)?.academic_level;

      if (!groups.has(load.subject_id)) {
        groups.set(load.subject_id, {
          subjectId: load.subject_id,
          subjectName: load.subject_name,
          subjectCodename: load.subject_codename,
          gradeLabel,
          loads: [],
        });
      }
      groups.get(load.subject_id)!.loads.push(load);
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        loads: group.loads.sort((a, b) =>
          a.section_name.localeCompare(b.section_name)
        ),
      }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
  }, [advisoryByClass, loads]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-2xl md:text-4xl font-bold tracking-tight">Classes</h1>
            </header>

            <div className="-mx-4 md:-mx-6 border-b-2 border-border -mt-[1px]" />

            {error && (
              <Alert
                status="error"
                position="top-right"

                duration={5000}
                onClose={() => setError("")}
              >
                <Alert.Title>Error</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert>
            )}

            {isLoading ? (
              <p className="py-8 text-center text-gray-500">
                Loading classes...
              </p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* Left: Subject Loads */}
                <div className="lg:col-span-8 flex flex-col gap-4">
                  {groupedSubjectLoads.length === 0 ? (
                    <Card className="flex justify-center items-center border-black py-8 text-sm font-semibold">
                      No subject teaching sections assigned.
                    </Card>
                  ) : (
                    groupedSubjectLoads.map((group) => (
                      <Card
                        key={group.subjectId}
                        className="flex flex-col"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold">
                              {group.subjectName}
                            </h2>
                            {group.subjectCodename && (
                              <Badge variant="default" size="sm">
                                {group.subjectCodename}
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-row gap-3">
                            <Badge variant="secondary">
                              {group.loads.length} section{group.loads.length !== 1 ? "s" : ""}
                            </Badge>
                            <Button
                              variant="secondary"
                              className="shadow-none"
                              size="icon"
                              title={`View ${group.subjectName}`}
                              onClick={() => {
                                if (group.loads[0]) {
                                  navigate(
                                    `/teacher/classes/${group.loads[0].class_id}/subjects/${group.subjectId}`,
                                  );
                                }
                              }}
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
                                navigate(`/teacher/classes/${load.class_id}`)
                              }
                            />
                          ))}
                        </div>
                      </Card>
                    ))
                  )}
                </div>

                {/* Right: Advisory Class */}
                <Card className="lg:col-span-4 gap-3 flex flex-col bg-primary">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold">Advisory Class</h2>
                    <div className="flex flex-row gap-3">
                      <Badge variant="outline">
                        {advisoryClasses.length} section
                        {advisoryClasses.length !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3">
                    {advisoryClasses.length === 0 ? (
                      <p className="text-sm font-semibold text-gray-700 py-4 text-center">
                        No advisory classes assigned.
                      </p>
                    ) : (
                      advisoryClasses.map((item) => (
                        <AdvisoryCatalogCard
                          key={item.class_id}
                          item={item}
                          onClick={() =>
                            navigate(`/teacher/advisory-class/${item.class_id}`)
                          }
                        />
                      ))
                    )}
                  </div>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default TeacherClasses;
