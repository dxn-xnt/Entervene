import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ClipboardList, Search, UserRound } from "lucide-react";
import {
  getTeacherRecordPeriods,
  getTeacherStudentRecordDetail,
  getTeacherStudentRoster,
  type StudentRecordDetailResponse,
  type StudentRecordPeriodOption,
  type StudentRecordRosterRow,
  type StudentRecordRosterResponse,
} from "@/lib/student-record-api";
import { Input } from "@/components/retroui/Input";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Select } from "@/components/retroui/Select";

import type { TeacherAdvisorySubjectLoadItem } from "@/types/adminClasses";
import { ManualSuggestionPanel } from "@/components/teacher/suggestions/ManualSuggestionPanel";

type StudentRecordsPanelProps = {
  classId: string;
  subjectId: string;
  subjectLoads?: TeacherAdvisorySubjectLoadItem[];
};

function formatMetric(value?: number | null, suffix = "%", emptyValue = "0") {
  if (value === null || value === undefined) return `${emptyValue}${suffix}`;
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

function formatOfficialGrade(value?: number | null) {
  if (value === null || value === undefined) return "Not encoded";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDateTime(value?: string | null) {
  if (!value) return "No due date";
  return new Date(value).toLocaleString();
}

function statusLabel(status: string) {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function StudentRecordsPanel({
  classId,
  subjectId,
  subjectLoads = [],
}: StudentRecordsPanelProps) {
  const [periods, setPeriods] = useState<StudentRecordPeriodOption[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [roster, setRoster] = useState<StudentRecordRosterResponse | null>(
    null,
  );
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    null,
  );
  const [detail, setDetail] = useState<StudentRecordDetailResponse | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  // Period options for Select
  const periodOptions = periods.map((period) => ({
    value: period.academic_period_id,
    label: `${period.period_name} (${period.year_label})`,
  }));

  useEffect(() => {
    let isMounted = true;

    const loadPeriods = async () => {
      setError("");
      try {
        const data = await getTeacherRecordPeriods(classId, subjectId);
        if (!isMounted) return;
        setPeriods(data.periods);
        setSelectedPeriodId(
          String(
            data.default_academic_period_id ||
              data.periods[0]?.academic_period_id ||
              "",
          ),
        );
      } catch (err) {
        if (isMounted)
          setError(
            err instanceof Error ? err.message : "Unable to load periods.",
          );
      }
    };

    loadPeriods();
    return () => {
      isMounted = false;
    };
  }, [classId, subjectId]);

  useEffect(() => {
    if (!selectedPeriodId) {
      setRoster(null);
      return;
    }
    let isMounted = true;

    const loadRoster = async () => {
      setIsLoading(true);
      setError("");
      setSelectedStudentId(null);
      setDetail(null);
      try {
        const data = await getTeacherStudentRoster(
          classId,
          subjectId,
          selectedPeriodId,
        );
        if (isMounted) setRoster(data);
      } catch (err) {
        if (isMounted)
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load student records.",
          );
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadRoster();
    return () => {
      isMounted = false;
    };
  }, [classId, selectedPeriodId, subjectId]);

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    const students = roster?.students || [];
    if (!query) return students;
    return students.filter((student) =>
      [student.full_name, student.lrn, student.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [roster, search]);

  const classAverage = useMemo(() => {
    const students = roster?.students || [];
    if (!students.length) return 0;
    return (
      students.reduce(
        (sum, student) => sum + (student.running_classwork_percentage ?? 0),
        0,
      ) / students.length
    );
  }, [roster]);

  const openStudent = async (student: StudentRecordRosterRow) => {
    setSelectedStudentId(student.student_id);
    setDetail(null);
    setDetailLoading(true);
    setError("");
    try {
      setDetail(
        await getTeacherStudentRecordDetail(
          classId,
          subjectId,
          student.student_id,
          selectedPeriodId,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load student detail.",
      );
    } finally {
      setDetailLoading(false);
    }
  };

  if (selectedStudentId) {
    return (
      <section className="space-y-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setSelectedStudentId(null);
            setDetail(null);
          }}
          className="gap-2 border-black bg-white font-semibold"
        >
          <ArrowLeft size={16} />
          Back to students
        </Button>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {detailLoading || !detail ? (
          <p className="py-8 text-center text-gray-500">
            Loading student record...
          </p>
        ) : (
          <StudentRecordDetail 
          detail={detail} 
          classId={Number(classId)} 
          subjectLoads={subjectLoads}
        />
        )}
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Students</h2>
          <p className="text-sm text-gray-600">
            View scoped records for {roster?.scope.section_name || "this class"}
            .
          </p>
        </div>

        <Select
          value={selectedPeriodId}
          onValueChange={(v) => setSelectedPeriodId(v)}
        >
          <Select.Trigger className="h-10 text-sm bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-semibold min-w-[200px]">
            <Select.Value placeholder="Select period" />
          </Select.Trigger>
          <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            {periodOptions.length ? (
              periodOptions.map((period) => (
                <Select.Item key={period.value} value={String(period.value)}>
                  {period.label}
                </Select.Item>
              ))
            ) : (
              <div className="px-2 py-1.5 text-sm text-gray-500">
                No periods available
              </div>
            )}
          </Select.Content>
        </Select>
      </div>

      {!periods.length && !error && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          No academic period is assigned to this class and subject yet.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="block">
          <Card.Content className="space-y-1">
            <Card.Description>Students</Card.Description>
            <Card.Title>{roster?.students.length ?? 0}</Card.Title>
            <p className="text-xs text-black">Enrolled in this class scope</p>
          </Card.Content>
        </Card>

        <Card className="block">
          <Card.Content className="space-y-1">
            <Card.Description>Classwork Average</Card.Description>
            <Card.Title>{formatMetric(classAverage)}</Card.Title>
            <p className="text-xs text-black">
              Running percentage, not official grade
            </p>
          </Card.Content>
        </Card>

        <Card className="bloc">
          <Card.Content className="space-y-1">
            <Card.Description>Completion</Card.Description>
            <Card.Title>
              {formatMetric(averageMetric(roster?.students, "completion_rate"))}
            </Card.Title>
            <p className="text-xs text-black">
              Submitted, late, or graded work
            </p>
          </Card.Content>
        </Card>
      </div>


{/* wapa ywa  */}
      {/* Search bar - always visible with proper spacing */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <label className="relative w-full md:w-96 shadow-md transition-shadow hover:shadow-none">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by student name, LRN, or email"
            className="h-10 w-full border-black pl-9 pr-3 shadow-none"
          />
        </label>
      </div>

      <Card className="block border-black mt-4">
        <Card.Content className="p-6">
          {isLoading ? (
            <p className="py-8 text-center text-gray-500">
              Loading student records...
            </p>
          ) : !filteredStudents.length ? (
            <div className="py-8 text-center">
              <div className="inline-flex h-20 w-20 items-center justify-center rounded-full border-2 border-black bg-[#F6E9B2] mb-4">
                {search.trim() ? (
                  <Search size={36} className="text-gray-600" />
                ) : (
                  <UserRound size={36} className="text-gray-600" />
                )}
              </div>
              <p className="text-xl font-bold text-gray-800">
                {search.trim()
                  ? "No students match your search"
                  : "No students enrolled"}
              </p>
              <p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">
                {search.trim()
                  ? "Try adjusting your search terms or clear the search to see all students"
                  : "Students will appear here once they are enrolled in this class"}
              </p>
              {search.trim() && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="mt-4 text-sm font-semibold text-blue-600 hover:underline"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredStudents.map((student) => (
                <button
                  key={student.student_id}
                  type="button"
                  onClick={() => openStudent(student)}
                  className="grid w-full gap-3 px-2 py-3 text-left hover:bg-[#F6E9B2]/60 md:grid-cols-[1.4fr_repeat(4,0.7fr)] md:items-center"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-black bg-[#F6E9B2] font-bold">
                      {student.full_name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-bold">{student.full_name}</p>
                      <p className="text-xs text-gray-600">LRN {student.lrn}</p>
                    </div>
                  </div>
                  <SmallMetric
                    label="Official"
                    value={formatOfficialGrade(student.official_period_grade)}
                  />
                  <SmallMetric
                    label="Running"
                    value={formatMetric(student.running_classwork_percentage)}
                  />
                  <SmallMetric
                    label="Complete"
                    value={formatMetric(student.completion_rate)}
                  />
                  <SmallMetric
                    label="Flags"
                    value={`${student.missing_count} missing / ${student.late_count} late`}
                  />
                </button>
              ))}
            </div>
          )}
        </Card.Content>
      </Card>
    </section>
  );
}

function StudentRecordDetail({
  detail,
  classId,
  subjectLoads,
}: {
  detail: StudentRecordDetailResponse;
  classId: number;
  subjectLoads: TeacherAdvisorySubjectLoadItem[];
}) {
  return (
    <div className="space-y-4">
      <Card className="block bg-[#F6E9B2] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <Card.Content className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-gray-700">
              Student record
            </p>
            <Card.Title className="text-3xl font-bold">
              {detail.student.full_name}
            </Card.Title>
            <p className="text-sm text-gray-700">
              {detail.student.academic_level || "Student"} |{" "}
              {detail.student.section_name} | LRN {detail.student.lrn}
            </p>
          </div>
          <UserRound size={24} className="shrink-0" />
        </Card.Content>
      </Card>
      
      <ManualSuggestionPanel
        classId={classId}
        student={{
          student_id: detail.student.student_id,
          full_name: detail.student.full_name,
        } as any}
        subjectLoads={subjectLoads}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="block bg-[#F6E9B2] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <Card.Content className="space-y-1">
            <p className="text-sm font-medium text-gray-900">Official Grade</p>
            <p className="text-3xl font-bold">
              {formatOfficialGrade(detail.summary.official_period_grade)}
            </p>
            <p className="text-xs font-medium text-gray-700">
              Encoded period grade
            </p>
          </Card.Content>
        </Card>

        <Card className="block bg-[#F6E9B2] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <Card.Content className="space-y-1">
            <p className="text-sm font-medium text-gray-900">Running Average</p>
            <p className="text-3xl font-bold">
              {formatMetric(detail.summary.running_classwork_percentage)}
            </p>
            <p className="text-xs font-medium text-gray-700">Classwork only</p>
          </Card.Content>
        </Card>

        <Card className="block bg-[#F6E9B2] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <Card.Content className="space-y-1">
            <p className="text-sm font-medium text-gray-900">Completion</p>
            <p className="text-3xl font-bold">
              {formatMetric(detail.summary.completion_rate)}
            </p>
            <p className="text-xs font-medium text-gray-700">
              {detail.summary.submitted_count}/{detail.summary.assigned_count}{" "}
              done
            </p>
          </Card.Content>
        </Card>

        <Card className="block bg-[#F6E9B2] border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <Card.Content className="space-y-1">
            <p className="text-sm font-medium text-gray-900">Needs Attention</p>
            <p className="text-3xl font-bold">
              {detail.summary.missing_count + detail.summary.ungraded_count}
            </p>
            <p className="text-xs font-medium text-gray-700">
              Missing or ungraded
            </p>
          </Card.Content>
        </Card>
      </div>

      <Card className="block border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <Card.Content>
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList size={18} />
            <Card.Title className="mb-0 text-xl font-bold">
              Classwork History
            </Card.Title>
            <Badge
              variant="secondary"
              size="sm"
              className="ml-auto border border-black bg-[#F6E9B2]"
            >
              {detail.classwork_results.length}
            </Badge>
          </div>
          <div className="space-y-3">
            {detail.classwork_results.length ? (
              detail.classwork_results.map((item) => (
                <div
                  key={item.assignment_id}
                  className="rounded-lg border border-gray-300 px-4 py-3"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-bold">{item.title}</p>
                      <p className="text-xs text-gray-600">
                        {item.type}{" "}
                        {item.category
                          ? `| ${item.category.replace(/_/g, " ")}`
                          : ""}{" "}
                        | {formatDateTime(item.due_date)}
                      </p>
                    </div>
                    <div className="text-left md:text-right">
                      <p className="font-bold">
                        {item.score ?? 0}/{item.total_points ?? 0}
                      </p>
                      <p className="text-xs text-gray-600">
                        {statusLabel(item.status)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-gray-500">
                No classwork records for this period yet.
              </p>
            )}
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="font-bold">{value}</p>
    </div>
  );
}

function averageMetric(
  students: StudentRecordRosterRow[] | undefined,
  key: keyof Pick<
    StudentRecordRosterRow,
    "completion_rate" | "running_classwork_percentage"
  >,
) {
  const values = (students || [])
    .map((student) => student[key])
    .filter((value): value is number => typeof value === "number");
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
