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
import { useNavigate } from "react-router-dom";
import { overdueActivePeriodNotice } from "@/lib/academic-periods";
import { Card } from "@/components/retroui/Card";

type DBPeriodItem = {
  id: number;
  period: string;
  period_sequence: number;
  period_type: string;
  academic_year_id: number;
  academicyear: string;
  startDate: string | null;
  endDate: string | null;
  is_active: boolean;
  status: string;
};

export default function AdminAcademicPeriods() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);

  // Dynamic periods fetched directly from the database
  const [periods, setPeriods] = React.useState<DBPeriodItem[]>([]);

  const fetchPeriodsFromDB = React.useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
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
      setPeriods([]);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchPeriodsFromDB();
  }, [fetchPeriodsFromDB]);

  const overdue = overdueActivePeriodNotice(periods);

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
            <header className="flex items-center gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <SidebarTrigger className="shrink-0 md:hidden" />
              <div className="flex items-center gap-3">
                <Breadcrumb>
                  <Breadcrumb.List>
                    <Breadcrumb.Item>
                    <Breadcrumb.Link href="/admin/settings">
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

            <div className="-mt-[1px] flex min-w-0 flex-col gap-4 border-t-2 border-border px-3 py-3 [&_table]:min-w-[640px] sm:px-4 sm:py-4 md:px-6">
              {/* Single Consolidated Card for Unified JHS & SHS */}
              <Card className="@container/card">
              <Card.Header className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start sm:justify-between">
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
                  <Button size="sm" onClick={() => navigate("/admin/settings")} className="whitespace-nowrap">
                    Manage Active Term
                  </Button>
                </div>
              </Card.Header>

              <Card.Content className="flex flex-col gap-4">
                {loadError && <p role="alert" className="border border-red-500 bg-red-50 p-3 text-sm font-semibold">Academic periods could not be loaded. Try again later.</p>}
                {overdue && <div role="status" className="border-2 border-amber-600 bg-amber-50 p-3 text-sm">
                  <p className="font-bold">Scheduled end date has passed. {overdue.active.period} is still active.</p>
                  <p>{overdue.next
                    ? `Review the current term and consider activating ${overdue.next.period} when current-term activities are complete.`
                    : "No next period is configured. Review the current term when activities are complete."}</p>
                </div>}
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
