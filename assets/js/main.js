/* ================================================================
   SoundsOfV12 — global site JS
   Mobile menu · LIVE status · Join-the-Rari's · active nav · PWA
   No dependencies. Works from file:// and hosted.
   ================================================================ */
(function () {
  'use strict';

  /* ---------- CONFIG ---------- */
  var CFG = {
    tiktok: 'https://www.tiktok.com/@soundsofv12',
    // Signups go to Supabase when assets/js/config.js is filled in.
    // joinEndpoint is an optional override for a different capture
    // service (Formspree, a Worker, etc.) and takes precedence.
    // With neither configured the form does NOT claim success — it
    // says signups aren't open, because nothing is delivered anywhere.
    joinEndpoint: '',
    // When live, flip via localStorage 'v12_live'='1' OR a real API poll.
    liveOverride: null           // true / false to force; null = auto (localStorage)
  };

  var SUPA = window.V12_SUPA || null;
  var TABLES = (window.V12_CONFIG && window.V12_CONFIG.tables) || {};

  /* ---------- helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---------- active nav link ---------- */
  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  $all('[data-nav]').forEach(function (a) {
    var t = a.getAttribute('data-nav').toLowerCase();
    if (t === here || (here === '' && t === 'index.html')) a.classList.add('active', 'on');
  });

  /* ---------- mobile drawer ---------- */
  var drawer = $('#drawer');
  $('#burger') && $('#burger').addEventListener('click', function () { drawer && drawer.classList.add('open'); });
  drawer && drawer.addEventListener('click', function (e) {
    if (e.target === drawer || e.target.closest('.x') || e.target.tagName === 'A') drawer.classList.remove('open');
  });

  /* ---------- LIVE status ---------- */
  function isLive() {
    if (CFG.liveOverride !== null) return CFG.liveOverride;
    return store('v12_live') === '1';
  }
  function paintLive() {
    var on = isLive();
    $all('.livebanner, .livepill').forEach(function (el) { el.classList.toggle('on', on); });
    $all('[data-live-link]').forEach(function (a) { a.href = CFG.tiktok; });
  }
  paintLive();
  // lets you demo it: type v12live() in console, or ?live=1 in URL
  if (/[?&]live=1/.test(location.search)) { store('v12_live', '1'); paintLive(); }
  if (/[?&]live=0/.test(location.search)) { store('v12_live', '0'); paintLive(); }
  window.v12live = function (on) { store('v12_live', on === false ? '0' : '1'); paintLive(); return isLive(); };

  /* ---------- Join the Rari's ---------- */
  $all('form[data-join]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input');
      var val = (input && input.value || '').trim();
      if (!val || (val.indexOf('@') < 0 && val.replace(/\D/g, '').length < 7)) {
        input && input.focus();
        input && (input.style.borderColor = 'var(--red)');
        return;
      }
      var okBox = form.parentNode.querySelector('.ok-msg');
      var payload = { contact: val, ts: Date.now(), page: here };
      var btn = form.querySelector('button[type=submit]');
      var btnTxt = btn && btn.textContent;

      function show(msg) {
        if (!okBox) return;
        okBox.innerHTML = msg;
        okBox.classList.add('show');
      }
      function reset() {
        if (btn) { btn.disabled = false; btn.textContent = btnTxt; }
      }

      // Nothing configured = nothing is delivered anywhere. Say so rather
      // than telling the visitor to check an inbox that will stay empty.
      if (!CFG.joinEndpoint && !SUPA) {
        show("Signups open in a moment — follow <a href='https://www.instagram.com/soundsofv12/'>@soundsofv12</a> and you won't miss the first drop.");
        return;
      }

      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

      function ok() {
        try {
          var list = JSON.parse(store('v12_raris') || '[]');
          list.push(payload); store('v12_raris', JSON.stringify(list));
        } catch (e2) {}
        show("🏁 You're in, Rari. Check your inbox — first drop, live alerts &amp; unreleased heat incoming.");
        form.reset();
      }
      function fail() {
        show("That didn't go through. Try again, or DM <a href='https://www.instagram.com/soundsofv12/'>@soundsofv12</a> and we'll add you manually.");
      }

      var isEmail = val.indexOf('@') > -1;
      var req = CFG.joinEndpoint
        ? fetch(CFG.joinEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
          }).then(function (r) { if (!r.ok) throw new Error('bad status ' + r.status); })
        : SUPA.insert(TABLES.signups || 'rari_signups', {
            email: isEmail ? val : null,
            phone: isEmail ? null : val,
            source_page: here,
            visitor_id: window.V12_VISITOR || null
          });

      req.then(ok).catch(fail).then(reset, reset);
    });
    form.querySelector('input') && form.querySelector('input').addEventListener('input', function () { this.style.borderColor = ''; });
  });

  /* ---------- Rari counter ----------
     Only renders a member count when a real one is supplied (set
     window.V12_RARI_COUNT from the backend once signups are wired).
     Otherwise the whole stat is removed — an invented number is worse
     than no number. */
  $all('[data-rari-count]').forEach(function (el) {
    var real = window.V12_RARI_COUNT;
    if (typeof real === 'number' && isFinite(real) && real > 0) {
      el.textContent = real.toLocaleString();
    } else {
      var stat = el.closest ? el.closest('.s') : null;
      if (stat && stat.parentNode) stat.parentNode.removeChild(stat);
    }
  });

  /* ---------- year ---------- */
  $all('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ---------- PWA ---------- */
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
  // install prompt
  var deferred;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    $all('[data-install]').forEach(function (b) {
      b.style.display = 'inline-flex';
      b.addEventListener('click', function () { deferred && deferred.prompt(); });
    });
  });
})();

/* ================================================================
   V3: preloader · scroll reveals · gallery self-clean
   ================================================================ */
(function () {
  'use strict';
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' }) : null;
  document.querySelectorAll('.rv').forEach(function (el) { io ? io.observe(el) : el.classList.add('in'); });

  var pre = document.getElementById('pre');
  if (pre) {
    if (sessionStorage.getItem('v12pre')) { pre.remove(); }
    else {
      try { sessionStorage.setItem('v12pre', '1'); } catch (e) {}
      setTimeout(function () { pre.classList.add('done'); setTimeout(function () { pre.remove(); }, 700); }, 1250);
    }
  }
  document.querySelectorAll('.strip').forEach(function (s) {
    setTimeout(function () {
      if (!s.querySelector('img')) { var sec = s.closest('section'); if (sec) sec.style.display = 'none'; }
    }, 900);
  });
})();

/* ================================================================
   V3.1 — RUMBA background player (global, discreet, persistent)
   Autoplay when allowed; else starts on first tap. Position and
   pause-state survive page navigation. Hides itself if no mp3.
   ================================================================ */
(function () {
  'use strict';
  if (document.getElementById('v12audio')) return;
  var SRC = 'assets/audio/rumba.mp3';
  var a = new Audio();
  a.loop = true; a.volume = 0.55; a.preload = 'auto'; a.src = SRC;

  var pill = document.createElement('div');
  pill.id = 'v12audio';
  pill.setAttribute('role', 'button');
  pill.setAttribute('aria-label', 'Play or pause RUMBA');
  pill.innerHTML = '<span class="eq"><span></span><span></span><span></span></span>' +
                   '<span class="t">RUMBA — V12</span><span class="btn-ic">▶</span>';
  document.body.appendChild(pill);
  var ic = pill.querySelector('.btn-ic');

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function paint() {
    var on = !a.paused;
    pill.classList.toggle('playing', on);
    ic.textContent = on ? '❚❚' : '▶';
  }
  a.addEventListener('play', paint);
  a.addEventListener('pause', paint);
  a.addEventListener('error', function () { pill.classList.add('gone'); });

  // resume position across pages
  a.addEventListener('loadedmetadata', function () {
    var t = parseFloat(get('v12_audio_t') || '0');
    if (isFinite(t) && t > 0 && t < (a.duration || 1e9) - 2) { try { a.currentTime = t; } catch (e) {} }
  });
  function savePos() { if (a.currentTime > 0) set('v12_audio_t', String(a.currentTime)); }
  setInterval(savePos, 3000);
  window.addEventListener('pagehide', savePos);
  document.addEventListener('visibilitychange', function () { if (document.hidden) savePos(); });

  var armed = false;
  function armGesture() {
    if (armed) return; armed = true;
    var go = function () {
      document.removeEventListener('pointerdown', go, true);
      document.removeEventListener('keydown', go, true);
      if (get('v12_audio') !== 'off') a.play().catch(function () {});
    };
    document.addEventListener('pointerdown', go, true);
    document.addEventListener('keydown', go, true);
  }

  pill.addEventListener('click', function (ev) {
    ev.stopPropagation();
    if (a.paused) { set('v12_audio', 'on'); a.play().catch(function () {}); }
    else { set('v12_audio', 'off'); a.pause(); savePos(); }
  });

  // default: ON (unless user paused previously)
  if (get('v12_audio') !== 'off') {
    a.play().catch(armGesture);   // blocked -> first tap starts it
  }
  paint();
})();
