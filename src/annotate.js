/**
 * Terminal annotation of a verification result.
 *
 * Prints the text as a reader sees it, with a marker line underneath showing
 * which spans were checked and what failed. The point is that a verification
 * result should be legible at a glance, not decoded from a list of paths.
 *
 *   Apple Inc. earned 999 last year.
 *   ~~~~~~~~~~        ---
 *   ✓ company:aapl    ✗ expected 416161000000 USD
 *
 * The visible text is rebuilt from the same tokens `stripProveml` uses, so
 * what is annotated is exactly what survives stripping. A scoped entity has
 * no visible name of its own (its braces hold prose), so it gets a label line
 * when it fails and no underline; the constructs inside it are annotated as
 * their own spans. An earlier version replaced the whole scope by its name,
 * which hid every claim inside it, including the failed ones.
 */

import { tokenizeProveml } from './verify.js';

const ESC = String.fromCharCode(27);
const ANSI = {
    reset: `${ESC}[0m`,
    dim: `${ESC}[2m`,
    bold: `${ESC}[1m`,
    green: `${ESC}[32m`,
    red: `${ESC}[31m`,
    amber: `${ESC}[33m`,
    violet: `${ESC}[35m`,
};

const STATUS = {
    verified: { mark: '✓', color: 'green', under: '─' },
    'value-mismatch': { mark: '✗', color: 'red', under: '━' },
    'name-mismatch': { mark: '✗', color: 'red', under: '━' },
    'entity-not-found': { mark: '?', color: 'amber', under: '╌' },
    'field-not-found': { mark: '?', color: 'amber', under: '╌' },
    'no-context': { mark: '?', color: 'amber', under: '╌' },
    unverifiable: { mark: '?', color: 'amber', under: '╌' },
    failed: { mark: '✗', color: 'red', under: '━' },
    unmarked: { mark: '·', color: 'amber', under: '┄' },
};

function paint(text, color, useColor) {
    if (!useColor || !color || !ANSI[color]) return text;
    return `${ANSI[color]}${text}${ANSI.reset}`;
}

function label(detail) {
    switch (detail.status) {
        case 'verified':
            return detail.type === 'inference' ? `${detail.label}` : `${detail.path || detail.field}`;
        case 'value-mismatch':
            return `expected ${detail.expected}`;
        case 'name-mismatch':
            return `store says "${detail.expected}"`;
        case 'entity-not-found':
            return `${detail.path} not in store`;
        case 'field-not-found':
            return `${detail.path} not in store`;
        case 'no-context':
            return `%[${detail.field}] has no entity`;
        case 'unverifiable':
            return detail.error ? detail.error : `${detail.label} could not be checked`;
        case 'failed':
            return detail.error ? detail.error : `${detail.label} does not hold`;
        case 'unmarked':
            return 'not a claim';
        default:
            return detail.status;
    }
}

/**
 * Build an annotated, human-readable view of a verification result.
 *
 * @param {string} markup       the ProveML source that was verified
 * @param {object} result       return value of verifyProveml (needs details with pos/end)
 * @param {object} [opts]
 * @param {boolean} [opts.color=true]  emit ANSI colors
 * @returns {string} multi-line string ready to print
 */
export function annotate(markup, result, opts = {}) {
    const useColor = opts.color !== false;
    const detailAt = new Map();
    for (const d of result.details || []) {
        if (typeof d.pos === 'number') detailAt.set(d.pos, d);
    }
    const out = [];

    // Rebuild the visible text from the tokens, remembering where each
    // construct landed in it. Scope-closing braces are dropped like the
    // construct headers are.
    let visible = '';
    let cursor = 0;
    const spans = [];
    for (const tok of tokenizeProveml(markup)) {
        if (tok.type === 'entity_close') {
            visible += markup.slice(cursor, tok.pos);
            cursor = tok.end;
            continue;
        }
        visible += markup.slice(cursor, tok.pos);
        const detail = detailAt.get(tok.pos);

        if (tok.type === 'entity' && tok.scoped) {
            // Nothing of the header is visible; the content follows as prose
            // and inner tokens. A zero-width span carries the entity's verdict.
            if (detail) spans.push({ start: visible.length, length: 0, detail });
            cursor = tok.end - tok.content.length - 1;
            continue;
        }

        const text = tok.type === 'entity' ? tok.content : tok.type === 'fact' ? tok.value : tok.text;
        if (detail) spans.push({ start: visible.length, length: text.length, detail });
        visible += text;
        cursor = tok.end;
    }
    visible += markup.slice(cursor);

    // Unmarked numbers (strict mode) are not tokens: place them by mapping
    // their source offset into the visible text.
    const toVisible = (srcPos) => {
        let v = srcPos;
        for (const tok of tokenizeProveml(markup)) {
            if (tok.pos >= srcPos) break;
            if (tok.type === 'entity_close') { v -= 1; continue; }
            if (tok.type === 'entity' && tok.scoped) { v -= (tok.end - tok.content.length - 1) - tok.pos; continue; }
            if (tok.end <= srcPos) {
                const shown = tok.type === 'entity' ? tok.content : tok.type === 'fact' ? tok.value : tok.text;
                v -= (tok.end - tok.pos) - shown.length;
            }
        }
        return v;
    };
    for (const d of result.details || []) {
        if (d.type === 'unmarked') spans.push({ start: toVisible(d.pos), length: d.end - d.pos, detail: d });
    }
    spans.sort((a, b) => a.start - b.start);

    // Annotate per line so markers stay under their own span.
    const lines = visible.split('\n');
    let offset = 0;
    for (const line of lines) {
        const lineStart = offset;
        const lineEnd = offset + line.length;
        offset = lineEnd + 1;

        const onLine = spans.filter(s => s.start >= lineStart && (s.length > 0 ? s.start < lineEnd : s.start <= lineEnd));
        if (!line.trim()) { out.push(''); continue; }

        // The text line, with each construct colored by its status.
        let painted = '';
        let last = lineStart;
        for (const s of onLine) {
            if (s.length === 0 || s.start < last) continue;
            painted += line.slice(last - lineStart, s.start - lineStart);
            const st = STATUS[s.detail.status] || { color: null };
            painted += paint(line.substr(s.start - lineStart, s.length), st.color, useColor);
            last = s.start + s.length;
        }
        painted += line.slice(last - lineStart);
        out.push(`  ${painted}`);

        if (!onLine.length) continue;

        // Underline row. Track visual width separately: painted text carries
        // ANSI escapes that must not count toward column position.
        let under = '';
        let visualWidth = 0;
        for (const s of onLine) {
            if (s.length === 0) continue; // scoped entity: no visible name to underline
            const col = s.start - lineStart;
            if (col < visualWidth) continue; // overlapping span, already underlined
            const gap = col - visualWidth;
            under += ' '.repeat(gap);
            const st = STATUS[s.detail.status] || { under: '─', color: null };
            under += paint(st.under.repeat(s.length), st.color, useColor);
            visualWidth = col + s.length;
        }
        if (under.trim()) out.push(`  ${under}`);

        // One label line per failing construct; verified ones need no words,
        // unless the subject the reader sees could be another record.
        for (const s of onLine) {
            if (s.detail.status === 'verified' && s.detail.subjectUnique === false) {
                const pad = ' '.repeat(s.start - lineStart);
                out.push(`  ${pad}${paint(`‼ also names ${s.detail.ambiguousWith.join(', ')}`, 'amber', useColor)}`);
                continue;
            }
            if (s.detail.status === 'verified') continue;
            const st = STATUS[s.detail.status] || { mark: '·', color: null };
            const pad = ' '.repeat(s.start - lineStart);
            out.push(`  ${pad}${paint(`${st.mark} ${label(s.detail)}`, st.color, useColor)}`);
        }
    }

    // Summary.
    const all = result.total || 0;
    const ok = result.verified || 0;
    const outside = result.coverage?.unmarked || 0;
    const summary = all === 0
        ? 'no ProveML constructs found — nothing could be checked'
        : `${ok}/${all} claims verified` + (outside ? `, ${outside} number${outside === 1 ? '' : 's'} outside any claim` : '');
    const color = all === 0 ? 'amber' : ok === all ? 'green' : 'red';
    out.push('');
    out.push(`  ${paint(summary, color, useColor)}`);

    return out.join('\n');
}

export default annotate;
