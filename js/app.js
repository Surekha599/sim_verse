/* ==========================================================================
   SimVerse — application logic (vanilla JS, no dependencies)
   ========================================================================== */
(function () {
  'use strict';

  var DATA = window.SIMVERSE_DATA;
  var QUOTES = window.SIMVERSE_QUOTES || [];
  var SOON = window.SIMVERSE_SOON_COPY || [];

  /* ---------------------------------------------------------------- state */
  var LS_OPENED = 'simverse.opened.v1';
  var LS_LAST = 'simverse.lastgrade.v1';
  var opened = loadOpened();
  var lastGrade = null;
  try { lastGrade = localStorage.getItem(LS_LAST); } catch (e) {}

  var view = document.getElementById('view');
  var toastEl = document.getElementById('toast');
  var toastTimer = null;

  var SUBJECT_ORDER = ['physics', 'chemistry', 'mathematics', 'biology'];

  var SUBJECT_ICON = {
    physics: '<circle cx="12" cy="12" r="2.6"/><ellipse cx="12" cy="12" rx="10" ry="4.4"/><ellipse cx="12" cy="12" rx="10" ry="4.4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.4" transform="rotate(120 12 12)"/>',
    chemistry: '<path d="M9.2 2.6h5.6v5.1l4.6 8.6a2.5 2.5 0 0 1-2.2 3.7H6.8a2.5 2.5 0 0 1-2.2-3.7l4.6-8.6V2.6z"/><path d="M6.6 14.6h10.8"/>',
    mathematics: '<path d="M4.6 5.4h14.8M4.6 12h14.8M4.6 18.6h14.8"/><circle cx="8.4" cy="8.7" r="1.1"/><circle cx="15.6" cy="15.3" r="1.1"/>',
    biology: '<path d="M7 21c0-8 3.6-13.5 10-16.5"/><path d="M17 21c0-8-3.6-13.5-10-16.5"/><path d="M7.4 16.4h9.2M8.6 12.2h6.8"/>'
  };

  /* -------------------------------------------------------------- helpers */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pf(key) { return (DATA.platforms && DATA.platforms[key]) || { name: key, home: '' }; }
  function initials(name) {
    var p = String(name).replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/);
    if (p.length > 1) return (p[0][0] + p[1][0]).toUpperCase();
    return String(name).slice(0, 2).toUpperCase();
  }
  function hashKey(s) {
    var h = 5381, i;
    s = String(s);
    for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function fmt(n) { return Number(n || 0).toLocaleString('en-IN'); }

  function loadOpened() {
    try {
      var raw = localStorage.getItem(LS_OPENED);
      var o = raw ? JSON.parse(raw) : {};
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }
  function saveOpened() {
    try { localStorage.setItem(LS_OPENED, JSON.stringify(opened)); } catch (e) {}
  }
  function markOpened(url, meta) {
    opened[url] = { t: Date.now(), p: meta.p, g: meta.g, s: meta.s, c: meta.c, n: meta.n };
    saveOpened();
  }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }

  function gradeLabel(g) { return 'Class ' + g; }
  function subjectName(k) {
    var map = { physics: 'Physics', chemistry: 'Chemistry', mathematics: 'Mathematics', biology: 'Biology' };
    return map[k] || k;
  }
  function subjectOf(g, s) {
    var node = DATA.grades[g];
    return node && node.subjects && node.subjects[s];
  }
  function gradeCount(g) {
    var n = DATA.grades[g], t = 0, s = 0;
    if (!n) return { topics: 0, sims: 0, subjects: 0 };
    SUBJECT_ORDER.forEach(function (k) {
      var sn = n.subjects[k];
      if (sn) { t += sn.topicCount; s += sn.simCount; }
    });
    return { topics: t, sims: s, subjects: Object.keys(n.subjects).length };
  }

  /* ----------------------------------------------------------- search core */
  var INDEX = [];
  function buildIndex() {
    INDEX = [];
    Object.keys(DATA.grades).forEach(function (g) {
      var gn = DATA.grades[g];
      SUBJECT_ORDER.forEach(function (s) {
        var sn = gn.subjects[s];
        if (!sn) return;
        sn.chapters.forEach(function (ch, ci) {
          INDEX.push({ k: 'chapter', g: g, s: s, c: ci, n: ch.title,
            sub: gradeLabel(g) + ' · ' + subjectName(s), sims: ch.simCount, topics: ch.topics.length });
          ch.topics.forEach(function (t, ti) {
            INDEX.push({ k: 'topic', g: g, s: s, c: ci, t: ti, n: t.title,
              sub: gradeLabel(g) + ' · ' + subjectName(s) + ' · ' + ch.title,
              sims: t.sims.length, label: t.label || '' });
          });
        });
      });
    });
  }

  function scoreToken(q, n, nameWords) {
    if (n === q) return 1200;
    if (n.indexOf(q) === 0) return 800 - Math.min(60, n.length - q.length);
    var at = n.indexOf(q);
    if (at >= 0) return 620 - Math.min(180, at);
    for (var i = 0; i < nameWords.length; i++) {
      if (nameWords[i].indexOf(q) === 0) return 460;
    }
    // subsequence fallback
    var qi = 0, gap = 0, last = -1;
    for (var j = 0; j < n.length && qi < q.length; j++) {
      if (n[j] === q[qi]) {
        if (last >= 0) gap += j - last - 1;
        last = j; qi++;
      }
    }
    if (qi === q.length) return Math.max(40, 300 - gap * 3);
    return 0;
  }

  function score(query, item) {
    var n = item.n.toLowerCase();
    if (!n) return 0;
    var q = query.toLowerCase().trim();
    var nameWords = n.split(/[^a-z0-9]+/);
    var hay = n + ' ' + (item.sub || '').toLowerCase();

    var tokens = q.split(/\s+/).filter(function (t) { return t.length > 1; });
    if (tokens.length <= 1) return scoreToken(q, n, nameWords);

    // multi-word: every word must appear in the topic or its context
    var total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var s = scoreToken(tokens[i], n, nameWords);
      if (!s) {
        if (hay.indexOf(tokens[i]) < 0) return 0;   // word missing entirely
        s = 120;                                     // matched via chapter/subject
      }
      total += s;
    }
    return total / tokens.length + 40;
  }

  function highlight(text, q) {
    if (!q) return esc(text);
    var tokens = String(q).toLowerCase().split(/\s+/).filter(function (t) { return t.length > 1; });
    if (!tokens.length) return esc(text);
    var lower = String(text).toLowerCase();
    var marks = [];
    tokens.forEach(function (t) {
      var from = 0, i;
      while ((i = lower.indexOf(t, from)) >= 0) {
        marks.push([i, i + t.length]);
        from = i + t.length;
      }
    });
    if (!marks.length) return esc(text);
    marks.sort(function (a, b) { return a[0] - b[0]; });
    var out = '', last = 0;
    marks.forEach(function (m) {
      if (m[0] < last) return;
      out += esc(text.slice(last, m[0])) + '<mark>' + esc(text.slice(m[0], m[1])) + '</mark>';
      last = m[1];
    });
    return out + esc(text.slice(last));
  }

  function search(query, limit) {
    var q = (query || '').trim();
    if (q.length < 2) return [];
    var scored = [];
    for (var i = 0; i < INDEX.length; i++) {
      var sc = score(q, INDEX[i]);
      if (sc > 0) scored.push([sc, INDEX[i]]);
    }
    scored.sort(function (a, b) {
      if (b[0] !== a[0]) return b[0] - a[0];
      return (b[1].sims - a[1].sims) || a[1].n.localeCompare(b[1].n);
    });
    return scored.slice(0, limit || 40).map(function (x) { return x[1]; });
  }

  function hrefFor(item) {
    var base = '#/class/' + item.g + '/' + item.s + '/' + item.c;
    if (item.k === 'chapter') return base;
    return base + '?t=' + item.t;
  }

  /* ------------------------------------------------------------ components */
  function crumbs(parts) {
    var h = '<nav class="crumbs" aria-label="Breadcrumb">';
    parts.forEach(function (p, i) {
      if (i) h += '<span class="sep">/</span>';
      h += p.href
        ? '<a href="' + p.href + '" data-nav>' + esc(p.label) + '</a>'
        : '<span class="here">' + esc(p.label) + '</span>';
    });
    return h + '</nav>';
  }

  function bar(ready, total, showPct) {
    var pct = total ? Math.round(ready / total * 100) : 0;
    return '<div class="bar-row"><div class="bar" style="flex:1"><i style="width:' + pct + '%"></i></div>' +
      (showPct === false ? '' : '<span class="pct">' + pct + '%</span>') + '</div>';
  }

  function platformChips(list, max) {
    var counts = {};
    list.forEach(function (t) {
      t.sims.forEach(function (s) { counts[s.platform] = (counts[s.platform] || 0) + 1; });
    });
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var shown = keys.slice(0, max || 6);
    var h = '<div class="chip-row">';
    shown.forEach(function (k) {
      h += '<span class="chip">' + esc(pf(k).name) + ' <b>' + counts[k] + '</b></span>';
    });
    if (keys.length > shown.length) {
      h += '<span class="chip empty">+' + (keys.length - shown.length) + ' more</span>';
    }
    if (!keys.length) h += '<span class="chip empty">no simulations indexed yet</span>';
    return h + '</div>';
  }

  function iconSvg(key, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) +
      '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (SUBJECT_ICON[key] || '') + '</svg>';
  }

  /* ---------------------------------------------------------------- views */
  function viewHome() {
    var meta = DATA.meta;
    var g = lastGrade && DATA.grades[lastGrade] ? lastGrade : null;

    var classCards = Object.keys(DATA.grades).map(function (gk, i) {
      var c = gradeCount(gk);
      return '<a class="card card-link class-card reveal" style="animation-delay:' + (i * 60) + 'ms" href="#/class/' + gk + '" data-nav>' +
        '<div class="class-num">' + esc(gk) + '</div>' +
        '<div class="micro" style="margin-top:6px">Class ' + esc(gk) + '</div>' +
        '<div class="class-meta">' +
        '<div>Subjects<b>' + c.subjects + '</b></div>' +
        '<div>Topics<b>' + fmt(c.topics) + '</b></div>' +
        '<div>Simulations<b>' + fmt(c.sims) + '</b></div>' +
        '</div></a>';
    }).join('');

    var platformTop = Object.keys(DATA.platformCounts).slice(0, 8).map(function (k) {
      return '<a class="chip" href="#/platforms" data-nav>' + esc(pf(k).name) + ' <b>' + DATA.platformCounts[k] + '</b></a>';
    }).join('');

    return '' +
      '<section class="hero"><div class="shell"><div class="hero-grid">' +
        '<div>' +
          '<p class="eyebrow reveal">Classes 9–12 · Physics · Chemistry · Maths · Biology</p>' +
          '<h1 class="h1 reveal" style="animation-delay:60ms">Stop hunting for<br>simulations. <span class="grad">Start teaching.</span></h1>' +
          '<p class="hero-sub reveal" style="animation-delay:140ms">SimVerse indexes every interactive simulation your NCERT syllabus needs — ' +
          'across ' + meta.platforms + ' platforms — and files them under class, subject, chapter and topic. Pick your topic, open the simulation, done.</p>' +
          '<div class="hero-cta reveal" style="animation-delay:200ms">' +
            '<a class="btn btn-primary" href="#/class/' + (g || '10') + '" data-nav>' +
              '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 10h11M11 5l5 5-5 5"/></svg>' +
              'Browse the library</a>' +
            '<button class="btn btn-ghost" type="button" data-open-search>Search ' + fmt(meta.topics) + ' topics</button>' +
          '</div>' +
        '</div>' +
        '<div class="hero-stats reveal" style="animation-delay:260ms">' +
          '<div class="stat"><b>' + fmt(meta.sims) + '</b><span>Simulation links</span></div>' +
          '<div class="stat"><b>' + fmt(meta.topics) + '</b><span>Topics indexed</span></div>' +
          '<div class="stat"><b>' + meta.chapters + '</b><span>Chapters</span></div>' +
          '<div class="stat"><b>' + meta.platforms + '</b><span>Platforms</span></div>' +
        '</div>' +
      '</div></div></section>' +

      '<section class="section"><div class="shell">' +
        '<p class="eyebrow">Step 1</p>' +
        '<h2 class="h2">Choose your class</h2>' +
        '<p class="lede">Each class holds four subjects, every chapter of the NCERT syllabus, and the simulations filed under each topic.</p>' +
        '<div class="grid g-class mt-l">' + classCards + '</div>' +
      '</div></section>' +

      '<section class="section"><div class="shell">' +
        '<div class="row between wrap" style="gap:18px">' +
          '<div><p class="eyebrow">How it works</p><h2 class="h2">Three clicks to the right simulation</h2></div>' +
        '</div>' +
        '<div class="grid g-subject mt-l">' +
          step('01', 'Pick class & subject', 'Class 9 to 12, each with Physics, Chemistry, Mathematics and Biology.') +
          step('02', 'Open the chapter', 'Chapters follow your textbook order, with live coverage of how many topics have simulations.') +
          step('03', 'Launch the simulation', 'Every topic lists the exact simulations available, labelled with the platform. Links open on the original site.') +
        '</div>' +
      '</div></section>' +

      '<section class="section"><div class="shell">' +
        '<div class="quote-card reveal">' +
          '<div class="quote-mark" aria-hidden="true">&ldquo;</div>' +
          '<div>' +
            '<p class="quote-text" id="homeQuote"></p>' +
            '<div class="quote-by" id="homeQuoteBy"></div>' +
            '<div class="quote-actions">' +
              '<button class="btn btn-ghost btn-sm" type="button" data-next-quote>Another quote</button>' +
              '<a class="btn btn-ghost btn-sm" href="#/platforms" data-nav>See all ' + meta.platforms + ' platforms</a>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="chip-row mt-m">' + platformTop + '</div>' +
      '</div></section>';
  }

  function step(n, title, body) {
    return '<div class="card reveal" style="padding:22px">' +
      '<div class="micro" style="color:var(--accent)">' + n + '</div>' +
      '<h3 class="h3" style="margin-top:10px">' + esc(title) + '</h3>' +
      '<p style="margin:9px 0 0;color:var(--txt-2);font-size:14px">' + esc(body) + '</p></div>';
  }

  function viewClass(g) {
    var gn = DATA.grades[g];
    if (!gn) return notFound('That class is not in the library yet.');
    try { localStorage.setItem(LS_LAST, g); } catch (e) {}

    var cards = SUBJECT_ORDER.map(function (k, i) {
      var sn = gn.subjects[k];
      if (!sn) return '';
      var pct = sn.topicCount ? Math.round(sn.readyCount / sn.topicCount * 100) : 0;
      return '<a class="card card-link subject-card s-' + k + ' reveal" style="animation-delay:' + (i * 70) + 'ms" ' +
        'href="#/class/' + g + '/' + k + '" data-nav>' +
        '<div class="subj-top"><span class="subj-ico">' + iconSvg(k, 19) + '</span>' +
        '<div><h3 class="h3">' + esc(sn.name) + '</h3>' +
        '<div class="micro" style="margin-top:3px">' + sn.chapters.length + ' chapters</div></div></div>' +
        bar(sn.readyCount, sn.topicCount) +
        '<div class="subj-stats">' +
          '<div>Topics<b>' + fmt(sn.topicCount) + '</b></div>' +
          '<div>With sims<b>' + fmt(sn.readyCount) + '</b></div>' +
          '<div>Sim links<b>' + fmt(sn.simCount) + '</b></div>' +
        '</div>' +
        platformChips(sn.chapters.reduce(function (a, c) { return a.concat(c.topics); }, []), 5) +
        '</a>';
    }).join('');

    var total = gradeCount(g);
    return '<div class="shell section">' +
      crumbs([{ label: 'Home', href: '#/' }, { label: 'Class ' + g }]) +
      '<p class="eyebrow">Step 2 · choose a subject</p>' +
      '<h2 class="h2">Class ' + esc(g) + '</h2>' +
      '<p class="lede">' + fmt(total.topics) + ' topics across ' + total.subjects + ' subjects, backed by ' + fmt(total.sims) + ' indexed simulation links.</p>' +
      '<div class="grid g-subject mt-l">' + cards + '</div>' +
      '</div>';
  }

  function viewSubject(g, s) {
    var sn = subjectOf(g, s);
    if (!sn) return notFound('That subject is not indexed for Class ' + g + '.');

    var cards = sn.chapters.map(function (ch, ci) {
      var pct = ch.topics.length ? Math.round(ch.ready / ch.topics.length * 100) : 0;
      var num = (ch.title.match(/^\s*(?:chapter|unit)\s*(\d+)/i) || [])[1];
      return '<a class="card card-link chap-card s-' + s + ' reveal" style="animation-delay:' + Math.min(ci * 28, 420) + 'ms" ' +
        'href="#/class/' + g + '/' + s + '/' + ci + '" data-nav>' +
        '<div class="row between"><span class="idx">' + (num ? 'Chapter ' + num : 'Chapter ' + (ci + 1)) + '</span>' +
        '<span class="micro">' + pct + '%</span></div>' +
        '<h3 class="h3">' + esc(ch.title.replace(/^\s*(?:chapter|unit)\s*\d+\s*[:\-–]\s*/i, '')) + '</h3>' +
        bar(ch.ready, ch.topics.length, false) +
        '<div class="chap-foot">' +
          '<div class="micro">' + ch.ready + '/' + ch.topics.length + ' topics ready · ' + ch.simCount + ' sims</div>' +
        '</div>' +
        platformChips(ch.topics, 4) +
        '</a>';
    }).join('');

    return '<div class="shell section">' +
      crumbs([{ label: 'Home', href: '#/' }, { label: 'Class ' + g, href: '#/class/' + g }, { label: sn.name }]) +
      '<p class="eyebrow s-' + s + '">Step 3 · choose a chapter</p>' +
      '<h2 class="h2 s-' + s + '">' + esc(sn.name) + ' <span class="muted" style="font-size:.55em">· Class ' + esc(g) + '</span></h2>' +
      '<p class="lede">' + sn.chapters.length + ' chapters · ' + fmt(sn.topicCount) + ' topics · ' + fmt(sn.simCount) + ' simulation links · ' +
      Math.round(sn.readyCount / sn.topicCount * 100) + '% of topics already have a simulation.</p>' +
      '<div class="grid g-chapter mt-l">' + cards + '</div>' +
      '</div>';
  }

  function viewChapter(g, s, ci, filter) {
    var sn = subjectOf(g, s);
    if (!sn) return notFound('Subject not found.');
    var ch = sn.chapters[ci];
    if (!ch) return notFound('Chapter not found.');

    var topics = ch.topics;
    var list = topics;
    if (filter === 'ready') list = topics.filter(function (t) { return t.sims.length; });
    if (filter === 'soon') list = topics.filter(function (t) { return !t.sims.length; });

    var f = function (id, label, n) {
      return '<button class="fbtn' + ((filter || 'all') === id ? ' on' : '') + '" type="button" ' +
        'data-filter="' + id + '">' + esc(label) + ' <span style="opacity:.6">' + n + '</span></button>';
    };

    var soonCount = topics.length - ch.ready;
    var body;
    if (!list.length) {
      body = '<div class="empty-state"><p class="h3">Nothing here yet.</p><p class="muted mt-s">Switch the filter above to see the other topics in this chapter.</p></div>';
    } else {
      body = '<div class="grid g-chapter" id="topicGrid">' + list.map(function (t, i) {
        return topicCard(t, { g: g, s: s, c: ci, title: ch.title }, topics.indexOf(t), i);
      }).join('') + '</div>';
    }

    return '<div class="shell section">' +
      crumbs([
        { label: 'Home', href: '#/' },
        { label: 'Class ' + g, href: '#/class/' + g },
        { label: sn.name, href: '#/class/' + g + '/' + s },
        { label: ch.title.replace(/^\s*(?:chapter|unit)\s*\d+\s*[:\-–]\s*/i, '') }
      ]) +
      '<div class="row between wrap" style="gap:16px;align-items:flex-end">' +
        '<div style="min-width:0">' +
          '<p class="eyebrow s-' + s + '">Chapter ' + (ci + 1) + ' · ' + esc(sn.name) + ' · Class ' + esc(g) + '</p>' +
          '<h2 class="h2">' + esc(ch.title.replace(/^\s*(?:chapter|unit)\s*\d+\s*[:\-–]\s*/i, '')) + '</h2>' +
          '<p class="lede">' + ch.topics.length + ' topics · ' + ch.simCount + ' simulations · ' +
          ch.ready + ' topics ready · ' + soonCount + ' in progress</p>' +
        '</div>' +
        '<div style="min-width:220px">' + bar(ch.ready, ch.topics.length) + '</div>' +
      '</div>' +
      '<hr class="hr">' +
      '<div class="filter-row">' +
        f('all', 'All topics', ch.topics.length) +
        f('ready', 'Has simulation', ch.ready) +
        f('soon', 'Coming soon', soonCount) +
      '</div>' +
      body +
      (soonCount ? '<div class="mt-l">' + soonBlock(soonCount, g + '/' + s + '/' + ci) + '</div>' : '') +
      '</div>';
  }

  function topicCard(t, ctx, realIdx, i) {
    var empty = !t.sims.length;
    var code = t.activity ? '<span class="act-code">' + esc(t.activity) + '</span>' : '';
    var sims = t.sims.map(function (sim) {
      var p = pf(sim.platform);
      var visited = opened[sim.url] ? ' visited' : '';
      return '<a class="sim' + visited + '" href="' + esc(sim.url) + '" target="_blank" rel="noopener noreferrer" ' +
        'data-sim="' + esc(sim.url) + '" data-p="' + esc(sim.platform) + '" data-g="' + esc(ctx.g) + '" ' +
        'data-s="' + esc(ctx.s) + '" data-c="' + esc(ctx.c) + '" data-n="' + esc(t.title) + '" ' +
        'title="' + esc((sim.label ? sim.label + ' — ' : '') + p.name) + '">' +
        '<span class="pf"></span>' + esc(p.name) +
        (sim.label ? ' <span style="opacity:.65;font-weight:500">· ' + esc(truncate(sim.label, 34)) + '</span>' : '') +
        '<span class="ext"><svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3H3v10h10v-3M9 3h4v4M7.5 8.5L13 3"/></svg></span>' +
        '</a>';
    }).join('');

    var notes = (t.notes || []).map(function (n) {
      return '<span class="sim-note" title="' + esc(n.note) + '">' +
        '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6.4"/><path d="M8 7.4v4M8 4.9v.6"/></svg>' +
        esc(pf(n.platform).name) + ' · ' + esc(truncate(n.note, 46)) + '</span>';
    }).join('');

    var soonHtml = empty
      ? '<div class="soon">' +
          '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="8"/><path d="M10 6.2v4.2l2.8 1.8"/></svg>' +
          '<div><b>Simulation coming soon</b><span>' + esc(SOON[hashKey(ctx.g + ctx.s + ctx.c + realIdx) % SOON.length]) + '</span></div>' +
        '</div>'
      : '';

    return '<article class="topic s-' + ctx.s + (empty ? ' empty-topic' : '') + '" id="t' + realIdx +
      '" style="animation-delay:' + Math.min(i * 22, 400) + 'ms">' +
      '<div class="topic-head">' + code + '<h3 class="topic-title">' + esc(t.title) + '</h3></div>' +
      (t.remark ? '<div class="topic-remark">' + esc(t.remark) + '</div>' : '') +
      (sims ? '<div class="sim-row">' + sims + '</div>' : '') +
      (notes ? '<div class="sim-row">' + notes + '</div>' : '') +
      soonHtml +
      '</article>';
  }

  function soonBlock(count, seed) {
    var q = QUOTES[hashKey(seed) % QUOTES.length];
    return '<div class="quote-card">' +
      '<div class="quote-mark" aria-hidden="true">&ldquo;</div>' +
      '<div>' +
        '<p class="quote-text">' + esc(q.t) + '</p>' +
        '<div class="quote-by">' + esc(q.a) + '</div>' +
        '<div class="quote-actions">' +
          '<span class="chip" style="border-style:dashed">⏳ ' + count + ' topic' + (count === 1 ? '' : 's') + ' in this chapter are being curated</span>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-suggest>Know a good simulation? Tell us</button>' +
        '</div>' +
      '</div></div>';
  }

  function viewPlatforms() {
    var keys = Object.keys(DATA.platformCounts).sort(function (a, b) { return DATA.platformCounts[b] - DATA.platformCounts[a]; });
    var cards = keys.map(function (k, i) {
      var p = pf(k), n = DATA.platformCounts[k];
      return '<a class="card card-link pf-card reveal" style="animation-delay:' + Math.min(i * 40, 400) + 'ms" ' +
        'href="' + esc(p.home) + '" target="_blank" rel="noopener noreferrer">' +
        '<div class="pf-head"><span class="pf-badge">' + esc(initials(p.name)) + '</span>' +
        '<div><h3 class="h3">' + esc(p.name) + '</h3><div class="pf-org">' + esc(p.org || '') + '</div></div></div>' +
        '<div class="row between" style="align-items:flex-end">' +
          '<div class="pf-count">' + fmt(n) + '</div>' +
          '<div class="micro">simulations indexed</div>' +
        '</div>' +
        '<div class="micro" style="color:var(--accent);word-break:break-all">' + esc(shortHost(p.home)) + '</div>' +
        '</a>';
    }).join('');

    var total = keys.reduce(function (a, k) { return a + DATA.platformCounts[k]; }, 0);
    return '<div class="shell section">' +
      crumbs([{ label: 'Home', href: '#/' }, { label: 'Platforms' }]) +
      '<p class="eyebrow">Where the simulations live</p>' +
      '<h2 class="h2">' + keys.length + ' platforms, one index</h2>' +
      '<p class="lede">' + fmt(total) + ' simulation links, each pointing to the original platform. We index and organise — the content stays with its creators.</p>' +
      '<div class="pf-grid mt-l">' + cards + '</div>' +
      '</div>';
  }

  function shortHost(u) {
    return String(u || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  function viewProgress() {
    var entries = Object.keys(opened).map(function (u) {
      var o = opened[u] || {};
      return { url: u, t: o.t || 0, p: o.p, g: o.g, s: o.s, c: o.c, n: o.n };
    }).sort(function (a, b) { return b.t - a.t; });

    var totalSims = DATA.meta.sims;
    var done = entries.length;
    var pct = totalSims ? Math.round(done / totalSims * 100) : 0;
    if (done > 0 && pct === 0) pct = 1;   // visible progress from the very first sim
    var R = 40, C = 2 * Math.PI * R;

    var bySubject = {};
    entries.forEach(function (e) {
      if (!e.s) return;
      bySubject[e.s] = (bySubject[e.s] || 0) + 1;
    });

    var rows = SUBJECT_ORDER.map(function (k) {
      var sn = null;
      Object.keys(DATA.grades).forEach(function (g) {
        var x = DATA.grades[g].subjects[k];
        if (!x) return;
        if (!sn) sn = { simCount: 0, topicCount: 0, name: x.name };
        sn.simCount += x.simCount; sn.topicCount += x.topicCount;
      });
      if (!sn) return '';
      var d = bySubject[k] || 0;
      return '<div class="card s-' + k + '" style="padding:16px 18px">' +
        '<div class="row between"><div class="row" style="gap:9px"><span class="dot"></span>' +
        '<h3 class="h3">' + esc(sn.name) + '</h3></div><div class="micro">' + d + ' opened</div></div>' +
        '<div style="margin-top:11px">' + bar(d, sn.simCount) + '</div></div>';
    }).join('');

    var recent = entries.slice(0, 12).map(function (e) {
      var href = (e.g && e.s && e.c != null)
        ? '#/class/' + e.g + '/' + e.s + '/' + e.c
        : '#/';
      return '<div class="recent-item">' +
        '<span class="pf" style="width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent)"></span>' +
        '<span class="t">' + esc(e.n || 'Simulation') + '</span>' +
        '<span class="chip">' + esc(pf(e.p).name) + '</span>' +
        '<a class="micro" style="color:var(--accent)" href="' + href + '" data-nav>chapter</a>' +
        '<time>' + esc(ago(e.t)) + '</time></div>';
    }).join('');

    return '<div class="shell section">' +
      crumbs([{ label: 'Home', href: '#/' }, { label: 'My progress' }]) +
      '<p class="eyebrow">Your session on SimVerse</p>' +
      '<h2 class="h2">Progress</h2>' +
      '<p class="lede">Every simulation you open is tracked in this browser, so you can pick up a chapter exactly where you left it. Nothing leaves your device.</p>' +

      '<div class="card mt-l" style="padding:clamp(20px,3vw,30px)">' +
        '<div class="ring-wrap">' +
          '<svg class="ring" viewBox="0 0 100 100" aria-hidden="true">' +
            '<circle class="trk" cx="50" cy="50" r="' + R + '"/>' +
            '<circle class="val" cx="50" cy="50" r="' + R + '" transform="rotate(-90 50 50)" ' +
              'stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C - C * pct / 100).toFixed(1) + '"/>' +
            '<text x="50" y="56" text-anchor="middle" fill="#e9eef8" font-size="20" ' +
              'font-family="ui-serif, Georgia, serif">' + pct + '%</text>' +
          '</svg>' +
          '<div><div class="ring-num">' + done + ' of ' + fmt(totalSims) + '</div>' +
          '<div class="micro" style="margin-top:6px">simulations opened</div></div>' +
        '</div>' +
        (done ? '<div class="quote-actions"><button class="btn btn-ghost btn-sm" type="button" data-reset>Reset my progress</button></div>' : '') +
      '</div>' +

      '<div class="grid g-subject mt-l">' + rows + '</div>' +

      '<div class="mt-l">' +
        '<h3 class="h3">Recently opened</h3>' +
        '<div class="recent mt-m">' + (recent || '<div class="empty-state"><p>Nothing opened yet — pick a chapter and launch your first simulation.</p></div>') + '</div>' +
      '</div>' +
      '</div>';
  }

  function ago(t) {
    if (!t) return '';
    var d = Date.now() - t;
    var m = Math.floor(d / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function viewAbout() {
    var meta = DATA.meta;
    return '<div class="shell section">' +
      crumbs([{ label: 'Home', href: '#/' }, { label: 'About' }]) +
      '<p class="eyebrow">About the project</p>' +
      '<h2 class="h2">SimVerse</h2>' +
      '<p class="lede">Teachers and students lose real class time searching four or five different websites for one simulation. ' +
      'SimVerse removes that step: a single, curated index organised exactly the way your syllabus is organised.</p>' +

      '<div class="grid g-subject mt-l">' +
        fact('Indexed', fmt(meta.sims) + ' simulation links') +
        fact('Structured', meta.chapters + ' chapters · ' + fmt(meta.topics) + ' topics') +
        fact('Sourced from', meta.platforms + ' platforms') +
        fact('Coverage', meta.grades + ' classes × 4 subjects') +
      '</div>' +

      '<hr class="hr">' +
      '<h3 class="h3">How we organise it</h3>' +
      '<p class="lede">Class → Subject → Chapter → Topic → Simulation. Every simulation keeps the platform it came from, ' +
      'so you always know where you are going, and the link opens the simulation on its original site in a new tab.</p>' +

      '<h3 class="h3 mt-l">Topics without a simulation</h3>' +
      '<p class="lede">Some topics have no good simulation yet. Rather than leave a dead end, SimVerse marks them as ' +
      '<em>in progress</em> and tells you plainly that we are working on it. You can filter any chapter by ' +
      '“Has simulation” or “Coming soon”.</p>' +

      '<h3 class="h3 mt-l">A note on ownership</h3>' +
      '<p class="lede">SimVerse hosts no simulations. All content belongs to its original creators — PhET, OLabs, DIKSHA, ' +
      'LabXchange, GeoGebra and the others listed on the <a href="#/platforms" data-nav style="color:var(--accent)">platforms page</a>. ' +
      'If you created a simulation you would like indexed, or found a broken link, we would love to hear from you.</p>' +

      '<div class="mt-l">' +
        '<a class="btn btn-primary" href="#/class/' + (lastGrade || '10') + '" data-nav>Open the library</a>' +
      '</div>' +
      '</div>';
  }

  function fact(k, v) {
    return '<div class="card reveal" style="padding:20px"><div class="micro">' + esc(k) + '</div>' +
      '<div class="h3" style="margin-top:9px;font-family:var(--serif);font-size:22px">' + esc(v) + '</div></div>';
  }

  function viewSearch(q) {
    var results = q ? search(q, 120) : [];
    var body;
    if (!q) {
      body = '<div class="empty-state"><p class="h3">Type at least two characters.</p>' +
        '<p class="muted mt-s">Try “refraction”, “mole concept”, “quadratic equations” or “photosynthesis”.</p></div>';
    } else if (!results.length) {
      body = '<div class="empty-state"><p class="h3">No match for “' + esc(q) + '”.</p>' +
        '<p class="muted mt-s">Try a broader word — for example “light” instead of “refraction through a glass slab”.</p></div>';
    } else {
      body = '<div class="search-page-list">' + results.map(function (r) {
        return '<a class="sres s-' + r.s + '" href="' + hrefFor(r) + '" data-nav>' +
          '<span class="dot"></span>' +
          '<span class="nm"><b>' + highlight(r.n, q) + '</b><span>' + esc(r.sub) + '</span></span>' +
          (r.sims
            ? '<span class="chip">' + r.sims + ' sim' + (r.sims === 1 ? '' : 's') + '</span>'
            : '<span class="chip empty">coming soon</span>') +
          '</a>';
      }).join('') + '</div>';
    }
    return '<div class="shell section">' +
      crumbs([{ label: 'Home', href: '#/' }, { label: 'Search' }]) +
      '<p class="eyebrow">Search</p>' +
      '<h2 class="h2">' + (q ? '“' + esc(q) + '”' : 'Search the library') + '</h2>' +
      '<p class="lede">' + (results.length ? results.length + ' result' + (results.length === 1 ? '' : 's') + ' across all classes and subjects.' : 'Search ' + fmt(DATA.meta.topics) + ' topics and ' + fmt(DATA.meta.sims) + ' simulations.') + '</p>' +
      '<div class="mt-l">' + body + '</div></div>';
  }

  function notFound(msg) {
    return '<div class="shell section"><div class="empty-state">' +
      '<p class="h2">Page not found</p><p class="muted mt-s">' + esc(msg) + '</p>' +
      '<div class="mt-m"><a class="btn btn-primary" href="#/" data-nav>Back to SimVerse</a></div></div></div>';
  }

  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* ---------------------------------------------------------------- router */
  function parseHash() {
    var h = location.hash || '#/';
    var qi = h.indexOf('?');
    var path = (qi < 0 ? h : h.slice(0, qi)).replace(/^#\/?/, '');
    var parts = path.split('/').filter(Boolean);
    var query = {};
    if (qi >= 0) {
      h.slice(qi + 1).split('&').forEach(function (kv) {
        if (!kv) return;
        var p = kv.split('=');
        query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
    }
    return { parts: parts, query: query };
  }

  function render() {
    var r = parseHash();
    var p = r.parts, q = r.query;
    var html, title = 'SimVerse';
    var filter = q.f || null;

    if (!p.length) { html = viewHome(); }
    else if (p[0] === 'class' && p[1] && !p[2]) { html = viewClass(p[1]); title += ' · Class ' + p[1]; }
    else if (p[0] === 'class' && p[1] && p[2] && !p[3]) {
      html = viewSubject(p[1], p[2]);
      title += ' · ' + subjectName(p[2]) + ' · Class ' + p[1];
    } else if (p[0] === 'class' && p[1] && p[2] && p[3]) {
      html = viewChapter(p[1], p[2], parseInt(p[3], 10), filter);
      title += ' · ' + subjectName(p[2]) + ' · Class ' + p[1];
    } else if (p[0] === 'platforms') { html = viewPlatforms(); title += ' · Platforms'; }
    else if (p[0] === 'progress') { html = viewProgress(); title += ' · Progress'; }
    else if (p[0] === 'about') { html = viewAbout(); title += ' · About'; }
    else if (p[0] === 'search') { html = viewSearch(q.q || ''); title += ' · Search'; }
    else { html = notFound('That page does not exist.'); }

    view.innerHTML = html;
    document.title = title;

    Array.prototype.forEach.call(document.querySelectorAll('.tnav'), function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#/' + p[0]);
    });

    var focusTopic = q.t != null ? document.getElementById('t' + q.t) : null;
    if (focusTopic) {
      setTimeout(function () {
        focusTopic.scrollIntoView({ behavior: 'smooth', block: 'center' });
        focusTopic.style.boxShadow = '0 0 0 1px var(--accent)';
        setTimeout(function () { focusTopic.style.boxShadow = ''; }, 1900);
      }, 70);
      return;
    }
    if (filter) return;              // keep scroll position when toggling a filter
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ---------------------------------------------------------------- events */
  document.addEventListener('click', function (e) {
    var simEl = e.target.closest ? e.target.closest('[data-sim]') : null;
    if (simEl) {
      markOpened(simEl.getAttribute('data-sim'), {
        p: simEl.getAttribute('data-p'), g: simEl.getAttribute('data-g'),
        s: simEl.getAttribute('data-s'), c: simEl.getAttribute('data-c'),
        n: simEl.getAttribute('data-n')
      });
      simEl.classList.add('visited');
      updateProgressDot();
      toast('Opening ' + pf(simEl.getAttribute('data-p')).name + ' — marked in your progress');
      return;
    }

    var fb = e.target.closest ? e.target.closest('[data-filter]') : null;
    if (fb) {
      var base = location.hash.split('?')[0];
      var id = fb.getAttribute('data-filter');
      var next = base + (id === 'all' ? '' : '?f=' + id);
      if (next === location.hash) { render(); } else { location.hash = next; }
      return;
    }

    if (e.target.closest && e.target.closest('[data-open-search]')) { openPalette(); return; }
    if (e.target.closest && e.target.closest('[data-next-quote]')) { rotateHomeQuote(); return; }
    if (e.target.closest && e.target.closest('[data-suggest]')) {
      toast('Thanks! Use the About page to share a link with the SimVerse team.');
      return;
    }
    if (e.target.closest && e.target.closest('[data-reset]')) {
      opened = {}; saveOpened(); render(); updateProgressDot(); toast('Progress cleared');
      return;
    }
    if (e.target.id === 'menuBtn' || (e.target.closest && e.target.closest('#menuBtn'))) {
      var tn=document.getElementById('topnav'); if(tn) tn.classList.toggle('open');
      return;
    }
    if (e.target.closest && e.target.closest('[data-nav]')) {
      var nv = document.getElementById('topnav');
      if (nv) nv.classList.remove('open');
    }
  });

  function updateProgressDot() {
    var n = Object.keys(opened).length;
    var el = document.getElementById('navProgress');
    if (el) el.setAttribute('title', n ? n + ' simulations opened' : 'No simulations opened yet');
  }

  /* --------------------------------------------------------------- palette */
  var palette = document.getElementById('palette');
  var backdrop = document.getElementById('paletteBackdrop');
  var palInput = document.getElementById('palInput');
  var palResults = document.getElementById('palResults');
  var palSel = 0, palItems = [];

  function openPalette() {
    palette.hidden = false; backdrop.hidden = false;
    palInput.value = ''; palSel = 0;
    renderPalette('');
    setTimeout(function () { palInput.focus(); }, 20);
  }
  function closePalette() {
    palette.hidden = true; backdrop.hidden = true;
  }
  function renderPalette(q) {
    palItems = q.trim().length >= 2 ? search(q, 30) : [];
    if (!q.trim()) {
      palResults.innerHTML = '<div class="pal-empty">Start typing to search ' + fmt(DATA.meta.topics) +
        ' topics across Classes 9–12.<br><span class="muted">Topics are searched live — nothing is sent anywhere.</span></div>';
      return;
    }
    if (!palItems.length) {
      palResults.innerHTML = '<div class="pal-empty">No match for “' + esc(q) + '”.</div>';
      return;
    }
    palResults.innerHTML = palItems.map(function (r, i) {
      return '<div class="pal-item' + (i === palSel ? ' sel' : '') + '" data-i="' + i + '">' +
        '<span class="dot" style="background:var(--' + r.s + ');box-shadow:0 0 8px var(--' + r.s + ')"></span>' +
        '<span class="nm"><b>' + highlight(r.n, q.trim()) + '</b><span>' + esc(r.sub) + '</span></span>' +
        (r.sims ? '<span class="chip">' + r.sims + '</span>' : '<span class="chip empty">soon</span>') +
        '</div>';
    }).join('');
  }
  palInput.addEventListener('input', function () { palSel = 0; renderPalette(palInput.value); });
  palInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palSel + 1, palItems.length - 1); renderPalette(palInput.value); scrollSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(palSel - 1, 0); renderPalette(palInput.value); scrollSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); goSel(); }
    else if (e.key === 'Escape') { closePalette(); }
  });
  palResults.addEventListener('click', function (e) {
    var it = e.target.closest ? e.target.closest('[data-i]') : null;
    if (it) { palSel = parseInt(it.getAttribute('data-i'), 10); goSel(); }
  });
  backdrop.addEventListener('click', closePalette);
  function scrollSel() {
    var el = palResults.querySelector('.sel');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
  function goSel() {
    var r = palItems[palSel];
    if (!r) return;
    closePalette();
    location.hash = hrefFor(r);
  }

  document.getElementById('searchTrigger').addEventListener('click', openPalette);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    if (e.key === '/' && palette.hidden && document.activeElement !== palInput) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); openPalette(); }
    }
  });

  /* --------------------------------------------------------- home quote rot */
  var qIdx = Math.floor(Math.random() * QUOTES.length);
  function rotateHomeQuote() {
    qIdx = (qIdx + 1) % QUOTES.length;
    var el = document.getElementById('homeQuote');
    var by = document.getElementById('homeQuoteBy');
    if (!el) return;
    el.style.opacity = 0; by.style.opacity = 0;
    setTimeout(function () {
      el.textContent = '“' + QUOTES[qIdx].t + '”';
      by.textContent = QUOTES[qIdx].a;
      el.style.opacity = 1; by.style.opacity = 1;
    }, 160);
  }
  function initHomeQuote() {
    var el = document.getElementById('homeQuote');
    var by = document.getElementById('homeQuoteBy');
    if (!el) return;
    el.style.transition = by.style.transition = 'opacity .18s';
    el.textContent = '“' + QUOTES[qIdx].t + '”';
    by.textContent = QUOTES[qIdx].a;
  }

  /* ------------------------------------------------------------- background */
  function initFx() {
    var c = document.getElementById('fx');
    if (!c || !c.getContext) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var ctx = c.getContext('2d');
    var pts = [], w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      w = c.width = Math.floor(innerWidth * dpr);
      h = c.height = Math.floor(innerHeight * dpr);
      c.style.width = innerWidth + 'px'; c.style.height = innerHeight + 'px';
      var count = Math.min(78, Math.round(innerWidth / 22));
      pts = [];
      for (var i = 0; i < count; i++) {
        pts.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - .5) * .16 * dpr, vy: (Math.random() - .5) * .16 * dpr,
          r: (Math.random() * 1.5 + .5) * dpr
        });
      }
    }
    function frame() {
      ctx.clearRect(0, 0, w, h);
      var i, j, a, b, dx, dy, d;
      for (i = 0; i < pts.length; i++) {
        a = pts[i];
        a.x += a.vx; a.y += a.vy;
        if (a.x < 0 || a.x > w) a.vx *= -1;
        if (a.y < 0 || a.y > h) a.vy *= -1;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, 0, 6.283);
        ctx.fillStyle = 'rgba(150,200,255,.42)';
        ctx.fill();
      }
      for (i = 0; i < pts.length; i++) {
        for (j = i + 1; j < pts.length; j++) {
          a = pts[i]; b = pts[j];
          dx = a.x - b.x; dy = a.y - b.y;
          d = Math.sqrt(dx * dx + dy * dy);
          var lim = 118 * dpr;
          if (d < lim) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = 'rgba(120,180,255,' + (0.14 * (1 - d / lim)).toFixed(3) + ')';
            ctx.lineWidth = dpr * .7;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(frame);
    }
    resize();
    addEventListener('resize', resize);
    frame();
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    buildIndex();
    initFx();
    updateProgressDot();
    var fs = document.getElementById('footStats');
    if (fs) {
      fs.textContent = DATA.meta.sims + ' simulations · ' + DATA.meta.topics + ' topics · ' +
        DATA.meta.chapters + ' chapters · ' + DATA.meta.platforms + ' platforms';
    }
    window.addEventListener('hashchange', function () {
      render();
      initHomeQuote();
    });
    render();
    initHomeQuote();     // must run after render(): the quote node is created by render()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
