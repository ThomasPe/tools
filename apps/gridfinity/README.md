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
  - **Extrude to Top (Remove Undercuts)**: Automatically sweeps the tool's upward silhouette to the bin top surface so tools with bulges/overhangs drop in and pull out vertically without getting locked in.
  - **Finger Pull Notches**: Parametric cylindrical side cutouts (Left/Right, Front/Back, or all 4 sides) for easy fingertip removal.
- **Watertight Binary STL Export**:
  - Sub-second CSG boolean difference using `manifold-3d`.
  - Watertight 2-manifold output guaranteed compatible with Bambu Studio, PrusaSlicer, OrcaSlicer, and Cura.
  - Zero server dependencies: 100% runs on your device in the browser.

---

## 🚀 Getting Started

### 1. Requirements
- Node.js (v18+)
- pnpm (or npm / yarn)

### 2. Install & Start Development Server
```bash
cd apps/gridfinity-tool-slot
pnpm install
pnpm dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 3. Build Production Bundle
```bash
pnpm run build
pnpm run preview
```

---

## 🏗️ Architecture

```
gridfinity-tool-slot/
├── src/
│   ├── geometry/
│   │   ├── gridfinity.ts        # Gridfinity standard specification & polyomino generator
│   │   ├── meshUtils.ts         # Three.js <-> Manifold mesh converter & binary STL exporter
│   │   ├── manifoldInit.ts      # Manifold WASM singleton initializer
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
