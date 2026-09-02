/**
 * proveml/review-page — the review surface of the suite.
 *
 * One page per report: every claim next to the evidence its store value rests
 * on. The machine re-checks what it can at build time (the claim equals the
 * store, a quote is verbatim in its snapshot) and refuses to emit the page if
 * any check fails. What remains on the page is the one link no machine can
 * close: whether a value is a fair reading of its evidence. Each of those
 * readings carries the judgement widget from proveml/review, keyed by a hash
 * of exactly what is being judged, so a judgement dies when the evidence
 * changes and review shrinks to the diff.
 *
 * The page is a step in a loop, not the end of a line: flag a reading, fix
 * the store or the evidence, rebuild, and only the judgements the fix
 * invalidated come back to be judged again.
 *
 * Input is generic: a fact store, and per subject a ProveML claim plus the
 * evidence entries behind its fields. Point it at a different store and
 * evidence file and the same surface serves the next report.
 */

import { verifyProveml } from './verify.js';
import { quoteEvidence, treeLevels, buildManifest } from './manifest.js';
import { renderProveml } from './render-html.js';
import { reviewId } from './review.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();


/**
 * Plain text from an archived snapshot, for the verbatim gate: tags stripped,
 * common entities decoded, whitespace squashed. Pass html:false for plain
 * text archives.
 */
export function snapshotText(raw, { html = true } = {}) {
    let t = String(raw);
    if (html) {
        t = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
            .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
            .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"')
            .replace(/&rsquo;/g, '\u2019').replace(/&lsquo;/g, '\u2018').replace(/&rdquo;/g, '\u201D').replace(/&ldquo;/g, '\u201C').replace(/&nbsp;/g, ' ');
    }
    return t.replace(/\s+/g, ' ');
}

/**
 * The one recipe for the review root, exported so a credential issuer and
 * this page can never drift: the output root is leaf one, then the
 * judgements sorted by id, one canonical line each.
 */
export function reviewRootOf(judgements, outputRoot) {
    const entries = Object.entries(judgements).sort(([a], [b]) => (a < b ? -1 : 1));
    const lines = [`output ${outputRoot}`, ...entries.map(([id, v]) => `${id} ${v.src}.${v.field} ${v.verdict} ${v.at}`)];
    return buildManifest(lines.join('\n'), { html: false });
}

/** The identity of one reading: hash over exactly the parts being judged. */
export function evidenceReviewId(subjectId, e, leafHashes) {
    const quotes = e.sourceQuotes ? e.sourceQuotes.map((q) => q.sourceQuote).join('\u0000') : (e.sourceQuote || '');
    // With a manifest, the reading is anchored to the NEIGHBORHOOD it rests
    // in: the quoted block and the blocks either side. Regenerate the source
    // and a yes survives exactly where that neighborhood kept its
    // fingerprints, and nowhere else.
    const anchored = leafHashes && leafHashes.length ? `${quotes}\u0001${leafHashes.join('\u0000')}` : quotes;
    return reviewId(subjectId, e.field, e.claimValue, e.basis, anchored, e.note || '');
}

/**
 * Build the review page.
 *
 * @param {object} opts
 * @param {Record<string, unknown>} opts.store  flat ProveML fact store
 * @param {Array} opts.subjects  one card per subject:
 *   { id, title, meta?, claim, evidence: [{ field, claimValue,
 *     basis: 'quote'|'derived'|'absence', sourceQuote?, sourceLocator?,
 *     sourceHref?, note? }] }
 * @param {string} [opts.name='review']  tool label in the lockup
 * @param {string} [opts.storeName='store']  shown in the statline
 * @param {string} [opts.subjectsWord='subjects']  noun for the statline count
 * @param {string} [opts.leftLabel='the output']  column label
 * @param {string} [opts.rightLabel='the evidence']  column label
 * @param {Record<string, string>} [opts.snapshots]  plain text per subject id;
 *   when present for a subject, every quote of that subject must occur in it
 *   verbatim (whitespace-normalised) or the build throws
 * @param {object} [opts.committedReview]  a review JSON ({judgements}) baked
 *   into the page; the reviewer's local judgements overlay it
 * @param {object} [opts.thresholds]  registry passed to the verifier
 * @param {Record<string, object>} [opts.manifests]  merkle manifest per
 *   subject id (see manifest.js). A quote of a manifested subject must sit
 *   verbatim within a single leaf or the build refuses; its loc line gains a
 *   computable locator (block, root) and the return carries the inclusion
 *   proofs, ready to be written beside the page and checked by a stranger
 * @param {Record<string, object>} [opts.signatures]  per subject id, an
 *   attestation that this source's manifest root is signed by its issuer:
 *   {issuer, method?, verifiedAt?}. Verification is the CALLER's job (an
 *   adapter checked the credential against the root); this page only
 *   carries the attestation, on the quote lines, in the merkle view and in
 *   the proofs, so the receipt names who vouched and how to recheck
 * @param {object} [opts.brand]  {mark?, name?}: another face on the lockup
 *   (a skill like Vera fronting the page); provenance then moves to the
 *   statline, which says the page is built on proveml
 * @returns {{ html: string, verified: number, total: number, ids: string[],
 *   proofs: object[], roots: null | { review, output, sources } }}  roots
 *   are what a review credential covers: sign the review root and you have
 *   signed the judgements, the output and the source roots they stood on
 */
export function reviewPage(opts) {
    const {
        store, subjects,
        name = 'review', storeName = 'store', subjectsWord = 'subjects',
        leftLabel = 'the output', rightLabel = 'the evidence',
        snapshots: givenSnapshots = {}, committedReview = null, thresholds, brand = null,
        manifests = {}, signatures = {},
    } = opts;
    for (const id of Object.keys(signatures)) {
        if (!manifests[id]) throw new Error(`signatures.${id}: an attestation without a manifest signs nothing.`);
        if (!signatures[id].issuer) throw new Error(`signatures.${id}: an attestation needs an issuer.`);
    }
    // A manifest can stand in for a snapshot: its leaves ARE the canonical
    // text, so the substring gate and the hover context work unchanged.
    const snapshots = { ...givenSnapshots };
    for (const sj of Array.isArray(opts.subjects) ? opts.subjects : []) {
        if (manifests[sj.id] && snapshots[sj.id] === undefined) {
            snapshots[sj.id] = manifests[sj.id].leaves.map((l) => l.text).join('\n');
        }
    }
    if (!store || typeof store !== 'object') throw new Error('reviewPage: expected a fact store object.');
    if (!Array.isArray(subjects) || subjects.length === 0) throw new Error('reviewPage: expected a non-empty subjects array.');

    let total = 0, verified = 0;
    const ids = [];
    const proofs = [];

    const cards = subjects.map((s, i) => {
        const v = verifyProveml(s.claim, store, thresholds ? { thresholds } : undefined);
        total += v.total; verified += v.verified;
        if (v.errors.length) throw new Error(`${s.id}: ${v.errors.join('; ')}`);
        const left = renderProveml(s.claim, store).html;
        const right = (s.evidence || []).map((e) => evidenceBlock(s, e, snapshots, ids, manifests[s.id], proofs, signatures[s.id])).join('');
        const meta = s.meta ? `${esc(s.meta)} ` : '';
        return `<section class="pair" id="${attr(s.id)}">
  <header><h2><span class="nr">${String(i + 1).padStart(2, '0')}</span>${esc(s.title)}</h2><p class="meta">${meta}${v.verified}/${v.total} claims verified, ${(s.evidence || []).length} fields of evidence.</p></header>
  <div class="cols">
    <div class="col"><div class="lbl">${esc(leftLabel)}</div>${left}</div>
    <div class="col"><div class="lbl">${esc(rightLabel)}</div>${right}</div>
  </div>
</section>`;
    }).join('\n');

    // The merkle view: the structure itself, and what a next iteration
    // touches. Click a block: the root goes stale and exactly the readings
    // bound to that block are named as reopening — nothing else.
    const withMan = subjects.filter((sj) => manifests[sj.id]);
    const merkleTab = withMan.length ? '<button class="rv-vw" data-view="merkle" aria-pressed="false">merkle</button>' : '';
    const merkleView = withMan.length ? '<div class="merkle mk-intro"><p>Every archived source gets a fingerprint here: each block of text its own, all of them folded into one fingerprint for the whole source, the root at the top. That buys three things. If anyone touches the archive later, the root stops matching, so this receipt cannot be quietly rewritten. A publisher only has to sign the root, one line, and has vouched for every block at once. And when a source changes in a later round, only the touched blocks get new fingerprints, so only the readings resting on them, or right beside them, come back to you; the rest of your yeses stand. That is a key, not a promise: each yes is keyed to the fingerprints of its block and the blocks either side, because meaning is not block-local. The same fold points the other way, too: the judgements you hand back fold into a root of their own, and that root is the one line a signature covers.</p><p>Hover a block and its path lights up: the blue spine is what a checker recomputes, hash by hash, and it must land exactly on the root. The outlined hashes beside it are the only extras they are handed. Click a block to play what an edit there would do.</p></div>\n' + withMan.map((sj) => {
        const man = manifests[sj.id];
        const used = {};
        for (const pr of proofs) if (pr.subject === sj.id) (used[pr.leafIndex] = used[pr.leafIndex] || []).push(pr.field);
        const rows = man.leaves.map((l) => {
            const fields = used[l.i] || [];
            return `<div class="mk-leaf${fields.length ? ' mk-quoted' : ''}" data-leaf="${l.i}" data-fields="${attr(fields.join(', '))}"><span class="mk-nr">${String(l.i + 1).padStart(2, '0')}</span><code class="mk-hash">${esc(l.hash.slice(0, 12))}\u2026</code><span class="mk-text">${esc(l.text.length > 110 ? l.text.slice(0, 110) + '\u2026' : l.text)}</span>${fields.length ? `<span class="mk-used">carries ${esc(fields.join(', '))}</span>` : ''}</div>`;
        }).join('');
        const tree = drawTree(man);
        const sig = signatures[sj.id];
        const sigLine = sig
            ? `<p class="loc"><span class="sig">root signed by ${esc(sig.issuer)}${sig.method ? ` (${esc(sig.method)})` : ''}${sig.verifiedAt ? `, signature checked ${esc(sig.verifiedAt)}` : ''}</span></p>`
            : '<p class="loc">root unsigned: this archive rests on the capture alone.</p>';
        return `<section class="merkle"><h2>${esc(sj.title)}</h2><p class="loc">contract ${esc(man.canonicalization)} + ${esc(man.segmentation)}, ${man.leaves.length} ${man.leaves.length === 1 ? 'block' : 'blocks'}. root <code class="mk-root">${esc(man.root)}</code></p>${sigLine}${tree}<p class="mk-what loc"></p>${rows}</section>`;
    }).join('\n') : '';

    // The other direction of the same fold: the review is a document too.
    // Its judgements, sorted, are leaves; the root is what a signature
    // covers. Sign one line and every judgement is covered, and any one of
    // them can later be proven to sit inside the signed review.
    let reviewMerkle = '';
    let roots = null;
    if (withMan.length && committedReview && committedReview.judgements && Object.keys(committedReview.judgements).length) {
        const entries = Object.entries(committedReview.judgements).sort(([a], [b]) => (a < b ? -1 : 1));
        // The output itself is the FIRST leaf. A signature over judgements
        // alone says nothing about prose that shifted around them; with the
        // output's root folded in, changing one word of the text moves this
        // root and the old signature visibly stops matching.
        const oman = buildManifest(subjects.map((sj) => `${sj.id} ${String(sj.claim).replace(/\s+/g, ' ').trim()}`).join('\n'), { html: false });
        const rman = reviewRootOf(committedReview.judgements, oman.root);
        const reviewTree = drawTree(rman);
        const labels = ['the output itself, all of it (root ' + oman.root.slice(0, 10) + '\u2026)', ...entries.map(([, v]) => `${v.src}.${v.field}: ${v.verdict === 'fair' ? 'yes' : 'no'}`)];
        const leafRows = labels.map((label, i) => `<div class="mk-leaf" data-leaf="${i}" data-fields=""><span class="mk-nr">${String(i + 1).padStart(2, '0')}</span><code class="mk-hash">${esc(rman.leaves[i].hash.slice(0, 12))}\u2026</code><span class="mk-text">${esc(label)}</span></div>`).join('');
        roots = { review: rman.root, output: oman.root, sources: Object.fromEntries(Object.entries(manifests).map(([id, m]) => [id, m.root])) };
        reviewMerkle = `<section class="merkle" data-kind="review"><h2>The review itself</h2><p class="loc">${entries.length} judgements and the output they were given on, each a leaf. root <code class="mk-root">${esc(rman.root)}</code></p><p class="loc">this root is what the reviewer signs: one signature covers every judgement and the exact text it stood on. Change the output and this root moves, so the old signature no longer matches.</p>${reviewTree}<p class="mk-what loc"></p>${leafRows}</section>`;
    }

    const built = new Date().toISOString().slice(0, 10);
    const committedTag = committedReview
        ? `<script>window.PROVEML_REVIEW_COMMITTED=${JSON.stringify(committedReview).replace(/</g, '\\u003c')}</script>\n`
        : '';

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ProveML ${esc(name)}</title><style>${CSS}</style></head><body>
<div class="wrap">
<div class="reviewbar"><h1 class="lockup">${brand ? (brand.mark ? `<span class="brand-mark">${esc(brand.mark)}</span>` : '') : MERKTEKEN}<span class="pml-name">${esc(brand && brand.name ? brand.name : 'proveml')}</span><span class="tool">${esc(name)}</span></h1><span class="rv-view" role="group" aria-label="view"><button class="rv-vw" data-view="sources" aria-pressed="true">by source</button><button class="rv-vw" data-view="full" aria-pressed="false">full text</button>${merkleTab}</span><span class="rv-nav"><button id="rv-prev-src" class="rv-act rv-arrow" aria-label="previous source">\u2191</button><button id="rv-next-src" class="rv-act rv-arrow" aria-label="next source">\u2193</button></span><span id="rv-progress"></span><div class="rv-meter"><div class="rv-fill"></div></div><span class="rv-actions"><button id="rv-next" class="rv-btn rv-primary">next unjudged</button><button id="rv-literal" class="rv-btn">say yes to the plain ones</button><label class="rv-filter"><input type="checkbox" id="rv-only"> only unjudged</label><button id="rv-export" class="rv-link">copy review as JSON</button></span></div>
<p class="statline">store ${esc(storeName)}, ${subjects.length} ${esc(subjectsWord)}: <b>${verified}/${total} claims machine-verified</b>, built ${built}${brand ? ' on proveml' : ''}.</p>
${cards}
${merkleView}${reviewMerkle}
</div>${committedTag}<script>${SCRIPT}</script></body></html>`;

    return { html, verified, total, ids, proofs, roots };
}

function isLiteral(e) {
    if (e.basis !== 'quote') return false;
    const quotes = e.sourceQuotes ? e.sourceQuotes.map((q) => q.sourceQuote) : [e.sourceQuote];
    const v = squash(String(e.claimValue)).toLowerCase();
    if (!v) return false;
    return quotes.some((q) => squash(String(q || '')).toLowerCase().includes(v));
}

/**
 * The quote's neighbourhood in its snapshot, for the hover tip. The reviewer
 * judges a reading faster when the sentences around the quote come to them
 * instead of asking a click into the archive. Text is escaped here; the only
 * markup in the tip is our own <b> around the quote.
 */
function quoteContext(snap, quote, span = 170) {
    if (snap === undefined) return '';
    const hay = squash(snap), needle = squash(quote);
    const i = hay.indexOf(needle);
    if (i < 0) return '';
    let a = Math.max(0, i - span), b = Math.min(hay.length, i + needle.length + span);
    if (a > 0) a = hay.indexOf(' ', a) + 1;
    if (b < hay.length) b = hay.lastIndexOf(' ', b);
    const pre = (a > 0 ? '\u2026' : '') + hay.slice(a, i);
    const post = hay.slice(i + needle.length, b) + (b < hay.length ? '\u2026' : '');
    return `${esc(pre)}<b>${esc(needle)}</b>${esc(post)}`.replace(/"/g, '&quot;');
}

/**
 * Draw the tree, root on top, node width = leaf span. An odd node that is
 * promoted unchanged to the next level (CT-style) is marked carried and
 * drawn hollow: the same hash twice is the rule working, not a bug, and
 * the dress must say so.
 */
function drawTree(man) {
    const lv = treeLevels(man);
    let spans = man.leaves.map((l) => ({ lo: l.i, hi: l.i }));
    let prev = new Set();
    const rows = [];
    for (let d = 0; d < lv.length; d++) {
        rows.push(`<div class="mk-row">${lv[d].map((h, j) => {
            const carried = prev.has(`${spans[j].lo}:${spans[j].hi}`);
            return `<span class="mk-node${d === lv.length - 1 ? ' mk-node-root' : ''}${carried ? ' mk-carried' : ''}" data-lo="${spans[j].lo}" data-hi="${spans[j].hi}"${carried ? ' title="carried up unchanged: an odd node has no partner at this level"' : ''} style="flex-grow:${spans[j].hi - spans[j].lo + 1}">${esc(h.slice(0, 8))}</span>`;
        }).join('')}</div>`);
        prev = new Set(spans.map((x) => `${x.lo}:${x.hi}`));
        const next = [];
        for (let j = 0; j < spans.length; j += 2) next.push({ lo: spans[j].lo, hi: (j + 1 < spans.length ? spans[j + 1] : spans[j]).hi });
        spans = next;
    }
    return `<div class="mk-tree" aria-hidden="true">${rows.reverse().join('')}</div>`;
}

/**
 * The anchor of a reading: its block's hash plus the hashes of the blocks
 * either side. Meaning is not block-local: "figures below are audited" one
 * line above can invert a byte-identical value beneath it. So a yes must
 * die when the neighborhood moves, not only when the quoted block does.
 */
function anchorsFor(manifest, bundles) {
    const out = [];
    for (const b of bundles) {
        for (const j of [b.leafIndex - 1, b.leafIndex, b.leafIndex + 1]) {
            if (j >= 0 && j < manifest.leaves.length) out.push(manifest.leaves[j].hash);
        }
    }
    return out;
}

function proofNoteFor(s, e, manifest, b, proofs, lead, signature) {
    if (!manifest || !b) return '';
    const neighborhood = [b.leafIndex - 1, b.leafIndex, b.leafIndex + 1]
        .filter((j) => j >= 0 && j < manifest.leaves.length)
        .map((j) => manifest.leaves[j].hash);
    proofs.push({ subject: s.id, field: e.field, ...b, neighborhood, ...(signature ? { signedBy: signature.issuer, ...(signature.method ? { signatureMethod: signature.method } : {}) } : {}) });
    const signed = signature ? `, <span class="sig">root signed by ${esc(signature.issuer)}</span>` : '';
    return `${lead ? ', ' : ''}block ${b.leafIndex + 1} of ${manifest.leaves.length}, root ${esc(b.root.slice(0, 10))}\u2026${signed}`;
}

function evidenceBlock(s, e, snapshots, ids, manifest, proofs, signature) {
    const literal = isLiteral(e);
    let rid;
    let bundles = null;
    let body;
    if (e.basis === 'quote') {
        // One value may rest on several quotes: a composite label whose
        // elements live in different sentences. Every quote passes the same
        // verbatim gate; the judgement hash covers them all.
        const quotes = e.sourceQuotes || (e.sourceQuote ? [{ sourceQuote: e.sourceQuote, sourceLocator: e.sourceLocator }] : []);
        if (!quotes.length) throw new Error(`${s.id}.${e.field}: basis "quote" without a sourceQuote.`);
        for (const q of quotes) {
            if (!q.sourceQuote) throw new Error(`${s.id}.${e.field}: a quotes entry without a sourceQuote.`);
            if (snapshots[s.id] !== undefined && !squash(snapshots[s.id]).includes(squash(q.sourceQuote))) {
                throw new Error(`${s.id}.${e.field}: quote not found verbatim in the snapshot.`);
            }
        }
        if (manifest) {
            bundles = quotes.map((q) => {
                try { return quoteEvidence(manifest, q.sourceQuote); }
                catch (err) { throw new Error(`${s.id}.${e.field}: ${err.message}`); }
            });
        }
        rid = evidenceReviewId(s.id, e, bundles ? anchorsFor(manifest, bundles) : undefined);
        ids.push(rid);
        if (quotes.length === 1) {
            const q = quotes[0];
            const loc = q.sourceLocator ? `<b>${esc(String(q.sourceLocator).replace(/_/g, ' '))}</b>` : '';
            const link = e.sourceHref ? `${loc ? ', ' : ''}verbatim in the <a href="${attr(e.sourceHref)}">archived source</a>` : '';
            const pn = proofNoteFor(s, e, manifest, bundles && bundles[0], proofs, loc || link, signature);
            const ctx = quoteContext(snapshots[s.id], q.sourceQuote);
            body = `<p class="quote"${ctx ? ` title="${ctx}"` : ''}>\u201C${esc(q.sourceQuote)}\u201D</p>${loc || link || pn ? `<p class="loc">${loc}${link}${pn}</p>` : ''}`;
        } else {
            body = quotes.map((q, qi) => {
                const pn = proofNoteFor(s, e, manifest, bundles && bundles[qi], proofs, q.sourceLocator, signature);
                const loc = q.sourceLocator || pn ? `<p class="loc">${esc(String(q.sourceLocator || '').replace(/_/g, ' '))}${pn}</p>` : '';
                const ctx = quoteContext(snapshots[s.id], q.sourceQuote);
                return `<p class="quote"${ctx ? ` title="${ctx}"` : ''}>\u201C${esc(q.sourceQuote)}\u201D</p>${loc}`;
            }).join('');
            body += `<p class="loc">each verbatim in the${e.sourceHref ? ` <a href="${attr(e.sourceHref)}">archived source</a>` : ' archived source'}</p>`;
        }
    } else if (e.basis === 'derived') {
        rid = evidenceReviewId(s.id, e);
        ids.push(rid);
        body = `<p class="basis basis-derived">derived, not quoted</p>`;
    } else if (e.basis === 'absence') {
        rid = evidenceReviewId(s.id, e);
        ids.push(rid);
        // An absence is the one reading no quote can carry: the only honest
        // evidence is the whole source, handed to the reviewer to scan. So
        // when the archive is here, it unfolds right under the claim.
        body = `<p class="basis basis-absence">rests on absence: you cannot quote a source not having something</p>`;
        if (snapshots[s.id] !== undefined) {
            body += `<details class="ev-scan"><summary>read the whole source and see for yourself</summary><div class="ev-scan-text">${esc(snapshots[s.id])}</div></details>`;
        }
    } else {
        throw new Error(`${s.id}.${e.field}: unknown basis "${e.basis}".`);
    }
    if (!rid) { rid = evidenceReviewId(s.id, e); ids.push(rid); }
    return `<div class="evidence" data-evidence-field="${attr(e.field)}"${literal ? ' data-literal' : ''}><p class="ev-head"><code>${esc(e.field)}</code> = <b>${esc(String(e.claimValue))}</b>${literal ? '<span class="lit">value appears in the quote</span>' : ''}</p>${body}${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}
<div class="reading" data-review="${rid}" data-src="${attr(s.id)}" data-field="${attr(e.field)}"${literal ? ' data-literal' : ''}><span class="j">our reading</span><span class="q">${literal ? 'the value is right there in the quote' : 'did it read this right?'}</span>
<div class="review"><button class="rv" data-verdict="fair">yes</button><button class="rv" data-verdict="flag">no</button><span class="rv-state"></span></div></div></div>`;
}

/** The ProveML mark: a claim, and the record beneath it that must carry it. */
const MERKTEKEN = `<svg class="merkteken" viewBox="2 5 28 20" role="img" aria-label="ProveML"><defs><linearGradient id="merk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6ee7a8"/><stop offset="1" stop-color="#6d9bff"/></linearGradient><filter id="merk-gloed" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.2"/></filter></defs><circle cx="16" cy="12" r="5.4" fill="#6ee7a8" filter="url(#merk-gloed)" opacity=".45"/><circle cx="16" cy="12" r="4.6" fill="url(#merk)"/><rect x="3" y="21" width="26" height="2.6" rx="1.3" fill="url(#merk)"/></svg>`;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;700;800;900&family=Spline+Sans+Mono:wght@400;500&display=swap');
:root{--night:#14233b;--sky:#f2f6f7;--haze:#a8bfc9;--ink:#0e2433;--muted:#47616f;--haze-line:rgba(14,36,51,.18);--card:#fafcfd;--tint:#dfe8eb;--mark-ok:#126b3a;--mark-ok-lijn:rgba(18,107,58,.5);--mark-inf:#0e5730;--mark-inf-vlak:rgba(18,107,58,.14);--mark-bad:#a8352a;--mark-bad-lijn:rgba(168,53,42,.7);--mark-unk:#a35a06;--accent:#1a4fb4;--tip-vlak:#0e2433;--tip-ink:#f2f6f7;--merk-grad:linear-gradient(105deg,#126b3a,#1a4fb4);--shadow:0 2px 4px rgba(14,36,51,.08),0 18px 50px rgba(14,36,51,.16)}
*{box-sizing:border-box}
html{background:var(--sky);color-scheme:light}
html,body{overflow-x:clip}
body{margin:0;background:var(--sky);color:var(--ink);font-family:Lato,system-ui,sans-serif;font-size:1.0625rem;line-height:1.7;-webkit-font-smoothing:antialiased}
body::after{content:'';position:fixed;inset:-50%;z-index:80;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.2 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:300px 300px;opacity:.28;animation:grain 3.2s steps(3) infinite}
@keyframes grain{0%,100%{transform:translate(0,0)}25%{transform:translate(-1.2%,.8%)}50%{transform:translate(.6%,-1%)}75%{transform:translate(-.4%,1.2%)}}
@media (prefers-reduced-motion:reduce){body::after{animation:none}}
.wrap{max-width:74rem;margin:0 auto;padding:2.5rem 1.5rem 5rem}
.lockup{display:flex;align-items:center;gap:.45rem;margin:0 .4rem 0 0}
.reviewbar .pml-name{font-size:1.2rem}
.reviewbar .merkteken{height:1.15rem}
.reviewbar .tool{font-size:.9rem;margin-left:.1rem}
.lockup .tool{font-family:Lato,sans-serif;font-size:1.5rem;font-weight:400;letter-spacing:-.02em;color:var(--muted);margin-left:.1rem}
.lockup .merkteken{height:1.45rem;width:auto}
.pml-name{font-family:Lato,sans-serif;font-size:1.5rem;font-weight:800;letter-spacing:-.02em;color:var(--accent);background:var(--merk-grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
h2{font-weight:700;font-size:1.15rem;margin:0;color:var(--ink)}
a{color:var(--accent)}
.meta,.lbl,.loc{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.78rem;color:var(--muted)}
.statline{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.85rem;color:var(--muted);margin:0 0 2.2rem}
.statline b{color:var(--mark-ok);font-weight:500}
.reviewbar{position:sticky;top:0;z-index:6;display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin:0 0 1rem;padding:.8rem 0;background:var(--sky);border-bottom:1px solid var(--haze-line);font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.85rem;color:var(--muted)}
.rv-meter{flex:1 1 auto;min-width:6rem;height:5px;background:var(--tint)}
.rv-fill{height:100%;width:0;background:var(--accent);transition:width .25s}
.rv-actions{margin-left:auto;display:flex;gap:1.4rem;align-items:center;flex-wrap:wrap}
.rv-act{font-family:inherit;font-size:.8rem;letter-spacing:.02em;background:none;border:none;padding:0;color:var(--muted);cursor:pointer;transition:color .15s ease,translate .15s ease;-webkit-tap-highlight-color:transparent}
.rv-act:hover:not(:disabled){color:var(--accent);translate:.12em 0}
.rv-act:disabled{opacity:.55;cursor:default}
.rv-act:focus{outline:none}
.rv-act:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rv-view{display:flex;gap:.35rem}
.rv-vw{font-family:inherit;font-size:.72rem;letter-spacing:.04em;padding:.25rem .7rem;border:1px solid var(--haze-line);border-radius:999px;background:none;color:var(--muted);cursor:pointer;transition:background .12s,color .12s,border-color .12s;-webkit-tap-highlight-color:transparent}
.rv-vw:hover{border-color:var(--muted);color:var(--ink)}
.rv-vw[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--card)}
.rv-vw:focus{outline:none}
.rv-vw:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
body[data-view=full] .cols{grid-template-columns:1fr}
body[data-view=full] .col+.col{display:none}
body[data-view=full] .col:first-child{position:static;background:none;border:none;padding:0;font-size:1.0625rem}
body[data-view=full] .col:first-child .lbl{display:none}
body[data-view=full] .pair[data-closed] .cols,body[data-view=full] .pair[data-all-judged]:not([data-open]) .cols{display:grid}
body[data-view=full] .pair{border-top:none;padding:.1rem 0}
body[data-view=full] .pair>header{display:none}
body[data-view=full] .cols{margin-top:0}
.merkle{display:none;border-top:1px solid var(--haze-line);padding:1.3rem 0 .9rem}
.mk-intro{border-top:none;padding-top:0}
.mk-intro p{max-width:60ch;margin:0;color:var(--muted)}
body[data-view=merkle] .pair{display:none}
body[data-view=merkle] .merkle{display:block}
.mk-root{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.78rem;word-break:break-all;color:var(--ink)}
.merkle[data-stale] .mk-root{color:var(--mark-bad);text-decoration:line-through;text-decoration-color:var(--mark-bad-lijn)}
.mk-leaf{display:flex;gap:.8rem;align-items:baseline;padding:.4rem 0;border-top:1px dashed var(--haze-line);cursor:pointer}
.mk-leaf:hover .mk-hash{color:var(--accent)}
.mk-nr{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.72rem;color:var(--muted)}
.mk-hash{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.76rem;color:var(--muted)}
.mk-text{flex:1;font-size:.95rem}
.mk-used{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.72rem;color:var(--mark-inf)}
.mk-leaf[data-edited] .mk-hash,.mk-leaf[data-edited] .mk-text{color:var(--mark-bad)}
.mk-leaf[data-edited] .mk-hash{text-decoration:line-through}
.mk-what{min-height:1.2em}
.sig{color:var(--mark-ok)}
.mk-tree{display:flex;flex-direction:column;gap:.35rem;margin:.4rem 0 1rem}
.mk-row{display:flex;gap:.35rem}
.mk-node{flex:1 1 0;font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.68rem;letter-spacing:.02em;color:var(--muted);background:var(--tint);border-radius:2px;padding:.18rem .4rem;text-align:center;overflow:hidden;white-space:nowrap;transition:background .2s,color .2s}
.mk-node-root{color:var(--ink);font-weight:500;background:var(--tint)}
.mk-node[data-stale]{background:var(--mark-bad);color:var(--card)}
.mk-node.mk-carried{background:none;border:1px dashed var(--haze-line);color:var(--muted)}
.mk-node[data-hot=self],.mk-node[data-hot=path]{background:var(--accent);color:var(--card);border-color:var(--accent)}
.mk-node[data-hot=proof]{background:var(--card);color:var(--accent);box-shadow:inset 0 0 0 1.5px var(--accent)}
.rv-nav{display:flex;gap:.7rem}
.rv-arrow{font-size:.9rem;line-height:1.4}
#rv-progress{font-family:Lato,sans-serif;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ink)}
.rv-link{font-family:inherit;font-size:inherit;background:none;border:none;padding:0;color:var(--muted);cursor:pointer;text-decoration:none;text-underline-offset:.3em;transition:color .2s ease;-webkit-tap-highlight-color:transparent}
.rv-link:hover{color:var(--accent);text-decoration:underline;text-decoration-color:var(--accent)}
.rv-btn{font-family:inherit;font-size:.78rem;letter-spacing:.03em;background:none;border:1px solid var(--muted);border-radius:999px;padding:.32rem .9rem;color:var(--ink);cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease;-webkit-tap-highlight-color:transparent}
.rv-btn:hover{border-color:var(--accent);color:var(--accent)}
.rv-btn:active{background:var(--accent);border-color:var(--accent);color:var(--card)}
.rv-btn:focus{outline:none}
.rv-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rv-btn.rv-primary{background:var(--accent);border-color:var(--accent);color:var(--card)}
.rv-btn.rv-primary:hover{background:var(--ink);border-color:var(--ink);color:var(--card)}
.rv-link:focus{outline:none}
.rv-link:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rv-filter{display:flex;gap:.45rem;align-items:center;cursor:pointer;transition:color .2s ease}
.rv-filter:hover{color:var(--ink)}
.rv-filter input{accent-color:var(--accent);width:.9em;height:.9em;margin:0}
.pair{border-top:1px solid var(--haze-line);padding:1.6rem 0 1.2rem;scroll-margin-top:3.9rem}
.reviewbar+.pair,.statline+.pair{border-top:none}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-top:1rem;align-items:start}
.col:first-child{position:sticky;top:9.2rem}
@media (max-width:52rem){.cols{grid-template-columns:1fr}.col:first-child{position:static}.pair>header{position:static}}
.col{background:var(--card);border:1px solid var(--haze-line);border-radius:4px;padding:1rem 1.2rem;font-size:1rem}
.lbl{margin-bottom:.6rem;color:var(--muted)}
.col p{margin:0 0 .8rem}.note{color:var(--muted);font-size:.9rem}.quote{font-style:italic;font-size:.95rem;margin:0 0 .35rem;padding-left:.85rem;border-left:2px solid var(--haze-line)}.quote[data-tip]{cursor:help}
.brand-mark{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:1.02rem;letter-spacing:0;color:var(--ink)}
.evidence{padding:.7rem 0;border-top:1px dashed var(--haze-line)}
.evidence:first-child{border-top:none;padding-top:0}
.ev-scan{margin:.2rem 0 .5rem}
.ev-scan summary{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.74rem;color:var(--accent);cursor:pointer}
.ev-scan-text{white-space:pre-wrap;font-size:.88rem;color:var(--muted);border-left:2px solid var(--haze-line);padding-left:.85rem;margin:.4rem 0 0;max-height:16rem;overflow:auto}
.ev-head{margin:0 0 .4rem}.ev-head code{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.82rem}
.basis{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.74rem;margin:0 0 .3rem}
.basis-derived{color:var(--muted)}
.basis-absence{color:var(--mark-unk)}
.evidence.paired{background:var(--mark-inf-vlak);border-radius:3px;box-shadow:0 0 0 6px var(--mark-inf-vlak)}
.review{display:flex;gap:.5rem;align-items:center;margin:0 0 0 auto}
button.rv{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.72rem;letter-spacing:.04em;padding:.3rem .7rem;border:1px solid var(--haze-line);border-radius:999px;background:none;color:var(--muted);cursor:pointer;transition:background .12s,color .12s,border-color .12s,opacity .12s;-webkit-tap-highlight-color:transparent}
button.rv:hover{border-color:var(--muted);color:var(--ink)}
button.rv:focus{outline:none}
button.rv:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rv-state{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.72rem}
.reading[data-state=fair]{color:var(--ink)}
.reading[data-state=fair] .rv-state{color:var(--mark-ok)}
.reading[data-state=flag] .rv-state{color:var(--mark-bad)}
.reading[data-state=fair] button[data-verdict=fair]{background:var(--mark-ok);border-color:var(--mark-ok);color:var(--card)}
.reading[data-state=flag] button[data-verdict=flag]{background:var(--mark-bad);border-color:var(--mark-bad);color:var(--card)}
.reading[data-state=fair] button[data-verdict=flag],.reading[data-state=flag] button[data-verdict=fair]{opacity:.45}
.reading[data-state=fair] button[data-verdict=flag]:hover,.reading[data-state=flag] button[data-verdict=fair]:hover{opacity:1}
.pair[data-flagged] h2:after{content:" \u2691";color:var(--mark-bad)}
.pair>header{cursor:pointer;position:sticky;top:3.8rem;z-index:5;background:var(--sky);padding:.45rem 0 .35rem;box-shadow:0 -.8rem 0 var(--sky)}
.nr{font-family:Lato,sans-serif;font-size:.95rem;font-weight:700;font-variant-numeric:tabular-nums;color:var(--muted);margin-right:.65rem}
.pair[data-closed] .cols,.pair[data-all-judged]:not([data-open]) .cols{display:none}
.pair[data-all-judged] .meta:after{content:" All readings judged.";color:var(--mark-ok)}
.lit{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.7rem;color:var(--muted);margin-left:.6em}
.evidence[data-judged]:not([data-expanded])>:not(.ev-head){display:none}
.evidence[data-judged]:not([data-expanded]){cursor:pointer;padding:.45rem 0}
.evidence[data-judged]:not([data-expanded]) .ev-head{margin:0;opacity:.85}
.evidence[data-judged] .ev-head:after{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.72rem;margin-left:.5em}
.evidence[data-judged=fair] .ev-head:after{content:"\u2713 yes";color:var(--mark-ok)}
.evidence[data-judged=flag] .ev-head:after{content:"\u2691 no";color:var(--mark-bad)}
.evidence[data-judged][data-expanded] .ev-head{cursor:pointer}
body[data-only-unjudged] .pair[data-all-judged]{display:none}
.reading{color:var(--muted);background:rgba(14,36,51,.04);border-radius:4px;padding:.45rem .7rem;margin-top:.55rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.reading .q{font-size:.92rem}
.reading .j{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.68rem;letter-spacing:.07em;border:1px dashed var(--haze-line);border-radius:999px;padding:.12em .55em;margin-right:.4em;color:var(--muted)}
.loc{margin:0 0 1rem}.loc b{font-weight:500;color:var(--muted)}.loc a{color:var(--muted)}
.proveml-entity.proveml-verified{color:var(--mark-ok);border:1px solid var(--mark-ok-lijn);border-radius:2px;padding:.05em .35em}
.proveml-fact.proveml-verified{color:var(--mark-ok);border-bottom:1.5px dotted var(--mark-ok)}
.proveml-mismatch,.proveml-name-mismatch{color:var(--mark-bad);text-decoration:line-through;text-decoration-color:var(--mark-bad-lijn)}
.proveml-unverifiable,.proveml-no-context,.proveml-entity:not(.proveml-verified){color:var(--mark-unk);border-bottom:1.5px dashed var(--mark-unk)}
.proveml-entity,.proveml-fact{cursor:help}
.col .proveml-fact[data-judge]{cursor:pointer}
.col .proveml-fact[data-judge=open]{background:rgba(26,79,180,.12);border-radius:2px;box-shadow:0 0 0 2px rgba(26,79,180,.12)}
.col .proveml-fact[data-judge=flag]{color:var(--mark-bad);text-decoration:line-through;text-decoration-color:var(--mark-bad-lijn)}
.proveml-hilite{background:var(--mark-inf-vlak);border-radius:2px}
#tip{position:fixed;z-index:9;max-width:26rem;background:var(--tip-vlak);color:var(--tip-ink);font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.74rem;line-height:1.5;padding:.5rem .65rem;border-radius:3px;pointer-events:none;box-shadow:0 8px 24px rgba(14,36,51,.25)}
#tip b{color:#7de9f7;font-weight:500}
`;

const SCRIPT = `
// Judgements are keyed by a hash of exactly what was judged, so a saved
// verdict never applies to changed content. A committed review may be baked
// in as PROVEML_REVIEW_COMMITTED; local judgements overlay it, and the export
// merges both, ready to be committed as the new durable copy.
const KEY = 'proveml-review:' + (document.body.dataset.reviewKey || location.pathname);
const committed = (window.PROVEML_REVIEW_COMMITTED && window.PROVEML_REVIEW_COMMITTED.judgements) || {};
let local = {}; try { local = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
const merged = () => { const m = { ...committed }; for (const [k, v] of Object.entries(local)) { if (v === null) delete m[k]; else m[k] = v; } return m; };
const readings = [...document.querySelectorAll('.reading[data-review]')];
function persist() { try { localStorage.setItem(KEY, JSON.stringify(local)); } catch {} }
function paint() {
    const saved = merged();
    let judged = 0, flagged = 0;
    for (const el of readings) {
        const v = saved[el.dataset.review];
        el.dataset.state = v ? v.verdict : '';
        el.querySelector('.rv-state').textContent = v ? (v.verdict === 'fair' ? '\\u2713 yes, ' : '\\u2691 no, ') + v.at.slice(0, 10) : 'unjudged';
        if (v) { judged++; if (v.verdict === 'flag') flagged++; }
        const ev = el.closest('.evidence');
        if (ev) { if (v) ev.dataset.judged = v.verdict; else { delete ev.dataset.judged; ev.removeAttribute('data-expanded'); } }
    }
    for (const card of document.querySelectorAll('.pair')) {
        const rs = [...card.querySelectorAll('.reading[data-review]')];
        card.toggleAttribute('data-all-judged', rs.length > 0 && rs.every(r => saved[r.dataset.review]));
        card.toggleAttribute('data-flagged', rs.some(r => (saved[r.dataset.review] || {}).verdict === 'flag'));
    }
    // The text carries the review state too: a fact goes green when its
    // readings are judged fair, red when one is flagged, amber while a human
    // still has to look. In full view, clicking it goes to the reading.
    for (const card of document.querySelectorAll('.pair')) {
        const byField = {};
        for (const r of card.querySelectorAll('.reading[data-review]')) {
            const v = saved[r.dataset.review];
            const st = v ? v.verdict : 'open';
            const cur = byField[r.dataset.field];
            byField[r.dataset.field] = cur === 'flag' || st === 'flag' ? 'flag' : (cur === 'open' || st === 'open' ? 'open' : st);
        }
        for (const fEl of card.querySelectorAll('.col .proveml-fact')) {
            const field = (fEl.dataset.path || '').split('.').slice(1).join('.');
            if (field && byField[field]) fEl.dataset.judge = byField[field];
        }
    }
    const needEye = readings.filter((r) => !r.hasAttribute('data-literal') && !saved[r.dataset.review]).length;
    const litOpen = readings.filter((r) => r.hasAttribute('data-literal') && !saved[r.dataset.review]).length;
    document.getElementById('rv-progress').textContent =
        judged + '/' + readings.length + ' judged' + (flagged ? ', ' + flagged + ' said no' : '')
        + (judged < readings.length ? ', ' + needEye + ' your call, ' + litOpen + ' plain to see' : '');
    const lb = document.getElementById('rv-literal');
    if (lb) {
        lb.style.display = litOpen ? '' : 'none';
        lb.textContent = litOpen === 1 ? 'say yes to the plain one' : 'say yes to the ' + litOpen + ' plain ones';
    }
    document.querySelector('.rv-fill').style.width = (readings.length ? Math.round(judged / readings.length * 100) : 0) + '%';
    document.getElementById('rv-next').style.display = judged === readings.length ? 'none' : '';
    document.getElementById('rv-sign')?.classList.toggle('rv-primary', judged === readings.length);
}
document.addEventListener('click', (e) => {
    const b = e.target.closest('button.rv[data-verdict]');
    if (b) {
        const el = b.closest('.reading');
        const id = el.dataset.review;
        const cur = merged()[id];
        if (cur && cur.verdict === b.dataset.verdict) {
            if (committed[id]) local[id] = null; else delete local[id];
        } else {
            local[id] = { verdict: b.dataset.verdict, src: el.dataset.src, field: el.dataset.field, at: new Date().toISOString() };
        }
        persist(); paint(); b.blur();
        if (merged()[id]) el.closest('.evidence')?.removeAttribute('data-expanded');
    }
    if (e.target.id === 'rv-literal') {
        for (const r of readings) if (r.hasAttribute('data-literal') && !merged()[r.dataset.review]) {
            local[r.dataset.review] = { verdict: 'fair', src: r.dataset.src, field: r.dataset.field, literal: true, at: new Date().toISOString() };
        }
        persist(); paint();
    }
    if (!b) {
        const ev = e.target.closest('.evidence[data-judged]');
        if (ev && !e.target.closest('a')) {
            if (!ev.hasAttribute('data-expanded')) ev.setAttribute('data-expanded', '');
            else if (e.target.closest('.ev-head')) ev.removeAttribute('data-expanded');
        }
        const hd = e.target.closest('.pair > header');
        if (hd) {
            const p = hd.parentElement;
            if (p.hasAttribute('data-all-judged')) p.toggleAttribute('data-open');
            else p.toggleAttribute('data-closed');
        }
    }
    const pf = e.target.closest('.col .proveml-fact[data-judge]');
    if (pf && document.body.dataset.view === 'full') {
        const field = (pf.dataset.path || '').split('.').slice(1).join('.');
        const card = pf.closest('.pair');
        document.body.dataset.view = 'sources';
        document.querySelectorAll('.rv-vw').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === 'sources')));
        card.removeAttribute('data-closed');
        if (card.hasAttribute('data-all-judged')) card.setAttribute('data-open', '');
        const ev = card.querySelector('.evidence[data-evidence-field="' + field + '"]');
        if (ev) { ev.scrollIntoView({ block: 'center' }); ev.classList.add('paired'); setTimeout(() => ev.classList.remove('paired'), 1600); }
        return;
    }
    const mk = e.target.closest('.mk-leaf');
    if (mk) {
        mk.toggleAttribute('data-edited');
        const sec = mk.closest('.merkle');
        const edited = Array.from(sec.querySelectorAll('.mk-leaf[data-edited]'));
        sec.toggleAttribute('data-stale', edited.length > 0);
        const idx = edited.map((l) => Number(l.dataset.leaf));
        for (const n of sec.querySelectorAll('.mk-node')) {
            n.toggleAttribute('data-stale', idx.some((i) => i >= Number(n.dataset.lo) && i <= Number(n.dataset.hi)));
        }
        const fields = Array.from(new Set(edited.flatMap((l) => (l.dataset.fields || '').split(', ').filter(Boolean))));
        sec.querySelector('.mk-what').textContent = edited.length
            ? (sec.dataset.kind === 'review'
                ? 'change a judgement and this root changes: the signature that covered the review no longer matches'
                : (edited.length === 1 ? 'if this block changes' : 'if these ' + edited.length + ' blocks change') + ', the root changes'
                  + (fields.length ? ' and these readings reopen: ' + fields.join(', ') : '; no readings are bound here, nothing reopens'))
            : '';
        return;
    }
    const vw = e.target.closest('.rv-vw');
    if (vw) {
        document.body.dataset.view = vw.dataset.view;
        document.querySelectorAll('.rv-vw').forEach((b) => b.setAttribute('aria-pressed', String(b === vw)));
    }
    if (e.target.id === 'rv-prev-src' || e.target.id === 'rv-next-src') {
        const ps = [...document.querySelectorAll('.pair')];
        let ci = -1;
        ps.forEach((p, i) => { if (p.getBoundingClientRect().top <= 80) ci = i; });
        const t = ps[e.target.id === 'rv-next-src' ? Math.min(ci + 1, ps.length - 1) : Math.max(ci - 1, 0)];
        if (t) t.scrollIntoView();
    }
    if (e.target.id === 'rv-next') {
        const saved = merged();
        const next = readings.find(r => !saved[r.dataset.review]);
        if (next) {
            const p = next.closest('.pair'); if (p) p.removeAttribute('data-closed');
            (next.closest('.evidence') || next).scrollIntoView({ block: 'center' });
        }
    }
    if (e.target.id === 'rv-export') {
        navigator.clipboard.writeText(JSON.stringify({ exported: new Date().toISOString(), judgements: merged() }, null, 1))
            .then(() => { e.target.textContent = 'copied'; setTimeout(() => e.target.textContent = 'copy review as JSON', 1500); });
    }
});
document.getElementById('rv-only').addEventListener('change', (e) => document.body.toggleAttribute('data-only-unjudged', e.target.checked));
paint();
// Served by review-flow, the gate is submittable; opened as a file, it is a
// checklist with a clipboard. The button appears only when the flag exists.
if (window.PROVEML_REVIEW_SUBMIT) {
    const btn = document.createElement('button');
    btn.id = 'rv-sign'; btn.className = 'rv-btn rv-primary'; btn.textContent = 'sign review';
    document.querySelector('.rv-actions').prepend(btn);
    paint();
    btn.addEventListener('click', async () => {
        // Browser-side signers hook in here: the event's detail.extra travels
        // with the POST, and a handler may return a promise via detail.wait.
        const detail = { review: { judgements: merged() }, extra: {}, wait: null };
        document.dispatchEvent(new CustomEvent('proveml:signing', { detail }));
        try { if (detail.wait) await detail.wait; } catch (e) { btn.textContent = 'signing failed'; setTimeout(() => { btn.textContent = 'sign review'; }, 2000); return; }
        fetch(window.PROVEML_REVIEW_SUBMIT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exported: new Date().toISOString(), judgements: merged(), ...detail.extra }) })
            .then((r) => { if (r.ok) { btn.textContent = 'signed'; btn.disabled = true; } });
    });
}
// Hovering the tree lights an inclusion proof: the node itself, the
// sibling hashes a verifier needs (amber), and the path it recomputes
// (green). The caption says it in words; the edit simulation keeps
// priority over the caption once a block is marked edited.
document.addEventListener('mouseover', (e) => {
    const n = e.target.closest('.mk-node, .mk-leaf');
    if (!n) return;
    const sec = n.closest('.merkle');
    if (!sec) return;
    const nodes = Array.from(sec.querySelectorAll('.mk-node'));
    let lo, hi;
    if (n.classList.contains('mk-leaf')) { lo = hi = Number(n.dataset.leaf); }
    else { lo = Number(n.dataset.lo); hi = Number(n.dataset.hi); }
    for (const x of nodes) delete x.dataset.hot;
    const self = nodes.find((x) => Number(x.dataset.lo) === lo && Number(x.dataset.hi) === hi);
    if (self) self.dataset.hot = 'self';
    const anc = nodes
        .filter((x) => Number(x.dataset.lo) <= lo && Number(x.dataset.hi) >= hi && !(Number(x.dataset.lo) === lo && Number(x.dataset.hi) === hi))
        .sort((p1, p2) => (Number(p1.dataset.hi) - Number(p1.dataset.lo)) - (Number(p2.dataset.hi) - Number(p2.dataset.lo)));
    let curLo = lo, curHi = hi, proof = 0;
    for (const par of anc) {
        par.dataset.hot = 'path';
        const plo = Number(par.dataset.lo), phi = Number(par.dataset.hi);
        const sib = nodes.find((x) =>
            (Number(x.dataset.lo) === curHi + 1 && Number(x.dataset.hi) === phi && plo === curLo)
            || (Number(x.dataset.hi) === curLo - 1 && Number(x.dataset.lo) === plo && phi === curHi));
        if (sib && sib.dataset.hot !== 'path') { sib.dataset.hot = 'proof'; proof++; }
        curLo = plo; curHi = phi;
    }
    if (!sec.querySelector('.mk-leaf[data-edited]')) {
        const w = sec.querySelector('.mk-what');
        const word = sec.dataset.kind === 'review' ? 'leaf' : 'block';
        let name = '';
        if (hi === lo && sec.dataset.kind === 'review') {
            const row = sec.querySelectorAll('.mk-leaf')[lo];
            if (row) name = ' (' + row.querySelector('.mk-text').textContent + ')';
        }
        if (w) w.textContent = word + (hi > lo ? 's ' + (lo + 1) + ' to ' + (hi + 1) : ' ' + (lo + 1)) + name
            + ': recompute the blue spine up to the root; the ' + proof + ' outlined ' + (proof === 1 ? 'hash is' : 'hashes are')
            + ' all a checker is handed';
    }
});
document.addEventListener('mouseout', (e) => {
    const n = e.target.closest('.mk-node, .mk-leaf');
    if (!n) return;
    const sec = n.closest('.merkle');
    if (!sec) return;
    for (const x of sec.querySelectorAll('.mk-node[data-hot]')) delete x.dataset.hot;
    if (!sec.querySelector('.mk-leaf[data-edited]')) {
        const w = sec.querySelector('.mk-what');
        if (w) w.textContent = '';
    }
});
// Instant tooltips with the proof path, off the title attribute so the
// browser's slow native tooltip never competes.
document.querySelectorAll('[title]').forEach(el => { el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); });
const tip = document.createElement('div'); tip.id = 'tip'; tip.hidden = true; document.body.appendChild(tip);
document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('.proveml-entity, .proveml-fact, .quote[data-tip]');
    if (!el) return;
    // Facts bold their own path; a quote arrives with its highlight baked in.
    tip.innerHTML = el.classList.contains('quote') ? (el.dataset.tip || '') : (el.dataset.tip || '').replace(/^([^ =]+)/, '<b>$1</b>');
    tip.hidden = !el.dataset.tip;
});
document.addEventListener('mousemove', (e) => {
    if (tip.hidden) return;
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    const y = e.clientY + 18 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 18;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
});
document.addEventListener('mouseover', (e) => {
    const f = e.target.closest('.col .proveml-fact');
    if (!f) return;
    const path = f.dataset.path || '';
    const field = path.split('.').slice(1).join('.');
    const card = f.closest('.pair');
    if (card && field) card.querySelectorAll('.evidence[data-evidence-field="' + field + '"]').forEach(x => x.classList.add('paired'));
});
document.addEventListener('mouseout', (e) => {
    if (e.target.closest?.('.col .proveml-fact')) document.querySelectorAll('.evidence.paired').forEach(x => x.classList.remove('paired'));
    if (e.target.closest?.('.proveml-entity, .proveml-fact, .quote[data-tip]')) tip.hidden = true;
});
`;
