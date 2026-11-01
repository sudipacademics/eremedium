/** Parse h2 heading anchors from ERP HTML blog content for table of contents. */
export function extractBlogHeadings(html: string): { id: string; label: string }[] {
  if (typeof DOMParser === 'undefined' || !html) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('h2[id]'))
    .map((el) => ({
      id: el.id,
      label: el.textContent?.trim() || el.id,
    }))
    .filter((row) => row.id && row.label);
}

/** Rough reading time from HTML word count. */
export function estimateReadingMinutes(html: string): number {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 1;
  return Math.max(1, Math.round(text.split(' ').length / 200));
}
