#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { stdin, stdout, stderr, exit } from 'process';
import { renderProveml, PROVEML_CSS } from './render-html.js';
import { educationFactStore, paperExampleSources } from './paper-examples.js';
import { stripProveml, verifyProveml } from './verify.js';
import { annotate } from './annotate.js';
import { promptFor } from './prompt.js';
import { thresholds as builtinThresholds } from './thresholds.js';

const [, , command = 'help', ...argv] = process.argv;

try {
    switch (command) {
        case 'strip':
            await runStrip(argv);
            break;
        case 'doctor':
            runDoctor(argv);
            break;
        case 'verify':
            await runVerify(argv);
            break;
        case 'render':
            await runRender(argv);
            break;
        case 'demo':
            runDemo(argv);
            break;
        case 'prompt':
            runPrompt(argv);
            break;
        case 'example':
        case 'examples':
            runExample(argv);
            break;
        case 'help':
        case '--help':
        case '-h':
        default:
            printHelp();
            break;
    }
} catch (error) {
    stderr.write(`${String(error.message || error)}\n`);
    exit(2);
}

async function runVerify(argv) {
    const args = parseArgs(argv);
    const markup = await resolveInput(args);
    const factStore = resolveFactStore(args);
    const result = verifyProveml(markup, factStore, {
        ...(args.snapshot ? { snapshot: args.snapshot } : {}),
        ...(args.strict ? { strict: true } : {}),
    });

    if (args.json) {
        stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
        // Show the text as a reader sees it, with what was checked underneath.
        stdout.write(`${annotate(markup, result, { color: stdout.isTTY })}\n`);
        if (result.snapshot) stdout.write(`\n  snapshot ${result.snapshot}\n`);
        if (args.paths && result.errors.length > 0) {
            stdout.write('\n  paths:\n');
            for (const err of result.errors) stdout.write(`  - ${err}\n`);
        }
    }

    exit(result.errors.length === 0 ? 0 : 1);
}

async function runRender(argv) {
    const args = parseArgs(argv);
    const markup = await resolveInput(args);
    const factStore = resolveFactStore(args);
    const { html, verification } = renderProveml(markup, factStore, {
        snapshot: args.snapshot,
        showProofPaths: Boolean(args['proof-paths'])
    });

    if (args.json) {
        const payload = {
            html,
            verification,
            css: args.css ? PROVEML_CSS : undefined,
        };
        stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
        const output = args.css ? `<style>${PROVEML_CSS}</style>\n${html}\n` : `${html}\n`;
        if (args.output) writeFileSync(args.output, output, 'utf8');
        else stdout.write(output);
    }

    exit(verification.errors.length === 0 ? 0 : 1);
}

async function runStrip(argv) {
    const args = parseArgs(argv);
    const markup = await resolveInput(args);
    const output = stripProveml(markup);

    if (args.output) writeFileSync(args.output, output, 'utf8');
    else stdout.write(`${output}\n`);

    exit(0);
}

function runDoctor(argv) {
    const args = parseArgs(argv);
    const factStore = resolveFactStore(args);
    const report = inspectFactStore(factStore);

    if (args.json) {
        stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
        stdout.write(`fact store ${report.ok ? 'ok' : 'needs attention'}\n`);
        stdout.write(`${report.summary}\n`);
        stdout.write(`keys ${report.keyCount} across ${report.entityCount} entities\n`);

        if (report.errors.length > 0) {
            stdout.write('\nerrors:\n');
            for (const error of report.errors) stdout.write(`- ${error}\n`);
        }

        if (report.warnings.length > 0) {
            stdout.write('\nwarnings:\n');
            for (const warning of report.warnings) stdout.write(`- ${warning}\n`);
        }
    }

    exit(report.errors.length === 0 ? 0 : 1);
}

/**
 * Zero-setup demo: the fastest path from "what is this" to "I get it".
 * Shows a report an AI could have written, the store it is checked against,
 * and what survives verification.
 */
function runDemo() {
    const store = {
        'company:aapl.name': 'Apple Inc.',
        'company:aapl.revenue': 416161000000,
        'company:aapl.revenue._unit': 'USD',
        'company:aapl.netIncome': 112010000000,
        'company:aapl.netIncome._unit': 'USD',
        'company:msft.name': 'Microsoft Corporation',
        'company:msft.revenue': 281724000000,
        'company:msft.revenue._unit': 'USD',
    };
    const markup = [
        '@[company:aapl]{Apple Inc.} reported revenue of %[revenue]{416161000000 USD}',
        'and net income of %[netIncome]{112010000000 USD}.',
        '',
        '@[company:msft]{Microsoft Corporation} reported revenue of %[revenue]{281724000000 USD}.',
        '',
        '@[company:goog]{Alphabet} reported revenue of %[revenue]{350018000000 USD}.',
    ].join('\n');

    const color = stdout.isTTY;
    const dim = (t) => (color ? `\u001b[2m${t}\u001b[0m` : t);
    const bold = (t) => (color ? `\u001b[1m${t}\u001b[0m` : t);

    stdout.write(`\n${bold('ProveML')} — claims an AI writes, checked against your data.\n`);
    stdout.write(dim('  No model in the verification loop: every check below is a lookup or a comparison.\n'));

    stdout.write(`\n${bold('1. What the model wrote')} ${dim('(Markdown with three extra constructs)')}\n\n`);
    for (const line of markup.split('\n')) stdout.write(`  ${dim(line || ' ')}\n`);

    stdout.write(`\n${bold('2. What it is checked against')} ${dim('(a flat key-value store)')}\n\n`);
    for (const [k, v] of Object.entries(store).slice(0, 4)) {
        stdout.write(`  ${dim(`${k} → ${JSON.stringify(v)}`)}\n`);
    }
    stdout.write(`  ${dim(`… ${Object.keys(store).length - 4} more`)}\n`);

    stdout.write(`\n${bold('3. What the reader gets')}\n\n`);
    const result = verifyProveml(markup, store);
    stdout.write(`${annotate(markup, result, { color })}\n`);

    stdout.write(`\n${dim('Two claims about Alphabet could not be checked: that company is not in the store.')}\n`);
    stdout.write(`${dim('A sentence the data cannot support is visible as such, instead of reading like the rest.')}\n`);

    stdout.write(`\n${bold('Next')}\n`);
    stdout.write(`  npx proveml verify --input report.md --facts facts.json   ${dim('check your own')}\n`);
    stdout.write(`  npx proveml doctor --facts facts.json                     ${dim('check your store shape')}\n`);
    stdout.write(`  npx proveml render --input report.md --facts facts.json   ${dim('HTML with status colors')}\n\n`);
}

/**
 * The system prompt for a store: what a model has to be told to write ProveML
 * that verifies. Rules are fixed; records, fields, units and the registry come
 * from the files given.
 */
function runPrompt(argv) {
    const args = parseArgs(argv);
    const store = args.facts ? JSON.parse(readFileSync(args.facts, 'utf8')) : {};
    const thresholds = args.thresholds ? JSON.parse(readFileSync(args.thresholds, 'utf8')) : (args['builtin-thresholds'] ? builtinThresholds : {});
    stdout.write(`${promptFor({ store, thresholds, role: typeof args.role === 'string' ? args.role : undefined, data: Boolean(args.data) })}\n`);
}

function runExample(argv) {
    const args = parseArgs(argv);
    const exampleName = args.name || args._[0] || 'verifyCorrect';
    const markup = paperExampleSources[exampleName];
    if (!markup) {
        throw new Error(`Unknown example "${exampleName}". Try: ${Object.keys(paperExampleSources).join(', ')}`);
    }

    const payload = {
        name: exampleName,
        markup,
        factStore: educationFactStore,
        usage: [
            'npx proveml example --json',
            'npx proveml verify --input report.md --facts facts.json',
            'npx proveml render --input report.md --facts facts.json --css'
        ]
    };

    if (args.json) {
        stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
    }

    stdout.write(`example: ${exampleName}\n\n`);
    stdout.write('markup:\n');
    stdout.write(`${markup}\n\n`);
    stdout.write('fact store:\n');
    stdout.write(`${JSON.stringify(educationFactStore, null, 2)}\n`);
}

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const part = argv[i];
        if (!part.startsWith('--')) {
            args._.push(part);
            continue;
        }
        const key = part.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            args[key] = true;
            continue;
        }
        args[key] = next;
        i++;
    }
    return args;
}

async function resolveInput(args) {
    if (args.text) return args.text;
    if (args.input) return readFileSync(args.input, 'utf8');
    if (stdin.isTTY) {
        throw new Error('Expected --text, --input, or piped stdin.');
    }
    return await readStdin();
}

function resolveFactStore(args) {
    if (!args.facts) {
        throw new Error('Expected --facts <path-to-json>.');
    }
    return JSON.parse(readFileSync(args.facts, 'utf8'));
}

function inspectFactStore(factStore) {
    if (!factStore || typeof factStore !== 'object' || Array.isArray(factStore)) {
        return {
            ok: false,
            summary: 'expected a JSON object whose keys are flat ProveML fact paths',
            keyCount: 0,
            entityCount: 0,
            errors: ['Fact store must be a plain JSON object, not an array or primitive.'],
            warnings: []
        };
    }

    const errors = [];
    const warnings = [];
    const keys = Object.keys(factStore);
    const entityPrefixes = new Set();
    const entityNames = new Set();
    const unitKeys = [];

    if (keys.length === 0) {
        warnings.push('Fact store is empty.');
    }

    for (const key of keys) {
        const parsed = parseFactKey(key);
        if (!parsed.ok) {
            errors.push(`${key}: ${parsed.error}`);
            continue;
        }

        const { entityPrefix, field, isUnit, baseKey } = parsed;
        const value = factStore[key];

        if (hasKeyWhitespace(key)) {
            errors.push(`${key}: keys should not contain whitespace.`);
        }

        if (isUnsupportedFactValue(value)) {
            errors.push(`${key}: values must be scalars (string, number, boolean, or null), not arrays or objects.`);
        }

        if (field === 'name') {
            entityNames.add(entityPrefix);
        } else if (!isUnit) {
            entityPrefixes.add(entityPrefix);
        }

        if (isUnit) {
            unitKeys.push({ key, baseKey });
        }
    }

    for (const { key, baseKey } of unitKeys) {
        if (!(baseKey in factStore)) {
            errors.push(`${key}: companion metadata exists but the base field ${baseKey} is missing.`);
        }
    }

    for (const entityPrefix of entityPrefixes) {
        if (!entityNames.has(entityPrefix)) {
            warnings.push(`${entityPrefix}: missing .name field; entity references will not be name-checkable.`);
        }
    }

    // Two records of one type with the same name render identically as a
    // subject; a reader could not tell a wrong id from the right one.
    const byName = new Map();
    for (const key of keys) {
        const parsed = parseFactKey(key);
        if (!parsed.ok || parsed.field !== 'name') continue;
        const type = parsed.entityPrefix.slice(0, parsed.entityPrefix.indexOf(':'));
        const k = `${type}\u0000${String(factStore[key])}`;
        byName.set(k, [...(byName.get(k) || []), parsed.entityPrefix]);
    }
    for (const [k, paths] of byName) {
        if (paths.length > 1) warnings.push(`${paths.join(', ')}: share the name "${k.split('\u0000')[1]}"; a rendered subject with this name is ambiguous.`);
    }

    return {
        ok: errors.length === 0,
        summary: `${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`,
        keyCount: keys.length,
        entityCount: new Set([...entityPrefixes, ...entityNames]).size,
        errors,
        warnings
    };
}

function parseFactKey(key) {
    if (typeof key !== 'string' || key.length === 0) {
        return { ok: false, error: 'empty key.' };
    }

    const colonIndex = key.indexOf(':');
    const dotIndex = key.indexOf('.', colonIndex + 1);

    if (colonIndex <= 0 || dotIndex <= colonIndex + 1 || dotIndex === key.length - 1) {
        return {
            ok: false,
            error: 'expected keys shaped like entityType:entityId.field or entityType:entityId.field._unit.'
        };
    }

    const entityType = key.slice(0, colonIndex);
    const entityId = key.slice(colonIndex + 1, dotIndex);
    const field = key.slice(dotIndex + 1);

    if (!entityType || !entityId || !field) {
        return {
            ok: false,
            error: 'expected non-empty entity type, entity id, and field segments.'
        };
    }

    if (field === '_unit' || field === '_display') {
        return { ok: false, error: `${field} keys must point to a real base field, not just .${field}.` };
    }

    const isUnit = field.endsWith('._unit') || field.endsWith('._display');
    const baseField = field.endsWith('._unit') ? field.slice(0, -'._unit'.length) : field.endsWith('._display') ? field.slice(0, -'._display'.length) : field;

    if (!baseField) {
        return { ok: false, error: 'unit keys must point to a real base field.' };
    }

    if (baseField.includes('..')) {
        return { ok: false, error: 'field segment contains an empty subpath.' };
    }

    return {
        ok: true,
        entityPrefix: `${entityType}:${entityId}`,
        field,
        isUnit,
        baseKey: isUnit ? `${entityType}:${entityId}.${baseField}` : key
    };
}

function hasKeyWhitespace(key) {
    return /\s/.test(key);
}

function isUnsupportedFactValue(value) {
    return typeof value === 'object' && value !== null;
}

function readStdin() {
    return new Promise((resolve, reject) => {
        let data = '';
        stdin.setEncoding('utf8');
        stdin.on('data', chunk => { data += chunk; });
        stdin.on('end', () => resolve(data));
        stdin.on('error', reject);
    });
}

function printHelp() {
    stdout.write(`ProveML CLI

Usage:
  npx proveml demo
  npx proveml strip --input report.md [--output plain.md]
  npx proveml doctor --facts facts.json [--json]
  npx proveml verify --input report.md --facts facts.json [--json] [--snapshot id] [--strict]
  npx proveml render --input report.md --facts facts.json [--proof-paths] [--css] [--output out.html]
  npx proveml example [verifyCorrect|verifySuggestions|verifyErrors] [--json]
  npx proveml prompt --facts facts.json [--thresholds registry.json] [--role "..."] [--data]

Notes:
  - demo needs no setup: it shows a checked report end to end.
  - verify prints the text with markers underneath; add --paths for store paths.
  - verify always reports coverage (numbers outside any claim); --strict makes each one a finding.
  - strip removes ProveML syntax and keeps the visible text content.
  - doctor checks fact-store shape, key hygiene, unit companions, missing .name fields, and duplicate names per type.
  - Use --text "..." instead of --input for small snippets.
  - If no --input or --text is given, strip/verify/render read markup from stdin.
  - render prints HTML to stdout unless --output is provided.
  - prompt prints the system prompt a model needs for this store: the rules, the records and fields, the registry.
`);
}
