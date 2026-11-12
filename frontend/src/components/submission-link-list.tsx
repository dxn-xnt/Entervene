import { ExternalLink } from "lucide-react";
import { Button } from "@/components/retroui/Button";

export type SavedSubmissionLink = {
  submission_link_id: number;
  url: string;
  title?: string | null;
  position: number;
};

function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) return value;
  } catch {
    // An invalid legacy value must never become a clickable link.
  }
  return null;
}

export default function SubmissionLinkList({ links }: { links: SavedSubmissionLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-gray-900">Submitted Links</h3>
      <ul className="space-y-2">
        {[...links].sort((a, b) => a.position - b.position).map((link) => {
          const href = safeHref(link.url);
          return (
            <li key={link.submission_link_id} className="min-w-0 rounded border border-gray-300 bg-white p-2">
              <p className="break-words text-sm font-medium">{link.title || link.url}</p>
              {href ? (
                <Button asChild variant="outline" size="sm" className="mt-2 inline-flex gap-2">
                  <a href={href} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Open link</a>
                </Button>
              ) : <p className="text-sm text-red-700">This link cannot be opened.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
