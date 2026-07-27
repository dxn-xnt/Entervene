"use client";

import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Table } from "@/components/retroui/Table";
import { Dialog } from "@/components/retroui/Dialog";

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

export default function ViewGradeScoreModal({
    categoryName,
    items,
    studentGrades,
}: ViewGradeScoreModalProps) {
    return (
        <Dialog.Content size={"lg"}>
            <Dialog.Header position={"fixed"} asChild>
                <Text as="h5" className="font-sans text-xl font-bold">{categoryName} Scores</Text>
            </Dialog.Header>
            <section className="flex flex-col gap-4 p-4">
                <Table>
                    <Table.Header className="font-sans">
                        <Table.Row>
                            <Table.Head>Learner's Name</Table.Head>
                            <Table.Head className="text-center w-full">{categoryName}</Table.Head>
                            <Table.Head className="text-center">Grade</Table.Head>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        <Table.Row>
                            <Table.Cell className="min-w-70">Classwork Name</Table.Cell>

                            <Table.Cell className="py-2 w-full">
                                <div className="flex flex-row justify-between w-full">
                                    {items.map((item) => (
                                        <span key={item.id} className="w-full text-center flex flex-row justify-center items-center gap-1 whitespace-nowrap">
                                            <span>{item.title}</span>
                                            <span className="text-muted-foreground">({item.maxScore})</span>
                                        </span>
                                    ))}
                                </div>
                            </Table.Cell>

                            <Table.Cell className="text-center font-bold">
                                {items.reduce((sum, item) => sum + item.maxScore, 0)}
                            </Table.Cell>
                        </Table.Row>
                        {studentGrades.map((item) => (
                            <Table.Row key={item.name}>
                                <Table.Cell className="font-medium">{item.name}</Table.Cell>
                                <Table.Cell className="font-medium w-full">
                                    <div className="flex flex-row justify-between w-full">
                                        {item.scores.map((score, index) => (
                                            <span className="w-full text-center" key={index}>{score}</span>
                                        ))}
                                    </div>
                                </Table.Cell>
                                <Table.Cell className="text-center font-medium">
                                    {item.scores.reduce((sum, score) => sum + score, 0)}
                                </Table.Cell>
                            </Table.Row>
                        ))}
                    </Table.Body>
                </Table>
            </section>
            <Dialog.Footer>
                <Dialog.Trigger>
                    <Button variant={"outline"}>Close</Button>
                </Dialog.Trigger>
            </Dialog.Footer>
        </Dialog.Content>
    );
}
