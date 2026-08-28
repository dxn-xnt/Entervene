"use client";

import { useState } from "react";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Table } from "@/components/retroui/Table";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Card } from "@/components/retroui/Card";
import { Search, ChevronLeft, ChevronRight, Edit3 } from "lucide-react";

interface ViewGradeScoreModalProps {
  categoryName: string;
  items: {
    id: number;
    title: string;
    maxScore: number;
  }[];
  studentGrades: {
    name: string;
    scores: (number | null)[];
    gender?: string | null;
  }[];
  onEnterScores?: (item: { id: number; title: string; maxScore: number }) => void;
}

const ITEMS_PER_PAGE = 4;

export default function ViewGradeScoreModal({
  categoryName,
  items,
  studentGrades,
  onEnterScores,
}: ViewGradeScoreModalProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  // Arrange classworks latest to oldest
  const orderedItems = [...items].reverse();

  const totalPages = Math.ceil(orderedItems.length / ITEMS_PER_PAGE) || 1;
  const validPage = Math.min(currentPage, totalPages);

  const startIndex = (validPage - 1) * ITEMS_PER_PAGE;
  const endIndex = validPage * ITEMS_PER_PAGE;
  const paginatedItems = orderedItems.slice(startIndex, endIndex);

  const totalMaxScore = items.reduce((sum, item) => sum + item.maxScore, 0);

  const filteredStudents = studentGrades.filter((sg) =>
    sg.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const males: typeof filteredStudents = [];
  const females: typeof filteredStudents = [];
  filteredStudents.forEach((sg) => {
    if (sg.gender?.toLowerCase() === "male") {
      males.push(sg);
    } else {
      females.push(sg);
    }
  });

  const renderGroup = (group: typeof filteredStudents, label: string) => {
    if (group.length === 0) return null;
    return (
      <>
        <Table.Row className="border-y-2 border-black bg-yellow-50 hover:bg-yellow-100/70">
          <Table.Cell colSpan={2 + paginatedItems.length} className="py-1 font-black uppercase text-black">
            {label}
          </Table.Cell>
        </Table.Row>
        {group.map((student, idx) => {
          const orderedScores = [...student.scores].reverse();
          const studentPaginatedScores = orderedScores.slice(startIndex, endIndex);
          const totalScore = student.scores.reduce<number>((sum, score) => sum + (score ?? 0), 0);

          return (
            <Table.Row key={student.name} className="border-b border-black/10 hover:bg-yellow-50/50">
              <Table.Cell className="whitespace-nowrap text-sm font-extrabold text-black">
                {idx + 1}. {student.name}
              </Table.Cell>
              {paginatedItems.map((_, i) => {
                const score = studentPaginatedScores[i];
                return (
                  <Table.Cell key={i} className="text-center font-semibold tabular-nums">
                    {score !== null && score !== undefined ? score : "—"}
                  </Table.Cell>
                );
              })}
              <Table.Cell className="text-center font-black text-black tabular-nums">
                {totalScore}
              </Table.Cell>
            </Table.Row>
          );
        })}
      </>
    );
  };

  return (
    <Dialog.Content size={"2xl"}>
      <Dialog.Header asChild>
        <Text as="h5" className="font-sans text-xl font-bold">
          {categoryName} Breakdown (Latest First)
        </Text>
      </Dialog.Header>

      <section className="flex flex-col gap-4 p-4 max-h-[75vh] overflow-y-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-full pl-9 h-9 text-sm"
              placeholder="Search student's name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground font-medium">
            <span>Total Items: <strong className="text-foreground">{items.length}</strong></span>
            <span>·</span>
            <span>Category Max Score: <strong className="text-foreground">{totalMaxScore}</strong></span>
          </div>
        </div>

        <Card className="w-full rounded-none border-2 border-black bg-white p-0 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <Table className="w-full border-collapse text-sm">
            <Table.Header className="border-b-2 border-black bg-yellow-300 text-xs font-black uppercase">
              <Table.Row>
                <Table.Head className="min-w-[180px] font-black text-black">Learner's Name</Table.Head>
                {paginatedItems.map((item) => (
                  <Table.Head key={item.id} className="min-w-[150px] px-3 py-3 text-center font-black text-black">
                    <div className="flex flex-col items-center justify-center gap-1">
                      <div className="flex items-center justify-center gap-1">
                        <span className="max-w-[160px] break-words text-center text-sm font-black leading-tight text-black" title={item.title}>
                          {item.title}
                        </span>
                        {onEnterScores && (
                          <button
                            type="button"
                            title="Enter / Edit Scores"
                            className="border border-transparent p-1 text-black transition-colors hover:border-black hover:bg-yellow-200"
                            onClick={() => onEnterScores(item)}
                          >
                            <Edit3 className="size-3.5" />
                          </button>
                        )}
                      </div>
                      <span className="whitespace-nowrap border border-black bg-yellow-50 px-2 py-0.5 text-[11px] font-bold text-black">
                        {item.maxScore} pts
                      </span>
                    </div>
                  </Table.Head>
                ))}
                <Table.Head className="min-w-[100px] text-center font-black text-black">
                  Total Score
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filteredStudents.length === 0 ? (
                <Table.Row>
                  <Table.Cell
                    colSpan={2 + paginatedItems.length}
                    className="py-8 text-center text-sm font-bold italic text-gray-500"
                  >
                    No learners found matching "{searchQuery}".
                  </Table.Cell>
                </Table.Row>
              ) : (
                <>
                  {renderGroup(males, "MALE")}
                  {renderGroup(females, "FEMALE")}
                </>
              )}
            </Table.Body>
          </Table>
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border border-border rounded-lg text-xs font-semibold text-muted-foreground">
            <span>
              Showing classworks {startIndex + 1}–{Math.min(endIndex, items.length)} of {items.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-semibold"
                disabled={validPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-3.5 mr-1" /> Previous
              </Button>
              <span className="text-xs font-bold text-foreground px-1">
                {validPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-semibold"
                disabled={validPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Next <ChevronRight className="size-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </section>

      <Dialog.Footer>
        <Dialog.Close>
          <Button variant={"outline"}>Close</Button>
        </Dialog.Close>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
