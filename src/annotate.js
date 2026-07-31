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
 */

const ANSI = {
    reset: '[0m',
    dim: '[2m',
    bold: '[1m',
    green: '[32m',
    red: '[31m',
    amber: '[33m',
    violet: '[35m',
};

const STATUS = {
    verified: { mark: '✓', color: 'green', under: '─' },
    'value-mismatch': { mark: '✗', color: 'red', under: '━' },
    'name-mismatch': { mark: '✗', color: 'red', under: '━' },
    'entity-not-found': { mark: '?', color: 'amber', under: '╌' },
    'field-not-found': { mark: '?', color: 'amber', under: '╌' },
    'no-context': { mark: '?', color: 'amber', under: '╌' },
    failed: { mark: '✗', color: 'red', under: '━' },
};

function paint(text, color, useColor) {
    if (!useColor || !color || !ANSI[color]) return text;
    return `${ANSI[color]}${text}${ANSI.reset}`;
}

/** Visible text of a construct, i.e. what survives stripProveml. */
function visibleText(markup, detail) {
    const raw = markup.slice(detail.pos, detail.end);
    if (detail.type === 'entity') {
        const m = raw.match(/^@\[[^\]]*\]\{([\s\S]*)\}$/);
        if (!m) return raw;
        // Scoped entities show their quoted name; the brace content is prose
        // that carries its own constructs and is annotated on its own.
        return detail.name !== undefined && raw.includes('"') ? detail.name : m[1];
    }
    if (detail.type === 'fact') {
        const m = raw.match(/^%\[[^\]]*\]\{([\s\S]*)\}$/);
        return m ? m[1] : raw;
    }
    const m = raw.match(/^\?\[[^\]]*\]\{([\s\S]*)\}$/);
    return m ? m[1] : raw;
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
        case 'failed':
            return detail.error ? detail.error : `${detail.label} does not hold`;
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
 * @param {number} [opts.width=80]     wrap width for the rendered text
 * @returns {string} multi-line string ready to print
 */
export function annotate(markup, result, opts = {}) {
    const useColor = opts.color !== false;
    const details = (result.details || []).filter(d => typeof d.pos === 'number').sort((a, b) => a.pos - b.pos);
    const out = [];

    // Rebuild the visible text, remembering where each construct landed in it.
    let visible = '';
    let cursor = 0;
    const spans = [];
    for (const d of details) {
        if (d.pos < cursor) continue; // nested inside a scoped entity already emitted
        visible += markup.slice(cursor, d.pos);
        const text = visibleText(markup, d);
        spans.push({ start: visible.length, length: text.length, detail: d });
        visible += text;
        cursor = d.end;
    }
    visible += markup.slice(cursor);

    // Annotate per line so markers stay under their own span.
    const lines = visible.split('\n');
    let offset = 0;
    for (const line of lines) {
        const lineStart = offset;
        const lineEnd = offset + line.length;
        offset = lineEnd + 1;

        const onLine = spans.filter(s => s.start >= lineStart && s.start < lineEnd);
        if (!line.trim()) { out.push(''); continue; }

        // The text line, with each construct colored by its status.
        let painted = '';
        let last = lineStart;
        for (const s of onLine) {
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
            const col = s.start - lineStart;
            if (col < visualWidth) continue; // overlapping span, already underlined
            const gap = col - visualWidth;
            under += ' '.repeat(gap);
            const width = Math.max(1, s.length);
            const st = STATUS[s.detail.status] || { under: '─', color: null };
            under += paint(st.under.repeat(width), st.color, useColor);
            visualWidth = col + width;
        }
        out.push(`  ${under}`);

        // One label line per failing construct; verified ones need no words.
        for (const s of onLine) {
            if (s.detail.status === 'verified') continue;
            const st = STATUS[s.detail.status] || { mark: '·', color: null };
            const pad = ' '.repeat(s.start - lineStart);
            out.push(`  ${pad}${paint(`${st.mark} ${label(s.detail)}`, st.color, useColor)}`);
        }
    }

    // Summary.
    const all = result.total || 0;
    const ok = result.verified || 0;
    const summary = all === 0
        ? 'no ProveML constructs found — nothing could be checked'
        : `${ok}/${all} claims verified`;
    const color = all === 0 ? 'amber' : ok === all ? 'green' : 'red';
    out.push('');
    out.push(`  ${paint(summary, color, useColor)}`);

    return out.join('\n');
}

export default annotate;
