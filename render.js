(function () {
  // ---- Supabase project config ----
  var SUPABASE_URL = 'https://fgtldowsdgbatyuhtubw.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_kiVjEhy475NGnw2wkae2qA_IUmBCGSb';

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) {
      return o == null ? undefined : o[k];
    }, obj);
  }

  function applySimpleBindings(data) {
    document.querySelectorAll('[data-bind]').forEach(function (el) {
      var path = el.getAttribute('data-bind');
      var val = getPath(data, path);
      if (val !== undefined && val !== null) el.textContent = val;
    });
    document.querySelectorAll('[data-bind-img]').forEach(function (el) {
      var path = el.getAttribute('data-bind-img');
      var val = getPath(data, path);
      if (val) el.setAttribute('src', val);
      var altPath = path.replace(/\.image$/, '.imageAlt');
      var altVal = getPath(data, altPath);
      if (altVal) el.setAttribute('alt', altVal);
    });
    document.querySelectorAll('[data-bind-nl2br]').forEach(function (el) {
      var path = el.getAttribute('data-bind-nl2br');
      var val = getPath(data, path);
      if (val !== undefined && val !== null) {
        el.innerHTML = escapeHtml(val).split('\n').join('<br>');
      }
    });
  }

  function renderSpanList(container, items) {
    container.innerHTML = items.map(function (n) {
      return '<span>' + escapeHtml(n) + '</span>';
    }).join('');
  }

  function renderFeaturedGrid(container, cards) {
    container.className = 'featured-grid';
    container.innerHTML = cards.map(function (c) {
      return '<div class="featured-card"><div class="fc-image"><span>' + escapeHtml(c.tag) +
        '</span><img loading="lazy" src="' + escapeHtml(c.image) + '" alt="' + escapeHtml(c.imageAlt || '') +
        '"></div><div class="fc-body"><h3>' + escapeHtml(c.title) + '</h3><p>' + escapeHtml(c.text) + '</p></div></div>';
    }).join('');
  }

  function renderFeaturedList(container, cards) {
    container.className = 'featured-list';
    container.innerHTML = cards.map(function (c) {
      return '<div class="featured-list-item"><div class="fc-image"><span>' + escapeHtml(c.tag) +
        '</span><img loading="lazy" src="' + escapeHtml(c.image) + '" alt="' + escapeHtml(c.imageAlt || '') +
        '"></div><div class="fc-body"><h3>' + escapeHtml(c.title) + '</h3><p>' + escapeHtml(c.text) + '</p></div></div>';
    }).join('');
  }

  function renderWhyGrid(container, items) {
    container.innerHTML = items.map(function (it) {
      return '<article><span>' + escapeHtml(it.number) + '</span><h3>' + escapeHtml(it.title) +
        '</h3><p>' + escapeHtml(it.text) + '</p></article>';
    }).join('');
  }

  function renderLeaderCards(container, people) {
    container.innerHTML = people.map(function (p) {
      return '<article><span>' + escapeHtml(p.initials) + '</span><div><h3>' + escapeHtml(p.name) +
        '</h3><p>' + escapeHtml(p.role) + '</p></div></article>';
    }).join('');
  }

  function renderSubserviceGrid(container, items) {
    container.innerHTML = items.map(function (it) {
      return '<article><h4>' + escapeHtml(it.title) + '</h4><p>' + escapeHtml(it.text) + '</p></article>';
    }).join('');
  }

  function renderProjectList(container, items) {
    container.innerHTML = items.map(function (it) {
      var cls = (it.status || '').toLowerCase().indexOf('ongoing') !== -1 ? 'status-ongoing' : 'status-complete';
      return '<article role="listitem"><span>' + escapeHtml(it.client) + '<em class="status-badge ' + cls + '">' +
        escapeHtml(it.status) + '</em></span><h3>' + escapeHtml(it.title) + '</h3><p>' + escapeHtml(it.text) + '</p></article>';
    }).join('');
  }

  function renderTestimonials(container, items) {
    container.innerHTML = items.map(function (it) {
      return '<article class="testimonial-card"><q>' + escapeHtml(it.quote) + '</q>' +
        '<div class="who">' + escapeHtml(it.name) + '</div>' +
        '<div class="role">' + escapeHtml(it.role) + '</div></article>';
    }).join('');
  }

  function renderGallery(container, categories) {
    container.innerHTML = categories.map(function (cat) {
      var items = (cat.items || []).map(function (item) {
        return '<figure class="gallery-item"><img loading="lazy" src="' + escapeHtml(item.image) +
          '" alt="' + escapeHtml(item.imageAlt || '') + '"><figcaption>' + escapeHtml(item.caption) + '</figcaption></figure>';
      }).join('');
      return '<div class="gallery-category"><div class="gallery-category-head"><span>' + escapeHtml(cat.number) +
        '</span><h3>' + escapeHtml(cat.title) + '</h3></div><div class="gallery-grid">' + items + '</div></div>';
    }).join('');
  }

  var LIST_RENDERERS = {
    'home.trustBand.names': renderSpanList,
    'home.featuredProjects.cards': renderFeaturedGrid,
    'home.whyChoose.items': renderWhyGrid,
    'home.testimonials.items': renderTestimonials,
    'about.leadership.people': renderLeaderCards,
    'services.lines.0.subservices': renderSubserviceGrid,
    'services.lines.1.subservices': renderSubserviceGrid,
    'services.lines.2.subservices': renderSubserviceGrid,
    'projects.projectList': renderProjectList,
    'projects.tradeReferences.names': renderSpanList
  };

  function applyListBindings(data) {
    document.querySelectorAll('[data-bind-list]').forEach(function (el) {
      var path = el.getAttribute('data-bind-list');
      var val = getPath(data, path);
      if (!val) return;
      var layoutPath = el.getAttribute('data-layout-path');
      if (layoutPath && getPath(data, layoutPath) === 'list') {
        renderFeaturedList(el, val);
        return;
      }
      var renderer = LIST_RENDERERS[path];
      if (renderer) renderer(el, val);
    });
    var galleryEl = document.querySelector('[data-bind-gallery]');
    if (galleryEl) {
      var gpath = galleryEl.getAttribute('data-bind-gallery');
      var gval = getPath(data, gpath);
      if (gval) renderGallery(galleryEl, gval);
    }
  }

  function applyLinkRewrites(data) {
    var g = data.global || {};
    var replacements = [
      ['263772541729', (g.phone || '').replace(/[^\d]/g, '')],
      ['263719541729', (g.phoneAlt || '').replace(/[^\d]/g, '')],
      ['+263772541729', g.phone],
      ['+263719541729', g.phoneAlt],
      ['teyacinvestments@gmail.com', g.email],
      ['0272317549', (g.teleFax || '').replace(/[^\d]/g, '')]
    ];
    var attrs = ['href', 'src'];
    document.querySelectorAll('a[href], iframe[src]').forEach(function (el) {
      attrs.forEach(function (attr) {
        var v = el.getAttribute(attr);
        if (!v) return;
        var changed = false;
        replacements.forEach(function (pair) {
          var oldVal = pair[0], newVal = pair[1];
          if (newVal && v.indexOf(oldVal) !== -1) {
            v = v.split(oldVal).join(newVal);
            changed = true;
          }
        });
        if (changed) el.setAttribute(attr, v);
      });
    });
    // also rewrite the google maps query address if present
    if (g.addressChipinge) {
      document.querySelectorAll('iframe[src*="google.com/maps"]').forEach(function (el) {
        try {
          var url = new URL(el.getAttribute('src'));
          url.searchParams.set('q', g.addressChipinge);
          el.setAttribute('src', url.toString());
        } catch (e) {}
      });
    }
  }

  async function fetchContent() {
    // Plain REST call to Supabase (no SDK needed for a single public read) —
    // keeps the public-facing page light. Falls back to a local content.json
    // if present (e.g. during local testing), then to the page's own baked-in content.
    if (SUPABASE_URL.indexOf('YOUR-PROJECT') === -1) {
      var url = SUPABASE_URL + '/rest/v1/site_content?select=data&id=eq.1';
      var res = await fetch(url, {
        cache: 'no-store',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'Accept': 'application/vnd.pgrst.object+json'
        }
      });
      if (!res.ok) throw new Error('Supabase returned ' + res.status);
      var row = await res.json();
      return row.data;
    }
    // Fallback path (config not yet wired up): try a local content.json if one exists.
    var localRes = await fetch('content.json', { cache: 'no-store' });
    if (!localRes.ok) throw new Error('no content.json fallback available');
    return await localRes.json();
  }

  function applySectionBackgrounds(data) {
    document.querySelectorAll('[data-section-bg]').forEach(function (el) {
      var path = el.getAttribute('data-section-bg');
      var val = getPath(data, path);
      if (val) el.style.backgroundColor = val;
    });
  }

  function applyGridColumns(data) {
    document.querySelectorAll('[data-grid-columns]').forEach(function (el) {
      var path = el.getAttribute('data-grid-columns');
      var val = getPath(data, path);
      var n = parseInt(val, 10);
      if (n && n > 0) el.style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';
    });
  }

  function getDismissedAnnouncements() {
    try { return JSON.parse(localStorage.getItem('teyac_dismissed_announcements') || '[]'); } catch (e) { return []; }
  }
  function dismissAnnouncement(id) {
    try {
      var list = getDismissedAnnouncements();
      if (list.indexOf(id) === -1) {
        list.push(id);
        localStorage.setItem('teyac_dismissed_announcements', JSON.stringify(list));
      }
    } catch (e) {}
  }
  function updateAnnounceOffset() {
    var bar = document.getElementById('announcements-bar');
    var h = bar ? bar.offsetHeight : 0;
    document.documentElement.style.setProperty('--announce-h', h + 'px');
  }

  function renderAnnouncements(data) {
    var container = document.getElementById('announcements-bar');
    if (!container) return;
    var items = (data.announcements && data.announcements.items) || [];
    var todayStr = new Date().toISOString().slice(0, 10);
    var dismissed = getDismissedAnnouncements();

    var active = [];
    items.forEach(function (a, i) {
      if (a.enabled === false) return;
      if (a.startDate && a.startDate > todayStr) return;
      if (a.endDate && a.endDate < todayStr) return;
      var id = 'a' + i + ':' + (a.title || '');
      if (dismissed.indexOf(id) !== -1) return;
      active.push({ a: a, id: id });
    });

    if (!active.length) {
      container.innerHTML = '';
      updateAnnounceOffset();
      return;
    }

    container.innerHTML = active.map(function (entry) {
      var a = entry.a;
      return '<div class="announce-bar announce-' + (a.kind === 'urgent' ? 'urgent' : 'banner') + '" data-announce-id="' + escapeHtml(entry.id) + '">' +
        (a.image ? '<img class="announce-img" loading="lazy" src="' + escapeHtml(a.image) + '" alt="' + escapeHtml(a.imageAlt || '') + '">' : '') +
        '<div class="announce-text"><b>' + escapeHtml(a.title || '') + '</b>' + (a.message ? '<span>' + escapeHtml(a.message) + '</span>' : '') + '</div>' +
        (a.link ? '<a class="announce-link" href="' + escapeHtml(a.link) + '" target="_blank" rel="noopener">' + escapeHtml(a.linkText || 'Learn more') + '</a>' : '') +
        '<button type="button" class="announce-close" aria-label="Dismiss this announcement">&times;</button>' +
        '</div>';
    }).join('');

    container.querySelectorAll('.announce-close').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var bar = btn.closest('.announce-bar');
        dismissAnnouncement(bar.getAttribute('data-announce-id'));
        bar.remove();
        updateAnnounceOffset();
      });
    });

    updateAnnounceOffset();
    window.addEventListener('resize', updateAnnounceOffset);
  }

  function applyTheme(data) {
    var theme = data.global && data.global.theme;
    if (!theme) return;
    var root = document.documentElement.style;
    if (theme.buttonColor) root.setProperty('--orange', theme.buttonColor);
    if (theme.backgroundColor) root.setProperty('--navy', theme.backgroundColor);
    if (theme.textColor) root.setProperty('--ink', theme.textColor);
  }

  async function init() {
    try {
      var data = await fetchContent();
      applySimpleBindings(data);
      applyListBindings(data);
      applyLinkRewrites(data);
      applyTheme(data);
      applySectionBackgrounds(data);
      applyGridColumns(data);
      renderAnnouncements(data);
      if (data.global && data.global.metaDescription) {
        var md = document.querySelector('meta[name="description"]');
        if (md) md.setAttribute('content', data.global.metaDescription);
      }
      window.__teyacContent = data; // exposed for debugging / admin preview
    } catch (e) {
      console.warn('Site content failed to load, showing built-in content', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Lets the contact-form script (in index.html) save a copy of each enquiry
  // to Supabase so the owner can see it in admin, in addition to opening
  // WhatsApp. Exposed on window since this file's own variables are scoped
  // to this IIFE. Never throws — a failed save should never block the
  // WhatsApp message from opening.
  window.__teyacSaveMessage = function (fields) {
    if (SUPABASE_URL.indexOf('YOUR-PROJECT') !== -1) return Promise.resolve();
    return fetch(SUPABASE_URL + '/rest/v1/messages', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(fields)
    }).catch(function (e) {
      console.warn('Could not save enquiry to admin (WhatsApp message still sent)', e);
    });
  };
})();
