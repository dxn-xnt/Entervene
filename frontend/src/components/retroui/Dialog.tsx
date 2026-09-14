"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import React, { type HTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";

const Dialog = BaseDialog.Root;
const DialogTrigger = BaseDialog.Trigger;

const overlayVariants = cva(
  ` fixed bg-black/50 font-head
    data-[open]:fade-in-0
    data-[open]:animate-in
    data-[closed]:animate-out
    data-[closed]:fade-out-0
  `,
  {
    variants: {
      variant: {
        default: "inset-0 z-[998] bg-black/50",
        none: "fixed bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface IDialogBackgroupProps
  extends HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof overlayVariants> { }

const DialogBackdrop = (inputProps: IDialogBackgroupProps & { ref?: React.Ref<HTMLDivElement> }) => {
  const { variant = "default", className, ref, ...props } = inputProps;

  return (
    <BaseDialog.Backdrop
      data-slot="dialog-overlay"
      className={cn(overlayVariants({ variant }), className)}
      ref={ref}
      {...props}
    />
  );
};

const dialogVariants = cva(
  `fixed left-[50%] top-[50%] z-[999] flex max-h-[calc(100dvh-2rem)] flex-col rounded-none overflow-hidden w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] border-2 bg-background shadow-[4px_4px_0_#000] duration-200
  data-[open]:animate-in
  data-[open]:fade-in-0
  data-[open]:zoom-in-95
  data-[closed]:animate-out
  data-[closed]:fade-out-0
  data-[closed]:zoom-out-95`,
  {
    variants: {
      size: {
        auto: "max-w-fit",
        sm: "lg:max-w-[30%]",
        md: "lg:max-w-[40%]",
        lg: "lg:max-w-[50%]",
        xl: "lg:max-w-[60%]",
        "2xl": "lg:max-w-[70%]",
        "3xl": "lg:max-w-[80%]",
        "4xl": "lg:max-w-[90%]",
        screen: "max-w-[100%]",
      },
    },
    defaultVariants: {
      size: "auto",
    },
  },
);

interface IDialogContentProps
  extends HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof dialogVariants> {
  overlay?: IDialogBackgroupProps;
}

const DialogContent = (inputProps: IDialogContentProps & { ref?: React.Ref<HTMLDivElement> }) => {
  const {
    children,
    size = "auto",
    className,
    overlay,
    ref,
    ...props
  } = inputProps;

  return (
    <BaseDialog.Portal>
      <DialogBackdrop {...overlay} />
      <BaseDialog.Popup
        data-slot="dialog-content"
        className={cn(dialogVariants({ size }), className)}
        ref={ref}
        {...props}
      >
        <BaseDialog.Title className="sr-only" />
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
};

interface IDialogDescriptionProps extends HTMLAttributes<HTMLDivElement> { }
const DialogDescription = ({
  children,
  className,
  ...props
}: IDialogDescriptionProps) => {
  return (
    <BaseDialog.Description className={cn(className)} {...props}>
      {children}
    </BaseDialog.Description>
  );
};

const dialogFooterVariants = cva(
  "z-10 mt-4 flex shrink-0 flex-col-reverse items-stretch justify-end gap-2 border-t-2 bg-background px-5 py-4 sm:flex-row sm:items-center",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
      },
      position: {
        fixed: "static",
        static: "static",
      },
    },
    defaultVariants: {
      position: "fixed",
    },
  },
);

export interface IDialogFooterProps
  extends HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof dialogFooterVariants> { }

const DialogFooter = ({
  children,
  className,
  position,
  variant,
  ...props
}: IDialogFooterProps) => {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(dialogFooterVariants({ position, variant }), className)}
      {...props}
    >
      {children}
    </div>
  );
};

const dialogHeaderVariants = cva(
  "z-10 flex shrink-0 items-center justify-between border-b-2 px-5 py-4 min-h-12",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        ghost: "bg-transparent text-foreground border-b border-border",
        neutral: "bg-card text-card-foreground border-b border-border",
      },
      position: {
        fixed: "static",
        static: "static",
      },
    },
    defaultVariants: {
      variant: "default",
      position: "static",
    },
  },
);

const DialogHeaderDefaultLayout = ({ children }: { children: ReactNode }) => {
  return (
    <>
      {children}
<<<<<<< HEAD
      <BaseDialog.Close title="Close pop-up" className="cursor-pointer text-black hover:bg-black/10 transition-colors p-1 rounded">
=======
      <BaseDialog.Close title="Close pop-up" className="cursor-pointer rounded-none p-1 text-current transition-colors hover:bg-foreground/10">
>>>>>>> db4c0c452e2d9c605335b22d05f6935487b30b3d
        <X className="size-4" />
      </BaseDialog.Close>
    </>
  );
};

interface IDialogHeaderProps
  extends HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof dialogHeaderVariants> {
  asChild?: boolean;
}

const DialogHeader = ({
  children,
  className,
  position,
  variant,
  asChild,
  ...props
}: IDialogHeaderProps) => {
  return (
    <div
      data-slot="dialog-header"
      className={cn(dialogHeaderVariants({ position, variant }), className)}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <DialogHeaderDefaultLayout>{children}</DialogHeaderDefaultLayout>
      )}
    </div>
  );
};

const DialogComponent = Object.assign(Dialog, {
  Trigger: DialogTrigger,
  Header: DialogHeader,
  Title: BaseDialog.Title,
  Content: DialogContent,
  Description: DialogDescription,
  Footer: DialogFooter,
  Close: BaseDialog.Close,
});

export { DialogComponent as Dialog };
