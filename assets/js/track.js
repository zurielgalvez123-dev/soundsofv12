/* ================================================================
   SoundsOfV12 — engagement tracking

   Answers the questions the signup list cannot: which pages hold
   attention, how far down people actually read, what they click on the
   way to leaving, and which of those visitors turn into Rari's.

   Deliberately small and deliberately blunt about privacy:
     · no cookies — a random browser id in localStorage, the same one
       the polls already use, and a per-tab session id
     · no IP address, no user agent, no full URLs, no query strings
     · a referrer is reduced to its bare host before it is sent
     · Do Not Track and Global Privacy Control are honoured — those
       visitors are counted nowhere at all
     · everything is dropped after 180 days by a nightly job

   It loads AFTER config.js and never blocks anything. If the backend
   is not configured, or the network is down, or the visitor opted out,
   every function here quietly becomes a no-op. Analytics is the least
   important thing on the page; it must never be the reason something
   breaks in front of a fan.
   ================================================================ */
(function () {
  'use strict';

  var API = (window.V12_CONFIG && window.V12_CONFIG.apiUrl || '').replace(/\/+$/, '');

  // Respect the two signals a visitor can send that mean "don't".
  var optedOut = (function () {
    try {
      return navigator.doNotTrack === '1' ||
             window.doNotTrack === '1' ||
             navigator.msDoNotTrack === '1' ||
             navigator.globalPrivacyControl === true;
    } catch (e) { return false; }
  })();

  // Expose a no-op version regardless, so callers elsewhere in the site
  // never have to check whether tracking exists before calling it.
  if (!API || optedOut) {
    window.V12_TRACK = function () {};
    return;
  }

  /* ---------- identity: a de-duplication key, not a person ---------- */

  var VISITOR = window.V12_VISITOR || 'anon';

  // One "session" = one tab-visit. It dies with the tab, which is what
  // makes "visitors today" mean people rather than page loads.
  var SESSION = (function () {
    try {
      var k = 'v12_session_id', v = sessionStorage.getItem(k);
      if (!v) {
        v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
          : 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (e) { return 'anon'; }
  })();

  var PAGE = (function () {
    var p = location.pathname.replace(/\/+$/, '') || '/';
    return p === '/' ? '/index.html' : p.slice(0, 60);
  })();

  var DEVICE = (function () {
    var w = window.innerWidth || screen.width || 1024;
    return w < 768 ? 'mobile' : (w < 1024 ? 'tablet' : 'desktop');
  })();

  /* ---------- where they came from ----------
     Held for the whole session: a fan who lands from Instagram and then
     clicks to the shop came from Instagram, not from ourselves. Campaign
     tags win over the referrer, because that is the point of tagging a
     link in an email. */
  var REF = (function () {
    var k = 'v12_ref';
    try {
      var held = sessionStorage.getItem(k);
      if (held) return held === 'direct' ? null : held;
    } catch (e) {}

    var found = null;
    try {
      var utm = new URLSearchParams(location.search).get('utm_source');
      if (utm) {
        found = 'utm:' + utm.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
      } else if (document.referrer) {
        var h = new URL(document.referrer).hostname.replace(/^www\./, '');
        // Clicking between our own pages is not a referral.
        if (h && h !== location.hostname.replace(/^www\./, '')) found = h.slice(0, 60);
      }
    } catch (e) {}

    try { sessionStorage.setItem(k, found || 'direct'); } catch (e) {}
    return found;
  })();

  /* ---------- the queue ----------
     Events are batched and sent on a timer or when the page goes away,
     so a visitor clicking through five pages costs five requests rather
     than fifty, and the database write quota stays spent on the things
     that matter. */

  var queue = [];
  var timer = null;
  var MAX_BATCH = 25;

  function flush(useBeacon) {
    if (!queue.length) return;
    var batch = queue.splice(0, MAX_BATCH);
    var body = JSON.stringify({
      visitor_id: VISITOR, session_id: SESSION,
      page: PAGE, ref: REF, device: DEVICE,
      events: batch
    });

    // On the way out, sendBeacon is the only thing the browser promises
    // to deliver. text/plain keeps it a "simple" request, so it goes
    // straight out without a preflight round trip first.
    try {
      if (useBeacon && navigator.sendBeacon) {
        var ok = navigator.sendBeacon(API + '/events',
          new Blob([body], { type: 'text/plain;charset=UTF-8' }));
        if (ok) return;
      }
    } catch (e) {}

    try {
      fetch(API + '/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        cache: 'no-store'
      }).catch(function () {});   // a lost event is not an incident
    } catch (e) {}
  }

  function track(name, detail) {
    if (!name) return;
    queue.push({ n: String(name).slice(0, 32), d: detail ? String(detail).slice(0, 80) : undefined });
    if (queue.length >= MAX_BATCH) { flush(false); return; }
    if (timer) return;
    // A short delay so a burst of clicks rides in one request.
    timer = setTimeout(function () { timer = null; flush(false); }, 4000);
  }

  window.V12_TRACK = track;

  /* ---------- what gets counted automatically ---------- */

  track('pageview');

  // Scroll depth, once each per page. Told in percentages of the page
  // rather than pixels, because the homepage is 7,700px tall and "half
  // way" is the number that means something.
  var hit = {};
  function depth() {
    var doc = document.documentElement;
    var total = Math.max(doc.scrollHeight - window.innerHeight, 1);
    var pct = Math.min(100, Math.round((window.pageYOffset / total) * 100));
    if (pct >= 50 && !hit[50]) { hit[50] = 1; track('scroll_50'); }
    if (pct >= 90 && !hit[90]) { hit[90] = 1; track('scroll_90'); }
    if (hit[50] && hit[90]) window.removeEventListener('scroll', onScroll);
  }
  var scrollTick = false;
  function onScroll() {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(function () { scrollTick = false; depth(); });
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // "Engaged" = 15 seconds with the tab actually in front of them.
  // Counting wall-clock time would count every abandoned tab as a fan.
  var engagedFor = 0, engagedSent = false;
  setInterval(function () {
    if (document.visibilityState !== 'visible' || engagedSent) return;
    engagedFor += 5;
    if (engagedFor >= 15) { engagedSent = true; track('engaged'); }
  }, 5000);

  /* ---------- clicks ----------
     One delegated listener classifies every link on the site, so no
     page needs markup added to it and a new link is tracked the moment
     it is written. */

  var PLATFORMS = {
    'open.spotify.com': 'spotify', 'spotify.com': 'spotify',
    'music.apple.com': 'apple music', 'apple.com': 'apple music',
    'youtube.com': 'youtube', 'youtu.be': 'youtube', 'music.youtube.com': 'youtube music',
    'soundcloud.com': 'soundcloud', 'music.amazon.com': 'amazon music',
    'deezer.com': 'deezer', 'tidal.com': 'tidal',
    'instagram.com': 'instagram', 'tiktok.com': 'tiktok', 'twitch.tv': 'twitch',
    'x.com': 'x', 'twitter.com': 'twitter', 'facebook.com': 'facebook',
    'linktr.ee': 'linktree', 'link.me': 'linkme'
  };
  var STREAMING = /spotify|apple|youtube|soundcloud|amazon music|deezer|tidal/;

  // The label for a buy button: the product it sits next to. All 14 of
  // them say "Buy Now", so the link's own text is worthless here — the
  // name is in the card around it (.plabel on the shop grid, a heading
  // or a bold line anywhere else).
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim().slice(0, 60); }

  function productLabel(el) {
    var card = el.closest && el.closest('.prod, .product, .item, [class*="card"], article, li');
    if (card) {
      var head = card.querySelector('.plabel, h1, h2, h3, h4, .name, .title, .body > b, b');
      var named = clean(head && head.textContent);
      if (named) return named;
    }
    return clean(el.textContent) || null;
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target && ev.target.closest && ev.target.closest('a[href], button');
    if (!el) return;

    var label = (el.getAttribute('aria-label') || el.textContent || '')
      .replace(/\s+/g, ' ').trim().slice(0, 60);

    if (el.tagName === 'BUTTON') {
      if (label) track('cta_click', label);
      return;
    }

    var href = el.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;

    if (/^mailto:/i.test(href)) { track('contact_click', 'email'); return; }
    if (/^tel:/i.test(href))    { track('contact_click', 'phone'); return; }

    var host;
    try { host = new URL(href, location.href).hostname.replace(/^www\./, ''); }
    catch (e) { return; }

    if (host === location.hostname.replace(/^www\./, '')) {
      track('nav_click', href.split('?')[0].slice(0, 60));
      return;
    }

    // Square hosts the checkout, so a click on one is the closest thing
    // this site has to a till ringing.
    if (/square(up)?\.(com|link)|checkout\.square/.test(host)) {
      track('buy_click', productLabel(el));
      return;
    }

    var platform = PLATFORMS[host];
    if (platform) {
      track(STREAMING.test(platform) ? 'stream_click' : 'social_click', platform);
      return;
    }

    track('outbound', host);
  }, true);

  /* ---------- media ---------- */

  document.addEventListener('play', function (ev) {
    var t = ev.target;
    if (!t || (t.tagName !== 'AUDIO' && t.tagName !== 'VIDEO')) return;
    track(t.tagName === 'AUDIO' ? 'audio_play' : 'video_play',
          (t.getAttribute('data-title') || t.currentSrc || '').split('/').pop().slice(0, 60));
  }, true);

  /* ---------- send what's left when they leave ---------- */

  window.addEventListener('pagehide', function () { flush(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
  });
})();
