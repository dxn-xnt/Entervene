declare module "mammoth" {
  export function convertToHtml(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<{
    value: string;
    messages: unknown[];
  }>;
}

declare module "pptx-preview" {
  interface Previewer {
    preview(input: ArrayBuffer): Promise<void>;
    renderNextSlide(): void;
    renderPreSlide(): void;
    destroy(): void;
    currentIndex: number;
    slideCount?: number;
  }

  export function init(
    element: HTMLElement,
    options: {
      width: number;
      height: number;
      mode: string;
    }
  ): Previewer;
}
