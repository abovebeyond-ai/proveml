/**
 * ProveML HTML renderer
 *
 * Minimal embeddable renderer that verifies ProveML markup and emits
 * verification-aware HTML spans without requiring markdown-it.
 */

import { tokenizeProveml, verifyProveml } from './verify.js';

function escapeHtml(text) {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function renderPlainText(text) {
    return escapeHtml(text).replace(/\n\n/g, '</p><p class="proveml-paragraph">');
}

export const PROVEML_CLASSNAMES = Object.freeze({
    root: 'proveml-root',
    paragraph: 'proveml-paragraph',
    entity: 'proveml-entity',
    fact: 'proveml-fact',
    inference: 'proveml-inference',
    proof: 'proveml-proof',
    verified: 'proveml-verified',
    mismatch: 'proveml-mismatch',
    failed: 'proveml-failed',
    unverifiable: 'proveml-unverifiable',
    noContext: 'proveml-no-context',
    nameMismatch: 'proveml-name-mismatch',
    ambiguous: 'proveml-ambiguous',
    entityHighlight: 'proveml-entity-highlight',
    trustVerified: 'proveml-trust-verified',
    trustUnverified: 'proveml-trust-unverified',
    trustExpired: 'proveml-trust-expired',
    trustRevoked: 'proveml-trust-revoked',
    trustError: 'proveml-trust-error',
});

function trustClassName(status) {
    if (!status) return '';
    switch (status) {
        case 'verified': return ` ${PROVEML_CLASSNAMES.trustVerified}`;
        case 'unverified': return ` ${PROVEML_CLASSNAMES.trustUnverified}`;
        case 'expired': return ` ${PROVEML_CLASSNAMES.trustExpired}`;
        case 'revoked': return ` ${PROVEML_CLASSNAMES.trustRevoked}`;
        case 'error': return ` ${PROVEML_CLASSNAMES.trustError}`;
        default: return '';
    }
}

function trustDataAttrs(detail = {}) {
    let attrs = '';
    if (detail.trustStatus) attrs += ` data-trust-status="${escapeHtml(detail.trustStatus)}"`;
    if (detail.trustBackend) attrs += ` data-trust-backend="${escapeHtml(detail.trustBackend)}"`;
    if (detail.trustProofRef) attrs += ` data-trust-proof-ref="${escapeHtml(detail.trustProofRef)}"`;
    if (detail.trustIssuer) attrs += ` data-trust-issuer="${escapeHtml(detail.trustIssuer)}"`;
    if (detail.trustCheckedAt) attrs += ` data-trust-checked-at="${escapeHtml(detail.trustCheckedAt)}"`;
    return attrs;
}

function renderTrustProof(detail = {}) {
    if (!detail.trustStatus) return '';

    const parts = [`trust: ${detail.trustStatus}`];
    if (detail.trustBackend) parts.push(`via ${detail.trustBackend}`);
    if (detail.trustIssuer) parts.push(`issuer ${detail.trustIssuer}`);

    return `<span class="${PROVEML_CLASSNAMES.proof}">[${escapeHtml(parts.join(' · '))}]</span>`;
}

export function renderProveml(markup, factStore, options = {}) {
    const verification = verifyProveml(
        markup,
        factStore,
        // Forward what verify understands; the renderer adds nothing of its own.
        (options.snapshot || options.thresholds)
            ? { ...(options.snapshot && { snapshot: options.snapshot }),
                ...(options.thresholds && { thresholds: options.thresholds }) }
            : undefined
    );
    const tokens = tokenizeProveml(markup);

    const entityDetails = [];
    const factDetails = [];
    const inferenceDetails = [];
    for (const detail of verification.details) {
        if (detail.type === 'entity') entityDetails.push(detail);
        else if (detail.type === 'fact') factDetails.push(detail);
        else if (detail.type === 'inference') inferenceDetails.push(detail);
    }

    let entityIndex = 0;
    let factIndex = 0;
    let inferenceIndex = 0;
    let html = '';
    let pos = 0;

    for (const token of tokens) {
        if (token.type === 'entity_close') {
            // Render any trailing text inside the scope before the closing brace
            if (token.pos > pos) {
                html += renderPlainText(markup.slice(pos, token.pos));
            }
            pos = token.end;
            continue;
        }

        if (token.pos > pos) {
            html += renderPlainText(markup.slice(pos, token.pos));
        }

        if (token.type === 'entity') {
            const detail = entityDetails[entityIndex++] || {};
            const entityPath = `${token.entityType}:${token.entityId}`;
            const statusClass = detail.status === 'verified'
                ? PROVEML_CLASSNAMES.verified
                : detail.status === 'name-mismatch'
                    ? PROVEML_CLASSNAMES.nameMismatch
                    : PROVEML_CLASSNAMES.unverifiable;

            const ambiguous = detail.subjectUnique === false;
            const entityTitle = ambiguous ? `${entityPath}.name (this name is also ${detail.ambiguousWith.join(', ')})` : `${entityPath}.name`;
            html += `<span class="${PROVEML_CLASSNAMES.entity} ${statusClass}${ambiguous ? ' ' + PROVEML_CLASSNAMES.ambiguous : ''}${trustClassName(detail.trustStatus)}" data-entity="${escapeHtml(entityPath)}"${detail.subjectUnique != null ? ` data-subject-unique="${detail.subjectUnique}"` : ''}${trustDataAttrs(detail)} title="${escapeHtml(entityTitle)}">${escapeHtml(token.name)}</span>`;

            if (options.showProofPaths) {
                html += `<span class="${PROVEML_CLASSNAMES.proof}">[${escapeHtml(`${entityPath}.name`)}]</span>`;
                html += renderTrustProof(detail);
            }

            if (token.scoped) {
                // Advance to content start (just past the opening brace),
                // so inner tokens and gap text render correctly.
                // entity_close will advance past the closing brace.
                pos = token.end - token.content.length - 1;
            } else {
                pos = token.end;
            }
            continue;
        }

        if (token.type === 'fact') {
            const detail = factDetails[factIndex++] || {};
            const path = detail.path || '';
            const entityPath = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : '';
            const statusClass = detail.status === 'verified'
                ? PROVEML_CLASSNAMES.verified
                : detail.status === 'value-mismatch'
                    ? PROVEML_CLASSNAMES.mismatch
                    : detail.status === 'no-context'
                        ? PROVEML_CLASSNAMES.noContext
                        : PROVEML_CLASSNAMES.unverifiable;

            let title = path;
            if (detail.status === 'verified') title = `${path} = ${detail.value}`;
            else if (detail.status === 'value-mismatch') title = `${path}: expected ${detail.expected}`;
            else if (detail.status === 'no-context') title = 'no entity context';
            else if (path) title = `${path}: not found`;

            html += `<span class="${PROVEML_CLASSNAMES.fact} ${statusClass}${trustClassName(detail.trustStatus)}" data-entity="${escapeHtml(entityPath)}" data-path="${escapeHtml(path)}"${trustDataAttrs(detail)} title="${escapeHtml(title)}">${escapeHtml(token.value)}</span>`;

            if (options.showProofPaths && path) {
                html += `<span class="${PROVEML_CLASSNAMES.proof}">[${escapeHtml(path)}]</span>`;
                html += renderTrustProof(detail);
            }

            pos = token.end;
            continue;
        }

        if (token.type === 'inference') {
            const detail = inferenceDetails[inferenceIndex++] || {};
            const statusClass = detail.status === 'verified' ? PROVEML_CLASSNAMES.verified
                : detail.status === 'unverifiable' ? PROVEML_CLASSNAMES.unverifiable
                : PROVEML_CLASSNAMES.failed;
            const condition = token.condition;

            html += `<span class="${PROVEML_CLASSNAMES.inference} ${statusClass}${trustClassName(detail.trustStatus)}" data-condition="${escapeHtml(condition)}"${trustDataAttrs(detail)} title="${escapeHtml(`?[${token.label}: ${condition}]`)}">${escapeHtml(token.text)}</span>`;

            if (options.showProofPaths) {
                html += `<span class="${PROVEML_CLASSNAMES.proof}">[${escapeHtml(condition)}]</span>`;
                html += renderTrustProof(detail);
            }

            pos = token.end;
        }
    }

    if (pos < markup.length) {
        html += renderPlainText(markup.slice(pos));
    }

    return {
        html: `<div class="${PROVEML_CLASSNAMES.root}"><p class="${PROVEML_CLASSNAMES.paragraph}">${html}</p></div>`,
        verification
    };
}

/**
 * Attach entity-highlight hover behavior to a container with rendered ProveML HTML.
 */
export function attachHover(container) {
    if (!container) return;
    container.addEventListener('mouseover', (e) => {
        const el = e.target.closest('[data-entity]');
        if (!el) return;
        const path = el.dataset.entity;
        if (!path) return;
        container.querySelectorAll(`.${PROVEML_CLASSNAMES.entityHighlight}`).forEach(x => x.classList.remove(PROVEML_CLASSNAMES.entityHighlight));
        container.querySelectorAll(`[data-entity="${path}"]`).forEach(x => x.classList.add(PROVEML_CLASSNAMES.entityHighlight));
    });
    container.addEventListener('mouseout', (e) => {
        if (e.target.closest('[data-entity]')) {
            container.querySelectorAll(`.${PROVEML_CLASSNAMES.entityHighlight}`).forEach(x => x.classList.remove(PROVEML_CLASSNAMES.entityHighlight));
        }
    });
}

export const PROVEML_CSS = `
:where(.proveml-root) {
    --proveml-entity-color: #0d9488;
    --proveml-inference-color: #7c3aed;
    --proveml-danger-color: #dc2626;
    --proveml-warning-color: #d97706;
    --proveml-proof-color: #6b7280;
    --proveml-entity-hover-bg: rgba(13, 148, 136, 0.06);
    --proveml-fact-hover-bg: rgba(13, 148, 136, 0.08);
    --proveml-inference-hover-bg: rgba(124, 58, 237, 0.06);
    --proveml-highlight-bg: rgba(13, 148, 136, 0.08);
    --proveml-highlight-outline: rgba(13, 148, 136, 0.2);
    --proveml-paragraph-gap: 0.75rem;
}
.proveml-paragraph {
    margin: 0;
}
.proveml-paragraph + .proveml-paragraph {
    margin-top: var(--proveml-paragraph-gap);
}
.proveml-entity {
    border-bottom: 1.5px solid var(--entity-color, var(--proveml-entity-color));
    padding-bottom: 1px;
    cursor: help;
    transition: background-color 0.15s ease;
}
.proveml-entity:hover {
    background-color: var(--proveml-entity-hover-bg);
}
.proveml-entity.proveml-name-mismatch {
    border-bottom-style: wavy;
    border-bottom-color: var(--proveml-danger-color);
}
.proveml-entity.proveml-ambiguous {
    border-bottom-style: double;
    border-bottom-color: var(--proveml-warning-color);
}
.proveml-entity.proveml-unverifiable {
    border-bottom-style: dashed;
    border-bottom-color: var(--proveml-warning-color);
}
.proveml-fact {
    font-weight: 600;
    cursor: help;
    transition: background-color 0.15s ease;
}
.proveml-fact.proveml-verified {
    border-bottom: 1.5px dotted var(--entity-color, var(--proveml-entity-color));
}
.proveml-fact.proveml-verified:hover {
    background-color: var(--proveml-fact-hover-bg);
}
.proveml-fact.proveml-mismatch {
    border-bottom: 1.5px dotted var(--proveml-danger-color);
    color: var(--proveml-danger-color);
    text-decoration: line-through;
    text-decoration-color: rgba(220, 38, 38, 0.3);
}
.proveml-fact.proveml-unverifiable,
.proveml-fact.proveml-no-context {
    border-bottom: 1.5px dotted var(--proveml-warning-color);
    color: var(--proveml-warning-color);
}
.proveml-inference {
    cursor: help;
    transition: background-color 0.15s ease;
}
.proveml-inference.proveml-verified {
    border-bottom: 1.5px dashed var(--proveml-inference-color);
}
.proveml-inference.proveml-verified:hover {
    background-color: var(--proveml-inference-hover-bg);
}
.proveml-inference.proveml-failed {
    border-bottom: 1.5px dashed var(--proveml-danger-color);
    color: var(--proveml-danger-color);
}
.proveml-proof {
    margin-left: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.62em;
    color: var(--proveml-proof-color);
    white-space: nowrap;
}
.proveml-entity-highlight {
    background-color: var(--proveml-highlight-bg) !important;
    outline: 1px solid var(--proveml-highlight-outline);
    border-radius: 2px;
    transition: background-color 0.1s ease;
}
`;
