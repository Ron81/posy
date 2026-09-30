// Wires the whole loopback together:
//
//   poseAt(t) ─encode()→ bytes ─LossyChannel→ Receiver.decode()→ jitter buffer
//        │                                                             │
//        └───────────→ sender avatar          receiver avatar ←────────┘
//
// Two three.js scenes render side by side: the left one is fed the ground-truth
// pose directly; the right one is fed only what survived the channel.
import * as THREE from 'three';
import { encode, type Frame } from 'posy';
import { poseAt } from './animator.ts';
import { LossyChannel } from './channel.ts';
import { Receiver } from './receiver.ts';
import { StickFigure, VrmAvatar, type Avatar } from './avatar.ts';
import { Stats } from './stats.ts';

// --- WebGL guard -----------------------------------------------------------

// three needs WebGL. If the browser (or a locked-down/headless environment)
// can't give us a context, say so plainly instead of throwing into a blank page.
function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  const stage = document.querySelector('.stage');
  if (stage) {
    stage.innerHTML =
      '<p style="grid-column:1/-1;padding:40px;color:#fca5a5;text-align:center">' +
      'This demo needs WebGL, which this browser isn’t providing. ' +
      'Try a normal desktop browser with hardware acceleration on.</p>';
  }
  throw new Error('WebGL unavailable');
}

// --- scene plumbing --------------------------------------------------------

interface View {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  avatar: Avatar;
  setAvatar(next: Avatar): void;
}

function makeView(canvas: HTMLCanvasElement, initial: Avatar): View {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1d27);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 1.35, 3.2);
  camera.lookAt(0, 1.1, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(2, 4, 3);
  scene.add(key);

  const grid = new THREE.GridHelper(6, 12, 0x2b2e3c, 0x2b2e3c);
  scene.add(grid);

  scene.add(initial.object);
  const view: View = {
    scene,
    camera,
    renderer,
    avatar: initial,
    setAvatar(next) {
      scene.remove(this.avatar.object);
      this.avatar.dispose();
      this.avatar = next;
      scene.add(next.object);
    },
  };

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  return view;
}

const senderView = makeView(document.getElementById('sender') as HTMLCanvasElement, new StickFigure());
const receiverView = makeView(document.getElementById('receiver') as HTMLCanvasElement, new StickFigure());

// --- channel / receiver / stats -------------------------------------------

const stats = new Stats();
const receiver = new Receiver();
const channel = new LossyChannel((packet) => receiver.receive(packet, performance.now()));

// --- UI bindings -----------------------------------------------------------

let sendRateHz = 30;

const bind = (id: string, outId: string, fmt: (v: number) => string, apply: (v: number) => void) => {
  const input = document.getElementById(id) as HTMLInputElement;
  const out = document.getElementById(outId) as HTMLOutputElement;
  const handler = () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    apply(v);
  };
  input.addEventListener('input', handler);
  handler();
  // Programmatic setter so presets can move the slider and its label together.
  return (v: number) => {
    input.value = String(v);
    handler();
  };
};

const setLoss = bind('loss', 'loss-out', (v) => `${v}%`, (v) => (channel.lossPct = v));
const setJitter = bind('jitter', 'jitter-out', (v) => `${v} ms`, (v) => (channel.jitterMs = v));
bind('rate', 'rate-out', (v) => `${v} Hz`, (v) => (sendRateHz = v));

// Connection-quality presets. Posy frames are tiny, so a link's *feel* is set by
// latency, jitter and loss — not bandwidth. Each preset dials those to match a
// real-world tier. baseLatency is the fixed one-way-ish delay; jitter is the
// random spread on top; loss is drop probability.
const PRESETS: Record<string, { latency: number; jitter: number; loss: number }> = {
  excellent: { latency: 10, jitter: 5, loss: 0 }, // low-latency fibre
  standard: { latency: 30, jitter: 25, loss: 1 }, // solid home broadband
  countryside: { latency: 80, jitter: 90, loss: 6 }, // average-to-weak rural line
  nosignal: { latency: 180, jitter: 260, loss: 35 }, // barely usable
};

const presetButtons = [...document.querySelectorAll<HTMLButtonElement>('.preset')];
for (const btn of presetButtons) {
  btn.addEventListener('click', () => {
    const p = PRESETS[btn.dataset.preset ?? ''];
    if (!p) return;
    channel.baseLatencyMs = p.latency;
    setJitter(p.jitter);
    setLoss(p.loss);
    presetButtons.forEach((b) => b.classList.toggle('active', b === btn));
  });
}

// Moving a slider by hand means we're no longer on a named preset.
for (const id of ['loss', 'jitter']) {
  document.getElementById(id)!.addEventListener('input', () => {
    presetButtons.forEach((b) => b.classList.remove('active'));
  });
}

// .vrm picker — swaps both avatars; failures fall back to a fresh stick figure.
const vrmInput = document.getElementById('vrm') as HTMLInputElement;
const vrmNote = document.getElementById('vrm-note')!;
const vrmUnload = document.getElementById('vrm-unload') as HTMLButtonElement;

function backToStickFigure(): void {
  senderView.setAvatar(new StickFigure());
  receiverView.setAvatar(new StickFigure());
  vrmUnload.hidden = true;
  vrmInput.value = ''; // let the same file be picked again later
  vrmNote.textContent = 'Optional. Built-in stick figure is used by default. Nothing is uploaded.';
}

vrmInput.addEventListener('change', async () => {
  const file = vrmInput.files?.[0];
  if (!file) return;
  vrmNote.textContent = `loading ${file.name}…`;
  try {
    const buf = await file.arrayBuffer();
    // Two independent instances — one per scene.
    const [a, b] = await Promise.all([VrmAvatar.load(buf.slice(0)), VrmAvatar.load(buf.slice(0))]);
    senderView.setAvatar(a);
    receiverView.setAvatar(b);
    vrmUnload.hidden = false;
    vrmNote.textContent = `showing ${file.name}. Nothing was uploaded.`;
  } catch (err) {
    backToStickFigure();
    vrmNote.textContent = `couldn't load that file (${(err as Error).message}). Back to the stick figure.`;
  }
});

vrmUnload.addEventListener('click', backToStickFigure);

// --- loops -----------------------------------------------------------------

// Send loop: fixed cadence independent of render rate.
let lastSend = 0;
function maybeSend(nowMs: number): void {
  const interval = 1000 / sendRateHz;
  if (nowMs - lastSend < interval) return;
  lastSend = nowMs;

  const frame = poseAt(nowMs / 1000);
  const bytes = encode(frame);
  stats.frame(bytes.length);
  senderView.avatar.applyPose(frame, 0.5); // sender tracks truth tightly
  channel.send(bytes);
}

// Render loop.
let last = performance.now();
function tick(nowMs: number): void {
  const delta = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;

  maybeSend(nowMs);

  const target: Frame | null = receiver.target(nowMs);
  if (target) receiverView.avatar.applyPose(target, 0.2); // smooth over jitter

  senderView.avatar.update(delta);
  receiverView.avatar.update(delta);

  senderView.renderer.render(senderView.scene, senderView.camera);
  receiverView.renderer.render(receiverView.scene, receiverView.camera);

  stats.render(sendRateHz, channel.stats.delivered, channel.stats.dropped);
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
