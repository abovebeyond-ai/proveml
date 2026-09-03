#!/usr/bin/env node
/**
 * artifact-gate — arm a built review page for the Artifact runtime.
 *
 * The localhost gate blocks a terminal; an artifact cannot. What it CAN do
 * is be the record: the page carries its own judgements home. This script
 * takes the file `proveml review --output` wrote and appends a bridge that,
 * inside an artifact viewer, adds one button: "hand back to Vera". The
 * button lights up only when every reading is judged; pressing it bakes
 * the merged review into the page's committed tag and republishes the page
 * as its own new version. The agent's watch fires, the agent reads the
 * page back, and the loop closes with no clipboard and no paste.
 *
 * Outside an artifact viewer (opened as a file, served locally) the bridge
 * resolves null and does nothing: the page stays the checklist it was.
 *
 * Usage: node artifact-gate.mjs report/review-page.html [out.html]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output = input.replace(/\.html$/, '-artifact.html')] = process.argv.slice(2);
if (!input) { console.error('usage: artifact-gate.mjs <review-page.html> [out.html]'); process.exit(2); }

let html = readFileSync(input, 'utf8');

// The committed tag must exist and be addressable, so the bridge can swap
// its content and a republished page reloads with the review already in it.
if (html.includes('window.PROVEML_REVIEW_COMMITTED=')) {
    html = html.replace('<script>window.PROVEML_REVIEW_COMMITTED=', '<script id="proveml-committed">window.PROVEML_REVIEW_COMMITTED=');
} else {
    const i = html.lastIndexOf('<script>');
    if (i < 0) { console.error('artifact-gate: no script tag found; is this a review page?'); process.exit(1); }
    html = html.slice(0, i) + '<script id="proveml-committed">window.PROVEML_REVIEW_COMMITTED={"judgements":{}}</script>' + html.slice(i);
}

const BRIDGE = `
<style>.rv-note{font-family:inherit;font-size:.8rem;background:none;border:none;padding:0;color:var(--muted);cursor:default}</style>
<script>
(async () => {
    // Resolves only inside an artifact viewer; anywhere else the page is
    // untouched. Never read window.claude members directly: use() is the check.
    const a = await (window.claude && window.claude.use ? window.claude.use('artifact') : null);
    if (!a) return;
    const KEY = 'proveml-review:' + (document.body.dataset.reviewKey || location.pathname);
    const committedJudgements = () => (window.PROVEML_REVIEW_COMMITTED && window.PROVEML_REVIEW_COMMITTED.judgements) || {};
    const merged = () => {
        let local = {}; try { local = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
        const m = Object.assign({}, committedJudgements());
        for (const k of Object.keys(local)) { if (local[k] === null) delete m[k]; else m[k] = local[k]; }
        return m;
    };
    // Read the readings each time: the page adds more as the model pass runs.
    const readingsNow = () => Array.from(document.querySelectorAll('.reading[data-review]'));
    const btn = document.createElement('button');
    btn.id = 'rv-handback'; btn.className = 'rv-note';
    document.querySelector('.rv-actions').prepend(btn);
    document.body.dataset.handback = '1';   // hand-back carries the judgements: the clipboard copy is only for pages without it
    let busy = false;
    const handedBack = () => {
        let overlay = null; try { overlay = localStorage.getItem(KEY); } catch (e) {}
        const c = committedJudgements();
        return !!(window.PROVEML_REVIEW_COMMITTED && window.PROVEML_REVIEW_COMMITTED.exported)
            && readingsNow().every((r) => c[r.dataset.review]) && (!overlay || overlay === '{}');
    };
    document.addEventListener('proveml:paint', () => state());
    const state = () => {
        if (busy) return;
        const m = merged();
        const open = readingsNow().filter((r) => !m[r.dataset.review]).length;
        if (handedBack()) { btn.hidden = false; btn.disabled = true; btn.className = 'rv-note'; btn.textContent = 'handed back \\u2713'; }
        else if (open) { btn.hidden = true; btn.disabled = true; btn.className = 'rv-note'; btn.textContent = ''; }
        else { btn.hidden = false; btn.disabled = false; btn.className = 'rv-btn rv-primary'; btn.textContent = 'hand back to Vera'; }
    };
    btn.addEventListener('click', async () => {
        if (btn.disabled || busy) return;
        busy = true; btn.disabled = true; btn.textContent = 'handing back\\u2026';
        // The page is the record: bake the merged review into the committed
        // tag of a clone and publish the clone as the page's next version.
        // Never the live DOM itself, and never on load, only on this press.
        const review = { exported: new Date().toISOString(), judgements: merged() };
        const root = document.documentElement.cloneNode(true);
        const hb = root.querySelector('#rv-handback'); if (hb) hb.remove();
        const tag = root.querySelector('#proveml-committed');
        tag.textContent = 'window.PROVEML_REVIEW_COMMITTED=' + JSON.stringify(review).replace(/</g, '\\\\u003c');
        try {
            await a.publish('<!doctype html>' + root.outerHTML);
            try { localStorage.removeItem(KEY); } catch (e) {}
            btn.textContent = 'with Vera \\u2713';
        } catch (err) {
            busy = false; btn.textContent = 'could not hand back, try again'; btn.disabled = false; state();
        }
    });
    // The main script owns the widgets; this only re-reads the ledger after
    // every click has settled.
    document.addEventListener('click', () => setTimeout(state, 0));
    state();
})();
</script>`;

html = html.replace('</body></html>', BRIDGE + '\n</body></html>');
writeFileSync(output, html);
console.log(`artifact page written to ${output}`);
