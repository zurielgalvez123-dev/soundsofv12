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
        .then(function () {
          if (window.V12_TRACK) window.V12_TRACK('wall_post');
          // The wall is the one place someone tells us what to call them,
          // so it is what the Rari card puts on the front.
          try { localStorage.setItem('v12_rari_name', name); } catch (e) {}
          if (window.V12_PAINT_CARD) window.V12_PAINT_CARD();
          wf.reset(); loadLive(); done('🏁 Posted! You\'re on the wall, Rari.');
        })
        .catch(function (e) {
          done(/slow down/i.test(e.message)
            ? 'Easy — give it a minute before posting again.'
            : 'That didn\'t post. Give it another shot in a second.');
        });
    });
  }

  /* ---------------- POLLS ----------------
     Questions, options and deadlines come from the API, so V12 can add
     or close a poll from the admin page without anyone editing HTML.

     Results behave the way people expect from Instagram: you see nothing
     until you have voted, then the whole board opens up with bars, counts
     and your pick marked. Once a poll's deadline passes, results are
     public whether you voted or not — there is nothing left to influence.

     Percentages need a denominator worth having. Under PCT_FLOOR total
     votes the raw count shows instead, because "100%" off one vote reads
     as a lie even when the arithmetic is right. */
  var PCT_FLOOR = 20;

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // 'YYYY-MM-DD HH:MM:SS' from SQLite is UTC with no marker — the same
  // shape parseTs already fixes for the wall.
  function closesIn(iso) {
    var ms = parseTs(iso) - Date.now();
    if (ms <= 0) return null;
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return plural(d, 'day', 'days') + ' left';
    if (h >= 1) return plural(h, 'hour', 'hours') + ' left';
    return plural(Math.max(m, 1), 'minute', 'minutes') + ' left';
  }

  var board = $('[data-polls]');
  if (board && API) {
    var polls = [];

    function renderPoll(p) {
      // Reveal on vote, or once voting is over.
      var show = !!p.mine || p.closed;
      var left = p.closed ? null : closesIn(p.closes_at);

      var head = '<b>' + esc(p.question) + '</b>' +
        (p.subtitle ? '<p class="muted small">' + esc(p.subtitle) + '</p>' : '') +
        '<div class="pollmeta">' +
          (p.closed ? '<span class="pollclosed">Voting closed</span>'
                    : (left ? '<span class="polltime">' + esc(left) + '</span>' : '')) +
          (show ? '<span>' + plural(p.total, 'vote', 'votes') + '</span>' : '') +
        '</div>';

      var opts = p.options.map(function (o) {
        var pct = p.total ? Math.round(o.votes / p.total * 100) : 0;
        var mine = p.mine === o.key;
        var right = !show ? ''
          : (p.total < PCT_FLOOR ? plural(o.votes, 'vote', 'votes') : pct + '%');
        return '<button class="opt' + (mine ? ' voted' : '') + (show ? ' revealed' : '') + '"' +
          (p.closed ? ' disabled' : '') +
          ' data-poll="' + esc(p.id) + '" data-opt="' + esc(o.key) + '">' +
          '<span class="bar" style="width:' + (show ? pct : 0) + '%"></span>' +
          '<span class="lbl"><span>' + (mine ? '<i class="tick">✓</i>' : '') + esc(o.label) +
          '</span><span class="pct">' + esc(right) + '</span></span></button>';
      }).join('');

      return '<div class="poll" data-pollid="' + esc(p.id) + '">' + head + opts +
        (show ? '' : '<p class="note">Vote to see the results.</p>') + '</div>';
    }

    function paint() {
      if (!polls.length) {
        board.innerHTML = '<div class="poll pollempty"><b>No polls running right now.</b>' +
          '<p class="muted small">Next one drops with the next release.</p></div>';
        return;
      }
      board.innerHTML = polls.map(renderPoll).join('');
    }

    function load() {
      return API.polls(ME).then(function (d) {
        polls = d.polls || [];
        paint();
      });
    }

    board.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('.opt');
      if (!b || b.disabled) return;
      var id = b.getAttribute('data-poll'), key = b.getAttribute('data-opt');
      var p = polls.filter(function (x) { return x.id === id; })[0];
      if (!p || p.closed || p.mine === key) return;

      // Paint the answer immediately, then reconcile. A vote that the
      // server refused must not leave a tick sitting on the screen.
      var before = JSON.parse(JSON.stringify(p));
      var opt = function (k) { return p.options.filter(function (o) { return o.key === k; })[0]; };
      if (p.mine && opt(p.mine)) opt(p.mine).votes--; else p.total++;
      if (opt(key)) opt(key).votes++;
      p.mine = key;
      paint();

      API.vote(id, key, ME).then(function () {
        if (window.V12_TRACK) window.V12_TRACK('poll_vote', id + ':' + key);
        return load();
      }).catch(function (e) {
        var i = polls.indexOf(p);
        if (i >= 0) polls[i] = before;
        paint();
        if (/closed/i.test(e.message || '')) load();
      });
    });

    board.innerHTML = '<div class="poll pollempty"><b>Loading the polls…</b></div>';
    load().catch(function () {
      board.innerHTML = '<div class="poll pollempty"><b>Polls didn\'t load.</b>' +
        '<p class="muted small">Refresh in a moment.</p></div>';
    });
  }

})();
