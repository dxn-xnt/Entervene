"use client"

import { Card } from "@/components/retroui/Card";

export function OverviewCard() {
  return (
    <Card className="@container/card">
      <Card.Header>
        <Card.Description>Total Revenue</Card.Description>
        <Card.Title className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          $1,250.00
        </Card.Title>
      
      </Card.Header>
    </Card>
  )
}
