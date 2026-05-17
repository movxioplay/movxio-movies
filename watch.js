const CONFIG = {
  SUPABASE_URL:  localStorage.getItem('cv_url')    || 'https://kncqgatjjcezlnwwikqm.supabase.co',
  SUPABASE_KEY:  localStorage.getItem('cv_key')    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtuY3FnYXRqamNlemxud3dpa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjUxMzMsImV4cCI6MjA5MDY0MTEzM30.irNGQnC6SlSq2ozVHToq1TnBAs_fKdukJMPmaMB1wyc',
  WORKER_URL:    localStorage.getItem('cv_worker') || 'https://worker.movxio.com',
  SAVE_INTERVAL: 10,
};

// ── Flush any reports saved to localStorage while offline ──────
(async function flushPendingReports() {
  const pending = JSON.parse(localStorage.getItem('mvx_pending_reports') || '[]');
  if (!pending.length) return;
  const sent = [];
  for (const report of pending) {
    try {
      const res = await fetch(CONFIG.SUPABASE_URL + '/rest/v1/reports', {
        method: 'POST',
        headers: {
          'apikey':        CONFIG.SUPABASE_KEY,
          'Authorization': 'Bearer ' + CONFIG.SUPABASE_KEY,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify(report),
      });
      if (res.ok) sent.push(report);
    } catch { /* still offline — leave for next time */ }
  }
  if (sent.length) {
    const remaining = pending.filter(r => !sent.includes(r));
    localStorage.setItem('mvx_pending_reports', JSON.stringify(remaining));
    console.log('[MOVXIO] Flushed', sent.length, 'pending report(s).');
  }
})();

const DEMO = [
  { id:'demo1', title:'The Open Road',   year:2023, genre:'Drama,Thriller', language:'English', country:'United States', featured:true,  thumbnail_url:'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&q=80', description:'A breathtaking road trip that changes the lives of two strangers forever. When an unlikely pair hit the open highway, they discover the journey itself holds more meaning than any destination.', hls_url:null, subtitles:[], views:142, imdb_rating:7.2, director:'Alex Rivers', actors:'Tom Bradley, Sara Kim', content_rating:'PG-13' },
  { id:'demo2', title:'City Lights',     year:2022, genre:'Romance',        language:'English', country:'United Kingdom', featured:true,  thumbnail_url:'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=800&q=80', description:'Love found in unexpected places amid the neon glow of the city. Two strangers, one chance encounter, a story that will stay with you forever.', hls_url:null, subtitles:[], views:98,  imdb_rating:6.8, content_rating:'PG' },
  { id:'demo3', title:'Deep Waters',     year:2023, genre:'Thriller',       language:'English', country:'United States', featured:false, thumbnail_url:'https://images.unsplash.com/photo-1518929458119-e5bf444c30f4?w=800&q=80', description:'Nothing is as it seems beneath the surface. A marine biologist uncovers a conspiracy that puts her life in danger.', hls_url:null, subtitles:[], views:210, imdb_rating:7.8, content_rating:'R' },
  { id:'demo4', title:'Into The Wild',   year:2021, genre:'Documentary',    language:'English', country:'Canada',        featured:true,  thumbnail_url:'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&q=80', description:'Nature at its most raw and untamed. An extraordinary journey through the worlds most remote wilderness areas.', hls_url:null, subtitles:[], views:54,  imdb_rating:8.1, content_rating:'PG' },
];
const PLACEHOLDERS = ['placeholder-1','placeholder-2','placeholder-3','placeholder-4'];

function esc(s) { if(!s)return''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatDur(s) { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h>0?`${h}h ${m}m`:`${m}m`; }
function formatTime(s) { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60); if(h>0)return`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; return`${m}:${String(sec).padStart(2,'0')}`; }

// ── Resolve film identifier from URL ──────────────────────────
// Supports /film/:slug (new) and /watch.html?id=UUID (legacy)
function getFilmIdentifier() {
  const slugMatch = location.pathname.match(/^\/film\/([a-z0-9][a-z0-9-]*)\/?$/);
  if (slugMatch) return { type: 'slug', value: slugMatch[1] };
  const id = new URLSearchParams(location.search).get('id');
  if (id) return { type: 'id', value: id };
  return null;
}
const filmIdentifier = getFilmIdentifier();
// Keep filmId for any legacy references still in the page
const filmId = filmIdentifier ? filmIdentifier.value : null;
console.log('[MOVXIO] watch.html | URL:', location.href, '| identifier:', filmIdentifier);

let player = null;
let currentFilm = null;
let controlsTimer = null;
let isDragging = false;
let _necFired = false;

// ── Update page meta tags (title, OG, canonical) ──────────────
function updatePageMeta(film) {
  if (!film) return;
  const title    = film.title || 'Watch Free';
  const year     = film.year  ? ` (${film.year})` : '';
  const desc     = film.description
    ? film.description.slice(0, 160)
    : `Watch ${title} free on MOVXIO — no account needed.`;
  const image    = film.thumbnail_url || '';
  const canonical = film.slug
    ? `https://movxio.com/film/${film.slug}`
    : location.href;
  document.title = `${title}${year} — Watch Online Free | MOVXIO`;
  const canonEl = document.getElementById('canonicalTag');
  if (canonEl) canonEl.setAttribute('href', canonical);
  const setMeta = (sel, attr, val) => { const el = document.querySelector(sel); if (el) el.setAttribute(attr, val); };
  setMeta('meta[property="og:title"]',        'content', `${title}${year} — MOVXIO`);
  setMeta('meta[property="og:description"]',  'content', desc);
  setMeta('meta[property="og:image"]',        'content', image);
  setMeta('meta[property="og:url"]',          'content', canonical);
  setMeta('meta[property="og:type"]',         'content', 'video.movie');
  setMeta('meta[name="twitter:title"]',       'content', title + year);
  setMeta('meta[name="twitter:description"]', 'content', desc);
  setMeta('meta[name="twitter:image"]',       'content', image);
  setMeta('meta[name="description"]',         'content', desc);
  const bcCurrent = document.querySelector('.bc-current');
  if (bcCurrent) bcCurrent.textContent = title;
}

// ── Client-side URL canonicalization ──────────────────────────
// If the worker didn't redirect (cached/bypassed), fix it here.
function maybeRedirectToSlug(film) {
  // Intentionally empty — 301 redirect is handled server-side by _worker.js.
  // Using history.replaceState() here breaks the browser back button.
}

// ── Film card URL helper ───────────────────────────────────────
function filmUrl(f) {
  if (!f) return '#';
  if (f.slug) return '/film/' + encodeURIComponent(f.slug).replace(/%2F/g, '/');
  return '/watch.html?id=' + encodeURIComponent(f.id);
}

// ── Fetch ─────────────────────────────────────────────────────
// Fetch a single film by slug or id (fast — indexed, 1 row)
async function fetchSingleFilm(identifier) {
  if (!identifier || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) return null;
  const param = identifier.type === 'slug'
    ? `slug=eq.${encodeURIComponent(identifier.value)}`
    : `id=eq.${encodeURIComponent(identifier.value)}`;
  try {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/films?${param}&select=*&limit=1`,
      { headers: { 'apikey': CONFIG.SUPABASE_KEY, 'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.length ? data[0] : null;
  } catch { return null; }
}

// Fetch all films (for related sidebar) — limited to top 150 by views to keep payload manageable
async function fetchFilms() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) return DEMO;
  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/films?select=id,title,slug,thumbnail_url,year,imdb_rating,genre,views,type,director,actors,country&order=views.desc&limit=150`, {
      headers: { 'apikey': CONFIG.SUPABASE_KEY, 'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}` }
    });
    return res.ok ? await res.json() : DEMO;
  } catch { return DEMO; }
}

async function getSignedUrl(slug) {
  if (!slug || !CONFIG.WORKER_URL) return null;
  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/sign?film=${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    return (await res.json()).url || null;
  } catch { return null; }
}

function slugFromUrl(url) {
  if (!url) return null;
  if (!url.startsWith('http')) return url.split('/')[0];
  const m = url.match(/films\/([^/]+)\//);
  return m ? m[1] : null;
}

// ── Controls visibility ───────────────────────────────────────
const playerContainer = document.getElementById('playerContainer');

function showControls() {
  playerContainer.classList.add('controls-visible');
  clearTimeout(controlsTimer);
  if (player && !player.paused()) {
    controlsTimer = setTimeout(hideControls, 3000);
  }
}

function hideControls() {
  if (isDragging) return;
  playerContainer.classList.remove('controls-visible');
}

playerContainer.addEventListener('mousemove', showControls);
playerContainer.addEventListener('touchstart', showControls, { passive: true });

// ── Click overlay: play/pause + double-tap skip ───────────────
let lastTap = 0, lastTapSide = null;
const clickOverlay = document.getElementById('clickOverlay');

clickOverlay.addEventListener('click', (e) => {
  if (!player) return;
  const rect = clickOverlay.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const side = x < rect.width / 3 ? 'left' : x > rect.width * 2/3 ? 'right' : 'center';
  const now = Date.now();

  if (now - lastTap < 300 && lastTapSide === side) {
    // Double click/tap
    if (side === 'left') { seek(-10); showSkipIndicator('back'); }
    else if (side === 'right') { seek(10); showSkipIndicator('fwd'); }
    else { toggleFullscreen(); } // double-click center = fullscreen
    lastTap = 0;
    return;
  }
  lastTap = now;
  lastTapSide = side;

  // Single click — play/pause (with delay to allow double tap)
  setTimeout(() => {
    if (Date.now() - lastTap >= 280) togglePlay();
  }, 300);
});

// Touch double-tap support
let touchTimer = null;
clickOverlay.addEventListener('touchend', (e) => {
  if (!player) return;
  const touch = e.changedTouches[0];
  const rect = clickOverlay.getBoundingClientRect();
  const x = touch.clientX - rect.left;
  const side = x < rect.width / 3 ? 'left' : x > rect.width * 2/3 ? 'right' : 'center';
  const now = Date.now();

  if (now - lastTap < 300 && lastTapSide === side) {
    clearTimeout(touchTimer);
    if (side === 'left') { seek(-10); showSkipIndicator('back'); }
    else if (side === 'right') { seek(10); showSkipIndicator('fwd'); }
    else { toggleFullscreen(); } // double-tap center = fullscreen
    lastTap = 0;
    return;
  }
  lastTap = now;
  lastTapSide = side;
  touchTimer = setTimeout(() => {
    if (Date.now() - lastTap >= 280) togglePlay();
  }, 300);
});

// ── Player controls ───────────────────────────────────────────
function togglePlay() {
  if (!player) return;
  if (player.paused()) { player.play(); showCenterIndicator('play'); }
  else { player.pause(); showCenterIndicator('pause'); clearTimeout(controlsTimer); showControls(); }
}

function seek(delta) {
  if (!player) return;
  player.currentTime(Math.max(0, Math.min(player.duration() || 0, player.currentTime() + delta)));
}

function showCenterIndicator(type) {
  const el = document.getElementById('centerIndicator');
  const icon = document.getElementById('centerIcon');
  icon.innerHTML = type === 'play'
    ? '<path d="M8 5v14l11-7z"/>'
    : '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  el.classList.remove('hide');
  el.classList.add('show');
  setTimeout(() => { el.classList.remove('show'); el.classList.add('hide'); }, 600);
}

function showSkipIndicator(dir) {
  const el = document.getElementById(dir === 'back' ? 'skipBack' : 'skipFwd');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 700);
}

function showKeyHint(msg) {
  const el = document.getElementById('keyHint');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1200);
}

// ── Play/Pause button ─────────────────────────────────────────
document.getElementById('btnPlayPause').addEventListener('click', togglePlay);
document.getElementById('btnBack').addEventListener('click', () => { seek(-10); showSkipIndicator('back'); });
document.getElementById('btnFwd').addEventListener('click', () => { seek(10); showSkipIndicator('fwd'); });

// ── Volume ────────────────────────────────────────────────────
document.getElementById('btnMute').addEventListener('click', () => {
  if (!player) return;
  player.muted(!player.muted());
  updateVolumeUI();
});
document.getElementById('volumeSlider').addEventListener('input', (e) => {
  if (!player) return;
  player.volume(e.target.value / 100);
  player.muted(false);
  updateVolumeUI();
  try { localStorage.setItem('mvx_volume', e.target.value); } catch {}
});
function updateVolumeUI() {
  if (!player) return;
  const muted = player.muted() || player.volume() === 0;
  document.getElementById('iconVol').style.display = muted ? 'none' : '';
  document.getElementById('iconMute').style.display = muted ? '' : 'none';
  document.getElementById('volumeSlider').value = muted ? 0 : Math.round(player.volume() * 100);
}

// ── Fullscreen ────────────────────────────────────────────────
document.getElementById('btnFullscreen').addEventListener('click', toggleFullscreen);
function toggleFullscreen() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const el = playerContainer;
    // Prefer container-level fullscreen on ALL platforms (keeps #subOverlay inside FS layer).
    // requestFullscreen works on iOS 16.4+ Safari; webkitRequestFullscreen covers older iOS/Android.
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (req) {
      req.call(el).catch(function() {
        // Absolute last-resort fallback for very old iOS that only supports video-element FS.
        // Subtitles won't render in this path — nothing we can do without native track support.
        const vid = player ? player.el().querySelector('video') : null;
        if (vid && vid.webkitEnterFullscreen) vid.webkitEnterFullscreen();
      });
    } else {
      // Very old iOS Safari fallback
      const vid = player ? player.el().querySelector('video') : null;
      if (vid && vid.webkitEnterFullscreen) vid.webkitEnterFullscreen();
    }
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (exit) exit.call(document);
  }
}
function updateFullscreenUI() {
  const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  document.getElementById('iconExpand').style.display = fs ? 'none' : '';
  document.getElementById('iconCompress').style.display = fs ? '' : 'none';
}
document.addEventListener('fullscreenchange', updateFullscreenUI);
document.addEventListener('webkitfullscreenchange', updateFullscreenUI);

// ── Fullscreen floating CC button ─────────────────────────────
// Shows a subtitle toggle button in the top-right corner when in fullscreen.
// Mirrors the state of the main CC controls so they stay in sync.

function updateFsSubBtn() {
  const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  const btn = document.getElementById('fsSubBtn');
  if (!btn) return;

  if (!fs) {
    btn.style.display = 'none';
    // Also close picker if we exit fullscreen
    const picker = document.getElementById('fsSubPicker');
    if (picker) picker.style.display = 'none';
    return;
  }

  // Only show if there are actual subtitle tracks loaded
  if (!player) { btn.style.display = 'none'; return; }
  const tracks = player.textTracks();
  let subTracks = [];
  for (let i = 0; i < tracks.length; i++) {
    if (tracks[i].kind === 'subtitles' || tracks[i].kind === 'captions') {
      subTracks.push(tracks[i]);
    }
  }
  if (subTracks.length === 0) { btn.style.display = 'none'; return; }

  btn.style.display = 'block';
  buildFsSubList(subTracks);
}

function buildFsSubList(subTracks) {
  const list = document.getElementById('fsSubList');
  const label = document.getElementById('fsSubLabel');
  const toggle = document.getElementById('fsSubToggle');
  if (!list) return;

  const checkSVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;color:#e8473f;"><polyline points="20 6 9 17 4 12"/></svg>';

  // Determine active track
  let activeTrack = null;
  for (let i = 0; i < subTracks.length; i++) {
    if (subTracks[i].mode === 'showing') { activeTrack = subTracks[i]; break; }
  }

  // Update button appearance
  const isOn = !!activeTrack;
  toggle.style.borderColor = isOn ? 'rgba(232,71,63,0.7)' : 'rgba(255,255,255,0.18)';
  toggle.style.background  = isOn ? 'rgba(232,71,63,0.22)' : 'rgba(0,0,0,0.55)';
  if (label) label.textContent = isOn ? (activeTrack.label || 'ON') : 'Subtitles';

  // Build picker list
  list.innerHTML = '';

  // Off option
  const offEl = document.createElement('div');
  offEl.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;color:#9997b0;font-family:"DM Sans",sans-serif;transition:background 0.12s;';
  offEl.innerHTML = (!isOn ? checkSVG : '<span style="width:14px;display:inline-block;"></span>') + ' Off';
  offEl.addEventListener('click', function() {
    for (let i = 0; i < subTracks.length; i++) subTracks[i].mode = 'disabled';
    // Sync main CC button
    document.querySelectorAll('.cc-item').forEach(function(i) { i.classList.remove('active'); });
    const offItem = document.querySelector('.cc-item[data-lang="off"]');
    if (offItem) offItem.classList.add('active');
    document.getElementById('btnCC').classList.remove('active');
    buildFsSubList(subTracks);
    document.getElementById('fsSubPicker').style.display = 'none';
  });
  list.appendChild(offEl);

  subTracks.forEach(function(t) {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;color:#9997b0;font-family:"DM Sans",sans-serif;transition:background 0.12s;';
    const isActive = t.mode === 'showing';
    el.innerHTML = (isActive ? checkSVG : '<span style="width:14px;display:inline-block;"></span>') + ' ' + (t.label || t.language || 'Track');
    el.addEventListener('mouseover', function() { el.style.background = 'rgba(255,255,255,0.07)'; });
    el.addEventListener('mouseout',  function() { el.style.background = ''; });
    el.addEventListener('click', function() {
      for (let i = 0; i < subTracks.length; i++) subTracks[i].mode = 'disabled';
      t.mode = 'showing';
      // Sync main CC button
      document.querySelectorAll('.cc-item').forEach(function(item) {
        item.classList.toggle('active', item.dataset.lang === t.label || item.dataset.srclang === t.language);
      });
      document.getElementById('btnCC').classList.add('active');
      buildFsSubList(subTracks);
      document.getElementById('fsSubPicker').style.display = 'none';
    });
    list.appendChild(el);
  });
}

// Toggle picker open/close
document.getElementById('fsSubToggle').addEventListener('click', function(e) {
  e.stopPropagation();
  const picker = document.getElementById('fsSubPicker');
  if (!picker) return;
  const isOpen = picker.style.display === 'block';
  picker.style.display = isOpen ? 'none' : 'block';
});

// Close picker on outside click
document.addEventListener('click', function(e) {
  const btn  = document.getElementById('fsSubBtn');
  const picker = document.getElementById('fsSubPicker');
  if (picker && picker.style.display === 'block' && btn && !btn.contains(e.target)) {
    picker.style.display = 'none';
  }
});

// Hook into fullscreen events
document.addEventListener('fullscreenchange', updateFsSubBtn);
document.addEventListener('webkitfullscreenchange', updateFsSubBtn);


// ── Chapter Markers ──────────────────────────────────────────
// chapters format: [{time: 0, title: 'Intro'}, {time: 120, title: 'Act 1'}, ...]
// Stored in film.chapters as JSON array in Supabase

var currentChapters = [];

function buildChapterMarkers(film) {
  var container = document.getElementById('chapterMarkers');
  if (!container) return;
  container.innerHTML = '';
  currentChapters = [];

  // Parse chapters from film data
  var chapters = [];
  if (film.chapters) {
    try {
      chapters = typeof film.chapters === 'string'
        ? JSON.parse(film.chapters)
        : film.chapters;
    } catch { chapters = []; }
  }

  if (!chapters || chapters.length < 2) return; // need at least 2 to be useful

  var dur = player ? player.duration() : 0;
  if (!dur) {
    // Duration not yet known — wait for loadedmetadata
    player && player.one('loadedmetadata', function() {
      buildChapterMarkers(film);
    });
    return;
  }

  currentChapters = chapters;

  // Skip first chapter (time=0, it's the start — no marker needed)
  chapters.slice(1).forEach(function(ch) {
    var pct = (ch.time / dur) * 100;
    if (pct <= 0 || pct >= 100) return;

    var marker = document.createElement('div');
    marker.className = 'chapter-marker';
    marker.style.left = pct + '%';

    // Chapter name tooltip
    if (ch.title) {
      var tip = document.createElement('div');
      tip.className = 'chapter-tooltip';
      tip.textContent = ch.title;
      marker.appendChild(tip);
    }

    container.appendChild(marker);
  });
}

// Get current chapter name based on playback position
function getCurrentChapter(timeSecs) {
  if (!currentChapters.length) return null;
  var current = currentChapters[0];
  for (var i = 0; i < currentChapters.length; i++) {
    if (currentChapters[i].time <= timeSecs) {
      current = currentChapters[i];
    } else {
      break;
    }
  }
  return current;
}

// Update progress tooltip to include chapter name
var _origProgressTooltip = null;
function updateProgressTooltipWithChapter(pct, dur) {
  var tip = document.getElementById('progressTooltip');
  if (!tip) return;
  var timeSecs = pct * dur;
  var chapter  = getCurrentChapter(timeSecs);
  var timeStr  = formatTime(timeSecs);
  tip.textContent = chapter && chapter.title
    ? chapter.title + '  ' + timeStr
    : timeStr;
}

// ── Picture in Picture ───────────────────────────────────────
(function() {
  const btn = document.getElementById('btnPiP');
  const vid = () => player ? player.el().querySelector('video') : null;
  if (document.pictureInPictureEnabled) {
    btn.style.display = 'flex';
    btn.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
          btn.classList.remove('active');
        } else {
          const v = vid();
          if (v) { await v.requestPictureInPicture(); btn.classList.add('active'); }
        }
      } catch(e) { console.warn('PiP error:', e); }
    });
    document.addEventListener('leavepictureinpicture', () => btn.classList.remove('active'));
  }
})();

// ── Theater Mode ─────────────────────────────────────────────
let theaterOn = false;
function toggleTheater() {
  theaterOn = !theaterOn;
  document.body.classList.toggle('theater-mode', theaterOn);
  const btnT = document.getElementById('btnTheater');
  document.getElementById('iconTheaterOn').style.display  = theaterOn ? 'none' : '';
  document.getElementById('iconTheaterOff').style.display = theaterOn ? '' : 'none';
  if (btnT) btnT.classList.toggle('active', theaterOn);
  // scroll player into view
  document.querySelector('.player-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
(document.getElementById('btnTheater') || {addEventListener:()=>{}}).addEventListener('click', toggleTheater);

// ── Quality Selector ─────────────────────────────────────────
function buildQualityMenu() {
  const btn  = document.getElementById('btnQuality');
  const list = document.getElementById('qualityList');
  if (!player || !list) return;

  // Video.js VHS exposes quality levels
  const vhs = player.tech(true) && player.tech(true).vhs;
  if (!vhs) return;

  const levels = player.qualityLevels ? player.qualityLevels() : null;
  if (!levels || levels.length < 2) return;

  btn.style.display = 'flex';

  function renderLevels() {
    list.innerHTML = '';
    // Auto option
    const autoEl = document.createElement('div');
    autoEl.className = 'quality-item' + (levels.selectedIndex === -1 ? ' active' : '');
    autoEl.innerHTML = 'Auto <span class="quality-badge">adaptive</span>';
    autoEl.onclick = () => {
      for (let i = 0; i < levels.length; i++) levels[i].enabled = true;
      renderLevels();
      document.getElementById('qualityMenu').classList.remove('open');
    };
    list.appendChild(autoEl);

    // Individual levels - sorted high to low
    const sorted = Array.from({length: levels.length}, (_, i) => levels[i])
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    sorted.forEach((level, i) => {
      const el = document.createElement('div');
      const label = level.height ? level.height + 'p' : 'Level ' + i;
      const badge = level.bitrate ? Math.round(level.bitrate / 1000) + 'k' : '';
      el.className = 'quality-item' + (level.enabled && sorted.filter(l=>l.enabled).length === 1 ? ' active' : '');
      el.innerHTML = label + (badge ? ` <span class="quality-badge">${badge}</span>` : '');
      el.onclick = () => {
        for (let j = 0; j < levels.length; j++) levels[j].enabled = (levels[j] === level);
        renderLevels();
        document.getElementById('qualityMenu').classList.remove('open');
      };
      list.appendChild(el);
    });
  }

  renderLevels();

  // Toggle popup — use .onclick (not addEventListener) so re-calling buildQualityMenu()
  // on episode switch replaces the handler instead of stacking a new one each time.
  btn.onclick = (e) => {
    e.stopPropagation();
    document.getElementById('qualityMenu').classList.toggle('open');
    document.getElementById('settingsMenu').classList.remove('open');
    document.getElementById('ccMenu') && document.getElementById('ccMenu').classList.remove('open');
  };
}

// Quality menu is wired inside initPlayer() once the player instance exists

// ── Keyboard Shortcuts Overlay ───────────────────────────────
function openKbOverlay()  { document.getElementById('kbOverlay').classList.add('open'); }
function closeKbOverlay() { document.getElementById('kbOverlay').classList.remove('open'); }
// Attach KB overlay listeners safely after DOM is ready
(function attachKbListeners() {
  const btnKb = document.getElementById('btnKb');
  const overlay = document.getElementById('kbOverlay');
  if (btnKb) btnKb.addEventListener('click', openKbOverlay);
  if (overlay) overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeKbOverlay();
  });
  if (!btnKb || !overlay) {
    // Elements not yet in DOM — wait for them
    document.addEventListener('DOMContentLoaded', attachKbListeners);
  }
})();

// ── Progress bar ──────────────────────────────────────────────
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressThumb = document.getElementById('progressThumb');
const progressBuffer = document.getElementById('progressBuffer');
const progressTooltip = document.getElementById('progressTooltip');

function getPct(e) {
  const rect = progressWrap.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
}

progressWrap.addEventListener('mousemove', (e) => {
  const pct = getPct(e);
  const dur = player ? (player.duration() || 0) : 0;
  updateProgressTooltipWithChapter(pct, dur);
  progressTooltip.style.left = `${pct * 100}%`;
  if (isDragging) {
    progressFill.style.width = `${pct * 100}%`;
    progressThumb.style.left = `${pct * 100}%`;
  }
});

progressWrap.addEventListener('mousedown', (e) => {
  isDragging = true;
  const pct = getPct(e);
  progressFill.style.width = `${pct * 100}%`;
  progressThumb.style.left = `${pct * 100}%`;
});

document.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  if (player) {
    const rect = progressWrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    player.currentTime(pct * (player.duration() || 0));
  }
});

progressWrap.addEventListener('click', (e) => {
  if (!player) return;
  const pct = getPct(e);
  player.currentTime(pct * (player.duration() || 0));
});

// Touch scrubbing
progressWrap.addEventListener('touchstart', (e) => {
  isDragging = true;
  e.preventDefault();
}, { passive: false });
progressWrap.addEventListener('touchmove', (e) => {
  if (!isDragging || !player) return;
  const touch = e.touches[0];
  const rect = progressWrap.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
  progressFill.style.width = `${pct * 100}%`;
  progressThumb.style.left = `${pct * 100}%`;
  updateProgressTooltipWithChapter(pct, player.duration() || 0);
  progressTooltip.style.left = `${pct * 100}%`;
}, { passive: true });
progressWrap.addEventListener('touchend', (e) => {
  if (!isDragging || !player) return;
  isDragging = false;
  const touch = e.changedTouches[0];
  const rect = progressWrap.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
  player.currentTime(pct * (player.duration() || 0));
});

// ── Keyboard controls ─────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (!player || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  switch(e.key) {
    case ' ': case 'k': e.preventDefault(); togglePlay(); break;
    case 'ArrowLeft':  e.preventDefault(); seek(-10); showSkipIndicator('back'); showKeyHint('◀ 10s'); break;
    case 'ArrowRight': e.preventDefault(); seek(10); showSkipIndicator('fwd'); showKeyHint('10s ▶'); break;
    case 'ArrowUp':    e.preventDefault(); { const v=Math.min(1,player.volume()+0.1); player.volume(v); player.muted(false); updateVolumeUI(); showKeyHint(`🔊 ${Math.round(v*100)}%`); } break;
    case 'ArrowDown':  e.preventDefault(); { const v=Math.max(0,player.volume()-0.1); player.volume(v); updateVolumeUI(); showKeyHint(`🔉 ${Math.round(v*100)}%`); } break;
    case 'm': case 'M': player.muted(!player.muted()); updateVolumeUI(); showKeyHint(player.muted()?'🔇 Muted':'🔊 Unmuted'); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 't': case 'T': toggleTheater(); break;
    case 'p': case 'P': document.getElementById('btnPiP').click(); break;
    case 'c': case 'C': document.getElementById('btnCC').click(); break;
    case '?': openKbOverlay(); break;
    case 'Escape': closeKbOverlay(); break;
  }
});

// ── CC Menu ───────────────────────────────────────────────────
document.getElementById('btnCC').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('ccMenu');
  const settings = document.getElementById('settingsMenu');
  settings.classList.remove('open');
  menu.classList.toggle('open');
});

// ── Build speed list ─────────────────────────────────────────
(function() {
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const list = document.getElementById('speedList');
  speeds.forEach(s => {
    const div = document.createElement('div');
    div.className = 'menu-item speed-item' + (s === 1 ? ' active' : '');
    div.dataset.speed = s;
    div.innerHTML = '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ' + (s === 1 ? 'Normal' : s + '×');
    list.appendChild(div);
  });
})();

// ── Settings Menu ─────────────────────────────────────────────
document.getElementById('btnSettings').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('qualityMenu').classList.remove('open');
  const menu = document.getElementById('settingsMenu');
  const cc = document.getElementById('ccMenu');
  cc.classList.remove('open');
  menu.classList.toggle('open');
});

document.getElementById('speedList').addEventListener('click', (e) => {
  const item = e.target.closest('.speed-item');
  if (!item || !player) return;
  const speed = parseFloat(item.dataset.speed);
  player.playbackRate(speed);
  document.querySelectorAll('.speed-item').forEach(i => i.classList.remove('active'));
  item.classList.add('active');
  showKeyHint(`${speed === 1 ? 'Normal' : speed+'×'} speed`);
  document.getElementById('settingsMenu').classList.remove('open');
});

// Close menus on outside click
document.addEventListener('click', () => {
  document.getElementById('ccMenu').classList.remove('open');
  document.getElementById('settingsMenu').classList.remove('open');
  document.getElementById('qualityMenu').classList.remove('open');
});

// ── Resume banner ─────────────────────────────────────────────
document.getElementById('resumeBtn').addEventListener('click', () => {
  const pos = parseInt(document.getElementById('resumeBtn').dataset.pos);
  if (player && pos) { player.currentTime(pos); player.play(); }
  document.getElementById('resumeBanner').classList.remove('show');
});
document.getElementById('resumeDismiss').addEventListener('click', () => {
  document.getElementById('resumeBanner').classList.remove('show');
});

// ── localStorage ──────────────────────────────────────────────
function savePosition(fid, pos, dur) {
  try { localStorage.setItem(`mvx_pos_${fid}`, JSON.stringify({ pos, dur, ts: Date.now() })); } catch {}
}
function getSavedPosition(fid) {
  try {
    const d = JSON.parse(localStorage.getItem(`mvx_pos_${fid}`) || 'null');
    if (!d) return null;
    if (Date.now() - d.ts > 30*24*60*60*1000) return null;
    if (d.dur && d.pos >= d.dur - 120) return null;
    return d.pos;
  } catch { return null; }
}

// ── Views ─────────────────────────────────────────────────────
async function incrementViews(fid) {
  if (!CONFIG.SUPABASE_URL) return;
  try {
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/increment_views`, {
      method: 'POST',
      headers: { 'apikey': CONFIG.SUPABASE_KEY, 'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ film_id: fid }),
    });
  } catch {}
}

// ── Init Player ───────────────────────────────────────────────
function initPlayer(film, videoUrl, episode) {
  // FIX: Single, clean teardown — dispose existing player first (removes its DOM node too)
  if (player) {
    try { player.dispose(); } catch(e) {}
    player = null;
  }
  // FIX: Remove any leftover video element (in case dispose didn't clean it)
  var oldVideo = document.getElementById('movxioPlayer');
  if (oldVideo) oldVideo.remove();

  // FIX: Reset ALL transient UI state for new episode/film
  var container = document.getElementById('playerContainer');
  container.classList.remove('is-playing');
  var initBtn = document.getElementById('initialPlayBtn');
  if (initBtn) initBtn.style.opacity = '0';

  // Dismiss resume banner from previous episode
  document.getElementById('resumeBanner').classList.remove('show');

  // Clear any next-episode countdown/toast still running from previous episode
  if (typeof _necTimer !== 'undefined') clearInterval(_necTimer);
  var necOverlay = document.getElementById('nextEpCountdown');
  if (necOverlay) necOverlay.classList.remove('show');
  var oldToast = document.getElementById('nextEpToast');
  if (oldToast) oldToast.remove();

  // Reset quality menu — hide button and clear old options so E2 gets a fresh build
  var qBtn = document.getElementById('btnQuality');
  var qList = document.getElementById('qualityList');
  if (qBtn) { qBtn.style.display = 'none'; qBtn.onclick = null; }
  if (qList) qList.innerHTML = '';

  // Create a fresh <video> element for Video.js to own
  var newVideo = document.createElement('video');
  newVideo.id        = 'movxioPlayer';
  newVideo.className = 'video-js';
  newVideo.setAttribute('playsinline', '');
  newVideo.setAttribute('preload', 'metadata');
  container.appendChild(newVideo);

  currentFilm = film;

  if (episode) {
    document.getElementById('playerTitleText').textContent =
      film.title + ' · S' + episode.season + 'E' + episode.episode + ' — ' + episode.title;
  } else {
    document.getElementById('playerTitleText').textContent = film.title;
  }

  const loading = document.getElementById('playerLoading');
  const noVideo = document.getElementById('noVideo');

  if (!videoUrl) {
    loading.style.display = 'none';
    noVideo.style.display = 'flex';
    return;
  }

  // Init Video.js (engine only, controls hidden)
  player = videojs('movxioPlayer', {
    controls: false,
    autoplay: false,
    preload: 'metadata',
    responsive: true,
    html5: { vhs: { overrideNative: !videojs.browser.IS_SAFARI, enableLowInitialPlaylist: true }, nativeTextTracks: false },
  });

  // Set poster: prefer wide backdrop, fall back to thumbnail
  const posterImg = film.backdrop_url || film.thumbnail_url;
  if (posterImg) player.poster(posterImg);

  // Fix 4: blurred poster bg — always shown before play to fill letterbox bars
  const bgBlur = document.getElementById('playerBgBlur');
  if (bgBlur) {
    // Always reset hidden class when loading a new film/episode
    bgBlur.classList.remove('hidden');
    const blurSrc = film.backdrop_url || film.thumbnail_url;
    if (blurSrc) {
      bgBlur.style.backgroundImage = `url('${blurSrc}')`;
      bgBlur.classList.add('visible');
    } else {
      bgBlur.classList.remove('visible');
      bgBlur.style.backgroundImage = '';
    }
  }

  // Fix 3: show persistent play button on poster state
  const initPlayBtn = document.getElementById('initialPlayBtn');
  if (initPlayBtn) {
    initPlayBtn.style.opacity = '1';
    initPlayBtn.style.pointerEvents = 'none'; // click goes through to clickOverlay
  }

  // Add subtitle tracks — use episode-level subs if available, else fall back to film-level
  const subs = (episode && Array.isArray(episode.subtitles) && episode.subtitles.length)
    ? episode.subtitles
    : (film.subtitles || []);

  // Wait for player ready before adding tracks
  const addTracks = () => {
    // Remove existing subtitle/caption tracks (clean slate)
    const existingTracks = player.remoteTextTracks();
    for (let i = existingTracks.length - 1; i >= 0; i--) {
      if (existingTracks[i].kind === 'subtitles' || existingTracks[i].kind === 'captions') {
        player.removeRemoteTextTrack(existingTracks[i]);
      }
    }
    subs.forEach((sub) => {
      player.addRemoteTextTrack({
        kind: 'subtitles',
        src: sub.url,
        srclang: sub.lang.toLowerCase().slice(0, 2),
        label: sub.lang,
        default: false
      }, false);
    });
    // Start our custom subtitle renderer
    startSubtitleRenderer();
    // Update the fullscreen CC button now that tracks are loaded
    if (typeof updateFsSubBtn === 'function') updateFsSubBtn();
  };

  if (player.readyState() >= 1) {
    addTracks();
  } else {
    player.one('loadedmetadata', addTracks);
    player.one('ready', addTracks);
  }

  // ── Custom Subtitle Renderer ─────────────────────────────────
  // Reads active VJS text track cues and renders to #subOverlay
  // Works in normal, Android fullscreen, AND iOS native fullscreen
  let _subRafId = null;
  function startSubtitleRenderer() {
    if (_subRafId) cancelAnimationFrame(_subRafId);
    const overlay = document.getElementById('subOverlay');
    const span    = overlay ? overlay.querySelector('span') : null;
    if (!overlay || !span) return;

    function renderSub() {
      const tracks = player.textTracks();
      let text = '';
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if ((t.kind === 'subtitles' || t.kind === 'captions') && t.mode === 'showing') {
          const cues = t.activeCues;
          if (cues && cues.length) {
            for (let c = 0; c < cues.length; c++) {
              if (text) text += '\n';
              text += cues[c].text || '';
            }
          }
          break;
        }
      }
      if (text) {
        span.textContent = text;
        overlay.style.display = 'block';
      } else {
        overlay.style.display = 'none';
      }
      _subRafId = requestAnimationFrame(renderSub);
    }
    renderSub();
  }

  function stopSubtitleRenderer() {
    if (_subRafId) { cancelAnimationFrame(_subRafId); _subRafId = null; }
    const overlay = document.getElementById('subOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  // CC button — always visible
  const btnCC = document.getElementById('btnCC');
  btnCC.style.display = '';
  btnCC.style.opacity = '';       // reset dim state from any previous episode
  btnCC.classList.remove('active');
  const ccList = document.getElementById('ccList');
  // FIX: Clear CC list before adding new items — prevents duplicate entries on episode switch
  ccList.innerHTML = '';
  const checkSVG = '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';

  // Show CC button if subtitles available
  if (subs.length > 0) {
    const offItem = document.createElement('div');
    offItem.className = 'menu-item cc-item active';
    offItem.dataset.lang = 'off';
    offItem.innerHTML = checkSVG + ' Off';
    ccList.appendChild(offItem);
    subs.forEach(sub => {
      const item = document.createElement('div');
      item.className = 'menu-item cc-item';
      item.dataset.srclang = sub.lang.toLowerCase().slice(0,2);
      item.dataset.lang = sub.lang;
      item.innerHTML = checkSVG + ' ' + sub.lang;
      ccList.appendChild(item);
    });

    // FIX: Use .onclick (not addEventListener) so episode switches replace the handler, not stack it
    ccList.onclick = (e) => {
      const item = e.target.closest('.cc-item');
      if (!item) return;
      document.querySelectorAll('.cc-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const isOff = item.dataset.lang === 'off';
      const targetLang = item.dataset.srclang || '';
      const targetLabel = item.dataset.lang || '';
      const tracks = player.textTracks();



      for (let i = 0; i < tracks.length; i++) {
        if (isOff) {
          tracks[i].mode = 'disabled';
        } else {
          const matchLang  = targetLang && tracks[i].language === targetLang;
          const matchLabel = targetLabel && tracks[i].label === targetLabel;
          tracks[i].mode = (matchLang || matchLabel) ? 'showing' : 'disabled';
        }
      }
      document.getElementById('ccMenu').classList.remove('open');
      document.getElementById('btnCC').classList.toggle('active', !isOff);
      // Stop renderer when subtitles turned off
      if (isOff && typeof stopSubtitleRenderer === 'function') stopSubtitleRenderer();
    };
  } else {
    // No subtitles — show placeholder
    const noSub = document.createElement('div');
    noSub.style.cssText = 'padding:10px 10px 8px;font-size:12px;color:var(--text-muted);font-family:"DM Sans",sans-serif;';
    noSub.textContent = 'No subtitles available';
    ccList.appendChild(noSub);
    btnCC.style.opacity = '0.45';
    ccList.onclick = null; // no handler needed when no subs
  }

  player.on('waiting', () => {
    document.getElementById('bufferingIndicator').style.display = 'flex';
  });
  player.on('playing', () => {
    document.getElementById('bufferingIndicator').style.display = 'none';
  });
  player.on('canplay', () => {
    document.getElementById('bufferingIndicator').style.display = 'none';
  });

  // Show a user-friendly error state instead of spinning forever on HLS failure
  player.on('error', () => {
    console.warn('[MOVXIO] Player error:', player.error && player.error());
    document.getElementById('bufferingIndicator').style.display = 'none';
    loading.style.display = 'none';
    noVideo.style.display = 'flex';
    var msg = noVideo.querySelector('p');
    if (msg) msg.textContent = 'Stream unavailable — please try again later.';
  });

  player.src({ type: 'application/x-mpegURL', src: videoUrl });

  // Restore saved volume
  try {
    const savedVol = localStorage.getItem('mvx_volume');
    if (savedVol !== null) {
      const vol = parseInt(savedVol) / 100;
      player.volume(vol);
      document.getElementById('volumeSlider').value = savedVol;
    }
  } catch {}

  // Events
  player.on('loadedmetadata', () => {
    loading.style.display = 'none';
    document.getElementById('timeDur').textContent = formatTime(player.duration());
    showControls();
    buildQualityMenu();

    // Resume banner
    const saved = episode
      ? getEpisodeSavedPosition(film.id, episode)
      : getSavedPosition(film.id);
    if (saved && saved > 30) {
      document.getElementById('resumeTime').textContent = formatTime(saved);
      document.getElementById('resumeBtn').dataset.pos = saved;
      document.getElementById('resumeBanner').classList.add('show');
    }
  });

  player.on('play', () => {
    document.getElementById('iconPlay').style.display = 'none';
    document.getElementById('iconPause').style.display = '';
    document.getElementById('btnPlayPause').setAttribute('aria-label', 'Pause');
    showControls();
    // Hide initial play button once playback starts
    const initPlayBtn = document.getElementById('initialPlayBtn');
    if (initPlayBtn) { initPlayBtn.style.opacity = '0'; }
    playerContainer.classList.add('is-playing');
    // Directly hide the blur bg — swap visible to hidden so CSS transition fires
    const bgBlur = document.getElementById('playerBgBlur');
    if (bgBlur) { bgBlur.classList.remove('visible'); bgBlur.classList.add('hidden'); }
    // Clear Video.js poster so it hides during playback
    player.poster('');
  });

  player.on('pause', () => {
    document.getElementById('iconPlay').style.display = '';
    document.getElementById('iconPause').style.display = 'none';
    document.getElementById('btnPlayPause').setAttribute('aria-label', 'Play');
    showControls();
  });

  // Initialise per-instance state BEFORE registering event handlers
  let lastSave = 0;
  _necFired = false;

  player.on('timeupdate', () => {
    // — Progress UI —
    if (!isDragging) {
      const t = player.currentTime();
      const d = player.duration() || 0;
      const pct = d > 0 ? (t / d * 100) : 0;
      progressFill.style.width = `${pct}%`;
      progressThumb.style.left = `${pct}%`;
      document.getElementById('timeNow').textContent = formatTime(t);
    }

    // — Throttled position save —
    if (!player.paused()) {
      const now = Date.now();
      if (now - lastSave >= CONFIG.SAVE_INTERVAL * 1000) {
        lastSave = now;
        const pos = Math.floor(player.currentTime());
        const dur = Math.floor(player.duration() || 0);
        if (pos > 0) { if (episode) saveEpisodePosition(film.id, episode, pos, dur); else savePosition(film.id, pos, dur); }
      }
    }

    // — Auto-next episode countdown —
    if (episode && !_necFired) {
      const dur = player.duration() || 0;
      const remaining = dur - (player.currentTime() || 0);
      if (dur > 0 && remaining > 0 && remaining <= 30) {
        _necFired = true;
        var idx  = allEpisodes.findIndex(function(e) { return e.id === episode.id; });
        var next = allEpisodes[idx + 1];
        if (next) showNextEpCountdown(next);
      }
    }
  });

  player.on('progress', () => {
    const b = player.bufferedEnd();
    const d = player.duration() || 0;
    if (d > 0) progressBuffer.style.width = `${b/d*100}%`;
  });

  player.on('volumechange', updateVolumeUI);

  player.one('play', () => incrementViews(film.id));

  // Re-attach popunder listener to this new player instance
  if (window._attachPopunderToPlayer) window._attachPopunderToPlayer();
}


// ── Render film info ──────────────────────────────────────────
function renderInfo(film) {
  // Remove skeleton loaders
  ['skelEyebrow','skelTitle','skelDesc1','skelDesc2','skelDesc3','skelMeta1','skelMeta2','skelMeta3','filmPosterSkel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  // Reveal real elements
  const filmDescEl = document.getElementById('filmDesc');
  if (filmDescEl) { filmDescEl.style.display = '-webkit-box'; }
  const filmPosterPh = document.getElementById('filmPosterPh');
  if (filmPosterPh) filmPosterPh.style.display = '';

  // updatePageMeta() in init() handles title, og:*, twitter:*, canonical and meta description.
  // Here we only handle things updatePageMeta doesn't know about: og:image:alt and image dimensions
  // (which depend on whether we have a backdrop vs portrait thumbnail), plus JSON-LD.
  const _ogImgSrc = film.backdrop_url || film.thumbnail_url || film.poster_url || '';
  // og:image — use best available source (backdrop > thumbnail > poster)
  if (_ogImgSrc) {
    const _ogImg = document.querySelector('meta[property="og:image"]');
    const _twImg = document.querySelector('meta[name="twitter:image"]');
    if (_ogImg) _ogImg.setAttribute('content', _ogImgSrc);
    if (_twImg) _twImg.setAttribute('content', _ogImgSrc);
  }
  // og:image:alt — improves accessibility + WhatsApp/Telegram rendering
  let _ogImgAlt = document.querySelector('meta[property="og:image:alt"]');
  if (!_ogImgAlt) { _ogImgAlt = document.createElement('meta'); _ogImgAlt.setAttribute('property','og:image:alt'); document.head.appendChild(_ogImgAlt); }
  _ogImgAlt.setAttribute('content', `${film.title} poster`);
  // Adjust og:image dimensions: backdrop is 1280×720, poster/thumbnail is portrait ~600×900
  const _ogW = document.querySelector('meta[property="og:image:width"]');
  const _ogH = document.querySelector('meta[property="og:image:height"]');
  if (_ogW && _ogH) {
    if (film.backdrop_url) { _ogW.setAttribute('content','1280'); _ogH.setAttribute('content','720'); }
    else { _ogW.setAttribute('content','600'); _ogH.setAttribute('content','900'); }
  }

  // JSON-LD structured data — VideoObject / Movie schema for Google rich results
  const existingLd = document.getElementById('jsonLd');
  if (existingLd) existingLd.remove();
  const ld = {
    '@context': 'https://schema.org',
    '@type': film.type === 'series' ? 'TVSeries' : 'Movie',
    'name': film.title,
    'description': film.description || `Watch ${film.title} free on MOVXIO.`,
    'url': location.href,
    'image': film.backdrop_url || film.thumbnail_url || '',
    'datePublished': film.year ? String(film.year) : undefined,
    'director': film.director ? { '@type': 'Person', 'name': film.director } : undefined,
    'actor': film.actors ? film.actors.split(',').map(a => ({ '@type': 'Person', 'name': a.trim() })) : undefined,
    'genre': film.genre ? film.genre.split(',').map(g => g.trim()) : undefined,
    'contentRating': film.content_rating || undefined,
    'potentialAction': {
      '@type': 'WatchAction',
      'target': location.href
    },
    'offers': {
      '@type': 'Offer',
      'price': '0',
      'priceCurrency': 'USD',
      'availability': 'https://schema.org/InStock'
    }
  };
  // Remove undefined keys
  Object.keys(ld).forEach(k => ld[k] === undefined && delete ld[k]);
  const ldScript = document.createElement('script');
  ldScript.type = 'application/ld+json';
  ldScript.id = 'jsonLd';
  ldScript.textContent = JSON.stringify(ld);
  document.head.appendChild(ldScript);

  const genres = (film.genre||'').split(',').map(g => { const t = g.trim(); return t.charAt(0).toUpperCase() + t.slice(1); }).filter(Boolean);

  const isSeries = film.type === 'series';
  const eyebrowEl = document.getElementById('filmEyebrow');
  if (isSeries) {
    eyebrowEl.innerHTML = '<span class="series-badge">📺 TV Series</span>';
  } else {
    eyebrowEl.textContent = genres[0] || 'Now Streaming';
  }
  // New title+year layout
  const titleLine = document.getElementById('filmTitleLine');
  const yearEl = document.getElementById('filmYear');
  const titleEl = document.getElementById('filmTitle');
  titleEl.textContent = film.title;
  if (yearEl && film.year) yearEl.textContent = '(' + film.year + ')';
  if (titleLine) { titleLine.style.display = 'flex'; document.getElementById('skelTitle').style.display = 'none'; }

  // Build 2-column info grid matching screenshot
  // Left col: Genre, Director, Country, Actor(last)
  // Right col: Duration, Quality, Release, IMDb
  const strip = document.getElementById('filmMetaStrip');
  if (strip) strip.style.display = 'none';
  document.getElementById('skelEyebrow').style.display = 'none';

  const leftRows = [];
  const rightRows = [];

  if (genres.length) {
    const genreLinks = genres.map(g => `<a href="/browse.html?genre=${encodeURIComponent(g)}">${esc(g.charAt(0).toUpperCase()+g.slice(1))}</a>`).join(', ');
    leftRows.push({ key: 'Genre', val: genreLinks });
  }
  if (film.director) leftRows.push({ key: 'Director', val: `<span>${esc(film.director)}</span>` });
  if (film.country)  leftRows.push({ key: 'Country',  val: `<a href="/browse.html?country=${encodeURIComponent(film.country)}">${esc(film.country)}</a>` });
  // Actor last — can be long with many names
  if (film.actors)   leftRows.push({ key: 'Actor',    val: film.actors.split(',').slice(0,5).map(a => `<a href="/browse.html?q=${encodeURIComponent(a.trim())}">${esc(a.trim())}</a>`).join(', ') });

  if (film.duration_secs) rightRows.push({ key: 'Duration', val: formatDur(film.duration_secs) });
  rightRows.push({ key: 'Quality', val: '<span style="background:var(--gold);color:#000;font-family:\'Space Mono\',monospace;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;letter-spacing:0.06em;">HD</span>' });
  if (film.year)        rightRows.push({ key: 'Release', val: `<span style="color:var(--accent);">${esc(String(film.year))}</span>` });
  if (film.imdb_rating) rightRows.push({ key: 'IMDb',    val: `<span style="color:var(--gold);">★ ${esc(String(film.imdb_rating))}</span>` });

  const maxLen = Math.max(leftRows.length, rightRows.length);
  let leftHTML = '', rightHTML = '';
  for (let i = 0; i < maxLen; i++) {
    if (leftRows[i])  leftHTML  += `<div class="info-row"><span class="info-key">${esc(leftRows[i].key)}:</span><span class="info-val">${leftRows[i].val}</span></div>`;
    if (rightRows[i]) rightHTML += `<div class="info-row"><span class="info-key">${esc(rightRows[i].key)}:</span><span class="info-val">${rightRows[i].val}</span></div>`;
  }

  const infoTableEl = document.getElementById('filmInfoTable');
  if (infoTableEl) {
    infoTableEl.innerHTML = `<div class="info-grid"><div>${leftHTML}</div><div>${rightHTML}</div></div>`;
    infoTableEl.style.display = 'block';
  }

  document.getElementById('filmTitle').textContent = film.title;
  // Info title bar
  const infoTitleBar = document.getElementById('infoTitleBar');
  if (infoTitleBar) infoTitleBar.textContent = film.title;

  // Breadcrumb
  const bcTitle = document.getElementById('bcTitle');
  const bcType  = document.getElementById('bcType');
  if (bcTitle) {
    bcTitle.textContent = film.title;
    bcTitle.style.color = '';
    bcTitle.style.fontStyle = '';
    bcTitle.style.opacity = '';
  }
  if (bcType)  {
    bcType.textContent = isSeries ? 'TV Series' : 'Movies';
    bcType.href = isSeries ? '/browse.html?type=series' : '/browse.html';
    bcType.style.opacity = '';
  }

  // Description
  const descEl = document.getElementById('filmDesc');
  const expandBtn = document.getElementById('expandDescBtn');
  const desc = film.description || '';
  descEl.textContent = desc;
  descEl.style.display = 'block';
  if (expandBtn) expandBtn.style.display = desc.length > 220 ? 'inline-block' : 'none';

  // Poster
  const ph = document.getElementById('filmPosterPh');
  const wrap = document.getElementById('filmPosterWrap');
  if (film.thumbnail_url) {
    const img = document.createElement('img');
    img.src = film.thumbnail_url;
    img.alt = film.title;
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
    wrap.insertBefore(img, ph);
    ph.style.display = 'none';
  }

  // Meta table rows — all original fields + new fields
  const rows = [];
  if (genres.length) {
    rows.push({ key: 'Genre', val: genres.map(g => `<a class="meta-link" href="/browse.html?genre=${encodeURIComponent(g)}" style="display:inline-block;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;color:var(--text-dim);margin:1px 2px 1px 0;text-decoration:none;">${esc(g)}</a>`).join('') });
  }
  if (film.director)      rows.push({ key: 'Director', val: esc(film.director) });
  if (film.actors)        rows.push({ key: 'Cast',     val: esc(film.actors) });
  if (film.country)       rows.push({ key: 'Country',  val: esc(film.country) });
  if (film.language)      rows.push({ key: 'Language', val: esc(film.language) });
  if (film.duration_secs) rows.push({ key: 'Duration', val: formatDur(film.duration_secs) });
  if (film.year)          rows.push({ key: 'Release',  val: `<span style="color:var(--accent)">${esc(String(film.year))}</span>` });
  if (film.imdb_rating)   rows.push({ key: 'IMDb',     val: `<span class="meta-imdb"><span class="star">★</span> ${esc(String(film.imdb_rating))}/10</span>` });
  if (film.content_rating)rows.push({ key: 'Rating',   val: `<span class="meta-badge" style="background:rgba(255,255,255,0.08);color:var(--text-dim);">${esc(film.content_rating)}</span>` });
  rows.push({ key: 'Quality', val: '<span class="meta-badge hd">HD</span>&nbsp;&nbsp;<span class="meta-badge free">Free</span>' });
  if (isSeries && film.total_seasons) rows.push({ key: 'Seasons', val: '<span style="color:var(--blue);">' + film.total_seasons + ' Season' + (film.total_seasons > 1 ? 's' : '') + '</span>' });
  if (film.views)         rows.push({ key: 'Views',    val: `<span class="meta-views-badge">${Number(film.views).toLocaleString()}</span>` });

  document.getElementById('filmMetaTable').innerHTML = rows.map(r =>
    `<div class="meta-row"><span class="meta-key">${r.key}</span><span class="meta-val">${r.val}</span></div>`
  ).join('');

  // Watchlist nav button
  updateNavWlBtn(isInWatchlist(film.id));

  // Enable report button now that film is loaded
  const reportBtn = document.getElementById('reportBtn');
  if (reportBtn) { reportBtn.disabled = false; reportBtn.style.opacity = ''; reportBtn.style.pointerEvents = ''; }
}

// ── Render related — smart relevance scoring ──────────────────
function renderRelated(films, currentId, currentGenres, currentFilm) {
  currentGenres = currentGenres || [];

  // Tokenise a string into lowercase words for title similarity
  function words(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  }

  const cWords    = words(currentFilm && currentFilm.title);
  const cActors   = (currentFilm && currentFilm.actors  || '').toLowerCase();
  const cDirector = (currentFilm && currentFilm.director|| '').toLowerCase();
  const cYear     = currentFilm && currentFilm.year ? Number(currentFilm.year) : 0;

  function score(f) {
    let s = 0;

    // 1. Title word overlap — highest weight (sequel/franchise detection)
    const fWords = words(f.title);
    const shared = cWords.filter(w => fWords.includes(w)).length;
    s += shared * 40;

    // 2. Same director
    if (cDirector && f.director && f.director.toLowerCase() === cDirector) s += 30;

    // 3. Actor overlap — count shared actors
    if (cActors && f.actors) {
      const fActors = f.actors.toLowerCase();
      const actorList = cActors.split(',').map(a => a.trim()).filter(Boolean);
      actorList.forEach(a => { if (a.length > 2 && fActors.includes(a)) s += 20; });
    }

    // 4. Genre overlap — points per shared genre
    const fGenres = (f.genre || '').split(',').map(g => g.trim());
    fGenres.forEach(g => { if (currentGenres.includes(g)) s += 10; });

    // 5. Recency tiebreaker — newer films rank higher among equal scores
    const fYear = f.year ? Number(f.year) : 0;
    if (fYear > 0) s += Math.min((fYear - 2000) * 0.3, 8);

    // 6. Popularity tiebreaker (small weight so it doesn't override relevance)
    s += Math.min((f.views || 0) / 500, 3);

    return s;
  }

  const scored = films
    .filter(f => f.id !== currentId)
    .map(f => ({ f, s: score(f) }))
    .sort((a, b) => b.s - a.s);

  // ── Sidebar "Up Next" ─────────────────────────────────────────
  // Minimum score of 10 = must share at least one genre (or better).
  // If fewer than 4 qualify, fall back to top scored regardless.
  const MIN_SIDEBAR_SCORE = 10;
  let sidebarFilms = scored.filter(x => x.s >= MIN_SIDEBAR_SCORE).slice(0, 8).map(x => x.f);
  if (sidebarFilms.length < 4) {
    // Fallback: not enough related films — take top scored anyway but flag them
    sidebarFilms = scored.slice(0, 8).map(x => x.f);
  }

  document.getElementById('relatedList').innerHTML = sidebarFilms.map(f => `
    <a class="related-card" href="${f.slug ? `/film/${esc(f.slug)}` : `watch.html?id=${esc(f.id)}`}">
      ${f.thumbnail_url
        ? `<img class="related-thumb" src="${esc(f.thumbnail_url)}" alt="${esc(f.title)}" loading="lazy">`
        : `<div class="related-thumb-ph">🎬</div>`}
      <div class="related-info">
        <div class="r-title">${esc(f.title)}</div>
        <div class="r-meta">${f.year || ''}${f.imdb_rating ? ' · ★' + f.imdb_rating : ''}</div>
        <div class="r-genre">${(f.genre || '').split(',').slice(0, 2).map(g => { const t = g.trim(); return t.charAt(0).toUpperCase() + t.slice(1); }).join(', ')}</div>
      </div>
    </a>`).join('');

  // ── Related Films — 14 films for 7×2 grid ────────────────────
  const moreFilms = scored.slice(0, 14).map(x => x.f);
  if (moreFilms.length) {
    document.getElementById('moreSection').style.display = 'block';
    document.getElementById('moreGrid').innerHTML = moreFilms.map((f, i) => {
      const ph    = PLACEHOLDERS[i % 4];
      const thumb = f.thumbnail_url
        ? `<img src="${esc(f.thumbnail_url)}" alt="${esc(f.title)}" loading="lazy">`
        : `<div class="card-thumb-placeholder ${ph}"><span class="placeholder-icon">🎬</span></div>`;
      const imdb  = f.imdb_rating ? `★ ${f.imdb_rating}` : '';
      const year  = f.year ? String(f.year) : '';
      // Genre tags — up to 2
      const tags  = (f.genre || '').split(',').slice(0, 2).map(g => {
        const t = g.trim(); return t ? `<span class="card-meta-tag">${esc(t.toUpperCase())}</span>` : '';
      }).join('');
      return `<div class="film-card" onclick="window.location.href='${filmUrl(f)}'">
        <div class="card-thumb">${thumb}
          <div class="card-overlay">
            <div class="card-play"><svg viewBox="0 0 16 16"><path d="M4 2l10 6-10 6V2z"/></svg></div>
          </div>
        </div>
        <div class="card-meta-bar">
          <div class="card-meta-title">${esc(f.title)}</div>
          <div>
            ${year ? `<span class="card-meta-year">${esc(year)}</span>` : ''}
            ${imdb ? `<span class="card-meta-imdb">${esc(imdb)}</span>` : ''}
          </div>
          ${tags ? `<div class="card-meta-tags">${tags}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }
}

// ── Trailer button — fires popunder only, no navigation ──────
function fireTrailerPopunder() {
  try {
    var s = document.createElement('script');
    s.dataset.zone = '10865583';
    s.src = 'https://al5sm.com/tag.min.js';
    document.body.appendChild(s);
  } catch(e) {}
}

function copyLink() {
  navigator.clipboard.writeText(location.href).then(() => {
    const btn = document.getElementById('shareBtn');
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2500);
  });
}


// ── Watchlist ──────────────────────────────────────────────────
function getWatchlist() { try { return JSON.parse(localStorage.getItem('mvx_watchlist')||'[]'); } catch { return []; } }
function setWatchlist(l) { localStorage.setItem('mvx_watchlist', JSON.stringify(l)); }
function isInWatchlist(id) { return getWatchlist().includes(id); }
function toggleNavWatchlist() {
  if (!currentFilm) return;
  let l = getWatchlist();
  if (l.includes(currentFilm.id)) l = l.filter(i => i !== currentFilm.id);
  else l.unshift(currentFilm.id);
  setWatchlist(l);
  updateNavWlBtn(l.includes(currentFilm.id));
}
function updateNavWlBtn(saved) {
  const btn = document.getElementById('navWlBtn');
  const txt = document.getElementById('navWlText');
  if (!btn || !txt) return;
  btn.className = saved ? 'nav-btn saved' : 'nav-btn';
  txt.textContent = saved ? 'Saved ✓' : 'Watchlist';
  const wl2 = document.getElementById('wlBtn2');
  const wl2txt = document.getElementById('wlBtn2Text');
  if (wl2 && wl2txt) {
    wl2txt.textContent = saved ? 'Saved ✓' : 'Add to Watchlist';
    wl2.classList.toggle('saved', saved);
  }
}

// ── Mobile nav & search ───────────────────────────────────────
function toggleMenu() {
  const nav = document.getElementById('mobileNav');
  const btn = document.querySelector('.hamburger');
  const isOpen = nav.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
}
function navSearchGo() {
  const q = document.getElementById('navSearch').value.trim();
  if (q) window.location.href = `/search.html?q=${encodeURIComponent(q)}`;
}
function mobileSearchGo() {
  const q = document.getElementById('mobileSearch').value.trim();
  if (q) window.location.href = `/search.html?q=${encodeURIComponent(q)}`;
}
// Close mobile nav when clicking outside
document.addEventListener('click', (e) => {
  const nav = document.getElementById('mobileNav');
  if (nav && nav.classList.contains('open') && !nav.contains(e.target) && !e.target.closest('.hamburger')) {
    nav.classList.remove('open');
    document.querySelector('.hamburger').classList.remove('open');
    document.body.style.overflow = '';
  }
});

// ── Track history ──────────────────────────────────────────────
function trackHistory(id) {
  try {
    let h = JSON.parse(localStorage.getItem('mvx_history')||'[]');
    h = [id, ...h.filter(i => i !== id)].slice(0, 30);
    localStorage.setItem('mvx_history', JSON.stringify(h));
  } catch(e) {}
}

// ── Fingerprint for anonymous reactions ────────────────────────
function getFingerprint() {
  let fp = localStorage.getItem('mvx_fp');
  if (!fp) { fp = 'fp_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('mvx_fp', fp); }
  return fp;
}

// ── Reactions (likes/dislikes) ─────────────────────────────────
let currentReaction = null;
let likesCount = 0;
let dislikesCount = 0;

async function loadReactions(fid) {
  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/reactions?film_id=eq.${fid}&select=reaction`, {
      headers: { 'apikey': CONFIG.SUPABASE_KEY, 'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    likesCount    = data.filter(r => r.reaction === 'like').length;
    dislikesCount = data.filter(r => r.reaction === 'dislike').length;
    const fp = getFingerprint();
    const mine = data.find(r => r.fingerprint === fp);
    currentReaction = mine ? mine.reaction : null;
    updateReactionUI();
  } catch(e) {}
}

async function react(type) {
  if (!currentFilm) return;
  const fp = getFingerprint();
  const fid = currentFilm.id;
  try {
    if (currentReaction === type) {
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/reactions?film_id=eq.${fid}&fingerprint=eq.${encodeURIComponent(fp)}`, {
        method: 'DELETE',
        headers: { 'apikey': CONFIG.SUPABASE_KEY, 'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}` }
      });
      if (type === 'like') likesCount = Math.max(0, likesCount - 1);
      else dislikesCount = Math.max(0, dislikesCount - 1);
      currentReaction = null;
    } else {
      if (currentReaction) {
        if (currentReaction === 'like') likesCount = Math.max(0, likesCount - 1);
        else dislikesCount = Math.max(0, dislikesCount - 1);
      }
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/reactions`, {
        method: 'POST',
        headers: { 'apikey': CONFIG.SUPABASE_KEY, 'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ film_id: fid, fingerprint: fp, reaction: type })
      });
      if (type === 'like') likesCount++;
      else dislikesCount++;
      currentReaction = type;
    }
  } catch(e) {
    // Optimistic UI even if Supabase fails
    if (currentReaction === type) {
      if (type === 'like') likesCount = Math.max(0, likesCount - 1);
      else dislikesCount = Math.max(0, dislikesCount - 1);
      currentReaction = null;
    } else {
      if (type === 'like') likesCount++;
      else dislikesCount++;
      currentReaction = type;
    }
  }
  updateReactionUI();
}

function updateReactionUI() {
  const lc = document.getElementById('likeCount');
  const dc = document.getElementById('dislikeCount');
  const lb = document.getElementById('likeBtn');
  const db = document.getElementById('dislikeBtn');
  if (lc) lc.textContent = likesCount;
  if (dc) dc.textContent = dislikesCount;
  if (lb) lb.className = 'reaction-btn' + (currentReaction === 'like' ? ' liked' : '');
  if (db) db.className = 'reaction-btn' + (currentReaction === 'dislike' ? ' disliked' : '');
}

// ── Share ──────────────────────────────────────────────────────
function openShare() {
  const modal = document.getElementById('shareModal');
  const filmTitleEl = document.getElementById('shareFilmTitle');
  const linkInput = document.getElementById('shareLinkInput');
  if (filmTitleEl) filmTitleEl.textContent = currentFilm ? currentFilm.title : '';
  if (linkInput) linkInput.value = location.href;
  if (modal) modal.classList.add('open');
}
function closeShare() {
  const modal = document.getElementById('shareModal');
  if (modal) modal.classList.remove('open');
}
function shareWhatsApp() { window.open(`https://wa.me/?text=${encodeURIComponent((currentFilm ? currentFilm.title + ' — ' : '') + 'Watch free on MOVXIO: ' + location.href)}`, '_blank'); }
function shareTwitter()  { window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent((currentFilm ? 'Watching ' + currentFilm.title + ' on MOVXIO — free! ' : '') + location.href)}`, '_blank'); }
function shareFacebook() { window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(location.href)}`, '_blank'); }
function shareTelegram() { window.open(`https://t.me/share/url?url=${encodeURIComponent(location.href)}&text=${encodeURIComponent((currentFilm ? currentFilm.title + ' — ' : '') + 'Watch free on MOVXIO: ')}`, '_blank'); }
function copyShareLink() {
  const linkInput = document.getElementById('shareLinkInput');
  if (!linkInput) return;
  navigator.clipboard.writeText(location.href).then(() => {
    const btn = document.querySelector('.share-link-wrap button');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy Link', 2000); }
  });
}
function toggleDesc() {
  const d = document.getElementById('filmDesc');
  const b = document.getElementById('expandDescBtn');
  if (!d || !b) return;
  const expanded = d.classList.toggle('expanded');
  b.textContent = expanded ? 'Show less ↑' : 'Show more ↓';
}


// ══════════════════════════════════════════════════════════════
// TV SERIES — EPISODE SELECTOR
// ══════════════════════════════════════════════════════════════
var allEpisodes    = [];
var currentSeason  = 1;
var currentEpisode = null;
var currentSeries  = null;

async function fetchEpisodes(seriesId) {
  try {
    var res = await fetch(
      CONFIG.SUPABASE_URL + '/rest/v1/episodes?series_id=eq.' + seriesId + '&select=*&order=season.asc,episode.asc',
      { headers: { 'apikey': CONFIG.SUPABASE_KEY, 'Authorization': 'Bearer ' + CONFIG.SUPABASE_KEY } }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch(e) { return []; }
}

function buildEpisodeSelector(series, episodes) {
  currentSeries = series;
  allEpisodes   = episodes;
  var selector  = document.getElementById('episodeSelector');
  if (!selector || !episodes.length) return;
  var seasons   = [];
  episodes.forEach(function(e) { if (seasons.indexOf(e.season) === -1) seasons.push(e.season); });
  seasons.sort(function(a,b){return a-b;});
  selector.style.display = 'block';
  var params    = new URLSearchParams(location.search);
  currentSeason = parseInt(params.get('season')) || seasons[0];
  var epNum     = parseInt(params.get('ep')) || 1;
  currentEpisode = episodes.find(function(e){ return e.season===currentSeason && e.episode===epNum; })
                || episodes.find(function(e){ return e.season===currentSeason; })
                || episodes[0];
  renderSeasonTabsWatch(seasons);
  renderEpisodeListWatch(currentSeason);
  updateNextEpButton();
}

function renderSeasonTabsWatch(seasons) {
  var wrap = document.getElementById('seasonTabsWatch');
  if (!wrap) return;
  wrap.innerHTML = seasons.map(function(s) {
    return '<button class="season-tab-btn ' + (s===currentSeason?'active':'') + '" onclick="switchWatchSeason(' + s + ')">Season ' + s + '</button>';
  }).join('');
}

function switchWatchSeason(s) {
  currentSeason = s;
  document.querySelectorAll('.season-tab-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.textContent.trim() === 'Season ' + s);
  });
  renderEpisodeListWatch(s);
}

function renderEpisodeListWatch(season) {
  var list = document.getElementById('episodeListWatch');
  if (!list) return;
  var eps = allEpisodes.filter(function(e){ return e.season===season; });
  list.innerHTML = eps.map(function(ep) {
    var isActive  = currentEpisode && ep.id === currentEpisode.id;
    var dur       = ep.duration_secs ? formatDur(ep.duration_secs) : '';
    var thumbHtml = ep.thumbnail_url
      ? '<img src="' + esc(ep.thumbnail_url) + '" alt="" loading="lazy">'
      : '<div class="ep-thumb-ph">🎬</div>';
    var watched   = isEpisodeWatched(ep);
    return '<div class="episode-item' + (isActive?' active':'') + '" data-epid="' + esc(ep.id) + '">' +
      '<div class="ep-thumb-wrap">' + thumbHtml + '<div class="ep-play-icon"><svg viewBox="0 0 16 16"><path d="M4 2l10 6-10 6V2z"/></svg></div></div>' +
      '<div class="ep-info">' +
        '<div class="ep-num">S'+ep.season+' E'+ep.episode+(watched?' ✓':'')+'</div>' +
        '<div class="ep-title">' + esc(ep.title) + '</div>' +
        (ep.description ? '<div class="ep-desc">' + esc(ep.description) + '</div>' : '') +
        (dur ? '<div class="ep-dur">'+dur+'</div>' : '') +
      '</div>' +
      (watched ? '<div class="ep-watched-dot"></div>' : '') +
    '</div>';
  }).join('');

  // Delegated click listener — replaced each render so no accumulation
  list.onclick = function(e) {
    var item = e.target.closest('.episode-item');
    if (!item) return;
    var ep = allEpisodes.find(function(e){ return e.id === item.dataset.epid; });
    if (ep) playEpisode(ep);
  };

  setTimeout(function() {
    var active = list.querySelector('.episode-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, 100);
}

function isEpisodeWatched(ep) {
  try {
    var key  = 'mvx_pos_' + (currentSeries ? currentSeries.id : '') + '_s'+ep.season+'e'+ep.episode;
    var data = JSON.parse(localStorage.getItem(key)||'null');
    return data && data.dur && data.pos >= data.dur * 0.9;
  } catch { return false; }
}

function updateEpCurrentInfo() {
  var el = document.getElementById('epCurrentInfo');
  if (el && currentEpisode) el.textContent = 'S'+currentEpisode.season+' E'+currentEpisode.episode+' — '+currentEpisode.title;
}

function updateNextEpButton() {
  var wrap = document.getElementById('nextEpWrap');
  var titleEl = document.getElementById('nextEpTitle');
  if (!wrap || !titleEl || !currentEpisode || !allEpisodes.length) return;
  var idx  = allEpisodes.findIndex(function(e){ return e.id === currentEpisode.id; });
  var next = allEpisodes[idx + 1];
  if (next) {
    wrap.style.display = 'block';
    titleEl.textContent = 'S'+next.season+'E'+next.episode+' — '+next.title;
    wrap._nextEp = next;
  } else {
    wrap.style.display = 'none';
  }
}

function playEpisode(ep) {
  if (!ep) return;
  currentEpisode = ep;
  if (ep.season !== currentSeason) { currentSeason = ep.season; renderSeasonTabsWatch([...new Set(allEpisodes.map(function(e){return e.season;}))].sort()); }
  renderEpisodeListWatch(currentSeason);

  var params = new URLSearchParams(location.search);
  params.set('season', ep.season); params.set('ep', ep.episode);
  history.replaceState(null, '', location.pathname + '?' + params.toString());

  var titleEl = document.getElementById('playerTitleText');
  if (titleEl) titleEl.textContent = (currentSeries ? currentSeries.title : '') + ' · S'+ep.season+'E'+ep.episode+' — '+ep.title;

  updateEpCurrentInfo();
  updateNextEpButton();

  var loading = document.getElementById('playerLoading');
  var noVideo = document.getElementById('noVideo');
  if (loading) loading.style.display = 'flex';
  if (noVideo) noVideo.style.display = 'none';

  // Sign URL if needed before initialising player (same logic as init())
  var rawUrl = ep.hls_url ? ep.hls_url.trim() : null;
  var slug   = slugFromUrl(rawUrl);
  if (rawUrl && slug) {
    getSignedUrl(slug).then(function(signed) {
      if (signed) rawUrl = signed;
      else console.warn('[MOVXIO] Signing failed for episode switch, using raw URL:', rawUrl);
      initPlayer(currentSeries, rawUrl, ep);
    });
  } else {
    initPlayer(currentSeries, rawUrl, ep);
  }
  document.getElementById('playerContainer').scrollIntoView({ behavior:'smooth', block:'start' });
}

function playNextEpisode() {
  var wrap = document.getElementById('nextEpWrap');
  if (wrap && wrap._nextEp) playEpisode(wrap._nextEp);
}

function showNextEpToast(nextEp) {
  var old = document.getElementById('nextEpToast');
  if (old) old.remove();
  var toast = document.createElement('div');
  toast.id  = 'nextEpToast';
  toast.style.cssText = 'position:absolute;bottom:90px;left:50%;transform:translateX(-50%);z-index:20;background:rgba(8,8,18,0.96);border:1px solid rgba(232,71,63,0.3);border-radius:12px;padding:14px 20px;display:flex;align-items:center;gap:14px;font-size:13px;white-space:nowrap;backdrop-filter:blur(20px);box-shadow:0 8px 32px rgba(0,0,0,0.6);';

  var label = document.createElement('span');
  label.style.color = 'var(--text-dim)';
  label.innerHTML = 'Next: <strong style="color:var(--text)">S' + nextEp.season + 'E' + nextEp.episode + '</strong>';

  var playBtn = document.createElement('button');
  playBtn.textContent = 'Play Now';
  playBtn.style.cssText = 'background:var(--accent);color:#fff;border:none;padding:7px 16px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif;';
  playBtn.addEventListener('click', function() { playEpisode(nextEp); toast.remove(); });

  var closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:0 4px;';
  closeBtn.addEventListener('click', function() { toast.remove(); });

  toast.appendChild(label);
  toast.appendChild(playBtn);
  toast.appendChild(closeBtn);
  document.getElementById('playerContainer').appendChild(toast);
  setTimeout(function(){ if (toast.parentNode) toast.remove(); }, 8000);
}

function saveEpisodePosition(seriesId, ep, pos, dur) {
  try {
    var key = 'mvx_pos_' + seriesId + '_s'+ep.season+'e'+ep.episode;
    localStorage.setItem(key, JSON.stringify({ pos:pos, dur:dur, ts:Date.now() }));
  } catch {}
}

// ── Auto-next episode countdown ───────────────────────────────
var _necTimer = null;
var _necSecs  = 10;

function showNextEpCountdown(nextEp) {
  var overlay  = document.getElementById('nextEpCountdown');
  var titleEl  = document.getElementById('necTitle');
  var barEl    = document.getElementById('necBar');
  var playBtn  = document.getElementById('necPlayBtn');
  var cancelBtn = document.getElementById('necCancelBtn');
  if (!overlay || !nextEp) return;

  titleEl.textContent = 'S' + nextEp.season + 'E' + nextEp.episode + ' — ' + nextEp.title;
  _necSecs = 10;
  barEl.style.transition = 'none';
  barEl.style.width = '100%';

  overlay.classList.add('show');

  // Start countdown
  clearInterval(_necTimer);
  // Allow the browser to paint 100% before starting transition
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      barEl.style.transition = 'width ' + _necSecs + 's linear';
      barEl.style.width = '0%';
    });
  });

  _necTimer = setInterval(function() {
    _necSecs--;
    if (_necSecs <= 0) {
      clearInterval(_necTimer);
      overlay.classList.remove('show');
      playEpisode(nextEp);
    }
  }, 1000);

  playBtn.onclick = function() {
    clearInterval(_necTimer);
    overlay.classList.remove('show');
    playEpisode(nextEp);
  };

  cancelBtn.onclick = function() {
    clearInterval(_necTimer);
    overlay.classList.remove('show');
  };
}

function getEpisodeSavedPosition(seriesId, ep) {
  try {
    var key  = 'mvx_pos_' + seriesId + '_s'+ep.season+'e'+ep.episode;
    var data = JSON.parse(localStorage.getItem(key)||'null');
    if (!data) return null;
    if (Date.now() - data.ts > 30*24*60*60*1000) return null;
    if (data.dur && data.pos >= data.dur - 120) return null;
    return data.pos;
  } catch { return null; }
}




// Reviews section removed

// ── Main ──────────────────────────────────────────────────────
async function init() {
  try {
    const ltEl = document.getElementById('loadingText');
    if (ltEl) ltEl.textContent = 'Fetching film data…';

    // Slow connection warning — fires if Supabase takes > 4s
    const slowTimer = setTimeout(() => {
      if (ltEl) ltEl.textContent = 'Taking longer than usual…';
      showKeyHint('⚠ Slow connection detected');
    }, 4000);

    // Fetch target film (by slug or id) + all films for sidebar — in parallel
    const [targetFilm, films] = await Promise.all([
      fetchSingleFilm(filmIdentifier),
      fetchFilms(),
    ]);
    clearTimeout(slowTimer);
    console.log('[MOVXIO] Films loaded:', films.length, '| identifier:', filmIdentifier);

    const film = targetFilm || films[0];

    // Update page title, OG tags, canonical for regular users
    updatePageMeta(film);

    if (!film) {
      document.getElementById('playerLoading').style.display = 'none';
      document.getElementById('noVideo').style.display = 'flex';
      document.querySelector('#noVideo p').textContent = 'Film not found';
      document.title = 'Film Not Found — MOVXIO';
      // Show a user-friendly message in the info panel
      const titleEl = document.getElementById('filmTitle');
      if (titleEl) { titleEl.textContent = 'Film not found'; titleEl.style.display = ''; }
      const descEl = document.getElementById('filmDesc');
      if (descEl) { descEl.textContent = 'We couldn\'t find that film. It may have been removed or the link is incorrect.'; descEl.style.display = 'block'; }
      ['skelEyebrow','skelTitle','skelDesc1','skelDesc2','skelDesc3','skelMeta1','skelMeta2','skelMeta3','filmPosterSkel'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
      return;
    }

    console.log('[MOVXIO] Rendering:', film.title, '| hls_url:', film.hls_url || 'none');

    trackHistory(film.id);
    renderInfo(film);

    const genres = (film.genre||'').split(',').map(g => { const t = g.trim(); return t.charAt(0).toUpperCase() + t.slice(1); }).filter(Boolean);
    renderRelated(films, film.id, genres, film);
    loadReactions(film.id);
    loadReviewsForFilm(film.id);

    // ── Series: fetch episodes and build selector ──
    if (film.type === 'series') {
      const episodes = await fetchEpisodes(film.id);
      if (episodes.length) {
        buildEpisodeSelector(film, episodes);
        // Get starting episode from URL or first episode
        const params   = new URLSearchParams(location.search);
        const startSeason = parseInt(params.get('season')) || 1;
        const startEp    = parseInt(params.get('ep')) || 1;
        const startEpisode = episodes.find(e => e.season === startSeason && e.episode === startEp)
                          || episodes[0];
        currentEpisode = startEpisode;
        updateEpCurrentInfo();
        updateNextEpButton();

        // Play starting episode
        let videoUrl = startEpisode.hls_url ? startEpisode.hls_url.trim() : null;
        if (videoUrl && slugFromUrl(videoUrl)) {
          if (ltEl) ltEl.textContent = 'Preparing stream…';
          const signed = await getSignedUrl(slugFromUrl(videoUrl));
          if (signed) {
            videoUrl = signed;
          } else {
            // Signing failed — raw URL may be a private bucket path; log for debugging
            console.warn('[MOVXIO] Signing failed for episode, falling back to raw URL:', videoUrl);
          }
        }

        initPlayer(film, videoUrl, startEpisode);
        return; // skip movie init below
      }
    }

    // ── Movie: play film's own hls_url ──
    let videoUrl = film.hls_url ? film.hls_url.trim() : null;
    if (videoUrl && slugFromUrl(videoUrl)) {
      if (ltEl) ltEl.textContent = 'Preparing stream…';
      const signed = await getSignedUrl(slugFromUrl(videoUrl));
      if (signed) {
        videoUrl = signed;
      } else {
        console.warn('[MOVXIO] Signing failed for film, falling back to raw URL:', videoUrl);
      }
    }

    initPlayer(film, videoUrl);
  } catch(e) {
    console.error('[MOVXIO] init() error:', e);
    document.getElementById('playerLoading').style.display = 'none';
    document.getElementById('noVideo').style.display = 'flex';
  }
}

init();

// ── Report Film ──────────────────────────────────────────────
function openReportModal() {
  document.getElementById('reportModal').classList.add('open');
  // Reset form
  document.querySelectorAll('input[name="reportReason"]').forEach(r => r.checked = false);
  document.getElementById('reportNote').value = '';
  document.getElementById('reportSubmitBtn').disabled = false;
  document.getElementById('reportSubmitBtn').textContent = 'Send Report';
  // Highlight selected option on change
  document.querySelectorAll('.report-option').forEach(opt => {
    opt.querySelector('input').addEventListener('change', function() {
      document.querySelectorAll('.report-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });
}

function closeReportModal() {
  document.getElementById('reportModal').classList.remove('open');
}

// Close on outside click — null-guarded (modal HTML loads after this script)
(function attachReportListener() {
  var modal = document.getElementById('reportModal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === this) closeReportModal();
    });
  } else {
    document.addEventListener('DOMContentLoaded', attachReportListener);
  }
})();

async function submitReport() {
  const reason = document.querySelector('input[name="reportReason"]:checked');
  if (!reason) {
    showKeyHint('Please select a reason');
    return;
  }

  const btn    = document.getElementById('reportSubmitBtn');
  const filmId = currentFilm ? currentFilm.id : null;
  const note   = document.getElementById('reportNote').value.trim();

  btn.disabled = true;
  btn.textContent = 'Sending...';

  const report = {
    film_id:   filmId,
    film_title: currentFilm ? currentFilm.title : null,
    reason:    reason.value,
    note:      note || null,
    reported_at: new Date().toISOString(),
    page_url:  location.href,
  };

  try {
    await fetch(CONFIG.SUPABASE_URL + '/rest/v1/reports', {
      method: 'POST',
      headers: {
        'apikey':        CONFIG.SUPABASE_KEY,
        'Authorization': 'Bearer ' + CONFIG.SUPABASE_KEY,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(report),
    });
    btn.textContent = '✓ Reported';
    setTimeout(closeReportModal, 1200);
  } catch {
    // Fallback — save to localStorage if Supabase fails
    var pending = JSON.parse(localStorage.getItem('mvx_pending_reports') || '[]');
    pending.push(report);
    localStorage.setItem('mvx_pending_reports', JSON.stringify(pending));
    btn.textContent = '✓ Saved locally';
    setTimeout(closeReportModal, 1200);
  }
}

(function() {
  // Unregister any existing service workers — SW removed due to caching issues
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
      registrations.forEach(function(reg) {
        reg.unregister();
      });
    });
  }
})();

(function() {
  document.addEventListener('DOMContentLoaded', function() {
    const player = document.getElementById('playerContainer');
    if (!player) return;

    // Disable right-click context menu on player
    player.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      return false;
    });

    // Disable drag on video element
    player.addEventListener('dragstart', function(e) {
      e.preventDefault();
      return false;
    });

    // Disable long-press context menu on mobile
    player.addEventListener('touchstart', function(e) {
      e._touchHandled = true;
    }, { passive: true });

    // Prevent text/element selection inside player
    player.style.userSelect = 'none';
    player.style.webkitUserSelect = 'none';
    player.style.MozUserSelect = 'none';
    player.style.msUserSelect = 'none';
  });
})();

(function() {
  var _adsterraLoaded = false;
  function loadAdsterra() {
    if (_adsterraLoaded) return;
    _adsterraLoaded = true;
    var s = document.createElement('script');
    s.src = 'https://pl29131148.profitablecpmratenetwork.com/44/a4/be/44a4be48a597891bd035368d00eb6745.js';
    s.async = true;
    document.body.appendChild(s);
  }
  if (document.readyState === 'complete') { loadAdsterra(); }
  else { window.addEventListener('load', loadAdsterra); }
})();

(function() {
  const DAY_KEY   = 'mvx_ad_day';
  const COUNT_KEY = 'mvx_ad_count';
  const today     = new Date().toDateString();

  function resetIfNeeded() {
    if (localStorage.getItem(DAY_KEY) !== today) {
      localStorage.setItem(DAY_KEY, today);
      localStorage.setItem(COUNT_KEY, '0');
    }
  }
  function getCount()  { return parseInt(localStorage.getItem(COUNT_KEY) || '0'); }
  function bumpCount() { localStorage.setItem(COUNT_KEY, String(getCount() + 1)); }

  function firePopunder() {
    resetIfNeeded();
    if (getCount() >= 2) return;
    bumpCount();
    var s = document.createElement('script');
    s.dataset.zone = '10865583';
    s.src = 'https://al5sm.com/tag.min.js';
    document.body.appendChild(s);
  }

  var popFiredThisSession = false;

  // Exposed so initPlayer() can re-attach after each player re-init (episodes, film switches)
  window._attachPopunderToPlayer = function() {
    if (!window.player || !window.player.one) return;
    window.player.one('play', function() {
      if (popFiredThisSession) return;
      popFiredThisSession = true;
      firePopunder();
    });
  };

  // Initial attach — poll until player exists on first load
  function pollAndAttach() {
    if (window.player && window.player.one) {
      window._attachPopunderToPlayer();
    } else {
      setTimeout(pollAndAttach, 500);
    }
  }
  document.addEventListener('DOMContentLoaded', pollAndAttach);

  // Fire again at 30-minute mark during active playback
  var thirtyFired = false;
  setInterval(function() {
    if (thirtyFired) return;
    if (!window.player || window.player.paused()) return;
    if ((window.player.currentTime ? window.player.currentTime() : 0) >= 1800) {
      thirtyFired = true;
      firePopunder();
    }
  }, 15000);

})();