// Geometry tests for the Gridfinity tool-slot generator.
//
// They run the real pipeline (manifold-3d WASM + the app's TypeScript geometry modules, loaded
// through Node's built-in type stripping) and probe the resulting solids with boolean checks:
// the bin must have no material where the tool is, no material above overhangs, and no posts
// inside through-holes. Requires `pnpm --dir apps/gridfinity install` first.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'apps', 'gridfinity');
const depsInstalled = fs.existsSync(path.join(appDir, 'node_modules', 'manifold-3d'));

const geometryUrl = name => pathToFileURL(path.join(appDir, 'src', 'geometry', name)).href;

let mod = null;
let gridfinity, heightfield, meshUtils, pipeline, scope;

async function setup() {
  if (!depsInstalled) return false;
  if (mod) return true;
  const { default: Module } = await import(pathToFileURL(path.join(appDir, 'node_modules', 'manifold-3d', 'manifold.js')).href);
  mod = await Module();
  mod.setup();
  gridfinity = await import(geometryUrl('gridfinity.ts'));
  heightfield = await import(geometryUrl('heightfield.ts'));
  meshUtils = await import(geometryUrl('meshUtils.ts'));
  pipeline = await import(geometryUrl('csgPipeline.ts'));
  scope = await import(geometryUrl('scope.ts'));
  return true;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const BIN_28MM = {
  heightUnits: 4,
  customHeightMm: 28,
  useCustomHeight: false,
  magnetHoles: false,
  lipType: 'none',
  interiorMode: 'solid',
  floorThickness: 5.0
};

const identityTransform = (z = 0) => ({ position: [0, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1], uniformScale: true });

function cutoutConfig(overrides = {}) {
  return {
    fileName: 'test.stl',
    transform: identityTransform(),
    extrudeToTop: true,
    extrudeMode: 'contour',
    notches: { enabled: false, placement: 'none', radius: 8, depth: 12 },
    smoothing: { enabled: false, tolerance: 2.0, surfaceIterations: 0 },
    ...overrides
  };
}

/** Manifold -> plain arrays, as the app would receive an uploaded STL. */
function toMeshArrays(manifold) {
  return meshUtils.manifoldToMeshArrays(manifold);
}

function meshToManifold(mesh) {
  const m = new mod.Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.positions), triVerts: new Uint32Array(mesh.indices) });
  m.merge();
  return new mod.Manifold(m);
}

/** Volume of (solid ∩ probe). */
function overlap(solid, probe) {
  const inter = mod.Manifold.intersection(solid, probe);
  const v = inter.volume();
  inter.delete();
  return v;
}

/**
 * Interference between the bin and the tool lifted by 20 µm. The lift avoids exactly coincident
 * faces (tool bottom on pocket floor), which the boolean kernel resolves as hair-thin slivers.
 */
function interference(bin, tool) {
  const lifted = tool.translate([0, 0, 0.02]);
  const v = overlap(bin, lifted);
  lifted.delete();
  return v;
}

function annulus(rInner, rOuter, z0, z1) {
  return mod.Manifold.difference(
    mod.Manifold.cylinder(z1 - z0, rOuter, rOuter, 64, false),
    mod.Manifold.cylinder(z1 - z0, rInner, rInner, 64, false)
  ).translate([0, 0, z0]);
}

test('scope: dispose deletes tracked objects, released objects survive', async t => {
  if (!(await setup())) return t.skip('apps/gridfinity dependencies not installed');
  const deleted = [];
  const make = name => ({ delete: () => deleted.push(name) });
  const kept = scope.withScope(s => {
    s.track(make('a'));
    const b = s.track(make('b'));
    s.drop(s.track(make('c')));
    assert.deepEqual(deleted, ['c']);
    return s.release(b);
  });
  assert.deepEqual(deleted, ['c', 'a']);
  kept.delete();
  assert.deepEqual(deleted, ['c', 'a', 'b']);

  assert.throws(() => scope.withScope(s => { s.track(make('x')); throw new Error('boom'); }), /boom/);
  assert.equal(deleted.at(-1), 'x', 'objects are released even when the scope throws');
});

test('bin: 1x1 solid bin has the Gridfinity footprint and height', async t => {
  if (!(await setup())) return t.skip('apps/gridfinity dependencies not installed');
  const bin = gridfinity.generateGridfinityBin(mod, [{ x: 0, y: 0 }], BIN_28MM);
  assert.equal(bin.status(), 'NoError');
  const box = bin.boundingBox();
  assert.ok(Math.abs(box.max[0] - box.min[0] - 41.5) < 0.05, 'width 42 - 2 x 0.25 clearance');
  assert.ok(Math.abs(box.max[1] - box.min[1] - 41.5) < 0.05, 'depth 42 - 2 x 0.25 clearance');
  assert.ok(Math.abs(box.min[2]) < 1e-6 && Math.abs(box.max[2] - 28) < 1e-6, 'z from 0 to 28 mm');
  assert.ok(bin.volume() > 0.9 * 41.5 * 41.5 * (28 - 4.75), 'solid body above the base profile');
  bin.delete();
});

test('bin: stacking lip raises the bin top by 4.4 mm and getBinTopZ reports it', async t => {
  if (!(await setup())) return t.skip('apps/gridfinity dependencies not installed');
  const config = { ...BIN_28MM, lipType: 'stackable' };
  assert.equal(gridfinity.getBinBodyHeight(config), 28);
  assert.equal(gridfinity.getBinTopZ(config), 28 + gridfinity.LIP_HEIGHT);
  const bin = gridfinity.generateGridfinityBin(mod, [{ x: 0, y: 0 }], config);
  assert.ok(Math.abs(bin.boundingBox().max[2] - 32.4) < 1e-6);
  bin.delete();
});

test('bin: magnet holes remove material from the base', async t => {
  if (!(await setup())) return t.skip('apps/gridfinity dependencies not installed');
  const plain = gridfinity.generateGridfinityBin(mod, [{ x: 0, y: 0 }], BIN_28MM);
  const magnets = gridfinity.generateGridfinityBin(mod, [{ x: 0, y: 0 }], { ...BIN_28MM, magnetHoles: true });
  const removed = plain.volume() - magnets.volume();
  const expected = 4 * Math.PI * 3.25 * 3.25 * 2.5;
  assert.ok(removed > 0.9 * expected && removed < 1.05 * expected, `removed ${removed.toFixed(1)} mm³, expected ~${expected.toFixed(1)}`);
  plain.delete(); magnets.delete();
});

test('depth map: thin flange between raster rows is never missed (undercut removed)', async t => {
  if (!(await setup())) return t.skip('apps/gridfinity dependencies not installed');
  // Shaft r=5 with a 0.8 mm thin flange r=9 at z 10.3..11.1, sitting in a 28 mm bin.
  const tool = mod.Manifold.union([
    mod.Manifold.cylinder(20, 5, 5, 64, false),
    mod.Manifold.cylinder(0.8, 9, 9, 64, false).translate([0, 0, 10.3])
  ]);
  const cutter = meshUtils.createDropInCutter(mod, toMeshArrays(tool), identityTransform(), 28, 'contour');
  assert.ok(cutter, 'cutter is created');
  assert.equal(cutter.status(), 'NoError');

  const binBlock = mod.Manifold.cube([60, 60, 28], true).translate([0, 0, 14]);
  const bin = mod.Manifold.difference(binBlock, cutter);
  // Nothing may remain above the flange (r 5.5..8.5, z 11.5..28) or the tool would be locked in.
  assert.ok(overlap(bin, annulus(5.5, 8.5, 11.5, 28)) < 1e-6, 'no plastic above the flange');
  // The bin must not intersect the tool itself.
  assert.ok(interference(bin, tool) < 0.01, 'tool does not interfere with the bin');
  // Material beside the tool is kept.
  const beside = annulus(12, 14, 0, 28);
  assert.ok(overlap(bin, beside) > 0.98 * beside.volume(), 'walls beside the pocket are kept');
  // The pocket opens through the top (a column above the shaft reaches the bin top).
  assert.ok(overlap(bin, mod.Manifold.cylinder(28, 4, 4, 32, false)) < 1e-6, 'pocket column is open to the top');
  tool.delete(); cutter.delete(); binBlock.delete(); bin.delete();
});

test('depth map: contour mode follows the tool underside, silhouette mode is flat', async t => {
  if (!(await setup())) return t.skip('apps/gridfinity dependencies not installed');
  const sphere = mod.Manifold.sphere(10, 128).translate([0, 0, 15]);
  const mesh = toMeshArrays(sphere);
  const binBlock = mod.Manifold.cube([60, 60, 28], true).translate([0, 0, 14]);

  const contour = meshUtils.createDropInCutter(mod, mesh, identityTransform(), 28, 'contour');
  const binC = mod.Manifold.difference(binBlock, contour);
  const centre = mod.Manifold.cylinder(28, 0.3, 0.3, 8, false);
  const offCentre = centre.translate([8, 0, 0]);
  const floorCentre = mod.Manifold.intersection(binC, centre).boundingBox().max[2];
  const floorOff = mod.Manifold.intersection(binC, offCentre).boundingBox().max[2];
  assert.ok(Math.abs(floorCentre - 5) < 0.05, `floor under the sphere centre at 5 mm (got ${floorCentre.toFixed(2)})`);
  assert.ok(floorOff > 8.5 && floorOff < 9.6, `floor rises towards the rim (got ${floorOff.toFixed(2)})`);
  assert.ok(interference(binC, sphere) < 0.01, 'sphere does not interfere with the bin');

  const silhouette = meshUtils.createDropInCutter(mod, mesh, identityTransform(), 28, 'silhouette');
  const binS = mod.Manifold.difference(binBlock, silhouette);
  const flatOff = mod.Manifold.intersection(binS, offCentre).boundingBox().max[2];
  assert.ok(Math.abs(flatOff - 5) < 0.05, `silhouette floor is flat at the tool's lowest point (got ${flatOff.toFixed(2)})`);
  sphere.delete(); binBlock.delete(); contour.delete(); binC.delete(); silhouette.delete(); binS.delete();
});

test('depth map: through-holes are filled so no post is left inside a ring', async t => {
  if (!(await setup())) return t.skip('apps/gridfinity dependencies not installed');
  const ring = annulus(6, 12, 10, 16);
  const cutter = meshUtils.createDropInCutter(mod, toMeshArrays(ring), identityTransform(), 28, 'contour');
  const binBlock = mod.Manifold.cube([60, 60, 28], true).translate([0, 0, 14]);
  const bin = mod.Manifold.difference(binBlock, cutter);
  const post = mod.Manifold.cylinder(28 - 10.5, 5, 5, 32, false).translate([0, 0, 10.5]);
  assert.ok(overlap(bin, post) < 1e-6, 'no post inside the ring');
  // ...but the floor under the ring opening is kept (filled down to the ring bottom only).
  const under = mod.Manifold.cylinder(9, 5, 5, 32, false);
  assert.ok(overlap(bin, under) > 0.99 * under.volume(), 'floor below the opening is intact');
  ring.delete(); cutter.delete(); binBlock.delete(); bin.delete();
});

test('depth map: a tall tool protruding above the bin keeps full resolution inside it', async t => {
  if (!(await setup())) return t.skip('apps/gridfinity dependencies not installed');
  // 120 mm vertical shaft with a 3 mm collar at z 20..23, bin top at 28.
  const tall = mod.Manifold.union([
    mod.Manifold.cylinder(120, 6, 6, 64, false).translate([0, 0, 4]),
    mod.Manifold.cylinder(3, 12, 12, 64, false).translate([0, 0, 20])
  ]);
  const cutter = meshUtils.createDropInCutter(mod, toMeshArrays(tall), identityTransform(), 28, 'contour');
  const binBlock = mod.Manifold.cube([60, 60, 28], true).translate([0, 0, 14]);
  const bin = mod.Manifold.difference(binBlock, cutter);
  assert.ok(overlap(bin, annulus(6.5, 11.5, 23.5, 28)) < 1e-6, 'no plastic above the collar');
  assert.ok(interference(bin, tall) < 0.01, 'shaft does not interfere');
  assert.ok(cutter.boundingBox().max[2] < 40, 'cutter stops shortly above the bin top instead of following the tool');
  tall.delete(); cutter.delete(); binBlock.delete(); bin.delete();
});

test('depth map: the raster never misses a feature thinner than a cell', async t => {
  if (!(await setup())) return t.skip('apps/gridfinity dependencies not installed');
  // A 0.1 mm wide fin, 10 mm long, placed off-grid, must still appear in the map.
  const fin = mod.Manifold.cube([0.1, 10, 5], true).translate([3.07, 0.03, 10]);
  const mesh = toMeshArrays(fin);
  const map = heightfield.rasterizeDepthMap(mesh.positions, mesh.indices, IDENTITY, { resolution: 0.2 });
  assert.ok(map.hasTool);
  let covered = 0;
  for (const v of map.minZ) if (v !== Infinity) covered++;
  assert.ok(covered >= 2 * 50, `fin covers a strip of grid points (got ${covered})`);
  fin.delete();
});

test('pipeline: stacking lip is opened above the pocket (cutter reaches above the lip)', async t => {
  if (!(await setup())) return t.skip('apps/gridfinity dependencies not installed');
  const config = { ...BIN_28MM, lipType: 'stackable' };
  // Tool: 30 x 10 x 10 block whose silhouette overlaps the 2 mm lip ring on the +x side.
  const block = mod.Manifold.cube([30, 10, 10], true);
  const tool = toMeshArrays(block);
  const toolCutout = cutoutConfig({ transform: { ...identityTransform(15), position: [5, 0, 15] } });
  const { mesh } = pipeline.buildCutoutMesh(mod, { cells: [{ x: 0, y: 0 }], binConfig: config, toolCutout, tool });
  const result = meshToManifold(mesh);
  assert.equal(result.status(), 'NoError');
  // Column through the pocket from the tool bottom up through the lip must be empty.
  const column = mod.Manifold.cube([28, 8, 32.4 - 10.5], false).translate([-9, -4, 10.5]);
  assert.ok(overlap(result, column) < 1e-6, 'no lip ledge left above the pocket');
  block.delete(); result.delete();
});

test('pipeline: worker-equivalent cutout returns a watertight mesh with the pocket open to the top', async t => {
  if (!(await setup())) return t.skip('apps/gridfinity dependencies not installed');
  const wrench = mod.Manifold.union([
    mod.Manifold.cube([70, 8, 4], true),
    mod.Manifold.cylinder(4, 10, 10, 32, true).translate([35, 0, 0]),
    mod.Manifold.cylinder(4, 8, 8, 32, true).translate([-35, 0, 0])
  ]);
  const tool = toMeshArrays(wrench);
  const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  const toolCutout = cutoutConfig({
    transform: identityTransform(20),
    notches: { enabled: true, placement: 'left-right', radius: 8, depth: 12 }
  });
  const { mesh, triangles } = pipeline.buildCutoutMesh(mod, { cells, binConfig: BIN_28MM, toolCutout, tool });
  assert.equal(triangles, mesh.indices.length / 3);
  const result = meshToManifold(mesh);
  assert.equal(result.status(), 'NoError');
  assert.equal(result.genus(), 0, 'single closed shell');
  const binOnly = gridfinity.generateGridfinityBin(mod, cells, BIN_28MM);
  assert.ok(result.volume() < binOnly.volume() - 0.9 * wrench.volume(), 'at least the tool volume was removed');
  // Finger notches at the tool's x extremes cut into the bin top.
  const notchProbe = mod.Manifold.cylinder(5, 3, 3, 16, false).translate([45, 0, 22]);
  assert.ok(overlap(result, notchProbe) < 1e-6, 'right finger notch is cut');
  wrench.delete(); result.delete(); binOnly.delete();

  // Binary STL serialisation matches the triangle count.
  const stl = meshUtils.meshArraysToBinarySTL(mesh);
  assert.equal(new DataView(stl).getUint32(80, true), triangles);
  assert.equal(stl.byteLength, 84 + triangles * 50);
});

test('pipeline: exact (non drop-in) cutout still works for watertight tools', async t => {
  if (!(await setup())) return t.skip('apps/gridfinity dependencies not installed');
  const ball = mod.Manifold.sphere(6, 32);
  const tool = toMeshArrays(ball);
  const toolCutout = cutoutConfig({ extrudeToTop: false, transform: identityTransform(15) });
  const { mesh } = pipeline.buildCutoutMesh(mod, { cells: [{ x: 0, y: 0 }], binConfig: BIN_28MM, toolCutout, tool });
  const result = meshToManifold(mesh);
  const binOnly = gridfinity.generateGridfinityBin(mod, [{ x: 0, y: 0 }], BIN_28MM);
  const removed = binOnly.volume() - result.volume();
  const ballMoved = ball.translate([0, 0, 15]);
  assert.ok(Math.abs(removed - ballMoved.volume()) < 1, 'exactly the ball volume is removed (enclosed cavity)');
  ball.delete(); result.delete(); binOnly.delete(); ballMoved.delete();
});
