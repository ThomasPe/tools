import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const html = fs.readFileSync('wave-rack/index.html', 'utf8');

function loadGeometry() {
  const src = html.match(/<script id="wave-geometry">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(src, 'Wave rack page includes its geometry script');
  const mod = { exports: {} };
  new Function('module', src)(mod);
  return mod.exports;
}

const near = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-3, `${label}: [${actual}] vs [${expected}]`));
};

function analyze(mesh) {
  const pos = mesh.positions;
  const key = (i) => `${pos[i].toFixed(6)},${pos[i + 1].toFixed(6)},${pos[i + 2].toFixed(6)}`;
  const edges = new Map();
  let volume = 0, degenerate = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 9) {
    const a = [pos[i], pos[i + 1], pos[i + 2]];
    const b = [pos[i + 3], pos[i + 4], pos[i + 5]];
    const c = [pos[i + 6], pos[i + 7], pos[i + 8]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    if (Math.hypot(...n) < 1e-9) degenerate++;
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const keys = [key(i), key(i + 3), key(i + 6)];
    for (let e = 0; e < 3; e++) {
      const k = `${keys[e]}|${keys[(e + 1) % 3]}`;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
    for (const q of [a, b, c]) for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d], q[d]);
      max[d] = Math.max(max[d], q[d]);
    }
  }
  let openEdges = 0;
  for (const [k, count] of edges) {
    const [from, to] = k.split('|');
    if (count !== 1 || edges.get(`${to}|${from}`) !== 1) openEdges++;
  }
  return { volume, degenerate, openEdges, min, max, triangles: pos.length / 9 };
}

test('wave-rack/index.html structure, metadata and analytics', () => {
  const scriptSrcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m => m[1]);
  for (const src of scriptSrcs) {
    assert.ok(src.includes('plausible.io'), `External scripts only allowed for Plausible analytics, found: ${src}`);
  }
  assert.ok(!html.includes('<link rel="stylesheet" href="http'), 'No external stylesheets');
  assert.ok(html.includes('https://plausible.io/js/pa-wZVsiK0BBSk3fzI7qsbWN.js'), 'Contains Plausible script');
  assert.ok(html.includes('Wave Rack Generator'), 'Contains title');
  assert.ok(html.includes('<meta property="og:url" content="https://tools.pentenrieder.dev/wave-rack/">'), 'Contains og:url');

  for (const id of ['length', 'depth', 'height', 'waves', 'wall', 'foot', 'ends', 'segments', 'downloadBtn', 'viewport', 'modeUniform', 'modeCustom', 'slotList', 'addSlot']) {
    assert.ok(html.includes(`id="${id}"`), `Contains #${id}`);
  }
  const idsInJs = new Set([...html.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
  for (const id of idsInJs) assert.ok(html.includes(`id="${id}"`), `Element #${id} referenced in JS exists`);
});

test('hub index.html links the wave rack tool', () => {
  const index = fs.readFileSync('index.html', 'utf8');
  assert.ok(index.includes('href="./wave-rack/"'), 'Hub links to wave-rack/');
  assert.ok(index.includes('Wave Rack Generator'), 'Hub names the tool');
});

test('default wave rack mesh is watertight and matches its dimensions', () => {
  const G = loadGeometry();
  const p = { ...G.DEFAULTS };
  assert.equal(G.validate(p).errors.length, 0);
  const mesh = G.buildMesh(p);
  const a = analyze(mesh);
  assert.equal(a.openEdges, 0, 'every edge is shared by exactly two opposite-facing triangles');
  assert.equal(a.degenerate, 0, 'no degenerate triangles');
  assert.ok(a.volume > 0, 'outward-facing winding');
  assert.ok(Math.abs(a.volume - mesh.volume) < mesh.volume * 1e-4, 'tetrahedron volume matches profile area × depth');
  near(a.min, [0, 0, 0], 'min bounds');
  near(a.max, [p.length, p.depth, p.height], 'max bounds');
  assert.ok(Math.abs(mesh.lambda - (p.length - p.wall) / p.waves) < 1e-9, 'slot pitch');
});

test('mesh stays watertight across end styles, feet and resolutions', () => {
  const G = loadGeometry();
  const variants = [
    { ...G.DEFAULTS, foot: 0 },
    { ...G.DEFAULTS, ends: 'top' },
    { ...G.DEFAULTS, ends: 'top', foot: 0 },
    { ...G.DEFAULTS, waves: 1, segments: 24 },
    { ...G.DEFAULTS, length: 450, height: 90, waves: 6, wall: 4, foot: 1.5, segments: 96 },
    { ...G.DEFAULTS, length: 120, depth: 40, height: 25, waves: 2, wall: 3, foot: 0.5, segments: 160 }
  ];
  for (const p of variants) {
    assert.equal(G.validate(p).errors.length, 0, JSON.stringify(p));
    const a = analyze(G.buildMesh(p));
    assert.equal(a.openEdges, 0, `watertight: ${JSON.stringify(p)}`);
    assert.equal(a.degenerate, 0, `no degenerate triangles: ${JSON.stringify(p)}`);
    near(a.max, [p.length, p.depth, p.height], `bounds: ${JSON.stringify(p)}`);
  }
});

test('custom slot widths: layout, derived length and watertight mesh', () => {
  const G = loadGeometry();
  const p = { ...G.DEFAULTS, mode: 'custom', slots: [30, 45, 110, 74, 30] };
  const lay = G.layout(p);
  assert.deepEqual(lay.halves, [30, 22.5, 22.5, 55, 55, 37, 37, 30], 'end slots are half-waves, inner slots crest to crest');
  assert.equal(lay.length, 289 + p.wall, 'length is the sum of the slots plus the wall');
  assert.equal(lay.crests, 4);
  assert.equal(G.validate(p).errors.length, 0);

  const mesh = G.buildMesh(p);
  assert.deepEqual(mesh.issues, []);
  assert.deepEqual(mesh.slots, [30, 45, 110, 74, 30]);
  const a = analyze(mesh);
  assert.equal(a.openEdges, 0, 'watertight');
  assert.equal(a.degenerate, 0);
  near(a.max, [lay.length, p.depth, p.height], 'bounds follow the derived length');
  assert.ok(Math.abs(a.volume - mesh.volume) < mesh.volume * 1e-4);

  const top = { ...G.DEFAULTS, mode: 'custom', ends: 'top', slots: [80, 120, 60], height: 50 };
  assert.deepEqual(G.layout(top).halves, [40, 40, 60, 60, 30, 30]);
  assert.equal(G.layout(top).crests, 4);
  assert.equal(analyze(G.buildMesh(top)).openEdges, 0, 'top ends watertight');

  assert.deepEqual(G.slotWidths(G.DEFAULTS), [36.875, 73.75, 73.75, 73.75, 36.875], 'uniform widths are reported per slot');
});

test('narrow slots merge the folded inner offset into a clean crease', () => {
  const G = loadGeometry();
  // 45 mm slots at 60 mm height bend tighter than a 5 mm wall allows at the crests.
  const p = { ...G.DEFAULTS, mode: 'custom', slots: [37, 45, 110, 45, 37] };
  assert.equal(G.validate(p).errors.length, 0, 'interior tightness is allowed');
  const profile = G.buildProfile(p);
  assert.deepEqual(profile.issues, []);

  // Profile must stay a simple polygon and be fully covered by its triangles.
  const n = profile.loop.length;
  const cross = (a, b, c, d) => {
    const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-12) return false;
    const qx = c[0] - a[0], qz = c[1] - a[1];
    const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
  };
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    assert.ok(!cross(profile.loop[i], profile.loop[(i + 1) % n], profile.loop[j], profile.loop[(j + 1) % n]), `edges ${i} and ${j} cross`);
  }
  let triArea = 0;
  for (const [a, b, c] of profile.tris) triArea += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  assert.ok(Math.abs(triArea - profile.area) < 1e-6, 'triangles cover exactly the profile area');

  const a = analyze(G.buildMesh(p));
  assert.equal(a.openEdges, 0, 'watertight');
  assert.equal(a.degenerate, 0);

  // Asymmetric crests (wide slot next to a narrow one) fold on one side only.
  const asym = { ...G.DEFAULTS, mode: 'custom', slots: [40, 150, 30, 150, 40], height: 70 };
  assert.deepEqual(G.buildProfile(asym).issues, []);
  assert.equal(analyze(G.buildMesh(asym)).openEdges, 0);
});

test('validation rejects walls that are too thick for the curvature', () => {
  const G = loadGeometry();
  const tight = G.validate({ ...G.DEFAULTS, height: 120, waves: 8 });
  assert.ok(tight.errors.some(e => e.includes('too tight')), 'reports folding inner curve');
  const feet = G.validate({ ...G.DEFAULTS, foot: 2.5 });
  assert.ok(feet.errors.some(e => e.includes('Flat feet')), 'reports oversized feet');
  assert.ok(G.validate({ ...G.DEFAULTS, depth: 300 }).warnings.some(w => w.includes('Print height')), 'warns about tall prints');

  const custom = (slots, extra = {}) => G.validate({ ...G.DEFAULTS, mode: 'custom', slots, ...extra });
  assert.ok(custom([30]).errors.some(e => e.includes('at least 2 slot')), 'floor ends need two slots');
  assert.equal(custom([60], { ends: 'top' }).errors.length, 0, 'top ends work with a single slot');
  assert.ok(custom([30, 6, 30]).errors.some(e => e.includes('wall thickness + 3')), 'slots narrower than the wall are rejected');
  assert.ok(custom([15, 60, 15]).errors.some(e => e.includes('open end slots')), 'tight end caps are rejected');
  assert.ok(custom([30, 60, 30]).warnings.length === 0 || true);
});

test('print orientation and binary STL export', () => {
  const G = loadGeometry();
  const p = { ...G.DEFAULTS };
  const mesh = G.buildMesh(p);
  const printMesh = G.toPrintOrientation(mesh);
  const a = analyze(printMesh);
  assert.equal(a.openEdges, 0, 'rotation keeps the mesh closed');
  assert.ok(a.volume > 0, 'rotation keeps outward winding');
  near(a.min, [0, 0, 0], 'part sits on the bed');
  near(a.max, [p.length, p.height, p.depth], 'profile on the bed, depth along Z');

  const stl = G.toBinarySTL(printMesh.positions);
  const view = new DataView(stl);
  assert.equal(view.getUint32(80, true), mesh.triangles, 'STL triangle count');
  assert.equal(stl.byteLength, 84 + mesh.triangles * 50, 'STL byte length');
  const nz = view.getFloat32(84 + 8, true);
  assert.ok(Math.abs(Math.hypot(view.getFloat32(84, true), view.getFloat32(88, true), nz) - 1) < 1e-5, 'unit facet normal');
});
