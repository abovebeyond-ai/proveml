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

/** The identity of one reading: hash over exactly the parts being judged. */
export function evidenceReviewId(subjectId, e) {
    const quotes = e.sourceQuotes ? e.sourceQuotes.map((q) => q.sourceQuote).join('\u0000') : (e.sourceQuote || '');
    return reviewId(subjectId, e.field, e.claimValue, e.basis, quotes, e.note || '');
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
 * @returns {{ html: string, verified: number, total: number, ids: string[] }}
 */
export function reviewPage(opts) {
    const {
        store, subjects,
        name = 'review', storeName = 'store', subjectsWord = 'subjects',
        leftLabel = 'the output', rightLabel = 'the evidence',
        snapshots = {}, committedReview = null, thresholds,
    } = opts;
    if (!store || typeof store !== 'object') throw new Error('reviewPage: expected a fact store object.');
    if (!Array.isArray(subjects) || subjects.length === 0) throw new Error('reviewPage: expected a non-empty subjects array.');

    let total = 0, verified = 0;
    const ids = [];

    const cards = subjects.map((s, i) => {
        const v = verifyProveml(s.claim, store, thresholds ? { thresholds } : undefined);
        total += v.total; verified += v.verified;
        if (v.errors.length) throw new Error(`${s.id}: ${v.errors.join('; ')}`);
        const left = renderProveml(s.claim, store).html;
        const right = (s.evidence || []).map((e) => evidenceBlock(s, e, snapshots, ids)).join('');
        const meta = s.meta ? `${esc(s.meta)} ` : '';
        return `<section class="pair" id="${attr(s.id)}">
  <header><h2><span class="nr">${String(i + 1).padStart(2, '0')}</span>${esc(s.title)}</h2><p class="meta">${meta}${v.verified}/${v.total} claims verified, ${(s.evidence || []).length} fields of evidence.</p></header>
  <div class="cols">
    <div class="col"><div class="lbl">${esc(leftLabel)}</div>${left}</div>
    <div class="col"><div class="lbl">${esc(rightLabel)}</div>${right}</div>
  </div>
</section>`;
    }).join('\n');

    const built = new Date().toISOString().slice(0, 10);
    const committedTag = committedReview
        ? `<script>window.PROVEML_REVIEW_COMMITTED=${JSON.stringify(committedReview).replace(/</g, '\\u003c')}</script>\n`
        : '';

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ProveML ${esc(name)}</title><style>${CSS}</style></head><body>
<div class="wrap">
<div class="reviewbar"><h1 class="lockup">${MERKTEKEN}<span class="pml-name">proveml</span><span class="tool">${esc(name)}</span></h1><span class="rv-nav"><button id="rv-prev-src" class="rv-pill rv-arrow" aria-label="previous source">\u2191</button><button id="rv-next-src" class="rv-pill rv-arrow" aria-label="next source">\u2193</button></span><span id="rv-progress"></span><div class="rv-meter"><div class="rv-fill"></div></div><span class="rv-actions"><button id="rv-next" class="rv-pill">next unjudged</button><label class="rv-filter"><input type="checkbox" id="rv-only"> only unjudged</label><button id="rv-export" class="rv-link">copy review as JSON</button></span></div>
<p class="statline">store ${esc(storeName)}, ${subjects.length} ${esc(subjectsWord)}: <b>${verified}/${total} claims machine-verified</b>, built ${built}.</p>
${cards}
</div>${committedTag}<script>${SCRIPT}</script></body></html>`;

    return { html, verified, total, ids };
}

function evidenceBlock(s, e, snapshots, ids) {
    const rid = evidenceReviewId(s.id, e);
    ids.push(rid);
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
        if (quotes.length === 1) {
            const q = quotes[0];
            const loc = q.sourceLocator ? `<b>${esc(String(q.sourceLocator).replace(/_/g, ' '))}</b>` : '';
            const link = e.sourceHref ? `${loc ? ', ' : ''}verbatim in the <a href="${attr(e.sourceHref)}">archived source</a>` : '';
            body = `<p class="quote">\u201C${esc(q.sourceQuote)}\u201D</p>${loc || link ? `<p class="loc">${loc}${link}</p>` : ''}`;
        } else {
            body = quotes.map((q) => {
                const loc = q.sourceLocator ? `<p class="loc">${esc(String(q.sourceLocator).replace(/_/g, ' '))}</p>` : '';
                return `<p class="quote">\u201C${esc(q.sourceQuote)}\u201D</p>${loc}`;
            }).join('');
            body += `<p class="loc">each verbatim in the${e.sourceHref ? ` <a href="${attr(e.sourceHref)}">archived source</a>` : ' archived source'}</p>`;
        }
    } else if (e.basis === 'derived') {
        body = `<p class="basis basis-derived">derived, not quoted</p>`;
    } else if (e.basis === 'absence') {
        body = `<p class="basis basis-absence">rests on absence \u2014 you cannot quote a source not having something</p>`;
    } else {
        throw new Error(`${s.id}.${e.field}: unknown basis "${e.basis}".`);
    }
    return `<div class="evidence" data-evidence-field="${attr(e.field)}"><p class="ev-head"><code>${esc(e.field)}</code> = <b>${esc(String(e.claimValue))}</b></p>${body}${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}
<div class="reading" data-review="${rid}" data-src="${attr(s.id)}" data-field="${attr(e.field)}"><span class="j">our reading</span><span class="q">a fair reading of the evidence?</span>
<div class="review"><button class="rv" data-verdict="fair">fair</button><button class="rv" data-verdict="flag">flag</button><span class="rv-state"></span></div></div></div>`;
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
.rv-pill{font-family:inherit;font-size:.8rem;letter-spacing:.02em;background:none;border:1px solid var(--haze-line);border-radius:999px;padding:.35rem .85rem;color:var(--ink);cursor:pointer;transition:border-color .15s ease,color .15s ease,background .15s ease;-webkit-tap-highlight-color:transparent}
.rv-pill:hover{border-color:var(--accent);color:var(--accent)}
.rv-pill:active{background:var(--accent);border-color:var(--accent);color:var(--card)}
.rv-pill:focus{outline:none}
.rv-pill:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rv-nav{display:flex;gap:.4rem}
.rv-arrow{padding:.25rem .6rem;font-size:.9rem;line-height:1.4;color:var(--muted)}
#rv-progress{font-family:Lato,sans-serif;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ink)}
.rv-link{font-family:inherit;font-size:inherit;background:none;border:none;padding:0;color:var(--muted);cursor:pointer;text-decoration:underline;text-decoration-color:var(--haze-line);text-underline-offset:.3em;transition:color .2s ease,text-decoration-color .2s ease}
.rv-link:hover{color:var(--accent);text-decoration-color:var(--accent)}
.rv-link:focus{outline:none}
.rv-link:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rv-filter{display:flex;gap:.45rem;align-items:center;cursor:pointer;transition:color .2s ease}
.rv-filter:hover{color:var(--ink)}
.rv-filter input{accent-color:var(--accent);width:.9em;height:.9em;margin:0}
.pair{border-top:1px solid var(--haze-line);padding:1.6rem 0 1.2rem;scroll-margin-top:3.9rem}
.reviewbar+.pair{border-top:none}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-top:1rem;align-items:start}
.col:first-child{position:sticky;top:9.2rem}
@media (max-width:52rem){.cols{grid-template-columns:1fr}.col:first-child{position:static}.pair>header{position:static}}
.col{background:var(--card);border:1px solid var(--haze-line);border-radius:4px;padding:1rem 1.2rem;font-size:1rem}
.lbl{margin-bottom:.6rem;color:var(--muted)}
.col p{margin:0 0 .8rem}.note{color:var(--muted);font-size:.9rem}.quote{font-style:italic;font-size:.95rem;margin:0 0 .35rem;padding-left:.85rem;border-left:2px solid var(--haze-line)}
.evidence{padding:.7rem 0;border-top:1px dashed var(--haze-line)}
.evidence:first-child{border-top:none;padding-top:0}
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
.evidence[data-judged]:not([data-expanded])>:not(.ev-head){display:none}
.evidence[data-judged]:not([data-expanded]){cursor:pointer;padding:.45rem 0}
.evidence[data-judged]:not([data-expanded]) .ev-head{margin:0;opacity:.85}
.evidence[data-judged] .ev-head:after{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:.72rem;margin-left:.5em}
.evidence[data-judged=fair] .ev-head:after{content:"\u2713 fair";color:var(--mark-ok)}
.evidence[data-judged=flag] .ev-head:after{content:"\u2691 flagged";color:var(--mark-bad)}
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
        el.querySelector('.rv-state').textContent = v ? (v.verdict === 'fair' ? '\\u2713 judged fair ' : '\\u2691 flagged ') + v.at.slice(0, 10) : 'unjudged';
        if (v) { judged++; if (v.verdict === 'flag') flagged++; }
        const ev = el.closest('.evidence');
        if (ev) { if (v) ev.dataset.judged = v.verdict; else { delete ev.dataset.judged; ev.removeAttribute('data-expanded'); } }
    }
    for (const card of document.querySelectorAll('.pair')) {
        const rs = [...card.querySelectorAll('.reading[data-review]')];
        card.toggleAttribute('data-all-judged', rs.length > 0 && rs.every(r => saved[r.dataset.review]));
        card.toggleAttribute('data-flagged', rs.some(r => (saved[r.dataset.review] || {}).verdict === 'flag'));
    }
    document.getElementById('rv-progress').textContent =
        judged + '/' + readings.length + ' judged' + (flagged ? ', ' + flagged + ' flagged' : '');
    document.querySelector('.rv-fill').style.width = (readings.length ? Math.round(judged / readings.length * 100) : 0) + '%';
    document.getElementById('rv-next').style.display = judged === readings.length ? 'none' : '';
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
    btn.id = 'rv-sign'; btn.className = 'rv-link'; btn.textContent = 'sign review';
    document.querySelector('.rv-actions').prepend(btn);
    btn.addEventListener('click', () => {
        fetch(window.PROVEML_REVIEW_SUBMIT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exported: new Date().toISOString(), judgements: merged() }) })
            .then((r) => { if (r.ok) { btn.textContent = 'signed'; btn.disabled = true; } });
    });
}
// Instant tooltips with the proof path, off the title attribute so the
// browser's slow native tooltip never competes.
document.querySelectorAll('[title]').forEach(el => { el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); });
const tip = document.createElement('div'); tip.id = 'tip'; tip.hidden = true; document.body.appendChild(tip);
document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('.proveml-entity, .proveml-fact');
    if (!el) return;
    tip.innerHTML = (el.dataset.tip || '').replace(/^([^ =]+)/, '<b>$1</b>');
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
    if (e.target.closest?.('.proveml-entity, .proveml-fact')) tip.hidden = true;
});
`;
