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
function assertSimpleOutline(loop, label) {
  const n = loop.length;
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
}

function assertSoundProfile(profile, label) {
  assertSimpleOutline(profile.loop, label);
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

  const controls = ['length', 'count', 'depth', 'height', 'angle', 'radius', 'flank', 'plateau', 'ripple', 'rippleSpacing', 'wall', 'endFoot'];
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

test('ripples groove the outside of the walls without changing floors, height or length', () => {
  const smooth = custom([10, 18, 30], { endFoot: 10 });
  const rippled = { ...smooth, ripple: 0.8, rippleSpacing: 6 };
  const a = G.buildProfile(smooth), b = G.buildProfile(rippled);
  assertSoundProfile(b, 'rippled');
  assert.ok(Math.abs(b.length - a.length) < 1e-9, 'same length');
  near(measuredFloors(rippled, b), rippled.slots, 'floors stay flat and as wide as stated', 5e-3);
  const xs = b.loop.map(q => q[0]), zs = b.loop.map(q => q[1]);
  assert.ok(Math.abs(Math.max(...zs) - rippled.height) < 1e-9, 'walls keep their full height');
  assert.ok(Math.abs(Math.min(...zs)) < 1e-9, 'still sits on the ground');
  assert.ok(Math.abs(Math.min(...xs)) < 1e-9 && Math.abs(Math.max(...xs) - b.length) < 1e-9, 'ends are untouched');
  assert.ok(b.area < a.area - 20, 'grooves remove material');
  assert.ok(b.loop.length > a.loop.length * 3, 'walls are sampled finely enough for the grooves');

  // Mirror symmetry and a watertight mesh, also on slim walls that are solid near the top.
  for (const p of [
    { ...G.DEFAULTS, ripple: 1, rippleSpacing: 5 },
    custom([24, 24], { angle: 6, radius: 3, wall: 4, endFoot: 12, ripple: 1.2, rippleSpacing: 4 }),
    custom([0, 20, 0], { style: 'sine', flank: 12, height: 80, ripple: 1.5, rippleSpacing: 3 }),
    custom([14], { angle: 22, radius: 4, plateau: 20, ripple: 0.6, rippleSpacing: 3.5 })
  ]) {
    const res = G.resolve(p);
    assert.deepEqual(res.errors, [], JSON.stringify(p));
    const mesh = G.buildMesh(p, res);
    assertSoundProfile(mesh.profile, JSON.stringify(p));
    const m = analyze(mesh);
    assert.equal(m.openEdges, 0, `watertight: ${JSON.stringify(p)}`);
    assert.equal(m.degenerate, 0, `no degenerate triangles: ${JSON.stringify(p)}`);
    near(m.max, [res.length, p.depth, p.height], `bounds: ${JSON.stringify(p)}`);
    const fmt = (q) => `${q[0].toFixed(4)},${q[1].toFixed(4)}`;
    const points = new Set(mesh.profile.loop.map(fmt));
    for (const q of mesh.profile.loop) assert.ok(points.has(fmt([res.length - q[0], q[1]])), `mirror image of ${fmt(q)} is on the outline`);
  }

  assert.deepEqual(G.buildProfile({ ...smooth, ripple: 0, rippleSpacing: 3 }).loop, a.loop, 'depth 0 leaves the profile untouched');
  assert.ok(G.validate({ ...G.DEFAULTS, ripple: 4 }).errors.some(e => e.includes('1.5 mm must remain')), 'grooves may not eat the wall');
  assert.ok(G.validate({ ...G.DEFAULTS, ripple: 2, rippleSpacing: 3 }).errors.some(e => e.includes('half as deep')), 'grooves may not be deeper than half their spacing');
  assert.ok(G.validate({ ...G.DEFAULTS, ripple: 0.5, rippleSpacing: 1 }).errors.some(e => e.includes('at least 2 mm')));
});

test('ripples can cover the slot floors and can run along the length', () => {
  const base = custom([18, 30, 18], { endFoot: 10, depth: 36, ripple: 0.8, rippleSpacing: 6 });
  const smooth = G.buildProfile({ ...base, ripple: 0 });
  const f4 = (v) => (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4);   // no "-0.0000"
  const mirrored = (profile, label) => {
    const fmt = (q) => `${f4(q[0])},${f4(q[1])}`;
    const points = new Set(profile.loop.map(fmt));
    for (const q of profile.loop) assert.ok(points.has(fmt([profile.length - q[0], q[1]])), `${label}: mirror image of ${fmt(q)} is on the outline`);
  };

  // Front to back, floors included: the grooves are part of the profile.
  const cross = { ...base, rippleFloors: true };
  const wallsOnly = G.buildProfile(base), withFloors = G.buildProfile(cross);
  assertSoundProfile(withFloors, 'cross + floors');
  assert.equal(withFloors.lengthwise, null);
  assert.ok(withFloors.area < wallsOnly.area - 5, 'floor grooves remove material');
  near(measuredFloors(cross, withFloors), cross.slots, 'floors keep their width, measured between the outer ridges', 5e-3);
  withFloors.floorSpans.forEach(([a, b], k) => {
    const pts = withFloors.top.filter(q => q[0] > a + 1e-6 && q[0] < b - 1e-6 && q[1] < cross.wall + 1e-6);
    const lowest = Math.min(...pts.map(q => q[1]));
    assert.ok(Math.abs(lowest - (cross.wall - 0.8)) < 0.02, `floor ${k} is grooved to the ripple depth (${lowest})`);
    assert.ok(pts.every(q => q[1] <= cross.wall + 1e-9), `floor ${k} never rises above its level`);
  });
  mirrored(withFloors, 'cross + floors');
  const crossMesh = analyze(G.buildMesh(cross));
  assert.equal(crossMesh.openEdges, 0);
  assert.equal(crossMesh.degenerate, 0);

  // Along the length: the outline stays smooth, the mesh varies along the depth.
  for (const floors of [false, true]) {
    const p = { ...base, rippleDir: 'along', rippleFloors: floors };
    const label = `along${floors ? ' + floors' : ''}`;
    const res = G.resolve(p);
    assert.deepEqual(res.errors, [], label);
    const mesh = G.buildMesh(p, res);
    const profile = mesh.profile, lw = profile.lengthwise;
    // The outline is the smooth one, with extra points on its chords where the grooves fade.
    assert.ok(Math.abs(profile.area - smooth.area) < 1e-9, `${label}: same outline area as the smooth rack`);
    const outline = new Set(profile.loop.map(q => `${f4(q[0])},${f4(q[1])}`));
    for (const q of smooth.loop) assert.ok(outline.has(`${f4(q[0])},${f4(q[1])}`), `${label}: smooth outline point kept`);
    assert.ok(lw, `${label}: lengthwise data present`);
    assert.equal(lw.periods, 6);
    assert.ok(Math.abs(lw.spacing - 6) < 1e-9);

    // The deepest cross-section is a valid outline that is cut by the ripple depth at most.
    const deep = profile.loop.map((q, i) => (lw.shift[i] ? [q[0] + lw.shift[i][0], q[1] + lw.shift[i][1]] : q));
    assertSimpleOutline(deep, `${label}: deepest section`);
    const lengths = lw.shift.filter(Boolean).map(v => Math.hypot(v[0], v[1]));
    assert.ok(Math.max(...lengths) <= Math.SQRT2 * 0.8 + 1e-9, `${label}: corners are cut along their mitre at most`);
    assert.ok(lengths.some(v => Math.abs(v - 0.8) < 1e-9), `${label}: full depth is reached`);
    profile.loop.forEach((q, i) => {
      const onFloor = Math.abs(q[1] - p.wall) < 1e-9 && profile.floorSpans.some(([a, b]) => q[0] > a + 0.5 && q[0] < b - 0.5);
      if (onFloor) assert.equal(!!lw.shift[i], floors, `${label}: floor point at x = ${q[0].toFixed(2)}`);
      if (q[1] < 1e-9) assert.equal(lw.shift[i], null, `${label}: the underside is never grooved`);
    });
    const fmt = (q, v) => `${f4(q[0])},${f4(q[1])},${f4(v ? v[0] : 0)},${f4(v ? v[1] : 0)}`;
    const moved = new Set(profile.loop.map((q, i) => fmt(q, lw.shift[i])));
    profile.loop.forEach((q, i) => {
      const v = lw.shift[i];
      assert.ok(moved.has(fmt([profile.length - q[0], q[1]], v && [-v[0], v[1]])), `${label}: grooves are mirror symmetric`);
    });

    const m = analyze(mesh);
    assert.equal(m.openEdges, 0, `${label}: watertight`);
    assert.equal(m.degenerate, 0, `${label}: no degenerate triangles`);
    near(m.min, [0, 0, 0], `${label}: bounds`);
    near(m.max, [res.length, p.depth, p.height], `${label}: bounds`);
    assert.ok(Math.abs(m.volume - mesh.volume) < 1e-4 * mesh.volume, `${label}: reported volume matches the mesh`);
    assert.ok(mesh.volume < smooth.area * p.depth - 50, `${label}: grooves remove material`);
    assert.equal(mesh.triangles, mesh.positions.length / 9);

    // Front and back faces are the plain profile, and in print (depth is up)
    // no face overhangs by more than 45 degrees.
    const pos = mesh.positions;
    let frontArea = 0, worst = 0;
    for (let i = 0; i < pos.length; i += 9) {
      const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
      const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz);
      if (pos[i + 1] === 0 && pos[i + 4] === 0 && pos[i + 7] === 0) { frontArea += len / 2; continue; }
      worst = Math.max(worst, -ny / len);
    }
    assert.ok(Math.abs(frontArea - smooth.area) < 1e-3, `${label}: the first layer is the full profile`);
    assert.ok(worst <= Math.sin(45.5 * Math.PI / 180), `${label}: overhang ${(Math.asin(worst) * 180 / Math.PI).toFixed(1)}°`);
  }

  // Without floors fewer points are grooved than with them.
  const count = (floors) => G.buildProfile({ ...base, rippleDir: 'along', rippleFloors: floors }).lengthwise.shift.filter(Boolean).length;
  assert.ok(count(true) > count(false));

  // Lengthwise grooves are limited by the overhang they cause in print.
  const steep = G.validate({ ...G.DEFAULTS, ripple: 2.4, rippleSpacing: 6, rippleDir: 'along' });
  assert.ok(steep.errors.some(e => e.includes('at most 1.9 mm') && e.includes('supports')), 'too deep for a 45° overhang');
  assert.deepEqual(G.validate({ ...G.DEFAULTS, ripple: 1.9, rippleSpacing: 6, rippleDir: 'along' }).errors, []);
  assert.deepEqual(G.validate({ ...G.DEFAULTS, ripple: 2.4, rippleSpacing: 6 }).errors, [], 'front-to-back grooves have no overhang limit');
});

test('ripples can cover the underside and can be shaped like rolls', () => {
  const base = custom([18, 30, 18], { endFoot: 10, depth: 36, wall: 6, ripple: 1, rippleSpacing: 6 });
  const smooth = G.buildProfile({ ...base, ripple: 0 });
  const f4 = (v) => (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const overhang = (mesh) => {
    const pos = mesh.positions;
    let worst = 0;
    for (let i = 0; i < pos.length; i += 9) {
      const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
      const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (pos[i + 1] === 0 && pos[i + 4] === 0 && pos[i + 7] === 0) continue;
      worst = Math.max(worst, -ny / Math.hypot(nx, ny, nz));
    }
    return Math.asin(worst) * 180 / Math.PI;
  };

  // Front to back: the underside is grooved in step with the top.
  for (const shape of ['soft', 'round']) for (const floors of [false, true]) {
    const p = { ...base, rippleBoth: true, rippleShape: shape, rippleFloors: floors };
    const label = `cross, both sides, ${shape}${floors ? ', floors' : ''}`;
    const res = G.resolve(p);
    assert.deepEqual(res.errors, [], label);
    const mesh = G.buildMesh(p, res), profile = mesh.profile;
    assertSoundProfile(profile, label);
    const oneSided = G.buildProfile({ ...p, rippleBoth: false });
    assert.ok(profile.area < oneSided.area - 10, `${label}: the underside loses material too`);
    assert.equal(profile.top.length, profile.bottom.length);
    const thickness = profile.top.map((t, i) => dist(t, profile.bottom[i]));
    assert.ok(Math.min(...thickness) > p.wall - 2 * p.ripple - 1e-6, `${label}: never thinner than wall minus both grooves`);
    assert.ok(Math.min(...thickness) < p.wall - 2 * p.ripple + 0.05, `${label}: grooves of both sides meet at the same place`);
    const zs = profile.loop.map(q => q[1]);
    assert.ok(Math.abs(Math.min(...zs)) < 1e-9 && Math.abs(Math.max(...zs) - p.height) < 1e-9, `${label}: height unchanged`);
    near(measuredFloors(p, profile), p.slots, `${label}: floor widths`, 5e-3);
    const points = new Set(profile.loop.map(q => `${f4(q[0])},${f4(q[1])}`));
    for (const q of profile.loop) assert.ok(points.has(`${f4(profile.length - q[0])},${f4(q[1])}`), `${label}: mirror symmetric`);
    const underFloor = profile.bottom.filter(q => profile.floorSpans.some(([a, b]) => q[0] > a + 1 && q[0] < b - 1));
    assert.equal(underFloor.some(q => q[1] > 0.5), floors, `${label}: the floor underside is grooved only with the floor option`);
    const m = analyze(mesh);
    assert.equal(m.openEdges, 0, `${label}: watertight`);
    assert.equal(m.degenerate, 0, `${label}: no degenerate triangles`);
  }

  // Round ridges remove less material than soft waves of the same depth and
  // meet in a crease: the outline turns sharply at the bottom of a groove.
  const soft = G.buildProfile({ ...base, rippleShape: 'soft' }), round = G.buildProfile({ ...base, rippleShape: 'round' });
  assertSoundProfile(round, 'round');
  assert.ok(round.area > soft.area + 5 && round.area < smooth.area - 5, 'round ridges keep more material than soft waves');
  const sharpest = (profile) => {
    let worst = 0;
    const t = profile.top;
    for (let i = 1; i < t.length - 1; i++) {
      const a = [t[i][0] - t[i - 1][0], t[i][1] - t[i - 1][1]], b = [t[i + 1][0] - t[i][0], t[i + 1][1] - t[i][1]];
      const la = Math.hypot(a[0], a[1]), lb = Math.hypot(b[0], b[1]);
      if (la < 1e-6 || lb < 1e-6 || t[i][1] < base.wall + 15) continue;        // walls only, away from the floor corners
      worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb)))) * 180 / Math.PI);
    }
    return worst;
  };
  assert.ok(sharpest(round) > 25, `round grooves have a crease (${sharpest(round).toFixed(1)}°)`);
  assert.ok(sharpest(soft) < 15, `soft grooves have none (${sharpest(soft).toFixed(1)}°)`);

  // Along the length: the underside moves up where the top moves down.
  for (const shape of ['soft', 'round']) {
    const p = { ...base, rippleDir: 'along', rippleBoth: true, rippleFloors: true, rippleShape: shape };
    const label = `along, both sides, ${shape}`;
    const res = G.resolve(p);
    assert.deepEqual(res.errors, [], label);
    const mesh = G.buildMesh(p, res), lw = mesh.profile.lengthwise;
    assert.equal(lw.shape, shape);
    const loop = mesh.profile.loop;
    const up = loop.filter((q, i) => lw.shift[i] && lw.shift[i][1] > 0.5), down = loop.filter((q, i) => lw.shift[i] && lw.shift[i][1] < -0.5);
    assert.ok(up.length > 10 && down.length > 10, `${label}: both sides are grooved`);
    assert.ok(up.some(q => q[1] < 1e-9), `${label}: the floor underside is grooved`);
    const deep = loop.map((q, i) => (lw.shift[i] ? [q[0] + lw.shift[i][0], q[1] + lw.shift[i][1]] : q));
    assertSimpleOutline(deep, `${label}: deepest section`);
    const m = analyze(mesh);
    assert.equal(m.openEdges, 0, `${label}: watertight`);
    assert.equal(m.degenerate, 0, `${label}: no degenerate triangles`);
    near(m.min, [0, 0, 0], `${label}: bounds`);
    near(m.max, [res.length, p.depth, p.height], `${label}: bounds`);
    assert.ok(Math.abs(m.volume - mesh.volume) < 1e-4 * mesh.volume, `${label}: volume`);
    const oneSided = G.buildMesh({ ...p, rippleBoth: false });
    assert.ok(mesh.volume < oneSided.volume - 100, `${label}: the underside loses material too`);
    assert.ok(overhang(mesh) <= 45.5, `${label}: overhang ${overhang(mesh).toFixed(1)}°`);
  }

  // Limits: both sides share the wall, round grooves are steeper than soft ones.
  assert.ok(G.validate({ ...G.DEFAULTS, ripple: 2, rippleBoth: true }).errors.some(e => e.includes('both sides') && e.includes('at most 1.7 mm')));
  assert.deepEqual(G.validate({ ...G.DEFAULTS, ripple: 1.7, rippleBoth: true }).errors, []);
  const steep = G.validate({ ...G.DEFAULTS, ripple: 1.5, rippleSpacing: 6, rippleDir: 'along', rippleShape: 'round' });
  assert.ok(steep.errors.some(e => e.includes('at most 1.2 mm') && e.includes('supports')), 'round lengthwise grooves are limited earlier');
  assert.deepEqual(G.validate({ ...G.DEFAULTS, ripple: 1.5, rippleSpacing: 6, rippleDir: 'along' }).errors, []);
  assert.deepEqual(G.validate({ ...G.DEFAULTS, ripple: 1.2, rippleSpacing: 6, rippleDir: 'along', rippleShape: 'round' }).errors, []);
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
