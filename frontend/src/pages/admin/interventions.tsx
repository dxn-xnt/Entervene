import { useState, useMemo } from "react";
import { OverviewCard } from "@/components/overview-cards";
import { Card } from "@/components/retroui/Card";
import { Progress } from "@/components/retroui/Progress";
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Badge } from "@/components/retroui/Badge";
import { Select } from "@/components/retroui/Select";
import { Search } from "lucide-react";
import { Input } from "@/components/retroui/Input";

const overviewCards = [
  { title: "Students", count: "1402", stat: "12" },
  { title: "Teachers", count: "123", stat: "12" },
  { title: "Classes", count: "92", stat: "12" },
];

const gradeLevelRates = [
  { label: "Grade 7", value: 90 },
  { label: "Grade 8", value: 87 },
  { label: "Grade 9", value: 95 },
  { label: "Grade 10", value: 92 },
  { label: "STEM 11", value: 95 },
  { label: "STEM 12", value: 95 },
];

const students = [
  {
    id: "1",
    learnerName: "John Doe",
    className: "Grade 7 - Newton",
    subject: "Mathematics",
    score: "72",
    status: "Active",
  },
  {
    id: "2",
    learnerName: "Jane Smith",
    className: "Grade 8 - Darwin",
    subject: "Science",
    score: "88",
    status: "Passed",
  },
  {
    id: "3",
    learnerName: "Mark Johnson",
    className: "Grade 9 - Einstein",
    subject: "English",
    score: "65",
    status: "Needs Intervention",
  },
  {
    id: "4",
    learnerName: "Sarah Williams",
    className: "Grade 10 - Galileo",
    subject: "History",
    score: "94",
    status: "Passed",
  },
  {
    id: "5",
    learnerName: "David Brown",
    className: "STEM 11 - Curie",
    subject: "Calculus",
    score: "58",
    status: "Needs Intervention",
  },
  {
    id: "6",
    learnerName: "Emily Davis",
    className: "STEM 12 - Hawking",
    subject: "Physics",
    score: "81",
    status: "Active",
  },
  {
    id: "7",
    learnerName: "Michael Wilson",
    className: "Grade 7 - Newton",
    subject: "Mathematics",
    score: "90",
    status: "Passed",
  },
  {
    id: "8",
    learnerName: "Jessica Taylor",
    className: "Grade 8 - Darwin",
    subject: "Science",
    score: "75",
    status: "Active",
  },
];

export default function AdminInterventions() {
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const uniqueClasses = useMemo(
    () => [...new Set(students.map((s) => s.className))],
    [],
  );

  const uniqueStatuses = useMemo(
    () => [...new Set(students.map((s) => s.status))],
    [],
  );

  const filteredStudents = useMemo(() => {
    return students.filter((item) => {
      const matchesSearch =
        search === "" ||
        item.learnerName.toLowerCase().includes(search.toLowerCase()) ||
        item.subject.toLowerCase().includes(search.toLowerCase());
      const matchesClass =
        classFilter === "All" || item.className === classFilter;
      const matchesStatus =
        statusFilter === "All" || item.status === statusFilter;
      return matchesSearch && matchesClass && matchesStatus;
    });
  }, [search, classFilter, statusFilter]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <h1 className="text-4xl font-bold tracking-tight">
                Interventions
              </h1>
            </header>

            <div className="-mx-4 md:-mx-6 border-b-2 border-border -mt-[1px]" />

            <div className="flex flex-col gap-4 py-2 md:gap-6 md:py-3">
              <div className="grid grid-cols-4 gap-4 items-start">
                {/* Left column — stacks independently */}
                <div className="col-span-3 flex flex-col gap-4">
                  <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3">
                    {overviewCards.map((card) => (
                      <OverviewCard
                        key={card.title}
                        title={card.title}
                        count={card.count}
                        stat={card.stat}
                      />
                    ))}
                  </div>

                  <div className="flex flex-col gap-4">
                    <div className="grid gap-3 md:grid-cols-[1fr_160px_160px]">
                      <label className="relative shadow-md hover:shadow-none transition-shadow">
                        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                        <Input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Search learner name or subject..."
                          className="h-10 w-full shadow-none border-black pl-9 pr-3"
                        />
                      </label>
                      <Select value={classFilter} onValueChange={setClassFilter}>
                        <Select.Trigger className="w-full">
                          <Select.Value placeholder="Class" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Group>
                            <Select.Item value="All">All Classes</Select.Item>
                            {uniqueClasses.map((className) => (
                              <Select.Item key={className} value={className}>
                                {className}
                              </Select.Item>
                            ))}
                          </Select.Group>
                        </Select.Content>
                      </Select>

                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <Select.Trigger className="w-full">
                          <Select.Value placeholder="Status" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Group>
                            <Select.Item value="All">All Statuses</Select.Item>
                            {uniqueStatuses.map((status) => (
                              <Select.Item key={status} value={status}>
                                {status}
                              </Select.Item>
                            ))}
                          </Select.Group>
                        </Select.Content>
                      </Select>
                    </div>

                    <Card className="p-0 shadow-md rounded-none border-none">
                      <div className="overflow-x-auto">
                        <Table className="">
                          <Table.Header className="font-sans">
                            <Table.Row>
                              <Table.Head>Learner's Name</Table.Head>
                              <Table.Head>Class</Table.Head>
                              <Table.Head>Subject</Table.Head>
                              <Table.Head>Score</Table.Head>
                              <Table.Head>Status</Table.Head>
                            </Table.Row>
                          </Table.Header>
                          <Table.Body>
                            {filteredStudents.map((item) => (
                              <Table.Row key={item.id}>
                                <Table.Cell className="font-medium">{item.learnerName}</Table.Cell>
                                <Table.Cell className="font-medium">{item.className}</Table.Cell>
                                <Table.Cell className="font-medium">{item.subject}</Table.Cell>
                                <Table.Cell className="font-medium">{item.score}</Table.Cell>
                                <Table.Cell>
                                  <Badge
                                    variant={
                                      item.status === "Active"
                                        ? "default"
                                        : item.status === "Passed"
                                          ? "surface"
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
                      </div>
                    </Card>

                  </div>
                </div>

                {/* Right column — stacks independently, sizes to own content */}
                <div className="col-span-1 flex flex-col gap-4 self-start">
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
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
