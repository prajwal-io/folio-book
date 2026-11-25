import type {HighlightAnnotation, HighlightColor} from '../types/library';

export const HIGHLIGHT_SWATCHES: Record<
  HighlightColor,
  {label: string; lightBg: string; darkBg: string; dotClass: string; borderClass: string}
> = {
  amber: {
    label: 'Amber',
    lightBg: 'rgba(245, 198, 92, 0.36)',
    darkBg: 'rgba(217, 165, 65, 0.28)',
    dotClass: 'bg-[#EAB308]',
    borderClass: 'border-l-[#CA8A04]',
  },
  sage: {
    label: 'Sage',
    lightBg: 'rgba(134, 189, 149, 0.34)',
    darkBg: 'rgba(95, 160, 114, 0.28)',
    dotClass: 'bg-[#4D7C5B]',
    borderClass: 'border-l-[#4D7C5B]',
  },
  sky: {
    label: 'Sky',
    lightBg: 'rgba(133, 179, 224, 0.32)',
    darkBg: 'rgba(96, 150, 205, 0.28)',
    dotClass: 'bg-[#3B82F6]',
    borderClass: 'border-l-[#2563EB]',
  },
  rose: {
    label: 'Rose',
    lightBg: 'rgba(232, 148, 138, 0.32)',
    darkBg: 'rgba(214, 115, 105, 0.28)',
    dotClass: 'bg-[#E07A5F]',
    borderClass: 'border-l-[#9A3412]',
  },
};

export interface SelectionAnchorResult {
  quote: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
}

/**
 * Computes exact character offsets relative to the full plain text inside `proseRoot`,
 * plus surrounding prefix/suffix context so highlights stay anchored cleanly even
 * across font size, margin, theme, and Scroll <-> Paginated layout changes.
 */
export function extractSelectionAnchor(
  proseRoot: HTMLElement,
  range: Range,
): SelectionAnchorResult | null {
  if (!proseRoot.contains(range.commonAncestorContainer)) return null;
  const quote = range.toString().trim();
  if (!quote) return null;

  const preRange = document.createRange();
  preRange.selectNodeContents(proseRoot);
  preRange.setEnd(range.startContainer, range.startOffset);
  const beforeRaw = preRange.toString();

  // Trim leading whitespace difference between raw range & trimmed quote
  const rawSel = range.toString();
  const leadingWs = rawSel.length - rawSel.trimStart().length;
  const startOffset = beforeRaw.length + leadingWs;
  const endOffset = startOffset + quote.length;

  const fullText = proseRoot.textContent || '';
  const prefix = fullText.slice(Math.max(0, startOffset - 40), startOffset);
  const suffix = fullText.slice(endOffset, Math.min(fullText.length, endOffset + 40));

  return {quote, prefix, suffix, startOffset, endOffset};
}

/**
 * Strips any previously injected <mark data-folio-highlight> wrappers cleanly
 * without disturbing underlying sanitized chapter HTML tags.
 */
export function clearHighlightMarks(proseRoot: HTMLElement): void {
  const marks = proseRoot.querySelectorAll('mark[data-folio-highlight]');
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  });
}

function collectTextNodes(root: HTMLElement): Array<{node: Text; start: number; end: number}> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const list: Array<{node: Text; start: number; end: number}> = [];
  let cursor = 0;
  let current = walker.nextNode();
  while (current) {
    const txt = current as Text;
    const len = txt.nodeValue?.length || 0;
    if (len > 0) {
      list.push({node: txt, start: cursor, end: cursor + len});
      cursor += len;
    }
    current = walker.nextNode();
  }
  return list;
}

function resolveHighlightOffsets(
  fullText: string,
  hl: HighlightAnnotation,
): {start: number; end: number} | null {
  const target = hl.quote;
  if (!target) return null;

  // 1. Exact offset hit if chapter text unchanged
  if (
    hl.startOffset >= 0 &&
    hl.endOffset <= fullText.length &&
    fullText.slice(hl.startOffset, hl.endOffset) === target
  ) {
    return {start: hl.startOffset, end: hl.endOffset};
  }

  // 2. Context-anchored search using prefix + quote or quote + suffix
  if (hl.prefix) {
    const combined = `${hl.prefix}${target}`;
    const idx = fullText.indexOf(combined);
    if (idx !== -1) {
      const s = idx + hl.prefix.length;
      return {start: s, end: s + target.length};
    }
  }
  if (hl.suffix) {
    const combined = `${target}${hl.suffix}`;
    const idx = fullText.indexOf(combined);
    if (idx !== -1) {
      return {start: idx, end: idx + target.length};
    }
  }

  // 3. Nearest occurrence of exact quote relative to saved startOffset
  let bestIdx = -1;
  let bestDist = Infinity;
  let searchFrom = 0;
  while (searchFrom < fullText.length) {
    const found = fullText.indexOf(target, searchFrom);
    if (found === -1) break;
    const dist = Math.abs(found - hl.startOffset);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = found;
    }
    searchFrom = found + Math.max(1, target.length);
  }
  if (bestIdx !== -1) {
    return {start: bestIdx, end: bestIdx + target.length};
  }

  return null;
}

/**
 * Re-applies saved highlights onto the live `.reader-prose` DOM element in both
 * Scroll mode and Paginated mode so highlights never drift on font/margin changes.
 */
export function applyHighlightsToDom(
  proseRoot: HTMLElement,
  highlights: HighlightAnnotation[],
  isDarkSurface: boolean,
): void {
  clearHighlightMarks(proseRoot);
  if (highlights.length === 0) return;

  const fullText = proseRoot.textContent || '';
  const resolved = highlights
    .map((hl) => {
      const span = resolveHighlightOffsets(fullText, hl);
      return span ? {hl, start: span.start, end: span.end} : null;
    })
    .filter((item): item is {hl: HighlightAnnotation; start: number; end: number} => item !== null)
    // Apply from end to start so earlier node splits don't shift later character offsets
    .sort((a, b) => b.start - a.start);

  for (const item of resolved) {
    const nodes = collectTextNodes(proseRoot);
    const swatch = HIGHLIGHT_SWATCHES[item.hl.color] || HIGHLIGHT_SWATCHES.amber;
    const bg = isDarkSurface ? swatch.darkBg : swatch.lightBg;

    // Wrap segments overlapping [item.start, item.end) from right to left
    for (let i = nodes.length - 1; i >= 0; i--) {
      const entry = nodes[i];
      if (entry.end <= item.start || entry.start >= item.end) continue;

      const localStart = Math.max(0, item.start - entry.start);
      const localEnd = Math.min(entry.node.length, item.end - entry.start);
      if (localEnd <= localStart) continue;

      let targetNode = entry.node;
      if (localEnd < targetNode.length) {
        targetNode.splitText(localEnd);
      }
      if (localStart > 0) {
        targetNode = targetNode.splitText(localStart);
      }

      const mark = document.createElement('mark');
      mark.setAttribute('data-folio-highlight', item.hl.id);
      mark.style.backgroundColor = bg;
      mark.style.color = 'inherit';
      mark.style.borderRadius = '2px';
      mark.style.padding = '0.05em 0';
      mark.style.cursor = 'pointer';
      if (item.hl.note?.trim()) {
        mark.style.borderBottom = '1.5px dotted currentColor';
      }

      targetNode.parentNode?.insertBefore(mark, targetNode);
      mark.appendChild(targetNode);
    }
  }
}
