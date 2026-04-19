import { OverviewCard } from "@/components/overview-cards"
import Card from "@/components/TeacherUIComponents/DashboardCard"

import AppLayout from "@/layouts/app-layout"

export default function AdminDashboard() {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
                <OverviewCard />
                <Card title="Subjects" count="3" stat="16" ></Card>
              </div>
            </div>
          </div>
        </div>
    </AppLayout>
  )
}
