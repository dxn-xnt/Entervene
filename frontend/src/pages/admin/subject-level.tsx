import { useCallback, useEffect, useMemo, useState } from "react";
import ConfirmAlertDialog from "@/components/retroui/ConfirmAlertDialog";
import { Badge } from "@/components/retroui/Badge";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Loader } from "@/components/retroui/Loader";
import { Select } from "@/components/retroui/Select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Archive, ArrowUpRight, Plus, Search } from "lucide-react";
import { Text } from "@/components/retroui/Text";
import { useNavigate, useParams } from "react-router-dom";
import AddSubjectModal from "./forms/add-subject";
import {
  archiveSubject,
  getSubjectOfferingFormOptions,
  getSubjects,
  type SubjectListItem,
  type SubjectOfferingFormOptions,
  type SubjectStatus,
} from "@/lib/api";

function subjectCode(subject: SubjectListItem) {
  return subject.subject_codename || "No code";
}

function statusBadge(status: SubjectStatus) {
  return (
    <Badge size="sm" variant={status === "active" ? "surface" : "outline"}>
      {status}
    </Badge>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <RetroCard className="p-4">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-2 text-4xl font-bold">{value}</p>
    </RetroCard>
  );
}

function SubjectGradeRow({
  subject,
  grade,
  onArchive,
}: {
  subject: SubjectListItem;
  grade: string;
  onArchive: (subject: SubjectListItem) => void;
}) {
  const navigate = useNavigate();

  return (
    <RetroCard className="p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          className="min-w-0 text-left"
          onClick={() => navigate(`/admin/subjects/${encodeURIComponent(grade)}/${subject.subject_id}`)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold">{subject.subject_name}</p>
            {statusBadge(subject.status)}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-black/70">
            <span>{subjectCode(subject)}</span>
            <span>{subject.subject_group || "Ungrouped"}</span>
            <span>{subject.hours ?? 0} hours</span>
            <span>{subject.default_grading_template || "No template"}</span>
          </div>
        </button>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/admin/subjects/${encodeURIComponent(grade)}/${subject.subject_id}`)}
          >
            <ArrowUpRight className="mr-2 size-4" /> View
          </Button>
          {subject.status === "active" ? (
            <Button size="sm" variant="outline" onClick={() => onArchive(subject)}>
              <Archive className="mr-2 size-4" /> Archive
            </Button>
          ) : null}
        </div>
      </div>
    </RetroCard>
  );
}

export default function AdminSubjectLevel() {
  const { grade } = useParams<{ grade: string }>();
  const decodedGrade = decodeURIComponent(grade || "Grade 7");
  const [subjects, setSubjects] = useState<SubjectListItem[]>([]);
  const [offeringOptions, setOfferingOptions] = useState<SubjectOfferingFormOptions | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SubjectStatus | "all">("active");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<SubjectListItem | null>(null);

  const loadSubjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [subjectData, optionsData] = await Promise.all([
        getSubjects(),
        getSubjectOfferingFormOptions().catch(() => null),
      ]);
      setSubjects(subjectData.subjects);
      setOfferingOptions(optionsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load subjects.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  const gradeSubjects = useMemo(() => {
    const normalizedGrade = decodedGrade.trim().toLowerCase();
    return subjects
      .filter((subject) => subject.academic_level.level_name.toLowerCase() === normalizedGrade)
      .sort((a, b) => a.subject_name.localeCompare(b.subject_name));
  }, [decodedGrade, subjects]);

  const visibleSubjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return gradeSubjects.filter((subject) => {
      const matchesStatus = status === "all" || subject.status === status;
      const matchesSearch = !query || [
        subject.subject_name,
        subject.subject_codename,
        subject.subject_group,
        subject.default_grading_template,
      ].some((value) => value?.toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [gradeSubjects, search, status]);

  const activeYearLabel = offeringOptions?.academic_years.find((year) => year.is_active)?.year_label;
  const activeSubjects = gradeSubjects.filter((subject) => subject.status === "active");
  const archivedSubjects = gradeSubjects.filter((subject) => subject.status === "archived");
  const totalHours = gradeSubjects.reduce((total, subject) => total + (subject.hours ?? 0), 0);

  const handleArchive = async () => {
    if (!pendingArchive) return;
    try {
      await archiveSubject(pendingArchive.subject_id);
      await loadSubjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to archive subject.");
    } finally {
      setPendingArchive(null);
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 p-4 md:p-6">
            <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
                      <Breadcrumb.Page>{decodedGrade}</Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </Breadcrumb.List>
                </Breadcrumb>
              </div>

              <Dialog>
                <Dialog.Trigger>
                  <Button>
                    <Plus className="mr-2 size-4" />
                    New Subject
                  </Button>
                </Dialog.Trigger>
                <AddSubjectModal onCreated={loadSubjects} />
              </Dialog>
            </header>

            <RetroCard className="bg-[#fff1b8] px-4 py-3">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-end gap-2">
                  <Text as="h1" className="font-sans text-3xl font-bold">
                    {decodedGrade}
                  </Text>
                  {activeYearLabel ? <p className="pb-1 text-sm font-semibold">({activeYearLabel})</p> : null}
                </div>
                <p className="text-sm">Subject catalog records for this grade level.</p>
              </div>
            </RetroCard>

            {error ? (
              <RetroCard className="bg-[#fff7d6] px-4 py-3">
                <p className="font-semibold">Unable to load subjects</p>
                <p className="text-sm">{error}</p>
              </RetroCard>
            ) : null}

            <section className="flex flex-col gap-2">
              <Text as="h3" className="font-sans text-xl font-bold">
                Overview
              </Text>
              <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
                <StatCard title="Total Subjects" value={String(gradeSubjects.length)} />
                <StatCard title="Active Subjects" value={String(activeSubjects.length)} />
                <StatCard title="Archived Subjects" value={String(archivedSubjects.length)} />
                <StatCard title="Total Hours" value={String(totalHours)} />
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <Text as="h3" className="font-sans text-xl font-bold">
                  Subjects
                </Text>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="relative min-w-0">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                    <Input
                      className="h-10 w-full pl-9 sm:w-72"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search name, code, group"
                    />
                  </label>
                  <Select value={status} onValueChange={(value) => setStatus(value as SubjectStatus | "all")}>
                    <Select.Trigger className="h-10 w-full sm:w-40">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        <Select.Item value="active">Active</Select.Item>
                        <Select.Item value="archived">Archived</Select.Item>
                        <Select.Item value="all">All</Select.Item>
                      </Select.Group>
                    </Select.Content>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {isLoading ? (
                  <RetroCard className="flex items-center gap-3 px-4 py-3">
                    <Loader size="sm" /> Loading subjects...
                  </RetroCard>
                ) : visibleSubjects.length === 0 ? (
                  <RetroCard className="px-4 py-3">No subjects found for {decodedGrade}.</RetroCard>
                ) : (
                  visibleSubjects.map((subject) => (
                    <SubjectGradeRow
                      key={subject.subject_id}
                      subject={subject}
                      grade={decodedGrade}
                      onArchive={setPendingArchive}
                    />
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {pendingArchive ? (
        <ConfirmAlertDialog
          title="Archive subject?"
          description={`${pendingArchive.subject_name} will be moved out of active use.`}
          confirmLabel="Archive"
          onCancel={() => setPendingArchive(null)}
          onConfirm={() => void handleArchive()}
        />
      ) : null}
    </AppLayout>
  );
}
