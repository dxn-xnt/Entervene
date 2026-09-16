import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentedControlOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  title?: string;
}

interface SegmentedControlContextValue<T extends string = string> {
  value?: T;
  onValueChange?: (value: T) => void;
  size?: "sm" | "md" | "lg";
  itemClassName?: string;
  activeClassName?: string;
}

const SegmentedControlContext = React.createContext<SegmentedControlContextValue<any> | null>(null);

export interface SegmentedControlProps<T extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  options?: Array<SegmentedControlOption<T>>;
  size?: "sm" | "md" | "lg";
  itemClassName?: string;
  activeClassName?: string;
  children?: React.ReactNode;
}

export function SegmentedControl<T extends string = string>({
  value: controlledValue,
  defaultValue,
  onValueChange,
  options,
  size = "md",
  className,
  itemClassName,
  activeClassName,
  children,
  ...props
}: SegmentedControlProps<T>) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState<T | undefined>(defaultValue);
  const isControlled = controlledValue !== undefined;
  const activeValue = isControlled ? controlledValue : uncontrolledValue;

  const handleValueChange = React.useCallback(
    (newValue: T) => {
      if (!isControlled) {
        setUncontrolledValue(newValue);
      }
      onValueChange?.(newValue);
    },
    [isControlled, onValueChange]
  );

  const sizeContainerClasses = {
    sm: "p-1 gap-1",
    md: "p-1.5 gap-1.5",
    lg: "p-2 gap-2",
  }[size];

  return (
    <SegmentedControlContext.Provider
      value={{
        value: activeValue,
        onValueChange: handleValueChange,
        size,
        itemClassName,
        activeClassName,
      }}
    >
      <div
        role="group"
        className={cn(
          "inline-flex items-center rounded border-2 border-black bg-background",
          sizeContainerClasses,
          className
        )}
        {...props}
      >
        {options
          ? options.map((opt) => (
            <SegmentedControlItem
              key={opt.value}
              value={opt.value}
              disabled={opt.disabled}
              title={opt.title}
            >
              {opt.label}
            </SegmentedControlItem>
          ))
          : children}
      </div>
    </SegmentedControlContext.Provider>
  );
}

export interface SegmentedControlItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
  children: React.ReactNode;
}

export function SegmentedControlItem({
  value,
  children,
  className,
  disabled,
  ...props
}: SegmentedControlItemProps) {
  const context = React.useContext(SegmentedControlContext);
  if (!context) {
    throw new Error("SegmentedControlItem must be used within a SegmentedControl");
  }

  const isSelected = context.value === value;
  const size = context.size || "md";

  const sizeItemClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-xs md:text-sm",
    lg: "px-4 py-1.5 text-sm md:text-base",
  }[size];

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      disabled={disabled}
      onClick={() => context.onValueChange?.(value)}
      className={cn(
        "font-bold transition-all flex items-center rounded justify-center whitespace-nowrap cursor-pointer",
        sizeItemClasses,
        isSelected
          ? cn(
            "border-2 border-black bg-primary text-black shadow-none",
            context.activeClassName
          )
          : cn(
            "border-2 border-transparent text-black hover:bg-accent",
            context.itemClassName
          ),
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

SegmentedControl.Item = SegmentedControlItem;
export default SegmentedControl;
