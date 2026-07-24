/* ================================================================
   Rari Zone — Fan Wall + Polls
   Works instantly (localStorage). Swap store() calls for Supabase
   later to make it global/shared. Seed content included.
   ================================================================ */
(function () {
  'use strict';
  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function get(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function initials(n) { return (n || 'R').trim().split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  function ago(ts) { var s = (Date.now() - ts) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; }

  /* ---------------- FAN WALL ---------------- */
  var wall = $('#wall');
  if (wall) {
    var SEED = [
      { name: 'Yandel M.', city: 'Hialeah', text: 'RUMBA been on repeat since the win. 305 stand up 🏁', ts: Date.now() - 3600e3 },
      { name: 'Sofia R.', city: 'Miami Beach', text: 'Caught the live last night, V12 read my name 😭 best stream ever', ts: Date.now() - 7200e3 },
      { name: 'DeeJay Los', city: 'Kendall', text: 'Been a Rari since SEE UUU. This whole run is different.', ts: Date.now() - 26e5 },
      { name: 'Camila', city: 'Doral', text: 'The Ferrari energy is REAL. Need that hoodie asap 🔥', ts: Date.now() - 9e6 },
      { name: 'Marcus T.', city: 'Wynwood', text: 'Sports reaction streams > everything. Miami Heat night was crazy.', ts: Date.now() - 12e6 }
    ];
    function loadWall() {
      var posts = get('v12_wall', null);
      if (!posts) { posts = SEED.slice(); set('v12_wall', posts); }
      wall.innerHTML = posts.sort(function (a, b) { return b.ts - a.ts; }).map(function (p) {
        return '<div class="wallpost"><div class="who"><div class="av">' + esc(initials(p.name)) +
          '</div><div><b>' + esc(p.name) + '</b> <span>· ' + esc(p.city || 'Rari Nation') + ' · ' + ago(p.ts) +
          '</span></div></div><p>' + esc(p.text) + '</p></div>';
      }).join('');
    }
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

  /* ---------------- POLLS ---------------- */
  $all('[data-poll]').forEach(function (poll) {
    var id = poll.getAttribute('data-poll');
    var key = 'v12_poll_' + id;
    var opts = $all('.opt', poll);
    var seed = {}; opts.forEach(function (o) { seed[o.getAttribute('data-opt')] = parseInt(o.getAttribute('data-seed') || '0', 10); });
    var data = get(key, { votes: seed, mine: null });
    // ensure keys
    opts.forEach(function (o) { var k = o.getAttribute('data-opt'); if (!(k in data.votes)) data.votes[k] = 0; });

    function total() { var t = 0; for (var k in data.votes) t += data.votes[k]; return t || 1; }
    function paint() {
      var t = total();
      opts.forEach(function (o) {
        var k = o.getAttribute('data-opt'), v = data.votes[k] || 0, pct = Math.round(v / t * 100);
        $('.bar', o).style.width = (data.mine ? pct : 0) + '%';
        var pctEl = $('.pct', o); if (pctEl) pctEl.textContent = data.mine ? pct + '%' : '';
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
