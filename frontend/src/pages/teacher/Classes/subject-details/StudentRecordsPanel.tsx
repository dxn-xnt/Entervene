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

type StudentRecordsPanelProps = {
  classId: string;
  subjectId: string;
};

function formatMetric(value?: number | null, suffix = "%") {
  if (value === null || value === undefined) return "No data";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "No due date";
  return new Date(value).toLocaleString();
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function StudentRecordsPanel({ classId, subjectId }: StudentRecordsPanelProps) {
  const [periods, setPeriods] = useState<StudentRecordPeriodOption[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [roster, setRoster] = useState<StudentRecordRosterResponse | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudentRecordDetailResponse | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    const loadPeriods = async () => {
      setError("");
      try {
        const data = await getTeacherRecordPeriods();
        if (!isMounted) return;
        setPeriods(data.periods);
        setSelectedPeriodId(String(data.default_academic_period_id || data.periods[0]?.academic_period_id || ""));
      } catch (err) {
        if (isMounted) setError(err instanceof Error ? err.message : "Unable to load periods.");
      }
    };

    loadPeriods();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedPeriodId) return;
    let isMounted = true;

    const loadRoster = async () => {
      setIsLoading(true);
      setError("");
      setSelectedStudentId(null);
      setDetail(null);
      try {
        const data = await getTeacherStudentRoster(classId, subjectId, selectedPeriodId);
        if (isMounted) setRoster(data);
      } catch (err) {
        if (isMounted) setError(err instanceof Error ? err.message : "Unable to load student records.");
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
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [roster, search]);

  const classAverage = useMemo(() => {
    const values = (roster?.students || [])
      .map((student) => student.running_classwork_percentage)
      .filter((value): value is number => typeof value === "number");
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }, [roster]);

  const openStudent = async (student: StudentRecordRosterRow) => {
    setSelectedStudentId(student.student_id);
    setDetail(null);
    setDetailLoading(true);
    setError("");
    try {
      setDetail(await getTeacherStudentRecordDetail(classId, subjectId, student.student_id, selectedPeriodId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load student detail.");
    } finally {
      setDetailLoading(false);
    }
  };

  if (selectedStudentId) {
    return (
      <section className="space-y-4">
        <button
          type="button"
          onClick={() => {
            setSelectedStudentId(null);
            setDetail(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-black bg-white px-4 py-2 font-semibold shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
        >
          <ArrowLeft size={16} />
          Back to students
        </button>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {detailLoading || !detail ? (
          <p className="py-8 text-center text-gray-500">Loading student record...</p>
        ) : (
          <StudentRecordDetail detail={detail} />
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
            View scoped records for {roster?.scope.section_name || "this class"}.
          </p>
        </div>
        <label className="text-sm font-semibold">
          Period
          <select
            value={selectedPeriodId}
            onChange={(event) => setSelectedPeriodId(event.target.value)}
            className="mt-1 block rounded-lg border border-black bg-white px-3 py-2"
          >
            {periods.map((period) => (
              <option key={period.academic_period_id} value={period.academic_period_id}>
                {period.period_name} ({period.year_label})
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <RecordMetric title="Students" value={String(roster?.students.length ?? 0)} note="Enrolled in this class scope" />
        <RecordMetric title="Classwork Average" value={formatMetric(classAverage)} note="Running percentage, not official grade" />
        <RecordMetric
          title="Completion"
          value={formatMetric(averageMetric(roster?.students, "completion_rate"))}
          note="Submitted, late, or graded work"
        />
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-black bg-white px-3 py-2">
        <Search size={16} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full bg-transparent outline-none"
          placeholder="Search by student name, LRN, or email"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        {isLoading ? (
          <p className="py-8 text-center text-gray-500">Loading student records...</p>
        ) : filteredStudents.length ? (
          <div className="divide-y divide-gray-200">
            {filteredStudents.map((student) => (
              <button
                key={student.student_id}
                type="button"
                onClick={() => openStudent(student)}
                className="grid w-full gap-3 px-4 py-3 text-left hover:bg-[#F6E9B2]/60 md:grid-cols-[1.4fr_repeat(4,0.7fr)] md:items-center"
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
                <SmallMetric label="Official" value={formatMetric(student.official_period_grade, "")} />
                <SmallMetric label="Running" value={formatMetric(student.running_classwork_percentage)} />
                <SmallMetric label="Complete" value={formatMetric(student.completion_rate)} />
                <SmallMetric label="Flags" value={`${student.missing_count} missing / ${student.late_count} late`} />
              </button>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-gray-500">No students match this search.</p>
        )}
      </div>
    </section>
  );
}

function StudentRecordDetail({ detail }: { detail: StudentRecordDetailResponse }) {
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-black bg-[#F6E9B2] p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-gray-700">Student record</p>
            <h2 className="text-3xl font-bold">{detail.student.full_name}</h2>
            <p className="text-sm text-gray-700">
              {detail.student.academic_level || "Student"} | {detail.student.section_name} | LRN {detail.student.lrn}
            </p>
          </div>
          <UserRound size={24} />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <RecordMetric title="Official Grade" value={formatMetric(detail.summary.official_period_grade, "")} note="Encoded period grade" />
        <RecordMetric title="Running Average" value={formatMetric(detail.summary.running_classwork_percentage)} note="Classwork only" />
        <RecordMetric title="Completion" value={formatMetric(detail.summary.completion_rate)} note={`${detail.summary.submitted_count}/${detail.summary.assigned_count} done`} />
        <RecordMetric title="Needs Attention" value={`${detail.summary.missing_count + detail.summary.ungraded_count}`} note="Missing or ungraded" />
      </div>

      <section className="rounded-lg border border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <div className="mb-3 flex items-center gap-2">
          <ClipboardList size={18} />
          <h3 className="text-xl font-bold">Classwork History</h3>
        </div>
        <div className="space-y-3">
          {detail.classwork_results.length ? (
            detail.classwork_results.map((item) => (
              <div key={item.assignment_id} className="rounded-lg border border-gray-300 px-4 py-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-bold">{item.title}</p>
                    <p className="text-xs text-gray-600">
                      {item.type} {item.category ? `| ${item.category.replace(/_/g, " ")}` : ""} | {formatDateTime(item.due_date)}
                    </p>
                  </div>
                  <div className="text-left md:text-right">
                    <p className="font-bold">
                      {item.score ?? 0}/{item.total_points ?? 0}
                    </p>
                    <p className="text-xs text-gray-600">{statusLabel(item.status)}</p>
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
      </section>
    </div>
  );
}

function RecordMetric({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-black bg-[#F6E9B2] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <p className="font-semibold text-gray-900">{title}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      <p className="mt-1 text-xs font-medium text-gray-700">{note}</p>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="font-bold">{value}</p>
    </div>
  );
}

function averageMetric(
  students: StudentRecordRosterRow[] | undefined,
  key: keyof Pick<StudentRecordRosterRow, "completion_rate" | "running_classwork_percentage">
) {
  const values = (students || [])
    .map((student) => student[key])
    .filter((value): value is number => typeof value === "number");
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
