import * as React from "react"

import { cn } from "@/lib/utils"

export type TableRoundedVariant = boolean | "none" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "full";

export interface ITableProps extends React.HTMLAttributes<HTMLTableElement> {
    wrapperClassName?: string;
    rounded?: TableRoundedVariant | string;
}

const roundedClasses: Record<string, string> = {
    none: "rounded-none",
    sm: "rounded-sm",
    md: "rounded",
    lg: "rounded-lg",
    xl: "rounded-xl",
    "2xl": "rounded-2xl",
    "3xl": "rounded-3xl",
    full: "rounded-full",
};

function getRoundedClass(rounded?: TableRoundedVariant | string): string {
    if (rounded === false || rounded === "none") return "rounded-none";
    if (rounded === true || rounded === "md") return "rounded";
    if (typeof rounded === "string" && roundedClasses[rounded]) return roundedClasses[rounded];
    return typeof rounded === "string" ? rounded : "rounded";
}

const Table = React.forwardRef<HTMLTableElement, ITableProps>(
    ({ className, wrapperClassName, rounded, ...props }, ref) => {
        const roundedClass = rounded !== undefined ? getRoundedClass(rounded) : "rounded";
        return (
            <div
                className={cn(
                    "relative isolate h-full w-full overflow-hidden border-2 border-border bg-background shadow-lg",
                    roundedClass,
                    wrapperClassName,
                )}
            >
                <div className="h-full w-full overflow-x-auto bg-background">
                    <table
                        ref={ref}
                        className={cn("w-full border-collapse caption-bottom text-sm", className)}
                        {...props}
                    />
                </div>
            </div>
        );
    }
)
Table.displayName = "Table"

const TableHeader = React.forwardRef<
    HTMLTableSectionElement,
    React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
    <thead ref={ref} className={cn("[&_tr]:border-b bg-primary text-primary-foreground font-head", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
    HTMLTableSectionElement,
    React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
    <tbody
        ref={ref}
        className={cn("[&_tr:last-child]:border-0", className)}
        {...props}
    />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
    HTMLTableSectionElement,
    React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
    <tfoot
        ref={ref}
        className={cn(
            "border-t bg-accent font-medium [&>tr]:last:border-b-0",
            className
        )}
        {...props}
    />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
    HTMLTableRowElement,
    React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
    <tr
        ref={ref}
        className={cn(
            "border-b transition-colors hover:bg-primary/50 hover:text-primary-foreground data-[state=selected]:bg-muted",
            className
        )}
        {...props}
    />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
    HTMLTableCellElement,
    React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
    <th
        ref={ref}
        className={cn(
            "h-10 md:h-12 px-3 text-left align-middle font-head text-lg text-primary-foreground [&:has([role=checkbox])]:pr-0",
            className
        )}
        {...props}
    />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
    HTMLTableCellElement,
    React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
    <td
        ref={ref}
        className={cn("p-2 md:p-3 align-middle [&:has([role=checkbox])]:pr-0", className)}
        {...props}
    />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
    HTMLTableCaptionElement,
    React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
    <caption
        ref={ref}
        className={cn("my-2 text-sm text-muted-foreground", className)}
        {...props}
    />
))
TableCaption.displayName = "TableCaption"

const TableObj = Object.assign(Table, {
    Header: TableHeader,
    Body: TableBody,
    Footer: TableFooter,
    Row: TableRow,
    Head: TableHead,
    Cell: TableCell,
    Caption: TableCaption,
})

export {
    TableObj as Table,
}
