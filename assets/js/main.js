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
  };

  var API = window.V12_API || null;

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

  /* ---------- LIVE status ----------
     GET /live on our Worker checks Twitch, TikTok, Kick and YouTube
     (edge-cached for a minute) and answers per platform: true, false,
     or null when a platform could not be read. Null shows nothing, so a
     check that failed never tells a fan he is offline when he is not.
     ?live=1 / ?live=0 in the URL forces the look for testing. */
  var LIVE_NAMES = { twitch: 'Twitch', tiktok: 'TikTok', kick: 'Kick', youtube: 'YouTube' };
  function paintLive(d) {
    var force = /[?&]live=([01])/.exec(location.search);
    var plats = (d && d.platforms) || {};
    var on = force ? force[1] === '1' : !!(d && d.live);
    var where = Object.keys(LIVE_NAMES).filter(function (k) { return plats[k] && plats[k].live === true; });
    var href = where.length ? plats[where[0]].url : CFG.tiktok;
    $all('.livebanner, .livepill').forEach(function (el) { el.classList.toggle('on', on); });
    document.documentElement.classList.toggle('v12-live', on);
    $all('[data-live-link]').forEach(function (a) { a.href = href; });
    $all('.livebanner a').forEach(function (a) {
      a.textContent = '🔴 V12 IS LIVE RIGHT NOW' + (where.length ? ' on ' + where.map(function (k) { return LIVE_NAMES[k]; }).join(' + ') : '') + ' — tap in →';
    });
    $all('.tbtn').forEach(function (btn) {
      var k = Object.keys(LIVE_NAMES).filter(function (n) { return btn.classList.contains(n); })[0];
      var st = k && plats[k] ? plats[k].live : null;
      btn.classList.toggle('is-live', st === true);
      btn.classList.toggle('is-off', st === false);
      var tag = btn.querySelector('.lstate');
      if (st === null || st === undefined) { if (tag) tag.remove(); return; }
      if (!tag) { tag = document.createElement('span'); tag.className = 'lstate'; btn.appendChild(tag); }
      tag.textContent = st ? 'LIVE NOW' : 'Offline';
    });
    $all('[data-live-summary]').forEach(function (el) {
      el.textContent = !d ? '' : on
        ? 'He’s live right now on ' + where.map(function (k) { return LIVE_NAMES[k]; }).join(' and ') + '.'
        : 'He’s not live right now. Get a Rari alert for the next one.';
    });
  }
  var LIVE_API = ((window.V12_CONFIG && window.V12_CONFIG.apiUrl) || '').replace(/\/+$/, '');
  function checkLive() {
    if (!LIVE_API) return;
    fetch(LIVE_API + '/live').then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) paintLive(d); }).catch(function () {});
  }
  paintLive(null);
  checkLive();
  setInterval(function () { if (!document.hidden) checkLive(); }, 60000);

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
      if (!CFG.joinEndpoint && !API) {
        show("Signups open in a moment — follow <a href='https://www.instagram.com/soundsofv12/'>@soundsofv12</a> and you won't miss the first drop.");
        return;
      }

      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      // Both halves are worth counting: the gap between them is the
      // form failing people, not people losing interest.
      if (window.V12_TRACK) window.V12_TRACK('signup_submit', here);

      function ok(res) {
        if (window.V12_TRACK) window.V12_TRACK('signup_ok', here);
        try {
          var list = JSON.parse(store('v12_raris') || '[]');
          list.push(payload); store('v12_raris', JSON.stringify(list));
        } catch (e2) {}

        // The member number is the real signup row id from the backend,
        // so the card shows the number they actually hold.
        if (res && res.member) {
          store('v12_member_no', String(res.member));
          store('v12_member_contact', val);
          paintRariCard();
        }

        // Say what will actually happen. Email confirmation is live;
        // texts are not switched on yet, and telling someone to watch
        // their phone for a message that is never sent is the exact
        // thing that makes the rest of the site feel fake.
        var isEmail = val.indexOf('@') > -1;
        show(isEmail
          ? "🏁 You're in, Rari. Check your inbox — the welcome is on its way, " +
            "and you'll get the drops before anyone."
          : "🏁 You're in, Rari. Your number is saved. Texts aren't switched on yet, " +
            "so add an email too if you want the drops in your inbox now.");
        form.reset();
      }
      function fail() {
        show("That didn't go through. Try again, or DM <a href='https://www.instagram.com/soundsofv12/'>@soundsofv12</a> and we'll add you manually.");
      }

      var req = CFG.joinEndpoint
        ? fetch(CFG.joinEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
          }).then(function (r) { if (!r.ok) throw new Error('bad status ' + r.status); })
        : API.signup(val, here, window.V12_VISITOR || null);

      req.then(ok).catch(fail).then(reset, reset);
    });
    form.querySelector('input') && form.querySelector('input').addEventListener('input', function () { this.style.borderColor = ''; });
  });

  /* ---------- booking inquiries ----------
     Separate from the Rari signup on purpose. This form has five fields
     and every one of them matters; the signup handler only ever looked
     at the first input, which is how a booking form ended up silently
     throwing away the date, the city, the budget and the brief. */
  $all('form[data-booking]').forEach(function (form) {
    var okBox = form.querySelector('.ok-msg');
    var btn = form.querySelector('button[type=submit]');
    var btnTxt = btn && btn.textContent;

    function show(msg) { if (okBox) { okBox.innerHTML = msg; okBox.classList.add('show'); } }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = function (n) { var el = form.querySelector('[name="' + n + '"]'); return el ? el.value.trim() : ''; };
      var name = f('name'), contact = f('contact');
      if (!name || !contact) return;

      // Nowhere to send it is a reason to say so, not to fake a receipt.
      if (!API) {
        show('Send it to <a href="mailto:booking@soundsofv12.com">booking@soundsofv12.com</a> — ' +
             'the form isn\'t connected yet and we don\'t want your inquiry to vanish.');
        return;
      }

      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      if (window.V12_TRACK) window.V12_TRACK('booking_submit', f('kind') || 'inquiry');

      API.booking({
        name: name, contact: contact, kind: f('kind'),
        when: f('when'), details: f('details'),
        visitor_id: window.V12_VISITOR || null
      }).then(function () {
        if (window.V12_TRACK) window.V12_TRACK('booking_ok', f('kind') || 'inquiry');
        show('🏁 Got it. Your inquiry is with management — expect a reply within 2 business days.');
        form.reset();
      }).catch(function (err) {
        show(/slow down/i.test(err.message || '')
          ? 'Give it a minute before sending another one.'
          : 'That didn\'t send. Email <a href="mailto:booking@soundsofv12.com">booking@soundsofv12.com</a> ' +
            'directly and it\'ll get read.');
      }).then(function () {
        if (btn) { btn.disabled = false; btn.textContent = btnTxt; }
      });
    });
  });

  /* ---------- the Rari card ----------
     The card used to be a mock-up: "#0512" and "YOUR NAME" were printed
     in the HTML for everyone. Now it shows the member number the backend
     actually issued — the signup's own row id, so #1 really was first —
     and stays blank-but-honest for anyone who has not joined.

     The name is whatever they signed the wall with, because that is the
     only place on the site they tell us what to call them. */
  function paintRariCard() {
    var noEl = $('[data-rari-no]'), nameEl = $('[data-rari-name]');
    if (!noEl && !nameEl) return;
    var no = store('v12_member_no');
    var name = store('v12_rari_name');
    var contact = store('v12_member_contact') || '';

    if (noEl) {
      noEl.textContent = no
        ? '#' + String(no).padStart(4, '0')
        : '#————';
    }
    if (nameEl) {
      if (name) nameEl.textContent = name.toUpperCase();
      else if (contact) {
        nameEl.textContent = (contact.indexOf('@') > -1
          ? contact.split('@')[0] : contact).toUpperCase();
      } else nameEl.textContent = 'NOT A RARI YET';
    }
    var card = noEl && noEl.closest ? noEl.closest('.raricard') : null;
    if (card) card.classList.toggle('claimed', !!no);
  }
  window.V12_PAINT_CARD = paintRariCard;
  paintRariCard();

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
   V12 player — every release from Casa Del Perreo to now
   (global, discreet, persistent)

   Each visit starts on a different song: a fresh shuffle per tab
   session, and never the song the last visit opened with. The song and
   position survive clicking between pages but not closing the tab.
   Shuffle and the on/off preference persist. Tracks live in
   data/playlist.json; a track that fails to load is skipped.
   Autoplay when allowed; else starts on first neutral tap.
   ================================================================ */
(function () {
  'use strict';
  if (document.getElementById('v12audio')) return;

  function sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Older builds kept RUMBA's position under these keys.
  try { localStorage.removeItem('v12_audio_t'); sessionStorage.removeItem('v12_audio_t'); } catch (e) {}

  fetch('data/playlist.json').then(function (r) { return r.json(); }).then(function (d) {
    var tracks = (d && d.tracks) || [];
    if (tracks.length) start(tracks);
  }).catch(function () {});

  function shuffled(n, avoidFirst) {
    var o = [];
    for (var i = 0; i < n; i++) o.push(i);
    for (var j = n - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)); var t = o[j]; o[j] = o[k]; o[k] = t; }
    if (n > 1 && o[0] === avoidFirst) { o.push(o.shift()); }
    return o;
  }

  function start(tracks) {
    var N = tracks.length;
    var shuffle = get('v12_shuffle') !== 'off';

    // Session state: play order, position in it, time in the song.
    var order, pos;
    try { order = JSON.parse(sget('v12_pl_order') || 'null'); } catch (e) { order = null; }
    pos = parseInt(sget('v12_pl_pos') || '', 10);
    if (!order || order.length !== N || !(pos >= 0 && pos < N)) {
      var last = parseInt(get('v12_pl_last') || '', 10);
      order = shuffle ? shuffled(N, last) : null;
      if (!order) {
        // In order (newest first), from a random song, not last visit's.
        var s0 = Math.floor(Math.random() * N);
        if (N > 1 && s0 === last) s0 = (s0 + 1) % N;
        order = []; for (var i = 0; i < N; i++) order.push((s0 + i) % N);
      }
      pos = 0;
      set('v12_pl_last', String(order[0]));
      sset('v12_pl_t', '0');
    }
    function saveState() { sset('v12_pl_order', JSON.stringify(order)); sset('v12_pl_pos', String(pos)); }
    saveState();

    var a = new Audio();
    a.volume = 0.55; a.preload = 'auto';

    var pill = document.createElement('div');
    pill.id = 'v12audio';
    pill.innerHTML =
      '<img class="cv" alt="" width="34" height="34">' +
      '<span class="meta"><span class="t"></span><span class="ar"></span></span>' +
      '<button type="button" class="pc pc-prev" aria-label="Previous song">&#9198;&#xFE0E;</button>' +
      '<button type="button" class="pc pc-play" aria-label="Play">&#9654;&#xFE0E;</button>' +
      '<button type="button" class="pc pc-next" aria-label="Next song">&#9197;&#xFE0E;</button>' +
      '<button type="button" class="pc pc-shuf" aria-label="Shuffle" aria-pressed="false">&#8644;&#xFE0E;</button>' +
      '<span class="bar"><i></i></span>';
    document.body.appendChild(pill);
    var $p = function (s) { return pill.querySelector(s); };
    var playBtn = $p('.pc-play'), shufBtn = $p('.pc-shuf'), barFill = $p('.bar i');

    function cur() { return tracks[order[pos]]; }

    function paint() {
      var on = !a.paused;
      pill.classList.toggle('playing', on);
      playBtn.innerHTML = on ? '&#10074;&#10074;' : '&#9654;&#xFE0E;';
      playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
      shufBtn.classList.toggle('on', shuffle);
      shufBtn.setAttribute('aria-pressed', shuffle ? 'true' : 'false');
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
    }

    var resumeAt = parseFloat(sget('v12_pl_t') || '0');
    function load(autoplay) {
      var t = cur();
      a.src = t.src;
      $p('.cv').src = t.cover;
      $p('.t').textContent = t.title;
      $p('.ar').textContent = t.artist;
      pill.title = t.title + ' — ' + t.artist;
      barFill.style.width = '0%';
      saveState();
      if ('mediaSession' in navigator && window.MediaMetadata) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: t.title, artist: t.artist, album: t.release,
          artwork: [{ src: t.cover.replace('200x200bb', '600x600bb'), sizes: '600x600', type: 'image/jpeg' }]
        });
      }
      if (autoplay) a.play().catch(function () {});
    }

    function go(step) {
      resumeAt = 0; sset('v12_pl_t', '0');
      pos = (pos + step + N) % N;
      load(true);
      set('v12_audio', 'on');
    }
    function prev() {
      // Like every player: early in a song goes back a song, later restarts it.
      if (a.currentTime > 4) { a.currentTime = 0; return; }
      go(-1);
    }
    function toggleShuffle() {
      shuffle = !shuffle;
      set('v12_shuffle', shuffle ? 'on' : 'off');
      var now = order[pos];
      if (shuffle) {
        var rest = shuffled(N).filter(function (i) { return i !== now; });
        order = [now].concat(rest);
      } else {
        order = []; for (var i = 0; i < N; i++) order.push((now + i) % N);
      }
      pos = 0; saveState(); paint();
    }

    a.addEventListener('play', paint);
    a.addEventListener('pause', paint);
    a.addEventListener('ended', function () { go(1); });
    var fails = 0;
    a.addEventListener('error', function () {
      if (++fails >= N) { pill.classList.add('gone'); return; }
      go(1);
    });
    a.addEventListener('playing', function () { fails = 0; });
    a.addEventListener('loadedmetadata', function () {
      if (isFinite(resumeAt) && resumeAt > 0 && resumeAt < (a.duration || 1e9) - 2) {
        try { a.currentTime = resumeAt; } catch (e) {}
      }
      resumeAt = 0;
    });
    a.addEventListener('timeupdate', function () {
      if (a.duration) barFill.style.width = (100 * a.currentTime / a.duration).toFixed(2) + '%';
    });
    function savePos() { if (a.currentTime > 0) sset('v12_pl_t', String(a.currentTime)); }
    setInterval(savePos, 3000);
    window.addEventListener('pagehide', savePos);
    document.addEventListener('visibilitychange', function () { if (document.hidden) savePos(); });

    playBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (a.paused) { set('v12_audio', 'on'); a.play().catch(function () {}); }
      else { set('v12_audio', 'off'); a.pause(); savePos(); }
    });
    $p('.pc-next').addEventListener('click', function (ev) { ev.stopPropagation(); go(1); });
    $p('.pc-prev').addEventListener('click', function (ev) { ev.stopPropagation(); prev(); });
    shufBtn.addEventListener('click', function (ev) { ev.stopPropagation(); toggleShuffle(); });

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', function () { set('v12_audio', 'on'); a.play(); });
        navigator.mediaSession.setActionHandler('pause', function () { set('v12_audio', 'off'); a.pause(); });
        navigator.mediaSession.setActionHandler('nexttrack', function () { go(1); });
        navigator.mediaSession.setActionHandler('previoustrack', prev);
      } catch (e) {}
    }

    var armed = false;
    function armGesture() {
      if (armed) return; armed = true;
      // Autoplay is blocked until the visitor interacts, so we wait for a
      // gesture — but NOT a gesture that meant something else. Someone
      // tapping a product, a buy button or a link is trying to shop or
      // navigate; answering that with a song makes the site feel like it
      // ignored the tap. Only a click on neutral page furniture starts it.
      var INTENT = 'a,button,input,select,textarea,label,summary,[role="button"],.prod,.rel,.vthumb,.opt,#v12audio';
      var fire = function (ev) {
        if (ev.type === 'pointerdown' && ev.target && ev.target.closest &&
            ev.target.closest(INTENT)) return;
        document.removeEventListener('pointerdown', fire, true);
        document.removeEventListener('keydown', fire, true);
        if (get('v12_audio') !== 'off' && a.paused) a.play().catch(function () {});
      };
      document.addEventListener('pointerdown', fire, true);
      document.addEventListener('keydown', fire, true);
    }

    load(false);
    // default: ON (unless the visitor paused it before)
    if (get('v12_audio') !== 'off') a.play().catch(armGesture);
    paint();
  }
})();
