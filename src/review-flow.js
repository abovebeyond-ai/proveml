/**
 * proveml/review-flow — the human gate as one awaitable step.
 *
 * Agent-first: a pipeline builds the store, writes, verifies, and then calls
 * awaitReview(). That spawns the review page in a browser, the human judges
 * the readings and presses "sign review", the page posts the merged review
 * back, and the promise resolves with it. The gate is a line in the flow,
 * not a detour out of it.
 *
 * How a sign-off is attested is an adapter, like evidence sources are: a
 * signer is `async (review) => review`, free to add whatever its deployment
 * calls a signature — a name, a key signature, a credential, a ledger anchor.
 * The core ships none and requires none; an unsigned review is still a
 * review, it just attests nothing.
 */

import { createServer } from 'http';
import { readFileSync } from 'fs';
import { resolve, sep } from 'path';
import { exec } from 'child_process';
import { reviewPage } from './review-page.js';
import { summarize } from './review.js';

/**
 * Build the page, serve it once, wait for the signed review.
 *
 * Takes every reviewPage option, plus:
 * @param {(review: object) => object | Promise<object>} [opts.signer]
 *   attestation adapter; receives the posted review, returns what to keep
 * @param {string} [opts.signedBy]  recorded on the review before the signer runs
 * @param {boolean} [opts.open=true]  open the page in the default browser
 * @param {number} [opts.port=0]  0 picks a free port
 * @param {Record<string, string>} [opts.assets]  url prefix to directory map;
 *   GETs under a prefix serve files from its directory (the archived
 *   snapshots the page's evidence links point at), path traversal refused
 * @param {(url: string) => void} [opts.onServe]  called with the page url
 * @returns {Promise<{ review: object, summary: import('./review.js').ReviewSummary, url: string }>}
 *   resolves when the human signs; summary counts the page's readings against
 *   the signed review, so unjudged and orphaned are visible to the caller
 */
export function awaitReview(opts) {
    const { signer, signedBy, open = true, port = 0, onServe, assets = {}, ...pageOpts } = opts;
    const { html, ids } = reviewPage(pageOpts);
    // The page shows its "sign review" button only when this flag exists:
    // served by this flow, the gate is submittable; opened as a file, it is
    // a checklist with a clipboard.
    const page = html.replace('</head>', '<script>window.PROVEML_REVIEW_SUBMIT="/review"</script></head>');

    return new Promise((resolvePromise, reject) => {
        let served = '';
        const server = createServer((req, res) => {
            if (req.method === 'GET') {
                const path = decodeURIComponent((req.url || '/').split('?')[0]);
                if (path === '/' || path === '/index.html') {
                    res.setHeader('content-type', 'text/html; charset=utf-8');
                    res.end(page);
                    return;
                }
                for (const [prefix, dir] of Object.entries(assets)) {
                    if (!path.startsWith(prefix)) continue;
                    const rootDir = resolve(dir);
                    const file = resolve(rootDir, path.slice(prefix.length));
                    if (file !== rootDir && !file.startsWith(rootDir + sep)) { res.statusCode = 403; res.end(); return; }
                    try {
                        const body = readFileSync(file);
                        res.setHeader('content-type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');
                        res.end(body);
                    } catch {
                        res.statusCode = 404; res.end();
                    }
                    return;
                }
                res.statusCode = 404;
                res.end();
                return;
            }
            if (req.method === 'POST' && req.url === '/review') {
                let body = '';
                req.on('data', (c) => { body += c; });
                req.on('end', async () => {
                    try {
                        let review = JSON.parse(body);
                        if (signedBy) review.signedBy = signedBy;
                        review.signedAt = new Date().toISOString();
                        if (signer) review = await signer(review);
                        res.end('ok');
                        server.close();
                        resolvePromise({ review, summary: summarize(review, ids), url: served });
                    } catch (error) {
                        res.statusCode = 500;
                        res.end(String(error && error.message || error));
                        server.close();
                        reject(error);
                    }
                });
                return;
            }
            res.statusCode = 404;
            res.end();
        });
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
            served = `http://127.0.0.1:${server.address().port}/`;
            if (onServe) onServe(served);
            if (open) {
                const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
                exec(`${cmd} ${JSON.stringify(served)}`, () => {});
            }
        });
    });
}
