import AppLayout from "@/layouts/app-layout";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";
import { Table } from "@/components/retroui/Table";
import { Filter, ArrowUpDown } from "lucide-react";

type SubjectGradeProps = {
  subject: string;
  onBack: () => void;
};

type ClassworkItem = {
  id: string;
  title: string;
  type: "Quiz" | "Activity" | "Assignment";
  score: number;
  total: number;
};

const classworks: ClassworkItem[] = [
  { id: "1", title: "Python Quiz 1", type: "Quiz", score: 26, total: 30 },
  { id: "2", title: "Activity 1", type: "Activity", score: 96, total: 100 },
  {
    id: "3",
    title: "Coding Activity",
    type: "Activity",
    score: 96,
    total: 100,
  },
  {
    id: "4",
    title: "Build your first python program",
    type: "Assignment",
    score: 96,
    total: 100,
  },
];

const SubjectGrade = ({ subject, onBack }: SubjectGradeProps) => {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center gap-3 pb-4 -mx-4 md:-mx-6 px-4 md:px-6 border-b border-gray-500">
              <Breadcrumb>
                <Breadcrumb.List>
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

            <main className="flex flex-1 flex-col gap-4 md:gap-6">
              <header className="text-2xl md:text-4xl font-bold tracking-tight">
                Subject Performance
              </header>
              <div className="flex flex-col md:flex-row md:gap-6">
                <Card className="flex flex-1 flex-col gap-1 p-4 md:p-6">
                  <Card.Title className="text-sm font-medium">
                    Completion Rate
                  </Card.Title>
                  <Card.Description className="text-4xl font-bold">
                    100<span className="text-lg align-top">%</span>
                  </Card.Description>
                  <Card.Content className="text-sm text-muted-foreground">
                    activities done
                  </Card.Content>
                </Card>

                <Card className="flex flex-col flex-1 gap-2 p-4 md:p-6">
                  <Card.Title className="text-sm font-medium">
                    Subject Lesson Mastery
                  </Card.Title>
                  <Card.Content className="inline-block border rounded-md px-4 py-2 text-center w-fit">
                    <p className="text-xs text-muted-foreground mb-1">
                      Mastery level
                    </p>
                    <p className="text-base font-semibold">😊 Moderate</p>
                  </Card.Content>
                  <p className="text-sm text-muted-foreground">
                    have mastered most of the lessons well
                  </p>
                </Card>
              </div>
              <div className="flex flex-row justify-between items-center gap-2 md:gap-4">
                <p className="text-2xl md:text-4xl font-bold tracking-tight">
                  Classwork
                </p>
                <div className="flex flex-row items-center gap-4 text-sm">
                  <button className="flex items-center gap-1">
                    <Filter className="size-4" />
                    Add Filter
                  </button>
                  <button className="flex items-center gap-1">
                    <ArrowUpDown className="size-4" />
                    Sort By
                  </button>
                </div>
              </div>
              <Table
                wrapperClassName="shadow-md transition-all hover:shadow-none"
                className="table-fixed bg-card"
              >
                <Table.Body>
                  {classworks.map((item) => (
                    <Table.Row key={item.id} className="hover:bg-transparent">
                      <Table.Cell className="font-medium w-1/2">
                        {item.title}
                      </Table.Cell>
                      <Table.Cell className="w-32">
                        <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs">
                          {item.type}
                        </span>
                      </Table.Cell>
                      <Table.Cell className="text-right font-bold">
                        {item.score}
                        <span className="text-xs text-muted-foreground">
                          /{item.total}
                        </span>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default SubjectGrade;
