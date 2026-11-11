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

const G = loadGeometry();
const custom = (slots, extra = {}) => ({ ...G.DEFAULTS, mode: 'custom', slots, ...extra });

const near = (actual, expected, label, tol = 1e-3) => {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < tol, `${label}: [${actual}] vs [${expected}]`));
};

function analyze(mesh) {
  const pos = mesh.positions;
  const key = (i) => `${pos[i].toFixed(5)},${pos[i + 1].toFixed(5)},${pos[i + 2].toFixed(5)}`;
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

// The outline must be a simple polygon that its triangles cover exactly.
function assertSoundProfile(profile, label) {
  const loop = profile.loop, n = loop.length;
  const cross = (a, b, c, d) => {
    const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
    const den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-12) return false;
    const qx = c[0] - a[0], qz = c[1] - a[1];
    const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
    return t > 1e-7 && t < 1 - 1e-7 && u > 1e-7 && u < 1 - 1e-7;
  };
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    assert.ok(!cross(loop[i], loop[(i + 1) % n], loop[j], loop[(j + 1) % n]), `${label}: outline edges ${i} and ${j} cross`);
  }
  let triArea = 0;
  for (const [a, b, c] of profile.tris) triArea += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  assert.ok(Math.abs(triArea - profile.area) < 1e-6 * Math.max(1, profile.area), `${label}: triangles cover the outline (${triArea} vs ${profile.area})`);
  assert.deepEqual(profile.issues, [], `${label}: no unresolved folds`);
}

// Width of the flat part of every slot floor, measured on the top surface.
function measuredFloors(p, profile) {
  return profile.floorSpans.map((_, k) => {
    let lo = Infinity, hi = -Infinity;
    for (const q of profile.top) {
      if (Math.abs(q[1] - p.wall) < 1e-7 && q[0] > profile.crestX[k] && q[0] < profile.crestX[k + 1]) {
        lo = Math.min(lo, q[0]);
        hi = Math.max(hi, q[0]);
      }
    }
    return hi - lo;
  });
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

  const controls = ['length', 'count', 'depth', 'height', 'angle', 'radius', 'flank', 'plateau', 'wall', 'endFoot'];
  for (const id of controls) {
    assert.ok(html.includes(`id="${id}"`), `Contains #${id}`);
    assert.ok(html.includes(`id="${id}Range"`), `Contains #${id}Range`);
  }
  for (const id of ['segments', 'downloadBtn', 'viewport', 'profile', 'modeEven', 'modeCustom', 'styleFillet', 'styleSine', 'slotList', 'addSlot']) {
    assert.ok(html.includes(`id="${id}"`), `Contains #${id}`);
  }
  const idsInJs = new Set([...html.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
  for (const id of idsInJs) assert.ok(html.includes(`id="${id}"`), `Element #${id} referenced in JS exists`);
  for (const name of [...html.matchAll(/data-preset="([^"]+)"/g)].map(m => m[1])) {
    assert.ok(new RegExp(`\\b${name}: \\{ style:`).test(html), `Preset "${name}" is defined`);
  }
});

test('hub index.html links the wave rack tool', () => {
  const index = fs.readFileSync('index.html', 'utf8');
  assert.ok(index.includes('href="./wave-rack/"'), 'Hub links to wave-rack/');
  assert.ok(index.includes('Wave Rack Generator'), 'Hub names the tool');
});

test('default rack: even slots fill the requested length with a watertight mesh', () => {
  const p = { ...G.DEFAULTS };
  const res = G.resolve(p);
  assert.deepEqual(res.errors, []);
  assert.equal(res.floors.length, 4);
  assert.equal(res.walls, 5);
  assert.ok(Math.abs(res.length - 300) < 1e-9, 'even mode keeps the requested length');
  assert.ok(res.floors.every(f => Math.abs(f - res.floors[0]) < 1e-12) && res.floors[0] > 15, 'equal flat floors');

  const mesh = G.buildMesh(p, res);
  assertSoundProfile(mesh.profile, 'defaults');
  near(measuredFloors(p, mesh.profile), res.floors, 'flat floors as stated', 5e-3);
  const a = analyze(mesh);
  assert.equal(a.openEdges, 0, 'every edge is shared by exactly two opposite-facing triangles');
  assert.equal(a.degenerate, 0, 'no degenerate triangles');
  assert.ok(a.volume > 0, 'outward-facing winding');
  assert.ok(Math.abs(a.volume - mesh.volume) < mesh.volume * 1e-4, 'tetrahedron volume matches profile area × depth');
  near(a.min, [0, 0, 0], 'min bounds');
  near(a.max, [300, p.depth, p.height], 'max bounds');
});

test('classic wave reproduces the original sine profile', () => {
  // Areas recorded from the first sine-only implementation of the tool.
  const classic = { style: 'sine', plateau: 0, endFoot: 0 };
  const a = G.buildProfile(custom([0, 0, 0], { ...classic, flank: 36.875 }));
  assert.ok(Math.abs(a.area - 2757.918950) < 1e-5, `area ${a.area}`);
  assert.ok(Math.abs(a.length - 300) < 1e-9);
  const b = G.buildProfile(custom([0], { ...classic, flank: 49, height: 40, wall: 4, segments: 96 }));
  assert.ok(Math.abs(b.area - 1013.694377) < 1e-5, `area ${b.area}`);
  assert.ok(Math.abs(b.length - 200) < 1e-9);
});

test('custom slots: stated floor widths are the real flat floors', () => {
  const cases = {
    'rounded corners': custom([10, 18, 30, 45]),
    'corners tighter than the wall': custom([12, 22, 1, 30], { radius: 1.5, angle: 8 }),
    'thick wall, crisp corners': custom([8, 25], { wall: 10, radius: 1, angle: 30, height: 80 }),
    'wave flanks with floors': custom([10, 25, 40], { style: 'sine', flank: 22, plateau: 6 }),
    'coarse wave': custom([36], { style: 'sine', flank: 54, height: 129, wall: 10, endFoot: 23, segments: 24 })
  };
  for (const [label, p] of Object.entries(cases)) {
    const res = G.resolve(p);
    assert.deepEqual(res.errors, [], label);
    const mesh = G.buildMesh(p, res);
    assertSoundProfile(mesh.profile, label);
    near(measuredFloors(p, mesh.profile), p.slots, `${label}: flat floors`, 5e-3);
    const a = analyze(mesh);
    assert.equal(a.openEdges, 0, `${label}: watertight`);
    assert.equal(a.degenerate, 0, `${label}: no degenerate triangles`);
    near(a.max, [res.length, p.depth, p.height], `${label}: bounds follow the derived length`);
    near(a.min, [0, 0, 0], `${label}: sits on the ground`);
  }
});

test('straight walls: derived length and corner intrusion match the closed form', () => {
  const p = custom([10, 18, 30], { angle: 15, radius: 2, wall: 5, height: 60, plateau: 4, endFoot: 8 });
  const beta = (90 - p.angle) * Math.PI / 180;
  const rise = p.height - p.wall;
  const run = 2 * p.radius * Math.sin(beta) + (rise - 2 * p.radius * (1 - Math.cos(beta))) / Math.tan(beta);
  const delta = (p.wall / 2 - p.radius) * Math.tan(beta / 2);
  const flank = G.buildFlank(p);
  assert.ok(Math.abs(flank.run - run) < 1e-9, 'flank run');
  assert.ok(Math.abs(flank.slopeDeg - 75) < 1e-9, 'wall slope');
  assert.ok(Math.abs(G.cornerIntrusion(p, flank) - delta) < 1e-6, 'corner intrusion');
  assert.equal(G.cornerIntrusion({ ...p, radius: 10 }, G.buildFlank({ ...p, radius: 10 })), 0, 'round corners do not intrude');

  const res = G.resolve(p);
  const expected = p.wall + 2 * (p.endFoot + delta + 0.3) + 4 * (2 * run + p.plateau) + (10 + 18 + 30) + 3 * 2 * delta;
  assert.ok(Math.abs(res.length - expected) < 1e-6, `length ${res.length} vs ${expected}`);

  // A radius too large for the height turns the flank into a soft S with a shallower slope.
  const soft = G.buildFlank({ ...p, radius: 60 });
  assert.ok(soft.slopeDeg < 75 && soft.slopeDeg > 30);
  assert.ok(Math.abs(soft.pts.at(-1).z - rise) < 1e-9, 'soft S still reaches the full height');
});

test('symmetric racks stay mirror-symmetric, including merged folds', () => {
  const variants = [
    custom([20, 5, 20], { radius: 1.2, angle: 6, wall: 6 }),
    custom([0, 14, 0], { style: 'sine', flank: 16, height: 70 }),
    custom([30, 30], { style: 'sine', flank: 35, height: 76, wall: 8, endFoot: 23, segments: 24 })
  ];
  for (const p of variants) {
    const profile = G.buildProfile(p);
    assertSoundProfile(profile, JSON.stringify(p.slots));
    const fmt = (q) => `${q[0].toFixed(4)},${q[1].toFixed(4)}`;
    const points = new Set(profile.loop.map(fmt));
    for (const q of profile.loop) {
      assert.ok(points.has(fmt([profile.length - q[0], q[1]])), `mirror image of ${fmt(q)} is on the outline`);
    }
  }
});

test('mesh stays sound across styles, extremes and resolutions', () => {
  const variants = [
    { ...G.DEFAULTS, count: 1 },
    { ...G.DEFAULTS, length: 450, count: 6, height: 90, wall: 4, segments: 96 },
    { ...G.DEFAULTS, style: 'sine', flank: 26, endFoot: 8 },
    custom([0, 0, 0, 0], { style: 'sine', flank: 12, height: 80 }),
    custom([24, 24, 24], { angle: 6, radius: 3, wall: 4, endFoot: 12 }),
    custom([14, 14], { angle: 22, radius: 4, plateau: 6 }),
    custom([5, 0, 60], { angle: 3, radius: 1, wall: 8, plateau: 0, endFoot: 0 }),
    custom([12], { radius: 40, height: 45, segments: 160 }),
    custom([18, 18], { angle: 60, radius: 2, plateau: 20, height: 25 })
  ];
  for (const p of variants) {
    const res = G.resolve(p);
    assert.deepEqual(res.errors, [], JSON.stringify(p));
    const mesh = G.buildMesh(p, res);
    assertSoundProfile(mesh.profile, JSON.stringify(p));
    const a = analyze(mesh);
    assert.equal(a.openEdges, 0, `watertight: ${JSON.stringify(p)}`);
    assert.equal(a.degenerate, 0, `no degenerate triangles: ${JSON.stringify(p)}`);
    near(a.max, [res.length, p.depth, p.height], `bounds: ${JSON.stringify(p)}`);
  }
});

test('validation explains what does not fit', () => {
  const tooMany = G.validate({ ...G.DEFAULTS, count: 12 });
  assert.ok(tooMany.errors.some(e => e.includes('need at least')), 'reports the length that would be needed');
  assert.equal(tooMany.fits, 5, 'reports how many slots fit');
  assert.deepEqual(G.validate({ ...G.DEFAULTS, count: tooMany.fits }).errors, [], 'that many slots do fit');

  assert.ok(G.validate({ ...G.DEFAULTS, height: 8 }).errors.some(e => e.includes('Height')), 'height must exceed the wall');
  assert.ok(G.validate({ ...G.DEFAULTS, angle: 80 }).errors.some(e => e.includes('Wall angle')));
  assert.ok(G.validate({ ...G.DEFAULTS, radius: 0 }).errors.some(e => e.includes('Corner radius')));
  assert.ok(G.validate({ ...G.DEFAULTS, style: 'sine', flank: 2 }).errors.some(e => e.includes('Flank width')));
  assert.ok(G.validate({ ...G.DEFAULTS, count: 2.5 }).errors.some(e => e.includes('whole number')));
  assert.ok(G.validate(custom([])).errors.some(e => e.includes('at least one slot')));
  assert.ok(G.validate(custom([10, -1])).errors.some(e => e.includes('zero or more')));
  assert.ok(G.validate({ ...G.DEFAULTS, depth: 300 }).warnings.some(w => w.includes('Print height')), 'warns about tall prints');
  assert.deepEqual(G.validate({ ...G.DEFAULTS, style: 'sine', flank: 10 }).warnings, [], 'steep waves are not flagged');
});

test('print orientation and binary STL export', () => {
  const p = { ...G.DEFAULTS };
  const mesh = G.buildMesh(p);
  const printMesh = G.toPrintOrientation(mesh);
  const a = analyze(printMesh);
  assert.equal(a.openEdges, 0, 'rotation keeps the mesh closed');
  assert.ok(a.volume > 0, 'rotation keeps outward winding');
  near(a.min, [0, 0, 0], 'part sits on the bed');
  near(a.max, [300, p.height, p.depth], 'profile on the bed, depth along Z');

  const stl = G.toBinarySTL(printMesh.positions);
  const view = new DataView(stl);
  assert.equal(view.getUint32(80, true), mesh.triangles, 'STL triangle count');
  assert.equal(stl.byteLength, 84 + mesh.triangles * 50, 'STL byte length');
  const nz = view.getFloat32(84 + 8, true);
  assert.ok(Math.abs(Math.hypot(view.getFloat32(84, true), view.getFloat32(88, true), nz) - 1) < 1e-5, 'unit facet normal');
});
