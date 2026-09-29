import * as React from "react";
import { cn } from "@/lib/utils";

export interface ToggleSwitchOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
  title?: string;
}

interface ToggleSwitchContextValue<T extends string = string> {
  value?: T;
  onValueChange?: (value: T) => void;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "outline" | "solid";
  fullWidth?: boolean;
  itemClassName?: string;
  activeClassName?: string;
}

const ToggleSwitchContext = React.createContext<ToggleSwitchContextValue<any> | null>(null);

export interface ToggleSwitchProps<T extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  options?: Array<ToggleSwitchOption<T>>;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "outline" | "solid";
  fullWidth?: boolean;
  itemClassName?: string;
  activeClassName?: string;
  children?: React.ReactNode;
}

export function ToggleSwitch<T extends string = string>({
  value: controlledValue,
  defaultValue,
  onValueChange,
  options,
  size = "sm",
  variant = "default",
  fullWidth = true,
  className,
  itemClassName,
  activeClassName,
  children,
  ...props
}: ToggleSwitchProps<T>) {
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

  const variantContainerClasses = {
    default: "bg-background border-2 border-border",
    outline: "bg-background border-2 border-border",
    solid: "bg-card border-2 border-black shadow-xs",
  }[variant];

  return (
    <ToggleSwitchContext.Provider
      value={{
        value: activeValue,
        onValueChange: handleValueChange,
        size,
        variant,
        fullWidth,
        itemClassName,
        activeClassName,
      }}
    >
      <div
        role="group"
        className={cn(
          "inline-flex items-center rounded transition-all",
          fullWidth && "w-full flex",
          sizeContainerClasses,
          variantContainerClasses,
          className
        )}
        {...props}
      >
        {options
          ? options.map((opt) => (
            <ToggleSwitchItem
              key={opt.value}
              value={opt.value}
              disabled={opt.disabled}
              title={opt.title}
            >
              {opt.icon && <span className="shrink-0">{opt.icon}</span>}
              <span>{opt.label}</span>
              {opt.badge && <span className="shrink-0">{opt.badge}</span>}
            </ToggleSwitchItem>
          ))
          : children}
      </div>
    </ToggleSwitchContext.Provider>
  );
}

export interface ToggleSwitchItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
  children: React.ReactNode;
}

export function ToggleSwitchItem({
  value,
  children,
  className,
  disabled,
  ...props
}: ToggleSwitchItemProps) {
  const context = React.useContext(ToggleSwitchContext);
  if (!context) {
    throw new Error("ToggleSwitchItem must be used within a ToggleSwitch");
  }

  const isSelected = context.value === value;
  const size = context.size || "sm";
  const fullWidth = context.fullWidth ?? true;

  const sizeItemClasses = {
    sm: "py-1.5 px-2 text-xs",
    md: "py-2 px-3 text-sm",
    lg: "py-2.5 px-4 text-base",
  }[size];

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      disabled={disabled}
      onClick={() => context.onValueChange?.(value)}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded font-semibold transition-all cursor-pointer select-none whitespace-nowrap",
        fullWidth && "flex-1",
        sizeItemClasses,
        isSelected
          ? cn(
            "bg-primary text-foreground font-bold border-2 border-border",
            context.activeClassName
          )
          : cn(
            "text-muted-foreground hover:text-foreground hover:bg-background/40 border-2 border-transparent",
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

ToggleSwitch.Item = ToggleSwitchItem;
export default ToggleSwitch;
