/**
 * MOVXIO — Cloudflare Pages Edge Worker
 *
 * IMPORTANT: Uses Cloudflare PAGES worker syntax.
 * Pass-through uses env.ASSETS.fetch() NOT fetch()
 * File: _worker.js (place in repo root alongside index.html)
 *
 * Handles these routes:
 *   1. GET /sitemap.xml          → auto-generated from Supabase films
 *   2. GET /og-image/:slug       → dynamic composite OG image (SVG, 1200×630)
 *   3. GET /movie/:slug          → OG meta rewrite for crawlers
 *   4. GET /watch.html?id=...    → legacy OG meta rewrite for crawlers
 *
 * Everything else passes through untouched.
 *
 * OG IMAGE DESIGN (1200×630):
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ [backdrop blurred, full bleed]                           │
 *   │ [dark gradient overlay]                                  │
 *   │         ┌──────┐                                        │
 *   │         │poster│  FILM TITLE                            │
 *   │         │      │  Year · Genre · IMDb ★                 │
 *   │         │      │  Description excerpt…                  │
 *   │         └──────┘  [ ▶ Watch Free   MOVXIO ]             │
 *   └──────────────────────────────────────────────────────────┘
 *
 *  Platform compatibility:
 *   WhatsApp  ✅  SVG composite  — blurred backdrop + poster + title
 *   Telegram  ✅  SVG composite  — same
 *   Discord   ✅  SVG composite  — same
 *   iMessage  ✅  SVG composite  — same
 *   X/Twitter ✅  SVG composite  — summary_large_image 1200×630
 *   Facebook  ⚠️  raster poster  — FB blocks cross-origin SVG, gets JPEG poster
 *   LinkedIn  ✅  SVG composite  — same as WhatsApp
 */

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://kncqgatjjcezlnwwikqm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtuY3FnYXRqamNlemxud3dpa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjUxMzMsImV4cCI6MjA5MDY0MTEzM30.irNGQnC6SlSq2ozVHToq1TnBAs_fKdukJMPmaMB1wyc';
const SITE_URL     = 'https://movxio.com';
const SITE_NAME    = 'MOVXIO';
const DEFAULT_IMG  = `${SITE_URL}/og-default.jpg`;

// OG image canvas — 1.91:1 is the universal social share ratio
const OG_W = 1200;
const OG_H = 630;

// ─────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────
function supaHeaders() {
  return {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Cache-Control': 'no-cache',
  };
}

function toISODate(str) {
  try { return new Date(str).toISOString().slice(0, 10); }
  catch { return new Date().toISOString().slice(0, 10); }
}

function escXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Safe escape for SVG text content and attribute values
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Wrap plain text into an array of lines for SVG <tspan> rendering
function wrapText(text, maxChars, maxLines) {
  const words  = String(text || '').split(/\s+/);
  const lines  = [];
  let   line   = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) break;
    } else {
      line = candidate;
    }
  }

  if (line && lines.length < maxLines) lines.push(line);

  // Add ellipsis to last line if text was truncated
  const rendered = lines.join(' ');
  if (text.length > rendered.length + 3 && lines.length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s?\S+$/, '…');
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────
// ROUTE 1 — SITEMAP
// ─────────────────────────────────────────────────────────────
const STATIC_PAGES = [
  { loc: '/',             changefreq: 'daily',   priority: '1.0' },
  { loc: '/browse.html',  changefreq: 'daily',   priority: '0.9' },
  { loc: '/search.html',  changefreq: 'weekly',  priority: '0.8' },
  { loc: '/about.html',   changefreq: 'monthly', priority: '0.5' },
  { loc: '/privacy.html', changefreq: 'monthly', priority: '0.3' },
  { loc: '/terms.html',   changefreq: 'monthly', priority: '0.3' },
  { loc: '/dmca.html',    changefreq: 'monthly', priority: '0.3' },
];

async function fetchAllFilms() {
  const films = [];
  let   offset = 0;
  const limit  = 1000;

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/films`
      + `?select=id,slug,created_at,updated_at`
      + `&status=eq.active`
      + `&order=created_at.desc`
      + `&limit=${limit}&offset=${offset}`;

    const res = await fetch(url, { headers: supaHeaders() });
    if (!res.ok) break;

    const batch = await res.json();
    if (!batch || !batch.length) break;

    films.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return films;
}

function buildSitemap(films) {
  const today = new Date().toISOString().slice(0, 10);

  const staticUrls = STATIC_PAGES.map(p => `
  <url>
    <loc>${SITE_URL}${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('');

  const filmUrls = films.map(f => `
  <url>
    <loc>${SITE_URL}${f.slug ? `/movie/${escXml(f.slug)}` : `/watch.html?id=${escXml(f.id)}`}</loc>
    <lastmod>${toISODate(f.updated_at || f.created_at)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">

  <!--
    MOVXIO Sitemap — auto-generated ${new Date().toISOString()}
    Static: ${STATIC_PAGES.length} | Films: ${films.length} | Total: ${STATIC_PAGES.length + films.length}
  -->
${staticUrls}
${filmUrls}
</urlset>`;
}

async function handleSitemap() {
  try {
    const films = await fetchAllFilms();
    const xml   = buildSitemap(films);
    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type':  'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'X-Films-Count': String(films.length),
      },
    });
  } catch {
    // Never 500 to Googlebot — serve minimal valid sitemap
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><priority>1.0</priority></url>
</urlset>`,
      { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
    );
  }
}

// ─────────────────────────────────────────────────────────────
// ROUTE 2 — DYNAMIC OG IMAGE   GET /og-image/:slug
// ─────────────────────────────────────────────────────────────
/**
 * Returns a 1200×630 SVG that composites:
 *
 *  Layer 1 — backdrop image, blurred + darkened (full bleed background)
 *  Layer 2 — dark gradient vignette overlay
 *  Layer 3 — poster image (left column, drop shadow, rounded corners)
 *  Layer 4 — text block (right column):
 *              · Film title (large, bold, wrapped)
 *              · Year · Genre · IMDb badge
 *              · Description excerpt (3 lines)
 *              · "▶ Watch Free" + MOVXIO wordmark
 *
 * All images are referenced by URL — the SVG <image> element fetches
 * them at render time inside the crawler's engine. No pixel processing
 * happens in the Worker — it's pure SVG layout.
 */
function buildOgSvg(film) {
  // ── Text content ──
  const title  = film.title || SITE_NAME;
  const year   = film.year ? String(film.year) : '';
  const genre  = film.genre
    ? film.genre.split(',').slice(0, 2).map(g => g.trim()).join(' · ')
    : '';
  const desc   = film.description
    || `Watch ${title} free on ${SITE_NAME} — no account, no subscription.`;

  // Title: large font, wrap at ~20 chars, max 2 lines
  const titleLines    = wrapText(title, 20, 2);
  const titleFontSize = title.length > 20 ? 54 : 62;
  const titleLineH    = titleFontSize * 1.2;

  // Description: smaller font, wrap at ~50 chars, max 3 lines
  const descLines = wrapText(desc, 50, 3);

  // ── Image sources ──
  const posterSrc   = esc(film.thumbnail_url || '');
  const backdropSrc = esc(film.backdrop_url || film.thumbnail_url || '');

  // ── Layout ──
  const posterX = 56;
  const posterY = 80;
  const posterW = 270;
  const posterH = 405;    // 2:3 poster ratio

  const textX   = 378;    // left edge of text column
  const textW   = OG_W - textX - 40;  // right padding

  // Vertical positions (top-down)
  const titleY  = 170;
  const metaY   = titleY + titleLines.length * titleLineH + 20;
  const imdbY   = metaY + 38;
  const descY   = imdbY + (film.imdb_rating ? 52 : 0);
  const badgeY  = OG_H - 64;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}">
  <defs>

    <!-- Backdrop blur -->
    <filter id="bgBlur" x="-8%" y="-8%" width="116%" height="116%">
      <feGaussianBlur stdDeviation="22"/>
    </filter>

    <!-- Poster drop shadow -->
    <filter id="posterShadow" x="-20%" y="-8%" width="150%" height="125%">
      <feDropShadow dx="0" dy="10" stdDeviation="18"
        flood-color="#000000" flood-opacity="0.75"/>
    </filter>

    <!-- Poster rounded rect clip -->
    <clipPath id="posterClip">
      <rect x="${posterX}" y="${posterY}"
        width="${posterW}" height="${posterH}" rx="12" ry="12"/>
    </clipPath>

    <!-- Full card clip (prevents anything bleeding outside) -->
    <clipPath id="cardClip">
      <rect width="${OG_W}" height="${OG_H}"/>
    </clipPath>

    <!-- Horizontal dark gradient: lighter left, solid dark right -->
    <linearGradient id="hGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#07070f" stop-opacity="0.45"/>
      <stop offset="30%"  stop-color="#07070f" stop-opacity="0.70"/>
      <stop offset="100%" stop-color="#07070f" stop-opacity="0.96"/>
    </linearGradient>

    <!-- Bottom edge fade to solid dark -->
    <linearGradient id="vGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="55%"  stop-color="#07070f" stop-opacity="0"/>
      <stop offset="100%" stop-color="#07070f" stop-opacity="0.82"/>
    </linearGradient>

    <!-- Text drop shadow for readability over busy backdrops -->
    <filter id="txtShadow" x="-4%" y="-10%" width="108%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="5"
        flood-color="#000000" flood-opacity="0.85"/>
    </filter>

  </defs>

  <g clip-path="url(#cardClip)">

    <!-- ════ LAYER 1: blurred backdrop ════ -->
    <rect width="${OG_W}" height="${OG_H}" fill="#07070f"/>
    ${backdropSrc
      ? `<image href="${backdropSrc}"
           x="-6%" y="-6%" width="112%" height="112%"
           preserveAspectRatio="xMidYMid slice"
           filter="url(#bgBlur)" opacity="0.50"/>`
      : ''}

    <!-- ════ LAYER 2: dark overlays ════ -->
    <rect width="${OG_W}" height="${OG_H}" fill="url(#hGrad)"/>
    <rect width="${OG_W}" height="${OG_H}" fill="url(#vGrad)"/>

    <!-- ════ LAYER 3: poster ════ -->
    ${posterSrc ? `
    <!-- Shadow rendered behind poster -->
    <image href="${posterSrc}"
      x="${posterX}" y="${posterY}"
      width="${posterW}" height="${posterH}"
      preserveAspectRatio="xMidYMid slice"
      filter="url(#posterShadow)"
      clip-path="url(#posterClip)"/>
    <!-- Poster image (clipped to rounded rect) -->
    <image href="${posterSrc}"
      x="${posterX}" y="${posterY}"
      width="${posterW}" height="${posterH}"
      preserveAspectRatio="xMidYMid slice"
      clip-path="url(#posterClip)"/>
    <!-- Subtle border around poster -->
    <rect x="${posterX}" y="${posterY}"
      width="${posterW}" height="${posterH}"
      rx="12" ry="12"
      fill="none" stroke="rgba(255,255,255,0.13)" stroke-width="1.5"/>
    ` : ''}

    <!-- ════ LAYER 4: text block ════ -->

    <!-- Film title (1–2 lines, large bold) -->
    ${titleLines.map((line, i) => `
    <text
      x="${textX}" y="${titleY + i * titleLineH}"
      font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
      font-size="${titleFontSize}"
      font-weight="800"
      fill="#f0eee8"
      letter-spacing="-1.2"
      filter="url(#txtShadow)">${esc(line)}</text>`).join('')}

    <!-- Meta line: year · genre -->
    ${(year || genre) ? `
    <text
      x="${textX}" y="${metaY}"
      font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
      font-size="21"
      font-weight="400"
      fill="rgba(175,173,195,0.90)"
      letter-spacing="0.2">${esc([year, genre].filter(Boolean).join('  ·  '))}</text>
    ` : ''}

    <!-- IMDb rating pill -->
    ${film.imdb_rating ? `
    <rect x="${textX}" y="${imdbY - 22}" width="94" height="30" rx="5" fill="#f5c842"/>
    <text
      x="${textX + 10}" y="${imdbY - 2}"
      font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
      font-size="13" font-weight="700" fill="#000" letter-spacing="0.4">IMDb</text>
    <text
      x="${textX + 54}" y="${imdbY - 2}"
      font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
      font-size="13" font-weight="700" fill="#1a1a00">${esc(String(film.imdb_rating))}</text>
    ` : ''}

    <!-- Description (up to 3 lines) -->
    ${descLines.map((line, i) => `
    <text
      x="${textX}" y="${descY + i * 30}"
      font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
      font-size="19"
      font-weight="300"
      fill="rgba(195,193,215,0.80)">${esc(line)}</text>`).join('')}

    <!-- ── Bottom badge row ── -->

    <!-- Red play circle -->
    <circle cx="${textX + 19}" cy="${badgeY}" r="19" fill="#e8473f"/>
    <!-- Play triangle -->
    <polygon
      points="${textX + 11},${badgeY - 9} ${textX + 32},${badgeY} ${textX + 11},${badgeY + 9}"
      fill="#ffffff"/>

    <!-- "Watch Free" label -->
    <text
      x="${textX + 50}" y="${badgeY + 7}"
      font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
      font-size="22" font-weight="600"
      fill="#f0eee8" letter-spacing="0.1">Watch Free</text>

    <!-- Separator -->
    <circle cx="${textX + 200}" cy="${badgeY}" r="3" fill="rgba(255,255,255,0.28)"/>

    <!-- MOVXIO wordmark: MOV in muted white, XIO in accent red -->
    <text
      x="${textX + 216}" y="${badgeY + 7}"
      font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
      font-size="22" font-weight="800"
      fill="rgba(240,238,232,0.45)" letter-spacing="1.5">MOV</text>
    <text
      x="${textX + 278}" y="${badgeY + 7}"
      font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
      font-size="22" font-weight="800"
      fill="#e8473f" letter-spacing="1.5">XIO</text>

    <!-- Top-right domain watermark -->
    <text
      x="${OG_W - 22}" y="34"
      text-anchor="end"
      font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
      font-size="15" font-weight="400"
      fill="rgba(255,255,255,0.22)" letter-spacing="0.4">movxio.com</text>

  </g>
</svg>`;
}

async function handleOgImage(slug) {
  try {
    const film = await fetchFilmBySlug(slug);
    if (!film) return Response.redirect(DEFAULT_IMG, 302);

    const svg = buildOgSvg(film);
    return new Response(svg, {
      status: 200,
      headers: {
        'Content-Type':  'image/svg+xml',
        // 1 hr browser cache, 6 hr edge cache — balances speed vs freshness
        'Cache-Control': 'public, max-age=3600, s-maxage=21600',
        'Vary':          'Accept',
        'X-Film-Slug':   slug,
      },
    });
  } catch {
    return Response.redirect(DEFAULT_IMG, 302);
  }
}

// ─────────────────────────────────────────────────────────────
// ROUTES 3 & 4 — DYNAMIC OG META (HTML rewrite for crawlers)
// ─────────────────────────────────────────────────────────────
const CRAWLER_UA = [
  'facebookexternalhit', 'facebot', 'twitterbot', 'whatsapp',
  'telegrambot', 'linkedinbot', 'slackbot', 'discordbot',
  'googlebot', 'bingbot', 'applebot', 'pinterest',
  'vkshare', 'ia_archiver', 'bytespider',
];

// Facebook fetches og:image but blocks cross-origin SVG — detect separately
const FB_UA = ['facebookexternalhit', 'facebot'];

function isCrawler(ua) {
  if (!ua) return false;
  const u = ua.toLowerCase();
  return CRAWLER_UA.some(p => u.includes(p));
}

function isFacebook(ua) {
  if (!ua) return false;
  const u = ua.toLowerCase();
  return FB_UA.some(p => u.includes(p));
}

async function fetchFilm(id) {
  const url = `${SUPABASE_URL}/rest/v1/films`
    + `?id=eq.${encodeURIComponent(id)}`
    + `&select=id,slug,title,description,thumbnail_url,backdrop_url,genre,year,imdb_rating`
    + `&limit=1`;
  const res = await fetch(url, { headers: supaHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows && rows.length ? rows[0] : null;
}

async function fetchFilmBySlug(slug) {
  const url = `${SUPABASE_URL}/rest/v1/films`
    + `?slug=eq.${encodeURIComponent(slug)}`
    + `&select=id,slug,title,description,thumbnail_url,backdrop_url,genre,year,imdb_rating`
    + `&limit=1`;
  const res = await fetch(url, { headers: supaHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows && rows.length ? rows[0] : null;
}

class OGRewriter {
  constructor(film, ua) {
    const title  = film.title || SITE_NAME;
    const year   = film.year  ? ` (${film.year})` : '';
    const rating = film.imdb_rating ? ` · ★${film.imdb_rating}` : '';
    const genre  = film.genre ? film.genre.split(',')[0].trim() : '';
    const desc   = film.description
      ? film.description.slice(0, 160)
      : `Watch ${title} free on ${SITE_NAME} — no account needed.`;
    const watchUrl = film.slug
      ? `${SITE_URL}/movie/${film.slug}`
      : `${SITE_URL}/watch.html?id=${film.id}`;

    // ── OG image selection per platform ──────────────────────
    //
    //  Facebook   → raster poster (FB blocks cross-origin SVG images)
    //               dimensions: 600×900 (portrait OK for FB)
    //
    //  Everyone   → /og-image/:slug composite SVG
    //  else         dimensions: 1200×630 (universal landscape ratio)
    //
    const fb      = isFacebook(ua);
    const ogImage = fb
      ? (film.thumbnail_url || DEFAULT_IMG)
      : (film.slug
          ? `${SITE_URL}/og-image/${film.slug}`
          : (film.thumbnail_url || DEFAULT_IMG));

    const ogW = fb ? '600'  : '1200';
    const ogH = fb ? '900'  : '630';

    this.data = {
      pageTitle:         `${title}${year} — Watch Free on ${SITE_NAME}`,
      description:       desc,
      keywords:          `${title}, watch free, ${genre}, ${SITE_NAME}, free movies`,
      'og:title':        `${title}${year} — ${SITE_NAME}`,
      'og:description':  desc,
      'og:image':        ogImage,
      'og:image:width':  ogW,
      'og:image:height': ogH,
      'og:image:alt':    `${title} — Watch free on ${SITE_NAME}`,
      'og:url':          watchUrl,
      'og:type':         'video.movie',
      'og:site_name':    SITE_NAME,
      'twitter:card':        'summary_large_image',
      'twitter:title':       `${title}${year}${rating}`,
      'twitter:description': desc,
      'twitter:image':       ogImage,
      'twitter:image:alt':   `${title} — Watch free on ${SITE_NAME}`,
      canonical: watchUrl,
    };
  }

  element(el) {
    const tag = el.tagName.toLowerCase();
    const d   = this.data;

    if (tag === 'title') {
      el.setInnerContent(d.pageTitle);
      return;
    }

    if (tag === 'meta') {
      const name = el.getAttribute('name')     || '';
      const prop = el.getAttribute('property') || '';

      if (name === 'description')           el.setAttribute('content', d.description);
      if (name === 'keywords')              el.setAttribute('content', d.keywords);
      if (name === 'twitter:card')          el.setAttribute('content', d['twitter:card']);
      if (name === 'twitter:title')         el.setAttribute('content', d['twitter:title']);
      if (name === 'twitter:description')   el.setAttribute('content', d['twitter:description']);
      if (name === 'twitter:image')         el.setAttribute('content', d['twitter:image']);
      if (name === 'twitter:image:alt')     el.setAttribute('content', d['twitter:image:alt']);

      if (prop === 'og:title')              el.setAttribute('content', d['og:title']);
      if (prop === 'og:description')        el.setAttribute('content', d['og:description']);
      if (prop === 'og:image')              el.setAttribute('content', d['og:image']);
      if (prop === 'og:image:width')        el.setAttribute('content', d['og:image:width']);
      if (prop === 'og:image:height')       el.setAttribute('content', d['og:image:height']);
      if (prop === 'og:image:alt')          el.setAttribute('content', d['og:image:alt']);
      if (prop === 'og:url')                el.setAttribute('content', d['og:url']);
      if (prop === 'og:type')               el.setAttribute('content', d['og:type']);
      if (prop === 'og:site_name')          el.setAttribute('content', d['og:site_name']);
    }

    if (tag === 'link' && el.getAttribute('rel') === 'canonical') {
      el.setAttribute('href', d.canonical);
    }
  }
}

async function handleWatchOG(request, film, env) {
  const ua      = request.headers.get('user-agent') || '';
  const page    = await env.ASSETS.fetch(request);
  if (!page.ok) return page;

  // Single instance shared across all selectors — avoids 4x constructor overhead
  const rewriter = new OGRewriter(film, ua);
  return new HTMLRewriter()
    .on('title',                 rewriter)
    .on('meta[name]',            rewriter)
    .on('meta[property]',        rewriter)
    .on('link[rel="canonical"]', rewriter)
    .transform(page);
}

// ─────────────────────────────────────────────────────────────
// MAIN ROUTER
// ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // ── Route 1: Sitemap ──────────────────────────────────────
    if (path === '/sitemap.xml' && method === 'GET') {
      return handleSitemap();
    }

    // ── Route 2: OG image composite ───────────────────────────
    // GET /og-image/:slug  →  1200×630 SVG (backdrop + poster + text)
    const ogMatch = path.match(/^\/og-image\/([^/]+)\/?$/);
    if (ogMatch && method === 'GET') {
      return handleOgImage(decodeURIComponent(ogMatch[1]));
    }

    const ua = request.headers.get('user-agent') || '';

    // ── Route 3: /movie/:slug — pretty URL, crawlers only ─────
    const movieMatch = path.match(/^\/movie\/([^/]+)\/?$/);
    if (movieMatch && method === 'GET' && isCrawler(ua)) {
      const slug = decodeURIComponent(movieMatch[1]);
      const film = await fetchFilmBySlug(slug).catch(() => null);
      if (film) {
        // Serve watch.html shell with rewritten OG tags
        const watchReq = new Request(`${url.origin}/watch.html`, request);
        return handleWatchOG(watchReq, film, env);
      }
    }

    // ── Route 4: /watch.html?id= — legacy, crawlers only ──────
    const isWatch = path === '/watch.html' || path === '/watch' || path === '/watch/';
    if (isWatch && method === 'GET' && isCrawler(ua)) {
      const filmId = url.searchParams.get('id');
      if (filmId) {
        const film = await fetchFilm(filmId).catch(() => null);
        if (film) return handleWatchOG(request, film, env);
      }
    }

    // ── Everything else: Cloudflare Pages static assets ───────
    return env.ASSETS.fetch(request);
  },
};
