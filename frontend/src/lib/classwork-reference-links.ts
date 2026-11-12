export type ReferenceLinkDraft = { url: string; title: string };

const MAX_LINKS = 20;

export function validateReferenceLinks(links: ReferenceLinkDraft[]): string {
  if (links.length > MAX_LINKS) return `Add no more than ${MAX_LINKS} reference links.`;
  const seen = new Set<string>();
  for (const [index, link] of links.entries()) {
    const url = link.url.trim();
    if (!url || url.length > 2048 || Array.from(url).some((char) => /\s/.test(char) || char === "\\" || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
      return `Reference link ${index + 1} needs a valid URL of at most 2048 characters.`;
    }
    let parsed: URL;
    try { parsed = new URL(url); } catch { return `Reference link ${index + 1} needs an absolute HTTP or HTTPS URL.`; }
    if (!(["http:", "https:"].includes(parsed.protocol) && parsed.hostname && !parsed.username && !parsed.password)) {
      return `Reference link ${index + 1} needs an HTTP or HTTPS URL without embedded credentials.`;
    }
    if (seen.has(url)) return `Reference link ${index + 1} duplicates an earlier link.`;
    seen.add(url);
    if (link.title.trim().length > 255 || Array.from(link.title).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
      return `Reference link ${index + 1} title must be at most 255 characters without control characters.`;
    }
  }
  return "";
}
