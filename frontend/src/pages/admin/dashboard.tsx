import { useEffect, useState } from "react";
import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { OverviewCard } from "@/components/overview-cards";
import { Progress } from "@/components/retroui/Progress";
import { Card } from "@/components/retroui/Card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { getOverviewStats, type OverviewCardData } from "@/lib/api";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";

const gradeLevelRates = [
  { label: "Grade 7", value: 90 },
  { label: "Grade 8", value: 87 },
  { label: "Grade 9", value: 95 },
  { label: "Grade 10", value: 92 },
  { label: "STEM 11", value: 95 },
  { label: "STEM 12", value: 95 },
];

const subjectMasteryRates = [
  { label: "7 - Science", value: 95 },
  { label: "9 - Compute", value: 87 },
  { label: "9 - English", value: 93 },
  { label: "8 - Filipino", value: 95 },
  { label: "7 - English", value: 87 },
  { label: "8 - Filipino", value: 91 },
];

export default function AdminDashboard() {
  const { selectedPeriodId } = useAcademicPeriod();
  const [cards, setCards] = useState<OverviewCardData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      setIsLoading(true);
      try {
        const data = await getOverviewStats({
          scope: "system",
          academic_period_id: selectedPeriodId ?? undefined,
        });
        if (!cancelled) {
          setCards(data.cards);
        }
      } catch (err) {
        console.error("Failed to load admin overview metrics:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchStats();
    return () => {
      cancelled = true;
    };
  }, [selectedPeriodId]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <div className="flex flex-col items-start">
                  <h1 className="text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">
                    Dashboard
                  </h1>
                </div>
              </div>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:gap-6 md:px-6">
              <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
                {isLoading && cards.length === 0
                  ? Array.from({ length: 4 }).map((_, i) => (
                    <Card key={i} className="@container/card animate-pulse">
                      <Card.Header>
                        <div className="h-4 w-24 bg-muted rounded" />
                      </Card.Header>
                      <Card.Content className="space-y-2">
                        <div className="h-9 w-20 bg-muted rounded" />
                        <div className="h-3 w-32 bg-muted rounded" />
                      </Card.Content>
                    </Card>
                  ))
                  : cards.map((card) => (
                    <OverviewCard
                      key={card.title}
                      title={card.title}
                      count={card.count}
                      stat={card.stat}
                      statDescription={card.statDescription}
                    />
                  ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4">
                {/* Left column */}
                <div className="flex flex-col gap-4">
                  <ChartAreaInteractive />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Card className="w-full p-4 flex flex-col gap-3">
                      <h2 className="text-lg font-semibold">
                        Grade Level Passing Rates
                      </h2>
                      {gradeLevelRates.map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center gap-3"
                        >
                          <span className="text-sm w-20 shrink-0">
                            {item.label}
                          </span>
                          <Progress value={item.value} className="flex-1" />
                          <span className="text-sm font-semibold w-10 text-right">
                            {item.value}%
                          </span>
                        </div>
                      ))}
                    </Card>

                    <Card className="w-full p-4 flex flex-col gap-3">
                      <h2 className="text-lg font-semibold">
                        Subject Mastery Rates
                      </h2>
                      {subjectMasteryRates.map((item, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-sm w-20 shrink-0">
                            {item.label}
                          </span>
                          <Progress value={item.value} className="flex-1" />
                          <span className="text-sm font-semibold w-10 text-right">
                            {item.value}%
                          </span>
                        </div>
                      ))}
                    </Card>
                  </div>
                </div>

                {/* Right column */}
                <Card className="p-4">
                  <h2 className="text-lg font-semibold">Recent Activity</h2>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
