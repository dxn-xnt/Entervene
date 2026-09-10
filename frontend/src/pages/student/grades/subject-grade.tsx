import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Table } from "@/components/retroui/Table";
import { Filter, ArrowUpDown } from "lucide-react";
import { getStudentTodos, type TodoItem } from "@/lib/api";
import { routes } from "@/../routes";

type SubjectGradeProps = {
  classId?: number;
  subjectId?: number;
  subject: string;
  onBack: () => void;
};

const SubjectGrade = ({ classId, subjectId, subject, onBack }: SubjectGradeProps) => {
  const navigate = useNavigate();
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    getStudentTodos()
      .then((data) => {
        if (!isMounted) return;
        const allTodos = data.all || [];
        const filtered = allTodos.filter(
          (t) => (subjectId && t.subject_id === subjectId) || t.subject.toLowerCase() === subject.toLowerCase()
        );
        setTodos(filtered);
      })
      .catch((err) => console.error("Error loading subject classworks:", err))
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [subjectId, subject]);

  const totalCount = todos.length;
  const completedCount = todos.filter((t) => t.is_submitted || t.status === "completed" || t.grade !== null).length;
  const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const gradableTodos = todos.filter((t) => t.is_graded !== false && t.type?.toUpperCase() !== "READING");
  const masteryLabel =
    completionRate >= 80 ? "High" : completionRate >= 50 ? "Moderate" : "Low";

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
              <SidebarTrigger className="md:hidden" />
              <Breadcrumb>
                <Breadcrumb.List className="flex items-center gap-2 text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-black [&_a]:!text-muted-foreground [&_a]:!text-inherit [&_a]:!font-inherit [&_button]:!text-muted-foreground [&_button]:!text-inherit [&_button]:!font-inherit [&_[aria-current=page]]:!text-black [&_[aria-current=page]]:!text-inherit [&_[aria-current=page]]:!font-extrabold">
                  <Breadcrumb.Item>
                    <Breadcrumb.Link
                      onClick={onBack}
                      className="text-2xl md:text-4xl text-black/50 hover:text-black cursor-pointer"
                    >
                      Grades
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page className="text-2xl">
                      {subject}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-1 flex-col gap-4 md:gap-6">
              <h2 className="text-2xl md:text-4xl font-bold tracking-tight">
                Subject Performance
              </h2>
              <div className="flex flex-col gap-4 md:flex-row md:gap-6">
                <Card className="flex flex-1 flex-col gap-1 border-black bg-white p-4 shadow-md hover:shadow-none md:p-6">
                  <Card.Title className="text-sm font-medium">
                    Completion Rate
                  </Card.Title>
                  <Card.Description className="text-4xl font-bold">
                    {completionRate}<span className="text-lg align-top">%</span>
                  </Card.Description>
                  <Card.Content className="text-sm text-muted-foreground">
                    {completedCount} of {totalCount} activities done
                  </Card.Content>
                </Card>

                <Card className="flex flex-1 flex-col gap-2 border-black bg-white p-4 shadow-md hover:shadow-none md:p-6">
                  <Card.Title className="text-sm font-medium">
                    Subject Lesson Mastery
                  </Card.Title>
                  <Card.Content>
                    <Badge
                      variant="secondary"
                      size="md"
                      className="rounded-none border border-black bg-white font-bold text-black"
                    >
                      Mastery level: {masteryLabel}
                    </Badge>
                  </Card.Content>
                  <p className="text-sm text-muted-foreground">
                    {completionRate >= 80
                      ? "have mastered most of the lessons well"
                      : completionRate >= 50
                      ? "making steady progress on lessons"
                      : "needs focus on completing activities"}
                  </p>
                </Card>
              </div>
              <div className="flex flex-row justify-between items-center gap-2 md:gap-4">
                <p className="text-2xl md:text-4xl font-bold tracking-tight">
                  Classwork
                </p>
                <div className="flex flex-row items-center gap-4 text-sm">
                  <Button type="button" variant="outline" size="sm" className="gap-1 rounded-none border-black bg-white">
                    <Filter className="size-4" />
                    Add Filter
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-1 rounded-none border-black bg-white">
                    <ArrowUpDown className="size-4" />
                    Sort By
                  </Button>
                </div>
              </div>
              <Table
                wrapperClassName="shadow-md transition-all hover:shadow-none"
                className="table-fixed bg-white"
              >
                <Table.Body>
                  {loading ? (
                    <Table.Row>
                      <Table.Cell colSpan={3} className="text-center py-6 text-muted-foreground">
                        Loading classworks...
                      </Table.Cell>
                    </Table.Row>
                  ) : gradableTodos.length === 0 ? (
                    <Table.Row>
                      <Table.Cell colSpan={3} className="text-center py-6 text-muted-foreground">
                        No graded classworks found for this subject.
                      </Table.Cell>
                    </Table.Row>
                  ) : (
                    gradableTodos.map((item) => {
                      const canNavigate = !!(classId ?? item.class_id) && subjectId;
                      return (
                        <Table.Row
                          key={item.assignment_id}
                          className={canNavigate ? "cursor-pointer hover:bg-muted/40 transition-colors" : "hover:bg-transparent"}
                          onClick={() => {
                            const targetClassId = classId ?? item.class_id;
                            if (!targetClassId || !subjectId) return;
                            navigate(
                              routes.student.subjectDetail
                                .replace(":classId", String(targetClassId))
                                .replace(":subjectId", String(subjectId)) +
                                `?tab=classwork&classworkAssignmentId=${item.assignment_id}`,
                            );
                          }}
                          title={canNavigate ? `Open "${item.title}" in classwork tab` : undefined}
                        >
                          <Table.Cell className="font-medium w-1/2">
                            {item.title}
                          </Table.Cell>
                          <Table.Cell className="w-32">
                            <span className="inline-flex items-center border px-3 py-1 text-xs">
                              {item.type}
                            </span>
                          </Table.Cell>
                          <Table.Cell className="text-right font-bold">
                            {item.show_scores !== false ? (
                              <>
                                {item.grade !== null ? item.grade : "-"}
                                <span className="text-xs text-muted-foreground">
                                  /{item.total_points ?? 100}
                                </span>
                              </>
                            ) : (
                              <Badge variant="outline" size="sm" className="rounded-none border border-gray-300 bg-gray-100 text-xs font-normal text-gray-500">Score hidden</Badge>
                            )}
                          </Table.Cell>
                        </Table.Row>
                      );
                    })
                  )}
                </Table.Body>
              </Table>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default SubjectGrade;
