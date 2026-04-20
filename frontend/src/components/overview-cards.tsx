// "use client";

// import { Card } from "@/components/retroui/Card";

// export function OverviewCard() {
//   return (
//     <Card className="@container/card">
//       <Card.Header>
        
//         <Card.Description>Total Revenue</Card.Description>
        
//         <Card.Title className="text-4xl font-bold">$1,250.00</Card.Title>
//       </Card.Header>
//     </Card>
//   );
// }

"use client";

import { Card } from "@/components/retroui/Card";

type OverviewCardProps = {
  title: string;
  count: string;
  stat: string;
};

export function OverviewCard({ title, count, stat }: OverviewCardProps) {
  return (
    <Card className="@container/card">
      <Card.Header>
        <Card.Description>{title}</Card.Description>
        <Card.Title className="text-4xl font-bold">{count}</Card.Title>
      </Card.Header>
      <Card.Content>
        <p className="text-sm">
          <span className="font-semibold">+{stat}</span> increase from last month
        </p>
      </Card.Content>
    </Card>
  );
}