"use client";

import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

const Accordion = BaseAccordion.Root;

const AccordionItem = ({ className, ref, ...props }: BaseAccordion.Item.Props) => (
  <BaseAccordion.Item
    ref={ref}
    className={cn(
      "group overflow-hidden rounded border-2 bg-background text-foreground shadow-md transition-all hover:shadow-sm data-[open]:shadow-sm",
      className,
    )}
    {...props}
  />
);

const AccordionHeader = ({ className, children, ref, ...props }: BaseAccordion.Trigger.Props) => (
  <BaseAccordion.Header className="flex">
    <BaseAccordion.Trigger
      ref={ref}
      className={cn(
        "group flex flex-1 cursor-pointer items-start justify-between gap-2 px-4 py-2 font-sans text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[open]:rotate-90" />
    </BaseAccordion.Trigger>
  </BaseAccordion.Header>
);

const AccordionContent = ({ className, children, ref, ...props }: BaseAccordion.Panel.Props) => (
  <BaseAccordion.Panel
    ref={ref}
    className="overflow-hidden bg-background font-body text-foreground data-[open]:animate-accordion-down data-[closed]:animate-accordion-up"
    {...props}
  >
    <div className={cn("px-4 pt-2 pb-4", className)}>{children}</div>
  </BaseAccordion.Panel>
);

const AccordionComponent = Object.assign(Accordion, {
  Item: AccordionItem,
  Header: AccordionHeader,
  Trigger: AccordionHeader,
  Content: AccordionContent,
});

export {
  AccordionComponent as Accordion,
  AccordionItem,
  AccordionHeader as AccordionTrigger,
  AccordionContent,
};
