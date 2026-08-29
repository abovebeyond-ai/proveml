/**
 * The system prompt a model needs to write ProveML that verifies.
 *
 * The rules below are not style advice; each one closed a measured gap. In the
 * August 2026 frontier study, Claude Opus 5 verified 86% of its claims on the
 * first pass under a prompt that only named the constructs, and 100% under a
 * prompt that added the binding rule (a fact may name its own record when the
 * sentence names two entities) and the cutoff rule (a bound from the question
 * is not a fact). Two thirds of the earlier residue had been exactly that.
 *
 * The prompt is generated from the store and the registry so the field names
 * the model sees are the field names the verifier resolves, and the only
 * qualitative words it may use are the registered ones. A vocabulary the model
 * is shown that differs from the store's produces "field not found" on every
 * model and counts as a model error; that too was measured.
 */

const RULES = [
    'Declare a subject before its facts: @[type:id]{name}. The name in braces must equal the record\'s name field exactly.',
    'Every number you state is a fact: %[field]{value}, copied exactly from the data, unit included when the data shows one. Never round, never reformat, never compute a difference, ratio or total yourself.',
    'A fact binds to the nearest preceding subject. If a sentence names a second subject before a fact, write the fact with its own record: %[type:id.field]{value}.',
    'Qualitative wording (large, low, at risk, healthy) is only allowed as a judgement over the registry: ?[label: NAME]{words}. Use only the names listed, and only when the condition holds; otherwise do not make the claim. A judgement reads its field from the nearest subject; to judge another record write ?[label: NAME(type:id.field)]{words}.',
    'A cutoff or threshold from the question ("below 60%", "more than 10") is not a fact: do not write it as %[...].',
    'No number may appear outside a %[...] construct. A value the data does not hold may not appear as a number at all; say it was not available.',
    'Plain Markdown paragraphs. No headings, lists, tables or code fences.',
];

function fieldsByType(store) {
    const byType = new Map();
    for (const key of Object.keys(store)) {
        const colon = key.indexOf(':');
        const dot = key.indexOf('.', colon + 1);
        if (colon < 1 || dot < 0) continue;
        const field = key.slice(dot + 1);
        if (field === 'name' || field.endsWith('._unit') || field.endsWith('._display')) continue;
        const type = key.slice(0, colon);
        if (!byType.has(type)) byType.set(type, new Map());
        const unit = store[`${key}._unit`];
        byType.get(type).set(field, unit ? String(unit) : '');
    }
    return byType;
}

function exampleFor(store) {
    // The first record that has a name and at least one plain field.
    for (const key of Object.keys(store)) {
        if (!key.endsWith('.name')) continue;
        const path = key.slice(0, -5);
        const name = store[key];
        const field = Object.keys(store).find(k => k.startsWith(`${path}.`) && k !== key && !k.endsWith('._unit') && !k.endsWith('._display'));
        if (!field) continue;
        const f = field.slice(path.length + 1);
        const unit = store[`${field}._unit`];
        return `@[${path}]{${name}} has a ${f} of %[${f}]{${store[field]}${unit ? ' ' + unit : ''}}.`;
    }
    return null;
}

/**
 * @param {object} opts
 * @param {object} [opts.store]       a flat fact store; its types, fields and units go into the prompt
 * @param {object} [opts.thresholds]  the registry; its names, fields and labels go into the prompt
 * @param {string} [opts.role]        one line on who is writing, e.g. "You write short ledger reports."
 * @param {string} [opts.example]     a worked example in ProveML; derived from the store when omitted
 * @param {boolean} [opts.data]       also append the store as a DATA block (default false)
 * @returns {string}
 */
export function promptFor({ store = {}, thresholds = {}, role = 'You write short reports from structured data.', example, data = false } = {}) {
    const lines = [`${role} Answer in ProveML markdown: every claim you make is checked by a program against the data, by exact lookup.`, '', 'RULES:'];
    for (const r of RULES) lines.push(`- ${r}`);

    const types = fieldsByType(store);
    if (types.size) {
        lines.push('', 'RECORDS AND FIELDS (the only names you may use):');
        for (const [type, fields] of types) {
            lines.push(`- ${type}: ${[...fields].map(([f, u]) => (u ? `${f} (${u})` : f)).join(', ')}`);
        }
    }

    const names = Object.keys(thresholds);
    if (names.length) {
        lines.push('', 'REGISTRY (the only qualitative claims you may make):');
        for (const n of names) {
            const t = thresholds[n];
            const bound = t.op === 'between' ? `between ${t.low} ${t.high}` : t.op === 'in' ? `in {${(t.values || []).join(',')}}` : t.op === 'is_null' ? 'is missing' : `${t.op} ${t.value}${t.unit ? ' ' + t.unit : ''}`;
            lines.push(`- ${n}: ${t.field} ${bound}${t.label ? `  ("${t.label}")` : ''}`);
        }
    } else {
        lines.push('', 'REGISTRY: none. Make no qualitative claims about magnitude; state the numbers.');
    }

    const ex = example ?? exampleFor(store);
    if (ex) lines.push('', 'EXAMPLE:', ex);

    if (data) {
        lines.push('', 'DATA:');
        for (const [k, v] of Object.entries(store)) if (!k.endsWith('._display')) lines.push(`${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
    return lines.join('\n');
}

export { RULES as PROMPT_RULES };
