(function () {
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
    container.innerHTML = cards.map(function (c) {
      return '<div class="featured-card"><div class="fc-image"><span>' + escapeHtml(c.tag) +
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
      var renderer = LIST_RENDERERS[path];
      if (val && renderer) renderer(el, val);
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

  async function init() {
    try {
      var res = await fetch('content.json', { cache: 'no-store' });
      if (!res.ok) return; // keep baked-in fallback content
      var data = await res.json();
      applySimpleBindings(data);
      applyListBindings(data);
      applyLinkRewrites(data);
      if (data.global && data.global.metaDescription) {
        var md = document.querySelector('meta[name="description"]');
        if (md) md.setAttribute('content', data.global.metaDescription);
      }
      window.__teyacContent = data; // exposed for debugging / admin preview
    } catch (e) {
      console.warn('content.json failed to load, showing built-in content', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
