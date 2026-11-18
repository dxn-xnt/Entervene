import { Badge } from "@/components/retroui/Badge";
import { Select } from "@/components/retroui/Select";
import type { ComponentProps } from "react";

export function AcademicSelectItem({ label, active, ...props }: Omit<ComponentProps<typeof Select.Item>, "children"> & { label: string; active?: boolean }) {
  return (
    <Select.Item {...props} showIndicator={false} textValue={label} endAdornment={active ? <Badge variant="success" size="sm">Active</Badge> : undefined}>
      {label}
    </Select.Item>
  );
}
