/* ================================================================
   Rari Zone — Fan Wall + Polls

   Runs in one of two modes:

   LIVE  — window.V12_API is configured (see assets/js/config.js).
           Posts and votes are shared across every fan, in real tables.
   LOCAL — no backend configured yet. Everything stays in this one
           browser and the UI says so plainly. No invented posts and
           no seeded vote counts live in this file: a wall of fake
           fans is worse than an empty one.
   ================================================================ */
(function () {
  'use strict';

  var API = window.V12_API || null;
  var ME = window.V12_VISITOR || 'anon';

  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function initials(n) { return (n || 'R').trim().split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  function ago(ts) {
    var s = (Date.now() - ts) / 1000;
    if (!isFinite(s) || s < 0) s = 0;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" in UTC with no
  // zone marker; Safari refuses to parse that shape at all, and Chrome
  // reads it as local time. Normalise before handing it to Date.
  function parseTs(v) {
    if (!v) return Date.now();
    var iso = String(v).replace(' ', 'T');
    if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso)) iso += 'Z';
    var t = Date.parse(iso);
    return isNaN(t) ? Date.now() : t;
  }

  /* ---------------- FAN WALL ----------------
     Targets #wallfeed, not #wall — the anchor section also carries
     id="wall", and querySelector matched the section first, so
     rendering posts used to wipe out the whole section including the
     submit form. */
  var wall = $('#wallfeed');
  if (wall) {
    var LOCAL_KEY = 'v12_wall';

    var render = function (posts, localOnly) {
      if (!posts.length) {
        wall.innerHTML = '<div class="wallpost wallempty">' +
          '<p><b>Nobody\'s signed it yet.</b> Be the first name on the wall — ' +
          'the early ones get read on stream.</p></div>';
        return;
      }
      wall.innerHTML = posts.map(function (p) {
        var mine = p.visitor_id && p.visitor_id === ME;
        return '<div class="wallpost' + (mine ? ' mine' : '') + '"><div class="who"><div class="av">' +
          esc(initials(p.name)) + '</div><div><b>' + esc(p.name) + '</b> <span>· ' +
          esc(p.city || 'Rari Nation') + ' · ' + ago(p.ts) +
          (mine ? ' · <i>you</i>' : '') + '</span></div></div><p>' + esc(p.text) + '</p></div>';
      }).join('') + (localOnly ? '<div class="wallpost wallempty"><p>' +
          'Only you can see this — the shared wall isn\'t switched on yet.</p></div>' : '');
    };

    var loadLocal = function () {
      render(get(LOCAL_KEY, []).slice().sort(function (a, b) { return b.ts - a.ts; }), true);
    };

    var loadLive = function () {
      API.wall().then(function (d) {
        render((d.posts || []).map(function (r) {
          return { name: r.name, city: r.city, text: r.text,
                   visitor_id: r.visitor_id, ts: parseTs(r.created_at) };
        }), false);
      }).catch(loadLocal);
    };

    if (API) loadLive(); else loadLocal();

    var wf = $('#wallform');
    wf && wf.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = $('#wname').value.trim(), city = $('#wcity').value.trim(), text = $('#wtext').value.trim();
      if (!name || !text) return;

      var btn = wf.querySelector('button[type=submit]');
      var label = btn && btn.textContent;
      var ok = $('#wallok');
      function done(msg) {
        if (btn) { btn.disabled = false; btn.textContent = label; }
        if (ok) {
          ok.textContent = msg;
          ok.classList.add('show');
          setTimeout(function () { ok.classList.remove('show'); }, 4000);
        }
      }

      if (!API) {
        var posts = get(LOCAL_KEY, []);
        posts.push({ name: name, city: city, text: text, ts: Date.now(), visitor_id: ME });
        set(LOCAL_KEY, posts);
        wf.reset(); loadLocal();
        done('Posted — but only on this device until the wall goes live.');
        return;
      }

      if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
      API.post(name, city, text, ME)
        .then(function () { wf.reset(); loadLive(); done('🏁 Posted! You\'re on the wall, Rari.'); })
        .catch(function (e) {
          done(/slow down/i.test(e.message)
            ? 'Easy — give it a minute before posting again.'
            : 'That didn\'t post. Give it another shot in a second.');
        });
    });
  }

  /* ---------------- POLLS ----------------
     Percentages are meaningless on a handful of votes, so raw counts
     show until there are enough for one to mean anything. */
  var PCT_FLOOR = 20;

  $all('[data-poll]').forEach(function (poll) {
    var id = poll.getAttribute('data-poll');
    var key = 'v12_poll_' + id;
    var opts = $all('.opt', poll);
    var votes = {}, mine = null;
    opts.forEach(function (o) { votes[o.getAttribute('data-opt')] = 0; });

    function total() { var t = 0; for (var k in votes) t += votes[k]; return t; }

    function paint() {
      var t = total();
      opts.forEach(function (o) {
        var k = o.getAttribute('data-opt'), v = votes[k] || 0;
        var pct = t ? Math.round(v / t * 100) : 0;
        $('.bar', o).style.width = (mine ? pct : 0) + '%';
        var pctEl = $('.pct', o);
        if (pctEl) {
          if (!mine) pctEl.textContent = '';
          else if (t < PCT_FLOOR) pctEl.textContent = v + (v === 1 ? ' vote' : ' votes');
          else pctEl.textContent = pct + '%';
        }
        o.classList.toggle('voted', mine === k);
      });
    }

    function loadLocal() {
      var d = get(key, null);
      if (d) { votes = d.votes || votes; mine = d.mine || null; }
      paint();
    }

    function loadLive() {
      API.votes(id, ME).then(function (d) {
        opts.forEach(function (o) { votes[o.getAttribute('data-opt')] = 0; });
        for (var k in (d.tally || {})) if (k in votes) votes[k] = d.tally[k];
        mine = d.mine || null;
        paint();
      }).catch(loadLocal);
    }

    if (API) loadLive(); else loadLocal();

    opts.forEach(function (o) {
      o.addEventListener('click', function () {
        var k = o.getAttribute('data-opt');
        if (mine === k) return;

        if (!API) {
          if (mine) votes[mine]--;
          votes[k] = (votes[k] || 0) + 1;
          mine = k; set(key, { votes: votes, mine: mine }); paint();
          return;
        }

        // Paint optimistically, then reconcile against the server; roll
        // back if the write failed so the UI never claims a vote landed
        // when it didn't.
        var prev = mine;
        if (prev) votes[prev]--;
        votes[k] = (votes[k] || 0) + 1;
        mine = k; paint();

        API.vote(id, k, ME).then(loadLive).catch(function () {
          votes[k]--; if (prev) votes[prev]++;
          mine = prev; paint();
        });
      });
    });
  });
})();
