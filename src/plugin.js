/**
 * ProveML — markdown-it plugin
 *
 * Syntax:
 *   @[entity:id]{display text}  — declares an entity context
 *   %[field]{value}             — a verifiable fact (resolved against current entity)
 *
 * Scoping rules:
 *   - @[...] sets the current entity context
 *   - %[...] verifies against the current entity
 *   - Entity context carries across paragraph boundaries
 *   - Multiple @[...] in one paragraph: each %[...] belongs to the nearest preceding @[...]
 *
 * Entity colors cycle: entities get assigned colors in order of appearance.
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

// Status-based colors (not entity-identity)
const STATUS_COLORS = {
    verified: '#0d9488',    // teal
    mismatch: '#dc2626',    // red
    unverifiable: '#d97706', // amber
    'no-context': '#d97706', // amber
    'name-mismatch': '#dc2626', // red
    'field-not-found': '#d97706', // amber
    default: '#6b7280',     // gray
};
// Keep entity colors for backward compat but use a single neutral color
const ENTITY_COLORS = ['#6b7280'];

export default function provemlPlugin(md, options = {}) {
    const adapter = toTrustAdapter(options.factStore || {});
    // The registry for this document. Same contract as verifyProveml: given a
    // custom registry, the built-in example vocabulary is out of the language.
    const registry = options.thresholds || thresholds;
    // State is stored in env (per-render), not module-level
    function getEnv(state) {
        if (!state.env._proveml) {
            state.env._proveml = {
                entityColorMap: {},
                entityColorIdx: 0,
                currentEntity: null,
                entityStack: [],  // for lexical scoping in scoped form
                verification: { entities: [], facts: [], total: 0, verified: 0 }
            };
            state.env.proveml = state.env._proveml.verification;
        }
        return state.env._proveml;
    }

    function getEntityColor(env, entityKey) {
        if (!env.entityColorMap[entityKey]) {
            env.entityColorMap[entityKey] = ENTITY_COLORS[env.entityColorIdx % ENTITY_COLORS.length];
            env.entityColorIdx++;
        }
        return env.entityColorMap[entityKey];
    }

    function verifyFact(entityPath, field, value) {
        const path = `${entityPath}.${field}`;
        const resolution = adapter.resolve(path);
        if (!resolution.found) return { status: 'unverifiable', actual: null, path };

        const expected = getExpectedSurfaceValue(resolution);
        if (String(value) === expected) {
            return { status: 'verified', actual: resolution.value, path, ...getTrustFields(resolution) };
        }

        return { status: 'mismatch', actual: expected, path, ...getTrustFields(resolution) };
    }

    // Core rule: initialize env and reset entity context per paragraph
    md.core.ruler.push('proveml_init', function (state) {
        const env = getEnv(state);
        // Reset entity context for each inline token (= each paragraph)
        // We mark it so the inline rules know to reset
        let lastParagraph = -1;
        for (let i = 0; i < state.tokens.length; i++) {
            if (state.tokens[i].type === 'paragraph_open') lastParagraph = i;
            if (state.tokens[i].type === 'inline') {
                state.tokens[i].meta = { ...state.tokens[i].meta, _provemlNewParagraph: true };
            }
        }
    });

    // Tell markdown-it that @, %, ? are special characters (not consumed by text rule)
    // This makes the inline tokenizer try our rules when it encounters these chars
    md.inline.ruler.at('text', function text(state, silent) {
        // Copy of default text rule but with @, %, ? added as terminators
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

    // No automatic entity reset — context carries until a new @[entity] appears.
    // This works for tables (entity in first cell, facts in other cells)
    // and for "Dit valt op" paragraphs that reference the last mentioned entity.
    // The AI should use @[entity] at the start of each new topic.

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
        const color = getEntityColor(env, entityPath);

        // Set current entity context (push previous onto stack for scoped form)
        if (isScoped && env.currentEntity) {
            env.entityStack.push(env.currentEntity);
        }
        env.currentEntity = { type: entityType, id: entityId, path: entityPath };

        // Verify entity name against fact store
        const nameResolution = adapter.resolve(`${entityPath}.name`);
        const nameInStore = nameResolution.value;
        const entityVerified = nameResolution.found;
        const nameMatch = entityVerified && String(nameInStore) === String(verifyName);
        const entityTrust = getTrustFields(nameResolution);

        env.verification.entities.push({
            path: entityPath,
            displayText: verifyName,
            verified: entityVerified,
            nameMatch,
            color,
            ...entityTrust
        });
        env.verification.total++;
        if (entityVerified && nameMatch) env.verification.verified++;

        const tokenOpen = state.push('proveml_entity_open', 'span', 1);
        tokenOpen.attrSet('class', `proveml-entity ${nameMatch ? 'proveml-verified' : entityVerified ? 'proveml-name-mismatch' : 'proveml-unverifiable'}${trustClassNames(entityTrust)}`);
        tokenOpen.attrSet('data-entity-type', entityType);
        tokenOpen.attrSet('data-entity-id', entityId);
        tokenOpen.attrSet('data-entity-path', entityPath);
        tokenOpen.attrSet('data-verified', String(nameMatch));
        tokenOpen.attrSet('data-store-name', nameInStore || '');
        tokenOpen.attrSet('style', `--entity-color: ${color}`);
        applyTrustAttrs(tokenOpen, entityTrust);
        tokenOpen.meta = { entityType, entityId, displayText: verifyName, color, isScoped, ...entityTrust };

        if (isScoped) {
            // Scoped form: parse the brace content as inline tokens (facts bind here)
            const scopeContent = displayText;
            const innerTokens = [];
            state.md.inline.parse(scopeContent, state.md, state.env, innerTokens);
            for (const t of innerTokens) {
                state.tokens.push(t);
            }
            // After scope closes: if there's an outer scope, restore it.
            // If not (top-level), keep the scoped entity as current for linear carry-forward.
            if (env.entityStack.length > 0) {
                env.currentEntity = env.entityStack.pop();
            }
            // else: currentEntity stays as the scoped entity (linear carry-forward)
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

        // Verify against current entity context
        const env = getEnv(state);
        let verification;
        let statusColor = STATUS_COLORS.default;
        if (env.currentEntity) {
            verification = verifyFact(env.currentEntity.path, field, value);
            statusColor = STATUS_COLORS[verification.status] || STATUS_COLORS.default;
        } else {
            verification = { status: 'no-context', actual: null, path: field };
            statusColor = STATUS_COLORS['no-context'];
        }

        env.verification.facts.push({
            field,
            value,
            entityPath: env.currentEntity?.path || null,
            ...verification
        });
        env.verification.total++;
        if (verification.status === 'verified') env.verification.verified++;

        const tokenOpen = state.push('proveml_fact_open', 'span', 1);
        tokenOpen.attrSet('class', `proveml-fact proveml-${verification.status}${trustClassNames(verification)}`);
        tokenOpen.attrSet('data-field', field);
        tokenOpen.attrSet('data-value', value);
        tokenOpen.attrSet('data-path', verification.path);
        tokenOpen.attrSet('data-verified', verification.status);
        tokenOpen.attrSet('data-actual', verification.actual !== null ? String(verification.actual) : '');
        tokenOpen.attrSet('data-entity', env.currentEntity?.path || '');
        tokenOpen.attrSet('style', `--entity-color: ${statusColor}`);
        // No title attr — custom tooltip via JS
        applyTrustAttrs(tokenOpen, verification);
        tokenOpen.meta = { field, value, verification, statusColor };

        const tokenText = state.push('text', '', 0);
        tokenText.content = value;

        state.push('proveml_fact_close', 'span', -1);

        state.pos = braceClose + 1;
        return true;
    });

    // ── Inference: ?[label: condition]{display text} ──
    // Conditions: THRESHOLD(path), @label, @label AND @label, @label OR @label
    md.inline.ruler.push('proveml_inference', function (state, silent) {
        const src = state.src;
        const start = state.pos;

        if (src.charCodeAt(start) !== 0x3F /* ? */) return false;
        if (start + 1 >= state.posMax || src.charCodeAt(start + 1) !== 0x5B /* [ */) return false;

        const bracketClose = src.indexOf(']', start + 2);
        if (bracketClose === -1 || bracketClose >= state.posMax) return false;

        // Display text in braces — required, matching the grammar and the
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

        // Evaluate condition
        const result = evaluateCondition(condition, env, adapter, registry);

        // Store in verification
        env.verification.facts.push({
            field: `inference:${label}`,
            value: condition,
            entityPath: env.currentEntity?.path || null,
            status: result.verified ? 'verified' : result.unknown ? 'unverifiable' : 'mismatch',
            path: `inference:${label}`,
            actual: result.explanation || result.error,
            inferenceResult: result
        });
        env.verification.total++;
        if (result.verified) env.verification.verified++;

        // Store label for reference by other inferences
        if (!env._inferenceLabels) env._inferenceLabels = {};
        env._inferenceLabels[label] = result;

        const entityColor = env.currentEntity ? getEntityColor(env, env.currentEntity.path) : '#a78bfa';

        const tokenOpen = state.push('proveml_inference_open', 'span', 1);
        tokenOpen.attrSet('class', `proveml-inference ${result.verified ? 'proveml-verified' : result.unknown ? 'proveml-unverifiable' : 'proveml-failed'}${trustClassNames(result)}`);
        tokenOpen.attrSet('data-label', label);
        tokenOpen.attrSet('data-condition', condition);
        tokenOpen.attrSet('data-verified', String(result.verified || false));
        tokenOpen.attrSet('data-explanation', result.explanation || result.error || '');
        tokenOpen.attrSet('data-source', result.source || '');
        tokenOpen.attrSet('style', `--entity-color: #a78bfa`);
        applyTrustAttrs(tokenOpen, result);
        tokenOpen.meta = { label, condition, result, type: 'inference' };

        const tokenText = state.push('text', '', 0);
        tokenText.content = displayText || label;

        state.push('proveml_inference_close', 'span', -1);

        state.pos = (braceClose !== -1 ? braceClose : bracketClose) + 1;
        return true;
    });
}

/**
 * Evaluate an inference condition
 * Supports: THRESHOLD_NAME(path), @label, condition AND condition, condition OR condition, NOT condition
 */
function evaluateCondition(condition, env, adapter, registry = thresholds) {
    condition = condition.trim();

    // Three-valued, mirroring verify.js (the normative verifier): a condition
    // that cannot be resolved is UNKNOWN, not false, and NOT propagates unknown
    // instead of negating it — a two-valued reading here rendered
    // `NOT UNDEFINED_THRESHOLD` as verified, the worst thing a renderer can show.

    // OR (lower precedence — checked first so AND binds tighter).
    // True beats unknown; otherwise an unresolvable operand wins.
    if (condition.includes(' OR ')) {
        const parts = condition.split(' OR ').map(p => p.trim());
        const results = parts.map(p => evaluateCondition(p, env, adapter, registry));
        const unknown = results.some(r => r.unknown) && !results.some(r => r.verified);
        return {
            verified: !unknown && results.some(r => r.verified),
            ...(unknown ? { unknown: true, error: results.find(r => r.unknown).error } : {}),
            explanation: results.map(r => r.explanation || r.error).join(' ∨ '),
            source: results.map(r => r.source).filter(Boolean).join(', '),
            ...mergeTrustFields(results)
        };
    }

    // AND (higher precedence). False beats unknown; otherwise unknown wins.
    if (condition.includes(' AND ')) {
        const parts = condition.split(' AND ').map(p => p.trim());
        const results = parts.map(p => evaluateCondition(p, env, adapter, registry));
        const decidedFalse = results.some(r => !r.verified && !r.unknown);
        const unknown = !decidedFalse && results.some(r => r.unknown);
        return {
            verified: !unknown && results.every(r => r.verified),
            ...(unknown ? { unknown: true, error: results.find(r => r.unknown).error } : {}),
            explanation: results.map(r => r.explanation || r.error).join(' ∧ '),
            source: results.map(r => r.source).filter(Boolean).join(', '),
            steps: results,
            ...mergeTrustFields(results)
        };
    }

    // NOT. Negating an unresolvable condition leaves it unresolvable.
    if (condition.startsWith('NOT ')) {
        const inner = evaluateCondition(condition.slice(4), env, adapter, registry);
        if (inner.unknown) {
            return {
                verified: false, unknown: true, error: inner.error,
                explanation: `¬(${inner.explanation || inner.error})`,
                source: inner.source,
                ...mergeTrustFields([inner])
            };
        }
        return {
            verified: !inner.verified,
            explanation: `¬(${inner.explanation})`,
            source: inner.source,
            ...mergeTrustFields([inner])
        };
    }

    // Label reference: @label. As resolved as its target — an unknown target
    // makes the reference unknown, so NOT @a cannot verify via an unresolved a.
    if (condition.startsWith('@')) {
        const refLabel = condition.slice(1);
        const ref = env._inferenceLabels?.[refLabel];
        if (!ref) return { verified: false, unknown: true, error: `Label "${refLabel}" not found` };
        if (ref.unknown) {
            return {
                verified: false, unknown: true,
                error: ref.error || `Label "${refLabel}" is unresolved`,
                explanation: `@${refLabel} = unknown`,
                source: ref.source,
                ...mergeTrustFields([ref])
            };
        }
        return {
            verified: ref.verified,
            explanation: `@${refLabel} = ${ref.verified}`,
            source: ref.source,
            ...mergeTrustFields([ref])
        };
    }

    // Threshold: THRESHOLD_NAME(path) or THRESHOLD_NAME
    const thresholdMatch = condition.match(/^([A-Z_]+)(?:\(([^)]+)\))?$/);
    if (thresholdMatch) {
        const tName = thresholdMatch[1];
        const t = registry[tName];
        if (!t) return { verified: false, unknown: true, error: `Threshold "${tName}" not in registry` };

        // Get the value to check — either from explicit path or current entity
        let actualValue;
        let fieldPath;
        if (thresholdMatch[2]) {
            fieldPath = thresholdMatch[2];
        } else if (env.currentEntity) {
            fieldPath = `${env.currentEntity.path}.${t.field}`;
        }

        // No entity context and no explicit path: nothing is addressable.
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
                return { verified: false, unknown: true, error: `Unit mismatch: ${t.unit} vs ${storeUnit}` };
            }
        }

        const result = evaluateThreshold(tName, actualValue, registry);
        // An invalid evaluation (non-numeric value under an ordering operator,
        // unknown operator) is unresolvable, not false.
        if (!result.valid) {
            return { verified: false, unknown: true, error: result.error, ...getTrustFields(resolution) };
        }
        return {
            verified: result.result,
            explanation: result.explanation,
            source: result.source,
            label: result.label,
            ...getTrustFields(resolution)
        };
    }

    // Direct comparison: path > value or path < value
    const compMatch = condition.match(/^(.+?)\s*(>=|<=|>|<|==|!=)\s*(.+)$/);
    if (compMatch) {
        // Reject bare literal comparisons — must use threshold registry
        return { verified: false, unknown: true, error: `Direct comparisons not allowed — use the threshold registry (${Object.keys(registry).join(', ')})` };
    }

    return { verified: false, unknown: true, error: `Unrecognized condition: ${condition}` };
}
