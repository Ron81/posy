// Wires the whole loopback together:
//
//   poseAt(t) ─crop()→ encode()→ bytes ─LossyChannel→ Receiver.decode()→ jitter buffer
//        │                                                                    │
//        └───────────→ sender avatar               receiver avatar ←──────────┘
//
// Two three.js scenes render side by side: the left one is fed the full performance
// directly; the right one is fed only what the sender declared (tracker ∩ avatar,
// spec §2.1) and what then survived the channel.
import * as THREE from 'three';
import { encode, type Frame } from 'posy';
import { poseAt, extrasAt } from './animator.ts';
import { POSES, bodyPoseAt } from './poses.ts';
import { TRACKERS, FEATURES, computeSends, crop, region, declAt, NO_EXTRAS, type DataType, type ExtraDecl, type Tracker } from './declare.ts';
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
  /** Current camera distance and look-at height; eased toward the framing target. */
  dist: number;
  lookY: number;
}

// Camera framing per declared region: [distance, look-at height], in avatar heights.
// `hands` and `feet` are close-ups for the poses that exist to show those parts.
const FRAMING = {
  full: [2.1, 0.5],
  upper: [1.3, 0.74],
  face: [0.85, 0.88],
  hands: [0.95, 0.8],
  feet: [0.6, 0.07],
  head: [0.42, 0.915],
} as const;

function frameCamera(view: View, r: keyof typeof FRAMING, ease: number): void {
  const [dist, at] = FRAMING[r];
  const height = view.avatar.height;
  view.dist += (dist * height - view.dist) * ease;
  view.lookY += (at * height - view.lookY) * ease;
  // Slightly off-axis, so a leg moving forward or back is visible as such.
  view.camera.position.set(0.3 * view.dist, view.lookY + 0.08 * view.dist, 0.95 * view.dist);
  view.camera.lookAt(0, view.lookY, 0);
}

function makeView(canvas: HTMLCanvasElement, initial: Avatar): View {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1d27);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

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
    dist: FRAMING.full[0] * initial.height,
    lookY: FRAMING.full[1] * initial.height,
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
bind('rate', 'rate-out', (v) => `${v} FPS`, (v) => (sendRateHz = v));

// Connection-quality presets. Posy frames are tiny, so a link's *feel* is set by
// latency, jitter and loss — not bandwidth. Each preset dials those to match a
// real-world tier. baseLatency is the fixed one-way-ish delay; jitter is the
// random spread on top; loss is drop probability. `mbit` is that tier's real
// bandwidth (used only for the "tiny slice of your connection" comparison), and
// `quip` is the flavour text that leads the comparison line.
interface Preset {
  latency: number;
  jitter: number;
  loss: number;
  mbit: number;
  quip: string;
}
const PRESETS: Record<string, Preset> = {
  excellent: { latency: 10, jitter: 5, loss: 0, mbit: 1000, quip: 'Gigabit fibre, fancy — Posy barely tickles it,' },
  standard: { latency: 30, jitter: 25, loss: 1, mbit: 50, quip: 'Normal home broadband, and Posy is comfy at' },
  countryside: { latency: 80, jitter: 90, loss: 6, mbit: 25, quip: 'Out in the countryside, huh? Still totally fine at' },
  nosignal: { latency: 180, jitter: 260, loss: 35, mbit: 5, quip: 'Oh, so you live in a cave. Sucks to be you — but it still works at' },
};

const presetButtons = [...document.querySelectorAll<HTMLButtonElement>('.preset[data-preset]')];
for (const btn of presetButtons) {
  btn.addEventListener('click', () => {
    const p = PRESETS[btn.dataset.preset ?? ''];
    if (!p) return;
    channel.baseLatencyMs = p.latency;
    setJitter(p.jitter);
    setLoss(p.loss);
    stats.setConnection(p.mbit, p.quip);
    presetButtons.forEach((b) => b.classList.toggle('active', b === btn));
  });
}

// Moving a slider by hand means we're no longer on a named preset.
for (const id of ['loss', 'jitter']) {
  document.getElementById(id)!.addEventListener('input', () => {
    stats.setConnection(null, null);
    presetButtons.forEach((b) => b.classList.remove('active'));
  });
}

// Declaration: the tracker the user picks, cut down to what the loaded avatar can show.
// `?tracker=<id>&pose=<index>` preselects both, so a specific check can be linked to.
const params = new URLSearchParams(location.search);
let tracker: Tracker = TRACKERS.find((t) => t.id === params.get('tracker')) ?? TRACKERS[0];
let sends: ReadonlySet<DataType> = new Set();

const trackerRow = document.getElementById('trackers')!;
const capsBody = document.getElementById('caps-body')!;
const sendsEl = document.getElementById('sends')!;
const chipsRow = document.getElementById('chips')!;
const chipsLabel = document.getElementById('chips-label')!;

function renderDeclaration(): void {
  const avatar = receiverView.avatar.caps;
  const list = computeSends(tracker, avatar);
  sends = new Set(list);
  capsBody.innerHTML = FEATURES.map(({ type, label }) => {
    const t = tracker.delivers.includes(type);
    const a = avatar.has(type);
    const s = sends.has(type);
    const trackerCell = !t ? 'no' : type === 'bones' && tracker.bonesOnly ? tracker.bonesOnly.note : 'yes';
    const sentCell = s
      ? 'yes'
      : t && !a
        ? 'no — the avatar cannot show it'
        : !t && a
          ? 'no — the tracker does not deliver it'
          : t && a
            ? 'no — it depends on a type that is not sent'
            : 'no';
    const cls = (on: boolean) => (on ? 'y' : 'n');
    return (
      `<tr class="${s ? 'on' : 'off'}"><td>${label}</td><td class="${cls(t)}">${trackerCell}</td>` +
      `<td class="${cls(a)}">${a ? 'yes' : 'no'}</td><td class="${cls(s)}">${sentCell}</td></tr>`
    );
  }).join('');
  sendsEl.textContent = JSON.stringify(list);

  // The same information as one row of chips, with the reason spelled out.
  chipsRow.querySelectorAll('.chip').forEach((c) => c.remove());
  for (const { type, short } of FEATURES) {
    const t = tracker.delivers.includes(type);
    const a = avatar.has(type);
    const s = sends.has(type);
    const chip = document.createElement('span');
    chip.className = s ? 'chip on' : 'chip';
    chip.textContent = s
      ? `${short} ✓${type === 'bones' && tracker.bonesOnly ? ' ' + tracker.bonesOnly.note : ''}`
      : `${short} ✗${t && !a ? ' avatar' : !t && a ? ' tracker' : ''}`;
    chip.title = s
      ? 'transmitted'
      : t && !a
        ? 'not transmitted: the avatar cannot show it'
        : !t && a
          ? 'not transmitted: the tracker does not deliver it'
          : 'not transmitted';
    chipsRow.append(chip);
  }
  chipsLabel.title = `caps.sends = ${JSON.stringify(list)}`;
  for (const b of trackerRow.querySelectorAll<HTMLButtonElement>('.preset')) {
    b.classList.toggle('active', b.dataset.tracker === tracker.id);
  }
}

for (const t of TRACKERS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'preset';
  b.dataset.tracker = t.id;
  b.textContent = t.label;
  b.addEventListener('click', () => {
    tracker = t;
    renderDeclaration();
  });
  trackerRow.append(b);
}
renderDeclaration();

// Pose: one dropdown. 'auto' cycles through the whole-body poses.
const poseSelect = document.getElementById('pose') as HTMLSelectElement;
const poseNow = document.getElementById('pose-now')!;
let shownPose = '';

poseSelect.append(new Option('Auto — cycle through the poses', 'auto'));
for (const group of new Set(POSES.map((p) => p.group))) {
  const og = document.createElement('optgroup');
  og.label = group;
  for (const p of POSES.filter((x) => x.group === group)) og.append(new Option(p.label, p.id));
  poseSelect.append(og);
}
{
  // A bare number selects that conformance vector (7 → p07); 0 is the idle stand.
  const wanted = params.get('pose') ?? 'auto';
  const id = /^\d+$/.test(wanted) ? (wanted === '0' ? 'idle' : `p${wanted.padStart(2, '0')}`) : wanted;
  poseSelect.value = POSES.some((p) => p.id === id) ? id : 'auto';
}
poseSelect.addEventListener('change', () => (shownPose = ''));

// Close-up: 'auto' follows the pose (most poses ask for none), or hold one by hand.
const lookSelect = document.getElementById('look') as HTMLSelectElement;
if ([...lookSelect.options].some((o) => o.value === params.get('look'))) lookSelect.value = params.get('look')!;
let poseLook: 'hands' | 'feet' | 'head' | undefined;

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
  renderDeclaration();
  declareExtras();
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
    renderDeclaration();
    declareExtras();
  } catch (err) {
    backToStickFigure();
    vrmNote.textContent = `couldn't load that file (${(err as Error).message}). Back to the stick figure.`;
  }
});

vrmUnload.addEventListener('click', backToStickFigure);

// --- extras (spec §2.6) ----------------------------------------------------

// The names typed here are declared if the loaded avatar has them. `?extra=a,b&values=c`
// presets both fields. Declarations are kept oldest first; the receiver shares the list,
// as a peer gets it from the server.
const extraBonesInput = document.getElementById('extra-bones') as HTMLInputElement;
const extraValuesInput = document.getElementById('extra-values') as HTMLInputElement;
const extraNote = document.getElementById('extra-note')!;
extraBonesInput.value = params.get('extra') ?? '';
extraValuesInput.value = params.get('values') ?? '';
let decls: ExtraDecl[] = [NO_EXTRAS];
receiver.decls = decls;

function declareExtras(): void {
  const has = receiverView.avatar.extras;
  const pick = (input: HTMLInputElement, known: string[]) =>
    [...new Set(input.value.split(',').map((s) => s.trim()).filter((s) => s !== ''))].filter((s) => known.includes(s) || s.startsWith('app:'));
  const bones = pick(extraBonesInput, has.bones).slice(0, 255);
  const values = pick(extraValuesInput, has.values).slice(0, 255);
  // `since` lies half a second ahead, so the peer holds the lists before the first frame
  // that uses them; frames already under way still follow the previous declaration.
  decls = [decls[decls.length - 1], { bones, values, since: Math.floor(performance.now()) + 500 }];
  receiver.decls = decls;

  for (const [id, names] of [['extra-bone-names', has.bones], ['extra-value-names', has.values]] as const) {
    document.getElementById(id)!.replaceChildren(...names.map((n) => Object.assign(document.createElement('option'), { value: n })));
  }
  extraNote.textContent =
    has.bones.length + has.values.length === 0
      ? 'Extras need a loaded avatar: the stick figure is the humanoid body and nothing else.'
      : `This avatar has ${has.bones.length} further bones and ${has.values.length} expressions of its own. ` +
        `Declared: ${bones.length} bones, ${values.length} values = ${4 * bones.length + values.length} B per frame. ` +
        'Declared bones are moved by a sender-side animation; the others stay with the spring bones. To move a whole ear or tail, declare every bone of it.';
}
extraBonesInput.addEventListener('change', declareExtras);
extraValuesInput.addEventListener('change', declareExtras);

// --- loops -----------------------------------------------------------------

// Send loop: fixed cadence independent of render rate.
let lastSend = 0;
function maybeSend(nowMs: number): void {
  const interval = 1000 / sendRateHz;
  if (nowMs - lastSend < interval) return;
  lastSend = nowMs;

  const body = bodyPoseAt(nowMs / 1000, poseSelect.value);
  poseLook = body.look;
  // In Auto, say which pose is on; a held pose is already named by the dropdown, so it
  // shows the step the pose is at, if it has steps.
  const now = poseSelect.value === 'auto' ? `now: ${POSES.find((p) => p.id === body.id)?.label ?? ''}` : (body.note ?? '');
  if (now !== shownPose) poseNow.textContent = shownPose = now;

  const performance = poseAt(nowMs / 1000, body);
  // Extras follow the declaration that applies at this frame's timestamp (§2.6).
  const decl = declAt(decls, performance.timestampMs);
  performance.extra = extrasAt(nowMs / 1000, decl);
  const bytes = encode({ ...crop(performance, tracker, sends), extra: performance.extra }); // only the declared parts go out
  stats.frame(bytes.length);
  senderView.avatar.applyPose(performance, 0.5, decl); // left: everything the performer does
  channel.send(bytes);
}

// Render loop.
let last = performance.now();
function tick(nowMs: number): void {
  const delta = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;

  maybeSend(nowMs);

  const target: Frame | null = receiver.target(nowMs);
  if (target) receiverView.avatar.applyPose(target, 0.2, receiver.currentDecl); // smooth over jitter

  // Left always shows the whole performer; right frames the declared region. A close-up
  // applies to both, so the two sides can be compared.
  const look = lookSelect.value === 'auto' ? poseLook : (lookSelect.value as keyof typeof FRAMING);
  frameCamera(senderView, look ?? 'full', 0.08);
  frameCamera(receiverView, look ?? region(tracker, sends), 0.08);

  senderView.avatar.update(delta);
  receiverView.avatar.update(delta);

  senderView.renderer.render(senderView.scene, senderView.camera);
  receiverView.renderer.render(receiverView.scene, receiverView.camera);

  stats.render(sendRateHz, channel.stats.delivered, channel.stats.dropped);
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
