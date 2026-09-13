#!/usr/bin/env node
/**
 * Generates one blog post from the top unchecked topic in .claude/blog-topics.md
 * and wires it into every place a post has to appear:
 *
 *   blog/<slug>.html   the post itself
 *   blog/index.html    a card, inserted next to its cluster siblings
 *   sitemap.xml        a <url> entry
 *   netlify.toml       a 301 from the .html URL to the clean one
 *
 * Page chrome (GTM, campaign capture, nav, footer, CTA block) is sliced out of
 * an existing post at run time rather than duplicated here, so a nav or footer
 * change made once on the live posts is inherited by every future post.
 *
 * Usage:
 *   node scripts/generate-post.mjs                 write files
 *   node scripts/generate-post.mjs --dry-run       build the prompt and stop
 *   node scripts/generate-post.mjs --topic SLUG    jump the queue
 *   node scripts/generate-post.mjs --fixture x.json  render a post from a local
 *       JSON file instead of calling the model — for testing the wiring, or for
 *       hand-writing a post and letting the script place it correctly
 *
 * Requires ANTHROPIC_API_KEY except with --dry-run or --fixture.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const P = {
  topics: join(ROOT, '.claude', 'blog-topics.md'),
  blogDir: join(ROOT, 'blog'),
  index: join(ROOT, 'blog', 'index.html'),
  sitemap: join(ROOT, 'sitemap.xml'),
  netlify: join(ROOT, 'netlify.toml'),
};

const REFERENCE_POST = 'speed-to-lead.html';
const MODEL = process.env.BLOG_MODEL || 'claude-opus-5';
const SITE = 'https://scapeshq.com';

const CLUSTERS = [
  'Pricing &amp; estimating',
  'Drainage authority',
  'Lead gen &amp; Meta ads',
  'Proposals &amp; closing',
  'Running the operation',
  'Comparisons',
];

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
};
const FORCED_TOPIC = flagValue('--topic');
const FIXTURE = flagValue('--fixture');

const read = (p) => readFileSync(p, 'utf8');
const die = (msg) => { console.error(`\n  error: ${msg}\n`); process.exit(1); };
const log = (msg) => console.log(msg);

/* ---------------------------------------------------------------- topics -- */

function parseTopics() {
  const lines = read(P.topics).split(/\r?\n/);
  // Everything above "## Queue" is documentation, including a format example
  // that would otherwise parse as a topic.
  const start = lines.findIndex((l) => l.trim() === '## Queue');
  if (start === -1) die(`${P.topics} has no "## Queue" heading`);

  const topics = [];
  lines.forEach((line, i) => {
    if (i <= start) return;
    const m = line.match(/^- \[( |x)\] `([a-z0-9-]+)` \| (.+?) \| (.+)$/);
    if (m) topics.push({ done: m[1] === 'x', slug: m[2], cluster: m[3].trim(), angle: m[4].trim(), lineNo: i });
  });
  return { lines, topics };
}

function nextTopic() {
  const { lines, topics } = parseTopics();
  if (!topics.length) die(`no topics parsed from ${P.topics} — check the line format`);

  const topic = FORCED_TOPIC
    ? topics.find((t) => t.slug === FORCED_TOPIC)
    : topics.find((t) => !t.done);

  if (FORCED_TOPIC && !topic) die(`--topic ${FORCED_TOPIC} is not in the queue`);
  if (!topic) return { lines, topic: null };

  if (!CLUSTERS.includes(topic.cluster)) {
    die(`topic "${topic.slug}" has cluster "${topic.cluster}", which is not one of:\n    ${CLUSTERS.join('\n    ')}`);
  }
  return { lines, topic };
}

function markTopicDone(lines, topic, date) {
  const out = [...lines];
  out[topic.lineNo] = out[topic.lineNo].replace('- [ ]', '- [x]') + ` (published ${date})`;
  return out.join('\n');
}

/* ---------------------------------------------------------------- chrome -- */

/**
 * Slices the shared page furniture out of a real post. Anchors are chosen to be
 * things that would only change if the whole template changed.
 */
function loadChrome() {
  const src = read(join(P.blogDir, REFERENCE_POST));
  const cut = (start, end, label) => {
    const a = src.indexOf(start);
    const b = src.indexOf(end, a === -1 ? 0 : a + start.length);
    if (a === -1 || b === -1) die(`could not slice ${label} out of ${REFERENCE_POST} — the template changed shape`);
    return src.slice(a, b);
  };

  return {
    // doctype through the line before <title>
    head: src.slice(0, src.indexOf('<title>')),
    // </head> through the opening <article> tag
    open: cut('</head>', '<section class="page-head">', 'body open'),
    // closing </article> through the "Keep reading" heading
    cta: cut('</article>', '<div class="grid-2 mt-m">', 'CTA block'),
    // everything from </main> to EOF
    foot: src.slice(src.indexOf('</main>')),
  };
}

/* ------------------------------------------------------- existing posts -- */

/** Reads the live cards so the writer knows what already exists and can link to it. */
function existingPosts() {
  const html = read(P.index);
  const re = /<a class="panel post-card" href="\/blog\/([a-z0-9-]+)">\s*<span class="lbl teal">(.*?)<\/span>\s*<h3>(.*?)<\/h3>\s*<p>(.*?)<\/p>/gs;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ slug: m[1], cluster: m[2], title: m[3], description: m[4] });
  }
  if (!out.length) die('parsed zero existing posts from blog/index.html — the card markup changed');
  return out;
}

/* ---------------------------------------------------------------- writer -- */

const HOUSE_STYLE = `
You write for ScapesHQ, which makes lead-to-proposal software for landscape,
hardscape and drainage contractors. The blog exists to be genuinely useful to a
contractor who may never buy anything. Posts that read like brochures fail.

VOICE
- Open on a concrete scene or a specific number. Never open with a definition,
  never with "In today's competitive landscape", never with the word "Whether".
- Second person, direct, unhurried. Short paragraphs — two to four sentences.
- Plain trade language. A contractor reading this in a truck should not have to
  decode anything.
- Confident about what you know, explicit about what varies by market.
- No exclamation marks. No rhetorical questions as section headings. No
  "Let's dive in", "game-changer", "unlock", "leverage", "seamless", "robust",
  "in today's world", "that said", "at the end of the day".
- Contractions are fine and normal.

SUBSTANCE
- Every claim either follows from arithmetic shown on the page, or is labelled
  as a range that varies by market. Invented precision is the main failure mode:
  "$38-$45 per loaded hour in most markets" is good, "$41.50 per hour" is not,
  unless you derive it in front of the reader.
- Where numbers appear, show the arithmetic so the reader can substitute their
  own. A worked example beats a benchmark.
- Prefer telling the reader how to find their own number over telling them a
  number.
- Anything time-sensitive (ad costs, competitor features) must be written so it
  ages honestly — say what it depends on, not just what it is.

PRODUCT HONESTY — this is the rule that matters most
- ScapesHQ has BUILT: lead intake from Meta Lead Ads, Page connection health and
  replay of failed intake, clients/contacts/companies/properties as separate
  linked records, projects, estimates, proposals with options and templates, a
  homeowner review page, e-signature with evidence on the record, send history,
  a permanent activity timeline, data export and account closure controls.
- ScapesHQ has NOT built, and these are RESERVED: invoicing, payments, time
  tracking, job actuals, job costing against budget, pricing rules, custom
  fields, automated playbooks, SMS to customers, dispatch and route scheduling.
- Never imply a reserved capability works. If a post's subject touches one, say
  plainly that it is not built and point the reader at what does solve it.
- Mention the product at most twice, and only where it genuinely belongs in the
  argument. A post can mention it zero times and be a good post.

SHAPE
- 1200-1700 words in the body.
- Four to seven <h2> sections with substantive headings — a heading should tell
  the reader what the section argues, not just name a topic.
- At least one list, and a <table> only where a real comparison earns it.
- Link to two or three of the existing posts listed below, inline, with anchor
  text that reads naturally. Never link to a post that does not exist.
- Exactly one link to /demo, in the closing line, phrased as an invitation to
  look at the reader's own work — not a pitch.
`.trim();

const MARKUP_RULES = `
bodyHtml must be a fragment — no <html>, <head>, <body>, <article> or <section>.
Use only these tags, exactly as shown:

  <p>...</p>
  <h2>...</h2>  <h3>...</h3>
  <strong>  <em>  <a href="/path">  <code>
  <blockquote><p>...</p></blockquote>
  <ul class="speclist"><li><span>...</span></li></ul>
  <ol class="speclist"><li><span>...</span></li></ol>
  <div class="tablewrap"><table><thead><tr><th>..</th></tr></thead><tbody><tr><td>..</td></tr></tbody></table></div>

The <span> inside every speclist <li> is required — the list is CSS grid and an
unwrapped text node becomes a stray grid item.

Use straight apostrophes ('), not curly ones. Use the em dash character
directly. Write & as &amp; in text. Internal links are root-relative
("/blog/speed-to-lead", "/features", "/demo") and never end in .html.

Do NOT include an FAQ section, a "short version" section, or the closing
call-to-action line in bodyHtml — those come from the other fields.
`.trim();

function buildPrompt(topic, posts, dateISO) {
  const catalogue = posts
    .map((p) => `  /blog/${p.slug}  [${p.cluster.replace(/&amp;/g, '&')}]  ${p.title}\n      ${p.description}`)
    .join('\n');

  return `${HOUSE_STYLE}

EXISTING POSTS — link to two or three of these, and do not repeat their ground:

${catalogue}

TODAY'S ASSIGNMENT
  Slug:    ${topic.slug}          (the URL is /blog/${topic.slug} — do not change it)
  Cluster: ${topic.cluster.replace(/&amp;/g, '&')}
  Angle:   ${topic.angle}
  Date:    ${dateISO}

MARKUP
${MARKUP_RULES}

Return one JSON object and nothing else — no prose before or after, no code
fence. Shape:

{
  "title": "Title Case, under 65 characters, specific not clever",
  "description": "Meta description, 140-158 characters, says what the reader gets",
  "lede": "One sentence under the H1. Concrete. Not a restatement of the title.",
  "bodyHtml": "the post, following the markup rules above",
  "faqs": [ { "q": "A question a contractor would actually type", "a": "Two to four sentences. Plain text, no HTML." } ],
  "shortVersion": "One paragraph, two to four sentences, that a reader who scrolled to the bottom could act on. Plain text.",
  "closingLine": "The clause that follows the /demo link, starting lowercase — e.g. \\"and we'll look at how fast your leads actually reach a human right now.\\"",
  "relatedSlugs": ["slug-of-an-existing-post", "slug-of-another"]
}

Four or five FAQs. relatedSlugs must be exactly two slugs from the list above.`;
}

async function callClaude(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) die('ANTHROPIC_API_KEY is not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      // A post is roughly 1500 words of prose plus HTML markup, FAQs and JSON
      // escaping. 8000 was not enough and truncated mid-object; the headroom
      // costs nothing, since output is billed on what is actually produced.
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) die(`Anthropic API returned ${res.status}: ${(await res.text()).slice(0, 400)}`);

  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const u = data.usage || {};
  log(`  tokens  ${u.input_tokens ?? '?'} in, ${u.output_tokens ?? '?'} out  (stop: ${data.stop_reason})`);

  if (!text.trim()) die('the model returned no text');

  // Worth naming explicitly: a truncated response usually has no closing brace
  // at all, so the JSON check below would otherwise report it as "no JSON".
  if (data.stop_reason === 'max_tokens') {
    die(`the model hit the ${16000} token ceiling and its JSON was cut off mid-object.\n`
      + `         Raise max_tokens in scripts/generate-post.mjs, or tighten the length target in HOUSE_STYLE.`);
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) die(`no JSON object in the response:\n${text.slice(0, 400)}`);

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    die(`the model's JSON did not parse (${e.message})`);
  }
}

/* ------------------------------------------------------------ validation -- */

const BANNED = [
  'game-changer', 'game changer', 'unlock', 'leverage', 'seamless', 'robust',
  "in today's", 'dive in', 'at the end of the day', 'that said', 'elevate',
  'revolutionize', 'cutting-edge', 'best-in-class', 'supercharge',
];

const RESERVED_TRAPS = [
  'invoicing', 'payments', 'time tracking', 'job actuals', 'pricing rules',
  'custom fields', 'playbooks', 'dispatch',
];

const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const esc = (s) => decode(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const straighten = (s) => String(s)
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

function sanitizeBody(html, report) {
  let out = straighten(html).trim();

  // The model occasionally drops the required <span> inside a speclist item.
  out = out.replace(/<li>(?!\s*<span>)([\s\S]*?)<\/li>/g, (m, inner) => {
    report.push({ level: 'fixed', msg: 'wrapped a bare speclist <li> in <span>' });
    return `<li><span>${inner.trim()}</span></li>`;
  });

  return out;
}

function validate(post, topic, posts, report) {
  const fail = [];
  const need = ['title', 'description', 'lede', 'bodyHtml', 'faqs', 'shortVersion', 'closingLine', 'relatedSlugs'];
  for (const k of need) if (!post[k]) fail.push(`missing field: ${k}`);
  if (fail.length) die(fail.join('\n         '));

  const body = post.bodyHtml;
  const text = decode(body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const words = text.split(' ').length;

  // hard failures — these produce a broken or dishonest page
  if (/<(html|head|body|article|section|script|style|iframe)\b/i.test(body)) {
    fail.push('bodyHtml contains a structural or script tag it must not');
  }
  if (post.relatedSlugs.length !== 2) fail.push(`relatedSlugs must have 2 entries, got ${post.relatedSlugs.length}`);
  for (const s of post.relatedSlugs) {
    if (s === topic.slug) fail.push(`relatedSlugs points at the post itself (${s})`);
    else if (!posts.some((p) => p.slug === s)) fail.push(`relatedSlugs points at a post that does not exist: ${s}`);
  }
  for (const m of body.matchAll(/href="\/blog\/([a-z0-9-]+)"/g)) {
    if (m[1] !== topic.slug && !posts.some((p) => p.slug === m[1])) {
      fail.push(`body links to a post that does not exist: /blog/${m[1]}`);
    }
  }
  if (/href="[^"]*\.html"/.test(body)) fail.push('body links to a .html URL — use the clean path');
  if (!Array.isArray(post.faqs) || post.faqs.length < 3 || post.faqs.length > 6) {
    fail.push(`expected 3-6 FAQs, got ${Array.isArray(post.faqs) ? post.faqs.length : 'none'}`);
  }
  if (words < 800) fail.push(`body is only ${words} words — too thin to publish`);

  if (fail.length) die(fail.join('\n         '));

  // soft flags — the post still builds, but a human should look
  const flag = (msg) => report.push({ level: 'flag', msg });

  if (words < 1150 || words > 1800) flag(`body is ${words} words, outside the 1200-1700 target`);
  if (post.title.length > 65) flag(`title is ${post.title.length} characters (target under 65)`);
  if (post.description.length < 135 || post.description.length > 160) {
    flag(`meta description is ${post.description.length} characters (target 140-158)`);
  }
  const lower = text.toLowerCase();
  for (const b of BANNED) if (lower.includes(b)) flag(`house style: uses "${b}"`);

  const demoLinks = (body.match(/href="\/demo"/g) || []).length;
  if (demoLinks > 0) flag(`body has ${demoLinks} /demo link(s) on top of the closing line — check it does not read as a pitch`);

  const internal = new Set([...body.matchAll(/href="\/blog\/([a-z0-9-]+)"/g)].map((m) => m[1]));
  if (internal.size < 2) flag(`only ${internal.size} internal blog link(s) — target is two or three`);

  for (const r of RESERVED_TRAPS) {
    if (lower.includes(r)) flag(`mentions "${r}", which is Reserved — confirm the post does not imply it is built`);
  }

  return { words, readingTime: Math.max(4, Math.round(words / 200)) };
}

/* --------------------------------------------------------------- render -- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function buildJsonLd(post, topic, dateISO) {
  const url = `${SITE}/blog/${topic.slug}`;
  const graph = [
    {
      '@type': 'Article',
      headline: decode(post.title),
      description: decode(post.description),
      datePublished: dateISO,
      dateModified: dateISO,
      author: { '@type': 'Organization', name: 'ScapesHQ' },
      publisher: { '@type': 'Organization', name: 'ScapesHQ' },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      articleSection: decode(topic.cluster),
    },
    {
      '@type': 'FAQPage',
      mainEntity: post.faqs.map((f) => ({
        '@type': 'Question',
        name: decode(f.q),
        acceptedAnswer: { '@type': 'Answer', text: decode(f.a) },
      })),
    },
  ];
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2);
}

function renderRelatedCard(p) {
  const i = '      ';
  return `${i}<a class="panel post-card" href="/blog/${p.slug}">\n`
    + `${i}  <span class="lbl teal">${p.cluster}</span>\n`
    + `${i}  <h3>${p.title}</h3>\n`
    + `${i}  <p>${p.description}</p>\n`
    + `${i}  <span class="post-more">Read it &rarr;</span>\n`
    + `${i}</a>\n`;
}

function renderPost(post, topic, chrome, posts, dateISO, meta) {
  const title = esc(post.title);
  const description = esc(post.description);
  const lede = esc(post.lede);
  const url = `${SITE}/blog/${topic.slug}`;

  const faqHtml = post.faqs
    .map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`)
    .join('\n');

  const related = post.relatedSlugs
    .map((s) => posts.find((p) => p.slug === s))
    .map(renderRelatedCard)
    .join('');

  return chrome.head
    + `<title>${title} &mdash; ScapesHQ</title>\n`
    + `<meta name="description" content="${description}">\n`
    + `<link rel="canonical" href="${url}">\n`
    + `<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">\n`
    + `<link rel="preconnect" href="https://fonts.googleapis.com">\n`
    + `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n`
    + `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Sora:wght@400;500;600&display=swap">\n`
    + `<link rel="stylesheet" href="/assets/styles.css">\n`
    + `<script type="application/ld+json">\n${buildJsonLd(post, topic, dateISO)}\n</script>\n`
    + chrome.open
    + `<section class="page-head">\n`
    + `    <div class="wrap-narrow">\n`
    + `      <span class="eyebrow lbl"><i></i>${topic.cluster}</span>\n`
    + `      <h1>${title}</h1>\n`
    + `      <p class="lede">${lede}</p>\n`
    + `      <p class="post-meta"><time datetime="${dateISO}">${prettyDate(dateISO)}</time> &middot; ${meta.readingTime} min read</p>\n`
    + `    </div>\n`
    + `  </section>\n\n`
    + `  <section class="tight">\n`
    + `    <div class="wrap-narrow article">\n`
    + `${post.bodyHtml}\n`
    + `<h2>FAQ</h2>\n${faqHtml}\n`
    + `<h2>The short version</h2>\n<p>${esc(post.shortVersion)}</p>\n`
    + `<p><a href="/demo">Book a walkthrough</a> ${esc(post.closingLine)}</p>\n`
    + `    </div>\n`
    + `  </section>\n`
    + chrome.cta
    + `<div class="grid-2 mt-m">\n`
    + related
    + `    </div>\n  </div>\n</section>\n\n`
    + chrome.foot;
}

/* -------------------------------------------------------- wiring it in --- */

/** Inserts the card after the last existing card in the same cluster. */
function updateIndex(post, topic, dateISO, meta) {
  const html = read(P.index);
  const cardRe = /^[ \t]*<a class="panel post-card" href="\/blog\/[a-z0-9-]+">[\s\S]*?<\/a>\n/gm;
  const cards = [...html.matchAll(cardRe)];
  if (!cards.length) die('found no cards to insert next to in blog/index.html');

  const sameCluster = cards.filter((c) => c[0].includes(`<span class="lbl teal">${topic.cluster}</span>`));
  const anchor = (sameCluster.length ? sameCluster : cards).at(-1);
  const at = anchor.index + anchor[0].length;

  const card = `      <a class="panel post-card" href="/blog/${topic.slug}">\n`
    + `        <span class="lbl teal">${topic.cluster}</span>\n`
    + `        <h3>${esc(post.title)}</h3>\n`
    + `        <p>${esc(post.description)}</p>\n`
    + `        <span class="post-meta"><time datetime="${dateISO}">${prettyDate(dateISO)}</time> &middot; ${meta.readingTime} min read</span>\n`
    + `      </a>\n`;

  return html.slice(0, at) + card + html.slice(at);
}

function updateSitemap(topic, dateISO) {
  const xml = read(P.sitemap);
  if (xml.includes(`/blog/${topic.slug}<`)) die(`sitemap already lists /blog/${topic.slug}`);
  const entry = `  <url>\n    <loc>${SITE}/blog/${topic.slug}</loc>\n    <lastmod>${dateISO}</lastmod>\n  </url>\n`;
  return xml.replace('</urlset>', entry + '</urlset>');
}

function updateNetlifyToml(topic) {
  const toml = read(P.netlify).replace(/\s*$/, '\n');
  if (toml.includes(`/blog/${topic.slug}.html`)) die(`netlify.toml already redirects /blog/${topic.slug}.html`);
  return toml
    + `\n[[redirects]]\n`
    + `  from = "/blog/${topic.slug}.html"\n`
    + `  to = "/blog/${topic.slug}"\n`
    + `  status = 301\n`
    + `  force = true\n`;
}

/* ----------------------------------------------------------------- main -- */

function summarise(post, topic, dateISO, meta, report) {
  const flags = report.filter((r) => r.level === 'flag');
  const fixes = report.filter((r) => r.level === 'fixed');

  const lines = [
    `**${decode(post.title)}**`,
    '',
    `- Path: \`/blog/${topic.slug}\``,
    `- Cluster: ${decode(topic.cluster)}`,
    `- Date: ${dateISO} · ${meta.words} words · ${meta.readingTime} min read`,
    `- Model: ${MODEL}`,
    '',
    `> ${decode(post.description)}`,
    '',
  ];

  if (flags.length) {
    lines.push('### Worth a look before merging', '');
    flags.forEach((f) => lines.push(`- ${f.msg}`));
    lines.push('');
  } else {
    lines.push('No style or accuracy flags raised.', '');
  }

  if (fixes.length) {
    lines.push('### Auto-corrected', '');
    fixes.forEach((f) => lines.push(`- ${f.msg}`));
    lines.push('');
  }

  lines.push(
    '### Review checklist',
    '',
    '- [ ] Every number is a range or is derived on the page',
    '- [ ] Nothing Reserved is implied to be built',
    '- [ ] Internal links go somewhere real',
    '- [ ] It reads like the other posts',
    '',
    'Deploy preview is linked below once Netlify builds it. Merging publishes.',
  );

  return lines.join('\n');
}

async function main() {
  const { lines, topic } = nextTopic();

  if (!topic) {
    log('\n  The topic queue is empty — nothing to publish.');
    log('  Add topics to .claude/blog-topics.md and the next run will pick them up.\n');
    if (process.env.GITHUB_OUTPUT) {
      writeFileSync(process.env.GITHUB_OUTPUT, 'created=false\nreason=empty-queue\n', { flag: 'a' });
    }
    return;
  }

  const dateISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const posts = existingPosts();
  const chrome = loadChrome();
  const outPath = join(P.blogDir, `${topic.slug}.html`);

  if (existsSync(outPath)) die(`blog/${topic.slug}.html already exists — the topic was published but not checked off`);

  log(`\n  topic   ${topic.slug}`);
  log(`  cluster ${decode(topic.cluster)}`);
  log(`  date    ${dateISO}`);
  log(`  model   ${MODEL}`);

  const prompt = buildPrompt(topic, posts, dateISO);

  if (DRY_RUN) {
    log(`\n  --dry-run: prompt is ${prompt.length} characters, ${posts.length} existing posts in context.`);
    log(`  would write ${outPath}\n`);
    return;
  }

  let post;
  if (FIXTURE) {
    log(`\n  reading ${FIXTURE} instead of calling the model`);
    post = JSON.parse(read(resolve(FIXTURE)));
  } else {
    log('\n  writing...');
    post = await callClaude(prompt);
  }

  const report = [];
  post.bodyHtml = sanitizeBody(post.bodyHtml, report);
  const meta = validate(post, topic, posts, report);

  writeFileSync(outPath, renderPost(post, topic, chrome, posts, dateISO, meta), 'utf8');
  writeFileSync(P.index, updateIndex(post, topic, dateISO, meta), 'utf8');
  writeFileSync(P.sitemap, updateSitemap(topic, dateISO), 'utf8');
  writeFileSync(P.netlify, updateNetlifyToml(topic), 'utf8');
  writeFileSync(P.topics, markTopicDone(lines, topic, dateISO), 'utf8');

  log(`\n  wrote blog/${topic.slug}.html  (${meta.words} words, ${meta.readingTime} min)`);
  log('  updated blog/index.html, sitemap.xml, netlify.toml, .claude/blog-topics.md');

  const flags = report.filter((r) => r.level === 'flag');
  if (flags.length) {
    log(`\n  ${flags.length} flag(s) for review:`);
    flags.forEach((f) => log(`    - ${f.msg}`));
  }
  log('');

  if (process.env.PR_BODY_FILE) {
    writeFileSync(process.env.PR_BODY_FILE, summarise(post, topic, dateISO, meta, report), 'utf8');
  }
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `created=true\nslug=${topic.slug}\ntitle=${decode(post.title).replace(/\n/g, ' ')}\nflags=${flags.length}\n`,
      { flag: 'a' },
    );
  }
}

main().catch((e) => die(e.stack || e.message));
