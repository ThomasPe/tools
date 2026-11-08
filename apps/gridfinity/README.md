# Gridfinity Tool Slot Studio 🛠️

A modern, high-performance, client-side web application for generating custom-shaped Gridfinity bins (rectangles, L-shapes, T-shapes, U-shapes) with precision STL tool slot cutouts for shadow foam and custom drawer organizers.

Powered by **libmanifold (`manifold-3d`) WebAssembly** and **Three.js**.

---

## ✨ Features

- **2D Polyomino Grid Footprint**:
  - Interactive grid editor to design custom continuous bins (1×1, 1×2, 2×2, L-shapes, T-shapes, U-shapes).
  - Automatically calculates outer contours with standard Gridfinity $R = 3.75\text{ mm}$ rounded corner fillets and $0.25\text{ mm}$ clearance margin.
  - Generates standard $42\text{ mm}$ base stacking profiles for every active tile.
- **Parametric Bin Height & Options**:
  - Gridfinity standard units ($1U = 7\text{ mm}$) or exact millimetre specification.
  - Flush top rim (optimized for tool drawers) or standard Gridfinity stacking lip.
  - Solid infill block (for tool slot carving) or hollow pocket mode with customizable floor thickness.
  - 4× $6.5\text{ mm} \times 2.4\text{ mm}$ magnet sockets per base tile.
- **Tool Cutout & 3D Interactive Positioning**:
  - Drag-and-drop user STL file upload (or choose from built-in tool samples: Caliper, Wrench, Hex bit).
  - 3D Interactive **TransformControls Gizmo**: move, rotate, and scale the tool directly inside the 3D viewport.
  - Exact numerical sliders for $X, Y, Z$ positions and $R_x, R_y, R_z$ rotations.
  - Quick action buttons: **Center on Bin** and **Drop to Top Surface**.
- **Fit & Clearance (Scaling)**:
  - Clearance scaling slider ($100\%$ to $115\%$, default $102\%$ recommended for 3D printer tolerances).
- **Slot Ergonomics**:
  - **Extrude to Top (Remove Undercuts)**: Builds the pocket from a minimum-z depth map of the tool (the "shadow foam" approach), so every overhang, flange or collar is swept up to the bin top (stacking lip included) and the tool drops in and pulls out vertically. The raster is conservative: nothing thinner than a cell can be missed, through-holes are filled so no posts remain, and the pocket never intersects the tool (it widens by at most ~0.2 mm at vertical walls). Choose a 3D contoured cradle or a flat 2.5D floor. Because no boolean on the tool itself is needed, non-watertight scans work in this mode.
  - **Finger Pull Notches**: Parametric cylindrical side cutouts (Left/Right, Front/Back, or all 4 sides) for easy fingertip removal.
- **Watertight Binary STL Export**:
  - Sub-second CSG boolean difference using `manifold-3d`, running in a dedicated Web Worker so the UI never freezes; a WASM memory trap restarts the worker automatically.
  - Watertight 2-manifold output guaranteed compatible with Bambu Studio, PrusaSlicer, OrcaSlicer, and Cura.
  - Zero server dependencies: 100% runs on your device in the browser.

---

## 🚀 Getting Started

### 1. Requirements
- Node.js (v18+)
- pnpm (or npm / yarn)

### 2. Install & Start Development Server
```bash
cd apps/gridfinity
pnpm install
pnpm dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 3. Build Production Bundle
```bash
pnpm run build
pnpm run preview
```

### 4. Geometry Tests
The geometry modules are plain TypeScript and run in Node (type stripping, Node 22+) against the real `manifold-3d` WASM. From the repository root:
```bash
npm test
```
`test/test-gridfinity-geometry.mjs` probes the generated solids with booleans: no material above overhangs, no posts in through-holes, no intersection with the tool, stacking lip opened above the pocket.

---

## 🏗️ Architecture

```
gridfinity-tool-slot/
├── src/
│   ├── geometry/
│   │   ├── gridfinity.ts        # Gridfinity standard specification & polyomino generator
│   │   ├── heightfield.ts       # Depth-map (lower envelope) construction of drop-in pockets, pure TS
│   │   ├── meshUtils.ts         # Mesh conversion, drop-in cutter, notches, clearance, binary STL
│   │   ├── csgPipeline.ts       # Bin + cutout pipeline on plain arrays (worker and Node tests)
│   │   ├── csg.worker.ts        # Web Worker owning the Manifold WASM instance
│   │   ├── csgClient.ts         # Promise API for the worker with automatic restart after WASM traps
│   │   ├── csgProtocol.ts       # Worker message types
│   │   ├── scope.ts             # Ownership helper that releases WASM objects, also on exceptions
│   │   └── sampleTools.ts       # Built-in sample tools (Caliper, Wrench, Hex bit)
│   ├── components/
│   │   ├── GridEditor.tsx       # 2D interactive tile matrix & polyomino presets
│   │   ├── BinParameters.tsx    # Height, magnet sockets, lip, & infill controls
│   │   ├── ToolCutoutControls.tsx # STL upload, 3D transform, fit scale, notches
│   │   └── Viewport3D.tsx       # Three.js canvas, OrbitControls, & 3D Transform Gizmo
│   ├── types.ts                 # TypeScript type interfaces
│   ├── App.tsx                  # Main application state and CSG pipeline coordinator
│   └── main.tsx                 # React entry point
└── public/
    └── manifold.wasm            # WebAssembly geometry kernel
```
