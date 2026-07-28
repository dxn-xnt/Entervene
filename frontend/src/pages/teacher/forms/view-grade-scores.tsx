"use client";

import { useState } from "react";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Table } from "@/components/retroui/Table";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

interface ViewGradeScoreModalProps {
  categoryName: string;
  items: {
    id: number;
    title: string;
    maxScore: number;
  }[];
  studentGrades: {
    name: string;
    scores: number[];
  }[];
}

const ITEMS_PER_PAGE = 4;

export default function ViewGradeScoreModal({
  categoryName,
  items,
  studentGrades,
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

        <div className="border border-border rounded-lg overflow-x-auto shadow-sm">
          <Table>
            <Table.Header className="font-sans bg-muted/30">
              <Table.Row>
                <Table.Head className="min-w-[180px] font-bold">Learner's Name</Table.Head>
                {paginatedItems.map((item) => (
                  <Table.Head key={item.id} className="text-center min-w-[150px] py-3 px-3">
                    <div className="flex flex-col items-center justify-center gap-1">
                      <span className="font-bold text-sm text-foreground text-center break-words max-w-[180px] leading-tight" title={item.title}>
                        {item.title}
                      </span>
                      <span className="text-[11px] font-semibold text-muted-foreground bg-background px-2 py-0.5 rounded-full border border-border whitespace-nowrap">
                        {item.maxScore} pts
                      </span>
                    </div>
                  </Table.Head>
                ))}
                <Table.Head className="text-center min-w-[100px] font-bold">
                  Total Score
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filteredStudents.length === 0 ? (
                <Table.Row>
                  <Table.Cell
                    colSpan={2 + paginatedItems.length}
                    className="text-center py-8 text-muted-foreground text-sm"
                  >
                    No learners found matching "{searchQuery}".
                  </Table.Cell>
                </Table.Row>
              ) : (
                filteredStudents.map((student) => {
                  const orderedScores = [...student.scores].reverse();
                  const studentPaginatedScores = orderedScores.slice(startIndex, endIndex);
                  const totalScore = student.scores.reduce((sum, score) => sum + score, 0);

                  return (
                    <Table.Row key={student.name} className="hover:bg-muted/20">
                      <Table.Cell className="font-medium whitespace-nowrap">
                        {student.name}
                      </Table.Cell>
                      {paginatedItems.map((_, idx) => {
                        const score = studentPaginatedScores[idx];
                        return (
                          <Table.Cell key={idx} className="text-center font-semibold tabular-nums">
                            {score ?? 0}
                          </Table.Cell>
                        );
                      })}
                      <Table.Cell className="text-center font-bold text-primary tabular-nums">
                        {totalScore}
                      </Table.Cell>
                    </Table.Row>
                  );
                })
              )}
            </Table.Body>
          </Table>
        </div>

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
