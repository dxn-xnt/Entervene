import { ArrowDown, ArrowUp, ExternalLink, Link2, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/retroui/Input";
import { Button } from "@/components/teacher/button";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import type { ReferenceLinkDraft } from "@/lib/classwork-reference-links";

export type ClassworkReferenceLink = {
  classwork_reference_link_id: number;
  url: string;
  title: string | null;
  position: number;
};

const MAX_LINKS = 20;

export function ReferenceLinkEditor({ links, onChange, disabled = false }: {
  links: ReferenceLinkDraft[];
  onChange: (links: ReferenceLinkDraft[]) => void;
  disabled?: boolean;
}) {
  const add = () => onChange([...links, { url: "", title: "" }]);
  const move = (index: number, offset: number) => {
    const reordered = [...links];
    [reordered[index], reordered[index + offset]] = [reordered[index + offset], reordered[index]];
    onChange(reordered);
  };
  return <section className="space-y-3" aria-label="Reference Links">
    <div>
      <h3 className="font-semibold">Reference Links</h3>
      <p className="text-sm text-muted-foreground">Optional websites or documents for students to read. Sharing permissions are managed by the linked site.</p>
    </div>
    {links.length === 0 ? (
      <TeacherEmptyState
        compact
        icon={<Link2 />}
        title="No reference links"
        description="Add a website, document, or video for this classwork."
        action={{
          label: "Add Reference Link",
          icon: <Plus size={16} />,
          disabled,
          onClick: add,
        }}
      />
    ) : (
      <div className="space-y-3">
      {links.map((link, index) => <div key={index} className="grid gap-2 border-2 border-black bg-white p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="min-w-0 text-sm font-semibold">URL
          <Input aria-label={`Reference link ${index + 1} URL`} type="url" value={link.url} placeholder="https://example.com/resource" className="mt-1 w-full shadow-none" disabled={disabled} onChange={(event) => onChange(links.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} />
        </label>
        <label className="min-w-0 text-sm font-semibold">Title (optional)
          <Input aria-label={`Reference link ${index + 1} title`} value={link.title} placeholder="Reference Document" className="mt-1 w-full shadow-none" disabled={disabled} onChange={(event) => onChange(links.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} />
        </label>
        <div className="flex flex-wrap gap-1 self-end">
          <Button type="button" variant="outline" size="sm" disabled={disabled || index === 0} onClick={() => move(index, -1)} aria-label={`Move reference link ${index + 1} up`}><ArrowUp size={16} /></Button>
          <Button type="button" variant="outline" size="sm" disabled={disabled || index === links.length - 1} onClick={() => move(index, 1)} aria-label={`Move reference link ${index + 1} down`}><ArrowDown size={16} /></Button>
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange(links.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove reference link ${index + 1}`}><Trash2 size={16} />Remove</Button>
        </div>
      </div>)}
      <Button type="button" variant="outline" size="sm" disabled={disabled || links.length >= MAX_LINKS} onClick={add}><Plus size={16} />Add Another Link</Button>
    </div>)}
  </section>;
}

export function ReferenceLinkList({ links }: { links: ClassworkReferenceLink[] }) {
  return <ul className="space-y-2">
    {[...links].sort((a, b) => a.position - b.position).map((link) => {
      let href: string;
      let fallback: string;
      try {
        const parsed = new URL(link.url);
        if (!(["http:", "https:"].includes(parsed.protocol) && parsed.hostname && !parsed.username && !parsed.password)) return null;
        href = parsed.href;
        fallback = `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
      } catch { return null; }
      return <li key={link.classwork_reference_link_id} className="min-w-0 border-2 border-black bg-white p-3 shadow-sm">
        <a href={href} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-start gap-2 font-semibold underline underline-offset-2 hover:text-primary">
          <ExternalLink size={16} className="mt-1 shrink-0" />
          <span className="min-w-0 break-all">{link.title?.trim() || fallback}</span>
        </a>
      </li>;
    })}
  </ul>;
}
