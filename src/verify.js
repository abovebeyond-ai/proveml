/**
 * ProveML Standalone Verifier
 *
 * The normative entry point: `verifyProveml(markdown, store, options)`. It
 * tokenizes the raw text and judges every construct through `core.js`, which
 * the markdown-it plugin shares, so the two cannot disagree on a claim.
 *
 * Supports: simple entities, scoped entities, nested scope, linear carry-forward,
 * facts, inferences with threshold evaluation and AND/OR/NOT.
 *
 * The tokenizer knows three things about Markdown, no more: fenced code blocks,
 * code spans and backslash escapes are not constructs. The host parser skips
 * those, so the verifier must too, or a fenced example in a report would change
 * its own verification count.
 */

import { thresholds } from './thresholds.js';
import { toTrustAdapter } from './trust-adapter.js';
import { assertRegistry, checkEntity, checkFact, evaluateCondition, mergeTrustFields } from './core.js';

/**
 * Verify all ProveML constructs in a markdown string.
 * @param {string} markdown - Raw ProveML-annotated markdown
 * @param {object} factStoreOrAdapter - Flat key-value store or trust adapter
 * @param {object} [options] - Optional: { snapshot: string, thresholds: object, strict: boolean }
 *   options.strict: a number in the prose that no construct covers is a
 *   finding (status 'unmarked'), not just a count, and a verified entity whose
 *   rendered name is shared by another record of the same type is a finding
 *   too (the reader could not tell them apart). Without it, verification only
 *   judges what is inside markup; coverage and uniqueness are still reported.
 *   options.thresholds replaces the built-in registry for this verification:
 *   a domain defines its own vocabulary, and the built-in example thresholds
 *   (education, finance, health) stop being part of the allowed language.
 *   Callers that want both can spread: { ...thresholds, ...own }.
 * @returns {{ total, verified, errors: string[], details: object[], snapshot?: string }}
 */
export function verifyProveml(markdown, factStoreOrAdapter, options) {
    const adapter = toTrustAdapter(factStoreOrAdapter);
    const registry = assertRegistry(options?.thresholds || thresholds);
    const results = { total: 0, verified: 0, errors: [], details: [] };
    if (options?.snapshot) results.snapshot = options.snapshot;
    const inferLabels = {};

    const tokens = tokenizeProveml(markdown);

    // Scope: a stack of the contexts in force when each scope opened
    const entityStack = [];
    let currentEntity = null;

    for (const tok of tokens) {
        const span = { pos: tok.pos, end: tok.end };

        if (tok.type === 'entity') {
            const path = `${tok.entityType}:${tok.entityId}`;
            const check = checkEntity(adapter, path, tok.name);

            results.total++;
            if (check.status === 'verified') {
                results.verified++;
                if (check.subjectUnique === false && options?.strict) {
                    results.errors.push(`@[${path}]{${tok.name}}: rendered subject is not unique, also names ${check.ambiguousWith.join(', ')}`);
                }
            } else if (check.status === 'entity-not-found') {
                results.errors.push(`@[${path}]: not found`);
            } else {
                results.errors.push(`@[${path}]{${tok.name}}: name is "${check.expected}"`);
            }
            results.details.push({ type: 'entity', path, name: tok.name, ...check, ...span });

            if (tok.scoped) {
                // Push the current context, null included: "no context" is also
                // a context, and it must be restored when the scope closes.
                // Otherwise an entity from inside a top-level scope leaks out
                // of it and later facts bind to the wrong entity.
                entityStack.push(currentEntity);
            }
            currentEntity = path;
        } else if (tok.type === 'entity_close') {
            // Scope closes: restore whatever was in force when it opened.
            // An unmatched close (malformed input) leaves the context alone.
            if (entityStack.length > 0) {
                currentEntity = entityStack.pop();
            }
        } else if (tok.type === 'fact') {
            results.total++;
            const check = checkFact(adapter, currentEntity, tok.field, tok.value);
            if (check.status === 'verified') {
                results.verified++;
            } else if (check.status === 'no-context') {
                results.errors.push(`%[${tok.field}]{${tok.value}}: no entity context`);
            } else if (check.status === 'field-not-found') {
                results.errors.push(`%[${tok.field}]{${tok.value}} in ${currentEntity}: field not found`);
            } else {
                results.errors.push(`%[${tok.field}]{${tok.value}} in ${currentEntity}: should be ${check.expected}`);
            }
            results.details.push({
                type: 'fact',
                ...(check.status === 'no-context' ? { field: tok.field } : {}),
                value: tok.value,
                ...check,
                ...span
            });
        } else if (tok.type === 'inference') {
            results.total++;
            const result = evaluateCondition(tok.condition, currentEntity, adapter, inferLabels, registry);
            inferLabels[tok.label] = result;
            if (result.verified) {
                results.verified++;
                results.details.push({
                    type: 'inference',
                    label: tok.label,
                    status: 'verified',
                    ...span,
                    ...mergeTrustFields([result])
                });
            } else {
                results.errors.push(`?[${tok.label}: ${tok.condition}]: ${result.error || 'condition false'}`);
                results.details.push({
                    type: 'inference',
                    label: tok.label,
                    // unknown = could not be resolved (unregistered threshold,
                    // missing operand); distinct from a condition that resolved
                    // to false. Renderers show unknown as unverifiable, false
                    // as failed.
                    status: result.unknown ? 'unverifiable' : 'failed',
                    ...span,
                    error: result.error,
                    ...(result.unknown ? { unknown: true } : {}),
                    ...mergeTrustFields([result])
                });
            }
        }
    }

    // Coverage: how much of the numeric content is inside a claim at all.
    // Reported always; in strict mode an unmarked number is also a finding.
    const unmarked = unmarkedNumbers(markdown);
    const marked = tokens.filter(t => t.type === 'fact' && /\d/.test(t.value)).length;
    results.unmarked = unmarked;
    results.coverage = {
        marked,
        unmarked: unmarked.length,
        rate: marked + unmarked.length === 0 ? null : marked / (marked + unmarked.length)
    };
    if (options?.strict) {
        for (const u of unmarked) {
            results.errors.push(`${u.value} in prose is not a claim`);
            results.details.push({ type: 'unmarked', value: u.value, status: 'unmarked', errorClass: 'coverage', pos: u.pos, end: u.end });
        }
        results.details.sort((a, b) => a.pos - b.pos);
    }

    return results;
}

/**
 * Numbers in the prose that no construct covers.
 *
 * The verification rate counts claims inside markup, so a response that marks
 * up one number and leaves nine in plain prose scores 100%. Coverage is the
 * complementary measure, and this is its definition, shared with the paper's
 * coverage audit so both count the same thing:
 *
 *   a standalone numeric token (digits, optional . or , groups) outside every
 *   construct and every code span, that is not a list marker at line start,
 *   not a bare year 1900-2099, and not a fiscal form (FY2025, Q1 2026).
 *
 * Digits inside words (3BS, h1, FY2025) are identifiers, not claims. Prose
 * inside a scoped entity's braces is prose and is scanned.
 *
 * @returns {{ value: string, pos: number, end: number }[]}
 */
export function unmarkedNumbers(markdown) {
    const skipped = [];
    const tokens = tokenizeProveml(markdown, 0, skipped);
    const covered = [...skipped];
    for (const t of tokens) {
        if (t.type === 'entity' && t.scoped) {
            covered.push({ pos: t.pos, end: t.end - t.content.length - 1 }); // header up to the brace
            covered.push({ pos: t.end - 1, end: t.end });                   // the closing brace
        } else if (t.type !== 'entity_close') {
            covered.push({ pos: t.pos, end: t.end });
        }
    }
    covered.sort((a, b) => a.pos - b.pos);

    // Blank out covered ranges (same length, so offsets stay valid), then the
    // exclusions, then scan what is left.
    let prose = markdown;
    const blank = (from, to) => { prose = prose.slice(0, from) + ' '.repeat(to - from) + prose.slice(to); };
    for (const c of covered) blank(c.pos, c.end);
    for (const re of [/^[ \t]*\d+[.)][ \t]/gm, /\bFY ?(?:19|20)\d{2}\b/g, /\bQ[1-4] ?(?:19|20)\d{2}\b/g, /\b(?:19|20)\d{2}\b/g]) {
        for (const m of prose.matchAll(re)) blank(m.index, m.index + m[0].length);
    }
    const out = [];
    for (const m of prose.matchAll(/(?<![A-Za-z0-9.,])\d+(?:[.,]\d+)*(?![A-Za-z0-9])/g)) {
        out.push({ value: m[0], pos: m.index, end: m.index + m[0].length });
    }
    return out;
}

/**
 * Remove ProveML syntax while preserving the visible text content.
 * This strips only the ProveML layer; ordinary markdown remains unchanged.
 * @param {string} markdown - Raw ProveML-annotated markdown
 * @returns {string}
 */
export function stripProveml(markdown) {
    const tokens = tokenizeProveml(markdown);
    let output = '';
    let cursor = 0;

    for (const token of tokens) {
        if (token.pos < cursor) continue;
        output += markdown.slice(cursor, token.pos);

        if (token.type === 'entity') {
            output += token.scoped ? stripProveml(token.content) : token.name;
        } else if (token.type === 'fact') {
            output += token.value;
        } else if (token.type === 'inference') {
            output += token.text;
        }

        cursor = token.end;
    }

    output += markdown.slice(cursor);
    return output;
}

/**
 * Where a construct cannot start. Returns the position to resume scanning at,
 * or -1 if `pos` is ordinary text.
 *
 * - `\x` escapes the next character (CommonMark escapes any punctuation).
 * - A fenced code block (three or more backticks or tildes at the start of a
 *   line, at most three spaces in) runs to the matching closing fence.
 * - A code span (a run of n backticks) runs to the next run of exactly n.
 */
function codeSkip(src, pos) {
    const ch = src[pos];
    if (ch === '\\') return Math.min(pos + 2, src.length);
    if (ch !== '`' && ch !== '~') return -1;

    let run = pos;
    while (src[run] === ch) run++;
    const n = run - pos;

    const lineStart = src.lastIndexOf('\n', pos - 1) + 1;
    const atLineStart = /^ {0,3}$/.test(src.slice(lineStart, pos));
    if (atLineStart && n >= 3) {
        const closing = new RegExp(`^ {0,3}[${ch}]{${n},}[ \\t]*$`);
        let lineEnd = src.indexOf('\n', run);
        if (lineEnd === -1) return src.length;
        let p = lineEnd + 1;
        while (p < src.length) {
            const nl = src.indexOf('\n', p);
            const line = src.slice(p, nl === -1 ? src.length : nl);
            if (closing.test(line)) return nl === -1 ? src.length : nl + 1;
            if (nl === -1) break;
            p = nl + 1;
        }
        return src.length;
    }

    if (ch === '`') {
        let p = run;
        while (p < src.length) {
            const q = src.indexOf('`', p);
            if (q === -1) break;
            let r = q;
            while (src[r] === '`') r++;
            if (r - q === n) return r;
            p = r;
        }
        return run; // unmatched: literal backticks
    }

    return -1;
}

/**
 * Tokenize ProveML constructs from raw markdown.
 * Uses brace-depth counting for scoped entities.
 * @param {Array} [skipped]  if given, receives the {pos,end} ranges the
 *   tokenizer passed over as code or escapes, so a caller can tell prose
 *   from code without re-parsing.
 */
export function tokenizeProveml(src, baseOffset = 0, skipped = null) {
    const tokens = [];
    let pos = 0;

    while (pos < src.length) {
        const skip = codeSkip(src, pos);
        if (skip !== -1) {
            if (skipped) skipped.push({ pos: baseOffset + pos, end: baseOffset + skip });
            pos = skip;
            continue;
        }

        // Entity: @[type:id]{...} or @[type:id "name"]{...}
        if (src[pos] === '@' && src[pos + 1] === '[') {
            const bracketClose = src.indexOf(']', pos + 2);
            if (bracketClose === -1) { pos++; continue; }
            if (src[bracketClose + 1] !== '{') { pos++; continue; }

            const spec = src.slice(pos + 2, bracketClose);
            const colonIdx = spec.indexOf(':');
            if (colonIdx === -1) { pos++; continue; }

            const quoteIdx = spec.indexOf(' "');
            const entityType = spec.slice(0, colonIdx);
            const entityId = spec.slice(colonIdx + 1, quoteIdx !== -1 ? quoteIdx : undefined).trim();
            const quotedName = quoteIdx !== -1
                ? spec.slice(quoteIdx + 2, spec.lastIndexOf('"'))
                : null;
            const scoped = quotedName !== null;

            // Find matching brace with depth counting
            const braceOpen = bracketClose + 1;
            let braceClose = -1;
            let depth = 1;
            for (let p = braceOpen + 1; p < src.length && depth > 0; p++) {
                if (src[p] === '{') depth++;
                else if (src[p] === '}') { depth--; if (depth === 0) braceClose = p; }
            }
            if (braceClose === -1) { pos++; continue; }

            const content = src.slice(braceOpen + 1, braceClose);
            const name = scoped ? quotedName : content;

            tokens.push({
                type: 'entity',
                entityType,
                entityId,
                name,
                scoped,
                pos: baseOffset + pos,
                end: baseOffset + braceClose + 1,
                content,
            });

            if (scoped) {
                // Recursively tokenize the content inside braces
                const innerTokens = tokenizeProveml(content, baseOffset + braceOpen + 1, skipped);
                tokens.push(...innerTokens);
                tokens.push({ type: 'entity_close', pos: baseOffset + braceClose, end: baseOffset + braceClose + 1 });
            }

            pos = braceClose + 1;
            continue;
        }

        // Fact: %[field]{value}
        if (src[pos] === '%' && src[pos + 1] === '[') {
            const bracketClose = src.indexOf(']', pos + 2);
            if (bracketClose === -1) { pos++; continue; }
            if (src[bracketClose + 1] !== '{') { pos++; continue; }
            const braceClose = src.indexOf('}', bracketClose + 2);
            if (braceClose === -1) { pos++; continue; }

            const field = src.slice(pos + 2, bracketClose);
            const value = src.slice(bracketClose + 2, braceClose);
            tokens.push({ type: 'fact', field, value, pos: baseOffset + pos, end: baseOffset + braceClose + 1 });
            pos = braceClose + 1;
            continue;
        }

        // Inference: ?[label: condition]{text}
        if (src[pos] === '?' && src[pos + 1] === '[') {
            const bracketClose = src.indexOf(']', pos + 2);
            if (bracketClose === -1) { pos++; continue; }
            if (src[bracketClose + 1] !== '{') { pos++; continue; }
            const braceClose = src.indexOf('}', bracketClose + 2);
            if (braceClose === -1) { pos++; continue; }

            const inner = src.slice(pos + 2, bracketClose);
            const colonIdx = inner.indexOf(':');
            if (colonIdx === -1) { pos++; continue; }

            const label = inner.slice(0, colonIdx).trim();
            const condition = inner.slice(colonIdx + 1).trim();
            const text = src.slice(bracketClose + 2, braceClose);
            tokens.push({ type: 'inference', label, condition, text, pos: baseOffset + pos, end: baseOffset + braceClose + 1 });
            pos = braceClose + 1;
            continue;
        }

        pos++;
    }

    return tokens;
}
