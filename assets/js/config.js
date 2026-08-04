/* ================================================================
   SoundsOfV12 — backend config

   THIS IS THE ONLY FILE YOU EDIT to turn the site's live features on.
   Paste the API URL below, commit, done.

   The backend is our own: a small Cloudflare Worker over a D1 (SQLite)
   database, source in /backend. See backend/README.md for the ~10
   minute deploy. There is no API key here and none is needed — the
   Worker exposes only the routes the site actually uses, and the
   signup and opt-out lists have no read route at all.
   ================================================================ */
window.V12_CONFIG = {
  // e.g. 'https://soundsofv12-api.<your-subdomain>.workers.dev'
  // or a custom route like 'https://api.soundsofv12.com'
  apiUrl: 'https://soundsofv12-api.soundsofv12.workers.dev',

  // Set once signups are flowing and you want the real number on the
  // Rari page. Left null, the stat hides itself rather than inventing one.
  rariCount: null
};

/* Thin client over our API. Returns null when no backend is configured,
   which is how each feature knows to fall back to local-only mode
   instead of failing loudly. */
window.V12_API = (function () {
  var base = (window.V12_CONFIG && window.V12_CONFIG.apiUrl || '').replace(/\/+$/, '');
  if (!base) return null;

  function req(path, opts) {
    opts = opts || {};
    return fetch(base + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      // Reads run right after a write to refresh the UI and share a URL
      // with the previous read. Without this the browser can serve the
      // stale one and the visitor sees their own post fail to appear.
      cache: 'no-store'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
        return data;
      });
    });
  }

  return {
    signup: function (contact, page, visitor) {
      return req('/signup', { method: 'POST', body: {
        contact: contact, source_page: page, visitor_id: visitor } });
    },
    wall: function () { return req('/wall'); },
    post: function (name, city, text, visitor) {
      return req('/wall', { method: 'POST', body: {
        name: name, city: city, text: text, visitor_id: visitor } });
    },
    votes: function (poll, visitor) {
      return req('/votes?poll=' + encodeURIComponent(poll) +
                 (visitor ? '&visitor_id=' + encodeURIComponent(visitor) : ''));
    },
    vote: function (poll, choice, visitor) {
      return req('/votes', { method: 'POST', body: {
        poll: poll, choice: choice, visitor_id: visitor } });
    },
    optout: function (email, source) {
      return req('/optout', { method: 'POST', body: { email: email, source: source } });
    }
  };
})();

/* Stable per-browser id. Keeps one visitor from stuffing a poll and lets
   someone see their own wall post highlighted. Not an identity, and not
   security — just a de-duplication key. */
window.V12_VISITOR = (function () {
  try {
    var k = 'v12_visitor_id', v = localStorage.getItem(k);
    if (!v) {
      v = (crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(k, v);
    }
    return v;
  } catch (e) { return 'anon'; }
})();

/* Back-compat: raris.html reads this for the member count. */
window.V12_RARI_COUNT = (window.V12_CONFIG && window.V12_CONFIG.rariCount) || undefined;
