#!/usr/bin/env node
/**
 * One turn of the co-writing loop: verify strictly, diff against the
 * previous turn, snapshot this one, print the heartbeat line.
 *
 * Usage: node <skill-dir>/scripts/turn.mjs <reportDir>
 * Exit 0 on a clean verified turn; 1 when verification fails or the diff
 * says CHECK EDIT. The skill treats nonzero as "repair before showing the
 * user anything".
 *
 * Resolves proveml from the report directory's project (nearest
 * node_modules), so the skill works wherever proveml is installed.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const dir = resolve(process.argv[2] || 'report');
// proveml ships inside the skill, so nothing needs installing in the user's
// project; a project's own copy wins when it has one.
let verifyPath;
try { verifyPath = createRequire(join(dir, 'noop.js')).resolve('proveml/verify'); }
catch { verifyPath = createRequire(import.meta.url).resolve('proveml/verify'); }
const mod = async (m) => import(pathToFileURL(join(verifyPath, '..', m)).href);

const { verifyProveml } = await mod('verify.js');
const { diffTurns, formatTurnDiff } = await mod('diff.js');

const markup = readFileSync(join(dir, 'report.md'), 'utf8');
const store = JSON.parse(readFileSync(join(dir, 'store.json'), 'utf8'));
const thresholds = existsSync(join(dir, 'thresholds.json')) ? JSON.parse(readFileSync(join(dir, 'thresholds.json'), 'utf8')) : undefined;
const opts = thresholds ? { thresholds } : {};

const v = verifyProveml(markup, store, { ...opts, strict: true });

const turnsDir = join(dir, 'turns');
mkdirSync(turnsDir, { recursive: true });
const turns = readdirSync(turnsDir).filter((f) => /^\d+\.md$/.test(f)).sort();
const prev = turns.length ? readFileSync(join(turnsDir, turns.at(-1)), 'utf8') : null;

let line, ok = v.errors.length === 0;
if (prev === markup) {
    line = `(ˆ_ˆ) turn unchanged: ${v.verified}/${v.total} verified`;
} else if (prev) {
    const d = diffTurns(prev, markup, store, opts);
    line = (d.clean ? '(ˆ◡ˆ) ' : '(ˆoˆ)? ') + formatTurnDiff(d);
    ok = ok && d.clean;
} else {
    line = `${v.errors.length ? '(ˆoˆ)?' : '(ˆ◡ˆ)'} first turn: ${v.verified}/${v.total} verified, coverage ${v.coverage.rate === null ? 'n/a' : Math.round(v.coverage.rate * 100) + '%'}`;
}

if (prev !== markup) {
    writeFileSync(join(turnsDir, String(turns.length + 1).padStart(3, '0') + '.md'), markup);
}

// The archive ledger: which sources evidence still cites, which fell out.
const evPath = join(dir, 'evidence.json');
const ledgerPath = join(dir, 'sources', 'index.json');
if (existsSync(evPath) && existsSync(ledgerPath)) {
    const subjects = JSON.parse(readFileSync(evPath, 'utf8'));
    const cited = new Set((Array.isArray(subjects) ? subjects : subjects.subjects || []).map((s) => s.id));
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    let changed = false, used = 0, unused = 0;
    for (const row of ledger) {
        if (row.status === 'discarded' || row.status === 'failed') continue;
        const next = cited.has(row.id) ? 'used' : 'unused';
        if (row.status !== next) { row.status = next; changed = true; }
        if (next === 'used') used++; else unused++;
    }
    if (changed) writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1) + '\n');
    line += `, ${used} source${used === 1 ? '' : 's'} used` + (unused ? `, ${unused} unused` : '');
}

console.log(line);
if (v.errors.length) for (const e of v.errors) console.log('  ✗ ' + e);
process.exit(ok ? 0 : 1);
