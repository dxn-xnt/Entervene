import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { OverviewCard } from "@/components/overview-cards";
import { Progress } from "@/components/retroui/Progress";
import { Card } from "@/components/retroui/Card";
// import Card from "@/components/TeacherUIComponents/DashboardCard"

import AppLayout from "@/layouts/app-layout";

export default function AdminDashboard() {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
              <OverviewCard title="Students" count="1402" stat="12" />
              <OverviewCard title="Teachers" count="123" stat="12" />
              <OverviewCard title="Classes" count="92" stat="12" />
              <OverviewCard title="Subjects" count="67" stat="12" />
              {/* <Card title="Subjects" count="3" stat="16" ></Card> */}
            </div>
            <div className="grid grid-cols-[2fr_1fr] gap-4">
              {/* Left column */}
              <div className="flex flex-col gap-4">
                <ChartAreaInteractive />
                <div className="grid grid-cols-2 gap-4">
                  {/* Grade Level Passing Rates */}
                  <Card className="w-full p-4 flex flex-col gap-3">
                    <h2 className="text-lg font-semibold">
                      Grade Level Passing Rates
                    </h2>
                    {[
                      { label: "Grade 7", value: 90 },
                      { label: "Grade 8", value: 87 },
                      { label: "Grade 9", value: 95 },
                      { label: "Grade 10", value: 92 },
                      { label: "STEM 11", value: 95 },
                      { label: "STEM 12", value: 95 },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-3">
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

                  {/* Subject Mastery Rates */}
                  <Card className="w-full p-4 flex flex-col gap-3">
                    <h2 className="text-lg font-semibold">
                      Subject Mastery Rates
                    </h2>
                    {[
                      { label: "7 - Science", value: 95 },
                      { label: "9 - Compute", value: 87 },
                      { label: "9 - English", value: 93 },
                      { label: "8 - Filipino", value: 95 },
                      { label: "7 - English", value: 87 },
                      { label: "8 - Filipino", value: 91 },
                    ].map((item, i) => (
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
    </AppLayout>
  );
}
