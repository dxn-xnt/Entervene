import * as React from "react"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import { DayButton, DayPicker, getDefaultClassNames } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/retroui/Button"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "dropdown",
  startMonth = new Date(1960, 0),
  endMonth = new Date(new Date().getFullYear() + 25, 11),
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      startMonth={startMonth}
      endMonth={endMonth}
      className={cn(
        "bg-white w-[280px] group/calendar p-3 font-sans",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit rounded!", defaultClassNames.root),
        months: cn(
          "flex gap-4 flex-col md:flex-row relative",
          defaultClassNames.months
        ),
        month: cn("flex flex-col w-full gap-3 font-sans", defaultClassNames.month),
        nav: cn(
          "flex items-center w-full absolute top-0 inset-x-0 justify-between pointer-events-none z-10",
          defaultClassNames.nav
        ),
        button_previous: cn(
          "size-8 p-0 flex items-center justify-center border-2 border-black rounded shadow-[2px_2px_0_#000] hover:shadow-none hover:bg-neutral-100 select-none transition-all pointer-events-auto bg-white cursor-pointer active:translate-x-0.5 active:translate-y-0.5",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          "size-8 p-0 flex items-center justify-center border-2 border-black rounded shadow-[2px_2px_0_#000] hover:shadow-none hover:bg-neutral-100 select-none transition-all pointer-events-auto bg-white cursor-pointer active:translate-x-0.5 active:translate-y-0.5",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex items-center justify-center h-8 w-full px-10 relative",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "flex items-center text-base font-bold justify-center h-8 gap-2",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          "relative inline-flex items-center cursor-pointer",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "absolute inset-0 opacity-0 cursor-pointer w-full h-full z-20",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "select-none font-bold text-base flex items-center gap-1 cursor-pointer font-sans text-black",
          defaultClassNames.caption_label
        ),
        month_grid: cn("w-full border-collapse mt-2", defaultClassNames.month_grid),
        weekdays: cn("flex justify-between", defaultClassNames.weekdays),
        weekday: cn(
          "size-8 flex items-center justify-center font-normal text-xs text-stone-500 select-none",
          defaultClassNames.weekday
        ),
        week: cn("flex w-full mt-1 justify-between", defaultClassNames.week),
        week_number_header: cn(
          "select-none w-8",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "text-[0.8rem] select-none text-muted-foreground",
          defaultClassNames.week_number
        ),
        day: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 size-8 aspect-square select-none",
          defaultClassNames.day
        ),
        today: cn(
          "font-bold",
          defaultClassNames.today
        ),
        outside: cn(
          "text-stone-400 opacity-60",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-stone-300 opacity-30 cursor-not-allowed",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            )
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon
                className={cn("size-4", className)}
                {...props}
              />
            )
          }

          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          )
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-8 items-center justify-center text-center">
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  const isSelected = Boolean(
    modifiers.selected &&
    !modifiers.range_start &&
    !modifiers.range_end &&
    !modifiers.range_middle
  )

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={isSelected}
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "font-sans size-8 p-0 flex justify-center items-center rounded text-sm font-medium transition-all hover:bg-accent hover:border-black border border-transparent select-none cursor-pointer",
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[selected-single=true]:border-2 data-[selected-single=true]:border-black data-[selected-single=true]:shadow-[2px_2px_0_#000] data-[selected-single=true]:font-bold",
        modifiers.today && !isSelected && "bg-accent/40 text-foreground font-bold border-2 border-black/40",
        modifiers.disabled && "opacity-30 cursor-not-allowed hover:bg-transparent hover:border-transparent",
        modifiers.outside && "opacity-40",
        defaultClassNames.day_button,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
