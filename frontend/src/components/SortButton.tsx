// components/SortButton.tsx
import { type ReactNode } from "react";
import { ChevronsUpDown } from "lucide-react";

interface SortButtonProps {
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function SortButton({
  icon = <ChevronsUpDown size={15} />,
  children,
  onClick,
  className = "",
}: SortButtonProps) {
  const Wrapper = onClick ? "button" : "label";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`flex items-center gap-2 px-4 text-sm ${className}`}
    >
      {icon}
      {children}
    </Wrapper>
  );
}
