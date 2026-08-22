import { useCallback, useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Loader } from "@/components/retroui/Loader";
import { Select } from "@/components/retroui/Select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Plus, Search } from "lucide-react";
import { Text } from "@/components/retroui/Text";
import { useNavigate, useParams } from "react-router-dom";
import AddSubjectModal from "./forms/add-subject";
import { OverviewCard } from "@/components/overview-cards";
import SubjectItemLine from "@/components/item-line/subject";
import ConfirmDialog from "@/components/confirm-dialog";
import {
  archiveSubject,
  getSubjectOfferingFormOptions,
  getSubjects,
  type SubjectListItem,
  type SubjectOfferingFormOptions,
  type SubjectStatus,
} from "@/lib/api";

export default function AdminSubjectLevel() {
  const navigate = useNavigate();
  const { grade } = useParams<{ grade: string }>();
  const decodedGrade = decodeURIComponent(grade || "Grade 7");
  const [subjects, setSubjects] = useState<SubjectListItem[]>([]);
  const [offeringOptions, setOfferingOptions] =
    useState<SubjectOfferingFormOptions | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SubjectStatus | "all">("active");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<SubjectListItem | null>(
    null,
  );
  const [isSubjectModalOpen, setIsSubjectModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<SubjectListItem | null>(null);

  const openCreateSubject = () => {
    setEditingSubject(null);
    setIsSubjectModalOpen(true);
  };

  const openEditSubject = (subject: SubjectListItem) => {
    setEditingSubject(subject);
    setIsSubjectModalOpen(true);
  };

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
      .filter(
        (subject) =>
          subject.academic_level.level_name.toLowerCase() === normalizedGrade,
      )
      .sort((a, b) => a.subject_name.localeCompare(b.subject_name));
  }, [decodedGrade, subjects]);

  const visibleSubjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return gradeSubjects.filter((subject) => {
      const matchesStatus = status === "all" || subject.status === status;
      const matchesSearch =
        !query ||
        [
          subject.subject_name,
          subject.subject_codename,
          subject.subject_group?.name,
          subject.default_grading_template,
        ].some((value) => value?.toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [gradeSubjects, search, status]);

  const activeYearLabel = offeringOptions?.academic_years.find(
    (year) => year.is_active,
  )?.year_label;
  const activeSubjects = gradeSubjects.filter(
    (subject) => subject.status === "active",
  );
  const archivedSubjects = gradeSubjects.filter(
    (subject) => subject.status === "archived",
  );
  const totalHours = gradeSubjects.reduce(
    (total, subject) => total + (subject.hours ?? 0),
    0,
  );
  const unsetHoursCount = gradeSubjects.filter(
    (subject) => subject.hours == null,
  ).length;
  const totalHoursDisplay =
    unsetHoursCount > 0
      ? `${totalHours} (${unsetHoursCount} unset)`
      : String(totalHours);

  const handleArchive = async () => {
    if (!pendingArchive) return;
    try {
      await archiveSubject(pendingArchive.subject_id);
      await loadSubjects();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to archive subject.",
      );
    } finally {
      setPendingArchive(null);
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
                      <Breadcrumb.Page>{decodedGrade}</Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </Breadcrumb.List>
                </Breadcrumb>
              </div>

              <Button onClick={openCreateSubject}>
                <Plus className="mr-2 size-4" />
                New Subject
              </Button>
            </header>

            <div className="-mx-4 md:-mx-6 border-b-2 border-border -mt-[1px]" />

            <RetroCard className="bg-accent py-3">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-end gap-2">
                  <Text as="h2" className="font-sansm font-bold">
                    {decodedGrade}
                  </Text>
                  {activeYearLabel ? (
                    <p className="pb-1 text-lg font-semibold">
                      ({activeYearLabel})
                    </p>
                  ) : null}
                </div>
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
                <OverviewCard
                  title="Total Subjects"
                  count={String(gradeSubjects.length)}
                />
                <OverviewCard
                  title="Active Subjects"
                  count={String(activeSubjects.length)}
                />
                <OverviewCard
                  title="Archived Subjects"
                  count={String(archivedSubjects.length)}
                />
                <OverviewCard title="Total Hours" count={totalHoursDisplay} />
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
                  <Select
                    value={status}
                    onValueChange={(value) =>
                      setStatus(value as SubjectStatus | "all")
                    }
                  >
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
                  <RetroCard className="px-4 py-3">
                    No subjects found for {decodedGrade}.
                  </RetroCard>
                ) : (
                  visibleSubjects.map((subject) => (
                    <SubjectItemLine
                      key={subject.subject_id}
                      subjectName={subject.subject_name}
                      status={subject.status}
                      isArchived={subject.status === "archived"}
                      subjectCode={subject.subject_codename || "No code"}
                      subjectGroup={subject.subject_group?.name || "Ungrouped"}
                      hours={subject.hours ?? 0}
                      gradingTemplate={
                        subject.default_grading_template || "No template"
                      }
                      onView={() =>
                        navigate(
                          `/admin/subjects/${encodeURIComponent(decodedGrade)}/${subject.subject_id}`,
                        )
                      }
                      onEdit={() => openEditSubject(subject)}
                      onArchive={() => setPendingArchive(subject)}
                    />
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      <Dialog open={isSubjectModalOpen} onOpenChange={setIsSubjectModalOpen}>
        <AddSubjectModal
          open={isSubjectModalOpen}
          subjectToEdit={editingSubject}
          lockedGradeLevel={decodedGrade}
          onCreated={async () => {
            await loadSubjects();
          }}
        />
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingArchive)}
        onOpenChange={(open) => {
          if (!open) setPendingArchive(null);
        }}
        title="Archive Subject?"
        description={
          <p>
            <strong>{pendingArchive?.subject_name}</strong> will be moved out of active use.
          </p>
        }
        options={{
          confirmLabel: "Archive",
          confirmVariant: "default",
          onConfirm: handleArchive,
          onCancel: () => setPendingArchive(null),
        }}
      />
    </AppLayout>
  );
}
