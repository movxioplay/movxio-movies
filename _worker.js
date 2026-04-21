/**
 * MOVXIO — Cloudflare Pages Edge Worker  (v2 — slug routing)
 *
 * New routes added:
 *   GET /film/:slug          → serves watch.html with dynamic OG meta
 *   GET /watch.html?id=UUID   → 301 redirect to /film/:slug
 *
 * Existing routes unchanged:
 *   GET /sitemap.xml          → auto-generated sitemap
 *   Everything else           → pass-through to Pages static assets
 */

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://kncqgatjjcezlnwwikqm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtuY3FnYXRqamNlemxud3dpa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjUxMzMsImV4cCI6MjA5MDY0MTEzM30.irNGQnC6SlSq2ozVHToq1TnBAs_fKdukJMPmaMB1wyc';
const SITE_URL     = 'https://movxio.com';
const SITE_NAME    = 'MOVXIO';
const DEFAULT_IMG  = `${SITE_URL}/og-default.jpg`;

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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─────────────────────────────────────────────────────────────
// SUPABASE FILM FETCHERS
// ─────────────────────────────────────────────────────────────

/** Fetch a single film by its UUID (used for legacy ?id= redirect) */
async function fetchFilmById(id) {
  const url = `${SUPABASE_URL}/rest/v1/films`
    + `?id=eq.${encodeURIComponent(id)}`
    + `&select=id,title,slug,description,thumbnail_url,genre,year,imdb_rating`
    + `&limit=1`;
  const res = await fetch(url, { headers: supaHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return data && data.length ? data[0] : null;
}

/** Fetch a single film by its slug (used for /film/:slug route) */
async function fetchFilmBySlug(slug) {
  const url = `${SUPABASE_URL}/rest/v1/films`
    + `?slug=eq.${encodeURIComponent(slug)}`
    + `&select=id,title,slug,description,thumbnail_url,genre,year,imdb_rating`
    + `&limit=1`;
  const res = await fetch(url, { headers: supaHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return data && data.length ? data[0] : null;
}

/** Fetch all films for sitemap */
async function fetchAllFilms() {
  const films = [];
  let offset  = 0;
  const limit = 1000;
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

// ─────────────────────────────────────────────────────────────
// ROUTE: LEGACY REDIRECT  /watch.html?id=UUID → /film/:slug
// ─────────────────────────────────────────────────────────────
async function handleLegacyWatchRedirect(filmId, originalUrl) {
  try {
    // Short-circuit obviously invalid IDs (e.g. 'featured', 'undefined', empty)
    if (!filmId || filmId === 'featured' || filmId === 'undefined' || filmId.length < 8) {
      return Response.redirect(`${SITE_URL}/browse.html`, 302);
    }

    const film = await fetchFilmById(filmId);

    if (film && film.slug) {
      // Preserve episode params if present (series support)
      const inUrl  = new URL(originalUrl);
      const season = inUrl.searchParams.get('season');
      const ep     = inUrl.searchParams.get('ep');

      let target = `${SITE_URL}/film/${film.slug}`;
      const extra = new URLSearchParams();
      if (season) extra.set('season', season);
      if (ep)     extra.set('ep', ep);
      if ([...extra].length) target += `?${extra.toString()}`;

      return Response.redirect(target, 301);
    }

    // Film not found or no slug yet — redirect to browse rather than 404
    return Response.redirect(`${SITE_URL}/browse.html`, 302);
  } catch {
    // On any error fall through to static asset serving
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// ROUTE: /film/:slug  — serves watch.html with rewritten OG meta
// ─────────────────────────────────────────────────────────────

const CRAWLER_UA = [
  'facebookexternalhit', 'twitterbot', 'whatsapp', 'telegrambot',
  'linkedinbot', 'slackbot', 'discordbot', 'googlebot', 'bingbot',
  'applebot', 'pinterest', 'vkshare', 'ia_archiver', 'bytespider',
];

function isCrawler(ua) {
  if (!ua) return false;
  const u = ua.toLowerCase();
  return CRAWLER_UA.some(p => u.includes(p));
}

class OGRewriter {
  constructor(film, canonicalUrl) {
    const title  = film.title || SITE_NAME;
    const year   = film.year        ? ` (${film.year})`      : '';
    const rating = film.imdb_rating ? ` · ★${film.imdb_rating}` : '';
    const genre  = film.genre       ? film.genre.split(',')[0].trim() : '';
    const desc   = film.description
      ? film.description.slice(0, 160)
      : `Watch ${title} free on ${SITE_NAME} — no account needed.`;
    const image  = film.thumbnail_url || DEFAULT_IMG;

    this.data = {
      pageTitle:           `${title}${year} — Watch Online Free | ${SITE_NAME}`,
      description:         desc,
      'og:title':          `${title}${year} — ${SITE_NAME}`,
      'og:description':    desc,
      'og:image':          image,
      'og:image:width':    '600',
      'og:image:height':   '900',
      'og:image:alt':      `${title} poster`,
      'og:url':            canonicalUrl,
      'og:type':           'video.movie',
      'og:site_name':      SITE_NAME,
      'twitter:card':        'summary_large_image',
      'twitter:title':       `${title}${year}${rating}`,
      'twitter:description': desc,
      'twitter:image':       image,
      'twitter:image:alt':   `${title} poster`,
      canonical:    canonicalUrl,
      keywords:     `${title}, watch free, ${genre}, ${SITE_NAME}, free movies`,
    };
  }

  element(el) {
    const tag = el.tagName.toLowerCase();
    const d   = this.data;

    if (tag === 'title') { el.setInnerContent(d.pageTitle); return; }

    if (tag === 'meta') {
      const name = el.getAttribute('name')     || '';
      const prop = el.getAttribute('property') || '';
      if (name === 'description')          el.setAttribute('content', d.description);
      if (name === 'keywords')             el.setAttribute('content', d.keywords);
      if (name === 'twitter:card')         el.setAttribute('content', d['twitter:card']);
      if (name === 'twitter:title')        el.setAttribute('content', d['twitter:title']);
      if (name === 'twitter:description')  el.setAttribute('content', d['twitter:description']);
      if (name === 'twitter:image')        el.setAttribute('content', d['twitter:image']);
      if (name === 'twitter:image:alt')    el.setAttribute('content', d['twitter:image:alt']);
      if (prop === 'og:title')             el.setAttribute('content', d['og:title']);
      if (prop === 'og:description')       el.setAttribute('content', d['og:description']);
      if (prop === 'og:image')             el.setAttribute('content', d['og:image']);
      if (prop === 'og:image:width')       el.setAttribute('content', d['og:image:width']);
      if (prop === 'og:image:height')      el.setAttribute('content', d['og:image:height']);
      if (prop === 'og:image:alt')         el.setAttribute('content', d['og:image:alt']);
      if (prop === 'og:url')               el.setAttribute('content', d['og:url']);
      if (prop === 'og:type')              el.setAttribute('content', d['og:type']);
      if (prop === 'og:site_name')         el.setAttribute('content', d['og:site_name']);
    }

    if (tag === 'link' && el.getAttribute('rel') === 'canonical') {
      el.setAttribute('href', d.canonical);
    }
  }
}

async function handleMovieSlug(request, slug, env) {
  const canonicalUrl = `${SITE_URL}/film/${slug}`;

  // Serve the static watch.html as the base page
  const watchRequest = new Request(`${SITE_URL}/watch.html`, {
    headers: request.headers,
    method:  request.method,
  });
  const page = await env.ASSETS.fetch(watchRequest);
  if (!page.ok) return page;

  // For regular users: still rewrite OG + title (good for Googlebot & share previews)
  // but don't await a Supabase call on the hot path — only crawlers block on it.
  const ua = request.headers.get('user-agent') || '';

  if (isCrawler(ua)) {
    // Crawlers: fetch film data and rewrite meta tags server-side
    const film = await fetchFilmBySlug(slug).catch(() => null);
    if (film) {
      const rewriter = new OGRewriter(film, canonicalUrl);
      return new HTMLRewriter()
        .on('title',                 rewriter)
        .on('meta[name]',            rewriter)
        .on('meta[property]',        rewriter)
        .on('link[rel="canonical"]', rewriter)
        .transform(page);
    }
  }

  // Regular users: serve watch.html instantly; client JS handles meta + content.
  // We still fix the canonical URL via a lightweight HTMLRewriter (no Supabase call).
  return new HTMLRewriter()
    .on('link[rel="canonical"]', {
      element(el) { el.setAttribute('href', canonicalUrl); }
    })
    .on('meta[property="og:url"]', {
      element(el) { el.setAttribute('content', canonicalUrl); }
    })
    .transform(page);
}

// ─────────────────────────────────────────────────────────────
// ROUTE: SITEMAP (unchanged from v1, updated to use slug URLs)
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

function buildSitemap(films) {
  const today = new Date().toISOString().slice(0, 10);

  const staticUrls = STATIC_PAGES.map(p => `
  <url>
    <loc>${SITE_URL}${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('');

  // Use /film/:slug URLs — much better for SEO than ?id=UUID
  const filmUrls = films
    .filter(f => f.slug) // skip any films without slug (shouldn't happen after migration)
    .map(f => `
  <url>
    <loc>${SITE_URL}/film/${escXml(f.slug)}</loc>
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

    // ── Route 2: Legacy redirect  /watch.html?id=UUID ─────────
    // Must check BEFORE the /watch static pass-through below.
    const isWatchPage = path === '/watch.html' || path === '/watch' || path === '/watch/';
    if (isWatchPage && method === 'GET') {
      const filmId = url.searchParams.get('id');
      if (filmId) {
        const redirect = await handleLegacyWatchRedirect(filmId, request.url);
        if (redirect) return redirect;
        // If redirect failed (DB error), fall through to static asset
      }
    }

    // ── Route 3: Bare /film — redirect to browse ─────────────
    if ((path === '/film' || path === '/film/') && method === 'GET') {
      return Response.redirect(`${SITE_URL}/browse.html`, 302);
    }

    // ── Route 4: Clean movie URL  /film/:slug ─────────────────
    // Slug must be lowercase letters, numbers, hyphens only.
    // This prevents /film/browse.html, /film/index.html etc.
    // from being treated as film slugs.
    const movieMatch = path.match(/^\/film\/([a-z0-9][a-z0-9-]*)\/?$/);
    if (movieMatch && method === 'GET') {
      const slug = movieMatch[1];
      if (slug) return handleMovieSlug(request, slug, env);
    }

    // ── Everything else: serve static files from Pages ────────
    return env.ASSETS.fetch(request);
  },
};
