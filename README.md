# ScapesHQ marketing site

Static multi-page site. No build step, no dependencies, no framework — plain HTML
plus one stylesheet and one small script. Drop it on Netlify (or anywhere) as is.

## Pages

| File | Page | Purpose |
| --- | --- | --- |
| `index.html` | Home | Hero, product board, workflow summary, differentiators, built-vs-reserved |
| `features.html` | Features | Every capability in the platform, in eight sections, plus the full built/reserved table |
| `how-it-works.html` | How it works | The eight stages end to end, what gets recorded, and the failure cases |
| `who-its-for.html` | Who it's for | Trades, roles, and an honest "you should wait if" section |
| `integrations.html` | Integrations | Meta Lead Ads in depth, plus Slack, Postmark, Supabase, Netlify |
| `pricing.html` | Pricing | Three plans with live prices |
| `about.html` | About | Origin, principles, current state |
| `demo.html` | Book a walkthrough | Lead form (Netlify Forms), posts to `/thank-you` |
| `thank-you.html` | Request received | Post-submit confirmation. `noindex`, fires `generate_lead` |
| `404.html` | Not found | Netlify serves this automatically |
| `sitemap.xml` | — | 29 URLs: 8 core + `/blog/` + 20 posts. Excludes `thank-you` (noindex) and `404` |
| `robots.txt` | — | Allows all, points at the sitemap |
| `blog/index.html` | Blog | 20 posts, card grid, cluster pills |
| `blog/<slug>.html` | Blog posts | 20 posts at `/blog/<slug>`. Article + FAQPage JSON-LD |

Assets live in `assets/` — `styles.css`, `nav.js`, `favicon.svg`.

## Before it goes live

1. **Pricing.** Live figures as of 2026-09-12, matching the in-app pricing page:
   Crew $199/mo (3 seats), Operator $299/mo (10 seats), Multi-branch from
   $499/mo (seats to suit). Billed monthly, no annual contract, no free trial.
   No `data-tbd` placeholders remain — if prices change, update this page and
   the in-app pricing screen together.
2. **Form handling.** `demo.html` uses Netlify Forms (`data-netlify="true"` plus
   a honeypot field). It works with zero config on Netlify. If you'd rather post
   somewhere else, replace the `form` attributes and drop the hidden
   `form-name` input.
3. **Screenshots.** The product board on the home page is hand-built HTML using
   the app's own styles, with example records. Swapping in real screenshots of
   the app is the highest-value upgrade — the layout already reserves the space.
4. **Domain and analytics.** Live at `scapeshq.com`, served from Netlify with
   DNS kept at GoDaddy (apex `A` → `75.2.60.5`, `www` CNAME → `scapeshq.netlify.app`).
   **GTM `GTM-NSFZ2WC6` is the only tag on the site** — container high in
   `<head>`, `noscript` iframe immediately after `<body>`, on all 31 pages.
   Inlined deliberately, not in `assets/`, rather than as a shared asset file.

   GTM owns every tag — the hard-coded `gtag.js` block was removed so GA4 is
   configured once, inside the container, with no double-counting. Published
   container holds four tags: the GA4 Google Tag (`G-Q22NXQL94X`) plus
   `cta_click`, `demo_form_start` and `generate_lead`.

   GA4 side is configured: `cta_location` / `cta_text` / `form_name` registered
   as Event-scoped custom dimensions, `generate_lead` marked a Key Event counted
   **once per session** (the page fires it on every load, so per-event counting
   would inflate on refresh), event data retention 14 months, Search Console
   linked. Verified receiving as of 2026-09-08.

   What the site pushes to `dataLayer` for GTM to consume:

   | Signal | Where | Notes |
   | --- | --- | --- |
   | `demo_form_start` | `demo.html` | First input on the form, fires once |
   | `generate_lead` | `thank-you.html` | The conversion. Page is `noindex` |
   | `data-cta="..."` | all pages | 30 links on core pages, plus `blog_index` / `blog_post_end` |

   `data-cta` values: `nav`, `hero`, `page_end`, `footer`, `error_page`,
   `pricing_crew`, `pricing_operator`, `pricing_multibranch`. Use a Click
   Element → Data Attribute variable in GTM to read them.

   **Campaign capture.** A small inline script on every page stores first-touch
   `utm_*`, referrer and landing path in `sessionStorage` (keys prefixed `sq_`).
   `demo.html` copies them into seven hidden form fields, so every Netlify form
   notification carries the source that produced the lead. First-touch wins —
   later UTMs in the same session do not overwrite.

   GTM sets cookies, so a cookie notice may be required depending on where
   visitors are. Google Fonts is the only other third-party script.

## Design system

Matches the ScapesHQ application UI: near-black cool ground, teal accent,
tinted record badges (blue = lead, amber = estimate, teal = proposal). Tokens
are at the top of `assets/styles.css` — change the palette there and the whole
site follows. Type is Sora for display, Manrope for UI and body, loaded from
Google Fonts.

Committed single dark theme, matching the product. There is no light mode by
design.

## Content accuracy

Every capability claim traces to the platform handoff document. Anything not
shipped — invoicing, payments, time tracking, job actuals, pricing rules,
custom fields, playbooks, SMS — is labeled **Reserved**, never implied as
working. Keep that split honest as things ship; the built/reserved table in
`features.html` is the single place to update.

## Deploy

```bash
# Netlify CLI
netlify deploy --dir=. --prod

# or connect the repo in the Netlify UI; netlify.toml already sets publish = "."
```

## Blog

20 posts under `blog/`, served at `/blog/<slug>`. The first ten came from
`scapeshq-blog-content_1.json` (content + ready-made JSON-LD) by a one-off
script; the HTML is the source of truth now, so edit the pages directly.

Blog pages differ from the core pages in one way that matters: **all their
asset and nav paths are absolute** (`/assets/styles.css`, `/features`) because
they sit one directory deep. Copying a core page into `blog/` without fixing
those paths will silently break its styling.

**Dates were shifted −34 days from the supplied schedule.** The source ran
2026-09-14 → 2026-10-15, entirely in the future; the shift preserves the
two-per-week cadence exactly while landing the newest post on the publish date
and leaving nothing future-dated. Dates live in three places per post — the
visible `<time>`, and `datePublished` / `dateModified` in the JSON-LD — plus
`lastmod` in `sitemap.xml`. Change all four together.

### Automated posts

New posts are written on a schedule by `.github/workflows/blog.yml`, Tuesdays
and Fridays at 13:00 UTC.

**A post that raises no flags publishes itself** — committed straight to `main`,
live as soon as Netlify builds. A post that raises any flag becomes a pull
request labelled `needs-review` instead, with the flags in its body and a deploy
preview to read it in place. Hard failures never reach either path; they stop
the run and write nothing.

`scripts/generate-post.mjs` does the work. It takes the first unchecked topic
in `.claude/blog-topics.md`, asks the model for the post, then wires it into
all four places a post has to appear: the page itself, a card at the **top** of
the grid on `blog/index.html`, a `sitemap.xml` entry, and a 301 in
`netlify.toml`. It checks the topic off in the same commit.

The index reads newest-first. Because a run always dates its posts today,
prepending keeps that order without re-sorting the page. The cluster pills above
the grid are labels, not filters, so ordering is free to be chronological.

Two things about it are worth knowing before changing it:

- **Page chrome is sliced out of a live post at run time**, not duplicated in
  the script — `REFERENCE_POST` names which one. Edit the nav or footer on the
  real posts and every future post inherits it. The trade is that renaming the
  reference post, or restructuring its markup, breaks generation; the script
  fails loudly rather than writing a broken page.
- **Validation splits into failures and flags.** A post that would be broken or
  dishonest — a dead internal link, a structural tag in the body, under 800
  words — fails the run and writes nothing. Softer problems (word count off
  target, house-style words, a Reserved capability mentioned) become flags in
  the PR body and a `needs-review` label, because they need judgment rather
  than a rule.

To run it by hand: Actions → Blog post → Run workflow, optionally naming a slug
to jump the queue or a `count` to write several posts in one run. A batch stops
at the first post the generator rejects and keeps everything written before it;
the rejected topic stays unchecked for the next run. Locally, `--dry-run` builds the prompt without calling the
model and `--fixture post.json` renders from a local file, which is also the
way to hand-write a post and let the script place it correctly.

**The queue tops itself up.** `.github/workflows/topics.yml` checks every
Monday and, when fewer than 8 topics remain, asks for enough to reach 16 and
commits them straight to `main`. Most weeks it exits without calling the model
at all. It runs a day ahead of the Tuesday post run so a refill has landed
before anything draws on it, and it shares a concurrency group with the post
workflow because both write `blog-topics.md`.

Proposed topics are validated before they are accepted: the slug must be
lowercase-hyphenated, under 60 characters and free of years; the cluster must be
one of the six exactly; the angle must be substantial enough to write from; and
the slug must neither duplicate an existing one nor share 60% of its meaningful
words with one, which is what catches the same topic proposed twice in different
words. Rejections are listed in the run log. `--fixture topics.json` runs the
same checks over a hand-written list.

Topics are appended in order and taken from the top, so reordering or deleting
lines in the queue is how you change what publishes next.

**Cost.** Measured over nine posts on 2026-09-13: about **3,500 input and
8,700 output tokens per post**, output ranging 5.1k-13.7k. That is the number
to multiply by current Opus pricing, and the run log prints it for every post.
The first batch of ten exhausted the account's credit balance on the tenth,
which is what a spent balance looks like from here: the run stops, keeps every
post written before it, and leaves the topic queued. Set up auto-reload, or
switch `BLOG_MODEL` to a cheaper model, if unattended Tuesdays matter.

Requires an `ANTHROPIC_API_KEY` repository secret — **billed to the Anthropic
API account, separately from a Claude subscription**. `BLOG_MODEL` is an
optional repository variable; it defaults to `claude-opus-5`.

Because `publish = "."` serves the whole repository, `netlify.toml` returns 404
for `/scripts/*`, `/.github/*` and `/.claude/*`.

### Verification notes

**Four posts carry claims that need checking against real data**, per the
source's own `verify` notes:

| Post | What to verify |
| --- | --- |
| `drainage-estimate-template` | Labor/equipment rates are illustrative |
| `facebook-lead-ads-for-contractors` | Cost-per-lead ranges are illustrative |
| `speed-to-lead` | Response-time figures are stated as our own intake data |
| `best-software-for-drainage-contractors` | Competitor claims; re-check every 6 months |

These four cannot simply be unpublished: `drainage-estimate-template` is linked
from all six of the other posts, so removing it breaks internal links across
the cluster. Edit the figures in place instead.
