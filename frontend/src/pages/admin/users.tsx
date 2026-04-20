import { Table } from "@/components/retroui/Table";
import Tabs from "../../components/Tabs";
import AppLayout from "@/layouts/app-layout";
import { useState } from "react";

const tabs = [
  { id: "admins", label: "Admins" },
  { id: "teachers", label: "Teachers" },
  { id: "students", label: "Students" },
];

const admins = [{ name: "John Doe" }, { name: "Jane Smith" }];

const teachers = [
  { name: "Raymart Gabutan", subjects: ["Mathematics I"], classes: 12 },
  {
    name: "Noah Alexander Bennett",
    subjects: ["Mathematics IV", "Physics I"],
    classes: 8,
  },
  {
    name: "Chloe Nguyen Tran",
    subjects: ["Araling Panlipunan", "TLE II"],
    classes: 14,
  },
  {
    name: "Mateo Santiago Lopez",
    subjects: ["English III", "Filipino I"],
    classes: 10,
  },
  {
    name: "Ava Louise Thompson",
    subjects: ["Science II", "Chemistry II"],
    classes: 7,
  },
];

const students = [
  { name: "Daniel Victor Santos", section: "7 - Jade", average: 99 },
  { name: "Mia Gabriela Rodriguez", section: "7 - Jade", average: 99 },
  { name: "Lucas Henry Wallace", section: "7 - Jade", average: 99 },
  { name: "Emma Grace Foster", section: "7 - Jade", average: 98 },
  { name: "Benjamin Isaac Ortiz", section: "7 - Jade", average: 80 },
  { name: "Lily Rose Patel", section: "7 - Jade", average: 88 },
  { name: "Samuel Nathaniel Brooks", section: "7 - Jade", average: 87 },
  { name: "Sofia Elena Morales", section: "7 - Jade", average: 90 },
];

export default function AdminUsers() {
  const [activeTab, setActiveTab] = useState("admins");

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Name</Table.Head>
                  {activeTab === "teachers" && (
                    <>
                      <Table.Head>Subjects</Table.Head>
                      <Table.Head className="text-right">Classes</Table.Head>
                    </>
                  )}
                  {activeTab === "students" && (
                    <>
                      <Table.Head>Section</Table.Head>
                      <Table.Head className="text-right">Average</Table.Head>
                    </>
                  )}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {activeTab === "admins" &&
                  admins.map((user, i) => (
                    <Table.Row key={i}>
                      <Table.Cell>{user.name}</Table.Cell>
                    </Table.Row>
                  ))}

                {activeTab === "teachers" &&
                  teachers.map((user, i) => (
                    <Table.Row key={i}>
                      <Table.Cell>{user.name}</Table.Cell>
                      <Table.Cell>
                        <div className="flex gap-2 flex-wrap">
                          {user.subjects.map((s, j) => (
                            <span
                              key={j}
                              className="border rounded px-2 py-0.5 text-xs"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </Table.Cell>
                      <Table.Cell className="text-right font-semibold">
                        Classes: {user.classes}
                      </Table.Cell>
                    </Table.Row>
                  ))}

                {activeTab === "students" &&
                  students.map((user, i) => (
                    <Table.Row key={i}>
                      <Table.Cell>{user.name}</Table.Cell>
                      <Table.Cell>
                        <span className="border rounded px-2 py-0.5 text-xs">
                          {user.section}
                        </span>
                      </Table.Cell>
                      <Table.Cell className="text-right text-2xl font-bold">
                        {user.average}
                        <span className="text-sm font-normal">%</span>
                      </Table.Cell>
                    </Table.Row>
                  ))}
              </Table.Body>
            </Table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
