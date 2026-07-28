import { Card } from "@/components/retroui/Card";
import { Progress } from "@/components/retroui/Progress";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ArrowUpRight } from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import {
  LineChart,
  Line,
  XAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const performanceData = [
  { month: "Jan", sapphire: 30, emerald: 45, ruby: 48, gold: 42, jade: 50 },
  { month: "Feb", sapphire: 55, emerald: 52, ruby: 58, gold: 55, jade: 56 },
  { month: "Mar", sapphire: 78, emerald: 60, ruby: 65, gold: 62, jade: 64 },
  { month: "Apr", sapphire: 60, emerald: 66, ruby: 70, gold: 68, jade: 72 },
];

const performanceLegend = [
  { key: "sapphire", label: "Sapphire", color: "#F5A623" },
  { key: "emerald", label: "Emerald", color: "#E8E0A8" },
  { key: "ruby", label: "Ruby", color: "#7FC29B" },
  { key: "gold", label: "Gold", color: "#3FA76B" },
  { key: "jade", label: "Jade", color: "#0F5D3E" },
];

const passingRates = [
  { name: "Penelope", rate: 90, color: "#3FA76B" },
  { name: "Rondina", rate: 87, color: "#E8E0A8" },
  { name: "Dosdos", rate: 93, color: "#F5A623" },
  { name: "Rizal", rate: 95, color: "#0F5D3E" },
  { name: "Dela Cruz", rate: 87, color: "#E8E0A8" },
  { name: "Sitang", rate: 95, color: "#0F5D3E" },
  { name: "Doe", rate: 93, color: "#F5A623" },
];

const masteryRates = [
  { name: "7 - Sapphire", rate: 90, color: "#3FA76B" },
  { name: "8 - Rose", rate: 95, color: "#0F5D3E" },
  { name: "7 - Emerald", rate: 87, color: "#E8E0A8" },
  { name: "9 - Love", rate: 95, color: "#0F5D3E" },
];

const classActivity = [
  {
    title: "Upcoming Science Quiz",
    date: "February 2, 2026",
    highlighted: true,
  },
  {
    title: "Ongoing Science Activity",
    date: "February 2, 2026",
    highlighted: false,
  },
  {
    title: "New lessons added for Sci10",
    date: "February 2, 2026",
    highlighted: false,
  },
];

const studentActivity = [
  {
    title: "23 students have submitted Science Activity 2",
    meta: "Added by John Doe - 2 hours ago",
  },
  {
    title: "New lessons added for Sci10",
    meta: "Added by John Doe - 2 hours ago",
  },
];

const Dashboard = () => {
  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <div>
                <h1 className="text-2xl md:text-4xl font-bold">
                  Dashboard
                </h1>
                <p className="text-sm text-gray-500">
                  Good morning, teacher Dan!
                </p>
              </div>
            </header>

            <div className="-mx-4 md:-mx-6 border-b-2 border-border -mt-[1px]" />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
              <Card className="block w-full">
                <Card.Header>
                  <Card.Description>Subjects</Card.Description>
                </Card.Header>
                <Card.Content>
                  <Card.Title>16</Card.Title>
                  <p className="text-xs text-black">
                    <span className="font-bold">+3</span> increased from last
                    month
                  </p>
                </Card.Content>
              </Card>

              <Card className="block w-full">
                <Card.Header>
                  <Card.Description>Classes</Card.Description>
                </Card.Header>
                <Card.Content>
                  <Card.Title>12</Card.Title>
                  <p className="text-xs text-black">
                    <span className="font-bold">+3</span> increased from last
                    month
                  </p>
                </Card.Content>
              </Card>

              <Card className="block w-full">
                <Card.Header>
                  <Card.Description>Students</Card.Description>
                </Card.Header>
                <Card.Content>
                  <Card.Title>1</Card.Title>
                  <p className="text-xs text-black">
                    <span className="font-bold">+1</span> increased from last
                    month
                  </p>
                </Card.Content>
              </Card>

              <Card className="block w-full">
                <Card.Header>
                  <Card.Description>Ungraded Classwork</Card.Description>
                </Card.Header>
                <Card.Content>
                  <Card.Title>2</Card.Title>
                  <p className="text-xs text-black">
                    <span className="font-bold">+3</span> increased from last
                    month
                  </p>
                </Card.Content>
              </Card>
            </div>

            <div className="flex flex-col lg:flex-row items-stretch gap-4">
              <Card className="block w-full flex-1 border-black transition-none hover:shadow-md">
                <Card.Content>
                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
                    <Card.Title className="mb-0">Performance Rate</Card.Title>
                    <div className="flex flex-row gap-2">
                      <select className="border-2 border-black rounded px-3 py-1 text-sm cursor-pointer">
                        <option>Science</option>
                        <option>Math</option>
                        <option>English</option>
                      </select>
                      <select className="border-2 border-black rounded px-3 py-1 text-sm cursor-pointer">
                        <option>All Section</option>
                        <option>Section A</option>
                        <option>Section B</option>
                      </select>
                    </div>
                  </div>

                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={performanceData}>
                        <CartesianGrid vertical={false} stroke="#00000020" />
                        <XAxis
                          dataKey="month"
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip />
                        {performanceLegend.map((line) => (
                          <Line
                            key={line.key}
                            type="monotone"
                            dataKey={line.key}
                            stroke={line.color}
                            strokeWidth={2}
                            dot={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="flex flex-wrap gap-4 justify-center mt-2">
                    {performanceLegend.map((line) => (
                      <div key={line.key} className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: line.color }}
                        />
                        <span className="text-sm">{line.label}</span>
                      </div>
                    ))}
                  </div>
                </Card.Content>
              </Card>

              <Card className="block w-full lg:w-[35%] border-black transition-none hover:shadow-md">
                <Card.Content className="flex flex-col gap-3">
                  <div className="flex flex-row justify-between items-center">
                    <Card.Title className="mb-0">Class Activity</Card.Title>
                    <div className="border border-black rounded-full p-1 cursor-pointer">
                      <ArrowUpRight size={18} />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {classActivity.map((item) => (
                      <div
                        key={item.title}
                        className={`border-2 border-black rounded px-3 py-2 ${
                          item.highlighted ? "bg-primary" : "bg-transparent"
                        }`}
                      >
                        <p className="text-sm font-medium">{item.title}</p>
                        <p className="text-xs text-gray-600">{item.date}</p>
                      </div>
                    ))}
                  </div>

                  <p className="text-sm font-semibold mt-1">Student Activity</p>

                  <div className="flex flex-col gap-2">
                    {studentActivity.map((item) => (
                      <div
                        key={item.title}
                        className="border-2 border-black rounded px-3 py-2"
                      >
                        <p className="text-sm font-medium">{item.title}</p>
                        <p className="text-xs text-gray-600">{item.meta}</p>
                      </div>
                    ))}
                  </div>
                </Card.Content>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
              <Card className="w-full p-4 flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Student Passing Rates</h2>
                {passingRates.map((student, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-black bg-primary text-xs font-semibold">
                      {student.name.charAt(0)}
                    </div>
                    <span className="text-sm w-20 shrink-0">
                      {student.name}
                    </span>
                    <Progress value={student.rate} className="flex-1" />
                    <span className="text-sm font-semibold w-10 text-right">
                      {student.rate}%
                    </span>
                  </div>
                ))}
              </Card>

              <Card className="w-full p-4 flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Class Mastery Rates</h2>
                {masteryRates.map((cls, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm w-20 shrink-0 truncate">
                      {cls.name}
                    </span>{" "}
                    <Progress value={cls.rate} className="flex-1" />
                    <span className="text-sm font-semibold w-10 text-right">
                      {cls.rate}%
                    </span>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
