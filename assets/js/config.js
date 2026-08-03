/* ================================================================
   SoundsOfV12 — backend config

   THIS IS THE ONLY FILE YOU EDIT to turn the site's live features on.
   Paste the two Supabase values below, commit, done.

   Read SUPABASE-SETUP.md in the repo root for the 5-minute setup
   (creating the project, running the SQL, finding these two values).

   The anon key is DESIGNED to be public — it ships in every Supabase
   web app. Row Level Security is what protects the data, and the SQL
   in the setup doc turns it on. Never paste the `service_role` key
   here; that one bypasses every policy and must stay server-side.
   ================================================================ */
window.V12_CONFIG = {
  // From Supabase → Project Settings → Data API
  supabaseUrl: '',      // e.g. 'https://abcdefghijkl.supabase.co'
  supabaseAnonKey: '',  // the long "anon" / "publishable" key

  // Leave alone unless you renamed the tables in the SQL.
  tables: {
    signups: 'rari_signups',
    wall: 'wall_posts',
    votes: 'poll_votes'
  }
};

/* Small shared helper the other scripts use. Returns null when the
   backend isn't configured yet, which is how every feature knows to
   fall back to local-only mode instead of failing loudly. */
window.V12_SUPA = (function () {
  var c = window.V12_CONFIG || {};
  if (!c.supabaseUrl || !c.supabaseAnonKey) return null;
  var base = c.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/';

  function headers(extra) {
    var h = {
      'apikey': c.supabaseAnonKey,
      'Authorization': 'Bearer ' + c.supabaseAnonKey,
      'Content-Type': 'application/json'
    };
    for (var k in (extra || {})) h[k] = extra[k];
    return h;
  }

  return {
    tables: c.tables,
    // Insert a row. Resolves on success, rejects on any non-2xx.
    insert: function (table, row, opts) {
      opts = opts || {};
      return fetch(base + table, {
        method: 'POST',
        headers: headers({ 'Prefer': opts.returning ? 'return=representation' : 'return=minimal' }),
        body: JSON.stringify(row)
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + ' ' + t); });
        return opts.returning ? r.json() : null;
      });
    },
    // Select rows. `query` is a PostgREST query string, e.g.
    // 'select=*&order=created_at.desc&limit=60'
    //
    // cache:'no-store' matters: these reads run right after a write to
    // refresh the UI, and both requests have identical URLs. Without it
    // the browser can serve the second one from cache and the user sees
    // their own vote or post fail to appear.
    select: function (table, query) {
      return fetch(base + table + '?' + (query || 'select=*'), {
        method: 'GET', headers: headers(), cache: 'no-store'
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + ' ' + t); });
        return r.json();
      });
    },
    // Call a Postgres function exposed over RPC.
    rpc: function (fn, args) {
      return fetch(base.replace('/rest/v1/', '/rest/v1/rpc/') + fn, {
        method: 'POST', headers: headers(), body: JSON.stringify(args || {})
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + ' ' + t); });
        return r.json();
      });
    }
  };
})();

/* Stable per-browser id, used to keep one visitor from stuffing a poll
   and to let someone see their own wall post immediately. Not an
   identity and not security — just a de-dupe key. */
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
