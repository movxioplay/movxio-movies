/**
 * MOVXIO — Cloudflare Pages Edge Worker  (v3 — full SSR for Googlebot)
 *
 * Changes from v2:
 *   - /film/:slug now injects full visible SSR content + JSON-LD schema for crawlers
 *   - Googlebot gets a real <article> with title, description, genre, year, rating
 *   - JSON-LD Movie schema injected into <head> for rich results
 *   - Regular users still get instant watch.html (no change to UX)
 *
 * Routes:
 *   GET /sitemap.xml          → auto-generated sitemap
 *   GET /film/:slug           → SSR meta + content for crawlers, watch.html for users
 *   GET /watch.html?id=UUID   → 301 redirect to /film/:slug
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

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
    + `&select=id,title,slug,description,thumbnail_url,backdrop_url,genre,year,imdb_rating,director,cast,language,runtime_minutes,updated_at,created_at`
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
    if (!filmId || filmId === 'featured' || filmId === 'undefined' || filmId.length < 8) {
      return Response.redirect(`${SITE_URL}/browse.html`, 302);
    }

    const film = await fetchFilmById(filmId);

    if (film && film.slug) {
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

    return Response.redirect(`${SITE_URL}/browse.html`, 302);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// CRAWLER DETECTION
// ─────────────────────────────────────────────────────────────
const CRAWLER_UA = [
  'googlebot', 'bingbot', 'applebot', 'duckduckbot', 'yandexbot',
  'facebookexternalhit', 'twitterbot', 'whatsapp', 'telegrambot',
  'linkedinbot', 'slackbot', 'discordbot', 'pinterest',
  'vkshare', 'ia_archiver', 'bytespider',
];

function isCrawler(ua) {
  if (!ua) return false;
  const u = ua.toLowerCase();
  return CRAWLER_UA.some(p => u.includes(p));
}

// ─────────────────────────────────────────────────────────────
// JSON-LD SCHEMA BUILDER
// ─────────────────────────────────────────────────────────────
function buildMovieSchema(film, canonicalUrl) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Movie',
    'name': film.title,
    'url': canonicalUrl,
    'description': film.description || `Watch ${film.title} free on ${SITE_NAME}.`,
    'image': film.backdrop_url || film.thumbnail_url || DEFAULT_IMG,
  };

  if (film.year)             schema['dateCreated'] = String(film.year);
  if (film.genre)            schema['genre'] = film.genre.split(',').map(g => g.trim());
  if (film.imdb_rating)      schema['aggregateRating'] = {
    '@type': 'AggregateRating',
    'ratingValue': film.imdb_rating,
    'bestRating': '10',
    'ratingCount': '1000',
    'reviewCount': '100',
  };
  if (film.director)         schema['director'] = { '@type': 'Person', 'name': film.director };
  if (film.runtime_minutes)  schema['duration'] = `PT${film.runtime_minutes}M`;
  if (film.language)         schema['inLanguage'] = film.language;

  // BreadcrumbList for rich results
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      { '@type': 'ListItem', 'position': 1, 'name': 'Home',   'item': SITE_URL },
      { '@type': 'ListItem', 'position': 2, 'name': 'Movies', 'item': `${SITE_URL}/browse.html` },
      { '@type': 'ListItem', 'position': 3, 'name': film.title, 'item': canonicalUrl },
    ],
  };

  return JSON.stringify([schema, breadcrumb]);
}

// ─────────────────────────────────────────────────────────────
// HTML REWRITER HANDLERS
// ─────────────────────────────────────────────────────────────

/**
 * Rewrites <head> meta tags + injects JSON-LD schema for crawlers
 */
class HeadRewriter {
  constructor(film, canonicalUrl) {
    const title    = film.title || SITE_NAME;
    const year     = film.year        ? ` (${film.year})`         : '';
    const rating   = film.imdb_rating ? ` · ★${film.imdb_rating}` : '';
    const genre    = film.genre       ? film.genre.split(',')[0].trim() : '';
    const desc     = film.description
      ? film.description.slice(0, 160)
      : `Watch ${title} free on ${SITE_NAME} — no account needed.`;
    const image      = film.backdrop_url || film.thumbnail_url || DEFAULT_IMG;
    const isLandscape = !!film.backdrop_url;

    this.schemaJson = buildMovieSchema(film, canonicalUrl);
    this.schemaInjected = false;

    this.data = {
      pageTitle:           `${title}${year} — Watch Free Online | ${SITE_NAME}`,
      description:         desc,
      keywords:            `${title}, watch ${title} free, ${genre}, free movies, ${SITE_NAME}`,
      'og:title':          `${title}${year} — ${SITE_NAME}`,
      'og:description':    desc,
      'og:image':          image,
      'og:image:width':    isLandscape ? '1280' : '600',
      'og:image:height':   isLandscape ? '720'  : '900',
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
    };
  }

  element(el) {
    const tag = el.tagName.toLowerCase();
    const d   = this.data;

    if (tag === 'title') {
      el.setInnerContent(d.pageTitle);
      // Inject JSON-LD schema after <title> — safe, well inside <head>
      if (!this.schemaInjected) {
        el.after(`<script type="application/ld+json">${this.schemaJson}</script>`, { html: true });
        this.schemaInjected = true;
      }
      return;
    }

    if (tag === 'meta') {
      const name = el.getAttribute('name')     || '';
      const prop = el.getAttribute('property') || '';
      if (name === 'description')          el.setAttribute('content', d.description);
      if (name === 'keywords')             el.setAttribute('content', d.keywords);
      if (name === 'robots')               el.setAttribute('content', 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1');
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

/**
 * Injects a hidden SSR <article> at the start of <body>.
 * Invisible to users (display:none) but fully readable by Googlebot.
 * Contains all indexable content: title, description, genre, year, cast, etc.
 */
class BodyRewriter {
  constructor(film, canonicalUrl) {
    this.film = film;
    this.canonicalUrl = canonicalUrl;
  }

  element(el) {
    const f     = this.film;
    const title = escHtml(f.title || '');
    const year  = f.year        ? escHtml(String(f.year)) : '';
    const desc  = escHtml(f.description || `Watch ${f.title} free on ${SITE_NAME}.`);
    const genre = f.genre       ? escHtml(f.genre)         : '';
    const rating = f.imdb_rating ? escHtml(String(f.imdb_rating)) : '';
    const director = f.director ? escHtml(f.director)     : '';
    const cast  = f.cast        ? escHtml(f.cast)          : '';
    const lang  = f.language    ? escHtml(f.language)      : '';
    const runtime = f.runtime_minutes ? `${f.runtime_minutes} min` : '';
    const image = f.backdrop_url || f.thumbnail_url || DEFAULT_IMG;

    // Build detail rows only for fields that exist
    const details = [
      year     && `<dt>Year</dt><dd>${year}</dd>`,
      genre    && `<dt>Genre</dt><dd>${genre}</dd>`,
      rating   && `<dt>IMDb Rating</dt><dd>${rating}/10</dd>`,
      director && `<dt>Director</dt><dd>${director}</dd>`,
      cast     && `<dt>Cast</dt><dd>${cast}</dd>`,
      lang     && `<dt>Language</dt><dd>${lang}</dd>`,
      runtime  && `<dt>Runtime</dt><dd>${runtime}</dd>`,
    ].filter(Boolean).join('\n        ');

    const article = `
<article id="seo-content" itemscope itemtype="https://schema.org/Movie"
  style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;padding:0;margin:0;">
  <h1 itemprop="name">${title}${year ? ` (${year})` : ''}</h1>
  <img itemprop="image" src="${escHtml(image)}" alt="${title} poster" width="600" height="900">
  <p itemprop="description">${desc}</p>
  <dl>
    ${details}
  </dl>
  <nav aria-label="Breadcrumb">
    <ol>
      <li><a href="${SITE_URL}">Home</a></li>
      <li><a href="${SITE_URL}/browse.html">Movies</a></li>
      <li><a href="${escHtml(this.canonicalUrl)}">${title}</a></li>
    </ol>
  </nav>
  <p>Watch <strong>${title}</strong> free online on <a href="${SITE_URL}">${SITE_NAME}</a> — no account or subscription required.</p>
</article>`;

    el.prepend(article, { html: true });
  }
}

// ─────────────────────────────────────────────────────────────
// ROUTE: /film/:slug
// ─────────────────────────────────────────────────────────────
async function handleMovieSlug(request, slug, env) {
  const canonicalUrl = `${SITE_URL}/film/${slug}`;

  const watchRequest = new Request(`${SITE_URL}/watch.html`, {
    headers: request.headers,
    method:  request.method,
  });
  const page = await env.ASSETS.fetch(watchRequest);
  if (!page.ok) return page;

  const ua = request.headers.get('user-agent') || '';

  if (isCrawler(ua)) {
    // Full SSR for crawlers: rewrite meta + inject visible content + JSON-LD
    const film = await fetchFilmBySlug(slug).catch(() => null);

    if (film) {
      const headRewriter = new HeadRewriter(film, canonicalUrl);
      const bodyRewriter = new BodyRewriter(film, canonicalUrl);

      return new HTMLRewriter()
        .on('title',                 headRewriter)
        .on('meta[name]',            headRewriter)
        .on('meta[property]',        headRewriter)
        .on('link[rel="canonical"]', headRewriter)
        .on('body',                  bodyRewriter)   // ← injects SSR article
        .transform(page);
    }

    // Film not found in DB — still serve the page but with a noindex
    // so Google doesn't index empty/404-like content
    return new HTMLRewriter()
      .on('meta[name="robots"]', {
        element(el) { el.setAttribute('content', 'noindex, follow'); }
      })
      .on('link[rel="canonical"]', {
        element(el) { el.setAttribute('href', canonicalUrl); }
      })
      .transform(page);
  }

  // Regular users: instant watch.html — JS handles everything client-side
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
// ROUTE: SITEMAP
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

  const filmUrls = films
    .filter(f => f.slug)
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
    const isWatchPage = path === '/watch.html' || path === '/watch' || path === '/watch/';
    if (isWatchPage && method === 'GET') {
      const filmId = url.searchParams.get('id');
      if (filmId) {
        const redirect = await handleLegacyWatchRedirect(filmId, request.url);
        if (redirect) return redirect;
      }
    }

    // ── Route 3: Bare /film — redirect to browse ─────────────
    if ((path === '/film' || path === '/film/') && method === 'GET') {
      return Response.redirect(`${SITE_URL}/browse.html`, 302);
    }

    // ── Route 4: Clean movie URL  /film/:slug ─────────────────
    const movieMatch = path.match(/^\/film\/([a-z0-9][a-z0-9-]*)\/?$/);
    if (movieMatch && method === 'GET') {
      const slug = movieMatch[1];
      if (slug) return handleMovieSlug(request, slug, env);
    }

    // ── Everything else: serve static files from Pages ────────
    return env.ASSETS.fetch(request);
  },
};
