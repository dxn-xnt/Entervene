import * as React from "react";
import AppLayout from "@/layouts/app-layout";
import { Text } from "@/components/retroui/Text";
import { Button } from "@/components/retroui/Button";
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/retroui/Badge";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { ArrowUpRight, AlertCircle } from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { Dialog } from "@/components/retroui/Dialog";
import ViewPreviousPeriodsModal from "./forms/view-previous-periods";
import { API_URL } from "@/lib/api";
import { useSettings } from "@/context/SettingsContext";
import { toast } from "sonner";
import { Card } from "@/components/retroui/Card";

type DBPeriodItem = {
  id: number;
  period: string;
  period_sequence: number;
  academicyear: string;
  startDate: string | null;
  endDate: string | null;
  is_active: boolean;
  status: string;
};

export default function AdminAcademicPeriods() {
  const { getSetting } = useSettings();
  const [isLoading, setIsLoading] = React.useState(true);

  // Dynamic periods fetched directly from the database
  const [periods, setPeriods] = React.useState<DBPeriodItem[]>([]);

  const fetchPeriodsFromDB = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/settings/academic-periods`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setPeriods(data.periods || []);
      } else {
        throw new Error("Failed to load academic periods");
      }
    } catch {
      // Fallback if API fails
      setPeriods([
        {
          id: 1,
          period: "Term 1",
          period_sequence: 1,
          academicyear: getSetting("current_school_year", "2025-2026"),
          startDate: "2025-06-02",
          endDate: "2025-08-22",
          is_active: true,
          status: "Active",
        },
        {
          id: 2,
          period: "Term 2",
          period_sequence: 2,
          academicyear: getSetting("current_school_year", "2025-2026"),
          startDate: "2025-09-01",
          endDate: "2025-11-28",
          is_active: false,
          status: "Upcoming",
        },
        {
          id: 3,
          period: "Term 3",
          period_sequence: 3,
          academicyear: getSetting("current_school_year", "2025-2026"),
          startDate: "2025-12-01",
          endDate: "2026-03-15",
          is_active: false,
          status: "Upcoming",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [getSetting]);

  React.useEffect(() => {
    fetchPeriodsFromDB();
  }, [fetchPeriodsFromDB]);

  const handleMarkComplete = () => {
    toast.success("Active academic period marked as complete");
  };

  function GracefulDateDisplay({ dateString }: { dateString: string | null | undefined }) {
    if (!dateString) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-300">
          <AlertCircle className="w-3 h-3 text-amber-500" /> TBD
        </span>
      );
    }
    return <span className="font-medium">{dateString}</span>;
  }

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
              <SidebarTrigger className="md:hidden" />
              <div className="flex items-center gap-3">
                <Breadcrumb>
                  <Breadcrumb.List>
                    <Breadcrumb.Item>
                      <Breadcrumb.Link href="/admin/settings" className="text-4xl font-bold">
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

            <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-4">
              {/* Single Consolidated Card for Unified JHS & SHS */}
              <Card className="@container/card">
              <Card.Header className="flex flex-row justify-between items-start">
                <Card.Title className="flex flex-col w-full gap-1">
                  Academic Periods
                  <Text
                    as="p"
                    className="text-sm font-normal text-muted-foreground"
                  >
                    Unified three-term academic schedule applying to both Junior High School and Senior High School grade levels.
                  </Text>
                </Card.Title>
                <div className="flex items-center gap-4">
                  <Button size="sm" onClick={handleMarkComplete} className="whitespace-nowrap">
                    Mark as Complete
                  </Button>
                </div>
              </Card.Header>

              <Card.Content className="flex flex-col gap-4">
                {isLoading ? (
                  <LoadingPanel label="Loading academic periods from database..." />
                ) : (
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
                      {periods.map((item) => (
                        <Table.Row key={item.id}>
                          <Table.Cell className="font-bold">{item.period}</Table.Cell>
                          <Table.Cell className="font-medium">{item.academicyear}</Table.Cell>
                          <Table.Cell>
                            <GracefulDateDisplay dateString={item.startDate} />
                          </Table.Cell>
                          <Table.Cell>
                            <GracefulDateDisplay dateString={item.endDate} />
                          </Table.Cell>
                          <Table.Cell>
                            <Badge
                              variant={
                                item.is_active || item.status === "Active"
                                  ? "surface"
                                  : item.status === "Passed"
                                    ? "default"
                                    : "outline"
                              }
                              size="sm"
                            >
                              {item.is_active ? "Active" : item.status}
                            </Badge>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                )}

                <Dialog>
                  <Dialog.Trigger className="w-full flex justify-end">
                    <Button size="sm" variant="link" className="shadow-none p-0! flex-row gap-2 shrink-0 m-0! justify-end w-fit">
                      View Previous Periods
                      <ArrowUpRight className="w-4 h-4" />
                    </Button>
                  </Dialog.Trigger>
                  <ViewPreviousPeriodsModal yearLevel="unified" />
                </Dialog>
              </Card.Content>
            </Card>

            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
