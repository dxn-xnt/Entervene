import { cn } from "@/lib/utils";
import { type HTMLAttributes } from "react";

interface ICardProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
}

const Card = ({ className, ...props }: ICardProps) => {
  return (
    <div
      data-slot="card"
      className={cn(
        "inline-block gap-2 rounded border-2 border-black bg-card p-4 shadow-md transition-all hover:shadow-none",
        className,
      )}
      {...props}
    />
  );
};

const CardHeader = ({ className, ...props }: ICardProps) => {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col justify-start mb-2", className)}
      {...props}
    />
  );
};

const CardTitle = ({ className, ...props }: ICardProps) => {
  return <h3 data-slot="card-title" className={cn("text-3xl font-bold", className)} {...props} />;
};

const CardDescription = ({ className, ...props }: ICardProps) => (
  <p data-slot="card-description" className={cn("text-2xl font-medium text-foreground", className)} {...props} />
);

const CardContent = ({ className, ...props }: ICardProps) => {
  return <div data-slot="card-content" className={cn("", className)} {...props} />;
};

const CardComponent = Object.assign(Card, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Content: CardContent,
});

export { CardComponent as Card };
