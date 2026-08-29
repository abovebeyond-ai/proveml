/**
 * ProveML Threshold Registry
 *
 * Educator-defined thresholds. The AI cannot invent comparison values.
 * Every threshold check in an inference chain must reference this registry.
 */

/**
 * What a threshold may be called. The condition grammar reads a name as
 * uppercase letters, digits and underscores starting with a letter; a registry
 * key outside that shape is a threshold nobody can ever reference.
 */
export const THRESHOLD_NAME = /^[A-Z][A-Z0-9_]*$/;

export const thresholds = {
    // Pass/fail thresholds (from platform business logic)
    IS_LOW_PASS: { field: 'passRate', op: '<', value: 25, label: 'critically low pass rate', source: 'mastery-calculation.md' },
    IS_BELOW_HALF: { field: 'passRate', op: '<', value: 50, label: 'below half', source: 'mastery-calculation.md' },
    IS_PASSING: { field: 'passRate', op: '>=', value: 50, label: 'passing', source: 'mastery-calculation.md' },
    IS_STRONG: { field: 'passRate', op: '>=', value: 75, label: 'strong', source: 'mastery-calculation.md' },

    // Absence thresholds (from platform: 70% attendance rule)
    IS_HIGH_ABSENCE: { field: 'absent', op: '>', value: 10, label: 'high absence', source: 'absence-rules.md' },
    IS_GREY_RISK: { field: 'absent', op: '>', value: 30, label: 'risk of grey marks', source: 'absence-rules.md' },

    // Coverage thresholds
    IS_LOW_COVERAGE: { field: 'evalRate', op: '<', value: 40, label: 'low coverage', source: 'progress-metrics.md' },
    IS_WELL_COVERED: { field: 'evalRate', op: '>=', value: 70, label: 'well covered', source: 'progress-metrics.md' },

    // Sample size (from offering-comparison skill)
    IS_SMALL_SAMPLE: { field: 'studentCount', op: '<', value: 5, label: 'small sample', source: 'offering-comparison.md' },
    IS_RELIABLE_SAMPLE: { field: 'studentCount', op: '>=', value: 10, label: 'reliable sample', source: 'offering-comparison.md' },

    // Unit-aware thresholds (finance/healthcare examples)
    IS_NEGATIVE_BALANCE: { field: 'balance', op: '<', value: 0, unit: 'EUR', label: 'negative balance', source: 'finance-rules.md' },
    IS_ELEVATED_GLUCOSE: { field: 'glucose', op: '>', value: 126, unit: 'mg/dL', label: 'elevated glucose', source: 'clinical-ranges.md' },
    IS_PROFITABLE: { field: 'netIncome', op: '>', value: 0, unit: 'USD', label: 'profitable', source: 'finance-rules.md' },
    IS_MISSING: { field: 'evaluated', op: 'is_null', label: 'no data', source: 'data-quality.md' },
    IS_MUCH_HIGHER: { field: '_diff', op: 'diff_gt', value: 15, label: 'much higher', source: 'offering-comparison.md' },

    // Offering comparison
    IS_SIGNIFICANT_DIFF: { field: '_diff', op: '>=', value: 20, label: 'significant difference', source: 'offering-comparison.md' },

    // Operator-coverage thresholds: together with the entries above these
    // exercise the full Table-1 vocabulary (between, in, eq, neq, lte)
    IS_MODERATE_PASS: { field: 'passRate', op: 'between', low: 25, high: 50, label: 'moderate pass rate', source: 'mastery-calculation.md' },
    IS_A_STREAM: { field: 'stream', op: 'in', values: ['A-stroom'], label: 'A stream', source: 'offering-comparison.md' },
    IS_PERFECT_PASS: { field: 'passRate', op: 'eq', value: 100, label: 'perfect pass rate', source: 'mastery-calculation.md' },
    IS_NONEMPTY_CLASS: { field: 'studentCount', op: 'neq', value: 0, label: 'non-empty class', source: 'offering-comparison.md' },
    IS_AT_MOST_HALF: { field: 'passRate', op: 'lte', value: 50, label: 'at most half', source: 'mastery-calculation.md' },
};

/**
 * Evaluate a threshold against a value.
 * Supports all operator forms from the spec:
 *   Core:     lt, gt, lte, gte, eq, neq (and legacy <, >, <=, >=, ==, !=)
 *   Extended: between, in, is_null, diff_gt
 */
export function evaluateThreshold(thresholdName, actualValue, registry = thresholds) {
    const t = registry[thresholdName];
    if (!t) return { valid: false, error: `Unknown threshold: ${thresholdName}` };

    // is_null: check before numeric conversion
    if (t.op === 'is_null') {
        const result = actualValue === undefined || actualValue === null;
        return { valid: true, result, threshold: t, actualValue, explanation: `is_null → ${result}`, label: t.label, source: t.source };
    }

    if (actualValue === undefined || actualValue === null) return { valid: false, error: 'No value' };

    // in: set membership (string comparison)
    if (t.op === 'in') {
        const values = t.values || [];
        const result = values.includes(String(actualValue));
        return { valid: true, result, threshold: t, actualValue, explanation: `${actualValue} in {${values.join(',')}} → ${result}`, label: t.label, source: t.source };
    }

    // eq/neq compare canonical string forms and therefore also apply to
    // categorical fields (status eq "active"), so they must not go through the
    // numeric gate below — that gate would reject every non-numeric value with
    // a type error before the comparison ever ran.
    if (t.op === '==' || t.op === 'eq' || t.op === '!=' || t.op === 'neq') {
        const equal = String(actualValue) === String(t.value);
        const result = (t.op === '==' || t.op === 'eq') ? equal : !equal;
        return { valid: true, result, threshold: t, actualValue, explanation: `${JSON.stringify(actualValue)} ${t.op} ${JSON.stringify(t.value)} → ${result}`, label: t.label, source: t.source };
    }

    // Number('') is 0 and Number(true) is 1, so a bare Number() would compare an
    // empty cell or a boolean as if it were a measurement. Only accept values
    // that actually read as a number.
    const numeric = typeof actualValue === 'number'
        ? actualValue
        : (typeof actualValue === 'string' && actualValue.trim() !== '' && Number.isFinite(Number(actualValue))
            ? Number(actualValue)
            : NaN);
    if (Number.isNaN(numeric)) {
        return { valid: false, error: `Not a number: ${JSON.stringify(actualValue)}` };
    }
    const v = numeric;

    // between: low <= v < high
    if (t.op === 'between') {
        const result = v >= t.low && v < t.high;
        return { valid: true, result, threshold: t, actualValue: v, explanation: `${t.low} <= ${v} < ${t.high} → ${result}`, label: t.label, source: t.source };
    }

    // diff_gt: signed comparison — the (materialized) difference must exceed the bound
    if (t.op === 'diff_gt') {
        // actualValue here is the diff or the primary value; the caller resolves the second entity
        const result = v > t.value;
        return { valid: true, result, threshold: t, actualValue: v, explanation: `diff ${v} > ${t.value} → ${result}`, label: t.label, source: t.source };
    }

    // Core ordering operators (support both symbolic and named forms);
    // eq/neq were handled above, before the numeric gate.
    let result;
    switch (t.op) {
        case '>':   case 'gt':  result = v > t.value; break;
        case '<':   case 'lt':  result = v < t.value; break;
        case '>=':  case 'gte': result = v >= t.value; break;
        case '<=':  case 'lte': result = v <= t.value; break;
        default: return { valid: false, error: `Unknown operator: ${t.op}` };
    }

    return {
        valid: true,
        result,
        threshold: t,
        actualValue: v,
        explanation: `${v} ${t.op} ${t.value} → ${result}`,
        label: t.label,
        source: t.source
    };
}

/**
 * Get all threshold names
 */
export function getThresholdNames(registry = thresholds) {
    return Object.keys(registry);
}
