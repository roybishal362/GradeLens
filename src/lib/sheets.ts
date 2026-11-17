/**
 * Personalised answer sheets: every printed page carries a QR code "GL1.<testId>.<studentCode>.<page>", so a whole
 * pile can be photographed in any order and sorted to the right students by code, without AI guessing.
 * The QR holds the anonymous code (S07), never a name.
 */
export const sheetPayload = (testId: string, code: string, page: number) => `GL1.${testId}.${code}.${page}`;

export type SheetId = { testId: string; code: string; page: number };

export function parseSheet(text: string | null | undefined): SheetId | null {
  const m = (text ?? "").trim().match(/^GL1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(S\d{2,3})\.(\d{1,2})$/);
  return m ? { testId: m[1], code: m[2], page: Number(m[3]) } : null;
}

export type ScanItem = { index: number; qr: SheetId | null };
export type ScanGroup = { code: string; pages: { index: number; page: number | null; note?: string }[] };
export type ScanResult = { groups: ScanGroup[]; unassigned: number[]; problems: string[] };

/**
 * Sort photographed pages to students. Pages are photographed in pile order, so a page with no readable QR (a loose
 * extra sheet, a smudged code) most likely belongs to the page before it: it is attached there and flagged for the
 * teacher to confirm. Pages from another test are set aside.
 */
export function groupScans(items: ScanItem[], testId: string): ScanResult {
  const groups = new Map<string, ScanGroup>();
  const unassigned: number[] = [];
  const problems: string[] = [];
  let last: string | null = null;
  for (const it of items) {
    if (it.qr && it.qr.testId !== testId) {
      problems.push(`Photo ${it.index + 1} is an answer sheet from a different test; it was set aside.`);
      unassigned.push(it.index);
      continue;
    }
    if (it.qr) {
      const g = groups.get(it.qr.code) ?? { code: it.qr.code, pages: [] };
      if (g.pages.some((p) => p.page === it.qr!.page)) problems.push(`Photo ${it.index + 1}: page ${it.qr.page} of ${it.qr.code} appears twice (kept both; remove the extra one).`);
      g.pages.push({ index: it.index, page: it.qr.page });
      groups.set(it.qr.code, g);
      last = it.qr.code;
    } else if (last) {
      groups.get(last)!.pages.push({ index: it.index, page: null, note: "no QR code: added after the previous page" });
      problems.push(`Photo ${it.index + 1} has no readable QR code, so it was added to ${last} (the page before it). Check it's right.`);
    } else {
      unassigned.push(it.index);
      problems.push(`Photo ${it.index + 1} has no readable QR code and nothing before it: choose its student.`);
    }
  }
  // pages in sheet order; a page without a QR stays right after the page it followed
  for (const g of groups.values()) {
    const ordered: ScanGroup["pages"] = [];
    const withQr = g.pages.filter((p) => p.page !== null).sort((a, b) => a.page! - b.page! || a.index - b.index);
    for (const p of withQr) {
      ordered.push(p);
      for (const loose of g.pages.filter((x) => x.page === null && x.index > p.index && !ordered.includes(x))) {
        // attach loose pages that came directly after this one in the pile (before the next QR page)
        const next = g.pages.filter((x) => x.page !== null && x.index > p.index).map((x) => x.index).sort((a, b) => a - b)[0] ?? Infinity;
        if (loose.index < next) ordered.push(loose);
      }
    }
    for (const p of g.pages) if (!ordered.includes(p)) ordered.push(p);
    g.pages = ordered;
  }
  return { groups: [...groups.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })), unassigned, problems };
}
