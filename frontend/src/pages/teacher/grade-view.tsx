import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { useParams } from "react-router-dom";
import { Ellipsis, Plus, Search, Download, ClipboardCheck } from "lucide-react";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import ViewGradeScoreModal from "./forms/view-grade-scores";
import AddClassworkScoreModal from "./forms/add-classwork-score";
import EnterManualScoresModal from "./forms/enter-manual-scores";
import AttendanceModal from "./forms/attendance-modal";
import { getTeacherGradebook, type StudentGradebookResponse, type GradebookCategoryHeader } from "@/lib/api";

function fmt(val: number | null | undefined, d = 1): string {
  if (val == null) return "—";
  return val.toFixed(d);
}

/** Helper to get at most 2 latest items (or scores) arranged latest to oldest (newest first). */
function getLatestTwo<T>(arr: T[]): { item: T; originalIndex: number }[] {
  if (!arr || arr.length === 0) return [];
  const result: { item: T; originalIndex: number }[] = [];
  const start = Math.max(0, arr.length - 2);
  for (let i = arr.length - 1; i >= start; i--) {
    result.push({ item: arr[i], originalIndex: i });
  }
  return result;
}

const TeacherGradeView = () => {
  const { section, subject } = useParams<{ section: string; subject: string }>();
  const [gradebook, setGradebook] = useState<StudentGradebookResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("name");

  const [openAttendance, setOpenAttendance] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<{
    name: string;
    items: GradebookCategoryHeader[];
    studentGrades: { name: string; scores: (number | null)[] }[];
  } | null>(null);
  const [addingCategoryName, setAddingCategoryName] = useState<string | null>(null);
  const [scoringActivity, setScoringActivity] = useState<{
    activityId: number;
    title: string;
    maxScore: number;
  } | null>(null);

  const fetchGradebook = () => {
    if (section && subject) {
      setLoading(true);
      getTeacherGradebook(section, subject)
        .then((data) => setGradebook(data))
        .catch((err) => console.error("Error loading gradebook:", err))
        .finally(() => setLoading(false));
    }
  };

  useEffect(() => {
    fetchGradebook();
  }, [section, subject]);

  const cg = gradebook?.classwork?.[0] ?? { writtenWork: [], performanceTask: [], quarterlyAssessment: [] };
  const raw = gradebook?.studentGrades ?? [];
  const filtered = raw
    .filter((sg) => sg.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => (sortBy === "name" ? a.name.localeCompare(b.name) : 0));

  const displaySectionName = gradebook?.scope?.section_name ?? section ?? "Section";
  const displaySubjectName = gradebook?.scope?.subject_name ?? subject ?? "Subject";

  const handleExportCSV = () => {
    if (!gradebook) return;
    const headers = [
      "Learner's Name",
      ...cg.writtenWork.map((w) => `WW: ${w.title} (${w.maxScore})`),
      ...cg.performanceTask.map((p) => `PT: ${p.title} (${p.maxScore})`),
      ...cg.quarterlyAssessment.map((q) => `QA: ${q.title} (${q.maxScore})`),
      "Transmuted Grade",
    ];
    const rows = raw.map((sg) => [
      `"${sg.name}"`,
      ...sg.writtenWork.map((s) => (s !== null && s !== undefined ? s : "")),
      ...sg.performanceTask.map((s) => (s !== null && s !== undefined ? s : "")),
      ...sg.quarterlyAssessment.map((s) => (s !== null && s !== undefined ? s : "")),
      fmt(sg.transmuted_grade ?? sg.initial_grade),
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", `${displaySectionName}_${displaySubjectName}_Gradebook.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <Breadcrumb>
                <Breadcrumb.List>
                  <Breadcrumb.Item>
                    <Breadcrumb.Link href="/teacher/grades" className="text-2xl md:text-4xl font-bold">
                      Grades
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page>{displaySectionName}</Breadcrumb.Page>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page>{displaySubjectName}</Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>

              <div className="flex flex-row gap-2 ml-auto">
                <Button variant={"outline"} className="whitespace-nowrap" onClick={() => setOpenAttendance(true)}>
                  <ClipboardCheck className="size-4 mr-2" /> Check Attendance
                </Button>
                <Button variant={"outline"} className="whitespace-nowrap" onClick={handleExportCSV}>
                  <Download className="size-4 mr-2" /> Export Grades
                </Button>
              </div>
            </header>

            <div className="-mx-4 md:-mx-6 border-b border-gray-500" />

            <div className="flex flex-col gap-3">
              <section className="flex flex-row justify-between gap-4">
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="w-full pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search student's name"
                  />
                </div>
                <div className="flex flex-row gap-4">
                  <Select value={sortBy} onValueChange={(v) => setSortBy(v)}>
                    <Select.Trigger className="w-full">
                      <Select.Value placeholder="Sort By" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        <Select.Item value="name">Name</Select.Item>
                      </Select.Group>
                    </Select.Content>
                  </Select>
                </div>
              </section>

              <div className="w-full overflow-hidden border border-border rounded-lg shadow-sm">
                <Table className="w-full text-sm border-collapse">
                  <Table.Header className="font-sans">
                    <Table.Row>
                      <Table.Head className="w-[22%] font-bold">Learner's Name</Table.Head>
                      <Table.Head
                        className="w-[27%] text-center cursor-pointer hover:bg-muted/50 transition-colors"
                        title="Click to view full Written Works breakdown"
                        onClick={() =>
                          setSelectedCategory({
                            name: "Written Works",
                            items: cg.writtenWork,
                            studentGrades: filtered.map((sg) => ({
                              name: sg.name,
                              scores: sg.writtenWork,
                            })),
                          })
                        }
                      >
                        Written Works
                      </Table.Head>
                      <Table.Head
                        className="w-[27%] text-center cursor-pointer hover:bg-muted/50 transition-colors"
                        title="Click to view full Performance Tasks breakdown"
                        onClick={() =>
                          setSelectedCategory({
                            name: "Performance Tasks",
                            items: cg.performanceTask,
                            studentGrades: filtered.map((sg) => ({
                              name: sg.name,
                              scores: sg.performanceTask,
                            })),
                          })
                        }
                      >
                        Performance Task
                      </Table.Head>
                      <Table.Head
                        className="w-[15%] text-center cursor-pointer hover:bg-muted/50 transition-colors"
                        title="Click to view full Quarterly Assessment breakdown"
                        onClick={() =>
                          setSelectedCategory({
                            name: "Quarterly Assessment",
                            items: cg.quarterlyAssessment,
                            studentGrades: filtered.map((sg) => ({
                              name: sg.name,
                              scores: sg.quarterlyAssessment,
                            })),
                          })
                        }
                      >
                        Quarterly Assessment
                      </Table.Head>
                      <Table.Head className="w-[9%] text-center font-bold">Grade</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    <Table.Row className="bg-muted/20">
                      <Table.Cell className="font-semibold text-muted-foreground">Classwork Name</Table.Cell>

                      <Table.Cell className="py-2 px-2">
                        <div className="flex flex-row items-center justify-between gap-1 w-full">
                          <button
                            type="button"
                            title="View all Written Works scores"
                            onClick={() =>
                              setSelectedCategory({
                                name: "Written Works",
                                items: cg.writtenWork,
                                studentGrades: filtered.map((sg) => ({
                                  name: sg.name,
                                  scores: sg.writtenWork,
                                })),
                              })
                            }
                          >
                            <Ellipsis className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                          </button>
                          <div className="flex flex-row items-center justify-center gap-3 overflow-hidden text-xs w-full">
                            {getLatestTwo(cg.writtenWork).map(({ item }) => (
                              <button
                                type="button"
                                key={item.id}
                                className="flex flex-row items-center gap-1 whitespace-nowrap truncate hover:text-primary transition-colors cursor-pointer"
                                title={`Click to Enter Scores for ${item.title}`}
                                onClick={() =>
                                  setScoringActivity({
                                    activityId: item.id,
                                    title: item.title,
                                    maxScore: item.maxScore,
                                  })
                                }
                              >
                                <span className="truncate max-w-[90px] font-semibold">{item.title}</span>
                                <span className="text-muted-foreground font-normal">({item.maxScore})</span>
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            title="Add score to Written Works"
                            onClick={() => setAddingCategoryName("Written Works")}
                          >
                            <Plus className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                          </button>
                        </div>
                      </Table.Cell>

                      <Table.Cell className="py-2 px-2">
                        <div className="flex flex-row items-center justify-between gap-1 w-full">
                          <button
                            type="button"
                            title="View all Performance Tasks scores"
                            onClick={() =>
                              setSelectedCategory({
                                name: "Performance Tasks",
                                items: cg.performanceTask,
                                studentGrades: filtered.map((sg) => ({
                                  name: sg.name,
                                  scores: sg.performanceTask,
                                })),
                              })
                            }
                          >
                            <Ellipsis className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                          </button>
                          <div className="flex flex-row items-center justify-center gap-3 overflow-hidden text-xs w-full">
                            {getLatestTwo(cg.performanceTask).map(({ item }) => (
                              <button
                                type="button"
                                key={item.id}
                                className="flex flex-row items-center gap-1 whitespace-nowrap truncate hover:text-primary transition-colors cursor-pointer"
                                title={`Click to Enter Scores for ${item.title}`}
                                onClick={() =>
                                  setScoringActivity({
                                    activityId: item.id,
                                    title: item.title,
                                    maxScore: item.maxScore,
                                  })
                                }
                              >
                                <span className="truncate max-w-[90px] font-semibold">{item.title}</span>
                                <span className="text-muted-foreground font-normal">({item.maxScore})</span>
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            title="Add score to Performance Tasks"
                            onClick={() => setAddingCategoryName("Performance Tasks")}
                          >
                            <Plus className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                          </button>
                        </div>
                      </Table.Cell>

                      <Table.Cell className="py-2 px-2">
                        <div className="flex flex-row items-center justify-between gap-1 w-full">
                          <button
                            type="button"
                            title="View all Quarterly Assessment scores"
                            onClick={() =>
                              setSelectedCategory({
                                name: "Quarterly Assessment",
                                items: cg.quarterlyAssessment,
                                studentGrades: filtered.map((sg) => ({
                                  name: sg.name,
                                  scores: sg.quarterlyAssessment,
                                })),
                              })
                            }
                          >
                            <Ellipsis className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                          </button>
                          <div className="flex flex-row items-center justify-center gap-3 overflow-hidden text-xs w-full">
                            {getLatestTwo(cg.quarterlyAssessment).map(({ item }) => (
                              <button
                                type="button"
                                key={item.id}
                                className="flex flex-row items-center gap-1 whitespace-nowrap truncate hover:text-primary transition-colors cursor-pointer"
                                title={`Click to Enter Scores for ${item.title}`}
                                onClick={() =>
                                  setScoringActivity({
                                    activityId: item.id,
                                    title: item.title,
                                    maxScore: item.maxScore,
                                  })
                                }
                              >
                                <span className="truncate max-w-[90px] font-semibold">{item.title}</span>
                                <span className="text-muted-foreground font-normal">({item.maxScore})</span>
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            title="Add score to Quarterly Assessment"
                            onClick={() => setAddingCategoryName("Quarterly Assessment")}
                          >
                            <Plus className="size-4 text-gray-500 hover:text-black transition-colors cursor-pointer shrink-0" />
                          </button>
                        </div>
                      </Table.Cell>

                      <Table.Cell className="text-center font-semibold">100</Table.Cell>
                    </Table.Row>

                    {loading ? (
                      <Table.Row>
                        <Table.Cell colSpan={5} className="text-center py-8 text-gray-500">
                          Loading gradebook...
                        </Table.Cell>
                      </Table.Row>
                    ) : filtered.length === 0 ? (
                      <Table.Row>
                        <Table.Cell colSpan={5} className="text-center py-8 text-gray-500">
                          No student records found.
                        </Table.Cell>
                      </Table.Row>
                    ) : (
                      filtered.map((item) => (
                        <Table.Row key={item.student_id}>
                          <Table.Cell className="font-medium truncate max-w-[200px]" title={item.name}>
                            {item.name}
                          </Table.Cell>

                          <Table.Cell className="font-medium py-2.5 px-2">
                            <div className="flex flex-row items-center justify-between gap-1 w-full">
                              <div className="size-4 shrink-0" />
                              <div className="flex flex-row justify-around w-full text-xs">
                                {getLatestTwo(item.writtenWork).map(({ item: score }, idx) => (
                                  <span className="w-full text-center tabular-nums" key={idx}>
                                    {score !== null && score !== undefined ? score : "—"}
                                  </span>
                                ))}
                              </div>
                              <div className="size-4 shrink-0" />
                            </div>
                          </Table.Cell>

                          <Table.Cell className="font-medium py-2.5 px-2">
                            <div className="flex flex-row items-center justify-between gap-1 w-full">
                              <div className="size-4 shrink-0" />
                              <div className="flex flex-row justify-around w-full text-xs">
                                {getLatestTwo(item.performanceTask).map(({ item: score }, idx) => (
                                  <span className="w-full text-center tabular-nums" key={idx}>
                                    {score !== null && score !== undefined ? score : "—"}
                                  </span>
                                ))}
                              </div>
                              <div className="size-4 shrink-0" />
                            </div>
                          </Table.Cell>

                          <Table.Cell className="font-medium py-2.5 px-2">
                            <div className="flex flex-row items-center justify-between gap-1 w-full">
                              <div className="size-4 shrink-0" />
                              <div className="flex flex-row justify-around w-full text-xs">
                                {getLatestTwo(item.quarterlyAssessment).map(({ item: score }, idx) => (
                                  <span className="w-full text-center tabular-nums" key={idx}>
                                    {score !== null && score !== undefined ? score : "—"}
                                  </span>
                                ))}
                              </div>
                              <div className="size-4 shrink-0" />
                            </div>
                          </Table.Cell>

                          <Table.Cell className="font-medium text-center tabular-nums">
                            {item.transmuted_grade != null
                              ? item.transmuted_grade.toFixed(1)
                              : item.initial_grade != null
                              ? item.initial_grade.toFixed(1)
                              : "—"}
                          </Table.Cell>
                        </Table.Row>
                      ))
                    )}
                  </Table.Body>
                </Table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={openAttendance} onOpenChange={setOpenAttendance}>
        <AttendanceModal
          sectionName={displaySectionName}
          students={filtered.map((s) => ({ student_id: s.student_id, name: s.name }))}
        />
      </Dialog>

      <Dialog
        open={selectedCategory !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedCategory(null);
        }}
      >
        {selectedCategory && (
          <ViewGradeScoreModal
            categoryName={selectedCategory.name}
            items={selectedCategory.items}
            studentGrades={selectedCategory.studentGrades}
            onEnterScores={(item) => {
              setSelectedCategory(null);
              setScoringActivity({
                activityId: item.id,
                title: item.title,
                maxScore: item.maxScore,
              });
            }}
          />
        )}
      </Dialog>

      <Dialog
        open={addingCategoryName !== null}
        onOpenChange={(open) => {
          if (!open) setAddingCategoryName(null);
        }}
      >
        {addingCategoryName && (
          <AddClassworkScoreModal
            categoryName={addingCategoryName}
            classId={section ? Number(section) : undefined}
            subjectId={subject ? Number(subject) : undefined}
            onSuccess={fetchGradebook}
            onClose={() => setAddingCategoryName(null)}
          />
        )}
      </Dialog>

      <Dialog
        open={scoringActivity !== null}
        onOpenChange={(open) => {
          if (!open) setScoringActivity(null);
        }}
      >
        {scoringActivity && (
          <EnterManualScoresModal
            activityId={scoringActivity.activityId}
            classId={Number(section)}
            activityTitle={scoringActivity.title}
            maxScore={scoringActivity.maxScore}
            onSuccess={fetchGradebook}
            onClose={() => setScoringActivity(null)}
          />
        )}
      </Dialog>
    </AppLayout>
  );
};

export default TeacherGradeView;
