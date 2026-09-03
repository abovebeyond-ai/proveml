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
import { renderProveml, PROVEML_CSS } from './render-html.js';
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
        manifests = {}, signatures = {}, sourceTitles = {}, adapters = null, localSources = [], sourceGroups = null, anchors = {}, runs = {}, allowMismatch = false, brandCss = '', brandCssSource = null, signoffs = [],
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
        // A mismatch is the most important thing a review page can show. With
        // allowMismatch the page carries it, red, and the reading's yes becomes a
        // guarded act; without it the build refuses, as a report page should.
        if (v.errors.length) {
            const mm = {};
            for (const err of v.errors) { const m = err.match(/^%\[([^\]]+)\]\{[^}]*\}(?: in .+?)?: should be (.+)$/); if (m) mm[m[1]] = m[2]; }
            if (!allowMismatch || Object.keys(mm).length !== v.errors.length) throw new Error(`${s.id}: ${v.errors.join('; ')}`);
            s.mismatch = mm;
        }
        const left = renderProveml(s.claim, store).html;
        const right = (s.evidence || []).map((e) => evidenceBlock(s, e, snapshots, ids, manifests[e.source || s.id], proofs, signatures[e.source || s.id])).join('');
        const meta = s.meta ? `${esc(s.meta)} ` : '';
        return `<section class="pair" id="${attr(s.id)}"${s.heading ? ' data-heading data-level="' + attr(s.level || 1) + '"' : ''}${s.pre ? ' data-pre' : ''}${s.scan ? ' data-scan="' + attr(s.scan) + '"' : ''}${s.capLead ? ' data-caption' : ''}${s.scan === 'clean' ? ' title="checked, nothing to confirm"' : ''}>
  <header><h2><span class="nr">${String(i + 1).padStart(2, '0')}</span>${esc(s.title)}</h2><p class="meta">${meta}${v.verified}/${v.total} claims verified, ${(s.evidence || []).length} fields of evidence.</p></header>
  <div class="cols">
    <div class="col"><div class="lbl">${esc(leftLabel)}</div>${s.image ? `<figure class="rv-fig"><img src="${attr(s.image.src)}" alt="${attr(s.image.alt || '')}"></figure>` : ''}${s.capLead ? `<span class="rv-cap-lead">${esc(s.capLead)}.</span> ` : ''}${left}</div>
    <div class="col"><div class="lbl">${esc(rightLabel)}</div>${right}</div>
  </div>
</section>`;
    }).join('\n');

    // The provenance view: what came in, through which adapter, folded into
    // which root, vouched for by whom; and what goes out. Keyed by SOURCE,
    // not by subject: a paragraph may cite several sources and a source
    // serves many paragraphs.
    const manIds = Object.keys(manifests);
    const merkleTab = manIds.length ? '<button class="rv-vw" data-view="merkle" aria-pressed="false"><svg class="rv-ico" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v3.5M8 6l-4 4M8 6l4 4M4 10v3.5M12 10v3.5"/></svg>provenance</button>' : '';
    // Attestation is a set, not a level: a source can be fetched over TLS,
    // held by an archive, timestamped and signed all at once, and each mark
    // is present or absent on its own. Fixed order, so eyes can compare
    // down the column.
    const MARKS = [
        ['copy', 'we hold a snapshot; on its own, nothing outside this machine vouches for it'],
        ['granted', 'received under a purpose-bound grant (PDPP): who authorised it, for what, projected to which fields'],
        ['tls', 'fetched over TLS, the certificate recorded'],
        ['archive', 'an independent archive holds a copy from the same day'],
        ['timestamp', 'a timestamp authority vouched that this root existed by a stated time'],
        ['signed', 'the issuer signed the root'],
        ['anchored', 'the root sits in a public ledger'],
    ];
    const marksOf = (id) => {
        const sig = signatures[id] || {};
        return { copy: true, granted: !!sig.grant, tls: !!sig.transport, archive: !!sig.witness, timestamp: !!sig.timestamp, signed: sig.level === 'signed', anchored: sig.level === 'anchored' };
    };
    const marksHtml = (id) => { const m = marksOf(id); return `<span class="mk-marks">${MARKS.map(([k, why]) => `<i${m[k] ? ' data-on' : ''} title="${attr(why)}">${k}</i>`).join('')}</span>`; };
    const usedBy = {};
    for (const pr of proofs) { const u = (usedBy[pr.root] = usedBy[pr.root] || {}); u[pr.leafIndex] = u[pr.leafIndex] || []; if (!u[pr.leafIndex].includes(pr.field)) u[pr.leafIndex].push(pr.field); }
    // The recipe a stranger runs: the block, one sibling hash per level, the
    // root. Full hashes, because a recipe with elided hashes cannot be run.
    const recipe = (pr) => {
        const path = (pr.proof && pr.proof.path) || [];
        return `<details class="ev-prov mk-recipe"><summary>check this block yourself: ${path.length} ${path.length === 1 ? 'hash' : 'hashes'}</summary><div class="ev-prov-body"><p>leaf = sha256("leaf" + NUL + the block's text) = <code class="h">${esc(pr.leafHash)}</code></p><ol>${path.map((st, k) => `<li>level ${k + 1}: sibling on the ${st.side === 'L' ? 'left' : 'right'} <code class="h">${esc(st.hash)}</code></li>`).join('')}<li>root <code class="h">${esc(pr.root)}</code></li></ol><p>at each level h = sha256("node" + NUL + (sibling on the left ? sibling + h : h + sibling)); the last h must equal the root above.</p></div></details>`;
    };
    const srcSection = (id) => {
        const man = manifests[id]; const sig = signatures[id];
        const used = usedBy[man.root] || {};
        const usedIdx = Object.keys(used).map(Number).sort((a, b) => a - b);
        const shown = new Set();
        for (const i of usedIdx) for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < man.leaves.length) shown.add(j);
        const rows = [...shown].sort((a, b) => a - b).map((i) => {
            const l = man.leaves[i]; const fields = used[i] || [];
            const pr = proofs.find((p) => p.root === man.root && p.leafIndex === i);
            return `<div class="mk-leaf${fields.length ? ' mk-quoted' : ' mk-nb'}" data-leaf="${i}" data-fields="${attr(fields.join(', '))}"><span class="mk-nr">${String(i + 1).padStart(2, '0')}</span><code class="mk-hash">${esc(l.hash.slice(0, 12))}…</code><span class="mk-text">${esc(l.text.length > 110 ? l.text.slice(0, 110) + '…' : l.text)}<span class="mk-used">${fields.length ? 'carries ' + esc(fields.join(', ')) : 'beside it, part of the key'}</span></span></div>${pr ? recipe(pr) : ''}`;
        }).join('');
        const n = man.leaves.length; const rest = n - shown.size;
        const run = runs[id];
        const runLine = run
            ? `<p class="loc mk-run">ran <code>${esc(run.command)}</code> in <code>${esc(run.cwd)}</code> at commit ${esc(run.repo.commit)}${run.repo.uncommittedChanges ? ` with ${run.repo.uncommittedChanges} uncommitted ${run.repo.uncommittedChanges === 1 ? 'change' : 'changes'}` : ' (clean)'}, ${esc(run.startedAt.slice(0, 16).replace('T', ' '))} UTC, ${run.durationMs >= 1000 ? (run.durationMs / 1000).toFixed(1) + ' s' : run.durationMs + ' ms'}, exit ${run.exitCode}. ${run.sameAsSnapshot ? '<span class="sig">Output identical to the snapshot the page binds to</span>' : '<span class="mk-drift">Output differs from the snapshot the page binds to</span>'} (sha256 ${esc(run.stdoutSha256.slice(0, 12))}…).${run.stderrTail && run.stderrTail.length ? ` <details class="ev-prov mk-runlog"><summary>stderr</summary><pre>${esc(run.stderrTail.join('\n'))}</pre></details>` : ''}</p>`
            : (localSources.includes(id) ? '<p class="loc mk-run"><span class="mk-drift">no run record</span>: the snapshot was captured by hand and no script run has reproduced it yet.</p>' : '');
        const sigLine = (sig ? `<p class="loc"><span class="sig">root ${attestText(sig)}</span></p>` : `<p class="loc">root unwitnessed: ${localSources.includes(id) ? 'regenerated by the named script; nobody outside this machine vouches for it' : 'a copy kept by the audit; no outside party vouches for it yet'}.</p>`) + runLine;
        return `<details class="merkle mk-src" data-sub="in"><summary><span class="mk-src-title">${esc(sourceTitles[id] || id)}</span>${marksHtml(id)}<span class="mk-src-meta">${n} ${n === 1 ? 'block' : 'blocks'}, ${usedIdx.length} carrying readings</span></summary><p class="loc">contract ${esc(man.canonicalization)} + ${esc(man.segmentation)}. root <code class="mk-root">${esc(man.root)}</code></p>${sigLine}${drawTree(man, usedIdx)}<p class="mk-what loc"></p>${rows}${rest > 0 ? `<p class="loc mk-rest">${rest} other ${rest === 1 ? 'block carries' : 'blocks carry'} no reading; ${rest === 1 ? 'it still folds' : 'they still fold'} into the root.</p>` : ''}</details>`;
    };
    const usedCount = (id) => Object.keys(usedBy[manifests[id].root] || {}).length;
    const byUse = (a, b) => (usedCount(b) - usedCount(a)) || String(sourceTitles[a] || a).localeCompare(String(sourceTitles[b] || b));
    const groups = (sourceGroups || []).map((g) => ({ ...g, ids: g.ids.filter((id) => manifests[id]) })).filter((g) => g.ids.length);
    const grouped = new Set(groups.flatMap((g) => g.ids));
    const rest = manIds.filter((id) => !grouped.has(id));
    if (rest.length) groups.push({ title: groups.length ? 'other sources' : 'sources', note: '', ids: rest });
    const slug = (t) => 'grp-' + String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const groupNote = (g) => {
        const rs = g.ids.map((id) => runs[id]).filter(Boolean);
        if (!rs.length) return g.note || '';
        const same = rs.filter((r) => r.sameAsSnapshot && r.exitCode === 0).length;
        const when = rs.map((r) => r.startedAt).sort().pop().slice(0, 10);
        return (g.note ? g.note + '. ' : '') + `Rerun ${when}: ${same} of ${rs.length} ${rs.length === 1 ? 'script' : 'scripts'} reproduced its snapshot byte for byte${same < rs.length ? ', the rest differ and say so below' : ''}.`;
    };
    const jump = groups.length > 1 ? `<nav class="merkle mk-rail" data-sub="in" aria-label="groups">${groups.map((g) => `<a href="#${slug(g.title)}" data-group="${slug(g.title)}">${esc(g.title)}<span class="mk-count">${g.ids.length}</span></a>`).join('')}</nav>` : '';
    const rungBlocks = jump + groups.map((g) => `<section class="merkle mk-rung-head" data-sub="in" id="${slug(g.title)}"><h2>${esc(g.title)}<span class="mk-count">${g.ids.length}</span></h2>${groupNote(g) ? `<p class="loc">${esc(groupNote(g))}</p>` : ''}</section>\n` + g.ids.slice().sort(byUse).map(srcSection).join('\n')).join('\n');
    const GLOSS = { copy: 'we hold it', tls: 'certificate recorded', archive: 'independent copy', timestamp: 'RFC 3161', signed: 'by the issuer', anchored: 'on a ledger' };
    const legend = '<p>Every source the paper was checked against. The marks after a source light up for what vouches for it, from a copy we hold to a signature or a ledger; hover one for what it means.</p>';
    // Adapters as rows: a role the page needs, what is plugged into it, and
    // the candidates that fit, each labelled for what it is. Choosing records
    // a choice for the next build; adapters run at build time, so the row
    // says "chosen for the next build" rather than pretending a live swap.
    const STATE = { plugged: 'plugged', available: 'built', known: 'not built', none: 'none' };
    const adapterList = (list, dir) => {
        if (!list || !list.length) return '';
        const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const row = (a) => {
            const empty = a.state === 'available';
            const opts = (a.options || []).map((o) => `<div class="mk-opt" data-name="${attr(o.name)}" data-state="${attr(o.state)}"><span class="mk-opt-name">${esc(o.name)}</span><span class="mk-opt-state">${esc(STATE[o.state] || o.state)}</span>${o.note ? `<span class="mk-opt-note">${esc(o.note)}</span>` : ''}</div>`).join('');
            return `<div class="mk-arow" data-role="${slug(a.role || a.name)}" data-state="${empty ? 'empty' : 'plugged'}"><span class="mk-role">${esc(a.role || a.name)}</span><span class="mk-plugmain">${empty ? '<span class="mk-plug mk-empty">empty</span>' : `<span class="mk-plug">${a.icon ? `<span class="mk-sico mark" aria-hidden="true">${a.icon}</span>` : ''}${esc(a.plug || a.name)}</span>`}<span class="mk-st">${empty ? 'fits ' + esc(a.fits || '') : (a.last ? 'last run ' + esc(a.last) : 'plugged')}</span><span class="mk-chosen"></span></span><button type="button" class="rv-link mk-choose" title="${attr(a.what + (a.note ? '. ' + a.note : ''))}">${empty ? 'choose' : 'swap'}</button><div class="mk-options" hidden>${opts}</div></div>`;
        };
        return `<section class="merkle mk-adapters" data-sub="${dir}"><p class="loc">${dir === 'in' ? 'What came in, and through what. A role can be filled by anything that meets its contract.' : 'What goes out, and through what. A role can be filled by anything that meets its contract.'}</p><div class="mk-rows">${list.map(row).join('')}</div></section>`;
    };
    const provView = manIds.length
        ? '<div class="merkle mk-intro" data-sub="in">' + legend + '</div>\n' + rungBlocks
        : '';
    const subTabs = manIds.length ? '<nav class="merkle mk-tabs" aria-label="provenance"><button class="mk-tab" data-sub="in" aria-pressed="true"><svg class="rv-ico" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M5 7.5l3 3 3-3M3 13.5h10"/></svg>incoming</button><button class="mk-tab" data-sub="out" aria-pressed="false"><svg class="rv-ico" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10.5v-8M5 5.5l3-3 3 3M3 13.5h10"/></svg>outgoing</button></nav>\n' : '';
    const merkleView = provView.replace('</div>\n', '</div>\n' + adapterList(adapters && adapters.in, 'in') + '\n');

    // The other direction of the same fold: the review is a document too.
    // Its judgements, sorted, are leaves; the root is what a signature
    // covers. Sign one line and every judgement is covered, and any one of
    // them can later be proven to sit inside the signed review.
    let reviewMerkle = '';
    let roots = null;
    if (manIds.length) {
        const judgements = (committedReview && committedReview.judgements) || {};
        const entries = Object.entries(judgements).sort(([a], [b]) => (a < b ? -1 : 1));
        // The output itself is the FIRST leaf. A signature over judgements
        // alone says nothing about prose that shifted around them; with the
        // output's root folded in, changing one word of the text moves this
        // root and the old signature visibly stops matching.
        const oman = buildManifest(subjects.map((sj) => `${sj.id} ${String(sj.claim).replace(/\s+/g, ' ').trim()}`).join('\n'), { html: false });
        const rman = reviewRootOf(judgements, oman.root);
        roots = { review: rman.root, output: oman.root, sources: Object.fromEntries(Object.entries(manifests).map(([id, m]) => [id, m.root])) };
        const h = anchors.hedera; const rk = anchors.rekor; const va = anchors.vana;
        const lines = [];
        if (h) lines.push(`<p class="loc mk-anchor"><span class="sig">anchored</span> on Hedera ${esc(h.network)}, topic <a href="${attr(h.hashscanTopic)}">${esc(h.topicId)}</a>, sequence ${esc(String(h.sequenceNumber))}, consensus time ${esc(h.consensusTimestamp)}; the mirror node <a href="${attr(h.mirror)}">returns the message</a> with review root <code class="h">${esc(h.payload.review.slice(0, 12))}…</code>, transaction <a href="${attr(h.hashscanTx)}">on HashScan</a>.</p>`);
        if (rk) { const ip = rk.inclusionProof || {}; lines.push(`<p class="loc mk-anchor"><span class="sig">anchored</span> in Sigstore Rekor, log index <a href="${attr(rk.hashscanLike)}">${esc(String(rk.logIndex))}</a>, integrated ${esc(rk.integratedAt)}; the log <a href="${attr(rk.search)}">returns the entry</a> with review root <code class="h">${esc(rk.payload.review.slice(0, 12))}…</code> and an inclusion proof of ${esc(String((ip.hashes || []).length))} hashes into a tree of ${esc(String(ip.treeSize || '?'))} entries, signed by the log.</p>`); }
        if (va) lines.push(`<p class="loc mk-anchor"><span class="sig">anchored</span> on Vana L1 (${esc(va.network)}), file <a href="${attr(va.explorerRegistry)}">${esc(va.fileId)}</a> in the DataRegistry at block ${esc(String(va.addFileBlock))}, the payload inside the record itself; a proof signed by ${esc(va.owner.slice(0, 10))}… added at block ${esc(String(va.addProofBlock))} (<a href="${attr(va.explorerFile)}">file transaction</a>, <a href="${attr(va.explorerProof)}">proof transaction</a>); read back from the registry with review root <code class="h">${esc(va.payload.review.slice(0, 12))}…</code>.</p>`);
        const signLines = signoffs.map((so) => `<p class="loc mk-anchor"><span class="sig">signed</span> by <code>${esc(so.issuer)}</code> with ${esc(so.keyId.split('#')[1] || 'its key')} (Ed25519, ${esc(so.format)}) at ${esc(so.issuedAt)}, over root <code class="h">${esc(so.root.slice(0, 12))}…</code> covering ${esc(String(so.judgements))} ${so.judgements === 1 ? 'judgement' : 'judgements'} and the output; checked against the DID document at <code>https://abovebeyond.ai/.well-known/did.json</code>: signature ${so.checks.signature ? 'holds' : 'FAILS'}, contract ${so.checks.contract ? 'holds' : 'FAILS'}, root ${so.checks.rootMatches ? 'recomputes' : 'DOES NOT recompute'}.</p>`);
        const anchorLine = (signLines.join('') + (lines.length ? lines.join('') + '<p class="loc">These are the roots at hand-back; what you judge after them is not in any log until the next anchor.</p>' : '<p class="loc mk-anchor">not anchored yet: the review root becomes findable on a ledger at hand-back, when the ledger adapter runs.</p>'));
        const signedRoots = signoffs.map((so) => so.root);
        const anchoredRoots = [h && h.payload.review, rk && rk.payload.review, va && va.payload.review].filter(Boolean);
        reviewMerkle = `<div class="merkle mk-intro" data-sub="out"><p>Every approval is a leaf beside the output itself: literal ones by the machine, inferred ones by you. They fold to one root, which is what the hand-back carries and what a signature or an anchor covers.</p></div>\n<section class="merkle" data-sub="out" data-kind="review"><h2>Approvals, going out</h2><p class="loc">output root <code class="mk-root">${esc(oman.root)}</code></p><div id="mk-out" data-output-root="${attr(oman.root)}"${anchoredRoots.length ? ` data-anchored-root="${attr(anchoredRoots.join(' '))}"` : ''}${signedRoots.length ? ` data-signed-root="${attr(signedRoots.join(' '))}"` : ''}></div><p class="mk-what loc"></p><p class="loc mk-out-legend"></p>${anchorLine}</section>`;
    }

    const built = new Date().toISOString().slice(0, 10);
    const committedTag = committedReview
        ? `<script>window.PROVEML_REVIEW_COMMITTED=${JSON.stringify(committedReview).replace(/</g, '\\u003c')}</script>\n`
        : '';


    const CHROME = `
:root{--app:#e7ecef}
body{background:var(--app)}
.reviewbar{position:fixed;top:0;left:0;right:0;z-index:9;margin:0;padding:.8rem 1.6rem .55rem;background:var(--surface);border-bottom:1px solid var(--haze-line);font-family:Lato,system-ui,sans-serif;font-size:.92rem;display:block}
.rv-row{display:flex;align-items:baseline;gap:1.1rem;flex-wrap:wrap}
.rv-mast{align-items:center;flex-wrap:nowrap}
.rv-mast .lockup,.rv-mast #rv-progress,.rv-mast .rv-view{flex:none}
.rv-mast .rv-doc{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:none;font-size:1.2rem;font-weight:800;letter-spacing:-.015em}
.rv-mast #rv-progress{margin-left:auto;font-weight:700;font-variant-numeric:tabular-nums;font-size:.95rem}
.reviewbar .rv-meter{max-width:none;width:100%;height:5px;margin:.9rem 0 .85rem;background:var(--tint)}
.rv-tools{justify-content:space-between;font-size:.9rem;color:var(--muted)}
.rv-tools .rv-actions{margin-left:0;gap:1.2rem}
.reviewbar .rv-btn{border:none;border-radius:0;background:none;padding:0;color:var(--muted);font-family:inherit;font-size:.9rem;font-weight:400;cursor:pointer;text-underline-offset:.35em}
.reviewbar .rv-btn:hover{color:var(--ink);text-decoration:underline}
.reviewbar .rv-btn.rv-primary{background:var(--accent);color:#fff;font-weight:700;padding:.32rem .85rem;border-radius:4px;border:1px solid var(--accent);text-decoration:none}
.reviewbar .rv-btn.rv-primary:hover{background:#163f93;border-color:#163f93;color:#fff;text-decoration:none}
.reviewbar .rv-btn.rv-primary:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.reviewbar .rv-btn:disabled{color:var(--muted);opacity:.6;cursor:default;text-decoration:none}
.reviewbar .rv-note{color:var(--muted)}
.rv-view{display:flex;gap:1.1rem;align-items:baseline}
.rv-vw{border:none;border-radius:3px;padding:.22rem .6rem;background:none;color:var(--muted);font-size:.9rem;cursor:pointer;display:inline-flex;align-items:center;gap:.4rem;outline:none}
.rv-vw:focus{outline:none}.rv-vw:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rv-ico{flex:none;opacity:.75}.rv-vw[aria-pressed=true] .rv-ico{opacity:1}
.rv-toggle{border:1px solid var(--haze-line);border-radius:4px;padding:.22rem .6rem;background:none;color:var(--muted);font-family:Lato,system-ui,sans-serif;font-size:.9rem;cursor:pointer;display:inline-flex;align-items:center;gap:.4rem;outline:none}
.rv-toggle:hover{color:var(--ink)}.rv-toggle[aria-pressed=true]{background:var(--tint);color:var(--ink);font-weight:600}.rv-toggle:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rv-vw:hover,.rv-vw[aria-pressed=true]{color:var(--ink)}
.rv-vw[aria-pressed=true]{background:var(--tint);font-weight:600;text-decoration:none;box-shadow:inset 0 0 0 1px var(--haze-line)}
.rv-mast .rv-view{gap:2px;border:1px solid var(--haze-line);border-radius:4px;padding:2px;background:var(--surface)}
.rv-nav{gap:.9rem;margin-left:.4rem}
.rv-act{font-family:inherit;font-size:.9rem;color:var(--muted);background:none;border:none;padding:0;cursor:pointer}
.rv-act:hover{color:var(--ink)}
.pair{scroll-margin-top:1rem}
body[data-view=full] .pair:not([data-heading]){position:relative;border-radius:4px;transition:background .12s}
body[data-view=full] .pair:not([data-heading]):hover{background:rgba(14,36,51,.035)}
body[data-view=full] .pair:not([data-heading]):hover .col:first-child{border-left-color:var(--ink)}
body[data-view=full] .pair[data-active]:hover .col:first-child{border-left-color:var(--accent)}
body[data-view=full] .pair[data-note]:not([data-note='']):not([data-heading]):hover::after{content:attr(data-note);position:absolute;right:.7rem;top:-.55rem;background:var(--surface);padding:0 .35rem;font-family:'Spline Sans Mono',ui-monospace,monospace;font-size:.72rem;color:var(--muted);pointer-events:none}
.rv-prev{font-size:.9rem;color:var(--muted);margin:0 0 .5rem}
.rv-prev code{font-family:'Spline Sans Mono',ui-monospace,monospace;font-size:.85em;color:var(--ink)}
.rv-prev .st{color:var(--mark-ok)}.rv-prev .st.open{color:var(--mark-unk)}.rv-prev .st.flag{color:var(--mark-bad)}
#rv-modal{position:fixed;inset:0;z-index:20}
.rv-modal-back{position:absolute;inset:0;background:rgba(14,36,51,.45)}
.rv-modal-card{position:absolute;left:50%;top:6vh;transform:translateX(-50%);width:min(62rem,92vw);max-height:86vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--haze-line);border-radius:6px;box-shadow:var(--shadow);font-family:Lato,system-ui,sans-serif}
.rv-modal-head{display:flex;justify-content:space-between;align-items:center;padding:.8rem 1.2rem;border-bottom:1px solid var(--haze-line);font-weight:700}
.rv-modal-body{overflow:auto;padding:1rem 1.4rem 1.4rem;white-space:pre-wrap;font-size:.95rem;line-height:1.6;color:var(--ink)}
.rv-modal-body mark{background:rgba(229,181,103,.45);color:inherit;padding:0 .1em;border-radius:2px}
.rv-see{font-size:.85rem}
.rv-fig{margin:.5rem 0 1rem}
.rv-fig img{display:block;max-width:100%;height:auto;padding:.7rem;box-sizing:border-box;border:1px solid var(--haze-line);border-radius:4px;background:var(--surface)}
.pair[data-caption]{padding:.6rem 0 1.3rem}
body[data-view=full] .pair[data-caption] .col:first-child{font-size:.93rem;line-height:1.55;color:var(--muted);padding-right:2.5rem}
.rv-cap-lead{font-weight:700;color:var(--ink)}
.pair[data-caption] .col:first-child .proveml-paragraph:first-child{display:inline}
.pair[data-figure] .col:first-child{cursor:default}
.reviewbar .rv-btn,.reviewbar .rv-link,.reviewbar .rv-act,.reviewbar .rv-filter,.rv-more summary,.rv-more-menu,.rv-more-menu .rv-vw{font-family:Lato,system-ui,sans-serif;font-size:.9rem;letter-spacing:0}
.reviewbar .rv-meter{max-width:none}
#rv-progress{white-space:nowrap}
.ev-prov{margin:-.5rem 0 1rem}
.ev-prov summary{cursor:pointer;color:var(--muted);font-size:.85rem;list-style:none;text-underline-offset:.3em}
.ev-prov summary::-webkit-details-marker{display:none}
.ev-prov summary:hover{color:var(--ink);text-decoration:underline}
.ev-prov-body{font-size:.82rem;line-height:1.55;color:var(--muted);padding:.45rem 0 0}
.ev-prov-body p{margin:0 0 .45rem}
.ev-prov-body ol{margin:.2rem 0 .55rem 1.1rem;padding:0}
.ev-prov code{background:none;padding:0;font-family:'Spline Sans Mono',ui-monospace,monospace;font-size:.9em}
html,body{height:100%;overflow:hidden}
.wrap{max-width:none;position:fixed;top:var(--bar-h,7.6rem);left:0;right:25rem;bottom:0;overflow-y:auto;overscroll-behavior:contain;margin:0;padding:1.6rem 3rem 4rem 2.5rem;background:var(--surface);border:none;border-radius:0}
.wrap .statline{margin-top:0;font-family:Lato,system-ui,sans-serif;font-size:.92rem;color:var(--muted)}
.rv-panel{position:fixed;top:var(--bar-h,6.7rem);right:0;bottom:0;width:25rem;background:var(--surface);border-left:1px solid var(--haze-line);display:flex;flex-direction:column;z-index:8;font-family:Lato,system-ui,sans-serif}
.rv-panel-head{display:flex;justify-content:space-between;align-items:center;padding:.75rem 1.1rem;border-bottom:1px solid var(--haze-line);font-weight:700;font-size:.92rem}
.rv-panel-body{flex:1;overflow:auto;padding:1rem 1.1rem}
.rv-panel-foot{border-bottom:1px solid var(--haze-line);padding:.6rem 1.1rem;background:var(--surface)}
.rv-panel-foot:empty{display:none}
.rv-panel-foot .rv-actions{margin:0;gap:1rem;flex-wrap:wrap}
.rv-actions .rv-btn.rv-primary{background:var(--accent);color:#fff;font-weight:700;padding:.32rem .85rem;border-radius:4px;border:1px solid var(--accent);text-decoration:none}
.rv-panel-foot .rv-nav{margin-left:auto}
.rv-panel-foot .rv-btn,.rv-panel-foot .rv-link,.rv-panel-foot .rv-act,.rv-panel-foot .rv-note{font-family:Lato,system-ui,sans-serif;font-size:.9rem;letter-spacing:0}
body[data-view=full] .rv-tools{display:none}
.rv-panel-empty{color:var(--muted);font-size:.95rem;line-height:1.5}
.rv-panel .col{border:none;background:none;padding:0;position:static;font-size:.95rem}
.rv-panel .col .lbl{display:none}
body[data-view=full] .pair .col+.col{display:none}
body[data-view=sources] .rv-panel,body[data-view=merkle] .rv-panel{display:none}
body[data-view=sources] .wrap,body[data-view=merkle] .wrap{right:0}
@media (max-width:74rem){.wrap{right:0;bottom:46vh}body[data-view=sources] .wrap,body[data-view=merkle] .wrap{bottom:0}.rv-panel{top:auto;height:46vh;width:auto;left:0;border-left:none;border-top:1px solid var(--haze-line);box-shadow:0 -10px 30px rgba(14,36,51,.12)}.rv-panel[hidden]{display:none}}
`;
    const snapStore = Object.entries(snapshots).map(([id, txt]) => `<script type="text/plain" id="snap-${attr(id)}">${String(txt).replace(/<\/script/gi, '<\\/script')}</script>`).join('');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ProveML ${esc(name)}</title><style>${PROVEML_CSS}${CSS}${CHROME}
/* house layer, read from its source at build time */
${brandCss}</style></head><body class="proveml-root" data-view="full" data-sub="in">
<div class="wrap">
<div class="reviewbar"><div class="rv-row rv-mast"><h1 class="lockup">${brand ? (brand.mark ? `<span class="brand-mark">${esc(brand.mark)}</span>` : '') : MERKTEKEN}<span class="pml-name">${esc(brand && brand.name ? brand.name : 'proveml')}</span></h1><span class="rv-doc" title="${attr(storeName)}">${esc(storeName)}</span><span id="rv-progress"></span><span class="rv-view" role="group" aria-label="view"><button class="rv-vw" data-view="full" aria-pressed="true"><svg class="rv-ico" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3h7v10h-7zM11.5 3h2v10h-2zM4.5 6h3M4.5 8.5h3"/></svg>full text</button><button class="rv-vw" data-view="sources" aria-pressed="false"><svg class="rv-ico" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3h4.5v4H2.5zM9 3h4.5v4H9zM2.5 9h4.5v4H2.5zM9 9h4.5v4H9z"/></svg>by source</button>${merkleTab}</span><button type="button" id="rv-theme" class="rv-theme" aria-label="switch between light and night"><svg class="rv-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/></svg>night</button></div><div class="rv-meter"><div class="rv-fill"></div></div><div class="rv-row rv-tools"><span class="rv-actions"><button id="rv-next" class="rv-btn rv-primary">next for you</button><button type="button" id="rv-only" class="rv-toggle rv-filter" aria-pressed="false"><svg class="rv-ico" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h12L9.5 8.5V13l-3 1.5V8.5z"/></svg>only what needs you</button><button id="rv-export" class="rv-link">copy the receipts</button><span class="rv-nav"><button id="rv-prev-src" class="rv-act rv-arrow" aria-label="previous block">\u2191 previous</button><button id="rv-next-src" class="rv-act rv-arrow" aria-label="next block">\u2193 next</button></span></span></div>${subTabs}</div>
<p class="rv-lede" id="rv-breakdown"></p><p class="statline">${subjects.length} blocks, ${verified} values checked, built ${built}${brandCssSource ? `, styled from ${esc(brandCssSource.file)} at ${esc(brandCssSource.sha256.slice(0, 8))}` : ''}${brand ? ' on proveml' : ''}.</p>
${cards}
${merkleView}${reviewMerkle.replace('</div>\n', '</div>\n' + adapterList(adapters && adapters.out, 'out') + '\n')}
</div>${snapStore}<div id="rv-modal" hidden><div class="rv-modal-back"></div><div class="rv-modal-card" role="dialog" aria-modal="true"><header class="rv-modal-head"><span id="rv-modal-title"></span><button id="rv-modal-close" class="rv-link">close</button></header><div id="rv-modal-body" class="rv-modal-body"></div></div></div><aside id="rv-panel" class="rv-panel" aria-label="source"><div class="rv-panel-head"><span>Source</span><button id="rv-panel-close" class="rv-link">close</button></div><div class="rv-panel-foot" id="rv-panel-foot"></div><div class="rv-panel-body"><p class="rv-panel-empty">Click a marked value in the paper to see where it comes from, then decide here.</p></div></aside>${committedTag}<script>${SCRIPT}</script></body></html>`;

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
function drawTree(man, usedIdx = []) {
    const lv = treeLevels(man);
    const used = new Set(usedIdx);
    // Levels bottom-up, each node knowing its span and its children.
    const levels = [man.leaves.map((l) => ({ lo: l.i, hi: l.i, hash: lv[0][l.i], kids: [] }))];
    for (let d = 1; d < lv.length; d++) {
        const below = levels[d - 1]; const row = [];
        for (let j = 0; j < below.length; j += 2) {
            const kids = below.slice(j, j + 2);
            row.push({ lo: kids[0].lo, hi: kids[kids.length - 1].hi, hash: lv[d][row.length], kids, carried: kids.length === 1 });
        }
        levels.push(row);
    }
    // Wide trees are drawn the way a proof reads them: a subtree that carries
    // no reading folds into one cell whose width grows with the log of what
    // it holds, and only the path down to a quoted block stays expanded.
    const folded = man.leaves.length > 40;
    const holds = (n) => { for (const u of used) if (u >= n.lo && u <= n.hi) return true; return false; };
    const weight = (n) => {
        if (n.kids.length === 0) return folded ? 4 : 1;
        if (folded && !holds(n)) return Math.log2(n.hi - n.lo + 1) + 2;
        return n.kids.reduce((a, k) => a + weight(k), 0);
    };
    const rows = [];
    for (let d = levels.length - 1; d >= 0; d--) {
        const cells = [];
        const walk = (n, depth) => {
            const collapsed = folded && n.kids.length > 0 && !holds(n);
            if (depth === d) {
                const w = weight(n);
                const span = n.hi - n.lo + 1;
                const isUsed = n.kids.length === 0 && used.has(n.lo);
                const cls = `mk-node${d === levels.length - 1 ? ' mk-node-root' : ''}${n.carried ? ' mk-carried' : ''}${isUsed ? ' mk-node-used' : ''}${collapsed ? ' mk-node-fold' : ''}`;
                const label = collapsed ? `${span} blocks` : esc(n.hash.slice(0, 8));
                cells.push(`<span class="${cls}" data-lo="${n.lo}" data-hi="${n.hi}"${n.carried ? ' title="carried up unchanged: an odd node has no partner at this level"' : ''}${collapsed ? ` title="${span} blocks folded into one hash; a checker is handed this hash alone"` : ''} style="flex-grow:${w}">${label}</span>`);
                return;
            }
            // one spacer under a folded subtree, however deep the row
            if (collapsed) { cells.push(`<span class="mk-gap" style="flex-grow:${weight(n)}"></span>`); return; }
            for (const k of n.kids) walk(k, depth - 1);
        };
        walk(levels[levels.length - 1][0], levels.length - 1);
        rows.push(`<div class="mk-row">${cells.join('')}</div>`);
    }
    return `<div class="mk-tree${folded ? ' mk-tree-fold' : ''}" aria-hidden="true">${rows.join('')}</div>`;
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
    if (!manifest || !b) return { line: '', reveal: '' };
    const neighborhood = [b.leafIndex - 1, b.leafIndex, b.leafIndex + 1]
        .filter((j) => j >= 0 && j < manifest.leaves.length)
        .map((j) => manifest.leaves[j].hash);
    proofs.push({ subject: s.id, field: e.field, ...b, neighborhood, ...(signature ? attestProof(signature) : {}) });
    const short = (h) => `<code class="h" title="${attr(String(h))}">${esc(String(h).slice(0, 12))}\u2026</code>`;
    const rungs = signature
        ? [signature.witness ? 'witnessed' : '', signature.timestamp ? 'timestamped' : '', signature.transport ? 'TLS' : '', (!signature.level || signature.level === 'signed') && signature.issuer ? 'signed' : ''].filter(Boolean).join(', ')
        : '';
    const line = `${lead ? ', ' : ''}block ${b.leafIndex + 1} of ${manifest.leaves.length}, root ${short(b.root)}${rungs ? `, <span class="sig">${rungs}</span>` : ', unattested'}`;
    const steps = (b.proof && b.proof.path ? b.proof.path : []).map((st, k) => `<li>level ${k + 1}: sibling on the ${st.side === 'L' ? 'left' : 'right'} ${short(st.hash)}</li>`).join('');
    const wit = signature && signature.witness ? `<p><a href="${attr(signature.witness.url)}">independent copy at ${esc(signature.witness.archive)}</a>, ${esc(signature.witness.at)}</p>` : '';
    const reveal = `<details class="ev-prov"><summary>how to check this</summary><div class="ev-prov-body">`
        + (signature ? `<p>root ${attestText(signature)}</p>` : '<p>root unattested: this archive rests on the capture alone.</p>') + wit
        + `<p>inclusion proof for block ${b.leafIndex + 1}: its leaf ${short(b.leafHash)} is sha256 of the word leaf, a NUL byte, and the block's text.</p>`
        + `<ol>${steps}<li>root ${short(b.root)}</li></ol>`
        + `<p>to recompute: h = sha256("leaf" + NUL + block); at each level h = sha256("node" + NUL + (sibling on the left ? sibling + h : h + sibling)); h must equal the root. Hover a hash for the full value.</p>`
        + `<p>your yes is keyed to this block and the blocks either side: ${neighborhood.map(short).join(' ')}</p>`
        + `</div></details>`;
    return { line, reveal };
}

// The ladder of attestation, in words a reader can weigh. A publisher's
// signature is the top rung; below it, a timestamp proves the root existed by
// a time, and a TLS fetch witnesses which host served the bytes to us. Each is
// named for what it is, so "signed" is never said of a rung that is not.
function attestText(sig) {
    if (!sig) return '';
    if (sig.level === 'granted') {
        const g = sig.grant;
        return `received under grant ${esc(g.grant_id)} from ${esc(sig.issuer)} for ${esc(g.purpose_code)}, ${esc(g.access_mode)}, issued ${esc(g.issued_at)}, fields ${esc((g.streams[0].fields || []).join(', '))}${sig.withheld && sig.withheld.length ? `, withheld ${esc(sig.withheld.join(', '))}` : ''}; ${esc(String(sig.records))} records in ${esc(String(sig.pages))} pages; PDPP 0.1 specifies no receipt, so this is the client-side record of what was received, not proof of enforcement`;
    }
    if (sig.level === 'witnessed' || sig.level === 'timestamped' || sig.level === 'transport') {
        const wi = sig.witness ? `witnessed by ${esc(sig.witness.archive)} at ${esc(sig.witness.at)}` : '';
        const tr = sig.transport ? `witnessed over TLS from ${esc(sig.transport.host)} (cert ${esc(String(sig.transport.certSha256 || '').slice(0, 23))}, ${esc(String(sig.transport.fetchedAt || '').slice(0, 10))})${sig.transport.sameAsArchived === false ? (sig.transport.quotesInRefetch ? `, page bytes changed since the archive; ${esc(String(sig.transport.quotesInRefetch.present))} of ${esc(String(sig.transport.quotesInRefetch.of))} quoted passages still on the live page` : ', page bytes changed since the archive') : ', same bytes as the archive'}` : '';
        const ts = sig.timestamp ? `timestamped by ${esc(sig.timestamp.tsa)} at ${esc(sig.timestamp.at)}` : '';
        return [wi, ts, tr].filter(Boolean).join('; ');
    }
    return `signed by ${esc(sig.issuer)}${sig.method ? ` (${esc(sig.method)})` : ''}${sig.verifiedAt ? `, signature checked ${esc(sig.verifiedAt)}` : ''}`;
}
function attestProof(sig) {
    if (sig.level === 'granted') return { attestation: { level: 'granted', grantId: sig.grant.grant_id, purpose: sig.grant.purpose_code, accessMode: sig.grant.access_mode, issuedAt: sig.grant.issued_at, subject: sig.grant.subject.id, client: sig.grant.client.client_id, declarationVersion: sig.grant.source_declaration.version, fields: sig.grant.streams[0].fields, records: sig.records, fetchedAt: sig.fetchedAt } };
    if (sig.level === 'witnessed' || sig.level === 'timestamped' || sig.level === 'transport') {
        return { attestation: { level: sig.level, ...(sig.witness ? { witness: sig.witness.archive, witnessUrl: sig.witness.url, witnessedAt: sig.witness.at } : {}), ...(sig.transport ? { host: sig.transport.host, certSha256: sig.transport.certSha256, fetchedAt: sig.transport.fetchedAt, sameAsArchived: sig.transport.sameAsArchived } : {}), ...(sig.timestamp ? { tsa: sig.timestamp.tsa, at: sig.timestamp.at } : {}) } };
    }
    return { signedBy: sig.issuer, ...(sig.method ? { signatureMethod: sig.method } : {}) };
}
function evidenceBlock(s, e, snapshots, ids, manifest, proofs, signature) {
    const sid = e.source || s.id;  // a paragraph may cite several sources
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
            if (snapshots[sid] !== undefined && !squash(snapshots[sid]).includes(squash(q.sourceQuote))) {
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
            const pn = proofNoteFor(s, e, manifest, bundles && bundles[0], proofs, loc || link, signature) || { line: '', reveal: '' };
            const ctx = quoteContext(snapshots[sid], q.sourceQuote);
            const see = snapshots[sid] !== undefined ? `<p class="loc"><button class="rv-link rv-see" data-source="${attr(sid)}" data-hl="${attr(q.sourceQuote)}">see the whole source</button></p>` : '';
            body = `<p class="quote"${ctx ? ` title="${ctx}"` : ''}>\u201C${esc(q.sourceQuote)}\u201D</p>${loc || link || pn.line ? `<p class="loc">${loc}${link}${pn.line}</p>` : ''}${pn.reveal}${see}`;
        } else {
            body = quotes.map((q, qi) => {
                const pn = proofNoteFor(s, e, manifest, bundles && bundles[qi], proofs, q.sourceLocator, signature) || { line: '', reveal: '' };
                const loc = q.sourceLocator || pn.line ? `<p class="loc">${esc(String(q.sourceLocator || '').replace(/_/g, ' '))}${pn.line}</p>` : '';
                const ctx = quoteContext(snapshots[sid], q.sourceQuote);
                return `<p class="quote"${ctx ? ` title="${ctx}"` : ''}>\u201C${esc(q.sourceQuote)}\u201D</p>${loc}${pn.reveal}`;
            }).join('');
            body += `<p class="loc">each verbatim in the${e.sourceHref ? ` <a href="${attr(e.sourceHref)}">archived source</a>` : ' archived source'}</p>`;
        }
    } else if (e.basis === 'derived') {
        rid = evidenceReviewId(s.id, e);
        ids.push(rid);
        body = `<p class="basis basis-derived">derived, not quoted</p>${e.source && snapshots[sid] !== undefined ? `<p class="loc"><button class="rv-link rv-see" data-source="${attr(sid)}" data-hl="${attr(String(e.claimValue))}" data-hl2="${attr(String(e.note || ''))}">see the source it was derived from</button></p>` : ''}`;
    } else if (e.basis === 'absence') {
        rid = evidenceReviewId(s.id, e);
        ids.push(rid);
        // An absence is the one reading no quote can carry: the only honest
        // evidence is the whole source, handed to the reviewer to scan. So
        // when the archive is here, it unfolds right under the claim.
        body = `<p class="basis basis-absence">rests on absence: you cannot quote a source not having something</p>`;
        if (snapshots[sid] !== undefined) body += `<p class="loc"><button class="rv-link rv-see" data-source="${attr(sid)}" data-hl="">scan the whole source</button></p>`;
    } else {
        throw new Error(`${s.id}.${e.field}: unknown basis "${e.basis}".`);
    }
    if (!rid) { rid = evidenceReviewId(s.id, e); ids.push(rid); }
    return `<div class="evidence" data-evidence-field="${attr(e.field)}"${literal ? ' data-literal' : ''}><p class="ev-head"><code>${esc(e.field)}</code> = <b>${esc(String(e.claimValue))}</b>${literal ? '<span class="lit">value appears in the quote</span>' : ''}</p>${body}${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}
<div class="reading" data-review="${rid}" data-src="${attr(s.id)}" data-field="${attr(e.field)}"${literal ? ' data-literal' : ''}${s.mismatch && s.mismatch[e.field] ? ` data-mismatch="${attr(s.mismatch[e.field])}"` : ''}><span class="j">our reading</span><span class="q">${s.mismatch && s.mismatch[e.field] ? `<b class="mm">the verifier disagrees: the source says ${esc(s.mismatch[e.field])}</b>` : (literal ? 'the value is right there in the quote' : 'did it read this right?')}</span>
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
.rv-actions{margin-left:auto;display:flex;gap:1rem;align-items:center;flex-wrap:wrap}
.rv-doc{flex:0 1 auto;max-width:26rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:Lato,sans-serif;font-weight:700;font-size:.95rem;color:var(--ink)}
.rv-more{position:relative}
.rv-more summary{list-style:none;cursor:pointer;color:var(--muted);padding:.25rem .2rem;text-underline-offset:.3em}
.rv-more summary::-webkit-details-marker{display:none}
.rv-more summary:hover{color:var(--ink);text-decoration:underline}
.rv-more-menu{position:absolute;right:0;top:2rem;z-index:7;display:flex;flex-direction:column;align-items:flex-start;gap:.75rem;padding:.9rem 1.1rem;background:var(--card);border:1px solid var(--haze-line);border-radius:6px;box-shadow:var(--shadow);white-space:nowrap}
.rv-act{font-family:inherit;font-size:.8rem;letter-spacing:.02em;background:none;border:none;padding:0;color:var(--muted);cursor:pointer;transition:color .15s ease,translate .15s ease;-webkit-tap-highlight-color:transparent}
.rv-act:hover:not(:disabled){color:var(--accent);translate:.12em 0}
.rv-act:disabled{opacity:.55;cursor:default}
.rv-act:focus{outline:none}
.rv-act:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rv-view{display:flex;gap:.35rem}
.rv-vw{font-family:inherit;font-size:.72rem;letter-spacing:.04em;padding:.25rem .7rem;border:1px solid var(--haze-line);border-radius:999px;background:none;color:var(--muted);cursor:pointer;transition:background .12s,color .12s,border-color .12s;-webkit-tap-highlight-color:transparent}
.rv-vw:hover{border-color:var(--muted);color:var(--ink)}
.rv-vw[aria-pressed=true]{border-color:var(--ink);color:var(--ink)}
.rv-vw:focus{outline:none}
.rv-vw:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
body[data-view=full] .cols{grid-template-columns:1fr}
body[data-view=full] .col:first-child{position:static;background:none;border:none;padding:0 0 0 .9rem;font-size:1.0625rem;cursor:pointer;border-left:2px solid transparent;transition:border-color .15s}
body[data-view=full] .pair:not([data-all-judged]):not([data-prose]) .col:first-child{border-left-color:var(--haze)}
body[data-view=full] .pair[data-prose] .col:first-child{cursor:pointer}
body[data-view=full] .pair[data-active] .col:first-child{border-left-color:var(--accent)}
body[data-view=full] .col:first-child .lbl{display:none}
body[data-view=full] .pair[data-closed] .cols,body[data-view=full] .pair[data-all-judged]:not([data-open]) .cols{display:grid}
body[data-view=full] .pair{border-top:none;padding:.1rem 0}
body[data-view=full] .pair:not([data-heading])>header{display:none}
.pair[data-heading] .cols,.pair[data-heading] .meta,.pair[data-heading] .nr{display:none!important}
.pair[data-heading]{border-top:none;padding:2.2rem 0 .1rem}
.pair[data-heading]>header{position:static;background:none;box-shadow:none;padding:0;cursor:default;z-index:auto}
.pair[data-heading]>header h2{font-size:1.35rem;font-weight:800;letter-spacing:-.015em;margin:0}
.pair[data-heading][data-level="2"]{padding-top:1.5rem}.pair[data-heading][data-level="2"]>header h2{font-size:1.08rem;font-weight:700;letter-spacing:-.005em}
.pair[data-heading][data-level="3"]{padding-top:1.1rem}.pair[data-heading][data-level="3"]>header h2{font-size:.98rem;font-weight:600;letter-spacing:0}
body[data-view=full] .pair[data-heading] .col:first-child{border-left-color:transparent;cursor:default}
body[data-view=full] .pair[data-scan=pending] .col:first-child{cursor:default;transition:opacity .6s ease}
body[data-view=full][data-checking] .pair[data-scan=pending] .col:first-child{opacity:.74}
body[data-view=full][data-checking] .pair[data-scan=pending]:hover .col:first-child{opacity:.9}
body[data-view=full] .pair[data-scan=checked] .col:first-child,body[data-view=full] .pair[data-scan=clean] .col:first-child{opacity:1;transition:opacity .45s ease}
.proveml-code{font-family:'Spline Sans Mono',ui-monospace,monospace;font-size:.86em;background:rgba(14,36,51,.06);border-radius:3px;padding:.05em .3em}
pre.proveml-code{display:block;white-space:pre-wrap;padding:.8rem 1rem;margin:.4rem 0;line-height:1.5;font-size:.84rem}
pre.proveml-code code{background:none;padding:0;font-size:inherit}
.pair[data-pre] .col:first-child .proveml,.pair[data-pre] .col:first-child{white-space:pre-wrap;font-family:'Spline Sans Mono',ui-monospace,monospace;font-size:.86rem;line-height:1.55}
body[data-view=full] .cols{margin-top:0}
.merkle{display:none;border-top:1px solid var(--haze-line);padding:1.3rem 0 .9rem}
.mk-intro{border-top:none;padding-top:0}
.mk-intro p{max-width:60ch;margin:0;color:var(--muted)}
body[data-view=merkle] .pair{display:none}
body[data-view=merkle] .merkle.mk-tabs{display:flex}
body[data-view=merkle] .rv-tools,body[data-view=merkle] .rv-lede,body[data-view=merkle] .statline{display:none}
body[data-view=full] .rv-filter{display:none}
body[data-handback] #rv-export{display:none}
.rv-tools .rv-actions{flex:1 1 auto;display:flex;align-items:center;gap:1.1rem;justify-content:flex-end}
#rv-handback{order:99;margin-left:.4rem}
.rv-actions .rv-nav{margin-left:.6rem;gap:1rem}
.rv-mast .rv-view{margin-left:1.8rem}
.rv-lede{font-size:1.1rem;line-height:1.5;color:var(--ink);max-width:none;margin:0 0 .4rem}
.rv-lede b{font-weight:700;font-variant-numeric:tabular-nums}
.rv-lede b[data-k=machine]{color:var(--pv-fact)}.rv-lede b[data-k=no]{color:var(--pv-bad)}
.statline{margin-top:0}
.rv-batch{display:block;margin:0 0 .7rem;font-family:Lato,system-ui,sans-serif;font-size:.9rem;font-weight:600;color:var(--accent);background:none;border:none;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:.25em}
.rv-actions .rv-nav{margin-left:.4rem}
body[data-view=merkle][data-sub=in] .merkle[data-sub=in],body[data-view=merkle][data-sub=out] .merkle[data-sub=out]{display:block}
.mk-thin-row{gap:1px}.mk-thin-row .mk-node{padding:0;min-width:2px;height:.55rem;font-size:0}
.mk-leaves{display:flex;flex-wrap:wrap;gap:3px;margin:.6rem 0 .4rem}
.mk-fold{margin:.3rem 0 .6rem}.mk-fold>summary{cursor:pointer;list-style:none;font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.78rem;color:var(--muted)}.mk-fold>summary::-webkit-details-marker{display:none}.mk-fold>summary::before{content:"+ "}.mk-fold[open]>summary::before{content:"\u2013 "}.mk-fold>summary:hover{color:var(--ink)}.mk-fold .mk-tree{margin-top:.5rem}
.mk-leafcell{width:.8rem;height:.8rem;border-radius:2px;background:var(--tint);cursor:default;transition:transform .08s}.mk-leafcell:hover{transform:scale(1.35)}
.mk-out-output{background:var(--ink);color:#fff}.mk-out-literal{background:var(--pv-fact);color:#fff}.mk-out-inferred{background:var(--pv-inf);color:#fff}.mk-out-no{background:var(--pv-bad);color:#fff}
.mk-anchor a{color:var(--ink)}.mk-drift{color:var(--pv-warn)}
.mk-out-legend i{display:inline-block;width:.7em;height:.7em;border-radius:2px;vertical-align:-.05em;margin:0 .3em 0 .6em}
.reviewbar .mk-tabs{position:static;gap:1.8rem;margin:.85rem -1.6rem -.55rem;padding:.7rem 1.6rem 0;border-top:1px solid var(--haze-line);border-bottom:none;background:var(--surface);box-shadow:none}

.mk-tab{display:inline-flex;align-items:center;gap:.4rem;border:none;background:none;padding:0 0 .6rem;margin-bottom:-1px;font-family:Lato,system-ui,sans-serif;font-size:.9rem;font-weight:400;letter-spacing:0;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;transition:color .12s,border-color .12s}
.mk-tab:hover{color:var(--ink)}.mk-tab[aria-pressed=true]{color:var(--ink);font-weight:600;border-bottom-color:var(--accent)}
.mk-tab:focus{outline:none}.mk-tab:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mk-recipe{margin:.2rem 0 .6rem 2.4rem}.mk-recipe .h{word-break:break-all}
.mk-example .mk-tree{margin-top:.8rem}
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
.mk-gap{flex:1 1 0;min-width:0}
.mk-node-fold{background:none;box-shadow:inset 0 0 0 1px var(--haze-line);color:var(--muted)}
.mk-tree-fold .mk-node{min-width:0}
.mk-node-used{background:var(--pv-fact);color:#fff}
.mk-src{border-top:1px solid var(--haze-line);padding:.9rem 0 .6rem}
.mk-src>summary{cursor:pointer;list-style:none;display:flex;gap:.8rem;align-items:baseline;flex-wrap:nowrap;min-width:0}
.mk-src-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mk-src-meta{flex:none}
.mk-src>summary::-webkit-details-marker{display:none}
.mk-src>summary::before{content:"+";font-family:"Spline Sans Mono",ui-monospace,monospace;color:var(--muted);width:1em;flex:none}
.mk-src[open]>summary::before{content:"\u2013"}
.mk-src-title{font-weight:600}
.mk-marks{display:inline-flex;gap:.35rem;flex:none}
.mk-marks i,.mk-legend i{font-family:"Spline Sans Mono",ui-monospace,monospace;font-style:normal;font-size:.66rem;letter-spacing:.04em;padding:.1em .4em;border-radius:2px;color:var(--haze);border:1px dashed var(--haze-line)}
.mk-marks i[data-on],.mk-legend i[data-on]{color:var(--pv-fact);border:1px solid var(--pv-fact)}
.mk-intro .mk-legend{max-width:none;line-height:2;margin:0}.mk-legend i{margin-right:.3em}.mk-sep{display:inline-block;width:1.1em}
.mk-src-meta{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.72rem;color:var(--muted);margin-left:auto}
.mk-rung-head{padding-bottom:.4rem;position:sticky;top:-1.6rem;z-index:3;background:var(--surface);scroll-margin-top:0}.mk-rung-head h2{margin:0}
body[data-view=merkle][data-sub=in] .wrap{display:grid;grid-template-columns:11rem minmax(0,1fr);column-gap:2.5rem;align-content:start}
body[data-view=merkle][data-sub=in] .wrap>*{grid-column:2}
body[data-view=merkle][data-sub=in] .mk-rail{display:flex;grid-column:1;grid-row:1/span 400;position:sticky;top:0;align-self:start;flex-direction:column;gap:.35rem;border-top:none;padding:.2rem 0 0}
.mk-rail a{display:block;margin-bottom:.35rem;font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.78rem;color:var(--muted);text-decoration:none;padding:.15rem 0 .15rem .6rem;border-left:2px solid transparent;line-height:1.35}
.mk-rail a:hover{color:var(--ink)}.mk-rail a[aria-current]{color:var(--ink);border-left-color:var(--accent)}
.mk-rail .mk-count{margin-left:.5em}
.mk-run code{font-size:.78rem}.mk-runlog{margin:.2rem 0 0}.mk-runlog pre{font-size:.74rem;white-space:pre-wrap}.mk-rung-head .mk-count{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.75rem;color:var(--muted);margin-left:.6em;font-weight:400}
.mk-adapters{padding-top:.4rem;border-top:none}
.mk-rows{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:1rem;margin-top:.8rem;align-items:start}
.mk-arow{position:relative;display:flex;flex-direction:column;gap:.3rem;background:var(--glas);border:0;border-radius:var(--r-sm);box-shadow:inset 0 1px 0 var(--glas-licht),inset 0 0 0 1px var(--glas-rand);padding:1rem 1.15rem 1.05rem;cursor:pointer;transition:box-shadow .12s}
.mk-arow:hover,.mk-arow[data-open]{box-shadow:inset 0 1px 0 var(--glas-licht),inset 0 0 0 1px var(--muted)}.mk-arow[data-open]{z-index:7}
.mk-arow[data-state=empty]{background:none;box-shadow:none;outline:1px dashed var(--haze-line);outline-offset:-1px}.mk-arow[data-state=empty]:hover{outline-color:var(--muted)}
.mk-arow .mk-role{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.72rem;letter-spacing:.03em;color:var(--muted)}
.mk-plugmain{display:flex;flex-direction:column;gap:.15rem;min-width:0}
.mk-plug{font-weight:700;color:var(--ink);font-size:1rem;line-height:1.3;display:inline-flex;align-items:center}.mk-plug.mk-empty{color:var(--muted);font-weight:500}
.mk-sico.mark{display:inline-flex;width:16px;height:16px;color:var(--muted);margin-right:.45rem}.mk-sico.mark svg{width:16px;height:16px;stroke-width:1.5}
.mk-st{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.72rem;color:var(--pv-fact)}.mk-arow[data-state=empty] .mk-st{color:var(--muted)}
.mk-chosen{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.72rem;color:var(--accent)}.mk-chosen:empty{display:none}
.mk-choose{position:absolute;top:.8rem;right:1rem;font-size:.8rem;color:var(--muted)}.mk-arow:hover .mk-choose{color:var(--accent)}
.mk-options{position:absolute;top:calc(100% + 6px);left:0;width:max-content;min-width:100%;max-width:min(30rem,88vw);z-index:8;background:var(--pop);border-radius:var(--r-sm);box-shadow:inset 0 0 0 1px var(--glas-rand),0 12px 32px rgba(14,36,51,.22);padding:.25rem .85rem .5rem;cursor:default;text-align:left;font-size:.88rem}
.mk-rows,.mk-adapters{overflow:visible}
.mk-opt{display:flex;flex-wrap:wrap;align-items:baseline;gap:.1rem .6rem;padding:.42rem .6rem;margin:0 -.6rem;border-top:1px solid var(--haze-line);border-radius:3px}.mk-opt:first-child{border-top:none}
.mk-opt[data-state=available],.mk-opt[data-state=none]{cursor:pointer}.mk-opt[data-state=available]:hover,.mk-opt[data-state=none]:hover{background:var(--surface-2)}.mk-opt[data-state=plugged]{opacity:.85}.mk-opt[data-state=known]{opacity:.55;cursor:default}
.mk-opt-name{font-weight:600;color:var(--ink)}.mk-opt[data-state=known] .mk-opt-name{color:var(--muted);font-weight:500}
.mk-opt-state{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.7rem;color:var(--muted)}.mk-opt[data-state=plugged] .mk-opt-state{color:var(--pv-fact)}
.mk-opt-name{font-size:.92rem;font-weight:600}.mk-opt-state{margin:0}.mk-opt-note{flex-basis:100%;font-size:.82rem;color:var(--muted);line-height:1.4}
.mk-opt-foot{font-family:Lato,system-ui,sans-serif;font-size:.8rem;color:var(--muted);margin:.5rem 0 0;line-height:1.4}
.mk-opt-foot{margin:.6rem 0 0}
.mk-adapter{display:grid;grid-template-columns:12rem 1fr;gap:.15rem 1rem;padding:.5rem 0;border-top:1px dashed var(--haze-line)}
.mk-adapter b{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.78rem;font-weight:500;color:var(--ink)}
.mk-adapter span{font-size:.95rem}
.mk-adapter em{grid-column:2;color:var(--muted);font-style:normal;font-size:.88rem}
.mk-adapter[data-state=available]{color:var(--muted)}.mk-adapter[data-state=available] b{color:var(--muted)}
.mk-slot{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.66rem;letter-spacing:.04em;font-style:normal;padding:.1em .4em;border-radius:2px;margin-right:.55em;color:var(--pv-fact);border:1px solid var(--pv-fact);vertical-align:.1em}
.mk-adapter[data-state=available] .mk-slot{color:var(--pv-warn);border-color:var(--pv-warn)}
.mk-last{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.72rem;color:var(--muted)}
.mk-nb .mk-text,.mk-nb .mk-used{color:var(--muted)}
.mk-text .mk-used{display:block;margin-top:.15rem}
.mk-recipe{margin:-.2rem 0 .5rem 5.9rem}.mk-recipe>summary{font-size:.82rem;color:var(--muted)}
.mk-rest{margin:.5rem 0 0}
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
.pair{border-top:1px solid var(--haze-line);padding:1.6rem 0 1.2rem;scroll-margin-top:1rem}
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
.pair>header{cursor:pointer;position:static;background:none;padding:0 0 .5rem;box-shadow:none;display:flex;gap:.8rem;align-items:baseline}
body[data-view=sources] .pair[data-prose]:not([data-heading]){display:none}
body[data-view=sources] .pair[data-heading]{padding:1.4rem 0 .1rem}
body[data-view=sources] .rv-lede{margin-bottom:.4rem}
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
.reading .mm{color:var(--pv-bad);font-weight:600}
.reading[data-mismatch] .rv[data-verdict=fair]{color:var(--muted)}
.rv-guard{display:flex;gap:.5rem;align-items:center;flex-basis:100%;margin-top:.4rem}.rv-guard input{flex:1;font:inherit;font-size:.9rem;padding:.3rem .5rem;border:1px solid var(--haze-line);border-radius:3px;background:var(--surface)}
.reading .j{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.68rem;letter-spacing:.07em;border:1px dashed var(--haze-line);border-radius:999px;padding:.12em .55em;margin-right:.4em;color:var(--muted)}
.loc{margin:0 0 1rem}.loc b{font-weight:500;color:var(--muted)}.loc a{color:var(--muted)}
:root{--pv-fact:#0d9488;--pv-inf:#7c3aed;--pv-warn:#d97706;--pv-warn-vlak:rgba(217,119,6,.11);--pv-bad:#dc2626;--surface:var(--card);--surface-2:#eaf0f2;--pop:#fff;--glas:var(--card);--glas-rand:var(--haze-line);--glas-licht:transparent;--r:8px;--r-sm:4px;--accent-lift:#6d9bff;--brand-lift:#7de9f7}
/* The night token set comes from the house css handed in by the caller (brandCss); only the page-specific night rules live here. */
body[data-theme=night]{--merk-grad:linear-gradient(105deg,var(--mark-ok),var(--accent-lift));--surface:var(--card);--surface-2:#22375a;--pop:#22375a;--glas:rgba(255,255,255,.035);--glas-rand:rgba(255,255,255,.055);--glas-licht:rgba(255,255,255,.09);--pv-fact:#5eead4;--pv-inf:#c4b5fd;--pv-warn:#f0b429;--pv-bad:#f2818c;--proveml-entity-color:#5eead4;--proveml-inference-color:#c4b5fd;--proveml-danger-color:#f2818c;--proveml-warning-color:#f0b429;background-image:radial-gradient(55% 38% at 28% 0%,color-mix(in srgb,var(--brand-lift) 22%,transparent),transparent 62%)}
body[data-theme=night] .wrap{background:transparent}
body[data-theme=night] .reviewbar{background:var(--glas);border-bottom:1px solid var(--glas-rand);backdrop-filter:blur(6px)}
body[data-theme=night] .rv-panel{background:var(--glas);box-shadow:inset 0 0 0 1px var(--glas-rand);border-left:none}
body[data-theme=night] .rv-actions .rv-btn.rv-primary{color:var(--night);border-color:var(--accent)}
body[data-theme=night] .mk-out-output{background:var(--sky);color:var(--night)}
.rv-theme{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.72rem;letter-spacing:.03em;color:var(--muted);background:none;border:none;padding:0;margin-left:1.2rem;cursor:pointer;display:inline-flex;align-items:center;gap:.3rem}.rv-theme:hover{color:var(--ink)}
/* The five states are drawn by the house css handed in by the caller (brandCss). */
/* proveml's rendering is the first pass and stays as proveml draws it. Our
   judgement is a second pass, added BESIDE the mark, never painted onto it:
   a small square after the reading, hollow while it waits, filled when judged. */
.col .proveml-inference:not(.proveml-verified){border-bottom:1.5px dashed var(--muted)}
.col .proveml-fact[data-judge],.col .proveml-inference[data-judge]{cursor:pointer}
.col .proveml-fact[data-judge]::after,.col .proveml-inference[data-judge]::after{content:"";display:inline-block;width:.6em;height:.6em;margin-left:.28em;vertical-align:.35em;border:1.5px dashed var(--muted);border-radius:1px;box-sizing:border-box;background:none}
.col .proveml-fact[data-judge=fair]::after,.col .proveml-inference[data-judge=fair]::after,.col .proveml-fact[data-judge=flag]::after,.col .proveml-inference[data-judge=flag]::after{border-style:solid}
.col .proveml-fact[data-judge=fair]::after{background:var(--pv-fact);border-color:var(--pv-fact)}
.col .proveml-inference[data-judge=fair]::after{background:var(--pv-inf);border-color:var(--pv-inf)}
.col .proveml-fact[data-judge=flag]::after,.col .proveml-inference[data-judge=flag]::after{background:var(--pv-bad);border-color:var(--pv-bad)}
.col .proveml-fact[data-judge=open]:hover::after,.col .proveml-inference[data-judge=open]:hover::after{border-color:var(--ink)}
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
// A value that sits verbatim in its quote is confirmed by the machine, not by a person:
// recorded as such, covered by the sign-off, and open to being overruled from the panel.
{ let wrote = false; const have = merged();
  for (const r of readings) if (r.hasAttribute('data-literal') && !have[r.dataset.review]) { local[r.dataset.review] = { verdict: 'fair', src: r.dataset.src, field: r.dataset.field, literal: true, by: 'machine', at: new Date().toISOString() }; wrote = true; }
  if (wrote) persist(); }
function persist() { try { localStorage.setItem(KEY, JSON.stringify(local)); } catch {} }
// The outgoing tree, live: the output root, then every judgement in key
// order, hashed exactly as manifest.js does (leaf/node tags with a NUL byte,
// odd node promoted unchanged), so the root here is the root a hand-back
// carries. Redrawn on every judgement.
let outTok = 0;
async function sha256hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
}
async function drawOutgoing() {
    const host = document.getElementById('mk-out'); if (!host) return;
    const tok = ++outTok;
    const saved = merged();
    const ids = Object.keys(saved).sort();
    const NUL = String.fromCharCode(0);
    const lines = ['output ' + host.dataset.outputRoot].concat(ids.map(function (id) { const v = saved[id]; return id + ' ' + v.src + '.' + v.field + ' ' + v.verdict + ' ' + v.at; }));
    const kinds = ['output'].concat(ids.map(function (id) { const v = saved[id]; return v.verdict === 'flag' ? 'no' : (v.by === 'machine' ? 'literal' : 'inferred'); }));
    const labels = ['the output itself'].concat(ids.map(function (id) { const v = saved[id]; return v.src + '.' + v.field + ': ' + (v.verdict === 'flag' ? 'no' : (v.by === 'machine' ? 'yes, literal, by the machine' : 'yes, inferred, by you')); }));
    let level = [];
    for (const l of lines) level.push(await sha256hex('leaf' + NUL + l));
    const levels = [level];
    while (level.length > 1) {
        const next = [];
        for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? await sha256hex('node' + NUL + level[i] + level[i + 1]) : level[i]);
        levels.push(next); level = next;
    }
    if (tok !== outTok) return;
    // Only the leaves are drawn: the inner layers are the same fold every
    // time and said nothing a reader could act on. The fold is stated in
    // words below, and the root is what it lands on.
    const cells = lines.map(function (_, j) {
        return '<span class="mk-leafcell mk-out-' + kinds[j] + '" data-label="' + labels[j].replace(/"/g, '&quot;') + '" data-lo="' + j + '" data-hi="' + j + '" title="' + labels[j].replace(/"/g, '&quot;') + '"></span>';
    }).join('');
    // The fold itself, closed by default: the inner layers up to the root,
    // for whoever wants to see the leaves become one line.
    let spans = lines.map(function (_, i) { return { lo: i, hi: i }; });
    const rows = [];
    for (let d = 0; d < levels.length; d++) {
        const nx = [];
        for (let j = 0; j < spans.length; j += 2) nx.push({ lo: spans[j].lo, hi: (j + 1 < spans.length ? spans[j + 1] : spans[j]).hi });
        if (d > 0) {
            const thin = levels[d].length > 16;
            rows.push('<div class="mk-row' + (thin ? ' mk-thin-row' : '') + '">' + levels[d].map(function (h, j) {
                const sp = spans[j];
                return '<span class="mk-node' + (d === levels.length - 1 ? ' mk-node-root' : '') + '" data-lo="' + sp.lo + '" data-hi="' + sp.hi + '" title="' + (sp.hi - sp.lo + 1) + ' leaves" style="flex-grow:' + (sp.hi - sp.lo + 1) + '">' + (thin ? '' : h.slice(0, 8)) + '</span>';
            }).join('') + '</div>');
        }
        spans = nx;
    }
    const fold = levels.length > 1
        ? '<details class="mk-fold"><summary>show how they fold, ' + (levels.length - 1) + ' ' + (levels.length === 2 ? 'level' : 'levels') + ' up to the root</summary><div class="mk-tree" aria-hidden="true">' + rows.reverse().join('') + '</div></details>'
        : '';
    host.innerHTML = '<div class="mk-leaves">' + cells + '</div>' + fold;
    host.dataset.levels = String(levels.length - 1);
    const count = function (k) { return kinds.filter(function (x) { return x === k; }).length; };
    const open = readings.filter(function (r) { return !saved[r.dataset.review]; }).length;
    const legend = document.querySelector('.mk-out-legend');
    const anchoredRoots = (host.dataset.anchoredRoot || '').split(' ').filter(Boolean);
    const liveRoot = levels[levels.length - 1][0];
    const signedRoots = (host.dataset.signedRoot || '').split(' ').filter(Boolean);
    const signNote = signedRoots.length ? (signedRoots.indexOf(liveRoot) >= 0 ? ' <span class="sig">this root is signed</span>' : ' <span class="mk-drift">not yet signed: judgements since the last sign-off are not under a signature</span>') : '';
    const anchorNote = signNote + (anchoredRoots.length ? (anchoredRoots.indexOf(liveRoot) >= 0 ? ' <span class="sig">and anchored</span>' : ' <span class="mk-drift">differs from the anchored roots: judgements since hand-back are not on any log yet</span>') : '');
    if (legend) legend.innerHTML = '<b>' + lines.length + ' leaves.</b> <i class="mk-out-output"></i>the output' + '<i class="mk-out-literal"></i>' + count('literal') + ' literal, by the machine' + '<i class="mk-out-inferred"></i>' + count('inferred') + ' inferred, by you' + (count('no') ? '<i class="mk-out-no"></i>' + count('no') + ' said no' : '') + (open ? '; ' + open + ' still open and not yet in the root' : '') + '. They fold in ' + (levels.length - 1) + ' levels to root <code class="mk-root">' + liveRoot + '</code>' + anchorNote;
}
const wrapEl = document.querySelector('.wrap');
function spy() {
    const rail = document.querySelector('.mk-rail'); if (!rail || !wrapEl) return;
    const top = wrapEl.getBoundingClientRect().top + 8;
    let cur = null;
    for (const h of document.querySelectorAll('.mk-rung-head[id]')) if (h.getBoundingClientRect().top <= top + 40) cur = h.id;
    for (const a of rail.querySelectorAll('a')) { if (a.dataset.group === cur) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }
}
if (wrapEl) wrapEl.addEventListener('scroll', spy, { passive: true });
document.addEventListener('click', (e) => { if (e.target.closest('.mk-tab, .rv-vw')) setTimeout(spy, 50); });
const THEME = 'proveml-theme';
function applyTheme(t) { if (t === 'night') document.body.dataset.theme = 'night'; else delete document.body.dataset.theme; const b = document.getElementById('rv-theme'); if (b) b.innerHTML = t === 'night' ? '<svg class="rv-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>light' : '<svg class="rv-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/></svg>night'; }
try { applyTheme(localStorage.getItem(THEME) || 'paper'); } catch {}
document.addEventListener('click', (e) => { const b = e.target.closest('#rv-theme'); if (!b) return; const t = document.body.dataset.theme === 'night' ? 'paper' : 'night'; applyTheme(t); try { localStorage.setItem(THEME, t); } catch {} b.blur(); });
function placeActions() {
    const acts = document.querySelector('.rv-actions'); if (!acts) return;
    const foot = document.getElementById('rv-panel-foot'); const tools = document.querySelector('.rv-tools');
    const target = document.body.dataset.view === 'full' && foot ? foot : tools;
    if (target && acts.parentElement !== target) target.appendChild(acts);
}
placeActions();
function fitBar() { const b = document.querySelector('.reviewbar'); if (b) document.documentElement.style.setProperty('--bar-h', b.offsetHeight + 'px'); }
fitBar(); window.addEventListener('resize', fitBar); window.addEventListener('load', fitBar);
function paint() {
    drawOutgoing();
    const saved = merged();
    let judged = 0, flagged = 0;
    for (const el of readings) {
        const v = saved[el.dataset.review];
        el.dataset.state = v ? v.verdict : '';
        el.querySelector('.rv-state').textContent = v ? (v.by === 'machine' ? '\\u2713 confirmed by the machine' : (v.verdict === 'fair' ? '\\u2713 yes, ' : '\\u2691 no, ') + v.at.slice(0, 10)) : 'unjudged';
        if (v) { judged++; if (v.verdict === 'flag') flagged++; }
        const ev = el.closest('.evidence');
        if (ev) { if (v) ev.dataset.judged = v.verdict; else { delete ev.dataset.judged; ev.removeAttribute('data-expanded'); } }
    }
    for (const card of document.querySelectorAll('.pair')) {
        const rs = readings.filter((r) => r.dataset.src === card.id);
        card.toggleAttribute('data-all-judged', rs.length > 0 && rs.every(r => saved[r.dataset.review]));
        card.toggleAttribute('data-prose', rs.length === 0);
        { const open = rs.filter((r) => !saved[r.dataset.review]).length; const scan = card.dataset.scan;
          card.dataset.note = rs.length ? (open ? open + (open === 1 ? ' needs you' : ' need you') : 'all confirmed') : (scan === 'checking' ? 'reading\u2026' : scan === 'clean' ? 'nothing to confirm' : scan === 'pending' ? 'not read yet' : ''); }
        card.toggleAttribute('data-flagged', rs.some(r => (saved[r.dataset.review] || {}).verdict === 'flag'));
    }
    // The text carries the review state too: a fact goes green when its
    // readings are judged fair, red when one is flagged, amber while a human
    // still has to look. In full view, clicking it goes to the reading.
    for (const card of document.querySelectorAll('.pair')) {
        const byField = {};
        // By paragraph id, not by DOM position: an open paragraph's readings
        // sit in the side panel, not inside the paragraph.
        for (const r of readings) {
            if (r.dataset.src !== card.id) continue;
            const v = saved[r.dataset.review];
            const st = v ? v.verdict : 'open';
            const cur = byField[r.dataset.field];
            byField[r.dataset.field] = cur === 'flag' || st === 'flag' ? 'flag' : (cur === 'open' || st === 'open' ? 'open' : st);
        }
        for (const fEl of card.querySelectorAll('.col .proveml-fact')) {
            // A bound reading names the full path (deploy:frontier.claims); an
            // inference reading names only its field (inf1) under the paragraph.
            const path = fEl.dataset.path || '';
            const tail = path.split('.').slice(1).join('.');
            const st = byField[path] || (tail && byField[tail]);
            if (st) fEl.dataset.judge = st; else delete fEl.dataset.judge;
        }
        // The model's proposals on one paragraph can be stood behind together:
        // the author has read the paragraph, and one yes per span is bookkeeping.
        const openInf = readings.filter((r) => r.dataset.src === card.id && r.dataset.span && !saved[r.dataset.review]);
        const col = card.querySelector('.cols > .col:nth-child(2)') || document.querySelector('.rv-panel .col[data-home="' + card.id + '"]');
        if (col) {
            let bt = col.querySelector('.rv-batch');
            if (openInf.length >= 2) {
                if (!bt) { bt = document.createElement('button'); bt.className = 'rv-batch'; bt.dataset.card = card.id; col.prepend(bt); }
                bt.textContent = 'I stand behind all ' + openInf.length + ' the model proposed here';
            } else if (bt) bt.remove();
        }
    }
    const needEye = readings.filter((r) => !r.hasAttribute('data-literal') && !saved[r.dataset.review]).length;
    const needInf = readings.filter((r) => r.dataset.span && !saved[r.dataset.review]).length;
    const needBound = needEye - needInf;
    const litOpen = readings.filter((r) => r.hasAttribute('data-literal') && !saved[r.dataset.review]).length;
    const byMachine = readings.filter((r) => { const v = saved[r.dataset.review]; return v && v.by === 'machine'; }).length;
    const left = readings.length - judged;
    document.getElementById('rv-progress').textContent = left === 0 ? 'nothing left to judge' : left + ' to judge';
    const bd = document.getElementById('rv-breakdown');
    if (bd) {
        // One sentence, as the house asks: numbers coloured only where the colour codes something.
        const you = (k) => '<b data-k="you">' + k + '</b>';
        const first = byMachine ? 'The machine matched <b data-k="machine">' + byMachine + '</b> ' + (byMachine === 1 ? 'value' : 'values') + ' word for word to ' + (byMachine === 1 ? 'its' : 'their') + ' source.' : '';
        const open = needBound + needInf;
        const parts = [needBound ? needBound + ' on what a source supports' : '', needInf ? needInf + ' on your own text' : ''].filter(Boolean);
        const second = open ? ' ' + you(open) + (open === 1 ? ' reading needs' : ' readings need') + ' your judgement' + (parts.length > 1 ? ', ' + parts.join(' and ') + '.' : '.') : ' Nothing is left for you.';
        const third = flagged ? ' You said no to <b data-k="no">' + flagged + '</b>.' : '';
        bd.innerHTML = first + second + third; return;
    }
    document.dispatchEvent(new CustomEvent('proveml:paint'));
    const lb = document.getElementById('rv-literal');
    if (lb) {
        lb.style.display = litOpen ? '' : 'none';
        lb.textContent = litOpen === 1 ? 'confirm the machine-checked one' : 'confirm the ' + litOpen + ' machine-checked';
    }
    document.querySelector('.rv-fill').style.width = (readings.length ? Math.round(judged / readings.length * 100) : 0) + '%';
    document.getElementById('rv-next').style.display = judged === readings.length ? 'none' : '';
    document.getElementById('rv-sign')?.classList.toggle('rv-primary', judged === readings.length);
}
document.addEventListener('click', (e) => {
    const bt = e.target.closest('.rv-batch');
    if (bt) {
        const saved = merged();
        for (const el of readings) {
            if (el.dataset.src !== bt.dataset.card || !el.dataset.span || saved[el.dataset.review]) continue;
            local[el.dataset.review] = { verdict: 'fair', src: el.dataset.src, field: el.dataset.field, at: new Date().toISOString(), inference: true, span: el.dataset.span, kind: el.dataset.kind || '', why: el.dataset.why || '' };
        }
        persist(); paint(); return;
    }
    const gk = e.target.closest('.rv-guard-ok');
    if (gk) { const yes = gk.closest('.reading').querySelector('button.rv[data-verdict=fair]'); if (yes) yes.click(); return; }
    const b = e.target.closest('button.rv[data-verdict]');
    if (b) {
        const el = b.closest('.reading');
        const id = el.dataset.review;
        const cur = merged()[id];
        if (cur && cur.verdict === b.dataset.verdict) {
            if (committed[id]) local[id] = null; else delete local[id];
        } else if (el.dataset.mismatch !== undefined && b.dataset.verdict === 'fair') {
            // Standing behind a value the verifier rejects is allowed, but never
            // with one click: a reason is required and goes into the leaf.
            let g = el.querySelector('.rv-guard');
            if (!g) {
                g = document.createElement('span'); g.className = 'rv-guard';
                g.innerHTML = '<input type="text" placeholder="why you stand behind it despite the source" aria-label="reason"> <button type="button" class="rv-link rv-guard-ok">record it</button>';
                el.querySelector('.review').appendChild(g);
                g.querySelector('input').focus();
                return;
            }
            const reason = g.querySelector('input').value.trim();
            if (!reason) { g.querySelector('input').focus(); return; }
            local[id] = { verdict: 'fair', src: el.dataset.src, field: el.dataset.field, at: new Date().toISOString(), overrides: { verifier: 'mismatch', source: el.dataset.mismatch, reason } };
            g.remove();
        } else {
            local[id] = { verdict: b.dataset.verdict, src: el.dataset.src, field: el.dataset.field, at: new Date().toISOString(), ...(el.dataset.span ? { inference: true, span: el.dataset.span, kind: el.dataset.kind || '', why: el.dataset.why || '' } : {}) };
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
    // Full text is the reading; the source unfolds beside the claim you are on,
    // one at a time, and reading never has to leave the page to check.
    const panelBody = document.querySelector('#rv-panel .rv-panel-body');
    const restorePanel = () => {
        if (!panelBody) return;
        for (const moved of panelBody.querySelectorAll('.col[data-home]')) {
            const home = document.getElementById(moved.dataset.home);
            if (home) home.querySelector('.cols').appendChild(moved);
            moved.removeAttribute('data-home');
        }
        const empty = panelBody.querySelector('.rv-panel-empty'); if (empty) { empty.hidden = false; empty.textContent = 'Click a marked value in the paper to see where it comes from, then decide here.'; }
    };
    const activate = (card) => {
        document.querySelectorAll('.pair[data-active]').forEach((p) => { if (p !== card) p.removeAttribute('data-active'); });
        card.setAttribute('data-active', '');
        card.removeAttribute('data-closed');
        if (card.hasAttribute('data-all-judged')) card.setAttribute('data-open', '');
        if (panelBody && document.body.dataset.view === 'full') {
            restorePanel();
            const ev = card.querySelector('.cols > .col:nth-child(2)');
            if (ev) { ev.dataset.home = card.id; panelBody.appendChild(ev); const empty = panelBody.querySelector('.rv-panel-empty'); if (empty && ev.querySelector('.evidence')) empty.hidden = true; else if (empty) { empty.hidden = false; empty.textContent = card.dataset.scan === 'pending' ? 'Nothing here is bound to a source. The model pass has not read this paragraph yet.' : 'Nothing here is bound to a source and the model proposed nothing. Nothing to judge.'; } if (false) empty.hidden = true; }
        }
    };
    if (e.target.id === 'rv-panel-close') {
        restorePanel();
        document.querySelectorAll('.pair[data-active]').forEach((p) => p.removeAttribute('data-active'));
        return;
    }
    const pf = e.target.closest('.col .proveml-fact[data-judge]');
    const lc = e.target.closest('.pair .col:first-child');
    if (document.body.dataset.view === 'full' && (pf || lc) && !e.target.closest('a')) {
        const card = (pf || lc).closest('.pair');
        if (!pf && card.hasAttribute('data-active')) { card.removeAttribute('data-active'); restorePanel(); return; }
        activate(card);
        if (pf) {
            const field = (pf.dataset.path || '').split('.').slice(1).join('.');
            const ev = card.querySelector('.evidence[data-evidence-field="' + field + '"]');
            if (ev) { ev.scrollIntoView({ block: 'nearest' }); ev.classList.add('paired'); setTimeout(() => ev.classList.remove('paired'), 1600); }
        }
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
        restorePanel();
        document.body.dataset.view = vw.dataset.view; placeActions(); fitBar(); vw.blur();
        document.querySelectorAll('.rv-vw').forEach((b) => b.setAttribute('aria-pressed', String(b === vw)));
    }
    if (e.target.id === 'rv-prev-src' || e.target.id === 'rv-next-src') {
        const ps = [...document.querySelectorAll('.pair')];
        let ci = -1;
        ps.forEach((p, i) => { if (p.getBoundingClientRect().top <= 80) ci = i; });
        const t = ps[e.target.id === 'rv-next-src' ? Math.min(ci + 1, ps.length - 1) : Math.max(ci - 1, 0)];
        if (t) { if (document.body.dataset.view === 'full') activate(t); t.scrollIntoView(); }
    }
    if (e.target.id === 'rv-next') {
        const saved = merged();
        const next = readings.find(r => !r.hasAttribute('data-literal') && !saved[r.dataset.review]) || readings.find(r => !saved[r.dataset.review]);
        if (next) {
            const p = next.closest('.pair');
            if (p) { p.removeAttribute('data-closed'); if (document.body.dataset.view === 'full') { activate(p); p.scrollIntoView({ block: 'center' }); } }
            (next.closest('.evidence') || next).scrollIntoView({ block: 'center' });
        }
    }
    if (e.target.id === 'rv-export') {
        navigator.clipboard.writeText(JSON.stringify({ exported: new Date().toISOString(), judgements: merged() }, null, 1))
            .then(() => { e.target.textContent = 'copied'; setTimeout(() => e.target.textContent = 'copy review as JSON', 1500); });
    }
});
document.getElementById('rv-only').addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); document.body.toggleAttribute('data-only-unjudged', on); e.currentTarget.blur(); });
const ADKEY = 'proveml-adapters:' + (document.body.dataset.reviewKey || location.pathname);
function paintChoices() {
    let ch = {}; try { ch = JSON.parse(localStorage.getItem(ADKEY) || '{}'); } catch {}
    for (const r of document.querySelectorAll('.mk-arow')) { const c = ch[r.dataset.role]; const el = r.querySelector('.mk-chosen'); if (el) el.textContent = c ? 'chosen: ' + c.name + ', plugs in at the next build' : ''; }
}
paintChoices();
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const r of document.querySelectorAll('.mk-arow[data-open]')) { r.removeAttribute('data-open'); r.querySelector('.mk-options').hidden = true; } });
document.addEventListener('click', (e) => {
    const box = e.target.closest('.mk-arow');
    if (!box || !e.target.closest('.mk-options')) {
        for (const r of document.querySelectorAll('.mk-arow[data-open]')) if (r !== box) { r.removeAttribute('data-open'); r.querySelector('.mk-options').hidden = true; }
    }
    if (box && !e.target.closest('.mk-options')) { const o = box.querySelector('.mk-options'); o.hidden = !o.hidden; box.toggleAttribute('data-open', !o.hidden); const ch = box.querySelector('.mk-choose'); if (ch) ch.blur(); return; }
    const opt0 = e.target.closest('.mk-opt');
    if (opt0 && (opt0.dataset.state === 'available' || opt0.dataset.state === 'none')) {
        const use = opt0; const row = use.closest('.mk-arow'); const opt = opt0;
        let all = {}; try { all = JSON.parse(localStorage.getItem(ADKEY) || '{}'); } catch {}
        all[row.dataset.role] = { name: opt.dataset.name, state: opt.dataset.state, at: new Date().toISOString() };
        try { localStorage.setItem(ADKEY, JSON.stringify(all)); } catch {}
        document.dispatchEvent(new CustomEvent('proveml:adapter-choice', { detail: { role: row.dataset.role, ...all[row.dataset.role] } }));
        paintChoices(); row.querySelector('.mk-options').hidden = true; row.removeAttribute('data-open'); use.blur(); return;
    }
    const mt = e.target.closest('.mk-tab');
    if (!mt) return;
    document.body.dataset.sub = mt.dataset.sub;
    document.querySelectorAll('.mk-tab').forEach((b) => b.setAttribute('aria-pressed', String(b === mt)));
    const wrap = document.querySelector('.wrap'); if (wrap) wrap.scrollTo(0, 0);
});
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
    const lc = e.target.closest('.mk-leafcell');
    if (lc) { const w = lc.closest('.merkle').querySelector('.mk-what'); if (w) w.textContent = lc.dataset.label; return; }
    const n = e.target.closest('.mk-node, .mk-leaf');
    if (!n) return;
    const sec = n.closest('.merkle');
    if (!sec) return;
    const nodes = Array.from(sec.querySelectorAll('.mk-node'));
    if (!nodes.length) return;
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
    const lc = e.target.closest('.mk-leafcell');
    if (lc) { const w = lc.closest('.merkle').querySelector('.mk-what'); if (w) w.textContent = ''; return; }
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
// The source, in full, on request: opened from any reading, with what that
// reading rests on highlighted. The text was archived once and sits in the
// page as data; nothing is fetched.
(function () {
    var modal = document.getElementById('rv-modal'); if (!modal) return;
    var body = document.getElementById('rv-modal-body'), title = document.getElementById('rv-modal-title');
    var escH = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var escR = function (t) { return t.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&'); };
    var open = function (id, hl, hl2) {
        var el = document.getElementById('snap-' + id); if (!el) return;
        var text = el.textContent || '';
        var tokens = [];
        if (hl && hl.trim()) tokens.push(hl.trim());
        var nums = ((hl || '') + ' ' + (hl2 || '')).match(/\\d+(?:[.,]\\d+)?/g) || [];
        for (var k = 0; k < nums.length; k++) if (tokens.indexOf(nums[k]) < 0) tokens.push(nums[k]);
        tokens.sort(function (a, b) { return b.length - a.length; });
        var html = escH(text);
        for (var t = 0; t < tokens.length; t++) {
            var parts = escH(tokens[t]).split(/\\s+/).map(escR);
            var re = new RegExp(parts.join('\\s+'), tokens[t].length < 4 ? 'g' : 'gi');
            html = html.replace(re, function (m) { return '<mark>' + m + '</mark>'; });
        }
        title.textContent = 'source: ' + id;
        body.innerHTML = html;
        modal.hidden = false; document.body.style.overflow = 'hidden';
        var first = body.querySelector('mark'); if (first) first.scrollIntoView({ block: 'center' });
    };
    var close = function () { modal.hidden = true; document.body.style.overflow = ''; };
    document.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('.rv-see');
        if (b) { open(b.dataset.source, b.dataset.hl || '', b.dataset.hl2 || ''); return; }
        if (e.target.id === 'rv-modal-close' || e.target.classList.contains('rv-modal-back')) close();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) close(); });
})();

// Hovering a paragraph previews what it holds in the Source panel; clicking
// pins. Nothing moves in the DOM on hover, so it stays calm.
(function () {
    var panel = document.querySelector('#rv-panel .rv-panel-body'); if (!panel) return;
    var empty = panel.querySelector('.rv-panel-empty'); var restText = empty ? empty.innerHTML : '';
    var escT = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var over = null;
    var preview = function (pair) {
        if (document.querySelector('.pair[data-active]') || document.body.dataset.view !== 'full' || !empty) return;
        var rs = readings.filter(function (r) { return r.dataset.src === pair.id; });
        var saved = merged(); var html = '';
        if (!rs.length) { html = '<b>' + escT(pair.dataset.note || 'nothing to confirm') + '</b>'; }
        else {
            var open = rs.filter(function (r) { return !saved[r.dataset.review]; }).length;
            html = '<b>' + rs.length + (rs.length === 1 ? ' reading' : ' readings') + (open ? ', ' + open + (open === 1 ? ' needs you' : ' need you') : ', all confirmed') + '.</b> Click the paragraph to open its sources.';
            for (var k = 0; k < rs.length; k++) {
                var r = rs[k], v = saved[r.dataset.review];
                var ev = r.closest('.evidence'); var head = ev ? ev.querySelector('.ev-head') : null;
                var val = head ? head.textContent.replace(/\\s+/g, ' ').trim() : r.dataset.field;
                var st = v ? (v.verdict === 'flag' ? '<span class="st flag">no</span>' : (v.by === 'machine' ? '<span class="st">machine</span>' : '<span class="st">yes</span>')) : '<span class="st open">needs you</span>';
                html += '<div class="rv-prev"><code>' + escT(val.slice(0, 90)) + '</code> ' + st + '</div>';
            }
        }
        empty.innerHTML = html; empty.hidden = false;
    };
    var leave = function () { if (empty && !document.querySelector('.pair[data-active]')) { empty.innerHTML = restText; empty.hidden = false; } };
    document.addEventListener('mouseover', function (e) {
        var p = e.target.closest && e.target.closest('.pair:not([data-heading])');
        if (!p || p === over) return;
        over = p; preview(p);
    });
    document.addEventListener('mouseout', function (e) {
        var p = e.target.closest && e.target.closest('.pair');
        var to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.pair') : null;
        if (p && to !== p) { over = null; leave(); }
    });
})();

`;
