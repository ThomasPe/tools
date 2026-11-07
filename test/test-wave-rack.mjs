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

  for (const id of ['length', 'depth', 'height', 'waves', 'wall', 'foot', 'ends', 'segments', 'downloadBtn', 'viewport']) {
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

test('validation rejects walls that are too thick for the curvature', () => {
  const G = loadGeometry();
  const tight = G.validate({ ...G.DEFAULTS, height: 120, waves: 8 });
  assert.ok(tight.errors.some(e => e.includes('too tight')), 'reports folding inner curve');
  const feet = G.validate({ ...G.DEFAULTS, foot: 2.5 });
  assert.ok(feet.errors.some(e => e.includes('Flat feet')), 'reports oversized feet');
  assert.ok(G.validate({ ...G.DEFAULTS, depth: 300 }).warnings.some(w => w.includes('Print height')), 'warns about tall prints');
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
