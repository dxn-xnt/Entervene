import { useState } from "react";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { useParams } from "react-router-dom";
import { Ellipsis, Plus, Search } from "lucide-react";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import AddSubjectLoadModal from "../admin/forms/add-subject-load";
import ViewGradeScoreModal from "./forms/view-grade-scores";
import AddClassworkScoreModal from "./forms/add-classwork-score";

const classwork = [
  {
    writtenWork: [
      {
        id: 1,
        title: "Assignment 1",
        maxScore: 20,
      },
      {
        id: 2,
        title: "Assignment 2",
        maxScore: 20,
      },
    ],
    performanceTask: [
      {
        id: 1,
        title: "Project 1",
        maxScore: 20,
      },
      {
        id: 2,
        title: "Project 2",
        maxScore: 20,
      },
    ],
    quarterlyAssessment: [
      {
        id: 1,
        title: "Test 1",
        maxScore: 20,
      }
    ],
  }
];
const studentGrades = [
  {
    name: "Maria Clara",
    writtenWork: [
      20,
      15,
    ],
    performanceTask: [
      20,
      15,
    ],
    quarterlyAssessment: [
      15
    ],
    total: "88",
  },
  {
    name: "Jose Rizal",
    writtenWork: [
      20,
      15,
    ],
    performanceTask: [
      20,
      15,
    ],
    quarterlyAssessment: [
      15
    ],
    total: "92",
  },
  {
    name: "Juan Dela Cruz",
    writtenWork: [
      20,
      15,
    ],
    performanceTask: [
      20,
      15,
    ],
    quarterlyAssessment: [
      15
    ],
    total: "95",
  },
  {
    name: "Juan Dela Cruz",
    writtenWork: [
      20,
      15,
    ],
    performanceTask: [
      20,
      15,
    ],
    quarterlyAssessment: [
      15
    ],
    total: "95",
  },
];

const TeacherGradeView = () => {
  const { section, subject } = useParams<{ section: string; subject: string }>();
  const [selectedCategory, setSelectedCategory] = useState<{
    name: string;
    items: { id: number; title: string; maxScore: number }[];
    studentGrades: { name: string; scores: number[] }[];
  } | null>(null);
  const [addingCategoryName, setAddingCategoryName] = useState<string | null>(null);

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
                    <Breadcrumb.Link href="/teacher/grades" className="text-4xl">
                      Grades
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page>{section || "7 - Sapphire"}</Breadcrumb.Page>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page>{subject || "Science"}</Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>

              <div className="flex flex-row gap-2">
                <Dialog>
                  <Dialog.Trigger>
                    <Button variant={"outline"} className="whitespace-nowrap">
                      <Plus className="size-4 mr-2" /> Check Attendance
                    </Button>
                  </Dialog.Trigger>
                  <AddSubjectLoadModal />
                </Dialog>
                <Dialog>
                  <Dialog.Trigger>
                    <Button variant={"outline"} className="whitespace-nowrap">
                      <Plus className="size-4 mr-2" /> Export Grades
                    </Button>
                  </Dialog.Trigger>
                  <AddSubjectLoadModal />
                </Dialog>
              </div>
            </header>

            <div className="-mx-4 md:-mx-6 border-b border-gray-500" />

            <div className="flex flex-col gap-3">
              <section className="flex flex-row justify-between gap-4">
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2" />
                  <Input
                    className="w-full pl-9"
                    value={""}
                    onChange={() => { }}
                    placeholder="Search student's name"
                  />
                </div>
                <div className="flex flex-row gap-4">
                  <Select value={""}>
                    <Select.Trigger className="w-full">
                      <Select.Value placeholder="Sort By" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        <Select.Item value="name">Name</Select.Item>
                        <Select.Item value="code">Code</Select.Item>
                        <Select.Item value="group">Group</Select.Item>
                      </Select.Group>
                    </Select.Content>
                  </Select>
                </div>
              </section>

              <Table>
                <Table.Header className="font-sans">
                  <Table.Row>
                    <Table.Head>Learner's Name</Table.Head>
                    <Table.Head className="text-center">Written Works</Table.Head>
                    <Table.Head className="text-center">Performance Task</Table.Head>
                    <Table.Head className="text-center">Quarterly Assessment</Table.Head>
                    <Table.Head className="text-center">Grade</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  <Table.Row>
                    <Table.Cell className="min-w-70">Classwork Name</Table.Cell>

                    <Table.Cell className="py-2">
                      <div className="group flex flex-row items-center justify-between gap-2">
                        <Ellipsis
                          className="size-4 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          onClick={() =>
                            setSelectedCategory({
                              name: "Written Works",
                              items: classwork[0].writtenWork,
                              studentGrades: studentGrades.map((sg) => ({
                                name: sg.name,
                                scores: sg.writtenWork,
                              })),
                            })
                          }
                        />
                        <div className="flex flex-row w-full gap-4">
                          {classwork[0].writtenWork.map((item) => (
                            <span key={item.id} className="flex flex-row w-full items-center justify-center gap-2 whitespace-nowrap">
                              <span>{item.title}</span>
                              <span className="text-muted-foreground">({item.maxScore})</span>
                            </span>
                          ))}
                        </div>
                        <Plus
                          className="size-4 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          onClick={() => setAddingCategoryName("Written Works")}
                        />
                      </div>
                    </Table.Cell>

                    <Table.Cell className="py-2">
                      <div className="group flex flex-row items-center justify-between gap-2">
                        <Ellipsis
                          className="size-4 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          onClick={() =>
                            setSelectedCategory({
                              name: "Performance Tasks",
                              items: classwork[0].performanceTask,
                              studentGrades: studentGrades.map((sg) => ({
                                name: sg.name,
                                scores: sg.performanceTask,
                              })),
                            })
                          }
                        />
                        <div className="flex flex-row w-full gap-4">
                          {classwork[0].performanceTask.map((item) => (
                            <span key={item.id} className="flex flex-row w-full items-center justify-center gap-2 whitespace-nowrap">
                              <span>{item.title}</span>
                              <span className="text-muted-foreground">({item.maxScore})</span>
                            </span>
                          ))}
                        </div>
                        <Plus
                          className="size-4 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          onClick={() => setAddingCategoryName("Performance Tasks")}
                        />
                      </div>
                    </Table.Cell>

                    <Table.Cell className="py-2">
                      <div className="group flex flex-row items-center justify-between gap-2">
                        <Ellipsis
                          className="size-4 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          onClick={() =>
                            setSelectedCategory({
                              name: "Quarterly Assessment",
                              items: classwork[0].quarterlyAssessment,
                              studentGrades: studentGrades.map((sg) => ({
                                name: sg.name,
                                scores: sg.quarterlyAssessment,
                              })),
                            })
                          }
                        />
                        <div className="flex flex-row w-full gap-4">
                          {classwork[0].quarterlyAssessment.map((item) => (
                            <span key={item.id} className="flex flex-row w-full items-center justify-center gap-2 whitespace-nowrap">
                              <span>{item.title}</span>
                              <span className="text-muted-foreground">({item.maxScore})</span>
                            </span>
                          ))}
                        </div>
                        <Plus
                          className="size-4 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          onClick={() => setAddingCategoryName("Quarterly Assessment")}
                        />
                      </div>
                    </Table.Cell>

                    <Table.Cell className="text-center">100</Table.Cell>
                  </Table.Row>
                  {studentGrades.map((item) => (
                    <Table.Row key={item.name}>
                      <Table.Cell className="font-medium">{item.name}</Table.Cell>
                      <Table.Cell className="font-medium">
                        <div className="flex flex-row items-center justify-between gap-2">
                          <div className="size-4" />
                          <div className="flex flex-row justify-between w-full">
                            {item.writtenWork.map((score, index) => (
                              <span className="w-full text-center" key={index}>{score}</span>
                            ))}
                          </div>
                          <div className="size-4" />
                        </div>
                      </Table.Cell>
                      <Table.Cell className="font-medium">
                        <div className="flex flex-row items-center justify-between gap-2">
                          <div className="size-4" />
                          <div className="flex flex-row justify-between w-full">
                            {item.performanceTask.map((score, index) => (
                              <span className="w-full text-center" key={index}>{score}</span>
                            ))}
                          </div>
                          <div className="size-4" />
                        </div>
                      </Table.Cell>
                      <Table.Cell className="font-medium">
                        <div className="flex flex-row items-center justify-between gap-2">
                          <div className="size-4" />
                          <div className="flex flex-row justify-between w-full">
                            {item.quarterlyAssessment.map((score, index) => (
                              <span className="w-full text-center" key={index}>{score}</span>
                            ))}
                          </div>
                          <div className="size-4" />
                        </div>
                      </Table.Cell>
                      <Table.Cell className="font-medium">
                        <div className="flex flex-row items-center justify-between gap-2">
                          <div className="size-4" />
                          <span>{item.total}</span>
                          <div className="size-4" />
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>


          </div>
        </div>
      </div>
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
          <AddClassworkScoreModal categoryName={addingCategoryName} />
        )}
      </Dialog>
    </AppLayout>
  );
};

export default TeacherGradeView;
