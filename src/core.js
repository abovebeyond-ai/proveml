/**
 * ProveML core: the one place where a claim is judged.
 *
 * The two entry points tokenize differently, because the standalone verifier
 * sees raw text and the markdown-it plugin sees what the host parser hands it.
 * What they may not do is judge differently. For a while they did: the plugin
 * carried its own copy of the condition evaluator and its own scoping rule, and
 * the two drifted until the same document verified in one and not in the other.
 *
 * So the judgement lives here, once. The status vocabulary below is what the
 * verifier reports; renderers map it to class names, they do not invent their
 * own.
 *
 *   entity:    verified | entity-not-found | name-mismatch
 *   fact:      verified | field-not-found | value-mismatch | no-context
 *   inference: verified | failed | unverifiable
 */

import { evaluateThreshold, thresholds, THRESHOLD_NAME } from './thresholds.js';
import { getExpectedSurfaceValue, getTrustFields } from './trust-adapter.js';

const TRUST_STATUS_PRIORITY = {
    verified: 0,
    unverified: 1,
    expired: 2,
    revoked: 3,
    error: 4
};

/** Combine the trust fields of several results: the weakest status wins. */
export function mergeTrustFields(results) {
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
 * A registry is only usable if every name in it can be written in a condition.
 * A key the condition grammar cannot express (lowercase, leading digit) would
 * be a threshold that exists and can never be reached, and that looks exactly
 * like a registry that works.
 */
export function assertRegistry(registry) {
    for (const [name, t] of Object.entries(registry)) {
        if (!THRESHOLD_NAME.test(name)) {
            throw new Error(`Threshold name "${name}" is not addressable: names are uppercase letters, digits and underscores, starting with a letter`);
        }
        if (!t || typeof t !== 'object' || typeof t.field !== 'string' || typeof t.op !== 'string') {
            throw new Error(`Threshold "${name}" must declare a field and an op`);
        }
    }
    return registry;
}

/** @[type:id]{name}: does the store know this entity under this name? */
export function checkEntity(adapter, path, name) {
    const resolution = adapter.resolve(`${path}.name`);
    if (!resolution.found) return { status: 'entity-not-found', errorClass: 'reference' };
    const expected = resolution.value;
    if (String(expected) === String(name)) {
        return { status: 'verified', ...getTrustFields(resolution) };
    }
    return { status: 'name-mismatch', expected, errorClass: 'reference', ...getTrustFields(resolution) };
}

/** A field that carries its own entity: `student:20414.passRate`. */
const ABSOLUTE_FIELD = /^[A-Za-z_][A-Za-z0-9_]*:[A-Za-z0-9_-]+\./;

/**
 * %[field]{value}: is this the value the store holds?
 *
 * The field resolves against the entity in force, unless it names its own
 * entity (`%[student:20414.passRate]{53}`). The explicit form exists because
 * prose does not always put the subject last: in "Amir of 5OL has a pass rate
 * of 53%" the nearest entity is the class, and linear carry-forward would bind
 * the pupil's rate to it. The grammar's `path_field` always admitted this; the
 * verifier now honours it.
 */
export function checkFact(adapter, entityPath, field, value) {
    const absolute = ABSOLUTE_FIELD.test(field);
    if (!entityPath && !absolute) return { status: 'no-context', errorClass: 'context' };
    const path = absolute ? field : `${entityPath}.${field}`;
    const resolution = adapter.resolve(path);
    if (!resolution.found) return { status: 'field-not-found', path, errorClass: 'reference' };
    const expected = getExpectedSurfaceValue(resolution);
    if (String(value) === String(expected)) {
        return { status: 'verified', path, ...getTrustFields(resolution) };
    }
    return { status: 'value-mismatch', path, expected, errorClass: 'value', ...getTrustFields(resolution) };
}

/** The field a store path addresses: `student:100.passRate` -> `passRate`. */
function fieldOf(path) {
    const colon = path.indexOf(':');
    const dot = path.indexOf('.', colon + 1);
    return dot === -1 ? null : path.slice(dot + 1);
}

/**
 * Evaluate an inference condition against the fact store and threshold registry.
 *
 * Evaluation is three-valued. A condition that cannot be resolved (an unknown
 * threshold, a missing operand, a label that was never defined) is UNKNOWN, not
 * false. The distinction matters at exactly one place: NOT. Treating unresolvable
 * as false let `NOT @nonexistent` come back verified, which would report a claim
 * as proven on the strength of a threshold nobody defined.
 *
 * @param {string} condition
 * @param {string|null} entityPath  the entity in force, or null
 * @param {{resolve: Function}} adapter
 * @param {object} labels  earlier inference results by label (document-global)
 * @param {object} registry
 */
export function evaluateCondition(condition, entityPath, adapter, labels, registry = thresholds) {
    condition = condition.trim();

    // OR (lower precedence, checked first). True beats unknown; otherwise an
    // unresolvable operand makes the whole disjunction unresolvable.
    if (condition.includes(' OR ')) {
        const parts = condition.split(' OR ').map(p => p.trim());
        const results = parts.map(p => evaluateCondition(p, entityPath, adapter, labels, registry));
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
        const results = parts.map(p => evaluateCondition(p, entityPath, adapter, labels, registry));
        const decidedFalse = results.some(r => !r.verified && !r.unknown);
        const unknown = !decidedFalse && results.some(r => r.unknown);
        return {
            verified: !unknown && results.every(r => r.verified),
            ...(unknown ? { unknown: true, error: results.find(r => r.unknown).error } : {}),
            explanation: results.map(r => r.explanation || r.error).join(' ∧ '),
            source: results.map(r => r.source).filter(Boolean).join(', '),
            ...mergeTrustFields(results)
        };
    }

    // NOT. Negating an unresolvable condition leaves it unresolvable.
    if (condition.startsWith('NOT ')) {
        const inner = evaluateCondition(condition.slice(4), entityPath, adapter, labels, registry);
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

    // Label reference: @label. The reference is only as resolved as its target.
    if (condition.startsWith('@')) {
        const refLabel = condition.slice(1);
        const ref = labels[refLabel];
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

    // Threshold: NAME or NAME(path)
    const thresholdMatch = condition.match(/^([A-Z][A-Z0-9_]*)(?:\(([^)]+)\))?$/);
    if (thresholdMatch) {
        const tName = thresholdMatch[1];
        const t = registry[tName];
        if (!t) return { verified: false, unknown: true, error: `Unknown threshold: ${tName}` };

        let fieldPath;
        if (thresholdMatch[2]) {
            // An explicit path may pick the entity, never the field: the registry
            // decides which test runs against which field, and a model that could
            // point IS_STRONG at `absent` would have the bound without the meaning.
            fieldPath = thresholdMatch[2];
            const field = fieldOf(fieldPath);
            if (field !== t.field) {
                return { verified: false, unknown: true, error: `${tName} is defined on ${t.field}, but ${fieldPath} addresses ${field ?? 'no field'}` };
            }
        } else if (entityPath) {
            fieldPath = `${entityPath}.${t.field}`;
        }

        // No entity context and no explicit path: nothing is addressable,
        // so no threshold (including is_null) can evaluate.
        if (!fieldPath) return { verified: false, unknown: true, error: `No entity context for threshold ${tName}` };

        const resolution = adapter.resolve(fieldPath);
        const actualValue = resolution.value;

        if (actualValue === undefined && t.op !== 'is_null') return { verified: false, unknown: true, error: `No value for ${t.field}` };

        // Unit check: if the threshold declares a unit, the store must declare a matching one.
        if (t.unit) {
            const storeUnit = resolution.unit;
            if (storeUnit == null) {
                return { verified: false, unknown: true, error: `Threshold expects unit ${t.unit}, but field has no unit` };
            }
            if (String(storeUnit) !== String(t.unit)) {
                return { verified: false, unknown: true, error: `Unit mismatch: threshold expects ${t.unit}, data has ${storeUnit}` };
            }
        }

        const result = evaluateThreshold(tName, actualValue, registry);
        // An invalid evaluation (non-numeric value under an ordering operator,
        // unknown operator) is unresolvable, not false.
        if (!result.valid) {
            return { verified: false, unknown: true, error: result.error,
                explanation: result.error, ...getTrustFields(resolution) };
        }
        return {
            verified: result.result,
            explanation: result.explanation,
            source: result.source,
            label: result.label,
            ...getTrustFields(resolution)
        };
    }

    // Bare comparison: reject. The registry is the only source of a bound.
    if (/[><=!]/.test(condition)) {
        return { verified: false, unknown: true, error: `Direct comparison not allowed: use a threshold from the registry` };
    }

    return { verified: false, unknown: true, error: `Unknown condition: ${condition}` };
}
