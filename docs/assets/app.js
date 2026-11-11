/*!
 * Posy site: interactivity.
 * Plain browser JavaScript (ES2015), no dependencies, no build step, no network access.
 * Requires assets/data.js and assets/codec.js to be loaded first.
 */
(function () {
  'use strict';

  var D = window.PosyData;
  var C = window.PosyCodec;
  if (!D || !C) {
    if (window.console) console.error('Posy site: assets/data.js or assets/codec.js failed to load.');
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
  function safe(fn) {
    try { fn(); } catch (e) { if (window.console) console.error('Posy site:', e); }
  }
  function byNum(a, b) { return a - b; }
  // Texts come from data.js (or the language file loaded after it).
  var T = D.T;
  function fmt(text, values) { return text.replace(/\{(\w+)\}/g, function (m, k) { return values[k]; }); }
  function num(x, digits) { return x.toFixed(digits).replace('.', T.dec); }
  function setText(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }

  /* --------------------------------------------- a frame, one cell per byte */
  // `parts`: [{ cls, bytes }] in wire order. `cls` is the block's colour (style.css).
  function byteMap(parts) {
    var html = '';
    parts.forEach(function (p) {
      for (var n = 0; n < p.bytes; n++) html += '<i' + (p.cls ? ' class="' + p.cls + '"' : '') + '></i>';
    });
    return html;
  }

  // The blocks of a frame in wire order (§5.1). `bones` counts the mask bits below 25.
  function frameParts(o) {
    var E = D.EXTRA_EXAMPLE;
    return [
      { label: T.partHead, bytes: 16, cls: '' },
      { label: fmt(T.partBones, { n: o.bones }), bytes: 4 * o.bones, cls: 'b-quat' },
      { label: T.partJoints, bytes: o.joints ? 120 : 0, cls: 'b-joints' },
      { label: T.partRoot, bytes: o.root ? 8 : 0, cls: 'b-root' },
      { label: T.partFingers, bytes: o.fingers ? 24 : 0, cls: 'b-fing' },
      { label: o.perfect ? T.partPerfect : T.partVrm, bytes: o.expr ? (o.perfect ? 54 : 15) : 0, cls: 'b-face' },
      { label: fmt(T.partExtra, { b: E.bones, v: E.values }), bytes: o.extra ? 4 * E.bones + E.values : 0, cls: 'b-extra' }
    ].filter(function (p) { return p.bytes > 0; });
  }

  function initHero() {
    var el = $('#hero-map');
    if (el) el.innerHTML = byteMap(frameParts({ bones: D.TYPICAL_BITS.length, root: true, fingers: true, expr: true }));
  }

  /* ------------------------------------------------------ §5 frame builder */
  function initPacketBuilder() {
    var root = $('#packet-builder');
    if (!root) return;

    var selectable = D.BONES.filter(function (b) { return b.bit <= 24; });
    // `joints` is not a flag: it stands for bone_mask bits 25–54, the finger_bones type.
    var SWITCHES = [
      { state: 'root', label: 'HAS_ROOT', info: 'HAS_ROOT' },
      { state: 'fingers', label: 'HAS_FINGERS', info: 'HAS_FINGERS', excludes: 'joints' },
      { state: 'joints', label: 'finger_bones', info: 'FINGER_BONES', excludes: 'fingers' },
      { state: 'expr', label: 'HAS_EXPRESSIONS', info: 'HAS_EXPRESSIONS' },
      { state: 'perfect', label: 'PERFECT_SYNC', info: 'PERFECT_SYNC', needsExpr: true },
      { state: 'extra', label: 'HAS_EXTRA', info: 'HAS_EXTRA' }
    ];

    var st = {
      bits: D.TYPICAL_BITS.slice(),
      root: true, fingers: true, joints: false, expr: true, perfect: false, extra: false,
      info: 'HAS_EXPRESSIONS',
      preset: D.PRESETS[1].label
    };

    function has(bit) { return st.bits.indexOf(bit) !== -1; }
    function any(bits) { return bits.some(has); }

    // caps.sends: the data types this frame needs declared and granted (§2.1).
    function declared() {
      var t = [];
      if (any([0, 1, 2, 3, 4, 5, 6, 7, 8, 17, 18, 19, 20, 21, 22, 23, 24])) t.push('bones');
      if (any([9, 10, 11, 13, 14, 15])) t.push('legs');
      if (any([12, 16])) t.push('toes');
      if (st.root) t.push('root');
      if (st.fingers) t.push('fingers');
      if (st.joints) t.push('finger_bones');
      if (st.expr) t.push('expressions');
      if (st.expr && st.perfect) t.push('perfect_sync');
      if (st.extra) t.push('extra');
      return t;
    }

    function switchHtml(f) {
      var disabled = !!f.needsExpr && !st.expr;
      var checked = !!st[f.state] && !disabled;
      return '<span class="sw ' + (checked ? 'on' : 'off') + (st.info === f.info ? ' cur' : '') + '">' +
        '<button type="button" class="sw-main" data-act="flag" data-state="' + f.state + '" data-key="flag-' + f.state + '" aria-pressed="' + checked + '"' + (disabled ? ' disabled' : '') + '>' +
        (checked ? '■ ' : '□ ') + f.label + '</button>' +
        '<button type="button" class="sw-q" data-act="info" data-flag="' + f.info + '" data-key="info-' + f.info + '" aria-label="' + esc(fmt(T.whatIs, { x: f.label })) + '">?</button>' +
        '</span>';
    }

    function render() {
      var active = document.activeElement;
      var focusKey = active && active.getAttribute ? active.getAttribute('data-key') : null;

      var maskBits = st.joints ? st.bits.concat(D.FINGER_BITS) : st.bits;
      var perfect = st.expr && st.perfect;
      var size = C.packetSize({
        boneCount: maskBits.length, hasRoot: st.root, hasFingers: st.fingers, hasExpressions: st.expr, perfectSync: perfect,
        hasExtra: st.extra, extraBones: D.EXTRA_EXAMPLE.bones, extraValues: D.EXTRA_EXAMPLE.values
      });
      var parts = frameParts({ bones: st.bits.length, joints: st.joints, root: st.root, fingers: st.fingers, expr: st.expr, perfect: perfect, extra: st.extra });
      var preset = D.PRESETS.filter(function (p) { return p.label === st.preset; })[0];
      var info = D.FLAG_INFO[st.info];

      var html = '<div class="lab"><div class="lab-ctl">';

      html += '<div class="field"><span class="field-l">' + esc(T.preset) + '</span><div class="seg">';
      D.PRESETS.forEach(function (p, i) {
        html += '<button type="button"' + (st.preset === p.label ? ' class="active"' : '') + ' data-act="preset" data-i="' + i + '" data-key="preset-' + i + '">' + esc(p.label) + '</button>';
      });
      html += '</div>' + (preset ? '<p class="hint">' + esc(preset.note) + '</p>' : '') + '</div>';

      html += '<div class="field"><span class="field-l">' + esc(T.mask) + '</span><div class="bits">';
      selectable.forEach(function (b) {
        html += '<button type="button"' + (has(b.bit) ? ' class="on"' : '') + ' aria-pressed="' + has(b.bit) + '" data-act="bone" data-bit="' + b.bit + '" data-key="bone-' + b.bit + '">' + b.bit + ' ' + esc(b.name) + '</button>';
      });
      html += '</div>';
      if (st.expr && (has(6) || has(7))) {
        html += '<p class="note" style="margin-top:7px">' + esc(T.eyeNote) + '</p>';
      }
      html += '</div>';

      html += '<div class="field"><span class="field-l">' + esc(T.blocks) + '</span><div class="switches">' + SWITCHES.map(switchHtml).join('') + '</div></div>';
      if (info) html += '<div class="info"><b>' + esc(info.title) + '</b><p>' + esc(info.body) + '</p></div>';

      html += '</div><div class="lab-out">';
      html += '<div class="size"><b>' + size + '</b>' + esc(T.bytes) + '</div>';
      html += '<div class="bytemap" aria-hidden="true">' + byteMap(parts) + '</div>';
      html += '<table class="parts">' + parts.map(function (p) {
        return '<tr><td><i' + (p.cls ? ' class="' + p.cls + '"' : '') + '></i>' + esc(p.label) + '</td><td>' + p.bytes + ' B</td></tr>';
      }).join('') + '</table>';
      html += '<dl class="kv">' +
        '<dt>' + esc(T.maskOut) + '</dt><dd><code>' + C.maskHex(maskBits) + '</code></dd>' +
        '<dt>' + esc(T.declared) + '</dt><dd><code>"sends": ' + esc(JSON.stringify(declared())) + '</code></dd>' +
        '<dt>' + esc(T.length) + '</dt><dd><code>16 + 4·popcount(bone_mask) + 8·HAS_ROOT + 24·HAS_FINGERS + (HAS_EXPRESSIONS ? (PERFECT_SYNC ? 54 : 15) : 0) + (HAS_EXTRA ? 4·B + V : 0)</code></dd>' +
        '</dl>';
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
        var f = SWITCHES.filter(function (x) { return x.state === t.getAttribute('data-state'); })[0];
        st[f.state] = !st[f.state];
        // The finger block and the finger bones never share a frame (§4, §5.5).
        if (st[f.state] && f.excludes) st[f.excludes] = false;
        st.info = f.info;
      } else if (act === 'info') {
        st.info = t.getAttribute('data-flag');
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
      var err = C.quatAngleDegrees(q, C.decodeSmallestThree(enc.u32));

      var el = document.getElementById('q-comps');
      if (el) {
        el.innerHTML = '[' + enc.components.map(function (c, idx) {
          var txt = c.toFixed(3);
          return idx === enc.largestIndex ? '<mark>' + txt + '</mark>' : txt;
        }).join(', ') + ']';
      }
      setText('q-axis', AXES[enc.largestIndex]);
      setText('q-hex', enc.hex);
      var bits = document.getElementById('q-bits');
      if (bits) {
        bits.innerHTML = [[0, 2], [2, 12], [12, 22], [22, 32]].map(function (r, i) {
          return '<span class="s' + i + '">' + enc.binary.slice(r[0], r[1]) + '</span>';
        }).join(' ');
      }
      setText('q-err', num(err, 4) + '°');
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
    var FRAME = { vrm: 115, perfect: 154 }; // the typical upper-body frame of §6
    var perfect = false;
    var perfectBtn = $('#bw-perfect');

    function stream(tier, frameBytes) { return ((frameBytes + OVERHEAD) * 8 * HZ[tier]) / 1000; }

    function update() {
      var full = Number(sl.full.value), normal = Number(sl.normal.value), minimal = Number(sl.minimal.value), viewers = Number(sl.viewers.value);
      var frame = perfect ? FRAME.perfect : FRAME.vrm;
      var senders = full + normal + minimal;

      var pool = full * stream('FULL', frame) + normal * stream('NORMAL', frame) + minimal * stream('MINIMAL', frame);
      var senderDown = Math.max(0, pool - (senders > 0 ? pool / senders : 0));
      var egress = (viewers * pool + senders * senderDown) / 1000;
      var homeOk = egress <= 20;

      setText('bw-full-v', full);
      setText('bw-normal-v', normal);
      setText('bw-minimal-v', minimal);
      setText('bw-viewers-v', viewers);
      setText('bw-total', fmt(T.people, { n: senders + viewers }));
      setText('bw-total-sub', fmt(T.split, { s: senders, v: viewers }));
      if (perfectBtn) {
        perfectBtn.textContent = perfect ? 'Perfect-Sync (154 B)' : 'VRM-Sync (115 B)';
        perfectBtn.classList.toggle('active', perfect);
      }

      setText('bw-viewer', num(pool, 0) + ' kbit/s');
      setText('bw-viewer-sub', fmt(T.watch, { n: num(pool / 8, 0) }));
      setText('bw-sender', num(senderDown, 0) + ' kbit/s');
      setText('bw-egress', num(egress, 1) + ' Mbit/s');
      setText('bw-egress-sub', homeOk ? T.homeOk : T.homeNo);
      var verdict = $('#bw-egress-sub');
      if (verdict) verdict.classList.toggle('warn', !homeOk);
      setText('bw-ingress', num(pool / 1000, 2) + ' Mbit/s');
      setText('bw-t-full', num(stream('FULL', frame), 1));
      setText('bw-t-normal', num(stream('NORMAL', frame), 1));
      setText('bw-t-minimal', num(stream('MINIMAL', frame), 1));
    }

    Object.keys(sl).forEach(function (k) { on(sl[k], 'input', update); });
    on(perfectBtn, 'click', function () { perfect = !perfect; update(); });

    var box = $('#bw-scenarios');
    if (box) {
      D.SCENARIOS.forEach(function (s) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = s.label;
        on(b, 'click', function () {
          sl.full.value = s.full; sl.normal.value = s.normal; sl.minimal.value = s.minimal; sl.viewers.value = s.viewers;
          update();
        });
        box.appendChild(b);
      });
    }
    update();
  }

  /* ------------------------------------------------------ tables of the spec */
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
      legend.innerHTML = Object.keys(D.CATEGORY_LABEL).map(function (c) {
        return '<span class="key cat-' + c + '">' + esc(D.CATEGORY_LABEL[c]) + '</span>';
      }).join('');
    }
    function renderBones() {
      if (!grid) return;
      var f = (filter ? filter.value : '').toLowerCase();
      var list = D.BONES.filter(function (b) { return b.name.toLowerCase().indexOf(f) !== -1 || String(b.bit).indexOf(f) !== -1; });
      grid.innerHTML = list.length
        ? list.map(function (b) {
          return '<div class="cell cat-' + b.cat + '"><span class="nm">' + esc(b.name) + '</span><span class="ix">' + b.bit + '</span></div>';
        }).join('')
        : '<p class="hint">' + esc(T.noBones) + '</p>';
    }
    on(filter, 'input', renderBones);
    renderBones();

    // expressions
    var bsGrid = $('#bs-grid');
    var vrmBtn = $('#bs-vrm'), perfBtn = $('#bs-perfect');
    function renderBs(perfect) {
      if (!bsGrid) return;
      if (vrmBtn) vrmBtn.classList.toggle('active', !perfect);
      if (perfBtn) perfBtn.classList.toggle('active', perfect);
      var names = perfect ? D.BLENDSHAPES : D.VRM_SYNC_SLOTS.map(function (e) { return e.name; });
      bsGrid.innerHTML = names.map(function (name, idx) {
        return '<div class="cell"><span class="nm">' + esc(name) + '</span><span class="ix">' + idx + '</span></div>';
      }).join('');
    }
    on(vrmBtn, 'click', function () { renderBs(false); });
    on(perfBtn, 'click', function () { renderBs(true); });
    renderBs(false);

    // finger + error tables
    var fb = $('#finger-body');
    if (fb) {
      fb.innerHTML = D.FINGER_ROWS.map(function (r) {
        return '<tr><td>' + r[0] + '</td><td class="m">' + r[1] + '</td><td class="m">' + esc(r[2]) + '</td></tr>';
      }).join('');
    }
    var eb = $('#error-body');
    if (eb) {
      eb.innerHTML = D.ERROR_ROWS.map(function (r) {
        return '<tr><td>' + r[0] + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>';
      }).join('');
    }
  }

  /* ----------------------------------------------------------- copy button */
  function initCopy() {
    var btn = $('#copy-btn'), src = $('#copy-src');
    if (!btn || !src) return;
    var label = btn.querySelector('span');

    function done(ok) {
      if (label) label.textContent = ok ? T.copied : T.pressCopy;
      setTimeout(function () { if (label) label.textContent = T.copy; }, 1800);
    }
    // Without the clipboard API (file://, older browsers): select the text for the user.
    function select() {
      var r = document.createRange();
      r.selectNodeContents(src);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      done(false);
    }
    on(btn, 'click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(src.textContent).then(function () { done(true); }, select);
      } else {
        select();
      }
    });
  }

  /* ------------------------------------------------------------------ boot */
  [initHero, initPacketBuilder, initQuatLab, initBandwidth, initSpec, initCopy].forEach(safe);
})();
