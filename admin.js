(function () {
  'use strict';

  /* ============================================================
     Small utilities
     ============================================================ */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }

  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function setPath(obj, path, value) {
    var keys = path.split('.');
    var o = obj;
    for (var i = 0; i < keys.length - 1; i++) {
      var k = keys[i];
      if (o[k] === undefined || o[k] === null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      o = o[k];
    }
    o[keys[keys.length - 1]] = value;
  }

  function slugify(name) {
    return name.toLowerCase().replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50);
  }
  function uniqueFilename(originalName) {
    var ext = (originalName.match(/\.([a-z0-9]+)$/i) || [, 'jpg'])[1].toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    var base = slugify(originalName) || 'photo';
    var suffix = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    return base + '-' + suffix + '.' + ext;
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  /* ============================================================
     Supabase config + wrapper
     ============================================================ */
  // Filled in once the project exists — see setup instructions.
  var SUPABASE_URL = 'https://fgtldowsdgbatyuhtubw.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_kiVjEhy475NGnw2wkae2qA_IUmBCGSb';
  var STORAGE_BUCKET = 'site-images';

  var sbClient = null;
  function getClient() {
    if (!sbClient) {
      if (typeof supabase === 'undefined' || !supabase.createClient) {
        throw new Error('Could not load the Supabase library. Check your internet connection and reload the page.');
      }
      sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
          // Mobile-carrier proxies have been seen serving stale cached
          // responses for this site before (same issue as the old GitHub
          // flow) — force every request to skip any cache.
          fetch: function (input, init) {
            init = init || {};
            init.cache = 'no-store';
            return fetch(input, init);
          }
        }
      });
    }
    return sbClient;
  }

  var DB = {
    // Sign in; throws a friendly error on failure.
    signIn: function (email, password) {
      return getClient().auth.signInWithPassword({ email: email, password: password }).then(function (res) {
        if (res.error) {
          var msg = res.error.message || '';
          if (/invalid login credentials/i.test(msg)) {
            throw new Error('That email or password was not accepted. Double-check both and try again.');
          }
          throw new Error('Could not sign in: ' + msg);
        }
        return res.data;
      });
    },
    // Resolve with the current session, or null if not signed in.
    getSession: function () {
      return getClient().auth.getSession().then(function (res) { return res.data.session || null; });
    },
    signOut: function () {
      return getClient().auth.signOut();
    },
    // Read the single content row.
    getContent: function () {
      return getClient().from('site_content').select('data').eq('id', 1).single().then(function (res) {
        if (res.error) throw new Error('Could not load site content: ' + res.error.message);
        return res.data.data;
      });
    },
    // Overwrite the single content row.
    saveContent: function (data) {
      return getClient().from('site_content')
        .update({ data: data, updated_at: new Date().toISOString() })
        .eq('id', 1)
        .select('id')
        .then(function (res) {
          if (res.error) throw new Error('Could not save: ' + res.error.message);
          // Supabase can report success even when the update matched zero
          // rows (e.g. a security-policy or row-id mismatch) — catch that
          // silent failure here instead of showing "Saved" when nothing changed.
          if (!res.data || res.data.length === 0) {
            throw new Error('Save did not apply — no matching content row was found. Check that the setup SQL ran successfully and that you are signed in correctly.');
          }
        });
    },
    // Upload a File/Blob and resolve with its public URL.
    uploadImage: function (file, filename) {
      var path = 'uploads/' + filename;
      return getClient().storage.from(STORAGE_BUCKET).upload(path, file, { upsert: false }).then(function (res) {
        if (res.error) throw new Error('Could not upload photo: ' + res.error.message);
        var pub = getClient().storage.from(STORAGE_BUCKET).getPublicUrl(path);
        return pub.data.publicUrl;
      });
    }
  };

  /* ============================================================
     Content schema — describes every editable field
     ============================================================ */
  function pad2(n) { return String(n).padStart(2, '0'); }

  var SCHEMA = [
    { id: 'global', label: 'Global & Contact', groups: [
      { title: 'Company identity', fields: [
        { t: 'image', path: 'global.logo', label: 'Logo' },
        { t: 'text', path: 'global.companyName', label: 'Company short name' },
        { t: 'text', path: 'global.companyTagline', label: 'Tagline (shown under the short name)' },
        { t: 'text', path: 'global.companyNameFull', label: 'Full legal name' },
        { t: 'text', path: 'global.tradingAs', label: 'Trading as' }
      ]},
      { title: 'Contact details', hint: 'These update WhatsApp links, call buttons and email links across every page automatically.', fields: [
        { t: 'text', path: 'global.phone', label: 'Primary phone / WhatsApp number', hint: 'Use international format, e.g. +263772541729' },
        { t: 'text', path: 'global.phoneAlt', label: 'Alternative phone number' },
        { t: 'text', path: 'global.teleFax', label: 'Tele/Fax number' },
        { t: 'text', path: 'global.email', label: 'Email address' },
        { t: 'textarea', path: 'global.addressChipinge', label: 'Chipinge office address', rows: 2 },
        { t: 'textarea', path: 'global.addressPostal', label: 'Postal address', rows: 2 },
        { t: 'text', path: 'global.registration', label: 'Company registration number' },
        { t: 'text', path: 'global.bankAccountName', label: 'Bank account name' },
        { t: 'text', path: 'global.bankName', label: 'Bank name' }
      ]},
      { title: 'Search engine details', hint: 'Controls how the site appears in Google search results.', fields: [
        { t: 'text', path: 'global.metaTitle', label: 'Page title' },
        { t: 'textarea', path: 'global.metaDescription', label: 'Description', rows: 2 },
        { t: 'textarea', path: 'global.metaKeywords', label: 'Keywords (comma separated)', rows: 2 }
      ]}
    ]},

    { id: 'home', label: 'Home Page', groups: [
      { title: 'Hero banner', fields: [
        { t: 'image', path: 'home.hero.image', label: 'Hero photo' },
        { t: 'text', path: 'home.hero.eyebrow', label: 'Small label above the headline' },
        { t: 'text', path: 'home.hero.headline', label: 'Headline' },
        { t: 'textarea', path: 'home.hero.copy', label: 'Supporting text', rows: 2 }
      ]},
      { title: 'Trusted-by strip', fields: [
        { t: 'text', path: 'home.trustBand.label', label: 'Label text' },
        { t: 'liststrings', path: 'home.trustBand.names', label: 'Client / partner names', itemNoun: 'name' }
      ]},
      { title: 'Core capabilities section', fields: [
        { t: 'text', path: 'home.capabilities.kicker', label: 'Small label' },
        { t: 'text', path: 'home.capabilities.heading', label: 'Heading' },
        { t: 'fixedlist', path: 'home.capabilities.cards', label: 'Capability cards', fixedNote: 'Exactly 3 cards — the layout is built for this number, so cards cannot be added or removed here.',
          itemTitle: function (it, i) { return it.title || ('Card ' + (i + 1)); },
          fields: [
            { key: 'number', label: 'Number', t: 'text' },
            { key: 'title', label: 'Title', t: 'text' },
            { key: 'text', label: 'Description', t: 'textarea', rows: 2 },
            { key: 'image', label: 'Photo', t: 'image', showIf: function (it, i) { return i === 2; } }
          ] }
      ]},
      { title: 'Who we are', fields: [
        { t: 'text', path: 'home.whoWeAre.kicker', label: 'Small label' },
        { t: 'text', path: 'home.whoWeAre.heading', label: 'Heading' },
        { t: 'textarea', path: 'home.whoWeAre.lead', label: 'Intro line', rows: 2 },
        { t: 'textarea', path: 'home.whoWeAre.body', label: 'Body text', rows: 3 }
      ]},
      { title: 'Featured projects', fields: [
        { t: 'text', path: 'home.featuredProjects.kicker', label: 'Small label' },
        { t: 'text', path: 'home.featuredProjects.heading', label: 'Heading' },
        { t: 'listobjects', path: 'home.featuredProjects.cards', label: 'Project cards', itemNoun: 'project card',
          itemTitle: function (it) { return it.title || 'New project'; },
          defaultItem: function () { return { tag: 'Completed', image: '', imageAlt: '', title: 'New project', text: '' }; },
          fields: [
            { key: 'tag', label: 'Tag (e.g. "Completed")', t: 'text' },
            { key: 'image', label: 'Photo', t: 'image' },
            { key: 'title', label: 'Title', t: 'text' },
            { key: 'text', label: 'Description', t: 'textarea', rows: 2 }
          ] }
      ]},
      { title: 'Why choose TEYAC', fields: [
        { t: 'text', path: 'home.whyChoose.kicker', label: 'Small label' },
        { t: 'text', path: 'home.whyChoose.heading', label: 'Heading' },
        { t: 'listobjects', path: 'home.whyChoose.items', label: 'Reasons', itemNoun: 'reason',
          itemTitle: function (it) { return it.title || 'New reason'; },
          defaultItem: function (arr) { return { number: pad2(arr.length + 1), title: 'New reason', text: '' }; },
          fields: [
            { key: 'number', label: 'Number', t: 'text' },
            { key: 'title', label: 'Title', t: 'text' },
            { key: 'text', label: 'Description', t: 'textarea', rows: 2 }
          ] }
      ]},
      { title: 'Call-to-action panel', fields: [
        { t: 'text', path: 'home.ctaHome.kicker', label: 'Small label' },
        { t: 'text', path: 'home.ctaHome.heading', label: 'Heading' },
        { t: 'textarea', path: 'home.ctaHome.text', label: 'Supporting text', rows: 2 }
      ]}
    ]},

    { id: 'about', label: 'About Page', groups: [
      { title: 'Page header', fields: [
        { t: 'text', path: 'about.hero.eyebrow', label: 'Small label' },
        { t: 'text', path: 'about.hero.title', label: 'Headline' },
        { t: 'textarea', path: 'about.hero.text', label: 'Supporting text', rows: 2 }
      ]},
      { title: 'Company introduction', fields: [
        { t: 'text', path: 'about.intro.kicker', label: 'Small label' },
        { t: 'text', path: 'about.intro.heading', label: 'Heading' },
        { t: 'textarea', path: 'about.intro.lead', label: 'Intro line', rows: 2 },
        { t: 'textarea', path: 'about.intro.body1', label: 'Paragraph 1', rows: 4 },
        { t: 'textarea', path: 'about.intro.body2', label: 'Paragraph 2', rows: 4 },
        { t: 'fixedlist', path: 'about.intro.facts', label: 'Key facts', fixedNote: 'Exactly 4 facts fit this layout.',
          itemTitle: function (it, i) { return it.label || ('Fact ' + (i + 1)); },
          fields: [ { key: 'value', label: 'Value', t: 'text' }, { key: 'label', label: 'Label', t: 'text' } ] }
      ]},
      { title: 'What we bring (capabilities)', fields: [
        { t: 'text', path: 'about.capabilities.kicker', label: 'Small label' },
        { t: 'text', path: 'about.capabilities.heading', label: 'Heading' },
        { t: 'fixedlist', path: 'about.capabilities.items', label: 'Capability items', fixedNote: 'Exactly 4 items fit this layout.',
          itemTitle: function (it, i) { return it.title || ('Item ' + (i + 1)); },
          fields: [
            { key: 'number', label: 'Number', t: 'text' },
            { key: 'title', label: 'Title', t: 'text' },
            { key: 'text', label: 'Description', t: 'textarea', rows: 3 }
          ] }
      ]},
      { title: 'How we work (process)', fields: [
        { t: 'text', path: 'about.process.kicker', label: 'Small label' },
        { t: 'text', path: 'about.process.heading', label: 'Heading' },
        { t: 'textarea', path: 'about.process.text', label: 'Intro text', rows: 2 },
        { t: 'fixedlist', path: 'about.process.steps', label: 'Process steps', fixedNote: 'Exactly 5 steps fit this layout.',
          itemTitle: function (it, i) { return it.title || ('Step ' + (i + 1)); },
          fields: [ { key: 'title', label: 'Step title', t: 'text' }, { key: 'text', label: 'Step description', t: 'textarea', rows: 2 } ] }
      ]},
      { title: 'Vision, mission & goal', fields: [
        { t: 'fixedlist', path: 'about.missionVisionGoal', label: 'Vision / Mission / Goal', fixedNote: 'These 3 panels are fixed in the page layout.',
          itemTitle: function (it, i) { return it.label || ('Panel ' + (i + 1)); },
          fields: [
            { key: 'label', label: 'Label', t: 'text' },
            { key: 'title', label: 'Title', t: 'text' },
            { key: 'text', label: 'Description', t: 'textarea', rows: 2 }
          ] }
      ]},
      { title: 'Our values', fields: [
        { t: 'text', path: 'about.values.kicker', label: 'Small label' },
        { t: 'text', path: 'about.values.heading', label: 'Heading' },
        { t: 'fixedlist', path: 'about.values.items', label: 'Values', fixedNote: 'Exactly 6 values fit this layout.',
          itemTitle: function (it, i) { return it.title || ('Value ' + (i + 1)); },
          fields: [ { key: 'title', label: 'Title', t: 'text' }, { key: 'text', label: 'Description', t: 'textarea', rows: 2 } ] }
      ]},
      { title: 'Leadership', fields: [
        { t: 'text', path: 'about.leadership.kicker', label: 'Small label' },
        { t: 'text', path: 'about.leadership.heading', label: 'Heading' },
        { t: 'listobjects', path: 'about.leadership.people', label: 'Leadership team', itemNoun: 'person',
          itemTitle: function (it) { return it.name || 'New team member'; },
          defaultItem: function () { return { initials: '', name: 'New team member', role: '' }; },
          fields: [
            { key: 'initials', label: 'Initials (e.g. "ME")', t: 'text' },
            { key: 'name', label: 'Full name', t: 'text' },
            { key: 'role', label: 'Role / title', t: 'text' }
          ] }
      ]}
    ]},

    { id: 'services', label: 'Services Page', groups: [
      { title: 'Page header', fields: [
        { t: 'text', path: 'services.hero.eyebrow', label: 'Small label' },
        { t: 'text', path: 'services.hero.title', label: 'Headline' },
        { t: 'textarea', path: 'services.hero.text', label: 'Supporting text', rows: 2 }
      ]},
      { title: 'Civil & Earthworks', fields: [
        { t: 'text', path: 'services.lines.0.kicker', label: 'Small label' },
        { t: 'text', path: 'services.lines.0.heading', label: 'Heading' },
        { t: 'textarea', path: 'services.lines.0.lead', label: 'Intro text', rows: 2 },
        { t: 'listobjects', path: 'services.lines.0.subservices', label: 'Sub-services', itemNoun: 'service',
          itemTitle: function (it) { return it.title || 'New service'; },
          defaultItem: function () { return { title: 'New service', text: '' }; },
          fields: [ { key: 'title', label: 'Title', t: 'text' }, { key: 'text', label: 'Description', t: 'textarea', rows: 2 } ] }
      ]},
      { title: 'Structural Steel', fields: [
        { t: 'text', path: 'services.lines.1.kicker', label: 'Small label' },
        { t: 'text', path: 'services.lines.1.heading', label: 'Heading' },
        { t: 'textarea', path: 'services.lines.1.lead', label: 'Intro text', rows: 2 },
        { t: 'listobjects', path: 'services.lines.1.subservices', label: 'Sub-services', itemNoun: 'service',
          itemTitle: function (it) { return it.title || 'New service'; },
          defaultItem: function () { return { title: 'New service', text: '' }; },
          fields: [ { key: 'title', label: 'Title', t: 'text' }, { key: 'text', label: 'Description', t: 'textarea', rows: 2 } ] }
      ]},
      { title: 'Telecommunications', fields: [
        { t: 'text', path: 'services.lines.2.kicker', label: 'Small label' },
        { t: 'text', path: 'services.lines.2.heading', label: 'Heading' },
        { t: 'textarea', path: 'services.lines.2.lead', label: 'Intro text', rows: 2 },
        { t: 'listobjects', path: 'services.lines.2.subservices', label: 'Sub-services', itemNoun: 'service',
          itemTitle: function (it) { return it.title || 'New service'; },
          defaultItem: function () { return { title: 'New service', text: '' }; },
          fields: [ { key: 'title', label: 'Title', t: 'text' }, { key: 'text', label: 'Description', t: 'textarea', rows: 2 } ] }
      ]}
    ]},

    { id: 'projects', label: 'Projects Page', groups: [
      { title: 'Page header', fields: [
        { t: 'text', path: 'projects.hero.eyebrow', label: 'Small label' },
        { t: 'text', path: 'projects.hero.title', label: 'Headline' },
        { t: 'textarea', path: 'projects.hero.text', label: 'Supporting text', rows: 2 }
      ]},
      { title: 'Featured photo', fields: [
        { t: 'image', path: 'projects.featuredPhoto.image', label: 'Photo' },
        { t: 'text', path: 'projects.featuredPhoto.caption', label: 'Caption' }
      ]},
      { title: 'Project list', fields: [
        { t: 'listobjects', path: 'projects.projectList', label: 'Projects', itemNoun: 'project',
          itemTitle: function (it) { return it.title || 'New project'; },
          defaultItem: function () { return { client: '', status: 'Complete', title: 'New project', text: '' }; },
          fields: [
            { key: 'client', label: 'Client', t: 'text' },
            { key: 'status', label: 'Status', t: 'select', options: ['Complete', 'Ongoing'] },
            { key: 'title', label: 'Project title', t: 'text' },
            { key: 'text', label: 'Description', t: 'textarea', rows: 2 }
          ] }
      ]},
      { title: 'On-the-ground status', fields: [
        { t: 'fixedlist', path: 'projects.onGround', label: 'Status panels', fixedNote: 'These 2 panels (Live / Complete) are fixed in the layout.',
          itemTitle: function (it, i) { return it.title || ('Panel ' + (i + 1)); },
          fields: [
            { key: 'label', label: 'Label', t: 'text' },
            { key: 'title', label: 'Title', t: 'text' },
            { key: 'text', label: 'Site list (one per line)', t: 'textarea', rows: 5 }
          ] }
      ]},
      { title: 'Trade references', fields: [
        { t: 'text', path: 'projects.tradeReferences.kicker', label: 'Small label' },
        { t: 'text', path: 'projects.tradeReferences.heading', label: 'Heading' },
        { t: 'liststrings', path: 'projects.tradeReferences.names', label: 'Reference names', itemNoun: 'name' }
      ]},
      { title: 'Project gallery', fields: [
        { t: 'text', path: 'projects.gallery.kicker', label: 'Small label' },
        { t: 'text', path: 'projects.gallery.heading', label: 'Heading' },
        { t: 'gallery', path: 'projects.gallery.categories', label: 'Gallery categories & photos' }
      ]},
      { title: 'Team photo', fields: [
        { t: 'image', path: 'projects.teamPhoto.image', label: 'Photo' },
        { t: 'text', path: 'projects.teamPhoto.caption', label: 'Caption' }
      ]},
      { title: 'Call-to-action panel', fields: [
        { t: 'text', path: 'projects.ctaProjects.kicker', label: 'Small label' },
        { t: 'text', path: 'projects.ctaProjects.heading', label: 'Heading' }
      ]}
    ]},

    { id: 'contact', label: 'Contact Page', groups: [
      { title: 'Page header', fields: [
        { t: 'text', path: 'contact.hero.eyebrow', label: 'Small label' },
        { t: 'text', path: 'contact.hero.title', label: 'Headline' },
        { t: 'textarea', path: 'contact.hero.text', label: 'Supporting text', rows: 2 }
      ]},
      { title: 'Message section intro', fields: [
        { t: 'text', path: 'contact.intro.kicker', label: 'Small label' },
        { t: 'text', path: 'contact.intro.heading', label: 'Heading' },
        { t: 'textarea', path: 'contact.intro.text', label: 'Supporting text', rows: 2 }
      ]},
      { title: 'Company details card', fields: [
        { t: 'text', path: 'contact.companyDetails.altNumber', label: 'Alternative number (as displayed)' },
        { t: 'textarea', path: 'contact.companyDetails.chipingeOffice', label: 'Chipinge office address', rows: 2 },
        { t: 'textarea', path: 'contact.companyDetails.postalAddress', label: 'Postal address', rows: 2 },
        { t: 'text', path: 'contact.companyDetails.teleFax', label: 'Tele/Fax (as displayed)' },
        { t: 'textarea', path: 'contact.companyDetails.registration', label: 'Registration details', rows: 2 },
        { t: 'textarea', path: 'contact.companyDetails.bankingDetails', label: 'Banking details', rows: 2 }
      ]},
      { title: 'Map', fields: [
        { t: 'text', path: 'contact.map.title', label: 'Map panel title' }
      ]}
    ]},

    { id: 'footer', label: 'Footer', groups: [
      { title: 'Footer text', fields: [
        { t: 'textarea', path: 'footer.description', label: 'Company description', rows: 3 },
        { t: 'text', path: 'footer.bottomLine1', label: 'Bottom line (registration)' }
      ]}
    ]},

    { id: 'pricing', label: 'Pricing (optional)', groups: [
      { title: 'Pricing section', notBuilt: true, fields: [
        { t: 'text', path: 'pricing.kicker', label: 'Small label' },
        { t: 'text', path: 'pricing.heading', label: 'Heading' },
        { t: 'textarea', path: 'pricing.intro', label: 'Intro text', rows: 2 },
        { t: 'listobjects', path: 'pricing.packages', label: 'Packages', itemNoun: 'package',
          itemTitle: function (it) { return it.name || 'New package'; },
          defaultItem: function () { return { name: 'New package', price: '', text: '' }; },
          fields: [
            { key: 'name', label: 'Package name', t: 'text' },
            { key: 'price', label: 'Price / starting from', t: 'text' },
            { key: 'text', label: 'Description', t: 'textarea', rows: 2 }
          ] }
      ]}
    ]}
  ];

  /* ============================================================
     App state
     ============================================================ */
  var state = {
    content: null,
    pendingUploads: {}, // path -> {filename, dataUrl, file}
    dirty: false,
    activeTab: 'global',
    saving: false
  };

  var LS_KEY = 'teyac_admin_config_v1';

  // Supabase's own client already persists the signed-in session in
  // localStorage, so there's no separate credential store to manage here.
  var rememberedEmail = (function () {
    try { return localStorage.getItem(LS_KEY + '_email') || ''; } catch (e) { return ''; }
  })();
  function rememberEmail(email) {
    try { localStorage.setItem(LS_KEY + '_email', email); } catch (e) {}
  }

  /* ============================================================
     Toast / status helpers
     ============================================================ */
  var toastTimer = null;
  function toast(msg, kind) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 4200);
  }
  function setStatus(text, kind) {
    var el = $('#statusText');
    el.textContent = text;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }
  function markDirty() {
    state.dirty = true;
    setStatus('Unsaved changes', 'dirty');
  }

  /* ============================================================
     Login flow
     ============================================================ */
  function showError(msg) {
    var box = $('#loginError');
    box.textContent = msg;
    box.style.display = 'block';
  }
  function hideError() { $('#loginError').style.display = 'none'; }

  function loadAfterAuth(email) {
    return DB.getContent().then(function (data) {
      state.content = data;
      if (email) rememberEmail(email);
      enterDashboard(email);
    });
  }

  function attemptLogin(email, password) {
    var btn = $('#loginBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Signing in…';
    hideError();

    return DB.signIn(email, password)
      .then(function () { return loadAfterAuth(email); })
      .catch(function (err) {
        showError(err.message || 'Something went wrong signing in. Please check your details and try again.');
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Sign in';
      });
  }

  function wireLogin() {
    if (rememberedEmail) $('#fEmail').value = rememberedEmail;

    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#fEmail').value.trim();
      var password = $('#fPassword').value;
      if (!email) { showError('Enter your email address.'); return; }
      if (!password) { showError('Enter your password.'); return; }
      attemptLogin(email, password);
    });

    // Already signed in from a previous visit? Supabase keeps the session
    // in localStorage itself, so just check and skip straight to the dashboard.
    DB.getSession().then(function (session) {
      if (session && session.user) {
        var btn = $('#loginBtn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Signing in…';
        loadAfterAuth(session.user.email).catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Sign in';
          showError(err.message || 'Could not resume your session. Please sign in again.');
        });
      }
    }).catch(function () { /* not signed in yet — show the form as normal */ });
  }

  function enterDashboard(email) {
    $('#loginScreen').style.display = 'none';
    $('#dashboard').className = 'active';
    $('#repoLabel').textContent = email || '';
    renderSidebar();
    switchTab(state.activeTab);
    window.addEventListener('beforeunload', function (e) {
      if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  $('#logoutBtn') && $('#logoutBtn').addEventListener('click', function () {
    if (state.dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
    DB.signOut().finally(function () { location.reload(); });
  });

  /* ============================================================
     Sidebar + tab switching
     ============================================================ */
  function renderSidebar() {
    var ul = $('#tabList');
    ul.innerHTML = SCHEMA.map(function (tab) {
      return '<li><button data-tab="' + tab.id + '">' + escapeHtml(tab.label) + '</button></li>';
    }).join('');
    $all('button[data-tab]', ul).forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
    });
  }

  function switchTab(id) {
    state.activeTab = id;
    $all('#tabList button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === id);
    });
    var tab = SCHEMA.filter(function (t) { return t.id === id; })[0];
    $('#tabTitle').textContent = tab.label;
    renderTabContent(tab);
    window.scrollTo(0, 0);
  }

  /* ============================================================
     Field renderers
     ============================================================ */
  function renderTabContent(tab) {
    var html = tab.groups.map(renderGroup).join('');
    $('#tabContent').innerHTML = html;
    wireGroupEvents($('#tabContent'));
  }

  function renderGroup(group) {
    var notBuilt = group.notBuilt ? '<div class="banner warn">This section isn\'t part of the live page design yet. Changes here are saved, but won\'t appear on the website until this section is added to the page layout.</div>' : '';
    return '<div class="group">' +
      '<div class="group-head"><h3>' + escapeHtml(group.title) + '</h3>' +
      (group.hint ? '<p>' + escapeHtml(group.hint) + '</p>' : '') + '</div>' +
      '<div class="group-body">' + notBuilt + group.fields.map(renderField).join('') + '</div>' +
      '</div>';
  }

  function renderField(field) {
    switch (field.t) {
      case 'text': return renderText(field);
      case 'textarea': return renderTextarea(field);
      case 'image': return renderImage(field);
      case 'liststrings': return renderListStrings(field);
      case 'listobjects': return renderListObjects(field, getPath(state.content, field.path) || []);
      case 'fixedlist': return renderFixedList(field, getPath(state.content, field.path) || []);
      case 'gallery': return renderGallery(field, getPath(state.content, field.path) || []);
      default: return '';
    }
  }

  function renderText(field) {
    var val = getPath(state.content, field.path);
    return '<div class="f"><label>' + escapeHtml(field.label) + '</label>' +
      '<input type="text" data-path="' + escapeAttr(field.path) + '" value="' + escapeAttr(val || '') + '">' +
      (field.hint ? '<div class="hint">' + escapeHtml(field.hint) + '</div>' : '') + '</div>';
  }

  function renderTextarea(field) {
    var val = getPath(state.content, field.path);
    return '<div class="f"><label>' + escapeHtml(field.label) + '</label>' +
      '<textarea rows="' + (field.rows || 3) + '" data-path="' + escapeAttr(field.path) + '">' + escapeHtml(val || '') + '</textarea>' +
      (field.hint ? '<div class="hint">' + escapeHtml(field.hint) + '</div>' : '') + '</div>';
  }

  function renderSelect(field, path, val) {
    return '<select data-path="' + escapeAttr(path) + '">' + field.options.map(function (o) {
      return '<option value="' + escapeAttr(o) + '"' + (o === val ? ' selected' : '') + '>' + escapeHtml(o) + '</option>';
    }).join('') + '</select>';
  }

  function renderImage(field) {
    var val = getPath(state.content, field.path);
    var pending = state.pendingUploads[field.path];
    var previewUrl = pending ? pending.dataUrl : (val || '');
    var altPath = field.path.endsWith('.image') ? field.path.replace(/\.image$/, '.imageAlt') : null;
    var altVal = altPath ? (getPath(state.content, altPath) || '') : null;
    return '<div class="f"><label>' + escapeHtml(field.label) + '</label>' +
      '<div class="img-field">' +
        '<div class="img-preview" style="' + (previewUrl ? "background-image:url('" + encodeURI(previewUrl).replace(/'/g, "%27") + "')" : '') + '"></div>' +
        '<div class="img-controls">' +
          '<div class="path">' + (pending ? 'New photo selected — will upload on save' : escapeHtml(val || 'No photo set')) + '</div>' +
          '<input type="file" accept="image/*" style="display:none" data-img-upload="' + escapeAttr(field.path) + '">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-img-choose="' + escapeAttr(field.path) + '">Change photo</button>' +
          (altPath ? '<div class="f" style="margin-top:10px;"><label>Photo description (for accessibility &amp; SEO)</label><input type="text" data-path="' + escapeAttr(altPath) + '" value="' + escapeAttr(altVal) + '"></div>' : '') +
        '</div>' +
      '</div></div>';
  }

  function itemHeader(noun, idx, title, canMoveUp, canMoveDown, canRemove, listId) {
    return '<div class="list-item-head"><span class="tag">' + escapeHtml(title) + '</span>' +
      '<div class="item-actions">' +
        (canMoveUp !== undefined ? '<button type="button" class="icon-btn" data-move="-1" data-list="' + listId + '" data-idx="' + idx + '" ' + (canMoveUp ? '' : 'disabled') + ' title="Move up">\u2191</button>' +
        '<button type="button" class="icon-btn" data-move="1" data-list="' + listId + '" data-idx="' + idx + '" ' + (canMoveDown ? '' : 'disabled') + ' title="Move down">\u2193</button>' : '') +
        (canRemove ? '<button type="button" class="icon-btn danger" data-remove data-list="' + listId + '" data-idx="' + idx + '" title="Remove">\u2715</button>' : '') +
      '</div></div>';
  }

  function renderSubfield(sub, basePath, idx, item) {
    if (sub.showIf && !sub.showIf(item, idx)) return '';
    var path = basePath + '.' + idx + '.' + sub.key;
    var val = item[sub.key];
    if (sub.t === 'image') {
      return renderImage({ t: 'image', path: path, label: sub.label });
    }
    if (sub.t === 'select') {
      return '<div class="f"><label>' + escapeHtml(sub.label) + '</label>' + renderSelect(sub, path, val) + '</div>';
    }
    if (sub.t === 'textarea') {
      return '<div class="f"><label>' + escapeHtml(sub.label) + '</label><textarea rows="' + (sub.rows || 2) + '" data-path="' + escapeAttr(path) + '">' + escapeHtml(val || '') + '</textarea></div>';
    }
    return '<div class="f"><label>' + escapeHtml(sub.label) + '</label><input type="text" data-path="' + escapeAttr(path) + '" value="' + escapeAttr(val || '') + '"></div>';
  }

  function renderListObjects(field, arr) {
    var listId = field.path;
    var itemsHtml = arr.map(function (item, idx) {
      var title = field.itemTitle ? field.itemTitle(item, idx) : ('Item ' + (idx + 1));
      return '<div class="list-item">' +
        itemHeader(field.itemNoun, idx, title, idx > 0, idx < arr.length - 1, arr.length > 1, listId) +
        field.fields.map(function (sub) { return renderSubfield(sub, field.path, idx, item); }).join('') +
        '</div>';
    }).join('');
    return '<div class="f"><label>' + escapeHtml(field.label) + '</label>' +
      '<div class="list-items" data-list-container="' + listId + '">' + itemsHtml + '</div>' +
      '<button type="button" class="add-btn" data-add-item="' + listId + '">+ Add ' + escapeHtml(field.itemNoun || 'item') + '</button>' +
      '</div>';
  }

  function renderFixedList(field, arr) {
    var listId = field.path;
    var itemsHtml = arr.map(function (item, idx) {
      var title = field.itemTitle ? field.itemTitle(item, idx) : ('Item ' + (idx + 1));
      return '<div class="list-item">' +
        '<div class="list-item-head"><span class="tag">' + escapeHtml(title) + '</span></div>' +
        field.fields.map(function (sub) { return renderSubfield(sub, field.path, idx, item); }).join('') +
        '</div>';
    }).join('');
    return '<div class="f"><label>' + escapeHtml(field.label) + '</label>' +
      (field.fixedNote ? '<div class="hint" style="margin-bottom:10px;">' + escapeHtml(field.fixedNote) + '</div>' : '') +
      '<div class="list-items" data-list-container="' + listId + '">' + itemsHtml + '</div>' +
      '</div>';
  }

  function renderListStrings(field) {
    var arr = getPath(state.content, field.path) || [];
    var listId = field.path;
    var itemsHtml = arr.map(function (val, idx) {
      return '<div class="list-item" style="padding:9px 12px;">' +
        '<div style="display:flex; gap:8px; align-items:center;">' +
          '<input type="text" style="flex:1;" data-path="' + escapeAttr(field.path + '.' + idx) + '" value="' + escapeAttr(val) + '">' +
          '<div class="item-actions">' +
            '<button type="button" class="icon-btn" data-move="-1" data-list="' + listId + '" data-idx="' + idx + '" ' + (idx > 0 ? '' : 'disabled') + ' title="Move up">\u2191</button>' +
            '<button type="button" class="icon-btn" data-move="1" data-list="' + listId + '" data-idx="' + idx + '" ' + (idx < arr.length - 1 ? '' : 'disabled') + ' title="Move down">\u2193</button>' +
            '<button type="button" class="icon-btn danger" data-remove data-list="' + listId + '" data-idx="' + idx + '" title="Remove">\u2715</button>' +
          '</div>' +
        '</div></div>';
    }).join('');
    return '<div class="f"><label>' + escapeHtml(field.label) + '</label>' +
      '<div class="list-items" data-list-container="' + listId + '">' + itemsHtml + '</div>' +
      '<button type="button" class="add-btn" data-add-string="' + listId + '">+ Add ' + escapeHtml(field.itemNoun || 'item') + '</button>' +
      '</div>';
  }

  function renderGallery(field, categories) {
    var listId = field.path;
    var catsHtml = categories.map(function (cat, ci) {
      var itemsHtml = (cat.items || []).map(function (item, ii) {
        var itemPath = field.path + '.' + ci + '.items';
        return '<div class="gallery-item">' +
          '<div class="img-preview" style="' + (item.image ? "background-image:url('" + encodeURI(state.pendingUploads[itemPath + '.' + ii + '.image'] ? state.pendingUploads[itemPath + '.' + ii + '.image'].dataUrl : item.image).replace(/'/g, "%27") + "')" : '') + '"></div>' +
          '<input type="file" accept="image/*" style="display:none" data-img-upload="' + escapeAttr(itemPath + '.' + ii + '.image') + '">' +
          '<button type="button" class="btn btn-ghost btn-sm" style="width:100%; margin-bottom:8px;" data-img-choose="' + escapeAttr(itemPath + '.' + ii + '.image') + '">Change photo</button>' +
          '<div class="f" style="margin-bottom:6px;"><label>Caption</label><input type="text" data-path="' + escapeAttr(itemPath + '.' + ii + '.caption') + '" value="' + escapeAttr(item.caption || '') + '"></div>' +
          '<div class="f" style="margin-bottom:8px;"><label>Description (alt text)</label><input type="text" data-path="' + escapeAttr(itemPath + '.' + ii + '.imageAlt') + '" value="' + escapeAttr(item.imageAlt || '') + '"></div>' +
          '<div class="item-actions">' +
            '<button type="button" class="icon-btn" data-move="-1" data-list="' + itemPath + '" data-idx="' + ii + '" ' + (ii > 0 ? '' : 'disabled') + ' title="Move up">\u2191</button>' +
            '<button type="button" class="icon-btn" data-move="1" data-list="' + itemPath + '" data-idx="' + ii + '" ' + (ii < (cat.items || []).length - 1 ? '' : 'disabled') + ' title="Move down">\u2193</button>' +
            '<button type="button" class="icon-btn danger" data-remove data-list="' + itemPath + '" data-idx="' + ii + '" title="Remove photo">\u2715</button>' +
          '</div>' +
        '</div>';
      }).join('');
      return '<div class="gallery-cat">' +
        '<div class="gallery-cat-head">' +
          '<div class="f"><label>Category number</label><input type="text" data-path="' + escapeAttr(field.path + '.' + ci + '.number') + '" value="' + escapeAttr(cat.number || '') + '"></div>' +
          '<div class="f"><label>Category title</label><input type="text" data-path="' + escapeAttr(field.path + '.' + ci + '.title') + '" value="' + escapeAttr(cat.title || '') + '"></div>' +
          '<div class="item-actions">' +
            '<button type="button" class="icon-btn" data-move="-1" data-list="' + listId + '" data-idx="' + ci + '" ' + (ci > 0 ? '' : 'disabled') + ' title="Move category up">\u2191</button>' +
            '<button type="button" class="icon-btn" data-move="1" data-list="' + listId + '" data-idx="' + ci + '" ' + (ci < categories.length - 1 ? '' : 'disabled') + ' title="Move category down">\u2193</button>' +
            '<button type="button" class="icon-btn danger" data-remove data-list="' + listId + '" data-idx="' + ci + '" title="Remove category">\u2715</button>' +
          '</div>' +
        '</div>' +
        '<div class="gallery-items">' + itemsHtml + '</div>' +
        '<button type="button" class="add-btn" style="margin-top:10px;" data-add-gallery-item="' + ci + '" data-list="' + listId + '">+ Add photo to this category</button>' +
        '</div>';
    }).join('');
    return '<div class="f"><label>' + escapeHtml(field.label) + '</label>' +
      '<div data-list-container="' + listId + '">' + catsHtml + '</div>' +
      '<button type="button" class="add-btn" data-add-gallery-cat="' + listId + '">+ Add category</button>' +
      '</div>';
  }

  /* ============================================================
     Event wiring (inputs, add/remove/move, image upload)
     ============================================================ */
  function findFieldDef(path) {
    // search schema for a field/subfield matching this literal path or its list-array parent
    for (var ti = 0; ti < SCHEMA.length; ti++) {
      var groups = SCHEMA[ti].groups;
      for (var gi = 0; gi < groups.length; gi++) {
        var fields = groups[gi].fields;
        for (var fi = 0; fi < fields.length; fi++) {
          if (fields[fi].path === path) return fields[fi];
        }
      }
    }
    return null;
  }

  function wireGroupEvents(root) {
    // plain text/textarea/select inputs bound via data-path
    $all('[data-path]', root).forEach(function (el) {
      var evt = (el.tagName === 'SELECT') ? 'change' : 'input';
      el.addEventListener(evt, function () {
        setPath(state.content, el.getAttribute('data-path'), el.value);
        markDirty();
      });
    });

    // image choose buttons
    $all('[data-img-choose]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var path = btn.getAttribute('data-img-choose');
        root.querySelector('[data-img-upload="' + cssEscape(path) + '"]').click();
      });
    });
    $all('[data-img-upload]', root).forEach(function (input) {
      input.addEventListener('change', function () {
        var file = input.files[0];
        if (!file) return;
        var path = input.getAttribute('data-img-upload');
        fileToDataUrl(file).then(function (dataUrl) {
          var filename = uniqueFilename(file.name);
          state.pendingUploads[path] = { filename: filename, dataUrl: dataUrl, file: file };
          // The public URL is predictable ahead of the actual upload (which happens on Save),
          // so the field can show its final value right away.
          setPath(state.content, path, SUPABASE_URL + '/storage/v1/object/public/' + STORAGE_BUCKET + '/uploads/' + filename);
          markDirty();
          renderTabContent(SCHEMA.filter(function (t) { return t.id === state.activeTab; })[0]);
        });
      });
    });

    // add item to a listobjects/liststrings array
    $all('[data-add-item]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var path = btn.getAttribute('data-add-item');
        var field = findFieldDef(path);
        var arr = getPath(state.content, path);
        if (!arr) { arr = []; setPath(state.content, path, arr); }
        arr.push(field.defaultItem ? field.defaultItem(arr) : {});
        markDirty();
        renderTabContent(SCHEMA.filter(function (t) { return t.id === state.activeTab; })[0]);
      });
    });
    $all('[data-add-string]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var path = btn.getAttribute('data-add-string');
        var arr = getPath(state.content, path);
        if (!arr) { arr = []; setPath(state.content, path, arr); }
        arr.push('');
        markDirty();
        renderTabContent(SCHEMA.filter(function (t) { return t.id === state.activeTab; })[0]);
      });
    });
    $all('[data-add-gallery-cat]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var path = btn.getAttribute('data-add-gallery-cat');
        var arr = getPath(state.content, path);
        arr.push({ number: pad2(arr.length + 1), title: 'New category', items: [] });
        markDirty();
        renderTabContent(SCHEMA.filter(function (t) { return t.id === state.activeTab; })[0]);
      });
    });
    $all('[data-add-gallery-item]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ci = parseInt(btn.getAttribute('data-add-gallery-item'), 10);
        var listPath = btn.getAttribute('data-list');
        var cat = getPath(state.content, listPath)[ci];
        if (!cat.items) cat.items = [];
        cat.items.push({ image: '', imageAlt: '', caption: '' });
        markDirty();
        renderTabContent(SCHEMA.filter(function (t) { return t.id === state.activeTab; })[0]);
      });
    });

    // remove item
    $all('[data-remove]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var listPath = btn.getAttribute('data-list');
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var arr = getPath(state.content, listPath);
        if (!arr || !confirm('Remove this item?')) return;
        arr.splice(idx, 1);
        markDirty();
        renderTabContent(SCHEMA.filter(function (t) { return t.id === state.activeTab; })[0]);
      });
    });

    // move item up/down
    $all('[data-move]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var dir = parseInt(btn.getAttribute('data-move'), 10);
        var listPath = btn.getAttribute('data-list');
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var arr = getPath(state.content, listPath);
        var newIdx = idx + dir;
        if (!arr || newIdx < 0 || newIdx >= arr.length) return;
        var tmp = arr[idx]; arr[idx] = arr[newIdx]; arr[newIdx] = tmp;
        markDirty();
        renderTabContent(SCHEMA.filter(function (t) { return t.id === state.activeTab; })[0]);
      });
    });
  }

  function cssEscape(s) {
    return s.replace(/[.#\[\]"'\\]/g, '\\$&');
  }

  /* ============================================================
     Save
     ============================================================ */
  function doSave() {
    if (state.saving) return;
    state.saving = true;
    var btn = $('#saveBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="border-color:rgba(255,255,255,.4); border-top-color:#fff;"></span> Saving…';
    setStatus('Saving…');

    var uploadPaths = Object.keys(state.pendingUploads);

    var chain = Promise.resolve();
    uploadPaths.forEach(function (path) {
      chain = chain.then(function () {
        var up = state.pendingUploads[path];
        return DB.uploadImage(up.file, up.filename);
      });
    });

    chain
      .then(function () {
        return DB.saveContent(state.content);
      })
      .then(function () {
        state.pendingUploads = {};
        state.dirty = false;
        setStatus('All changes saved', 'saved');
        toast('Saved! Your website will update within a few seconds.', 'ok');
      })
      .catch(function (err) {
        setStatus('Save failed', 'error');
        toast(err.message || 'Something went wrong saving. Please try again.', 'err');
      })
      .finally(function () {
        state.saving = false;
        btn.disabled = false;
        btn.textContent = 'Save changes';
      });
  }

  $('#saveBtn') && $('#saveBtn').addEventListener('click', doSave);

  /* ============================================================
     Boot
     ============================================================ */
  wireLogin();
})();
