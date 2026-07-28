"use client";

import { useState } from "react";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Table } from "@/components/retroui/Table";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { CheckCircle2, XCircle, Calendar as CalendarIcon, Check } from "lucide-react";

interface AttendanceStudent {
  student_id: string;
  name: string;
}

interface AttendanceModalProps {
  sectionName: string;
  students: AttendanceStudent[];
}

export default function AttendanceModal({
  sectionName,
  students,
}: AttendanceModalProps) {
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });

  // Map of student_id -> boolean (true: present, false: absent)
  const [attendance, setAttendance] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    students.forEach((s) => {
      initial[s.student_id] = true;
    });
    return initial;
  });

  const [saved, setSaved] = useState(false);

  const handleMarkAll = (status: boolean) => {
    const updated: Record<string, boolean> = {};
    students.forEach((s) => {
      updated[s.student_id] = status;
    });
    setAttendance(updated);
  };

  const toggleStudent = (studentId: string, status: boolean) => {
    setAttendance((prev) => ({
      ...prev,
      [studentId]: status,
    }));
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Dialog.Content size="xl" className="max-w-4xl bg-card border-2 border-black">
      <Dialog.Header position="fixed" asChild>
        <div className="flex items-center gap-2">
          <Text as="h4" className="font-sans text-2xl font-bold">
            {sectionName}
          </Text>
          <span className="text-xl text-muted-foreground font-normal">&gt;</span>
          <Text as="h4" className="font-sans text-2xl font-semibold text-gray-700">
            Attendance
          </Text>
        </div>
      </Dialog.Header>

      <section className="flex flex-col gap-5 p-4 md:p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="relative w-60">
            <CalendarIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="date"
              className="w-full pl-9 bg-white border-2 border-black"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>

          <div className="flex flex-row items-center gap-3">
            <Button
              className="bg-[#22C55E] hover:bg-[#16a34a] text-white border-2 border-black font-semibold shadow-sm"
              onClick={() => handleMarkAll(true)}
            >
              <Check className="size-4 mr-1.5" /> Mark All As Present
            </Button>
            <Button
              variant="outline"
              className="border-2 border-black bg-white hover:bg-gray-100 font-semibold"
              onClick={() => handleMarkAll(false)}
            >
              Unmark All
            </Button>
          </div>
        </div>

        <Table className="border-2 border-black shadow-md bg-white">
          <Table.Header className="font-sans bg-gray-50 border-b-2 border-black">
            <Table.Row>
              <Table.Head className="font-bold text-base py-3">Name</Table.Head>
              <Table.Head className="font-bold text-base text-right py-3 pr-8">Present Status</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {students.length === 0 ? (
              <Table.Row>
                <Table.Cell colSpan={2} className="text-center py-6 text-muted-foreground">
                  No students in this class.
                </Table.Cell>
              </Table.Row>
            ) : (
              students.map((st) => {
                const isPresent = attendance[st.student_id] ?? true;
                const initials = st.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase();

                return (
                  <Table.Row key={st.student_id} className="hover:bg-gray-50 border-b border-gray-200">
                    <Table.Cell className="font-medium py-3">
                      <div className="flex items-center gap-3">
                        <div className="size-9 rounded-full bg-[#fde047] border-2 border-black flex items-center justify-center font-bold text-sm">
                          {initials}
                        </div>
                        <span className="text-base font-semibold">{st.name}</span>
                      </div>
                    </Table.Cell>

                    <Table.Cell className="text-right py-3 pr-6">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => toggleStudent(st.student_id, true)}
                          className="transition-transform active:scale-95 focus:outline-none"
                          title="Mark Present"
                        >
                          <CheckCircle2
                            className={`size-7 transition-colors ${
                              isPresent ? "text-[#22C55E] fill-green-100" : "text-gray-300 hover:text-green-500"
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleStudent(st.student_id, false)}
                          className="transition-transform active:scale-95 focus:outline-none"
                          title="Mark Absent"
                        >
                          <XCircle
                            className={`size-7 transition-colors ${
                              !isPresent ? "text-[#EF4444] fill-red-100" : "text-gray-300 hover:text-red-500"
                            }`}
                          />
                        </button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                );
              })
            )}
          </Table.Body>
        </Table>
      </section>

      <Dialog.Footer className="flex justify-between items-center px-6 py-4 border-t border-gray-200">
        {saved ? (
          <span className="text-sm text-green-600 font-bold">Attendance saved successfully!</span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          <Dialog.Trigger>
            <Button variant="outline" className="border-2 border-black">
              Cancel
            </Button>
          </Dialog.Trigger>
          <Button
            className="bg-primary text-primary-foreground border-2 border-black font-bold"
            onClick={handleSave}
          >
            Save Attendance
          </Button>
        </div>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
