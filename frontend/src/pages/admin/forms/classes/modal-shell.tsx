"use client";

import type { ReactNode } from "react";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";

export default function ModalShell({
  title,
  stepText,
  onClose,
  children,
  wide = false,
  workspace = false,
  fullScreen = false,
}: {
  title: string;
  stepText?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  workspace?: boolean;
  fullScreen?: boolean;
}) {
  const size = fullScreen || workspace ? "3xl" : wide ? "2xl" : "lg";

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content size={size}>
        <Dialog.Header asChild>
          <div className="flex items-center justify-between w-full">
            <Text as="h5" className="font-sans text-xl font-bold">{title}</Text>
            {stepText && (
              <Text as="h5" className="font-sans text-md font-bold">{stepText}</Text>
            )}
          </div>
        </Dialog.Header>

        <section className="flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
          {children}
        </section>
      </Dialog.Content>
    </Dialog>
  );
}
