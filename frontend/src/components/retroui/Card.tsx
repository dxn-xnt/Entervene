import { cn } from "@/lib/utils";
import { type HTMLAttributes } from "react";

interface ICardProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
}

const Card = ({ className, ...props }: ICardProps) => {
  return (
    <div
      className={cn(
        "inline-block border-2 gap-2 border-black rounded-none shadow-md transition-all hover:shadow-none bg-card p-4",
        className,
      )}
      {...props}
    />
  );
};

const CardHeader = ({ className, ...props }: ICardProps) => {
  return (
    <div
      className={cn("flex flex-col justify-start mb-2", className)}
      {...props}
    />
  );
};

const CardTitle = ({ className, ...props }: ICardProps) => {
  return <h3 className={cn("text-3xl font-bold", className)} {...props} />;
};

const CardDescription = ({ className, ...props }: ICardProps) => (
  <p className={cn("text-2xl font-medium text-foreground", className)} {...props} />
);

const CardContent = ({ className, ...props }: ICardProps) => {
  return <div className={cn("", className)} {...props} />;
};

const CardComponent = Object.assign(Card, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Content: CardContent,
});

export { CardComponent as Card };