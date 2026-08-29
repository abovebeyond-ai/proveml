/**
 * ProveML trust-adapter helpers
 *
 * The default path remains a plain flat fact store. Adapters are optional:
 * they let callers attach source-authentication metadata without changing
 * the core ProveML verification contract.
 */

const DEFAULT_TRUST = Object.freeze({
    status: 'unverified',
    backend: 'plain'
});

function normalizeTrust(trust) {
    if (!trust || typeof trust !== 'object') return { ...DEFAULT_TRUST };
    return {
        status: trust.status || DEFAULT_TRUST.status,
        backend: trust.backend || DEFAULT_TRUST.backend,
        ...(trust.proofRef ? { proofRef: trust.proofRef } : {}),
        ...(trust.issuer ? { issuer: trust.issuer } : {}),
        ...(trust.checkedAt ? { checkedAt: trust.checkedAt } : {})
    };
}

export function plainAdapter(factStore = {}) {
    return {
        /**
         * Every record with a name, as [{path, name}]. Lets the verifier ask
         * whether a rendered subject is unique in the store. Adapters over
         * sources that cannot be enumerated may omit this; uniqueness is then
         * unknown rather than assumed.
         */
        subjects() {
            const out = [];
            for (const [key, value] of Object.entries(factStore)) {
                if (key.endsWith('.name') && key.indexOf('.') === key.length - 5) out.push({ path: key.slice(0, -5), name: String(value) });
            }
            return out;
        },
        resolve(path) {
            const value = factStore[path];
            if (value === undefined) return { found: false };

            return {
                found: true,
                value,
                unit: factStore[`${path}._unit`],
                trust: { ...DEFAULT_TRUST }
            };
        }
    };
}

export function toTrustAdapter(input = {}) {
    if (input && typeof input.resolve === 'function') return input;
    return plainAdapter(input);
}

export function getTrustFields(resolution) {
    if (!resolution?.found) return {};

    const trust = normalizeTrust(resolution.trust);
    return {
        trustStatus: trust.status,
        trustBackend: trust.backend,
        ...(trust.proofRef ? { trustProofRef: trust.proofRef } : {}),
        ...(trust.issuer ? { trustIssuer: trust.issuer } : {}),
        ...(trust.checkedAt ? { trustCheckedAt: trust.checkedAt } : {})
    };
}

export function getExpectedSurfaceValue(resolution) {
    if (!resolution?.found) return undefined;
    return resolution.unit != null
        ? `${resolution.value} ${resolution.unit}`
        : String(resolution.value);
}
