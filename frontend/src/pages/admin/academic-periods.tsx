import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AppLayout from "@/layouts/app-layout";
import { Button } from "@/components/retroui/Button";
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/retroui/Badge";

export default function AdminAcademicPeriods() {
  const academicPeriods = [
    {
      id: "1",
      period: "1st Quarter",
      academicyear: "2025-2026",
      startDate: "2025-06-01",
      endDate: "2025-08-30",
      status: "Passed",
    },
    {
      id: "2",
      period: "2nd Quarter",
      academicyear: "2025-2026",
      startDate: "2025-09-01",
      endDate: "2025-11-30",
      status: "Active",
    },
    {
      id: "3",
      period: "3rd Quarter",
      academicyear: "2025-2026",
      startDate: "2025-12-01",
      endDate: "2026-02-28",
      status: "Upcoming",
    },
    {
      id: "4",
      period: "4th Quarter",
      academicyear: "2025-2026",
      startDate: "2026-03-01",
      endDate: "2026-05-30",
      status: "Upcoming",
    },
  ];

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
                <CardTitle className="flex flex-row justify-between w-full items-center">
                  Academic Period
                  <Button size={"sm"}>
                    Add Academic Period
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

              </CardContent>
            </Card>


          </div>
        </div>
      </div>
    </AppLayout>
  );
}
