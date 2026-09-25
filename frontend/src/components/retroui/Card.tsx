import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";

export const cardVariants = cva(
  "inline-block gap-2 rounded border-2 border-border p-4 shadow-md transition-all hover:shadow-none",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        background: "bg-background text-foreground",
        accent: "bg-accent text-accent-foreground",
        primary: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        muted: "bg-muted text-muted-foreground",
        squares: "bg-card text-card-foreground retro-card-squares overflow-hidden",
        pattern: "bg-card text-card-foreground retro-card-squares overflow-hidden",
        retro: "bg-card text-card-foreground border-black shadow-black hover:shadow-sm hover:shadow-black overflow-hidden",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface ICardProps
  extends HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof cardVariants> {
  className?: string;
  squares?: boolean;
  pattern?: boolean;
}

const Card = ({ className, variant, squares, pattern, ...props }: ICardProps) => {
  return (
    <div
      data-slot="card"
      className={cn(
        cardVariants({ variant }),
        (squares || pattern) && "retro-card-squares overflow-hidden",
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
