import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminBreadcrumb as Breadcrumb } from "@/components/admin/admin-breadcrumb";
import { Button } from "@/components/retroui/Button";
import { useToast } from "@/components/retroui/Toast";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { Loader } from "@/components/retroui/Loader";
import { Empty } from "@/components/retroui/Empty";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Plus } from "lucide-react";
import { Text } from "@/components/retroui/Text";
import { useNavigate, useParams } from "react-router-dom";
import AddSubjectModal from "./forms/add-subject";
import { OverviewCard } from "@/components/overview-cards";
import { SubjectClassHeader } from "@/components/subject-class-header";
import SubjectItemLine from "@/components/item-line/subject";
import ConfirmDialog from "@/components/confirm-dialog";
import {
  archiveSubject,
  getSubjectOfferingFormOptions,
  getSubjects,
  type SubjectListItem,
  type SubjectOfferingFormOptions,
} from "@/lib/api";

export default function AdminSubjectLevel() {
  const toast = useToast();
  const navigate = useNavigate();
  const { grade } = useParams<{ grade: string }>();
  const decodedGrade = decodeURIComponent(grade || "Grade 7");
  const [subjects, setSubjects] = useState<SubjectListItem[]>([]);
  const [offeringOptions, setOfferingOptions] =
    useState<SubjectOfferingFormOptions | null>(null);
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

  const activeYearLabel = offeringOptions?.academic_years.find(
    (year) => year.is_active,
  )?.year_label;
  const activeSubjects = gradeSubjects.filter(
    (subject) => subject.status === "active",
  );
  const archivedSubjects = gradeSubjects.filter(
    (subject) => subject.status === "archived",
  );

  const handleArchive = async () => {
    if (!pendingArchive) return;
    try {
      await archiveSubject(pendingArchive.subject_id);
      toast.success({ title: "Subject archived" });
      await loadSubjects();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to archive subject.",
      );
      toast.error({ title: "Unable to archive subject", description: err instanceof Error ? err.message : undefined });
    } finally {
      setPendingArchive(null);
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex flex-col gap-2 bg-background px-3 py-3 sm:px-4 sm:py-4 md:flex-row md:items-center md:justify-between md:gap-3 md:px-6">
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
                      <Breadcrumb.Page>{decodedGrade}</Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </Breadcrumb.List>
                </Breadcrumb>
              </div>

              <Button size="header" onClick={openCreateSubject} className="w-full whitespace-nowrap sm:w-auto">
                <Plus className="size-4" />
                New Subject
              </Button>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-3 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              <SubjectClassHeader
                detail={{
                  class_id: decodedGrade,
                  section_name: decodedGrade,
                }}
                teacherName={activeYearLabel ? `Academic Year ${activeYearLabel}` : undefined}
                showViewSubjectButton={false}
              />

              {error ? (
                <RetroCard className="bg-[#fff7d6] px-4 py-3">
                  <p className="font-semibold">Unable to load subjects</p>
                  <p className="text-sm">{error}</p>
                </RetroCard>
              ) : null}

              <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <section className="flex min-w-0 flex-col gap-3">
                  <Text as="h3" className="font-sans text-xl font-bold">
                    Subjects
                  </Text>

                  <div className="flex flex-col gap-3">
                    {isLoading ? (
                      <div className="flex items-center justify-center gap-3 border border-black bg-background py-12 text-sm text-muted-foreground shadow-[4px_5px_0_#000]">
                        <Loader size="sm" />
                        Loading subjects...
                      </div>
                    ) : gradeSubjects.length === 0 ? (
                      <Empty>
                        <Empty.Content>
                          <Empty.Title>No subjects found for {decodedGrade}.</Empty.Title>
                        </Empty.Content>
                      </Empty>
                    ) : (
                      gradeSubjects.map((subject) => (
                        <SubjectItemLine
                          key={subject.subject_id}
                          subjectName={subject.subject_name}
                          status={subject.status}
                          isArchived={subject.status === "archived"}
                          subjectCode={subject.subject_codename || "No code"}
                          subjectGroup={subject.grading_template.template_name}
                          gradingTemplate={
                            subject.grading_template.template_name
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
                <aside className="flex min-w-0 flex-col gap-3" aria-label="Subject summary">
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
                </aside>
              </div>
            </div>
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
        title="Archive Subject"
        confirmationTitle={`Are you sure you want to archive "${pendingArchive?.subject_name}"?`}
        description="Archiving this subject will move it out of active use."
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
