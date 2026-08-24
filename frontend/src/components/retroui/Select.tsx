import { cn } from "@/lib/utils";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

interface CustomSelectProps extends SelectPrimitive.SelectProps {
  onChange?: (event: { target: { value: string } }) => void;
  className?: string;
}

const Select = ({
  children,
  onValueChange,
  onChange,
  className,
  ...props
}: CustomSelectProps) => {
  const handleValueChange = (value: string) => {
    onValueChange?.(value);
    onChange?.({ target: { value } });
  };

  return (
    <SelectPrimitive.Root onValueChange={handleValueChange} {...props}>
      {children}
    </SelectPrimitive.Root>
  );
};

const SelectTrigger = ({
  className,
  children,
  ...props
}: SelectPrimitive.SelectTriggerProps) => {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-10 rounded min-w-40 items-center shadow-md bg-background focus:shadow-xs justify-between border-2 border-input border-border px-4 py-2 placeholder:text-muted-foreground outline-none focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 [&>span]:truncate text-left",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-70" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
};

const SelectValue = ({
  className,
  ...props
}: SelectPrimitive.SelectValueProps) => (
  <SelectPrimitive.Value
    className={cn("truncate block text-left", className)}
    {...props}
  />
);

const SelectIcon = SelectPrimitive.Icon;

const SelectContent = ({
  className,
  children,
  position = "popper",
  side = "bottom",
  sideOffset = 4,
  ...props
}: SelectPrimitive.SelectContentProps) => {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          // Dialogs use z-index 998 for their backdrop and 999 for their popup.
          // This content is rendered in a Radix portal, so it must sit above both.
          "relative z-[1000] min-w-[8rem] overflow-hidden border border-border bg-background text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1 max-w-[var(--radix-select-trigger-width)] w-[var(--radix-select-trigger-width)]",
          className,
        )}
        position={position}
        side={side}
        sideOffset={sideOffset}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1 text-muted-foreground">
          <ChevronUp className="h-4 w-4" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport
          className={cn(
            "p-1 max-h-56 overflow-y-auto",
            position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1 text-muted-foreground">
          <ChevronDown className="h-4 w-4" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
};

const SelectGroup = SelectPrimitive.Group;

const SelectItem = ({
  className,
  children,
  ...props
}: SelectPrimitive.SelectItemProps) => (
  <SelectPrimitive.Item
    className={cn(
      "relative flex w-full max-w-full cursor-default select-none items-center py-2 pl-3 pr-8 outline-none data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground focus:bg-primary focus:text-primary-foreground data-disabled:pointer-events-none data-disabled:opacity-50 text-xs font-medium",
      className,
    )}
    {...props}
  >
    <SelectPrimitive.ItemText asChild>
      <span className="truncate block w-full">{children}</span>
    </SelectPrimitive.ItemText>

    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4 text-foreground" />
      </SelectPrimitive.ItemIndicator>
    </span>
  </SelectPrimitive.Item>
);

const SelectLabel = SelectPrimitive.Label;
const SelectSeparator = SelectPrimitive.Separator;

const SelectObj = Object.assign(Select, {
  Trigger: SelectTrigger,
  Value: SelectValue,
  Icon: SelectIcon,
  Content: SelectContent,
  Group: SelectGroup,
  Item: SelectItem,
  Label: SelectLabel,
  Separator: SelectSeparator,
});

export { SelectObj as Select };
