/**
 * ProveML Standalone Verifier
 *
 * Single authoritative verification implementation. Used by:
 *   - server.js (API runtime)
 *   - generate-reports.js (batch generation)
 *   - skills-server.js (MCP tools)
 *   - plugin.js (markdown-it rendering — delegates to this for verification logic)
 *
 * Supports: simple entities, scoped entities, nested scope, linear carry-forward,
 * facts, inferences with threshold evaluation and AND/OR/NOT.
 */

import { evaluateThreshold, thresholds } from './thresholds.js';
import {
    getExpectedSurfaceValue,
    getTrustFields,
    toTrustAdapter
} from './trust-adapter.js';

const TRUST_STATUS_PRIORITY = {
    verified: 0,
    unverified: 1,
    expired: 2,
    revoked: 3,
    error: 4
};

function mergeTrustFields(results) {
    const trustResults = results.filter(result => result?.trustStatus);
    if (trustResults.length === 0) return {};

    const chosen = trustResults.reduce((worst, current) => {
        const currentPriority = TRUST_STATUS_PRIORITY[current.trustStatus] ?? -1;
        const worstPriority = TRUST_STATUS_PRIORITY[worst.trustStatus] ?? -1;
        return currentPriority > worstPriority ? current : worst;
    });

    const uniqueBackends = [...new Set(trustResults.map(result => result.trustBackend).filter(Boolean))];
    const merged = {
        trustStatus: chosen.trustStatus,
        ...(uniqueBackends.length === 1 ? { trustBackend: uniqueBackends[0] } : {})
    };

    if (trustResults.length === 1) {
        if (chosen.trustProofRef) merged.trustProofRef = chosen.trustProofRef;
        if (chosen.trustIssuer) merged.trustIssuer = chosen.trustIssuer;
        if (chosen.trustCheckedAt) merged.trustCheckedAt = chosen.trustCheckedAt;
    }

    return merged;
}

/**
 * Verify all ProveML constructs in a markdown string.
 * @param {string} markdown - Raw ProveML-annotated markdown
 * @param {object} factStoreOrAdapter - Flat key-value store or trust adapter
 * @param {object} [options] - Optional: { snapshot: string }
 * @returns {{ total, verified, errors: string[], details: object[], snapshot?: string }}
 */
export function verifyProveml(markdown, factStoreOrAdapter, options) {
    const adapter = toTrustAdapter(factStoreOrAdapter);
    const results = { total: 0, verified: 0, errors: [], details: [] };
    if (options?.snapshot) results.snapshot = options.snapshot;
    const inferLabels = {};

    // Tokenize: extract all ProveML constructs with positions
    const tokens = tokenizeProveml(markdown);

    // Build scope tree and resolve entity bindings
    let entityStack = [];
    let currentEntity = null;

    for (const tok of tokens) {
        if (tok.type === 'entity') {
            const path = `${tok.entityType}:${tok.entityId}`;
            const nameResolution = adapter.resolve(`${path}.name`);
            const nameInStore = nameResolution.value;
            const nameMatch = nameResolution.found && String(nameInStore) === String(tok.name);

            results.total++;
            if (nameMatch) {
                results.verified++;
                results.details.push({
                    type: 'entity',
                    path,
                    name: tok.name,
                    status: 'verified',
                    pos: tok.pos, end: tok.end,
                    ...getTrustFields(nameResolution)
                });
            } else if (!nameResolution.found) {
                const msg = `@[${path}]: not found`;
                results.errors.push(msg);
                results.details.push({ type: 'entity', path, name: tok.name, status: 'entity-not-found', errorClass: 'reference', pos: tok.pos, end: tok.end });
            } else {
                const msg = `@[${path}]{${tok.name}}: name is "${nameInStore}"`;
                results.errors.push(msg);
                results.details.push({
                    type: 'entity',
                    path,
                    name: tok.name,
                    status: 'name-mismatch',
                    pos: tok.pos, end: tok.end,
                    expected: nameInStore,
                    errorClass: 'reference',
                    ...getTrustFields(nameResolution)
                });
            }

            if (tok.scoped) {
                // Push current onto stack, enter scope
                if (currentEntity) entityStack.push(currentEntity);
                currentEntity = path;
            } else {
                // Simple form: linear carry-forward
                currentEntity = path;
            }
        } else if (tok.type === 'entity_close') {
            // Scope closes: restore outer context if nested, else keep for carry-forward
            if (entityStack.length > 0) {
                currentEntity = entityStack.pop();
            }
            // else: currentEntity stays (linear carry-forward)
        } else if (tok.type === 'fact') {
            results.total++;
            if (!currentEntity) {
                results.errors.push(`%[${tok.field}]{${tok.value}}: no entity context`);
                results.details.push({ type: 'fact', field: tok.field, value: tok.value, status: 'no-context', errorClass: 'context', pos: tok.pos, end: tok.end });
                continue;
            }
            const storePath = `${currentEntity}.${tok.field}`;
            const resolution = adapter.resolve(storePath);
            const expected = getExpectedSurfaceValue(resolution);
            if (resolution.found && String(tok.value) === String(expected)) {
                results.verified++;
                results.details.push({
                    type: 'fact',
                    path: storePath,
                    value: tok.value,
                    status: 'verified',
                    pos: tok.pos, end: tok.end,
                    ...getTrustFields(resolution)
                });
            } else if (!resolution.found) {
                const msg = `%[${tok.field}]{${tok.value}} in ${currentEntity}: field not found`;
                results.errors.push(msg);
                results.details.push({ type: 'fact', path: storePath, value: tok.value, status: 'field-not-found', errorClass: 'reference', pos: tok.pos, end: tok.end });
            } else {
                const msg = `%[${tok.field}]{${tok.value}} in ${currentEntity}: should be ${expected}`;
                results.errors.push(msg);
                results.details.push({
                    type: 'fact',
                    path: storePath,
                    value: tok.value,
                    status: 'value-mismatch',
                    pos: tok.pos, end: tok.end,
                    expected,
                    errorClass: 'value',
                    ...getTrustFields(resolution)
                });
            }
        } else if (tok.type === 'inference') {
            results.total++;
            const result = evaluateCondition(tok.condition, currentEntity, adapter, inferLabels);
            inferLabels[tok.label] = result;
            if (result.verified) {
                results.verified++;
                results.details.push({
                    type: 'inference',
                    label: tok.label,
                    status: 'verified',
                    pos: tok.pos, end: tok.end,
                    ...mergeTrustFields([result])
                });
            } else {
                const msg = `?[${tok.label}: ${tok.condition}]: ${result.error || 'condition false'}`;
                results.errors.push(msg);
                results.details.push({
                    type: 'inference',
                    label: tok.label,
                    status: 'failed',
                    pos: tok.pos, end: tok.end,
                    error: result.error,
                    ...mergeTrustFields([result])
                });
            }
        }
    }

    return results;
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
 * Tokenize ProveML constructs from raw markdown.
 * Uses brace-depth counting for scoped entities.
 */
export function tokenizeProveml(src, baseOffset = 0) {
    const tokens = [];
    let pos = 0;

    while (pos < src.length) {
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
                const innerTokens = tokenizeProveml(content, baseOffset + braceOpen + 1);
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

/**
 * Evaluate an inference condition against the fact store and threshold registry.
 *
 * Evaluation is three-valued. A condition that cannot be resolved — an unknown
 * threshold, a missing operand, a label that was never defined — is UNKNOWN, not
 * false. The distinction matters at exactly one place: NOT. Treating unresolvable
 * as false let `NOT @nonexistent` come back verified, which would report a claim
 * as proven on the strength of a threshold nobody defined.
 */
function evaluateCondition(condition, entityPath, adapter, labels) {
    condition = condition.trim();

    // OR (lower precedence — checked first). True beats unknown; otherwise an
    // unresolvable operand makes the whole disjunction unresolvable.
    if (condition.includes(' OR ')) {
        const parts = condition.split(' OR ').map(p => p.trim());
        const results = parts.map(p => evaluateCondition(p, entityPath, adapter, labels));
        const unknown = results.some(r => r.unknown) && !results.some(r => r.verified);
        return {
            verified: !unknown && results.some(r => r.verified),
            ...(unknown ? { unknown: true, error: results.find(r => r.unknown).error } : {}),
            explanation: results.map(r => r.explanation || r.error).join(' ∨ '),
            ...mergeTrustFields(results)
        };
    }

    // AND (higher precedence). False beats unknown; otherwise unknown wins.
    if (condition.includes(' AND ')) {
        const parts = condition.split(' AND ').map(p => p.trim());
        const results = parts.map(p => evaluateCondition(p, entityPath, adapter, labels));
        const decidedFalse = results.some(r => !r.verified && !r.unknown);
        const unknown = !decidedFalse && results.some(r => r.unknown);
        return {
            verified: !unknown && results.every(r => r.verified),
            ...(unknown ? { unknown: true, error: results.find(r => r.unknown).error } : {}),
            explanation: results.map(r => r.explanation || r.error).join(' ∧ '),
            ...mergeTrustFields(results)
        };
    }

    // NOT. Negating an unresolvable condition leaves it unresolvable.
    if (condition.startsWith('NOT ')) {
        const inner = evaluateCondition(condition.slice(4), entityPath, adapter, labels);
        if (inner.unknown) {
            return { verified: false, unknown: true, error: inner.error,
                explanation: `¬(${inner.explanation || inner.error})`, ...mergeTrustFields([inner]) };
        }
        return {
            verified: !inner.verified,
            explanation: `¬(${inner.explanation})`,
            ...mergeTrustFields([inner])
        };
    }

    // Label reference: @label
    if (condition.startsWith('@')) {
        const refLabel = condition.slice(1);
        const ref = labels[refLabel];
        if (!ref) return { verified: false, unknown: true, error: `Label "${refLabel}" not found` };
        return {
            verified: ref.verified,
            explanation: `@${refLabel} = ${ref.verified}`,
            ...mergeTrustFields([ref])
        };
    }

    // Threshold: NAME or NAME(path)
    const thresholdMatch = condition.match(/^([A-Z_]+)(?:\(([^)]+)\))?$/);
    if (thresholdMatch) {
        const tName = thresholdMatch[1];
        const t = thresholds[tName];
        if (!t) return { verified: false, unknown: true, error: `Unknown threshold: ${tName}` };

        let actualValue;
        let fieldPath;
        if (thresholdMatch[2]) {
            fieldPath = thresholdMatch[2];
            actualValue = adapter.resolve(fieldPath).value;
        } else if (entityPath) {
            fieldPath = `${entityPath}.${t.field}`;
            actualValue = adapter.resolve(fieldPath).value;
        }

        // No entity context and no explicit path: nothing is addressable,
        // so no threshold (including is_null) can evaluate.
        if (!fieldPath) return { verified: false, unknown: true, error: `No entity context for threshold ${tName}` };

        const resolution = adapter.resolve(fieldPath);
        actualValue = resolution.value;

        if (actualValue === undefined && t.op !== 'is_null') return { verified: false, unknown: true, error: `No value for ${t.field}` };

        // Unit check: if threshold declares a unit, the fact store must declare a matching unit
        if (t.unit && fieldPath) {
            const storeUnit = resolution.unit;
            if (storeUnit == null) {
                return { verified: false, unknown: true, error: `Threshold expects unit ${t.unit}, but field has no unit` };
            }
            if (String(storeUnit) !== String(t.unit)) {
                return { verified: false, unknown: true, error: `Unit mismatch: threshold expects ${t.unit}, data has ${storeUnit}` };
            }
        }

        const result = evaluateThreshold(tName, actualValue);
        if (!result.valid) {
            return { verified: false, unknown: true, error: result.error,
                explanation: result.error, ...getTrustFields(resolution) };
        }
        return {
            verified: result.result,
            explanation: result.explanation,
            source: result.source,
            ...getTrustFields(resolution)
        };
    }

    // Bare comparison: reject
    if (/[><=!]/.test(condition)) {
        return { verified: false, unknown: true, error: `Direct comparison not allowed: use a threshold from the registry` };
    }

    return { verified: false, unknown: true, error: `Unknown condition: ${condition}` };
}
