"use client";

import * as React from "react";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Progress } from "@/components/retroui/Progress";
import { Table } from "@/components/retroui/Table";
import { Text } from "@/components/retroui/Text";
import { AlertTriangle, Check, Search, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SubjectLoadItem, TeacherWorkloadItem } from "@/lib/api";

export interface TeacherModalTarget {
  classId: number;
  className: string;
  subjectId: number;
  subjectName: string;
  currentStaffId?: string | null;
}

export interface StudioTeacher {
  staff_id: string;
  name: string;
  department?: string;
  specialization?: string;
}

interface AssignTeacherModalProps {
  target: TeacherModalTarget;
  teachers: StudioTeacher[];
  teacherWorkloads: TeacherWorkloadItem[];
  loads?: SubjectLoadItem[];
  targetSubjectHours?: number;
  getTeacherAvailabilityStatus: (
    staffId: string,
    classId: number,
    subjectId: number
  ) => string;
  onAssign: (classId: number, subjectId: number, staffId: string) => void;
  onClose: () => void;
}

export default function AssignTeacherModal({
  target,
  teachers,
  teacherWorkloads,
  loads,
  targetSubjectHours,
  getTeacherAvailabilityStatus,
  onAssign,
  onClose,
}: AssignTeacherModalProps) {
  const [searchQuery, setSearchQuery] = React.useState<string>("");
  const [hoveredStaffId, setHoveredStaffId] = React.useState<string | null>(null);

  // Compute scheduled weekly hours for this subject in the class
  const computedSubjectHours = React.useMemo(() => {
    if (typeof targetSubjectHours === "number") return targetSubjectHours;
    if (!loads || !target) return 0;
    const slots = loads.filter(
      (l) => l.class_id === target.classId && l.subject_id === target.subjectId
    );
    let total = 0;
    slots.forEach((sl) => {
      if (!sl.start_time || !sl.end_time) return;
      const sParts = sl.start_time.split(":");
      const eParts = sl.end_time.split(":");
      const sMin = Number(sParts[0]) * 60 + (Number(sParts[1]) || 0);
      const eMin = Number(eParts[0]) * 60 + (Number(eParts[1]) || 0);
      const dur = (eMin - sMin) / 60;
      const days = (sl.days_of_week || []).length;
      if (dur > 0 && days > 0) {
        total += dur * days;
      }
    });
    return total;
  }, [loads, target, targetSubjectHours]);

  const q = searchQuery.toLowerCase().trim();
  const eligibleTeachers = React.useMemo(() => {
    return (teachers || []).filter(
      (t) =>
        !t.staff_id.toUpperCase().startsWith("ADM") &&
        !t.name.toLowerCase().includes("admin") &&
        (!q || t.name.toLowerCase().includes(q) || t.staff_id.toLowerCase().includes(q))
    );
  }, [teachers, q]);

  return (
    <Dialog.Content size="xl" className="max-w-3xl">
      <Dialog.Header position="static">
        <div className="flex flex-col text-left">
          <Text as="h4" className="font-bold text-lg text-primary-foreground">
            Assign Teacher to {target.subjectName} <span className="font-normal">({target.className})</span>

          </Text>

        </div>
      </Dialog.Header>

      <div className="p-4 flex flex-col gap-3 min-h-0 flex-1 overflow-hidden">
        {/* Search and Quick Unassign Bar */}
        <div className="flex items-center justify-between gap-3">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search teacher by name or staff ID..."
              className="h-9 w-full pl-9 pr-3 text-sm shadow-none"
            />
          </label>

          {target.currentStaffId && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs shrink-0 cursor-pointer"
              onClick={() => {
                onAssign(target.classId, target.subjectId, "none");
              }}
            >
              <Trash2 className="size-3.5 mr-1" />
              Unassign
            </Button>
          )}
        </div>

        {/* Teachers Table */}
        <div className="flex-1 overflow-y-auto max-h-[50vh] border-b-2 -mb-2! border-black rounded">
          <Table className="w-full text-xs">
            <Table.Header>
              <Table.Row className="bg-primary/20 border-b-2 border-black">
                <Table.Head className="font-bold text-black py-2">Teacher</Table.Head>
                <Table.Head className="font-bold text-black py-2 w-48">Weekly Workload</Table.Head>
                <Table.Head className="font-bold text-black py-2">Schedule Status</Table.Head>
                <Table.Head className="font-bold text-black py-2 text-right w-24">Action</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {eligibleTeachers.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={4} className="text-center py-6 text-muted-foreground">
                    No teachers found matching &quot;{searchQuery}&quot;
                  </Table.Cell>
                </Table.Row>
              ) : (
                eligibleTeachers.map((t) => {
                  const isCurrent = target.currentStaffId === t.staff_id;
                  const isHovered = hoveredStaffId === t.staff_id;
                  const statusText = getTeacherAvailabilityStatus(
                    t.staff_id,
                    target.classId,
                    target.subjectId
                  );
                  const hasConflict = statusText.includes("Conflict");

                  const w = teacherWorkloads.find((item) => item.staff_id === t.staff_id);
                  const weeklyHours = w?.total_weekly_hours || 0;
                  const maxWeeklyHours = 30.0;
                  const currentPct = Math.min(100, Math.round((weeklyHours / maxWeeklyHours) * 100));

                  // Projected calculation if this teacher is assigned
                  const willAddHours = isHovered && !isCurrent && computedSubjectHours > 0;
                  const projectedHours = willAddHours ? weeklyHours + computedSubjectHours : weeklyHours;
                  const projectedPct = Math.min(100, Math.round((projectedHours / maxWeeklyHours) * 100));

                  const displayHours = willAddHours ? projectedHours : weeklyHours;
                  const displayPct = willAddHours ? projectedPct : currentPct;

                  return (
                    <Table.Row
                      key={t.staff_id}
                      onMouseEnter={() => setHoveredStaffId(t.staff_id)}
                      onMouseLeave={() => setHoveredStaffId(null)}
                      className={cn(
                        "hover:bg-accent/60 transition-colors cursor-default",
                        isCurrent ? "bg-accent/40 font-semibold" : ""
                      )}
                    >
                      <Table.Cell className="py-2.5">
                        <div className="flex flex-col">
                          <span className="font-bold text-sm text-foreground">{t.name}</span>
                          <span className="text-[11px] text-muted-foreground">{t.staff_id}</span>
                        </div>
                      </Table.Cell>

                      <Table.Cell className="py-2.5">
                        <div className="flex flex-col gap-1 w-full max-w-[180px]">
                          <div className="flex justify-between text-[11px] font-bold">
                            <span>
                              {willAddHours ? (
                                <>
                                  <span className=" font-bold">
                                    {displayHours.toFixed(1)}
                                  </span>
                                  <span className="">
                                    {" "}
                                    / {maxWeeklyHours} hrs
                                  </span>
                                  <span className="text-[10px] ml-1 font-normal">
                                    (+{computedSubjectHours.toFixed(1)}h)
                                  </span>
                                </>
                              ) : (
                                <span>
                                  {weeklyHours.toFixed(1)} / {maxWeeklyHours} hrs
                                </span>
                              )}
                            </span>
                            <span
                              className={cn(
                                displayPct > 85
                                  ? "text-destructive"
                                  : "text-foreground",
                                willAddHours ? " font-bold" : ""
                              )}
                            >
                              {displayPct}%
                              {willAddHours && (
                                <span className="text-[10px] ml-0.5 opacity-80 font-normal">
                                  (+{projectedPct - currentPct}%)
                                </span>
                              )}
                            </span>
                          </div>
                          <Progress
                            value={displayPct}
                            className={cn(
                              "h-2 w-full transition-all duration-300",
                              displayPct > 85
                                ? "[&>div]:bg-destructive"
                                : displayPct > 65
                                  ? "[&>div]:bg-amber-500"
                                  : "[&>div]:bg-primary"
                            )}
                          />
                        </div>
                      </Table.Cell>

                      <Table.Cell className="py-2.5">
                        {hasConflict ? (
                          <Badge
                            size="sm"
                            variant="surface"
                            className="bg-destructive/10 border-destructive! rounded text-destructive! inline-flex items-center gap-1 font-semibold text-[11px]"
                          >
                            <AlertTriangle className="size-3" />
                            {statusText}
                          </Badge>
                        ) : (
                          <Badge
                            size="sm"
                            variant="surface"
                            className="text-emerald-800 rounded bg-emerald-100 border-emerald-300 inline-flex items-center gap-1 font-semibold text-[11px]"
                          >
                            <Check className="size-3" />
                            Available
                          </Badge>
                        )}
                      </Table.Cell>

                      <Table.Cell className="py-2.5 text-right">
                        {isCurrent ? (
                          <Badge size="sm" variant="default" className="font-bold rounded!">
                            Assigned
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant={hasConflict ? "outline" : "default"}
                            className={cn(
                              "h-7 text-xs px-3 font-bold rounded! cursor-pointer shadow-none",
                              hasConflict
                                ? "border-destructive text-destructive hover:bg-destructive/10"
                                : ""
                            )}
                            onClick={() => {
                              onAssign(target.classId, target.subjectId, t.staff_id);
                            }}
                          >
                            <Send className="size-3.5 mr-1.5" />
                            Assign
                          </Button>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  );
                })
              )}
            </Table.Body>
          </Table>
        </div>
      </div>

      <Dialog.Footer position="static" className="border-t-2 border-border py-3 justify-end">
        <Button variant="outline" autoIcon={false} onClick={onClose}>
          Close
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
