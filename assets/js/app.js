/* ================================================================
   Rari Zone — Fan Wall + Polls

   NOTE ON DATA: this runs on localStorage, so everything here is
   per-visitor and private to that browser. It is NOT shared between
   fans. No invented posts and no seeded vote counts live in this file
   — a wall of fake fans and pre-loaded poll numbers is worse than an
   empty one. Point SUPA at a Supabase project to make it real and
   shared; until then the UI says plainly that it's local.
   ================================================================ */
(function () {
  'use strict';

  /* Set to a Supabase project to make the wall + polls shared across
     all fans. { url, anonKey } — the anon key is safe to ship publicly
     as long as Row Level Security is on. */
  var SUPA = null;

  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function initials(n) { return (n || 'R').trim().split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  function ago(ts) { var s = (Date.now() - ts) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; }

  /* ---------------- FAN WALL ----------------
     Targets #wallfeed, not #wall — the anchor section also carried
     id="wall", and querySelector matched the section first, so rendering
     posts wiped out the entire section including the submit form. */
  var wall = $('#wallfeed');
  if (wall) {
    var loadWall = function () {
      var posts = get('v12_wall', []);
      if (!posts.length) {
        wall.innerHTML = '<div class="wallpost wallempty">' +
          '<p><b>Nobody\'s signed it yet.</b> Be the first name on the wall — ' +
          'the early ones get read on stream.</p></div>';
        return;
      }
      wall.innerHTML = posts.sort(function (a, b) { return b.ts - a.ts; }).map(function (p) {
        return '<div class="wallpost"><div class="who"><div class="av">' + esc(initials(p.name)) +
          '</div><div><b>' + esc(p.name) + '</b> <span>· ' + esc(p.city || 'Rari Nation') + ' · ' + ago(p.ts) +
          '</span></div></div><p>' + esc(p.text) + '</p></div>';
      }).join('');
    };
    loadWall();

    var wf = $('#wallform');
    wf && wf.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('#wname').value.trim(), city = $('#wcity').value.trim(), text = $('#wtext').value.trim();
      if (!name || !text) return;
      var posts = get('v12_wall', []);
      posts.push({ name: name, city: city, text: text, ts: Date.now() });
      set('v12_wall', posts);
      wf.reset();
      var ok = $('#wallok'); if (ok) { ok.classList.add('show'); setTimeout(function () { ok.classList.remove('show'); }, 4000); }
      loadWall();
    });
  }

  /* ---------------- POLLS ----------------
     Counts start at zero and reflect only this browser. Percentages are
     meaningless on a handful of votes, so raw counts show until there
     are enough for a percentage to mean anything. */
  $all('[data-poll]').forEach(function (poll) {
    var id = poll.getAttribute('data-poll');
    var key = 'v12_poll_' + id;
    var opts = $all('.opt', poll);
    var blank = {}; opts.forEach(function (o) { blank[o.getAttribute('data-opt')] = 0; });
    var data = get(key, { votes: blank, mine: null });
    opts.forEach(function (o) { var k = o.getAttribute('data-opt'); if (!(k in data.votes)) data.votes[k] = 0; });

    var PCT_FLOOR = 20; // below this many votes, show counts not percentages

    function total() { var t = 0; for (var k in data.votes) t += data.votes[k]; return t; }
    function paint() {
      var t = total();
      opts.forEach(function (o) {
        var k = o.getAttribute('data-opt'), v = data.votes[k] || 0;
        var pct = t ? Math.round(v / t * 100) : 0;
        $('.bar', o).style.width = (data.mine ? pct : 0) + '%';
        var pctEl = $('.pct', o);
        if (pctEl) {
          if (!data.mine) pctEl.textContent = '';
          else if (t < PCT_FLOOR) pctEl.textContent = v + (v === 1 ? ' vote' : ' votes');
          else pctEl.textContent = pct + '%';
        }
        o.classList.toggle('voted', data.mine === k);
      });
    }
    opts.forEach(function (o) {
      o.addEventListener('click', function () {
        var k = o.getAttribute('data-opt');
        if (data.mine === k) return;
        if (data.mine) data.votes[data.mine]--;
        data.votes[k] = (data.votes[k] || 0) + 1;
        data.mine = k; set(key, data); paint();
      });
    });
    paint();
  });
})();
