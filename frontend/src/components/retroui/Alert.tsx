import { useEffect, type HtmlHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Text } from "@/components/retroui/Text";

const alertVariants = cva("relative w-full rounded border-2 p-4", {
  variants: {
    variant: {
      default: "bg-background text-foreground [&_svg]:shrink-0",
      solid: "bg-black text-white",
    },
    status: {
      error: "bg-red-300 text-red-800 border-red-800",
      success: "bg-green-300 text-green-800 border-green-800",
      warning: "bg-yellow-300 text-yellow-800 border-yellow-800",
      info: "bg-blue-300 text-blue-800 border-blue-800",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface IAlertProps
  extends HtmlHTMLAttributes<HTMLDivElement>,
  VariantProps<typeof alertVariants> {
  onClose?: () => void;
  duration?: number;
  position?: "inline" | "top-right";
}

const Alert = ({
  className,
  variant,
  status,
  onClose,
  duration,
  position = "inline",
  children,
  ...props
}: IAlertProps) => {
  useEffect(() => {
    if (duration && onClose) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const positionClasses =
    position === "top-right"
      ? "fixed top-3 right-3 z-[9999] w-full max-w-sm shadow-md animate-in fade-in slide-in-from-top-2 duration-300 bg-white"
      : "";

  return (
    <div
      role="alert"
      className={cn(
        alertVariants({ variant, status }),
        onClose && "pr-10",
        positionClasses,
        className
      )}
      {...props}
    >
      {children}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1 hover:bg-neutral-100 border border-transparent hover:border-black rounded transition-all cursor-pointer text-black"
          aria-label="Close alert"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
};
Alert.displayName = "Alert";

interface IAlertTitleProps extends HtmlHTMLAttributes<HTMLHeadingElement> { }
const AlertTitle = ({ className, ...props }: IAlertTitleProps) => (
  <Text as="h5" className={cn(className)} {...props} />
);
AlertTitle.displayName = "AlertTitle";

interface IAlertDescriptionProps
  extends HtmlHTMLAttributes<HTMLParagraphElement> { }
const AlertDescription = ({ className, ...props }: IAlertDescriptionProps) => (
  <div className={cn("text-muted-foreground", className)} {...props} />
);

AlertDescription.displayName = "AlertDescription";

const AlertComponent = Object.assign(Alert, {
  Title: AlertTitle,
  Description: AlertDescription,
});

export { AlertComponent as Alert };
