/*!
 * Posy — codec helpers.
 * Classic script (no ES modules) so the page works when opened straight from disk (file://).
 * Ports the smallest-three quaternion packing from spec §5.3 / Appendix B and the frame-size formula from §5.1.
 * Exposes: window.PosyCodec
 */
(function (global) {
  'use strict';

  // Literal constants from the spec. Do NOT swap for Math.SQRT1_2: the spec's rounded decimals
  // are part of the wire definition, and other implementations must produce identical u32 values.
  var SQRT1_2 = 0.70710678;
  var RANGE = 1.41421356; // 2 * SQRT1_2

  function normalize(q) {
    var len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
    return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
  }

  function pad(str, len) {
    return ('00000000000000000000000000000000' + str).slice(-len);
  }

  /** §5.3 sender side. Returns { u32, hex, binary, largestIndex, components:[x,y,z,w] }. */
  function encodeSmallestThree(qIn) {
    var q = normalize(qIn);
    var comps = [q.x, q.y, q.z, q.w];

    // Largest |component|; strict '>' means ties resolve to the LOWEST index.
    var i = 0, maxAbs = -1, k;
    for (k = 0; k < 4; k++) {
      var a = Math.abs(comps[k]);
      if (a > maxAbs) { maxAbs = a; i = k; }
    }

    // q and -q are the same rotation: make the dropped component non-negative.
    if (comps[i] < 0) {
      for (k = 0; k < 4; k++) comps[k] = -comps[k];
    }

    var rest = [];
    for (k = 0; k < 4; k++) if (k !== i) rest.push(comps[k]);

    function quant(v) {
      return Math.min(1023, Math.max(0, Math.round(((v + SQRT1_2) / RANGE) * 1023)));
    }
    var ea = quant(rest[0]), eb = quant(rest[1]), ec = quant(rest[2]);

    var u32 = (((i & 3) << 30) | ((ea & 1023) << 20) | ((eb & 1023) << 10) | (ec & 1023)) >>> 0;

    return {
      u32: u32,
      hex: '0x' + pad(u32.toString(16).toUpperCase(), 8),
      binary: pad(u32.toString(2), 32),
      largestIndex: i,
      components: comps
    };
  }

  /** §5.3 receiver side (incl. the mandatory renormalisation). */
  function decodeSmallestThree(u32) {
    var w = u32 >>> 0;
    var i = w >>> 30;
    function dequant(bits) { return (bits / 1023) * RANGE - SQRT1_2; }
    var rest = [dequant((w >>> 20) & 1023), dequant((w >>> 10) & 1023), dequant(w & 1023)];
    var s = 1 - rest[0] * rest[0] - rest[1] * rest[1] - rest[2] * rest[2];
    var d = Math.sqrt(Math.max(0, s));
    var out = [0, 0, 0, 0], j = 0, n;
    for (n = 0; n < 4; n++) out[n] = n === i ? d : rest[j++];
    return normalize({ x: out[0], y: out[1], z: out[2], w: out[3] });
  }

  function quatAngleDegrees(a, b) {
    var dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
    return (2 * Math.acos(dot) * 180) / Math.PI;
  }

  /** Euler angles (degrees) -> quaternion, for the demo sliders. */
  function eulerToQuat(xDeg, yDeg, zDeg) {
    var x = (xDeg * Math.PI) / 360, y = (yDeg * Math.PI) / 360, z = (zDeg * Math.PI) / 360;
    var cx = Math.cos(x), sx = Math.sin(x);
    var cy = Math.cos(y), sy = Math.sin(y);
    var cz = Math.cos(z), sz = Math.sin(z);
    return {
      w: cx * cy * cz + sx * sy * sz,
      x: sx * cy * cz - cx * sy * sz,
      y: cx * sy * cz + sx * cy * sz,
      z: cx * cy * sz - sx * sy * cz
    };
  }

  /** §5.1: 16 + 4*bones + 8*root + 24*fingers + (expr ? (perfectSync ? 54 : 18) : 0). */
  function packetSize(o) {
    var size = 16 + 4 * o.boneCount;
    if (o.hasRoot) size += 8;
    if (o.hasFingers) size += 24;
    if (o.hasExpressions) size += o.perfectSync ? 54 : 18;
    return size;
  }

  /** bone_mask as a 16-digit hex string, built from two 32-bit halves (no BigInt needed). */
  function maskHex(bits) {
    var lo = 0, hi = 0;
    for (var n = 0; n < bits.length; n++) {
      var b = bits[n];
      if (b < 32) lo |= (1 << b); else hi |= (1 << (b - 32));
    }
    function h8(v) { return ('00000000' + (v >>> 0).toString(16).toUpperCase()).slice(-8); }
    return '0x' + h8(hi) + h8(lo);
  }

  global.PosyCodec = {
    encodeSmallestThree: encodeSmallestThree,
    decodeSmallestThree: decodeSmallestThree,
    quatAngleDegrees: quatAngleDegrees,
    eulerToQuat: eulerToQuat,
    packetSize: packetSize,
    maskHex: maskHex
  };
})(window);
