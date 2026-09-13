#!/usr/bin/env node
/**
 * Tops the blog topic queue back up when it runs low, so the schedule never
 * arrives to an empty queue.
 *
 * Runs weekly. Does nothing at all unless the queue has fallen below THRESHOLD,
 * so most weeks this is a no-op that costs one cheap API call's worth of
 * nothing (it exits before calling the model).
 *
 * Usage:
 *   node scripts/refill-topics.mjs             top up if below threshold
 *   node scripts/refill-topics.mjs --force     top up regardless
 *   node scripts/refill-topics.mjs --dry-run   report the counts and stop
 *   node scripts/refill-topics.mjs --fixture t.json  validate topics from a local
 *       file instead of calling the model — for testing, or for adding a batch
 *       by hand and letting the same checks run over it
 *
 * Requires ANTHROPIC_API_KEY unless --dry-run.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOPICS = join(ROOT, '.claude', 'blog-topics.md');
const INDEX = join(ROOT, 'blog', 'index.html');

const MODEL = process.env.TOPIC_MODEL || process.env.BLOG_MODEL || 'claude-opus-5';

/** Top up when fewer than this many remain — about three weeks of runway. */
const THRESHOLD = 8;
/** Top up to roughly this many, so a refill lasts about two months. */
const TARGET = 16;

const CLUSTERS = [
  'Pricing &amp; estimating',
  'Drainage authority',
  'Lead gen &amp; Meta ads',
  'Proposals &amp; closing',
  'Running the operation',
  'Comparisons',
];

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const DRY_RUN = argv.includes('--dry-run');
const FIXTURE = (() => { const i = argv.indexOf('--fixture'); return i !== -1 ? argv[i + 1] : null; })();

const read = (p) => readFileSync(p, 'utf8');
const log = (m) => console.log(m);
const die = (m) => { console.error(`\n  error: ${m}\n`); process.exit(1); };
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&#39;/g, "'");

/* ---------------------------------------------------------------- state -- */

function parseQueue() {
  const lines = read(TOPICS).split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === '## Queue');
  if (start === -1) die('blog-topics.md has no "## Queue" heading');

  const topics = [];
  lines.forEach((line, i) => {
    if (i <= start) return;
    const m = line.match(/^- \[( |x)\] `([a-z0-9-]+)` \| (.+?) \| (.+)$/);
    if (m) topics.push({ done: m[1] === 'x', slug: m[2], cluster: m[3].trim(), angle: m[4].trim(), lineNo: i });
  });
  return { lines, topics };
}

function publishedPosts() {
  const html = read(INDEX);
  const re = /<a class="panel post-card" href="\/blog\/([a-z0-9-]+)">\s*<span class="lbl teal">(.*?)<\/span>\s*<h3>(.*?)<\/h3>\s*<p>(.*?)<\/p>/gs;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push({ slug: m[1], cluster: m[2], title: m[3], description: m[4] });
  return out;
}

/* ---------------------------------------------------------------- writer -- */

function buildPrompt(posts, queued, need) {
  const counts = {};
  CLUSTERS.forEach((c) => { counts[c] = 0; });
  [...posts, ...queued].forEach((t) => { if (counts[t.cluster] !== undefined) counts[t.cluster] += 1; });

  const spread = CLUSTERS
    .map((c) => `  ${decode(c)}: ${counts[c]}`)
    .join('\n');

  const published = posts
    .map((p) => `  ${p.slug} — ${decode(p.title)}\n      ${decode(p.description)}`)
    .join('\n');

  const pending = queued.length
    ? queued.map((t) => `  ${t.slug} [${decode(t.cluster)}] — ${decode(t.angle)}`).join('\n')
    : '  (none)';

  return `You pick topics for the ScapesHQ blog. ScapesHQ makes lead-to-proposal
software for landscape, hardscape and drainage contractors. The blog exists to
be genuinely useful to a contractor who may never buy anything — the posts do
arithmetic on the page, give ranges rather than invented precision, and are
honest about what the product does not do.

These topics are written unattended and most publish without a human reading
them first. A weak topic becomes a weak published page, so propose only
subjects you would defend.

ALREADY PUBLISHED — do not propose these again, or near-duplicates of them:

${published}

ALREADY QUEUED — same rule:

${pending}

CURRENT SPREAD ACROSS CLUSTERS (published + queued):

${spread}

Propose ${need} new topics. Rules:

- Favour the thinner clusters above, but do not force a topic into a cluster
  just to even the numbers. A good topic in a full cluster beats a weak one in
  an empty cluster.
- Each must be genuinely new ground, not an angle on something already covered.
  If the closest existing post is "how to price a French drain", a topic about
  pricing French drains is out no matter how it is framed.
- The slug becomes a permanent URL: short, lowercase, hyphenated, no dates, no
  year numbers, nothing that will read as stale in a year.
- The cluster must be EXACTLY one of these strings, ampersands included:
${CLUSTERS.map((c) => `    ${c}`).join('\n')}
- The angle is direction for the writer, not published text. Two or three
  sentences saying what the post argues, who it is for, and what specifically
  it should contain — measurements, decision rules, scripts, the arithmetic to
  show. Vague angles produce vague posts.
- Where a topic touches something ScapesHQ has NOT built — invoicing, payments,
  time tracking, job actuals, job costing, pricing rules, custom fields,
  automated playbooks, customer SMS, dispatch and route scheduling — say so in
  the angle with a NOTE, so the writer names the gap rather than implying the
  product covers it.
- Prefer subjects a contractor would search for, or ask another contractor in a
  parking lot. Avoid anything that reads like a software listicle.
- Scope each angle to ONE argument, sized for a 1500-2200 word post. An angle
  that asks for five failure modes AND pricing AND homeowner scripts produces a
  3,000-word post doing three jobs. If a subject is that big, propose the
  sharper half and leave the rest for a later topic.

Return one JSON object and nothing else, no code fence:

{ "topics": [ { "slug": "...", "cluster": "...", "angle": "..." } ] }`;
}

async function callClaude(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) die('ANTHROPIC_API_KEY is not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }),
  });

  if (!res.ok) die(`Anthropic API returned ${res.status}: ${(await res.text()).slice(0, 400)}`);

  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const u = data.usage || {};
  log(`  tokens  ${u.input_tokens ?? '?'} in, ${u.output_tokens ?? '?'} out  (stop: ${data.stop_reason})`);

  if (data.stop_reason === 'max_tokens') die('the model hit the token ceiling and its JSON was cut off');

  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a === -1 || b === -1) die(`no JSON object in the response:\n${text.slice(0, 300)}`);
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch (e) {
    die(`the model's JSON did not parse (${e.message})`);
  }
}

/* ------------------------------------------------------------ validation -- */

const words = (slug) => new Set(slug.split('-').filter((w) => w.length > 3));

/** Two slugs sharing most of their meaningful words are the same topic twice. */
function tooSimilar(slug, existing) {
  const a = words(slug);
  if (!a.size) return null;
  for (const other of existing) {
    const b = words(other);
    if (!b.size) continue;
    const shared = [...a].filter((w) => b.has(w)).length;
    if (shared / Math.min(a.size, b.size) >= 0.6) return other;
  }
  return null;
}

function accept(proposed, taken) {
  const kept = [];
  const rejected = [];

  for (const t of proposed) {
    const slug = String(t.slug || '').trim();
    const cluster = String(t.cluster || '').trim();
    const angle = String(t.angle || '').trim();

    const reject = (why) => rejected.push(`${slug || '(no slug)'} — ${why}`);

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) { reject('slug is not lowercase-hyphenated'); continue; }
    if (slug.length > 60) { reject('slug is too long for a permanent URL'); continue; }
    if (/\b(19|20)\d\d\b/.test(slug)) { reject('slug contains a year'); continue; }
    if (!CLUSTERS.includes(cluster)) { reject(`cluster "${cluster}" is not one of the six`); continue; }
    if (angle.length < 80) { reject('angle is too thin to write from'); continue; }
    if (taken.has(slug)) { reject('slug already exists'); continue; }

    const near = tooSimilar(slug, taken);
    if (near) { reject(`too close to "${near}"`); continue; }

    taken.add(slug);
    kept.push({ slug, cluster, angle });
  }

  return { kept, rejected };
}

/* ----------------------------------------------------------------- main -- */

function writeOutputs(pairs) {
  if (!process.env.GITHUB_OUTPUT) return;
  writeFileSync(process.env.GITHUB_OUTPUT, `${Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { flag: 'a' });
}

async function main() {
  const { lines, topics } = parseQueue();
  const posts = publishedPosts();
  const queued = topics.filter((t) => !t.done);

  log(`\n  queued    ${queued.length}`);
  log(`  published ${posts.length}`);
  log(`  threshold ${THRESHOLD}, target ${TARGET}`);

  if (queued.length >= THRESHOLD && !FORCE) {
    log(`\n  Queue is healthy — nothing to do.\n`);
    writeOutputs({ added: 0, reason: 'above-threshold' });
    return;
  }

  const need = Math.max(0, TARGET - queued.length);
  if (!need) { log('\n  Already at target.\n'); writeOutputs({ added: 0, reason: 'at-target' }); return; }

  log(`\n  Below threshold — asking for ${need} new topics.`);

  if (DRY_RUN) { log('  --dry-run: stopping before the model call.\n'); return; }

  const taken = new Set([...posts.map((p) => p.slug), ...topics.map((t) => t.slug)]);
  const answer = FIXTURE
    ? JSON.parse(read(resolve(FIXTURE)))
    : await callClaude(buildPrompt(posts, queued, need));
  if (!Array.isArray(answer.topics)) die('the model did not return a topics array');

  const { kept, rejected } = accept(answer.topics, taken);

  if (rejected.length) {
    log(`\n  rejected ${rejected.length}:`);
    rejected.forEach((r) => log(`    - ${r}`));
  }
  if (!kept.length) {
    log('\n  Nothing survived validation — queue unchanged.\n');
    writeOutputs({ added: 0, reason: 'all-rejected' });
    process.exit(1);
  }

  const block = kept
    .map((t) => `- [ ] \`${t.slug}\` | ${t.cluster} | ${t.angle}`)
    .join('\n');

  const out = [...lines];
  const at = out.findIndex((l) => l.trim() === '## Published');
  if (at === -1) die('blog-topics.md has no "## Published" heading to insert above');
  out.splice(at, 0, block, '');
  writeFileSync(TOPICS, out.join('\n'), 'utf8');

  log(`\n  added ${kept.length}:`);
  kept.forEach((t) => log(`    ${t.slug}  [${decode(t.cluster)}]`));
  log(`\n  queue is now ${queued.length + kept.length}\n`);

  writeOutputs({
    added: kept.length,
    rejected: rejected.length,
    queue: queued.length + kept.length,
    slugs: kept.map((t) => t.slug).join(' '),
  });
}

main().catch((e) => die(e.stack || e.message));
