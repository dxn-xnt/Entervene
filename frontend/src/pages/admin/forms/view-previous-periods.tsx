"use client";

import * as React from "react";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Table } from "@/components/retroui/Table";
import { Badge } from "@/components/retroui/Badge";



export default function ViewPreviousPeriodsModal({ yearLevel }: { yearLevel: string }) {
    const [level] = React.useState<string>(yearLevel);

    const levelToTitle: Record<string, string> = {
        "junior-high": "Junior High School",
        "senior-high": "Senior High School",
    };

    const title = levelToTitle[level] || level;

    const academicPeriods = [
        {
            id: "1",
            period: "1st Quarter",
            academicyear: "2025-2026",
            startDate: "2025-06-01",
            endDate: "2025-08-30",
            status: "Passed",
        },
        {
            id: "2",
            period: "2nd Quarter",
            academicyear: "2025-2026",
            startDate: "2025-09-01",
            endDate: "2025-11-30",
            status: "Passed",
        },
        {
            id: "3",
            period: "3rd Quarter",
            academicyear: "2025-2026",
            startDate: "2025-12-01",
            endDate: "2026-02-28",
            status: "Passed",
        },
        {
            id: "4",
            period: "4th Quarter",
            academicyear: "2025-2026",
            startDate: "2026-03-01",
            endDate: "2026-05-30",
            status: "Passed",
        },
    ];

    return (
        <Dialog.Content size={"lg"}>
            <Dialog.Header position={"fixed"} asChild>
                <Text as="h5" className="font-sans text-xl font-bold">{title} Previous Periods</Text>
            </Dialog.Header>
            <section className="flex flex-col gap-4 p-4">
                <Table>
                    <Table.Header className="font-sans">
                        <Table.Row>
                            <Table.Head>Period</Table.Head>
                            <Table.Head>Academic Year</Table.Head>
                            <Table.Head>Start Date</Table.Head>
                            <Table.Head>End Date</Table.Head>
                            <Table.Head>Status</Table.Head>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {academicPeriods.map((item) => (
                            <Table.Row key={item.id}>
                                <Table.Cell className="font-medium">{item.period}</Table.Cell>
                                <Table.Cell className="font-medium">{item.academicyear}</Table.Cell>
                                <Table.Cell className="font-medium">{item.startDate}</Table.Cell>
                                <Table.Cell className="font-medium">{item.endDate}</Table.Cell>
                                <Table.Cell>
                                    <Badge
                                        variant={
                                            item.status === "Active"
                                                ? "surface"
                                                : item.status === "Passed"
                                                    ? "default"
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
            </section>
            <Dialog.Footer>
                <Dialog.Trigger>
                    <Button variant={"outline"}>Close</Button>
                </Dialog.Trigger>
            </Dialog.Footer>
        </Dialog.Content>
    );
}