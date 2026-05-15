import { useState } from "react";
import { Download, X } from "lucide-react";

interface PDFViewerProps {
  pdfUrl: string;
  fileName: string;
  onClose?: () => void;
}

export default function PDFViewer({ pdfUrl, fileName, onClose }: PDFViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  return (
    <div className="flex flex-col gap-3 border border-gray-300 rounded-lg overflow-hidden bg-gray-100">
      {/* Header */}
      <div className="bg-gray-800 text-white px-4 py-3 flex justify-between items-center">
        <div className="flex-1">
          <p className="font-medium truncate">{fileName}</p>
        </div>
        <div className="flex gap-2">
          <a
            href={pdfUrl}
            download={fileName}
            className="p-2 hover:bg-gray-700 rounded transition-colors"
            title="Download PDF"
          >
            <Download size={20} />
          </a>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-700 rounded transition-colors"
              title="Close"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {/* PDF Viewer */}
      <div className={isFullscreen ? "fixed inset-0 z-50 bg-black" : "h-[600px]"}>
        <iframe
          src={`${pdfUrl}#toolbar=1&navpanes=0&scrollbar=1`}
          className="w-full h-full"
          title={fileName}
        />
      </div>

      {/* Controls */}
      <div className="bg-gray-700 text-white px-4 py-2 text-sm flex justify-between items-center">
        <p>Use the PDF toolbar to navigate and zoom</p>
        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm transition-colors"
        >
          {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        </button>
      </div>
    </div>
  );
}
