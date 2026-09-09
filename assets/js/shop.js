/* ================================================================
   SoundsOfV12 — the store

   Products, prices, sizes and stock come from Fourthwall's Storefront
   API at runtime, so the site never carries a second copy of the
   catalogue that can drift out of date. Fourthwall owns the money: the
   cart is built here, then the buyer is handed to Fourthwall's own
   hosted checkout. No card details ever touch this site.

   The storefront token is PUBLIC by design (Fourthwall calls it a
   storefront token for that reason) — it can read published products
   and build carts, nothing else. It is safe in this file. An admin key
   would not be, and none is used here.

   Configure in assets/js/config.js:
       window.V12_CONFIG.fourthwall = { token: 'ptkn_…' }

   With no token the grid does not pretend: it says the store is opening
   and links to Fourthwall directly if a shop URL is known. A "Buy Now"
   button that goes nowhere is worse than an honest empty shelf.
   ================================================================ */
(function () {
  'use strict';

  var CFG = (window.V12_CONFIG && window.V12_CONFIG.fourthwall) || {};
  var API = (CFG.apiUrl || 'https://storefront-api.fourthwall.com/v1').replace(/\/+$/, '');
  var TOKEN = (CFG.token || '').trim();
  var CURRENCY = CFG.currency || 'USD';
  var COLLECTION = CFG.collection || 'all';
  var CART_KEY = 'v12_fw_cart';

  var grid = document.querySelector('[data-shop-grid]');
  if (!grid) return;

  var state = { products: [], cart: null, checkoutBase: null, open: null };

  /* ---------------- helpers ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function money(m) {
    if (!m || typeof m.value !== 'number') return '';
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency: m.currency || CURRENCY,
        minimumFractionDigits: m.value % 1 ? 2 : 0
      }).format(m.value);
    } catch (e) { return '$' + m.value; }
  }
  function track(name, detail) { if (window.V12_TRACK) window.V12_TRACK(name, detail); }

  function req(path, opts) {
    opts = opts || {};
    var url = API + path + (path.indexOf('?') < 0 ? '?' : '&') +
              'storefront_token=' + encodeURIComponent(TOKEN);
    return fetch(url, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = {};
        try { d = t ? JSON.parse(t) : {}; } catch (e) {}
        if (!r.ok) { var err = new Error(d.message || ('HTTP ' + r.status)); err.status = r.status; throw err; }
        return d;
      });
    });
  }

  /* ---------------- product shape ----------------
     A Fourthwall variant carries its own size/colour attributes. We
     group them so the card shows one price range and the sheet shows
     the real pickers, rather than listing every size as a product. */
  function variantSize(v) { return (v.attributes && v.attributes.size && v.attributes.size.name) || null; }
  function variantColor(v) { return (v.attributes && v.attributes.color && v.attributes.color.name) || null; }
  function inStock(v) {
    if (!v.stock) return true;
    if (v.stock.type === 'UNLIMITED') return true;
    return (v.stock.inStock || 0) > 0;
  }
  function priceRange(p) {
    var vals = (p.variants || []).map(function (v) { return v.unitPrice && v.unitPrice.value; })
      .filter(function (n) { return typeof n === 'number'; });
    if (!vals.length) return '';
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var cur = (p.variants[0].unitPrice || {}).currency;
    return lo === hi ? money({ value: lo, currency: cur })
                     : money({ value: lo, currency: cur }) + '–' + money({ value: hi, currency: cur });
  }
  function image(p, i) {
    var im = (p.images || [])[i || 0];
    return im && (im.url || im.transformedUrl);
  }

  /* ---------------- rendering: grid ---------------- */
  function note(html) {
    grid.innerHTML = '<div class="shopnote">' + html + '</div>';
  }

  function renderGrid() {
    if (!state.products.length) {
      note('<b>Nothing in the store right now.</b><p class="muted small mt-1">' +
           'New drops land here first — get on the list and you will know before anyone.</p>');
      return;
    }
    grid.innerHTML = state.products.map(function (p, i) {
      var img = image(p);
      var sold = (p.variants || []).length && !p.variants.some(inStock);
      return '<article class="prod rv in" data-i="' + i + '">' +
        '<button class="prodhit" type="button" aria-label="View ' + esc(p.name) + '">' +
          '<div class="ph">' + (img
            ? '<img class="pimg" src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="lazy" decoding="async">'
            : '') +
          (sold ? '<span class="soldout">Sold out</span>' : '') + '</div>' +
        '</button>' +
        '<div class="body"><b>' + esc(p.name) + '</b>' +
          '<div class="price">' + esc(priceRange(p)) + '</div>' +
          '<button class="buy-btn" type="button" data-open="' + i + '"' + (sold ? ' disabled' : '') + '>' +
            (sold ? 'Sold out' : 'Choose size') + '</button>' +
        '</div></article>';
    }).join('');
  }

  /* ---------------- rendering: product sheet ---------------- */
  var sheet;
  function ensureSheet() {
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.hidden = true;
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) {
      if (e.target === sheet || e.target.closest('[data-close]')) closeSheet();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !sheet.hidden) closeSheet();
    });
    return sheet;
  }
  function closeSheet() {
    if (!sheet) return;
    sheet.hidden = true;
    document.body.classList.remove('noscroll');
    state.open = null;
  }

  function openProduct(i) {
    var p = state.products[i];
    if (!p) return;
    state.open = { product: p, variant: null };
    track('product_view', p.name);

    var sizes = [], colors = [];
    (p.variants || []).forEach(function (v) {
      var s = variantSize(v), c = variantColor(v);
      if (s && sizes.indexOf(s) < 0) sizes.push(s);
      if (c && colors.indexOf(c) < 0) colors.push(c);
    });

    var el = ensureSheet();
    el.innerHTML =
      '<div class="sheetbox">' +
        '<button class="x" type="button" data-close aria-label="Close">✕</button>' +
        '<div class="sheetgrid">' +
          '<div class="sheetart">' + (image(p) ? '<img src="' + esc(image(p)) + '" alt="' + esc(p.name) + '">' : '') + '</div>' +
          '<div class="sheetinfo">' +
            '<h3 class="h-md">' + esc(p.name) + '</h3>' +
            '<div class="price big" data-price>' + esc(priceRange(p)) + '</div>' +
            (p.description ? '<p class="muted small mt-2">' + esc(p.description).slice(0, 600) + '</p>' : '') +
            (colors.length > 1 ? optionRow('Colour', 'color', colors) : '') +
            (sizes.length ? optionRow('Size', 'size', sizes) : '') +
            '<button class="btn btn-primary btn-block mt-3" type="button" data-add disabled>' +
              (sizes.length || colors.length > 1 ? 'Select an option' : 'Add to bag') + '</button>' +
            '<p class="note mt-2" data-stock></p>' +
            '<p class="note">Shipping &amp; tax calculated at checkout. Payment is handled by Fourthwall.</p>' +
          '</div>' +
        '</div>' +
      '</div>';

    el.hidden = false;
    document.body.classList.add('noscroll');

    // With a single variant there is nothing to choose — arm it now.
    if (!sizes.length && colors.length <= 1 && (p.variants || []).length === 1) {
      state.open.variant = p.variants[0];
      syncSheet();
    }

    el.querySelectorAll('[data-opt]').forEach(function (b) {
      b.addEventListener('click', function () {
        var group = b.getAttribute('data-group');
        el.querySelectorAll('[data-group="' + group + '"]').forEach(function (o) { o.classList.remove('on'); });
        b.classList.add('on');
        pickVariant();
      });
    });
    el.querySelector('[data-add]').addEventListener('click', function () {
      if (state.open && state.open.variant) addToCart(state.open.variant, p);
    });
  }

  function optionRow(label, group, values) {
    return '<div class="optrow"><span class="optlab">' + esc(label) + '</span><div class="opts">' +
      values.map(function (v) {
        return '<button class="szbtn" type="button" data-opt data-group="' + group +
               '" data-val="' + esc(v) + '">' + esc(v) + '</button>';
      }).join('') + '</div></div>';
  }

  function pickVariant() {
    var el = sheet, p = state.open && state.open.product;
    if (!p) return;
    var want = {};
    el.querySelectorAll('[data-opt].on').forEach(function (b) {
      want[b.getAttribute('data-group')] = b.getAttribute('data-val');
    });
    var match = (p.variants || []).filter(function (v) {
      if (want.size && variantSize(v) !== want.size) return false;
      if (want.color && variantColor(v) !== want.color) return false;
      return true;
    })[0] || null;
    state.open.variant = match;
    syncSheet();
  }

  function syncSheet() {
    var el = sheet, v = state.open && state.open.variant;
    var btn = el.querySelector('[data-add]');
    var stock = el.querySelector('[data-stock]');
    if (!v) {
      btn.disabled = true; btn.textContent = 'Select an option';
      stock.textContent = ''; return;
    }
    el.querySelector('[data-price]').textContent = money(v.unitPrice);
    var ok = inStock(v);
    btn.disabled = !ok;
    btn.textContent = ok ? 'Add to bag' : 'Sold out';
    // Only a real low number is worth showing. "12 left" on an unlimited
    // print-on-demand line would be an invented scarcity claim.
    if (ok && v.stock && v.stock.type === 'LIMITED' && v.stock.inStock <= 5) {
      stock.textContent = v.stock.inStock + ' left in this size';
    } else { stock.textContent = ''; }
  }

  /* ---------------- cart ---------------- */
  function cartCount() {
    return ((state.cart && state.cart.items) || []).reduce(function (n, it) { return n + (it.quantity || 0); }, 0);
  }
  function cartTotal() {
    var items = (state.cart && state.cart.items) || [];
    var cur = CURRENCY, sum = 0;
    items.forEach(function (it) {
      var up = it.variant && it.variant.unitPrice;
      if (up) { sum += (up.value || 0) * (it.quantity || 0); cur = up.currency || cur; }
    });
    return money({ value: sum, currency: cur });
  }

  function ensureCart() {
    var id = ls(CART_KEY);
    if (id) {
      return req('/carts/' + encodeURIComponent(id) + '?currency=' + CURRENCY)
        .then(function (c) { state.cart = c; return c; })
        .catch(function () {
          // A cart that Fourthwall has forgotten (expired, or checked
          // out on another device) must not wedge the bag forever.
          ls(CART_KEY, null);
          return newCart();
        });
    }
    return newCart();
  }
  function newCart() {
    return req('/carts', { method: 'POST', body: { items: [] } }).then(function (c) {
      state.cart = c; if (c && c.id) ls(CART_KEY, c.id); return c;
    });
  }

  function addToCart(variant, product) {
    var btn = sheet && sheet.querySelector('[data-add]');
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    ensureCart().then(function (c) {
      return req('/carts/' + encodeURIComponent(c.id) + '/add?currency=' + CURRENCY, {
        method: 'POST', body: { items: [{ variantId: variant.id, quantity: 1 }] }
      });
    }).then(function (c) {
      state.cart = c;
      track('add_to_cart', product.name + (variantSize(variant) ? ' / ' + variantSize(variant) : ''));
      closeSheet(); paintBag(); openBag();
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Add to bag'; }
      alert('That didn’t go in the bag. Give it another shot in a second.');
    });
  }

  function changeQty(variantId, qty) {
    if (!state.cart) return;
    var path = '/carts/' + encodeURIComponent(state.cart.id) + (qty > 0 ? '/change' : '/remove') + '?currency=' + CURRENCY;
    var body = qty > 0 ? { items: [{ variantId: variantId, quantity: qty }] }
                       : { items: [{ variantId: variantId }] };
    req(path, { method: 'POST', body: body }).then(function (c) {
      state.cart = c; paintBag(); renderBag();
    }).catch(function () {});
  }

  function checkout() {
    if (!state.cart || !cartCount()) return;
    track('checkout_start', cartCount() + ' items');
    var base = state.checkoutBase;
    if (!base) { alert('Checkout is not reachable right now. Try again in a moment.'); return; }
    location.href = base + '/checkout/?cartId=' + encodeURIComponent(state.cart.id) +
                    '&cartCurrency=' + encodeURIComponent(CURRENCY);
  }

  /* ---------------- bag UI ---------------- */
  var bagPill, bagPanel;
  function buildBag() {
    bagPill = document.createElement('button');
    bagPill.id = 'v12bag';
    bagPill.type = 'button';
    bagPill.setAttribute('aria-label', 'Open bag');
    bagPill.innerHTML = '<span class="ic">▣</span><span class="t">Bag</span><span class="n">0</span>';
    document.body.appendChild(bagPill);
    bagPill.addEventListener('click', openBag);

    bagPanel = document.createElement('div');
    bagPanel.className = 'bagwrap';
    bagPanel.hidden = true;
    document.body.appendChild(bagPanel);
    bagPanel.addEventListener('click', function (e) {
      if (e.target === bagPanel || e.target.closest('[data-bagclose]')) closeBag();
    });
  }
  function openBag() { renderBag(); bagPanel.hidden = false; document.body.classList.add('noscroll'); }
  function closeBag() { bagPanel.hidden = true; document.body.classList.remove('noscroll'); }

  function paintBag() {
    if (!bagPill) return;
    var n = cartCount();
    bagPill.querySelector('.n').textContent = n;
    bagPill.classList.toggle('has', n > 0);
  }

  function renderBag() {
    var items = (state.cart && state.cart.items) || [];
    bagPanel.innerHTML =
      '<div class="bag">' +
        '<div class="baghead"><b>Your bag</b><button class="x" type="button" data-bagclose aria-label="Close">✕</button></div>' +
        (items.length
          ? '<div class="bagitems">' + items.map(function (it) {
              var v = it.variant || {}, pr = v.product || {};
              var img = (v.images && v.images[0] && v.images[0].url) || '';
              var bits = [variantColor(v), variantSize(v)].filter(Boolean).join(' · ');
              return '<div class="bagitem">' +
                '<div class="bagart">' + (img ? '<img src="' + esc(img) + '" alt="">' : '') + '</div>' +
                '<div class="bagmeta"><b>' + esc(pr.name || v.name || 'Item') + '</b>' +
                  (bits ? '<span>' + esc(bits) + '</span>' : '') +
                  '<span>' + esc(money(v.unitPrice)) + '</span></div>' +
                '<div class="bagqty">' +
                  '<button type="button" data-q="' + esc(v.id) + '" data-n="' + (it.quantity - 1) + '" aria-label="Fewer">−</button>' +
                  '<span>' + it.quantity + '</span>' +
                  '<button type="button" data-q="' + esc(v.id) + '" data-n="' + (it.quantity + 1) + '" aria-label="More">+</button>' +
                '</div></div>';
            }).join('') + '</div>' +
            '<div class="bagfoot"><div class="bagtot"><span>Subtotal</span><b>' + esc(cartTotal()) + '</b></div>' +
            '<p class="note">Shipping &amp; tax calculated at checkout.</p>' +
            '<button class="btn btn-primary btn-block mt-2" type="button" data-checkout>Checkout</button></div>'
          : '<div class="bagempty"><p>Your bag is empty.</p></div>') +
      '</div>';

    bagPanel.querySelectorAll('[data-q]').forEach(function (b) {
      b.addEventListener('click', function () {
        changeQty(b.getAttribute('data-q'), parseInt(b.getAttribute('data-n'), 10));
      });
    });
    var co = bagPanel.querySelector('[data-checkout]');
    co && co.addEventListener('click', checkout);
  }

  /* ---------------- boot ---------------- */
  grid.addEventListener('click', function (e) {
    var t = e.target.closest('[data-open], .prodhit');
    if (!t) return;
    var card = t.closest('[data-i]');
    if (card) openProduct(parseInt(card.getAttribute('data-i'), 10));
  });

  if (!TOKEN) {
    note('<b>The store is being rebuilt.</b><p class="muted small mt-1">' +
         'Every piece is moving to Fourthwall so sizes, stock and shipping are real.' +
         (CFG.shop ? ' Until it lands here, shop it directly:' : '') + '</p>' +
         (CFG.shop ? '<a class="btn btn-primary mt-2" href="' + esc(CFG.shop) +
                     '" target="_blank" rel="noopener">Open the V12 store →</a>' : ''));
    return;
  }

  note('<b>Loading the drop…</b>');
  buildBag();

  Promise.all([
    req('/collections/' + encodeURIComponent(COLLECTION) + '/products?currency=' + CURRENCY)
      .catch(function (e) {
        // A shop that never renamed its default collection has no "all".
        if (e.status !== 404) throw e;
        return req('/collections').then(function (d) {
          var first = (d.results || [])[0];
          if (!first) return { results: [] };
          return req('/collections/' + encodeURIComponent(first.slug) + '/products?currency=' + CURRENCY);
        });
      }),
    req('/shop').catch(function () { return null; })
  ]).then(function (out) {
    state.products = (out[0] && out[0].results) || [];
    var shop = out[1];
    state.checkoutBase = CFG.shop ? CFG.shop.replace(/\/+$/, '')
      : shop ? (shop.publicDomain ? 'https://' + shop.publicDomain
                                  : 'https://' + shop.domain + '.fourthwall.com')
             : null;
    renderGrid();
    return ensureCart();
  }).then(paintBag).catch(function (e) {
    note('<b>The store didn’t load.</b><p class="muted small mt-1">Refresh in a moment' +
         (CFG.shop ? ', or <a href="' + esc(CFG.shop) + '" target="_blank" rel="noopener">shop it on Fourthwall</a>' : '') +
         '.</p>');
  });
})();
