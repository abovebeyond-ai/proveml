/**
 * ProveML — markdown-it plugin
 *
 * Syntax:
 *   @[entity:id]{display text}  — declares an entity context
 *   %[field]{value}             — a verifiable fact (resolved against current entity)
 *   ?[label: CONDITION]{text}   — a judgment against the threshold registry
 *
 * Scoping rules (identical to verify.js; both judge through core.js):
 *   - @[...] sets the current entity context
 *   - %[...] verifies against the current entity
 *   - Entity context carries across paragraph boundaries
 *   - A scoped entity @[type:id "Name"]{...} binds only inside its braces and
 *     restores the context in force when it opened, null included
 *
 * The plugin only tokenizes; every verdict comes from core.js. The status
 * strings in env.proveml are the verifier's vocabulary (see core.js); the
 * class names on the spans are the renderer's mapping of them.
 */

import { thresholds } from './thresholds.js';
import { toTrustAdapter } from './trust-adapter.js';
import { assertRegistry, checkEntity, checkFact, evaluateCondition } from './core.js';

// Status-based colors (not entity-identity)
const STATUS_COLORS = {
    verified: '#0d9488',          // teal
    'value-mismatch': '#dc2626',  // red
    'name-mismatch': '#dc2626',   // red
    failed: '#dc2626',            // red
    'field-not-found': '#d97706', // amber
    'entity-not-found': '#d97706',// amber
    'no-context': '#d97706',      // amber
    unverifiable: '#d97706',      // amber
    default: '#6b7280',           // gray
};
const ENTITY_COLOR = '#6b7280';
const INFERENCE_COLOR = '#a78bfa';

const ENTITY_CLASS = {
    verified: 'proveml-verified',
    'name-mismatch': 'proveml-name-mismatch',
    'entity-not-found': 'proveml-unverifiable',
};
const FACT_CLASS = {
    verified: 'proveml-verified',
    'value-mismatch': 'proveml-mismatch',
    'no-context': 'proveml-no-context',
    'field-not-found': 'proveml-unverifiable',
};
const INFERENCE_CLASS = {
    verified: 'proveml-verified',
    unverifiable: 'proveml-unverifiable',
    failed: 'proveml-failed',
};

function trustClassNames(trustFields) {
    return trustFields?.trustStatus ? ` proveml-trust-${trustFields.trustStatus}` : '';
}

function applyTrustAttrs(token, trustFields) {
    if (!trustFields?.trustStatus) return;
    token.attrSet('data-trust-status', trustFields.trustStatus);
    if (trustFields.trustBackend) token.attrSet('data-trust-backend', trustFields.trustBackend);
    if (trustFields.trustProofRef) token.attrSet('data-trust-proof-ref', trustFields.trustProofRef);
    if (trustFields.trustIssuer) token.attrSet('data-trust-issuer', trustFields.trustIssuer);
    if (trustFields.trustCheckedAt) token.attrSet('data-trust-checked-at', trustFields.trustCheckedAt);
}

export default function provemlPlugin(md, options = {}) {
    const adapter = toTrustAdapter(options.factStore || {});
    // The registry for this document. Same contract as verifyProveml: given a
    // custom registry, the built-in example vocabulary is out of the language.
    const registry = assertRegistry(options.thresholds || thresholds);

    // State is stored in env (per-render), not module-level
    function getEnv(state) {
        if (!state.env._proveml) {
            state.env._proveml = {
                currentEntity: null,
                entityStack: [],  // contexts in force when each open scope started
                inferenceLabels: {},
                verification: { entities: [], facts: [], total: 0, verified: 0 }
            };
            state.env.proveml = state.env._proveml.verification;
        }
        return state.env._proveml;
    }

    // Core rule: make sure env.proveml exists even for a document without constructs
    md.core.ruler.push('proveml_init', function (state) {
        getEnv(state);
    });

    // markdown-it's text rule already stops at @ and %, but not at ?. Without
    // this, "?[" in the middle of a text run is swallowed before our rule sees it.
    md.inline.ruler.at('text', function text(state, silent) {
        const terminatorChars = new Set([
            0x0A, 0x21, 0x23, 0x24, 0x25, 0x26, 0x2A, 0x2B, 0x2D,
            0x3A, 0x3C, 0x3E, 0x3F, 0x40, 0x5B, 0x5C, 0x5D, 0x5E,
            0x5F, 0x60, 0x7B, 0x7D, 0x7E
        ]);
        let pos = state.pos;
        while (pos < state.posMax && !terminatorChars.has(state.src.charCodeAt(pos))) {
            pos++;
        }
        if (pos === state.pos) return false;
        if (!silent) state.pending += state.src.slice(state.pos, pos);
        state.pos = pos;
        return true;
    });

    // ── Entity reference: @[entity:id]{display text} ──
    md.inline.ruler.push('proveml_entity', function (state, silent) {
        const src = state.src;
        const start = state.pos;

        if (src.charCodeAt(start) !== 0x40 /* @ */) return false;
        if (start + 1 >= state.posMax || src.charCodeAt(start + 1) !== 0x5B /* [ */) return false;

        const bracketClose = src.indexOf(']', start + 2);
        if (bracketClose === -1 || bracketClose >= state.posMax) return false;

        if (bracketClose + 1 >= state.posMax || src.charCodeAt(bracketClose + 1) !== 0x7B /* { */) return false;

        // Brace-depth counting to find matching }
        const braceOpen = bracketClose + 1;
        let braceClose = -1;
        let depth = 1;
        for (let p = braceOpen + 1; p < state.posMax && depth > 0; p++) {
            if (src.charCodeAt(p) === 0x7B /* { */) depth++;
            else if (src.charCodeAt(p) === 0x7D /* } */) { depth--; if (depth === 0) braceClose = p; }
        }
        if (braceClose === -1) return false;

        // Parse entity spec: "type:id" or "type:id "name""
        const entitySpec = src.slice(start + 2, bracketClose);
        const colonIdx = entitySpec.indexOf(':');
        if (colonIdx === -1) return false;

        const quoteIdx = entitySpec.indexOf(' "');
        const entityType = entitySpec.slice(0, colonIdx);
        const entityId = entitySpec.slice(colonIdx + 1, quoteIdx !== -1 ? quoteIdx : undefined).trim();
        const quotedName = quoteIdx !== -1
            ? entitySpec.slice(quoteIdx + 2, entitySpec.lastIndexOf('"'))
            : null;

        const displayText = src.slice(bracketClose + 2, braceClose);
        const isScoped = quotedName !== null;

        // The name to verify: quoted name (scoped form) or display text (simple form)
        const verifyName = isScoped ? quotedName : displayText;

        if (silent) return true;

        const entityPath = `${entityType}:${entityId}`;
        const env = getEnv(state);

        // Scoped form: remember what was in force (null included) so the close
        // can restore it. Simple form: linear carry-forward.
        if (isScoped) env.entityStack.push(env.currentEntity);
        env.currentEntity = { type: entityType, id: entityId, path: entityPath };

        const check = checkEntity(adapter, entityPath, verifyName);
        const nameMatch = check.status === 'verified';
        const entityVerified = check.status !== 'entity-not-found';
        const storeName = nameMatch ? verifyName : check.expected;

        env.verification.entities.push({
            path: entityPath,
            displayText: verifyName,
            verified: entityVerified,
            nameMatch,
            color: ENTITY_COLOR,
            ...check
        });
        env.verification.total++;
        if (nameMatch) env.verification.verified++;

        const tokenOpen = state.push('proveml_entity_open', 'span', 1);
        tokenOpen.attrSet('class', `proveml-entity ${ENTITY_CLASS[check.status]}${trustClassNames(check)}`);
        tokenOpen.attrSet('data-entity-type', entityType);
        tokenOpen.attrSet('data-entity-id', entityId);
        tokenOpen.attrSet('data-entity-path', entityPath);
        tokenOpen.attrSet('data-verified', String(nameMatch));
        tokenOpen.attrSet('data-status', check.status);
        tokenOpen.attrSet('data-store-name', storeName != null ? String(storeName) : '');
        tokenOpen.attrSet('style', `--entity-color: ${ENTITY_COLOR}`);
        applyTrustAttrs(tokenOpen, check);
        tokenOpen.meta = { entityType, entityId, displayText: verifyName, color: ENTITY_COLOR, isScoped, status: check.status };

        if (isScoped) {
            // Scoped form: parse the brace content as inline tokens (facts bind here)
            const innerTokens = [];
            state.md.inline.parse(displayText, state.md, state.env, innerTokens);
            for (const t of innerTokens) {
                state.tokens.push(t);
            }
            // Scope closes: restore the context in force when it opened.
            env.currentEntity = env.entityStack.pop();
        } else {
            // Simple form: display text is just the name
            const tokenText = state.push('text', '', 0);
            tokenText.content = displayText;
        }

        state.push('proveml_entity_close', 'span', -1);

        state.pos = braceClose + 1;
        return true;
    });

    // ── Fact reference: %[field]{value} ──
    md.inline.ruler.push('proveml_fact', function (state, silent) {
        const src = state.src;
        const start = state.pos;

        if (src.charCodeAt(start) !== 0x25 /* % */) return false;
        if (start + 1 >= state.posMax || src.charCodeAt(start + 1) !== 0x5B /* [ */) return false;

        const bracketClose = src.indexOf(']', start + 2);
        if (bracketClose === -1 || bracketClose >= state.posMax) return false;

        if (bracketClose + 1 >= state.posMax || src.charCodeAt(bracketClose + 1) !== 0x7B /* { */) return false;

        const braceClose = src.indexOf('}', bracketClose + 2);
        if (braceClose === -1 || braceClose > state.posMax) return false;

        const field = src.slice(start + 2, bracketClose);
        const value = src.slice(bracketClose + 2, braceClose);

        if (silent) return true;

        const env = getEnv(state);
        const entityPath = env.currentEntity?.path || null;
        const check = checkFact(adapter, entityPath, field, value);
        const path = check.path || field;
        const statusColor = STATUS_COLORS[check.status] || STATUS_COLORS.default;

        env.verification.facts.push({
            field,
            value,
            entityPath,
            path,
            actual: check.expected ?? null,
            ...check
        });
        env.verification.total++;
        if (check.status === 'verified') env.verification.verified++;

        const tokenOpen = state.push('proveml_fact_open', 'span', 1);
        tokenOpen.attrSet('class', `proveml-fact ${FACT_CLASS[check.status]}${trustClassNames(check)}`);
        tokenOpen.attrSet('data-field', field);
        tokenOpen.attrSet('data-value', value);
        tokenOpen.attrSet('data-path', path);
        tokenOpen.attrSet('data-verified', check.status);
        tokenOpen.attrSet('data-actual', check.expected != null ? String(check.expected) : '');
        tokenOpen.attrSet('data-entity', entityPath || '');
        tokenOpen.attrSet('style', `--entity-color: ${statusColor}`);
        // No title attr — custom tooltip via JS
        applyTrustAttrs(tokenOpen, check);
        tokenOpen.meta = { field, value, verification: { ...check, path }, statusColor };

        const tokenText = state.push('text', '', 0);
        tokenText.content = value;

        state.push('proveml_fact_close', 'span', -1);

        state.pos = braceClose + 1;
        return true;
    });

    // ── Inference: ?[label: condition]{display text} ──
    // Conditions: THRESHOLD, THRESHOLD(path), @label, AND, OR, NOT
    md.inline.ruler.push('proveml_inference', function (state, silent) {
        const src = state.src;
        const start = state.pos;

        if (src.charCodeAt(start) !== 0x3F /* ? */) return false;
        if (start + 1 >= state.posMax || src.charCodeAt(start + 1) !== 0x5B /* [ */) return false;

        const bracketClose = src.indexOf(']', start + 2);
        if (bracketClose === -1 || bracketClose >= state.posMax) return false;

        // Display text in braces is required, matching the grammar and the
        // standalone verifier (a braceless ?[label: COND] is not a construct)
        if (bracketClose + 1 >= state.posMax || src.charCodeAt(bracketClose + 1) !== 0x7B) return false;
        const braceClose = src.indexOf('}', bracketClose + 2);
        if (braceClose === -1 || braceClose > state.posMax) return false;
        const displayText = src.slice(bracketClose + 2, braceClose);

        const inner = src.slice(start + 2, bracketClose);
        const colonIdx = inner.indexOf(':');
        if (colonIdx === -1) return false;

        const label = inner.slice(0, colonIdx).trim();
        const condition = inner.slice(colonIdx + 1).trim();

        if (silent) return true;

        const env = getEnv(state);
        const entityPath = env.currentEntity?.path || null;
        const result = evaluateCondition(condition, entityPath, adapter, env.inferenceLabels, registry);
        env.inferenceLabels[label] = result;
        const status = result.verified ? 'verified' : result.unknown ? 'unverifiable' : 'failed';

        env.verification.facts.push({
            field: `inference:${label}`,
            value: condition,
            entityPath,
            status,
            path: `inference:${label}`,
            actual: result.explanation || result.error,
            ...(result.error ? { error: result.error } : {}),
            ...(result.unknown ? { unknown: true } : {}),
            inferenceResult: result
        });
        env.verification.total++;
        if (result.verified) env.verification.verified++;

        const tokenOpen = state.push('proveml_inference_open', 'span', 1);
        tokenOpen.attrSet('class', `proveml-inference ${INFERENCE_CLASS[status]}${trustClassNames(result)}`);
        tokenOpen.attrSet('data-label', label);
        tokenOpen.attrSet('data-condition', condition);
        tokenOpen.attrSet('data-verified', String(result.verified || false));
        tokenOpen.attrSet('data-status', status);
        tokenOpen.attrSet('data-explanation', result.explanation || result.error || '');
        tokenOpen.attrSet('data-source', result.source || '');
        tokenOpen.attrSet('style', `--entity-color: ${INFERENCE_COLOR}`);
        applyTrustAttrs(tokenOpen, result);
        tokenOpen.meta = { label, condition, result, status, type: 'inference' };

        const tokenText = state.push('text', '', 0);
        tokenText.content = displayText || label;

        state.push('proveml_inference_close', 'span', -1);

        state.pos = braceClose + 1;
        return true;
    });
}
