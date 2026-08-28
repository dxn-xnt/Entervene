"use client";

import { useState, useMemo } from "react";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Table } from "@/components/retroui/Table";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Avatar } from "@/components/retroui/Avatar";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { type AttendanceRecordItem, type AttendanceStatus } from "@/lib/attendance-api";
import { Search, Calendar } from "lucide-react";

interface ViewAttendanceLogModalProps {
  studentName: string;
  studentLrn?: string;
  avatar?: string;
  avatarInitial?: string;
  sectionName?: string;
  subjectName?: string;
  rate?: number;
  history: AttendanceRecordItem[];
}

export default function ViewAttendanceLogModal({
  studentName,
  studentLrn,
  avatar,
  avatarInitial,
  sectionName,
  subjectName,
  rate,
  history,
}: ViewAttendanceLogModalProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const attendanceRate = useMemo(() => {
    if (rate !== undefined) return rate;
    const total = history.length;
    if (total === 0) return 100;
    const attended = history.filter(
      (l) => l.status === "present" || l.status === "late" || l.status === "excused",
    ).length;
    return Math.round((attended / total) * 100);
  }, [rate, history]);

  // Sort logs latest date first
  const sortedHistory = useMemo(() => {
    return [...history].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [history]);

  // Filter logs by search query (date / remarks) and status
  const filteredHistory = useMemo(() => {
    return sortedHistory.filter((log) => {
      const matchesSearch =
        log.date.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (log.remarks && log.remarks.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesStatus =
        statusFilter === "all" || log.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [sortedHistory, searchTerm, statusFilter]);

  const renderStatusBadge = (status: AttendanceStatus) => {
    switch (status) {
      case "present":
        return (
          <Badge
            size="sm"
            variant="surface"
            className="bg-success/80"
          >
            Present
          </Badge>
        );
      case "absent":
        return (
          <Badge
            size="sm"
            variant="surface"
            className="bg-destructive/80"
          >
            Absent
          </Badge>
        );
      case "late":
        return (
          <Badge
            size="sm"
            variant="surface"
            className="bg-primary/80"
          >
            Late
          </Badge>
        );
      case "excused":
        return (
          <Badge
            size="sm"
            variant="surface"
            className="bg-blue-200"
          >
            Excused
          </Badge>
        );
      default:
        return (
          <Badge size="sm" variant="default" className="font-bold border-2 border-black">
            {status}
          </Badge>
        );
    }
  };

  return (
    <Dialog.Content size="xl" className="max-w-4xl">
      <Dialog.Header position="fixed" asChild>
        <div className="flex flex-col">
          <Text as="h4" className="font-sans text-xl font-bold">
            Attendance Logs
          </Text>
        </div>
      </Dialog.Header>

      <section className="flex flex-col gap-4 p-4 max-h-[70vh] overflow-y-auto">
        <Card className="shadow-none">
          <div className="flex items-center justify-between gap-3.5">
            <div className="flex items-center gap-3.5 min-w-0">
              <Avatar variant="student" className="size-10 shrink-0">
                <Avatar.Image
                  src={avatar || "/avatars/student-avatars/1.svg"}
                  alt={studentName}
                />
                <Avatar.Fallback>
                  {(avatarInitial || studentName || "?")
                    .charAt(0)
                    .toUpperCase()}
                </Avatar.Fallback>
              </Avatar>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-base font-bold text-black leading-tight truncate">
                  {studentName}
                </span>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {studentLrn && studentLrn !== "N/A" && (
                    <span className="text-muted-foreground font-semibold">
                      LRN: {studentLrn}
                    </span>
                  )}
                  {sectionName && (
                    <Badge size="sm" variant="surface" className="text-xs">
                      {sectionName}
                    </Badge>
                  )}
                  {subjectName && (
                    <Badge size="sm" variant="surface" className="text-xs">
                      {subjectName}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end shrink-0">
              <span className="text-[11px] font-bold text-muted-foreground uppercase">
                Rate
              </span>
              <Badge
                size="sm"
                variant={attendanceRate >= 75 ? "surface" : "outline"}
                className={`text-xs font-bold ${attendanceRate < 75 ? "border-red-600 bg-red-100 text-red-900" : ""
                  }`}
              >
                {attendanceRate}%
              </Badge>
            </div>
          </div>
        </Card>
        {/* Filter Controls */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-full pl-9 border-2 border-black shadow-none"
              placeholder="Search date (YYYY-MM-DD) or remarks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-sm font-semibold whitespace-nowrap">Filter Status:</span>
            <Select
              value={statusFilter}
              onValueChange={(val) => setStatusFilter(val)}
            >
              <Select.Trigger className="bg-white">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  <Select.Item value="all" className="text-xs font-semibold">
                    All Statuses
                  </Select.Item>
                  <Select.Item value="present" className="text-xs font-semibold">
                    Present
                  </Select.Item>
                  <Select.Item value="absent" className="text-xs font-semibold">
                    Absent
                  </Select.Item>
                  <Select.Item value="late" className="text-xs font-semibold">
                    Late
                  </Select.Item>
                  <Select.Item value="excused" className="text-xs font-semibold">
                    Excused
                  </Select.Item>
                </Select.Group>
              </Select.Content>
            </Select>
          </div>
        </div>

        {/* Table of Attendance Logs */}
        <Table className="w-full border-collapse">
          <Table.Header>
            <Table.Row>
              <Table.Head className="min-w-[140px] font-black text-black">
                <div className="flex items-center gap-1.5">
                  <Calendar className="size-3.5" />
                  Attendance Date
                </div>
              </Table.Head>
              <Table.Head className="min-w-[120px] font-black text-center text-black">
                Attendance
              </Table.Head>
              <Table.Head className="font-black text-black">
                Remarks
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body className="divide-y-2 divide-black">
            {filteredHistory.length === 0 ? (
              <Table.Row>
                <Table.Cell
                  colSpan={3}
                  className="py-8 text-center text-sm font-bold italic text-gray-500"
                >
                  {history.length === 0
                    ? "No attendance records logged for this student yet."
                    : "No matching attendance logs found."}
                </Table.Cell>
              </Table.Row>
            ) : (
              filteredHistory.map((log) => (
                <Table.Row
                  key={log.attendance_id}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <Table.Cell className="font-bold tabular-nums">
                    {log.date}
                  </Table.Cell>
                  <Table.Cell className="text-center">
                    {renderStatusBadge(log.status)}
                  </Table.Cell>
                  <Table.Cell className="text-xs">
                    {log.remarks ? (
                      <span className="font-medium text-gray-800">
                        {log.remarks}
                      </span>
                    ) : (
                      <span className="text-gray-400 italic">—</span>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </section>

      <Dialog.Footer className="flex justify-end items-center px-6 py-3 border-t-2 border-black bg-white">
        <Dialog.Close>
          <Button variant="outline" className="border-2 border-black shadow-none font-bold text-xs">
            Close
          </Button>
        </Dialog.Close>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
