import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AppLayout from "@/layouts/app-layout";
import { Button } from "@/components/retroui/Button";
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/retroui/Badge";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { ArrowUpRight } from "lucide-react";
import { Dialog } from "@/components/retroui/Dialog";
import ViewPreviousPeriodsModal from "./forms/view-previous-periods";
import { formatPeriodLabel } from "@/lib/academic-periods";

export default function AdminAcademicPeriods() {
  const academicPeriods = [
    {
      id: "1",
      period: formatPeriodLabel({ period_type: "TERM", period_sequence: 1 }),
      academicyear: "2025-2026",
      startDate: "2025-06-01",
      endDate: "2025-08-30",
      status: "Passed",
    },
    {
      id: "2",
      period: formatPeriodLabel({ period_type: "TERM", period_sequence: 2 }),
      academicyear: "2025-2026",
      startDate: "2025-09-01",
      endDate: "2025-11-30",
      status: "Active",
    },
    {
      id: "3",
      period: formatPeriodLabel({ period_type: "TERM", period_sequence: 3 }),
      academicyear: "2025-2026",
      startDate: "2025-12-01",
      endDate: "2026-02-28",
      status: "Upcoming",
    },
  ];

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <Breadcrumb>
                  <Breadcrumb.List>
                    <Breadcrumb.Item>
                      <Breadcrumb.Link href="/admin/settings" className="text-4xl">
                        System Settings
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Page>Academic Periods</Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </Breadcrumb.List>
                </Breadcrumb>
              </div>
            </header>
            <div className="-mx-4 md:-mx-6 border-b border-black/40" />

            <Card className="@container/card">
              <CardHeader>
                <CardTitle className="flex flex-row justify-between w-full items-center">
                  Junior High School Periods
                  <Button size={"sm"}>
                    Marked as Complete
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pt-2 flex flex-col gap-4">
                <Table>
                  <Table.Header className="font-sans">
                    <Table.Row>
                      <Table.Head>Period</Table.Head>
                      <Table.Head>Academic Year</Table.Head>
                      <Table.Head>Start Date</Table.Head>
                      <Table.Head>End Date</Table.Head>
                      <Table.Head>Status</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {academicPeriods.map((item) => (
                      <Table.Row key={item.id}>
                        <Table.Cell className="font-medium">{item.period}</Table.Cell>
                        <Table.Cell className="font-medium">{item.academicyear}</Table.Cell>
                        <Table.Cell className="font-medium">{item.startDate}</Table.Cell>
                        <Table.Cell className="font-medium">{item.endDate}</Table.Cell>
                        <Table.Cell>
                          <Badge
                            variant={
                              item.status === "Active"
                                ? "surface"
                                : item.status === "Passed"
                                  ? "default"
                                  : "outline"
                            }
                            size="sm"
                          >
                            {item.status}
                          </Badge>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
                <Dialog>
                  <Dialog.Trigger className="w-full flex justify-end">
                    <Button size="sm" variant="link" className=" shadow-none p-0! flex-row gap-2 shrink-0 m-0! justify-end w-fit">
                      View Previous Periods
                      <ArrowUpRight className="w-4 h-4" />
                    </Button>
                  </Dialog.Trigger>
                  <ViewPreviousPeriodsModal yearLevel="junior-high" />
                </Dialog>
              </CardContent>
            </Card>

            <Card className="@container/card">
              <CardHeader>
                <CardTitle className="flex flex-row justify-between w-full items-center">
                  Senior High School Periods
                  <Button size={"sm"}>
                    Marked as Complete
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pt-2 flex flex-col gap-4">
                <Table>
                  <Table.Header className="font-sans">
                    <Table.Row>
                      <Table.Head>Period</Table.Head>
                      <Table.Head>Academic Year</Table.Head>
                      <Table.Head>Start Date</Table.Head>
                      <Table.Head>End Date</Table.Head>
                      <Table.Head>Status</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {academicPeriods.map((item) => (
                      <Table.Row key={item.id}>
                        <Table.Cell className="font-medium">{item.period}</Table.Cell>
                        <Table.Cell className="font-medium">{item.academicyear}</Table.Cell>
                        <Table.Cell className="font-medium">{item.startDate}</Table.Cell>
                        <Table.Cell className="font-medium">{item.endDate}</Table.Cell>
                        <Table.Cell>
                          <Badge
                            variant={
                              item.status === "Active"
                                ? "surface"
                                : item.status === "Passed"
                                  ? "default"
                                  : "outline"
                            }
                            size="sm"
                          >
                            {item.status}
                          </Badge>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
                <Dialog>
                  <Dialog.Trigger className="w-full flex justify-end">
                    <Button size="sm" variant="link" className=" shadow-none p-0! flex-row gap-2 shrink-0 m-0! justify-end w-fit">
                      View Previous Periods
                      <ArrowUpRight className="w-4 h-4" />
                    </Button>
                  </Dialog.Trigger>
                  <ViewPreviousPeriodsModal yearLevel="senior-high" />
                </Dialog>
              </CardContent>
            </Card>


          </div>
        </div>
      </div>
    </AppLayout>
  );
}
