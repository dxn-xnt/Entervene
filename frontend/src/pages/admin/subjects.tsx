// import { OverviewCard } from "@/components/overview-cards";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Card, CardTitle, CardHeader, CardContent } from "@/components/ui/card";
import AppLayout from "@/layouts/app-layout";
import { Button } from "@/components/retroui/Button";

const DESCRIPTION = "Teachers Assigned";

const grades = [
  {
    grade: "Grade 7",
    subjects: [
      { title: "Math", count: "24" },
      { title: "English", count: "24" },
      { title: "Science", count: "24" },
      { title: "Filipino", count: "24" },
    ],
  },
  {
    grade: "Grade 8",
    subjects: [
      { title: "Math", count: "24" },
      { title: "English", count: "24" },
      { title: "Science", count: "24" },
      { title: "Filipino", count: "24" },
    ],
  },
  {
    grade: "Grade 9",
    subjects: [
      { title: "Math", count: "24" },
      { title: "English", count: "24" },
      { title: "Science", count: "24" },
      { title: "Filipino", count: "24" },
    ],
  },
  {
    grade: "Grade 10",
    subjects: [
      { title: "Math", count: "24" },
      { title: "English", count: "24" },
      { title: "Science", count: "24" },
      { title: "Filipino", count: "24" },
    ],
  },
];

export default function AdminSubjects() {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            {grades.map((item) => (
              <RetroCard key={item.grade} className="w-full p-4">
                <div className="flex flex-row justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold">{item.grade}</h2>
                  <Button>See all</Button>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  {item.subjects.map((subject, i) => (
                    <Card key={i} className="bg-accent! cursor-pointer">
                      <CardHeader>
                        <CardTitle>{subject.title}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-4xl font-bold">{subject.count}</p>
                        <p className="text-sm mt-2">
                          <span className="font-semibold">{DESCRIPTION}</span>
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </RetroCard>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
