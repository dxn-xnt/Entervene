import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Text } from "@/components/retroui/Text";
import AppLayout from "@/layouts/app-layout";
import { useNavigate } from "react-router-dom";
import { Select } from "@/components/retroui/Select";
import { Button } from "@/components/retroui/Button";
import { Accordion } from "@/components/retroui/Accordion";
import { Input } from "@/components/retroui/Input";
import { ArrowUpRight } from 'lucide-react';
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Dialog } from "@/components/retroui/Dialog";
import AddAcademicPeriodModal from "./forms/add-academic-period";

export default function AdminSystemSettings() {
  const navigate = useNavigate();
  const academiclevels = [
    {
      level: "Grade 7",
    },
    {
      level: "Grade 8",
    },
    {
      level: "Grade 9",
    },
    {
      level: "Grade 10",
    },
    {
      level: "Grade 11",
    },
    {
      level: "Grade 12",
    },
  ]
  const strands = [
    {
      level: "Science, Technology, Engineering and Mathematics (STEM)",
    },
    {
      level: "Technical-Vocational-Livelihood (TVL)",
    },
    {
      level: "General Academic Strand (GAS)",
    },
  ]

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-3 md:py-4 px-4 md:px-4">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-4xl font-bold tracking-tight">
                System Settings
              </h1>
            </header>
            <div className="-mx-4 md:-mx-6 border-b border-black/40" />

            <Card className="@container/card">
              <CardHeader>
                <CardTitle>Passing Grade Threshold</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pt-4 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-row justify-between w-full items-center">
                    <Text as="h6" className="font-sans font-medium">
                      Subject Passing Grade
                    </Text>
                    <Input className="w-20" type="text" value="80%" />
                  </div>
                  <Text as="p" className="font-sans text-sm">
                    Define the passing grade required for each subject to determine student promotion and completion.
                  </Text>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-row justify-between w-full items-center">
                    <Text as="h6" className="font-sans font-medium">
                      Grading Components
                    </Text>
                    <Button size={"sm"}>
                      New Grading Component
                    </Button>
                  </div>
                  <Accordion className="space-y-3 w-full">
                    <Accordion.Item value="item-1">
                      <Accordion.Header>Major Subject</Accordion.Header>
                      <Accordion.Content>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-16 md:justify-between w-full">
                          <div className="flex flex-row justify-between md:justify-start md:gap-2 w-full items-center">
                            <Text as="h6" className="font-sans text-foreground text-md">
                              Written Works
                            </Text>
                            <Input className="w-48! md:w-full!" type="text" value="40%" />
                          </div>
                          <div className="flex flex-row justify-between md:justify-start md:gap-2 w-full items-center">
                            <Text as="h6" className="font-sans text-foreground text-md">
                              Performance Tasks
                            </Text>
                            <Input className="w-48! md:w-full!" type="text" value="40%" />
                          </div>
                          <div className="flex flex-row justify-between md:justify-start md:gap-2 w-full items-center">
                            <Text as="h6" className="font-sans text-foreground text-md">
                              Major Exams
                            </Text>
                            <Input className="w-48! md:w-full!" type="text" value="20%" />
                          </div>
                        </div>
                      </Accordion.Content>
                    </Accordion.Item>
                    <Accordion.Item value="item-2">
                      <Accordion.Header>Minor Subject</Accordion.Header>
                      <Accordion.Content>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-16 md:justify-between w-full">
                          <div className="flex flex-row justify-between md:justify-start md:gap-2 w-full items-center">
                            <Text as="h6" className="font-sans text-foreground text-md">
                              Written Works
                            </Text>
                            <Input className="w-48! md:w-full!" type="text" value="80%" />
                          </div>
                          <div className="flex flex-row justify-between md:justify-start md:gap-2 w-full items-center">
                            <Text as="h6" className="font-sans text-foreground text-md">
                              Performance Tasks
                            </Text>
                            <Input className="w-48! md:w-full!" type="text" value="80%" />
                          </div>
                          <div className="flex flex-row justify-between md:justify-start md:gap-2 w-full items-center">
                            <Text as="h6" className="font-sans text-foreground text-md">
                              Major Exams
                            </Text>
                            <Input className="w-48! md:w-full!" type="text" value="80%" />
                          </div>
                        </div>
                      </Accordion.Content>
                    </Accordion.Item>
                  </Accordion>
                  <Text as="p" className="font-sans text-sm">
                    Configure grading components and their corresponding weight distribution used to compute final grades.
                  </Text>
                </div>
              </CardContent>
            </Card>

            <Card className="@container/card">
              <CardHeader>
                <CardTitle className="flex flex-row justify-between w-full items-center">
                  Academic Period
                  <Dialog>
                    <Dialog.Trigger>
                      <Button size={"sm"}>
                        New Academic Period
                      </Button>
                    </Dialog.Trigger>
                    <AddAcademicPeriodModal />
                  </Dialog>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pt-4 flex flex-col gap-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-row justify-between w-full items-center">
                    <Text as="h6" className="font-sans font-medium">
                      Current Academic Period
                    </Text>
                    <Select>
                      <Select.Trigger className="w-60">
                        <Select.Value placeholder="2025 - 2026" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          <Select.Item value="AP25-26">2025 - 2026</Select.Item>
                          <Select.Item value="AP26-27">2026 - 2027</Select.Item>
                          <Select.Item value="AP27-28">2027 - 2028</Select.Item>
                          <Select.Item value="AP28-29">2028 - 2029</Select.Item>
                        </Select.Group>
                      </Select.Content>
                    </Select>
                  </div>
                  <Text as="p" className="font-sans text-sm">
                    Define the academic school year for grading, scheduling, and reports.
                  </Text>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex flex-row justify-between w-full items-center">
                    <Text as="h6" className="font-sans font-medium">
                      Junior High School Period
                    </Text>
                    <Select>
                      <Select.Trigger className="w-60">
                        <Select.Value placeholder="1st Quarter" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          <Select.Item value="Q1">1st Quarter</Select.Item>
                          <Select.Item value="Q2">2nd Quarter</Select.Item>
                          <Select.Item value="Q3">3rd Quarter</Select.Item>
                          <Select.Item value="Q4">4th Quarter</Select.Item>
                        </Select.Group>
                      </Select.Content>
                    </Select>
                  </div>
                  <div className="flex flex-row justify-between w-full items-center">
                    <Text as="h6" className="font-sans font-medium">
                      Senior High School Period
                    </Text>
                    <Select>
                      <Select.Trigger className="w-60">
                        <Select.Value placeholder="1st Semester" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          <Select.Item value="Sem1">1st Semester</Select.Item>
                          <Select.Item value="Sem2">2nd Semester</Select.Item>
                        </Select.Group>
                      </Select.Content>
                    </Select>
                  </div>
                  <div className="flex flex-row gap-6 justify-between items-start w-full">
                    <Text as="p" className="font-sans text-sm">
                      Define the grading periods for Junior and Senior High School used in grade computation and reporting.
                    </Text>
                    <Button size="sm" variant="link" className=" shadow-none p-0! flex-row gap-2 shrink-0 m-0!"
                      onClick={() => navigate(`/admin/academic-periods`)}>
                      View All Periods
                      <ArrowUpRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="@container/card">
              <CardHeader>
                <CardTitle className="flex flex-row justify-between w-full items-center">
                  Academic Level
                  <Button size={"sm"}>
                    Add Academic Level
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pt-4 flex flex-col gap-4">
                <Table className="">
                  <Table.Body>
                    {academiclevels.map((item) => (
                      <Table.Row key={item.level}>
                        <Accordion className="space-y-3 w-full">
                          <Accordion.Item value="item-1" className="border-0">
                            <Accordion.Header>{item.level}</Accordion.Header>
                            <Accordion.Content>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-16 md:justify-between w-full">
                                {strands.map((strand) => (
                                  <div className="flex flex-row justify-between md:justify-start md:gap-2 w-full items-center">
                                    <Text as="h6" className="font-sans text-foreground font-semibold text-md">
                                      {strand.level}
                                    </Text>
                                  </div>
                                ))}
                              </div>
                            </Accordion.Content>
                          </Accordion.Item>
                        </Accordion>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>

              </CardContent>
            </Card>


          </div>
        </div>
      </div>
    </AppLayout>
  );
}
