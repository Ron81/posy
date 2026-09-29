/*!
 * Posy — interactivity.
 * Plain browser JavaScript (ES2015), no dependencies, no build step, no network access.
 * Requires assets/data.js and assets/codec.js to be loaded first.
 */
(function () {
  'use strict';

  var D = window.PosyData;
  var C = window.PosyCodec;
  if (!D || !C) {
    if (window.console) console.error('Posy offline: assets/data.js or assets/codec.js failed to load.');
    return;
  }

  /* ------------------------------------------------------------- helpers */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ico(name, cls) {
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }
  function safe(fn) {
    try { fn(); } catch (e) { if (window.console) console.error('Posy offline:', e); }
  }
  function byNum(a, b) { return a - b; }
  function setText(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }

  /* ----------------------------------------------------------------- nav */
  function initNav() {
    var header = $('#site-header');
    var toggle = $('#nav-toggle');
    var menu = $('#mobile-menu');
    var links = $$('#site-nav a');
    var sections = links
      .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
      .filter(Boolean);

    function onScroll() {
      if (header) header.classList.toggle('scrolled', window.scrollY > 8);
      var y = window.scrollY + 140, current = null;
      sections.forEach(function (s) { if (s.offsetTop <= y) current = s.id; });
      links.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + current); });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    function setMenu(open) {
      if (!menu || !toggle) return;
      if (open) menu.removeAttribute('hidden'); else menu.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', String(open));
    }
    on(toggle, 'click', function () { setMenu(menu.hasAttribute('hidden')); });
    $$('a', menu).forEach(function (a) { on(a, 'click', function () { setMenu(false); }); });
  }

  function initReveal() {
    var els = $$('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (e) { e.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -50px 0px', threshold: 0.04 });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ------------------------------------------------------ §5 packet builder */
  function initPacketBuilder() {
    var root = $('#packet-builder');
    if (!root) return;

    var FACE_BITS = [6, 7, 8]; // leftEye, rightEye, jaw
    var VMC_ESTIMATE_BYTES = 8100;
    var selectable = D.BONES.filter(function (b) { return b.cat === 'core' || b.cat === 'leg' || b.cat === 'arm'; });
    var FLAGS = [
      { state: 'root', label: 'HAS_ROOT', info: 'HAS_ROOT' },
      { state: 'fingers', label: 'HAS_FINGERS', info: 'HAS_FINGERS' },
      { state: 'expr', label: 'HAS_EXPRESSIONS', info: 'HAS_EXPRESSIONS', badge: 'the face' },
      { state: 'perfect', label: 'PERFECT_SYNC', info: 'PERFECT_SYNC', badge: 'face detail', needsExpr: true },
      { state: 'idle', label: 'IDLE', info: 'IDLE', badge: '0 bytes' }
    ];

    var st = {
      bits: D.TYPICAL_BITS.slice(),
      root: true, fingers: true, expr: true, perfect: false, idle: false,
      info: 'HAS_EXPRESSIONS',
      preset: D.PRESETS[1].label
    };

    function has(bit) { return st.bits.indexOf(bit) !== -1; }

    function flagHtml(f) {
      var checked = !!st[f.state];
      var disabled = !!f.needsExpr && !st.expr;
      var cls = 'flag ' + (disabled ? 'disabled' : checked ? 'on' : 'off') + (st.info === f.info ? ' info-active' : '');
      return '<span class="' + cls + '">' +
        '<button type="button" class="flag-main" data-act="flag" data-state="' + f.state + '" data-key="flag-' + f.state + '"' + (disabled ? ' disabled' : '') + '>' +
        (checked && !disabled ? '● ' : '○ ') + f.label + '</button>' +
        (f.badge ? '<span class="flag-badge">' + esc(f.badge) + '</span>' : '') +
        '<button type="button" class="flag-q" data-act="info" data-flag="' + f.info + '" data-key="info-' + f.info + '" aria-label="What does ' + f.label + ' do?">?</button>' +
        '</span>';
    }

    function render() {
      var active = document.activeElement;
      var focusKey = active && active.getAttribute ? active.getAttribute('data-key') : null;

      var boneCount = st.bits.length;
      var size = C.packetSize({ boneCount: boneCount, hasRoot: st.root, hasFingers: st.fingers, hasExpressions: st.expr, perfectSync: st.perfect });
      var faceOn = FACE_BITS.filter(has);
      var gazeOverrides = st.expr && (has(6) || has(7));
      var preset = D.PRESETS.filter(function (p) { return p.label === st.preset; })[0];
      var info = D.FLAG_INFO[st.info];

      var breakdown = [
        { label: 'header + bone_mask', bytes: 16, color: 'c-violet' },
        { label: boneCount + '× quaternion', bytes: boneCount * 4, color: 'c-fuchsia' },
        { label: 'root', bytes: st.root ? 6 : 0, color: 'c-sky' },
        { label: 'fingers', bytes: st.fingers ? 24 : 0, color: 'c-emerald' },
        { label: 'face: ' + (st.perfect ? '52 ARKit blendshapes' : '16 expressions') + ' + gaze', bytes: st.expr ? (st.perfect ? 54 : 18) : 0, color: 'c-amber' }
      ].filter(function (r) { return r.bytes > 0; });

      var html = '';
      html += '<div class="row between wrap gap-3"><h3 class="card-title">§5 packet builder</h3>' +
        '<span class="pill">all multi-byte integers little-endian</span></div>';
      html += '<div class="grid gap-8 g-3-2 mt-6"><div class="stack" style="--sp:24px">';

      // presets
      html += '<div><div class="label" style="margin-bottom:8px">Presets</div><div class="chips" style="gap:8px">';
      D.PRESETS.forEach(function (p, i) {
        html += '<button type="button" class="pill-btn' + (st.preset === p.label ? ' active' : '') + '" data-act="preset" data-i="' + i + '" data-key="preset-' + i + '">' + esc(p.label) + '</button>';
      });
      html += '</div>';
      if (preset) html += '<p class="xs dim leading mt-2">' + esc(preset.note) + '</p>';
      html += '</div>';

      // bones
      html += '<div><div class="label" style="margin-bottom:8px">bone_mask — click bones to toggle bits (§4)</div><div class="chips">';
      selectable.forEach(function (b) {
        html += '<button type="button" class="chip' + (has(b.bit) ? ' on' : '') + '" title="bit ' + b.bit + '" data-act="bone" data-bit="' + b.bit + '" data-key="bone-' + b.bit + '">' + b.bit + '·' + esc(b.name) + '</button>';
      });
      html += '</div><p class="xs dim mt-2" style="display:flex;gap:6px">' + ico('info', 'ico-sm') +
        '<span>Finger bits (25–54) stay 0 in v1 — fingers ride the dedicated §5.5 block instead.</span></p></div>';

      // face explainer
      html += '<div class="callout tone-amber"><h4 class="callout-title" style="display:flex;gap:8px;align-items:center">' + ico('smile') + " Wait — where's the face tracking?</h4>" +
        '<p class="tiny muted leading mt-2">This trips up almost everyone. Picking "Full body" does <b class="strong">not</b> select <code>leftEye</code>, <code>rightEye</code> or <code>jaw</code>, and that\'s deliberate: <b class="strong">the face does not travel as bones</b>. It travels in the expression block, which you turn on with <code>HAS_EXPRESSIONS</code> below.</p>' +
        '<div class="grid g-sm-2 gap-2 mt-3">' +
        '<div class="callout tone-emerald" style="padding:12px;border-radius:10px"><div class="callout-title xs">Use this for the face</div><ul class="stack-sm xs muted leading mt-2" style="list-style:none">' +
        '<li><b class="strong" style="font-weight:500">Eyes looking around</b> → the 2 gaze bytes at the end of the expression block</li>' +
        '<li><b class="strong" style="font-weight:500">Blinking</b> → blendshape weights (blinkLeft / blinkRight)</li>' +
        '<li><b class="strong" style="font-weight:500">Mouth &amp; speech</b> → viseme weights (aa / ih / ou / ee / oh)</li>' +
        '<li><b class="strong" style="font-weight:500">Emotion</b> → happy / angry / sad / relaxed / surprised</li></ul></div>' +
        '<div class="well"><div class="label" style="color:var(--muted)">The eye &amp; jaw bones (6, 7, 8) are a fallback</div>' +
        '<p class="xs dim leading mt-2">They exist for rigs driven by literal bone rotation rather than blendshapes — some MMD models, or a jaw physically hinged in the skeleton. Most VRM avatars never need them. The spec is explicit: receivers SHOULD drive the eyes from gaze, and <span style="color:#d4d4d8">if both gaze and eye bones are present, gaze wins</span>.</p></div></div>' +
        '<div class="row wrap mt-3" style="gap:8px"><span class="xs dim">Quick fix:</span>' +
        '<button type="button" class="pill-btn" style="border-color:rgba(52,211,153,.4);background:rgba(16,185,129,.15);color:#a7f3d0" data-act="face-on" data-key="face-on">Turn on face tracking (HAS_EXPRESSIONS)</button>' +
        (faceOn.length ? '<button type="button" class="pill-btn" data-act="face-clear" data-key="face-clear">Clear eye/jaw bones (' + faceOn.length + ')</button>' : '') +
        '</div>' +
        (gazeOverrides ? '<div class="callout tone-amber mt-3 xs leading" style="display:flex;gap:6px;padding:10px;border-radius:10px;color:#fde68a">' + ico('alert-triangle', 'ico-sm') +
          '<span>You\'re sending eye bones <em>and</em> the expression block. That\'s legal, but the gaze bytes take precedence on the receiver — those 4–8 bytes of eye quaternion are most likely wasted.</span></div>' : '') +
        '</div>';

      // flags
      html += '<div><div class="row between wrap" style="margin-bottom:8px"><span class="label">Flags byte (§5.2)</span>' +
        '<span class="xs dim">click a flag\'s <b style="color:#d4d4d8">?</b> to read what it does</span></div>' +
        '<div class="chips" style="gap:8px">' + FLAGS.map(flagHtml).join('') + '</div>';
      if (info) {
        html += '<div class="callout tone-violet mt-3" style="padding:12px;border-radius:12px"><div class="small strong" style="color:#ddd6fe;font-weight:600">' + esc(info.title) + '</div>' +
          '<p class="xs muted leading mt-2">' + esc(info.body) + '</p></div>';
      }
      if (!st.expr && st.perfect) {
        html += '<p class="xs mt-2" style="color:#fcd34d">PERFECT_SYNC is greyed out because it only describes the expression block — turn on HAS_EXPRESSIONS first.</p>';
      }
      html += '</div>';

      // mask hex
      html += '<div class="well"><div class="label" style="margin-bottom:4px">bone_mask (u64, hex)</div><code style="word-break:break-all">' + C.maskHex(st.bits) + '</code></div>';
      html += '</div>'; // left column

      // right column
      html += '<div class="stack">';
      html += '<div class="size-box"><div class="big">' + size + ' B</div><div class="tiny muted mt-2" style="margin-top:4px">total frame size</div>' +
        '<div class="tiny hl-emerald mt-2" style="font-weight:600">≈ ' + (VMC_ESTIMATE_BYTES / size).toFixed(0) + '× smaller than a ~8.1 KB VMC frame</div></div>';
      if (size > 1100) {
        html += '<div class="callout tone-rose tiny leading" style="display:flex;gap:8px;color:#fda4af">' + ico('alert-triangle') +
          '<span>Exceeds the 1100-byte MUST-NOT-exceed limit from §1.1 — this would need fragmentation, which Posy v1 forbids.</span></div>';
      }
      html += '<div>';
      breakdown.forEach(function (r) {
        html += '<div class="bar-row"><div class="bar-label"><span>' + esc(r.label) + '</span><span>' + r.bytes + ' B</span></div>' +
          '<div class="bar"><i class="' + r.color + '" style="width:' + Math.min(100, (r.bytes / size) * 100).toFixed(1) + '%"></i></div></div>';
      });
      html += '</div>';
      html += '<div class="well tiny dim leading">Formula (§5.1): <code>16 + 4·popcount(bone_mask) + 6·HAS_ROOT + 24·HAS_FINGERS + (HAS_EXPRESSIONS ? (PERFECT_SYNC ? 54 : 18) : 0)</code></div>';
      html += '</div></div>';

      root.innerHTML = html;

      if (focusKey) {
        var again = root.querySelector('[data-key="' + focusKey + '"]');
        if (again && !again.disabled && again.focus) again.focus();
      }
    }

    on(root, 'click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!t || !root.contains(t)) return;
      var act = t.getAttribute('data-act');

      if (act === 'preset') {
        var p = D.PRESETS[Number(t.getAttribute('data-i'))];
        st.bits = p.bits.slice().sort(byNum);
        st.preset = p.label;
      } else if (act === 'bone') {
        var bit = Number(t.getAttribute('data-bit'));
        st.preset = 'custom';
        if (has(bit)) st.bits = st.bits.filter(function (b) { return b !== bit; });
        else { st.bits.push(bit); st.bits.sort(byNum); }
      } else if (act === 'flag') {
        var s = t.getAttribute('data-state');
        st[s] = !st[s];
      } else if (act === 'info') {
        st.info = t.getAttribute('data-flag');
      } else if (act === 'face-on') {
        st.expr = true;
        st.info = 'HAS_EXPRESSIONS';
      } else if (act === 'face-clear') {
        st.preset = 'custom';
        st.bits = st.bits.filter(function (b) { return FACE_BITS.indexOf(b) === -1; });
      }
      render();
    });

    render();
  }

  /* ---------------------------------------------- §5.3 quaternion playground */
  function initQuatLab() {
    var yawEl = $('#q-yaw'), pitchEl = $('#q-pitch'), rollEl = $('#q-roll');
    if (!yawEl || !pitchEl || !rollEl) return;
    var bone = $('#q-bone');
    var AXES = ['x', 'y', 'z', 'w'];

    function update() {
      var yaw = Number(yawEl.value), pitch = Number(pitchEl.value), roll = Number(rollEl.value);
      setText('q-yaw-v', yaw + '°');
      setText('q-pitch-v', pitch + '°');
      setText('q-roll-v', roll + '°');
      if (bone) bone.style.transform = 'rotateX(' + pitch + 'deg) rotateY(' + yaw + 'deg) rotateZ(' + roll + 'deg)';

      var q = C.eulerToQuat(pitch, yaw, roll);
      var enc = C.encodeSmallestThree(q);
      var dec = C.decodeSmallestThree(enc.u32);
      var err = C.quatAngleDegrees(q, dec);

      var comps = enc.components.map(function (c, idx) {
        var txt = c.toFixed(3);
        return idx === enc.largestIndex ? '<span class="hl-rose">' + txt + '</span>' : txt;
      }).join(', ');
      var el = document.getElementById('q-comps');
      if (el) el.innerHTML = '[' + comps + ']';
      setText('q-axis', AXES[enc.largestIndex]);
      setText('q-hex', enc.hex);
      var bits = document.getElementById('q-bits');
      if (bits) {
        bits.innerHTML =
          '<span class="hl-violet">' + enc.binary.slice(0, 2) + '</span>' +
          '<span class="hl-fuchsia">' + enc.binary.slice(2, 12) + '</span>' +
          '<span class="hl-sky">' + enc.binary.slice(12, 22) + '</span>' +
          '<span class="hl-emerald">' + enc.binary.slice(22, 32) + '</span>';
      }
      setText('q-err', err.toFixed(4) + '°');
    }

    [yawEl, pitchEl, rollEl].forEach(function (s) { on(s, 'input', update); });
    update();
  }

  /* ---------------------------------------------------------- §6 bandwidth */
  function initBandwidth() {
    var sl = { full: $('#bw-full'), normal: $('#bw-normal'), minimal: $('#bw-minimal'), viewers: $('#bw-viewers') };
    if (!sl.full || !sl.normal || !sl.minimal || !sl.viewers) return;

    var HZ = { FULL: 30, NORMAL: 15, MINIMAL: 5 };
    var OVERHEAD = 50; // UDP + DTLS + SCTP, §6
    var perfect = false;
    var perfectBtn = $('#bw-perfect');

    function stream(tier, frameBytes) { return ((frameBytes + OVERHEAD) * 8 * HZ[tier]) / 1000; }

    function update() {
      var full = Number(sl.full.value), normal = Number(sl.normal.value), minimal = Number(sl.minimal.value), viewers = Number(sl.viewers.value);
      var frame = perfect ? 152 : 116;
      var senders = full + normal + minimal;
      var total = senders + viewers;

      var pool = full * stream('FULL', frame) + normal * stream('NORMAL', frame) + minimal * stream('MINIMAL', frame);
      var viewerDown = pool;
      var avgOwn = senders > 0 ? pool / senders : 0;
      var senderDown = Math.max(0, pool - avgOwn);
      var egress = (viewers * viewerDown + senders * senderDown) / 1000;
      var ingress = pool / 1000;
      var homeOk = egress <= 20;

      setText('bw-full-v', full);
      setText('bw-normal-v', normal);
      setText('bw-minimal-v', minimal);
      setText('bw-viewers-v', viewers);
      setText('bw-total', total + ' people');
      setText('bw-total-sub', '(' + senders + ' sending, ' + viewers + ' watching)');
      if (perfectBtn) {
        perfectBtn.textContent = perfect ? 'Perfect-Sync (152 B)' : 'Standard-Sync (116 B)';
        perfectBtn.classList.toggle('active', perfect);
        perfectBtn.classList.toggle('amber', perfect);
      }

      setText('bw-viewer', viewerDown.toFixed(0) + ' kbit/s');
      setText('bw-viewer-sub', '≈ ' + (viewerDown / 8).toFixed(0) + ' KB/s to watch the whole room');
      setText('bw-sender', senderDown.toFixed(0) + ' kbit/s');
      setText('bw-egress', egress.toFixed(1) + ' Mbit/s');
      setText('bw-egress-sub', homeOk ? 'Comfortable on a decent home fibre upload' : 'Needs a datacentre or fibre-grade uplink');
      var card = $('#bw-egress-card');
      if (card) { card.classList.remove('tone-emerald', 'tone-amber'); card.classList.add(homeOk ? 'tone-emerald' : 'tone-amber'); }
      setText('bw-ingress', ingress.toFixed(2) + ' Mbit/s');
      setText('bw-t-full', stream('FULL', frame).toFixed(1));
      setText('bw-t-normal', stream('NORMAL', frame).toFixed(1));
      setText('bw-t-minimal', stream('MINIMAL', frame).toFixed(1));
      setText('bw-own', stream('FULL', frame).toFixed(1) + ' kbit/s');
    }

    Object.keys(sl).forEach(function (k) { on(sl[k], 'input', update); });
    on(perfectBtn, 'click', function () { perfect = !perfect; update(); });

    var box = $('#bw-scenarios');
    if (box) {
      D.SCENARIOS.forEach(function (s) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'pill-btn';
        b.textContent = s.label;
        b.title = s.note;
        on(b, 'click', function () {
          sl.full.value = s.full; sl.normal.value = s.normal; sl.minimal.value = s.minimal; sl.viewers.value = s.viewers;
          update();
        });
        box.appendChild(b);
      });
    }
    update();
  }

  /* --------------------------------------------------------- spec explorer */
  function initSpec() {
    var tabs = $$('[data-tab]');
    var panes = $$('[data-pane]');
    tabs.forEach(function (t) {
      on(t, 'click', function () {
        var id = t.getAttribute('data-tab');
        tabs.forEach(function (x) { x.classList.toggle('active', x === t); });
        panes.forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== id; });
      });
    });

    // bones
    var grid = $('#bone-grid'), filter = $('#bone-filter'), legend = $('#bone-legend');
    if (legend) {
      legend.innerHTML = ['core', 'arm', 'leg', 'finger-reserved', 'reserved'].map(function (c) {
        return '<span class="pill cat-' + c + '" style="font-size:10px">' + esc(D.CATEGORY_LABEL[c]) + '</span>';
      }).join('');
    }
    function renderBones() {
      if (!grid) return;
      var f = (filter ? filter.value : '').toLowerCase();
      var list = D.BONES.filter(function (b) { return b.name.toLowerCase().indexOf(f) !== -1 || String(b.bit).indexOf(f) !== -1; });
      grid.innerHTML = list.length
        ? list.map(function (b) {
          return '<div class="cell cat-' + b.cat + '"><span class="nm">' + esc(b.name) + '</span><span class="ix">#' + b.bit + '</span></div>';
        }).join('')
        : '<div class="center dim small" style="grid-column:1/-1;padding:32px 0">No matching bones.</div>';
    }
    on(filter, 'input', renderBones);
    renderBones();

    // expressions
    var bsGrid = $('#bs-grid'), bsNote = $('#bs-note');
    var stdBtn = $('#bs-standard'), perfBtn = $('#bs-perfect');
    function renderBs(mode) {
      if (!bsGrid) return;
      if (stdBtn) stdBtn.classList.toggle('active', mode === 'standard');
      if (perfBtn) perfBtn.classList.toggle('active', mode === 'perfect');
      if (bsNote) bsNote.hidden = mode !== 'perfect';
      if (mode === 'standard') {
        bsGrid.innerHTML = D.STANDARD_EXPRESSIONS.map(function (e) {
          return '<div class="cell ' + (e.reserved ? 'cat-reserved' : 'tone-sky') + '"><span class="nm">' + esc(e.name) + '</span><span class="ix">#' + e.idx + '</span></div>';
        }).join('');
      } else {
        bsGrid.innerHTML = D.BLENDSHAPES.map(function (name, idx) {
          return '<div class="cell cat-finger-reserved"><span class="nm">' + esc(name) + '</span><span class="ix">#' + idx + '</span></div>';
        }).join('');
      }
    }
    on(stdBtn, 'click', function () { renderBs('standard'); });
    on(perfBtn, 'click', function () { renderBs('perfect'); });
    renderBs('standard');

    // finger + error tables
    var fb = $('#finger-body');
    if (fb) {
      fb.innerHTML = D.FINGER_ROWS.map(function (r) {
        return '<tr><td class="mono">' + r[0] + '</td><td class="mono hl-violet">' + r[1] + '</td><td class="mono">' + esc(r[2]) + '</td></tr>';
      }).join('');
    }
    var eb = $('#error-body');
    if (eb) {
      eb.innerHTML = D.ERROR_ROWS.map(function (r) {
        return '<tr><td class="mono" style="color:#fda4af">' + r[0] + '</td><td>' + esc(r[1]) + '</td><td class="muted">' + esc(r[2]) + '</td></tr>';
      }).join('');
    }
  }

  /* ------------------------------------------------------------ repo tree */
  function initRepo() {
    var treeEl = $('#tree'), detail = $('#tree-detail');
    if (!treeEl || !detail) return;

    var STATUS_TEXT = { live: 'in repo', planned: 'planned', deferred: 'deferred' };
    var STATUS_TONE = { live: 'tone-emerald', planned: 'tone-amber', deferred: 'tone-zinc' };
    var selectedBtn = null;

    function showDetail(node) {
      detail.innerHTML =
        '<div class="row" style="gap:8px">' + ico(node.type === 'folder' ? 'folder-open' : 'file', node.type === 'folder' ? 'folder' : 'file') +
        '<code class="strong" style="font-size:14px">' + esc(node.name) + '</code></div>' +
        '<span class="pill ' + STATUS_TONE[node.status] + ' mt-3" style="font-size:10px">' + STATUS_TEXT[node.status] + '</span>' +
        '<p class="small muted leading mt-4">' + esc(node.description) + '</p>';
    }

    function build(node, depth, open) {
      var wrap = document.createElement('div');
      var hasKids = !!(node.children && node.children.length);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tree-row';
      btn.style.paddingLeft = (depth * 16 + 8) + 'px';
      btn.innerHTML =
        (hasKids ? ico('chevron-right', 'ico-sm chev' + (open ? ' open' : '')) : '<span style="width:14px;flex:none"></span>') +
        ico(node.type === 'folder' ? 'folder' : 'file', 'ico-sm ' + (node.type === 'folder' ? 'folder' : 'file')) +
        '<span class="nm">' + esc(node.name) + '</span>' +
        '<span class="st ' + STATUS_TONE[node.status] + '">' + STATUS_TEXT[node.status] + '</span>';
      wrap.appendChild(btn);

      var kids = null;
      if (hasKids) {
        kids = document.createElement('div');
        kids.hidden = !open;
        node.children.forEach(function (c) { kids.appendChild(build(c, depth + 1, false)); });
        wrap.appendChild(kids);
      }

      on(btn, 'click', function () {
        if (selectedBtn) selectedBtn.classList.remove('sel');
        selectedBtn = btn;
        btn.classList.add('sel');
        showDetail(node);
        if (kids) {
          kids.hidden = !kids.hidden;
          var chev = btn.querySelector('.chev');
          if (chev) chev.classList.toggle('open', !kids.hidden);
        }
      });
      return wrap;
    }

    treeEl.appendChild(build(D.REPO_TREE, 0, true));
    // preselect README.md
    var first = treeEl.querySelectorAll('.tree-row')[1];
    if (first) { first.classList.add('sel'); selectedBtn = first; }
    showDetail(D.REPO_TREE.children[0]);
  }

  /* --------------------------------------------------------- roadmap + faq */
  function initRoadmap() {
    var box = $('#roadmap-grid');
    if (!box) return;
    box.innerHTML = D.ROADMAP.map(function (p) {
      var done = p.items.filter(function (i) { return i.status === 'done'; }).length;
      return '<div class="card phase reveal"><div class="ph-top"><span class="ph-name">' + esc(p.phase) + '</span>' +
        '<span class="pill">' + done + '/' + p.items.length + ' done</span></div>' +
        '<h3>' + esc(p.title) + '</h3><p class="ph-sum">' + esc(p.summary) + '</p><ul>' +
        p.items.map(function (i) {
          return '<li class="' + (i.status === 'done' ? 'done' : '') + '">' + ico(i.status === 'done' ? 'check-circle' : 'circle') + '<span>' + esc(i.text) + '</span></li>';
        }).join('') + '</ul></div>';
    }).join('');
  }

  function initFaq() {
    var box = $('#faq-list');
    if (!box) return;
    box.innerHTML = D.FAQS.map(function (f, i) {
      return '<div class="faq-item' + (i === 0 ? ' open' : '') + '">' +
        '<button type="button" class="faq-q" aria-expanded="' + (i === 0) + '">' + '<span>' + esc(f.q) + '</span>' + ico('chevron-down') + '</button>' +
        '<div class="faq-a"' + (i === 0 ? '' : ' hidden') + '>' + esc(f.a) + '</div></div>';
    }).join('');

    on(box, 'click', function (e) {
      var q = e.target.closest ? e.target.closest('.faq-q') : null;
      if (!q) return;
      var item = q.parentNode;
      var wasOpen = item.classList.contains('open');
      $$('.faq-item', box).forEach(function (el) {
        el.classList.remove('open');
        el.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
        el.querySelector('.faq-a').hidden = true;
      });
      if (!wasOpen) {
        item.classList.add('open');
        q.setAttribute('aria-expanded', 'true');
        item.querySelector('.faq-a').hidden = false;
      }
    });
  }

  /* ----------------------------------------------------------- copy button */
  function initCopy() {
    var btn = $('#copy-btn'), src = $('#copy-src');
    if (!btn || !src) return;
    var label = btn.querySelector('span');

    function done(ok) {
      if (label) label.textContent = ok ? 'Copied' : 'Press Ctrl+C';
      setTimeout(function () { if (label) label.textContent = 'Copy'; }, 1800);
    }
    function legacy() {
      var ta = document.createElement('textarea');
      ta.value = src.textContent;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (!ok) {
        var r = document.createRange();
        r.selectNodeContents(src);
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
      done(ok);
    }
    on(btn, 'click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(src.textContent).then(function () { done(true); }, legacy);
      } else {
        legacy();
      }
    });
  }

  /* ------------------------------------------------------------------ boot */
  [initNav, initRoadmap, initFaq, initPacketBuilder, initQuatLab, initBandwidth, initSpec, initRepo, initCopy, initReveal].forEach(safe);
})();
