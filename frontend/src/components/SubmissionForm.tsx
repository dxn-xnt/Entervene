import { useState } from "react";
import { Upload, X } from "lucide-react";

interface SubmissionFormProps {
  assignmentId: number;
  onSubmit: (files: File[]) => Promise<void>;
  isLoading?: boolean;
  maxAttempts?: number;
  currentAttempt?: number;
}

export default function SubmissionForm({
  assignmentId,
  onSubmit,
  isLoading = false,
  maxAttempts = 1,
  currentAttempt = 0,
}: SubmissionFormProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string>("");
  const [dragActive, setDragActive] = useState(false);

  const canSubmitMore = !maxAttempts || currentAttempt < maxAttempts;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
      setError("");
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files) {
      setFiles(Array.from(e.dataTransfer.files));
      setError("");
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!canSubmitMore) {
      setError(`Maximum attempts (${maxAttempts}) reached`);
      return;
    }

    if (files.length === 0) {
      setError("Please select at least one file to submit");
      return;
    }

    try {
      await onSubmit(files);
      setFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {!canSubmitMore && (
        <div className="p-3 bg-yellow-100 border border-yellow-400 text-yellow-800 rounded">
          Maximum submission attempts ({maxAttempts}) reached
        </div>
      )}

      {/* File Upload Area */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          dragActive
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-gray-400"
        }`}
      >
        <Upload className="mx-auto mb-2 text-gray-400" size={32} />
        <p className="text-sm font-medium text-gray-700 mb-1">
          Drag and drop files here, or click to select
        </p>
        <p className="text-xs text-gray-500 mb-3">
          You can upload multiple files
        </p>
        <input
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
          id="file-input"
          disabled={isLoading || !canSubmitMore}
        />
        <label
          htmlFor="file-input"
          className="inline-block px-4 py-2 bg-blue-500 text-white rounded cursor-pointer hover:bg-blue-600 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Select Files
        </label>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-sm text-gray-700">
            Selected Files ({files.length})
          </h4>
          <div className="space-y-1">
            {files.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 bg-gray-50 rounded border border-gray-200"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="ml-2 p-1 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                  disabled={isLoading}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Submission Info */}
      {maxAttempts && (
        <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
          Submission {currentAttempt + 1} of {maxAttempts}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isLoading || !canSubmitMore || files.length === 0}
        className="w-full px-4 py-2 bg-green-600 text-white rounded font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? "Submitting..." : "Submit Assignment"}
      </button>
    </form>
  );
}
