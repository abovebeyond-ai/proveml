#!/usr/bin/env node
/**
 * the assessment platform Skills MCP Server
 *
 * Deterministic data query tools for mastery analysis.
 * Each tool has defined inputs, outputs, and is independently testable.
 * The AI calls these tools — it cannot invent data.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ml = JSON.parse(readFileSync(join(__dirname, 'public/data/mastery-layers.json')));

// === SKILL IMPLEMENTATIONS ===

// Helper: wrap values with citation syntax
function cite(entityType, id, field, value) {
    return `⟦${value}⟧⟨${entityType}:${id}.${field}=${value}⟩`;
}

function atRiskStudents({ offering_name, min_evaluated = 5, max_pass_rate = 30 }) {
    const results = [];
    for (const o of ml.offerings) {
        if (offering_name && !o.name.toLowerCase().includes(offering_name.toLowerCase())) continue;
        for (const st of o.students) {
            if (st.ev < min_evaluated) continue;
            if (st.rate <= max_pass_rate) {
                results.push({
                    id: st.id,
                    name: st.name,
                    name_cited: cite('student', st.id, 'name', st.name),
                    offering: o.name,
                    offeringId: o.id,
                    passRate: st.rate,
                    passRate_cited: cite('student', st.id, 'passRate', st.rate),
                    passed: st.pass,
                    passed_cited: cite('student', st.id, 'passed', st.pass),
                    evaluated: st.ev,
                    evaluated_cited: cite('student', st.id, 'evaluated', st.ev),
                    total: st.total,
                    total_cited: cite('student', st.id, 'total', st.total),
                    absent: st.grijs || 0,
                    absent_cited: cite('student', st.id, 'absent', st.grijs || 0),
                    platformUrl: `https://assessment.example/students/${st.id}/progress`
                });
            }
        }
    }
    return results.sort((a, b) => a.passRate - b.passRate);
}

function offeringComparison({ al_prefix, al_id, min_students = 3 }) {
    let targetId = al_id;
    if (!targetId && al_prefix) {
        const al = ml.als.find(a => a.p?.toLowerCase() === al_prefix.toLowerCase());
        if (al) targetId = al.id;
    }
    if (!targetId) return { error: 'Attainment level not found' };

    const al = ml.als.find(a => a.id === targetId);
    const results = [];
    for (const o of ml.offerings) {
        let pass = 0, scored = 0;
        for (const s of o.students) {
            if (s.m[targetId] !== undefined) {
                scored++;
                const m = s.m[targetId];
                if (m === 'blauw' || m === 'groen') pass++;
            }
        }
        if (scored >= min_students) {
            results.push({
                offeringId: o.id, name: o.name, stream: o.stream, grade: o.grade,
                totalStudents: o.students.length, scored, passed: pass,
                passRate: Math.round(pass / o.students.length * 100),
                scoredRate: Math.round(scored / o.students.length * 100),
                platformUrl: `https://assessment-platform.be/stats/klas/${o.id}`
            });
        }
    }
    return {
        attainmentLevel: { id: al?.id, prefix: al?.p, name: al?.n, cluster: al?.cl, category: al?.cat },
        offerings: results.sort((a, b) => a.passRate - b.passRate),
        range: results.length ? Math.max(...results.map(r => r.passRate)) - Math.min(...results.map(r => r.passRate)) : 0
    };
}

function coFailure({ al_prefix, al_id, cross_cluster_only = false, limit = 20 }) {
    let targetId = al_id;
    if (!targetId && al_prefix) {
        const al = ml.als.find(a => a.p?.toLowerCase() === al_prefix.toLowerCase());
        if (al) targetId = al.id;
    }
    if (!targetId) return { error: 'Attainment level not found' };

    const al = ml.als.find(a => a.id === targetId);
    const src = cross_cluster_only ? ml.analysis?.crossClusterCoFail : ml.analysis?.coFail;
    const cfs = (src || {})[targetId] || [];

    return {
        attainmentLevel: { id: al?.id, prefix: al?.p, name: al?.n, cluster: al?.cl },
        correlations: cfs.slice(0, limit).map(cf => {
            const ta = ml.als.find(a => a.id === cf.t);
            return {
                id: cf.t, prefix: ta?.p, name: ta?.n, cluster: ta?.cl,
                overlap: Math.round(cf.s * 100),
                sameCluster: ta?.cl === al?.cl
            };
        }),
        totalCorrelations: cfs.length,
        failCount: ml.analysis?.failCounts?.[targetId] || 0
    };
}

function offeringOverview({ offering_name, offering_id }) {
    let o;
    if (offering_id) o = ml.offerings.find(x => x.id === offering_id);
    else if (offering_name) o = ml.offerings.find(x => x.name.toLowerCase().includes(offering_name.toLowerCase()));
    if (!o) return { error: 'Offering not found' };

    const avg = o.students.length ? Math.round(o.students.reduce((s, st) => s + st.rate, 0) / o.students.length) : 0;
    const evAvg = o.students.length ? Math.round(o.students.reduce((s, st) => s + (st.total ? st.ev / st.total * 100 : 0), 0) / o.students.length) : 0;

    return {
        id: o.id, name: o.name, stream: o.stream, grade: o.grade,
        studentCount: o.students.length, avgPassRate: avg, avgEvalRate: evAvg,
        platformUrl: `https://assessment-platform.be/stats/klas/${o.id}`,
        students: o.students.map(s => ({
            id: s.id, name: s.name, passRate: s.rate, evaluated: s.ev, total: s.total, absent: s.grijs || 0,
            platformUrl: `https://assessment.example/students/${s.id}/progress`
        })).sort((a, b) => a.passRate - b.passRate)
    };
}

function weakestAttainmentLevels({ category, cluster, min_students = 10, limit = 20 }) {
    const alStats = {};
    for (const o of ml.offerings) for (const s of o.students) for (const [alId, m] of Object.entries(s.m)) {
        if (!alStats[alId]) alStats[alId] = { id: +alId, pass: 0, total: 0 };
        alStats[alId].total++;
        if (m === 'blauw' || m === 'groen') alStats[alId].pass++;
    }
    return Object.values(alStats)
        .filter(a => a.total >= min_students)
        .map(a => {
            const al = ml.als.find(x => x.id === a.id);
            if (!al) return null;
            if (category && al.cat !== category) return null;
            if (cluster && al.cl !== cluster) return null;
            return { id: a.id, prefix: al.p, name: al.n, cluster: al.cl, category: al.cat, passRate: Math.round(a.pass / a.total * 100), students: a.total };
        })
        .filter(Boolean)
        .sort((a, b) => a.passRate - b.passRate)
        .slice(0, limit);
}

function studentDetail({ student_id, student_name }) {
    for (const o of ml.offerings) {
        const st = o.students.find(s => s.id === student_id || (student_name && s.name.toLowerCase().includes(student_name.toLowerCase())));
        if (!st) continue;
        const id = st.id;
        return {
            id, name: st.name,
            name_cited: cite('student', id, 'name', st.name),
            offering: o.name, offeringId: o.id, stream: o.stream, grade: o.grade,
            passRate: st.rate,
            passRate_cited: cite('student', id, 'passRate', st.rate),
            passed: st.pass,
            passed_cited: cite('student', id, 'passed', st.pass),
            evaluated: st.ev,
            evaluated_cited: cite('student', id, 'evaluated', st.ev),
            total: st.total,
            total_cited: cite('student', id, 'total', st.total),
            absent: st.grijs || 0,
            absent_cited: cite('student', id, 'absent', st.grijs || 0),
            evalRate: st.total ? Math.round(st.ev / st.total * 100) : 0,
            categories: st.cats || {},
            platformUrl: `https://assessment.example/students/${id}/progress`
        };
    }
    return { error: 'Student not found' };
}

function summaryStats() {
    const totalStudents = ml.offerings.reduce((s, o) => s + o.students.length, 0);
    const offerings = ml.offerings.map(o => {
        const avg = o.students.length ? Math.round(o.students.reduce((s, st) => s + st.rate, 0) / o.students.length) : 0;
        return { id: o.id, name: o.name, stream: o.stream, grade: o.grade, students: o.students.length, passRate: avg };
    }).sort((a, b) => a.passRate - b.passRate);
    return { totalStudents, totalALs: ml.als.length, totalOfferings: ml.offerings.length, offerings };
}

// === VERIFICATION SKILL ===
function verifyProvemlOutput({ markdown }) {
    // Parse the ProveML markdown and verify all citations
    const entityRe = /@\[(\w+):(\w+)\]\{([^}]+)\}/g;
    const factRe = /%\[([^\]]+)\]\{([^}]+)\}/g;

    const results = { entities: [], facts: [], errors: [], total: 0, verified: 0 };
    let currentEntity = null;

    // Process line by line (paragraph = block separated by empty lines)
    const lines = markdown.split('\n');
    let inParagraph = false;

    for (const line of lines) {
        if (line.trim() === '') {
            currentEntity = null; // paragraph break resets context
            continue;
        }

        // Find entity references in this line
        let match;
        const lineEntities = [];
        entityRe.lastIndex = 0;
        while ((match = entityRe.exec(line)) !== null) {
            const [, type, id, displayText] = match;
            const path = `${type}:${id}`;
            const nameInStore = lookupFact(path, 'name');
            const nameMatch = nameInStore !== undefined && String(nameInStore) === String(displayText);
            results.entities.push({ path, displayText, nameInStore, nameMatch, verified: nameMatch });
            results.total++;
            if (nameMatch) results.verified++;
            else if (nameInStore !== undefined) results.errors.push(`Entity ${path}: naam "${displayText}" ≠ "${nameInStore}" in data`);
            else results.errors.push(`Entity ${path}: niet gevonden in data`);
            currentEntity = path;
            lineEntities.push({ pos: match.index, path });
        }

        // Find fact references in this line
        factRe.lastIndex = 0;
        while ((match = factRe.exec(line)) !== null) {
            const [, field, value] = match;
            // Find which entity context this fact belongs to
            let entityForFact = currentEntity;
            for (const le of lineEntities) {
                if (le.pos < match.index) entityForFact = le.path;
            }

            results.total++;
            if (!entityForFact) {
                results.errors.push(`Feit %[${field}]{${value}}: geen entity context. Voeg @[entity:id]{naam} toe vóór dit feit.`);
                results.facts.push({ field, value, entity: null, status: 'no-context' });
                continue;
            }

            const fullPath = `${entityForFact}.${field}`;
            const actual = lookupFact(entityForFact, field);
            if (actual === undefined) {
                results.errors.push(`Feit ${fullPath}: veld "${field}" niet gevonden voor ${entityForFact}`);
                results.facts.push({ field, value, entity: entityForFact, status: 'unverifiable', path: fullPath });
            } else if (String(actual) === String(value)) {
                results.verified++;
                results.facts.push({ field, value, entity: entityForFact, status: 'verified', path: fullPath, actual });
            } else {
                results.errors.push(`Feit ${fullPath}: waarde "${value}" ≠ "${actual}" in data. Gebruik "${actual}".`);
                results.facts.push({ field, value, entity: entityForFact, status: 'mismatch', path: fullPath, actual });
            }
        }

        // Check for unref'd numbers (lines with digits but no %[...] refs, inside an entity context)
        if (currentEntity) {
            const strippedLine = line.replace(/@\[.*?\]\{.*?\}/g, '').replace(/%\[.*?\]\{.*?\}/g, '');
            const bareNumbers = strippedLine.match(/\b\d+([,.]\d+)?%?\b/g);
            if (bareNumbers && bareNumbers.length > 0) {
                for (const num of bareNumbers) {
                    if (num === '0' || num.length > 6) continue; // skip trivial
                    results.errors.push(`Ongerefereerd getal "${num}" in context ${currentEntity}. Gebruik %[veld]{${num}} syntax.`);
                }
            }
        }
    }

    return {
        valid: results.errors.length === 0,
        summary: `${results.verified}/${results.total} geverifieerd`,
        errors: results.errors,
        details: results
    };
}

function lookupFact(entityPath, field) {
    // Look up in the mastery-layers data
    const [type, id] = entityPath.split(':');
    if (type === 'student') {
        for (const o of ml.offerings) {
            const st = o.students.find(s => s.id === +id);
            if (!st) continue;
            if (field === 'name') return st.name;
            if (field === 'passRate') return st.rate;
            if (field === 'passed') return st.pass;
            if (field === 'evaluated') return st.ev;
            if (field === 'total') return st.total;
            if (field === 'absent') return st.grijs || 0;
            if (field === 'evalRate') return st.total ? Math.round(st.ev / st.total * 100) : 0;
            if (field === 'offering') return o.name;
            if (field === 'offeringId') return o.id;
            if (field === 'stream') return o.stream;
            if (field === 'grade') return o.grade;
            return undefined;
        }
    }
    if (type === 'offering') {
        const o = ml.offerings.find(x => x.id === +id);
        if (!o) return undefined;
        if (field === 'name') return o.name;
        if (field === 'studentCount') return o.students.length;
        if (field === 'stream') return o.stream;
        if (field === 'grade') return o.grade;
        const avg = o.students.length ? Math.round(o.students.reduce((s, st) => s + st.rate, 0) / o.students.length) : 0;
        const evAvg = o.students.length ? Math.round(o.students.reduce((s, st) => s + (st.total ? st.ev / st.total * 100 : 0), 0) / o.students.length) : 0;
        if (field === 'passRate') return avg;
        if (field === 'evalRate') return evAvg;
        return undefined;
    }
    if (type === 'al') {
        const a = ml.als.find(x => x.id === +id);
        if (!a) return undefined;
        if (field === 'prefix') return a.p;
        if (field === 'name') return a.n;
        if (field === 'cluster') return a.cl;
        if (field === 'scores') return a.scores || 0;
        return undefined;
    }
    return undefined;
}

// === MCP SERVER (stdio) ===

const TOOLS = [
    {
        name: 'at_risk_students',
        description: 'Find students with low pass rates. Optionally filter by offering name.',
        inputSchema: {
            type: 'object',
            properties: {
                offering_name: { type: 'string', description: 'Filter by offering name (partial match)' },
                min_evaluated: { type: 'number', description: 'Minimum evaluated ALs (default 5)' },
                max_pass_rate: { type: 'number', description: 'Maximum pass rate % to include (default 30)' }
            }
        },
        fn: atRiskStudents
    },
    {
        name: 'offering_comparison',
        description: 'Compare how different offerings perform on the same attainment level. Shows pass rate per offering.',
        inputSchema: {
            type: 'object',
            properties: {
                al_prefix: { type: 'string', description: 'Attainment level prefix (e.g. "BV2_06.17")' },
                al_id: { type: 'number', description: 'Attainment level ID' },
                min_students: { type: 'number', description: 'Minimum students evaluated (default 3)' }
            }
        },
        fn: offeringComparison
    },
    {
        name: 'co_failure',
        description: 'Find attainment levels that fail together with a given AL. Shows correlation strength.',
        inputSchema: {
            type: 'object',
            properties: {
                al_prefix: { type: 'string', description: 'Attainment level prefix' },
                al_id: { type: 'number', description: 'Attainment level ID' },
                cross_cluster_only: { type: 'boolean', description: 'Only show cross-cluster correlations (default false)' },
                limit: { type: 'number', description: 'Max results (default 20)' }
            }
        },
        fn: coFailure
    },
    {
        name: 'offering_overview',
        description: 'Get detailed overview of an offering: all students with their pass rates.',
        inputSchema: {
            type: 'object',
            properties: {
                offering_name: { type: 'string', description: 'Offering name (partial match)' },
                offering_id: { type: 'number', description: 'Offering ID' }
            }
        },
        fn: offeringOverview
    },
    {
        name: 'weakest_attainment_levels',
        description: 'Find attainment levels with the lowest pass rates. Optionally filter by category or cluster.',
        inputSchema: {
            type: 'object',
            properties: {
                category: { type: 'number', description: 'Category: 1=Basisvorming, 2=Specifiek, 3=Levensbeschouwing, 4=Complementair' },
                cluster: { type: 'string', description: 'Cluster name (exact match)' },
                min_students: { type: 'number', description: 'Minimum students (default 10)' },
                limit: { type: 'number', description: 'Max results (default 20)' }
            }
        },
        fn: weakestAttainmentLevels
    },
    {
        name: 'student_detail',
        description: 'Get detailed mastery data for a specific student.',
        inputSchema: {
            type: 'object',
            properties: {
                student_id: { type: 'number', description: 'Student ID' },
                student_name: { type: 'string', description: 'Student name (partial match)' }
            }
        },
        fn: studentDetail
    },
    {
        name: 'summary_stats',
        description: 'Get overall summary: total students, ALs, offerings with their pass rates.',
        inputSchema: { type: 'object', properties: {} },
        fn: summaryStats
    },
    {
        name: 'verify_output',
        description: 'MANDATORY: Call this with your complete markdown response BEFORE returning it to the user. Verifies all @[entity]{name} and %[field]{value} citations against the fact store. Fix any errors and re-verify until valid=true.',
        inputSchema: {
            type: 'object',
            properties: {
                markdown: { type: 'string', description: 'Your complete ProveML markdown response to verify' }
            },
            required: ['markdown']
        },
        fn: verifyProvemlOutput
    }
];

// MCP stdio protocol
process.stdin.setEncoding('utf-8');
let buffer = '';

process.stdin.on('data', chunk => {
    buffer += chunk;
    while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        const header = buffer.substring(0, headerEnd);
        const match = header.match(/Content-Length: (\d+)/);
        if (!match) { buffer = buffer.substring(headerEnd + 4); continue; }
        const len = parseInt(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + len) break;
        const body = buffer.substring(bodyStart, bodyStart + len);
        buffer = buffer.substring(bodyStart + len);
        handleMessage(JSON.parse(body));
    }
});

function send(msg) {
    const body = JSON.stringify(msg);
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function handleMessage(msg) {
    if (msg.method === 'initialize') {
        send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'assessment-platform-skills', version: '1.0.0' } } });
    } else if (msg.method === 'notifications/initialized') {
        // no response needed
    } else if (msg.method === 'tools/list') {
        send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } });
    } else if (msg.method === 'tools/call') {
        const tool = TOOLS.find(t => t.name === msg.params.name);
        if (!tool) {
            send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown tool' }) }] } });
            return;
        }
        try {
            const result = tool.fn(msg.params.arguments || {});
            send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
        } catch (e) {
            send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }] } });
        }
    } else {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    }
}

process.stderr.write('the assessment platform Skills MCP server started\n');
