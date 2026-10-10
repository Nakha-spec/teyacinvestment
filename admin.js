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
        },
        auth: {
          // By request: don't keep anyone signed in between visits. With
          // persistSession off, the session lives only in memory for the
          // current page — closing the tab or reloading always lands back
          // on the sign-in form, even if you just signed in a minute ago.
          persistSession: false
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
    // Change the signed-in owner's password.
    updatePassword: function (newPassword) {
      return getClient().auth.updateUser({ password: newPassword }).then(function (res) {
        if (res.error) throw new Error('Could not change password: ' + res.error.message);
      });
    },
    // Send a password-reset email. Supabase doesn't reveal whether the
    // address has an account either way, so the caller should always show
    // a neutral "check your email" message.
    resetPassword: function (email) {
      return getClient().auth.resetPasswordForEmail(email).then(function (res) {
        if (res.error) throw new Error('Could not send reset email: ' + res.error.message);
      });
    },
    // Start Google OAuth sign-in. On success the browser is redirected away
    // by Supabase itself; on failure (most commonly: the Google provider
    // hasn't been turned on for this project yet) this rejects.
    signInWithGoogle: function () {
      return getClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } }).then(function (res) {
        if (res.error) throw new Error(res.error.message || 'Google sign-in failed.');
      });
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
    // Read all saved contact-form enquiries, newest first.
    listMessages: function () {
      return getClient().from('messages').select('*').order('created_at', { ascending: false }).then(function (res) {
        if (res.error) throw new Error('Could not load messages: ' + res.error.message);
        return res.data || [];
      });
    },
    // Delete one enquiry (after following up on it, for example).
    deleteMessage: function (id) {
      return getClient().from('messages').delete().eq('id', id).then(function (res) {
        if (res.error) throw new Error('Could not delete message: ' + res.error.message);
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
    },
    // Media library: list every file in the uploads folder, newest first.
    listMedia: function () {
      return getClient().storage.from(STORAGE_BUCKET).list('uploads', {
        limit: 500,
        sortBy: { column: 'created_at', order: 'desc' }
      }).then(function (res) {
        if (res.error) throw new Error('Could not load media library: ' + res.error.message);
        return (res.data || []).filter(function (f) { return f && f.name && f.name !== '.emptyFolderPlaceholder'; });
      });
    },
    // Add a brand-new file to the media library.
    uploadMedia: function (file, filename) {
      var path = 'uploads/' + filename;
      return getClient().storage.from(STORAGE_BUCKET).upload(path, file, { upsert: false }).then(function (res) {
        if (res.error) throw new Error('Could not upload file: ' + res.error.message);
      });
    },
    // Overwrite an existing file at the same path/URL — anywhere that URL is
    // already used in your content will show the new file automatically,
    // with no need to re-save that content.
    replaceMedia: function (filename, file) {
      var path = 'uploads/' + filename;
      return getClient().storage.from(STORAGE_BUCKET).upload(path, file, { upsert: true }).then(function (res) {
        if (res.error) throw new Error('Could not replace file: ' + res.error.message);
      });
    },
    deleteMedia: function (filename) {
      var path = 'uploads/' + filename;
      return getClient().storage.from(STORAGE_BUCKET).remove([path]).then(function (res) {
        if (res.error) throw new Error('Could not delete file: ' + res.error.message);
      });
    },
    // Synchronous — matches how getPublicUrl behaves on the real client.
    getMediaPublicUrl: function (filename) {
      return getClient().storage.from(STORAGE_BUCKET).getPublicUrl('uploads/' + filename).data.publicUrl;
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
      ]},
      { title: 'Appearance', hint: 'Changes the colors used across the whole website. Changes go live within a few seconds of saving, same as any other edit.', fields: [
        { t: 'color', path: 'global.theme.buttonColor', label: 'Button / accent color', default: '#f28b32', hint: 'Used for buttons, highlights and call-to-action links.' },
        { t: 'color', path: 'global.theme.backgroundColor', label: 'Dark background color', default: '#102a45', hint: 'Used for the header, footer and dark section backgrounds.' },
        { t: 'color', path: 'global.theme.textColor', label: 'Body text color', default: '#091827', hint: 'The main reading-text color used across the site. Keep this dark for readability.' }
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
          ] },
        { t: 'select', path: 'home.featuredProjects.layout', label: 'Layout style', options: ['grid', 'list'], default: 'grid', hint: '"grid" shows cards side by side; "list" stacks them as wider rows.' },
        { t: 'select', path: 'home.featuredProjects.columns', label: 'Columns (grid layout only)', options: ['1', '2', '3'], default: '2' },
        { t: 'color', path: 'home.featuredProjects.sectionBg', label: 'Section background color', default: '#ffffff', resettable: true, hint: 'Leave alone to use the site\'s normal background.' }
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
          ] },
        { t: 'select', path: 'home.whyChoose.columns', label: 'Number of columns', options: ['2', '3', '4'], default: '3' },
        { t: 'color', path: 'home.whyChoose.sectionBg', label: 'Section background color', default: '#102a45', resettable: true, hint: 'Leave alone to use the site\'s dark background color from Appearance.' }
      ]},
      { title: 'Testimonials', hint: 'Shows a row of client quotes on the homepage. Only add real quotes from real clients.', fields: [
        { t: 'text', path: 'home.testimonials.kicker', label: 'Small label' },
        { t: 'text', path: 'home.testimonials.heading', label: 'Heading' },
        { t: 'listobjects', path: 'home.testimonials.items', label: 'Quotes', itemNoun: 'quote',
          itemTitle: function (it) { return it.name || 'New quote'; },
          defaultItem: function () { return { quote: '', name: '', role: '' }; },
          fields: [
            { key: 'quote', label: 'Quote', t: 'textarea', rows: 3 },
            { key: 'name', label: 'Client name', t: 'text' },
            { key: 'role', label: 'Company / project', t: 'text' }
          ] },
        { t: 'color', path: 'home.testimonials.sectionBg', label: 'Section background color', default: '#eef2f5', resettable: true }
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
          fields: [ { key: 'title', label: 'Title', t: 'text' }, { key: 'text', label: 'Description', t: 'textarea', rows: 2 } ] },
        { t: 'color', path: 'services.lines.0.sectionBg', label: 'Section background color', default: '#ffffff', resettable: true }
      ]},
      { title: 'Structural Steel', fields: [
        { t: 'text', path: 'services.lines.1.kicker', label: 'Small label' },
        { t: 'text', path: 'services.lines.1.heading', label: 'Heading' },
        { t: 'textarea', path: 'services.lines.1.lead', label: 'Intro text', rows: 2 },
        { t: 'listobjects', path: 'services.lines.1.subservices', label: 'Sub-services', itemNoun: 'service',
          itemTitle: function (it) { return it.title || 'New service'; },
          defaultItem: function () { return { title: 'New service', text: '' }; },
          fields: [ { key: 'title', label: 'Title', t: 'text' }, { key: 'text', label: 'Description', t: 'textarea', rows: 2 } ] },
        { t: 'color', path: 'services.lines.1.sectionBg', label: 'Section background color', default: '#102a45', resettable: true, hint: 'This section is dark by default — pick a dark color if you change it.' }
      ]},
      { title: 'Telecommunications', fields: [
        { t: 'text', path: 'services.lines.2.kicker', label: 'Small label' },
        { t: 'text', path: 'services.lines.2.heading', label: 'Heading' },
        { t: 'textarea', path: 'services.lines.2.lead', label: 'Intro text', rows: 2 },
        { t: 'listobjects', path: 'services.lines.2.subservices', label: 'Sub-services', itemNoun: 'service',
          itemTitle: function (it) { return it.title || 'New service'; },
          defaultItem: function () { return { title: 'New service', text: '' }; },
          fields: [ { key: 'title', label: 'Title', t: 'text' }, { key: 'text', label: 'Description', t: 'textarea', rows: 2 } ] },
        { t: 'color', path: 'services.lines.2.sectionBg', label: 'Section background color', default: '#ffffff', resettable: true }
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
        { t: 'gallery', path: 'projects.gallery.categories', label: 'Gallery categories & photos' },
        { t: 'color', path: 'projects.gallery.sectionBg', label: 'Section background color', default: '#ffffff', resettable: true }
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

    { id: 'announcements', label: 'Announcements', groups: [
      { title: 'Site announcements', hint: 'Shown as a banner at the very top of every page, above the header. "Urgent" style stands out in red. Leave the dates blank to show immediately with no expiry — set them to schedule or auto-remove an announcement.', fields: [
        { t: 'listobjects', path: 'announcements.items', label: 'Announcements', itemNoun: 'announcement',
          allowEmpty: true,
          itemTitle: function (it) { return it.title || 'New announcement'; },
          itemBadge: function (it) {
            var live = it.enabled !== false;
            return '<span class="pill ' + (live ? 'pill-live' : 'pill-draft') + '">' + (live ? 'Published' : 'Draft') + '</span>' +
              (it.kind === 'urgent' ? '<span class="pill pill-urgent">Urgent</span>' : '');
          },
          itemClass: function (it) {
            return (it.kind === 'urgent' ? 'kind-urgent' : 'kind-banner') + (it.enabled === false ? ' is-draft' : '');
          },
          defaultItem: function () { return { title: 'New announcement', message: '', kind: 'banner', image: '', imageAlt: '', link: '', linkText: '', startDate: '', endDate: '', enabled: true }; },
          fields: [
            { key: 'enabled', label: 'Published (visible on the website)', t: 'checkbox', half: true },
            { key: 'kind', label: 'Style', t: 'select', options: ['banner', 'urgent'], half: true },
            { key: 'title', label: 'Title', t: 'text' },
            { key: 'message', label: 'Message', t: 'textarea', rows: 2 },
            { key: 'image', label: 'Small photo (optional)', t: 'image' },
            { key: 'startDate', label: 'Show from (optional)', t: 'date', half: true },
            { key: 'endDate', label: 'Hide after (optional)', t: 'date', half: true },
            { key: 'link', label: 'Link URL (optional)', t: 'text', half: true },
            { key: 'linkText', label: 'Link button text', t: 'text', half: true }
          ] }
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
    activeTab: '__dashboard',
    saving: false,
    email: ''
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
    var sideTitle = $('#sideStatusTitle');
    var sideDot = $('#sideStatusDot');
    if (sideTitle) sideTitle.textContent = text;
    if (sideDot) sideDot.className = 'status-dot' + (kind ? ' ' + kind : '');
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
      var wantsRemember = !$('#rememberMeBox') || $('#rememberMeBox').checked;
      if (email && wantsRemember) rememberEmail(email);
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

    $('#forgotPasswordLink') && $('#forgotPasswordLink').addEventListener('click', function (e) {
      e.preventDefault();
      var link = this;
      var email = $('#fEmail').value.trim();
      if (!email) { showError('Enter your email address above, then click "Forgot password?" again.'); return; }
      hideError();
      var original = link.textContent;
      link.textContent = 'Sending…';
      DB.resetPassword(email)
        .then(function () {
          link.textContent = original;
          toast('If that email has an account, a password reset link has been sent to it.', 'ok');
        })
        .catch(function (err) {
          link.textContent = original;
          showError(err.message || 'Could not send the reset email. Please try again.');
        });
    });

    $('#googleSignInBtn') && $('#googleSignInBtn').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      hideError();
      DB.signInWithGoogle().catch(function () {
        btn.disabled = false;
        showError('Google sign-in isn’t turned on for this site yet. Ask whoever manages the Supabase project to enable the Google provider under Authentication → Providers, or sign in with email and password instead.');
      });
    });

    // Sessions aren't persisted (see persistSession:false above), so this
    // will only ever find a session within the same still-open page — e.g.
    // right after a successful sign-in, never after a reload or new visit.
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
    state.email = email || '';
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
     Account & password modal
     ============================================================ */
  function openAccountModal() {
    $('#accountEmail').textContent = state.email || '';
    $('#newPassword').value = '';
    $('#confirmPassword').value = '';
    $('#accountError').style.display = 'none';
    $('#accountModal').classList.add('show');
  }
  function closeAccountModal() {
    $('#accountModal').classList.remove('show');
  }
  function showAccountError(msg) {
    var box = $('#accountError');
    box.textContent = msg;
    box.style.display = 'block';
  }

  $('#accountBtn') && $('#accountBtn').addEventListener('click', openAccountModal);
  $('#accountCancelBtn') && $('#accountCancelBtn').addEventListener('click', closeAccountModal);
  $('#accountModal') && $('#accountModal').addEventListener('click', function (e) {
    if (e.target === $('#accountModal')) closeAccountModal();
  });
  $('#accountSaveBtn') && $('#accountSaveBtn').addEventListener('click', function () {
    var pw = $('#newPassword').value;
    var confirm2 = $('#confirmPassword').value;
    if (!pw || pw.length < 6) { showAccountError('Password must be at least 6 characters.'); return; }
    if (pw !== confirm2) { showAccountError('Those passwords don\'t match. Try again.'); return; }
    var btn = $('#accountSaveBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving…';
    DB.updatePassword(pw)
      .then(function () {
        closeAccountModal();
        toast('Password changed. Use it next time you sign in.', 'ok');
      })
      .catch(function (err) {
        showAccountError(err.message || 'Could not change the password. Please try again.');
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Change password';
      });
  });

  /* ============================================================
     Sidebar + tab switching
     ============================================================ */
  function renderSidebar() {
    var ul = $('#tabList');
    ul.innerHTML = '<li><button data-tab="__dashboard">Dashboard</button></li>' +
      SCHEMA.map(function (tab) {
        return '<li><button data-tab="' + tab.id + '">' + escapeHtml(tab.label) + '</button></li>';
      }).join('') +
      '<li><button data-tab="__messages">Messages</button></li>' +
      '<li><button data-tab="__media">Media Library</button></li>';
    $all('button[data-tab]', ul).forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
    });
  }

  // Which section of the live (single-page) site each tab corresponds to,
  // for the preview pane — matches the hash routes in index.html.
  var PAGE_HASH = { global: '', home: 'home', about: 'about', services: 'services', projects: 'projects', contact: 'contact', footer: '', pricing: '', announcements: '' };

  var TIPS = {
    global: ['Keep your company name and tagline short — they appear in the header on every page.', 'Use the international format for phone numbers, e.g. +263772541729.', 'These details update WhatsApp links and call buttons automatically.'],
    home: ['Use a high-resolution hero photo (1600px+ wide) for the best look.', 'Keep headlines under 10 words — they read best on mobile.', 'Feature your 2-3 strongest projects in Featured Projects.'],
    about: ['Keep mission and vision statements short and memorable.', 'Add real team members — a named leadership team builds trust.'],
    services: ['List your most-requested services first in each group.', 'Use plain language a first-time client would understand.'],
    projects: ['Add recent, real projects with photos — this is what convinces new clients.', 'Mark finished work "Complete" and current work "Ongoing" to show momentum.'],
    contact: ['Double-check your phone numbers and address are current.', 'The map updates automatically from your Chipinge office address below.'],
    footer: ['Keep the footer description to 1-2 sentences — it’s supporting text, not a sales pitch.'],
    pricing: ['This section isn’t shown on the live site yet — changes here are saved but not visible to visitors.'],
    announcements: ['An announcement appears as a banner above the header on every page — set "Published" to make it visible.', 'Use "Urgent" style sparingly, for things like safety notices or office closures.', 'Leave the dates blank to show it immediately with no expiry, or set them to schedule or auto-remove it.']
  };

  function updateSidebarPreview(tabId) {
    var hash = PAGE_HASH.hasOwnProperty(tabId) ? PAGE_HASH[tabId] : '';
    var target = 'index.html' + (hash ? '#' + hash : '');
    var frame = $('#previewFrame');
    if (frame && frame.getAttribute('data-loaded-for') !== tabId) {
      frame.src = target;
      frame.setAttribute('data-loaded-for', tabId);
    }
    var link = $('#sidePreviewLink');
    if (link) link.href = target;
  }

  function renderSideTips(tabId) {
    var list = TIPS[tabId] || ['Changes here go live within a few seconds of saving.'];
    var el = $('#sideTipsList');
    if (el) el.innerHTML = list.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('');
  }

  function switchTab(id) {
    state.activeTab = id;
    $all('#tabList button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === id);
    });
    window.scrollTo(0, 0);

    if (id === '__dashboard' || id === '__messages' || id === '__media') {
      $('#tabSidebar').style.display = 'none';
      $('#saveBtn').style.display = 'none';
      $('#statusText').style.display = 'none';
      if (id === '__dashboard') { $('#tabTitle').textContent = 'Dashboard'; loadDashboardTab(); }
      else if (id === '__messages') { $('#tabTitle').textContent = 'Messages'; loadMessagesTab(); }
      else { $('#tabTitle').textContent = 'Media Library'; loadMediaTab(); }
      return;
    }
    $('#tabSidebar').style.display = '';
    $('#saveBtn').style.display = '';
    $('#statusText').style.display = '';

    var tab = SCHEMA.filter(function (t) { return t.id === id; })[0];
    $('#tabTitle').textContent = tab.label;
    renderTabContent(tab);
    updateSidebarPreview(id);
    renderSideTips(id);
  }

  /* ============================================================
     Dashboard tab
     ============================================================ */
  function statCard(label, value, sub) {
    return '<div class="stat-card"><div class="stat-value">' + escapeHtml(value) + '</div>' +
      '<div class="stat-label">' + escapeHtml(label) + '</div>' +
      '<div class="stat-sub">' + escapeHtml(sub) + '</div></div>';
  }

  function loadDashboardTab() {
    $('#tabContent').innerHTML = '<div class="msg-empty">Loading dashboard…</div>';
    Promise.all([
      DB.listMessages().catch(function () { return []; }),
      DB.listMedia().catch(function () { return []; })
    ]).then(function (results) {
      if (state.activeTab !== '__dashboard') return;
      var messages = results[0];
      var media = results[1];
      var lastSaved = (state.content.meta && state.content.meta.lastSavedAt) ? formatDate(state.content.meta.lastSavedAt) : 'Not recorded yet';
      var recent = messages.slice(0, 3);

      var statusHtml = '<div class="banner info">Website status: <b>Live</b> at teyacinvestments.co.zw. Everything you save in this dashboard goes live automatically — there\'s no separate publish step yet.</div>';

      var statsHtml = '<div class="dash-grid">' +
        statCard('Website pages', '5', 'Home, About, Services, Projects, Contact') +
        statCard('Enquiries received', String(messages.length), messages.length ? 'See them under Messages' : 'None yet') +
        statCard('Media files', String(media.length), 'Photos & documents stored') +
        statCard('Last saved', lastSaved, 'Most recent content change') +
        '</div>';

      var recentHtml = '<div class="group"><div class="group-head"><h3>Recent enquiries</h3></div><div class="group-body">' +
        (recent.length
          ? recent.map(function (m) {
              var preview = (m.message || '').slice(0, 100) + ((m.message || '').length > 100 ? '…' : '');
              return '<div class="detail" style="margin-bottom:10px;"><b>' + escapeHtml(m.name || '(no name given)') + '</b> — ' +
                escapeHtml(formatDate(m.created_at)) + '<br>' + escapeHtml(preview) + '</div>';
            }).join('')
          : '<div class="msg-empty" style="padding:10px 0;">No enquiries yet. When someone fills in the contact form on your website, it will show up here.</div>') +
        '</div></div>';

      var actionsHtml = '<div class="group"><div class="group-head"><h3>Quick actions</h3></div><div class="group-body">' +
        '<div style="display:flex; gap:10px; flex-wrap:wrap;">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-goto="global">Edit company details</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-goto="__media">Open media library</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-goto="__messages">View enquiries</button>' +
          '<a class="btn btn-ghost btn-sm" href="index.html" target="_blank" rel="noopener">View live site</a>' +
        '</div></div></div>';

      $('#tabContent').innerHTML = statusHtml + statsHtml + recentHtml + actionsHtml;
      $all('[data-goto]', $('#tabContent')).forEach(function (btn) {
        btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-goto')); });
      });
      fadeTabContent();
    }).catch(function (err) {
      if (state.activeTab !== '__dashboard') return;
      $('#tabContent').innerHTML = '<div class="msg-empty">Could not load dashboard: ' + escapeHtml(err.message || 'unknown error') + '</div>';
    });
  }

  /* ============================================================
     Media library tab
     ============================================================ */
  function formatBytes(n) {
    if (n === undefined || n === null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function isImageFile(name, mimetype) {
    if (mimetype && mimetype.indexOf('image/') === 0) return true;
    return /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(name || '');
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('Link copied — paste it anywhere a photo or file address is needed.', 'ok');
      }).catch(function () {
        toast('Could not copy automatically. Link: ' + text, 'err');
      });
    } else {
      toast('Could not copy automatically. Link: ' + text, 'err');
    }
  }

  function uploadNewMedia(file) {
    var filename = uniqueFilename(file.name);
    toast('Uploading…', '');
    DB.uploadMedia(file, filename)
      .then(function () {
        toast('File uploaded.', 'ok');
        loadMediaTab();
      })
      .catch(function (err) {
        toast(err.message || 'Could not upload this file.', 'err');
      });
  }

  function replaceExistingMedia(name, file) {
    toast('Replacing…', '');
    DB.replaceMedia(name, file)
      .then(function () {
        toast('File replaced. Anywhere it\'s already used on your site will show the new version automatically.', 'ok');
        loadMediaTab();
      })
      .catch(function (err) {
        toast(err.message || 'Could not replace this file.', 'err');
      });
  }

  function loadMediaTab() {
    $('#tabContent').innerHTML = '<div class="msg-empty">Loading media library…</div>';
    DB.listMedia()
      .then(function (files) {
        if (state.activeTab !== '__media') return;
        renderMediaTab(files);
      })
      .catch(function (err) {
        if (state.activeTab !== '__media') return;
        $('#tabContent').innerHTML = '<div class="msg-empty">Could not load media library: ' + escapeHtml(err.message || 'unknown error') +
          '<br><br>If this keeps happening, the storage permissions in Supabase may need the extra listing/delete policy from the setup notes.</div>';
      });
  }

  function mediaCardHtml(f) {
    var size = f.metadata ? formatBytes(f.metadata.size) : '';
    var when = f.created_at ? formatDate(f.created_at) : '';
    var url = DB.getMediaPublicUrl(f.name);
    var isImg = isImageFile(f.name, f.metadata && f.metadata.mimetype);
    return '<div class="media-card">' +
      (isImg
        ? '<div class="media-thumb" style="background-image:url(\'' + encodeURI(url).replace(/'/g, '%27') + '\')"></div>'
        : '<div class="media-thumb media-thumb-doc">FILE</div>') +
      '<div class="media-meta">' +
        '<div class="media-name" title="' + escapeAttr(f.name) + '">' + escapeHtml(f.name) + '</div>' +
        '<div class="media-sub">' + escapeHtml(size) + (when ? ' · ' + escapeHtml(when) : '') + '</div>' +
      '</div>' +
      '<div class="media-actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-media-copy="' + escapeAttr(f.name) + '">Copy link</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-media-replace="' + escapeAttr(f.name) + '">Replace</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-media-delete="' + escapeAttr(f.name) + '">Delete</button>' +
      '</div>' +
      '<input type="file" style="display:none" data-media-replace-input="' + escapeAttr(f.name) + '">' +
      '</div>';
  }

  function renderMediaTab(files) {
    var uploadZone =
      '<div class="group"><div class="group-head"><h3>Upload new file</h3>' +
      '<p>Photos or documents for use anywhere on your website. After uploading, use "Copy link" to paste the file\'s address into a photo or document field.</p></div>' +
      '<div class="group-body">' +
        '<div class="upload-zone" id="mediaDropZone">' +
          '<input type="file" id="mediaFileInput" style="display:none">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="mediaChooseBtn">Choose file to upload</button>' +
          '<div class="hint" style="margin-top:8px;">or drag a file here</div>' +
        '</div>' +
      '</div></div>';

    var grid = files.length
      ? '<div class="media-grid">' + files.map(mediaCardHtml).join('') + '</div>'
      : '<div class="msg-empty">No files uploaded yet. Files you add to photo fields across the site will also appear here.</div>';

    $('#tabContent').innerHTML = uploadZone +
      '<div class="group"><div class="group-head"><h3>All files (' + files.length + ')</h3></div><div class="group-body">' + grid + '</div></div>';

    wireMediaEvents();
    fadeTabContent();
  }

  function wireMediaEvents() {
    var root = $('#tabContent');

    $('#mediaChooseBtn') && $('#mediaChooseBtn').addEventListener('click', function () {
      $('#mediaFileInput').click();
    });
    $('#mediaFileInput') && $('#mediaFileInput').addEventListener('change', function () {
      var file = this.files[0];
      this.value = '';
      if (file) uploadNewMedia(file);
    });
    var zone = $('#mediaDropZone');
    if (zone) {
      ['dragover', 'dragenter'].forEach(function (evt) {
        zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.add('drag-over'); });
      });
      ['dragleave', 'drop'].forEach(function (evt) {
        zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.remove('drag-over'); });
      });
      zone.addEventListener('drop', function (e) {
        var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) uploadNewMedia(file);
      });
    }

    $all('[data-media-copy]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        copyToClipboard(DB.getMediaPublicUrl(btn.getAttribute('data-media-copy')));
      });
    });

    $all('[data-media-replace]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-media-replace');
        root.querySelector('[data-media-replace-input="' + cssEscape(name) + '"]').click();
      });
    });
    $all('[data-media-replace-input]', root).forEach(function (input) {
      input.addEventListener('change', function () {
        var file = this.files[0];
        var name = input.getAttribute('data-media-replace-input');
        this.value = '';
        if (file) replaceExistingMedia(name, file);
      });
    });

    $all('[data-media-delete]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-media-delete');
        if (!confirm('Delete "' + name + '"? If this file is used as a photo anywhere on your site, that photo will stop showing until replaced. This cannot be undone.')) return;
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        DB.deleteMedia(name)
          .then(function () {
            toast('File deleted.', 'ok');
            loadMediaTab();
          })
          .catch(function (err) {
            toast(err.message || 'Could not delete this file.', 'err');
            btn.disabled = false;
            btn.textContent = 'Delete';
          });
      });
    });
  }

  /* ============================================================
     Messages tab (contact-form enquiries saved from the public site)
     ============================================================ */
  function formatDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
        ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso || ''; }
  }
  function formatMsgDate(iso) { return formatDate(iso); }

  function loadMessagesTab() {
    $('#tabContent').innerHTML = '<div class="msg-empty">Loading messages…</div>';
    DB.listMessages()
      .then(function (rows) {
        if (state.activeTab !== '__messages') return; // user navigated away while loading
        if (!rows.length) {
          $('#tabContent').innerHTML = '<div class="msg-empty">No enquiries yet. When someone fills in the contact form on your website, it will show up here.</div>';
          return;
        }
        $('#tabContent').innerHTML = rows.map(function (m) {
          return '<div class="msg-card" data-msg-id="' + escapeAttr(m.id) + '">' +
            '<div class="msg-card-head"><span class="who">' + escapeHtml(m.name || '(no name given)') + '</span>' +
            '<span class="when">' + escapeHtml(formatMsgDate(m.created_at)) + '</span></div>' +
            '<div class="detail"><b>Phone:</b> ' + escapeHtml(m.phone || '—') + '</div>' +
            '<div class="detail"><b>Project type:</b> ' + escapeHtml(m.service || '—') + '</div>' +
            '<div class="detail"><b>Message:</b> ' + escapeHtml(m.message || '—') + '</div>' +
            '<div style="margin-top:10px;"><button type="button" class="btn btn-ghost btn-sm" data-delete-msg="' + escapeAttr(m.id) + '">Delete</button></div>' +
            '</div>';
        }).join('');
        $all('[data-delete-msg]', $('#tabContent')).forEach(function (btn) {
          btn.addEventListener('click', function () {
            if (!confirm('Delete this message? This cannot be undone.')) return;
            var id = btn.getAttribute('data-delete-msg');
            btn.disabled = true;
            btn.textContent = 'Deleting…';
            DB.deleteMessage(id)
              .then(function () {
                var card = btn.closest('.msg-card');
                if (card) card.remove();
                if (!$('#tabContent').querySelector('.msg-card')) {
                  $('#tabContent').innerHTML = '<div class="msg-empty">No enquiries yet. When someone fills in the contact form on your website, it will show up here.</div>';
                }
              })
              .catch(function (err) {
                toast(err.message || 'Could not delete this message.', 'err');
                btn.disabled = false;
                btn.textContent = 'Delete';
              });
          });
        });
        fadeTabContent();
      })
      .catch(function (err) {
        if (state.activeTab !== '__messages') return;
        $('#tabContent').innerHTML = '<div class="msg-empty">Could not load messages: ' + escapeHtml(err.message || 'unknown error') + '</div>';
      });
  }

  /* ============================================================
     Field renderers
     ============================================================ */
  function fadeTabContent() {
    var el = $('#tabContent');
    el.classList.remove('fade-in');
    void el.offsetWidth; // force reflow so the animation replays
    el.classList.add('fade-in');
  }

  function renderTabContent(tab) {
    var html = tab.groups.map(renderGroup).join('');
    $('#tabContent').innerHTML = html;
    wireGroupEvents($('#tabContent'));
    fadeTabContent();
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
      case 'color': return renderColor(field);
      case 'select': return renderSelectField(field);
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

  function renderColor(field) {
    var raw = getPath(state.content, field.path);
    var val = raw || field.default || '#000000';
    return '<div class="f"><label>' + escapeHtml(field.label) + '</label>' +
      '<div class="color-field">' +
        '<input type="color" data-path="' + escapeAttr(field.path) + '" value="' + escapeAttr(val) + '">' +
        '<span class="color-value">' + escapeHtml(val) + '</span>' +
        (field.resettable ? '<button type="button" class="btn btn-ghost btn-sm" data-color-reset="' + escapeAttr(field.path) + '">Reset to default</button>' : '') +
      '</div>' +
      (field.hint ? '<div class="hint">' + escapeHtml(field.hint) + '</div>' : '') + '</div>';
  }

  function renderSelectField(field) {
    var val = getPath(state.content, field.path) || field.default || field.options[0];
    return '<div class="f"><label>' + escapeHtml(field.label) + '</label>' +
      renderSelect(field, field.path, val) +
      (field.hint ? '<div class="hint">' + escapeHtml(field.hint) + '</div>' : '') + '</div>';
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

  function itemHeader(noun, idx, title, canMoveUp, canMoveDown, canRemove, listId, badgeHtml) {
    return '<div class="list-item-head"><span class="tag">' + escapeHtml(title) + '</span>' + (badgeHtml || '') +
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
    var cls = 'f' + (sub.half ? ' f-half' : ' f-full');
    if (sub.t === 'image') {
      return renderImage({ t: 'image', path: path, label: sub.label }).replace('<div class="f">', '<div class="' + cls + '">');
    }
    if (sub.t === 'select') {
      return '<div class="' + cls + '"><label>' + escapeHtml(sub.label) + '</label>' + renderSelect(sub, path, val) + '</div>';
    }
    if (sub.t === 'textarea') {
      return '<div class="' + cls + '"><label>' + escapeHtml(sub.label) + '</label><textarea rows="' + (sub.rows || 2) + '" data-path="' + escapeAttr(path) + '">' + escapeHtml(val || '') + '</textarea></div>';
    }
    if (sub.t === 'date') {
      return '<div class="' + cls + '"><label>' + escapeHtml(sub.label) + '</label><input type="date" data-path="' + escapeAttr(path) + '" value="' + escapeAttr(val || '') + '"></div>';
    }
    if (sub.t === 'checkbox') {
      return '<div class="' + cls + ' f-checkbox"><label class="checkbox-row"><input type="checkbox" data-path="' + escapeAttr(path) + '"' + (val !== false ? ' checked' : '') + '> ' + escapeHtml(sub.label) + '</label></div>';
    }
    return '<div class="' + cls + '"><label>' + escapeHtml(sub.label) + '</label><input type="text" data-path="' + escapeAttr(path) + '" value="' + escapeAttr(val || '') + '"></div>';
  }

  function renderListObjects(field, arr) {
    var listId = field.path;
    var canRemove = field.allowEmpty || arr.length > 1;
    var itemsHtml = arr.map(function (item, idx) {
      var title = field.itemTitle ? field.itemTitle(item, idx) : ('Item ' + (idx + 1));
      var badgeHtml = field.itemBadge ? field.itemBadge(item, idx) : '';
      var extraClass = field.itemClass ? (' ' + field.itemClass(item, idx)) : '';
      return '<div class="list-item' + extraClass + '">' +
        itemHeader(field.itemNoun, idx, title, idx > 0, idx < arr.length - 1, canRemove, listId, badgeHtml) +
        '<div class="list-item-fields">' + field.fields.map(function (sub) { return renderSubfield(sub, field.path, idx, item); }).join('') + '</div>' +
        '</div>';
    }).join('');
    var emptyHint = (field.allowEmpty && !arr.length) ? '<div class="list-empty-hint">None yet — click below to add one.</div>' : '';
    return '<div class="f"><label>' + escapeHtml(field.label) + '</label>' +
      '<div class="list-items" data-list-container="' + listId + '">' + itemsHtml + '</div>' + emptyHint +
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
    // plain text/textarea/select/date/checkbox inputs bound via data-path
    $all('[data-path]', root).forEach(function (el) {
      var isCheckbox = el.type === 'checkbox';
      var evt = (el.tagName === 'SELECT' || isCheckbox) ? 'change' : 'input';
      el.addEventListener(evt, function () {
        setPath(state.content, el.getAttribute('data-path'), isCheckbox ? el.checked : el.value);
        markDirty();
      });
    });

    // color pickers: keep the hex-value label in sync as the user drags the picker
    $all('input[type="color"][data-path]', root).forEach(function (el) {
      el.addEventListener('input', function () {
        var span = el.parentElement.querySelector('.color-value');
        if (span) span.textContent = el.value;
      });
    });

    // "Reset to default" on an optional section-background color — clears the
    // override so the section falls back to the site's normal color again.
    $all('[data-color-reset]', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        setPath(state.content, btn.getAttribute('data-color-reset'), '');
        markDirty();
        renderTabContent(SCHEMA.filter(function (t) { return t.id === state.activeTab; })[0]);
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
        state.content.meta = state.content.meta || {};
        state.content.meta.lastSavedAt = new Date().toISOString();
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
