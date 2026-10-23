import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { ToolTransform } from '../types';
import { Move, RotateCw, Maximize, Eye, Grid3X3, Focus } from 'lucide-react';

interface Viewport3DProps {
  binGeometry: THREE.BufferGeometry | null;
  toolGeometry: THREE.BufferGeometry | null;
  csgGeometry: THREE.BufferGeometry | null;
  notchesGeometry: THREE.BufferGeometry | null;
  extrudePreviewGeometry?: THREE.BufferGeometry | null;
  isPreviewCSG: boolean;
  onTogglePreviewCSG: (preview: boolean) => void;
  toolTransform: ToolTransform;
  onTransformChange: (transform: ToolTransform) => void;
  isComputing: boolean;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  binGeometry,
  toolGeometry,
  csgGeometry,
  notchesGeometry,
  extrudePreviewGeometry,
  isPreviewCSG,
  onTogglePreviewCSG,
  toolTransform,
  onTransformChange,
  isComputing,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [showWireframe, setShowWireframe] = useState(false);

  // Three.js internal references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);

  // Mesh refs
  const binMeshRef = useRef<THREE.Mesh | null>(null);
  const toolMeshRef = useRef<THREE.Mesh | null>(null);
  const csgMeshRef = useRef<THREE.Mesh | null>(null);
  const notchesMeshRef = useRef<THREE.Mesh | null>(null);
  const extrudePreviewMeshRef = useRef<THREE.Mesh | null>(null);
  const toolPivotRef = useRef<THREE.Group | null>(null);

  // Initialize Scene, Camera, Lights, Grid
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d16);
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    camera.position.set(120, -180, 160);
    camera.up.set(0, 0, 1); // Z-up is standard in 3D printing
    cameraRef.current = camera;

    // 3. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Orbit Controls
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.target.set(0, 0, 15);
    orbit.update();
    orbitRef.current = orbit;

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight1.position.set(100, -100, 200);
    dirLight1.castShadow = true;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x93c5fd, 0.5);
    dirLight2.position.set(-100, 100, 100);
    scene.add(dirLight2);

    // 6. Gridfinity Ground Grid (42mm grid pitch)
    const gridHelper = new THREE.GridHelper(420, 10, 0x4f46e5, 0x1e293b);
    gridHelper.rotation.x = Math.PI / 2; // Lie flat in XY plane
    scene.add(gridHelper);

    // 7. Pivot group for tool and TransformControls
    const toolPivot = new THREE.Group();
    scene.add(toolPivot);
    toolPivotRef.current = toolPivot;

    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.size = 0.75;
    transformControls.setMode('translate');
    transformControls.attach(toolPivot);
    scene.add(transformControls.getHelper());
    transformControlsRef.current = transformControls;

    // Live update on every single movement of the gizmo
    const syncTransform = () => {
      const p = toolPivot.position;
      const euler = new THREE.Euler().setFromQuaternion(toolPivot.quaternion, 'XYZ');
      const s = toolPivot.scale;
      onTransformChange({
        position: [p.x, p.y, p.z],
        rotation: [
          Math.round(THREE.MathUtils.radToDeg(euler.x)),
          Math.round(THREE.MathUtils.radToDeg(euler.y)),
          Math.round(THREE.MathUtils.radToDeg(euler.z)),
        ],
        scale: [s.x, s.y, s.z],
        uniformScale: toolTransform.uniformScale,
      });
    };

    transformControls.addEventListener('objectChange', syncTransform);

    // Disable orbit while dragging gizmo
    transformControls.addEventListener('dragging-changed', (event) => {
      orbit.enabled = !event.value;
      if (!event.value) {
        syncTransform();
      }
    });

    // Resize handler
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Animation Loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      orbit.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update TransformControls mode
  useEffect(() => {
    if (transformControlsRef.current) {
      transformControlsRef.current.setMode(transformMode);
      // Hide gizmo if CSG preview is active or no tool
      const helper = transformControlsRef.current.getHelper();
      if (helper) {
        helper.visible = !isPreviewCSG && !!toolGeometry;
      }
      transformControlsRef.current.enabled = !isPreviewCSG && !!toolGeometry;
    }
  }, [transformMode, isPreviewCSG, toolGeometry]);

  // Sync toolPivot position & rotation from props
  useEffect(() => {
    if (!toolPivotRef.current) return;
    const pivot = toolPivotRef.current;
    const [tx, ty, tz] = toolTransform.position;
    const [rx, ry, rz] = toolTransform.rotation;
    const [sx, sy, sz] = toolTransform.scale;

    pivot.position.set(tx, ty, tz);
    pivot.rotation.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz)
    );
    const effSy = toolTransform.uniformScale ? sx : sy;
    const effSz = toolTransform.uniformScale ? sx : sz;
    pivot.scale.set(sx, effSy, effSz);
  }, [toolTransform]);

  // Update Bin Mesh
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    if (binMeshRef.current) {
      scene.remove(binMeshRef.current);
      if (Array.isArray(binMeshRef.current.material)) {
        binMeshRef.current.material.forEach(m => m.dispose());
      } else {
        binMeshRef.current.material.dispose();
      }
      binMeshRef.current = null;
    }

    if (binGeometry && !isPreviewCSG) {
      const material = new THREE.MeshStandardMaterial({
        color: 0x0284c7, // Sky blue plastic
        roughness: 0.35,
        metalness: 0.05,
        wireframe: showWireframe,
      });
      const mesh = new THREE.Mesh(binGeometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      binMeshRef.current = mesh;
    }
  }, [binGeometry, isPreviewCSG, showWireframe]);

  // Update Tool Mesh
  useEffect(() => {
    if (!toolPivotRef.current) return;
    const pivot = toolPivotRef.current;

    if (toolMeshRef.current) {
      pivot.remove(toolMeshRef.current);
      if (Array.isArray(toolMeshRef.current.material)) {
        toolMeshRef.current.material.forEach(m => m.dispose());
      } else {
        toolMeshRef.current.material.dispose();
      }
      toolMeshRef.current = null;
    }

    if (toolGeometry && !isPreviewCSG) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xf59e0b, // Amber / Orange ghost
        roughness: 0.2,
        metalness: 0.1,
        transparent: true,
        opacity: 0.8,
        wireframe: showWireframe,
      });
      const mesh = new THREE.Mesh(toolGeometry, material);
      mesh.castShadow = true;
      pivot.add(mesh);
      toolMeshRef.current = mesh;
    }
  }, [toolGeometry, isPreviewCSG, showWireframe]);

  // Update Notches Mesh (Visual representation of finger cutouts)
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    if (notchesMeshRef.current) {
      scene.remove(notchesMeshRef.current);
      if (Array.isArray(notchesMeshRef.current.material)) {
        notchesMeshRef.current.material.forEach(m => m.dispose());
      } else {
        notchesMeshRef.current.material.dispose();
      }
      notchesMeshRef.current = null;
    }

    if (notchesGeometry && !isPreviewCSG) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xf43f5e, // Rose / Red for notch cutters
        roughness: 0.3,
        metalness: 0.1,
        transparent: true,
        opacity: 0.75,
        wireframe: showWireframe,
      });
      const mesh = new THREE.Mesh(notchesGeometry, material);
      scene.add(mesh);
      notchesMeshRef.current = mesh;
    }
  }, [notchesGeometry, isPreviewCSG, showWireframe]);

  // Update Extrude Preview Mesh (Visual representation of upward slot cutout)
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    if (extrudePreviewMeshRef.current) {
      scene.remove(extrudePreviewMeshRef.current);
      if (Array.isArray(extrudePreviewMeshRef.current.material)) {
        extrudePreviewMeshRef.current.material.forEach(m => m.dispose());
      } else {
        extrudePreviewMeshRef.current.material.dispose();
      }
      extrudePreviewMeshRef.current = null;
    }

    if (extrudePreviewGeometry && !isPreviewCSG) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xf59e0b, // Amber / Orange matching tool ghost
        roughness: 0.3,
        metalness: 0.05,
        transparent: true,
        opacity: 0.35,
        wireframe: showWireframe,
      });
      const mesh = new THREE.Mesh(extrudePreviewGeometry, material);
      scene.add(mesh);
      extrudePreviewMeshRef.current = mesh;
    }
  }, [extrudePreviewGeometry, isPreviewCSG, showWireframe]);

  // Update CSG Subtraction Mesh (Final Preview)
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    if (csgMeshRef.current) {
      scene.remove(csgMeshRef.current);
      if (Array.isArray(csgMeshRef.current.material)) {
        csgMeshRef.current.material.forEach(m => m.dispose());
      } else {
        csgMeshRef.current.material.dispose();
      }
      csgMeshRef.current = null;
    }

    if (csgGeometry && isPreviewCSG) {
      const material = new THREE.MeshStandardMaterial({
        color: 0x10b981, // Emerald green for finalized bin with cutout
        roughness: 0.35,
        metalness: 0.05,
        wireframe: showWireframe,
      });
      const mesh = new THREE.Mesh(csgGeometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      csgMeshRef.current = mesh;
    }
  }, [csgGeometry, isPreviewCSG, showWireframe]);

  // View reset
  const handleResetCamera = (view: 'iso' | 'top' | 'front') => {
    if (!cameraRef.current || !orbitRef.current) return;
    const cam = cameraRef.current;
    const orbit = orbitRef.current;

    if (view === 'iso') {
      cam.position.set(120, -180, 160);
      orbit.target.set(0, 0, 15);
    } else if (view === 'top') {
      cam.position.set(0, 0, 260);
      orbit.target.set(0, 0, 0);
    } else if (view === 'front') {
      cam.position.set(0, -260, 20);
      orbit.target.set(0, 0, 15);
    }
    cam.lookAt(orbit.target);
    orbit.update();
  };

  return (
    <div className="relative w-full h-full overflow-hidden select-none bg-slate-950">
      {/* 3D Canvas Container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Top Floating Controls Bar */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
        {/* Transform Gizmo Selector */}
        <div className="flex items-center gap-1 bg-slate-900/90 backdrop-blur border border-slate-800 p-1 rounded-xl shadow-2xl pointer-events-auto">
          <button
            onClick={() => setTransformMode('translate')}
            title="Translate / Move (Gizmo)"
            className={`p-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
              transformMode === 'translate'
                ? 'bg-amber-500 text-slate-950 font-semibold shadow'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Move className="w-4 h-4" />
            <span className="hidden sm:inline">Move</span>
          </button>
          <button
            onClick={() => setTransformMode('rotate')}
            title="Rotate (Gizmo)"
            className={`p-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
              transformMode === 'rotate'
                ? 'bg-amber-500 text-slate-950 font-semibold shadow'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <RotateCw className="w-4 h-4" />
            <span className="hidden sm:inline">Rotate</span>
          </button>
          <button
            onClick={() => setTransformMode('scale')}
            title="Scale (Gizmo)"
            className={`p-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
              transformMode === 'scale'
                ? 'bg-amber-500 text-slate-950 font-semibold shadow'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Maximize className="w-4 h-4" />
            <span className="hidden sm:inline">Scale</span>
          </button>
        </div>

        {/* View & CSG Toggle */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* CSG Cutout Mode Toggle */}
          <button
            onClick={() => onTogglePreviewCSG(!isPreviewCSG)}
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 shadow-2xl transition border ${
              isPreviewCSG
                ? 'bg-emerald-600 border-emerald-400 text-white shadow-emerald-900/40'
                : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>{isPreviewCSG ? 'Showing Cutout Result' : 'Preview Cutout'}</span>
          </button>

          {/* Wireframe toggle */}
          <button
            onClick={() => setShowWireframe(!showWireframe)}
            title="Toggle Wireframe"
            className={`p-2 rounded-xl border text-xs transition ${
              showWireframe
                ? 'bg-indigo-600 border-indigo-400 text-white'
                : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Grid3X3 className="w-4 h-4" />
          </button>

          {/* Camera angles */}
          <div className="flex items-center bg-slate-900/90 border border-slate-800 p-1 rounded-xl shadow-2xl">
            <button
              onClick={() => handleResetCamera('iso')}
              title="Isometric 3D"
              className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 rounded"
            >
              3D
            </button>
            <button
              onClick={() => handleResetCamera('top')}
              title="Top View"
              className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 rounded"
            >
              Top
            </button>
            <button
              onClick={() => handleResetCamera('front')}
              title="Front View"
              className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 rounded"
            >
              Front
            </button>
            <button
              onClick={() => handleResetCamera('iso')}
              title="Focus Target"
              className="p-1 text-slate-400 hover:text-slate-200 rounded ml-1"
            >
              <Focus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Loading Overlay */}
      {isComputing && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-30 pointer-events-auto">
          <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
          <div className="text-sm font-semibold text-emerald-400">Computing Watertight CSG Boolean...</div>
          <div className="text-xs text-slate-400">libmanifold WebAssembly processing</div>
        </div>
      )}

      {/* Legend / Info Footer */}
      <div className="absolute bottom-4 left-4 flex items-center gap-4 text-xs font-mono text-slate-400 bg-slate-900/80 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-800/80 pointer-events-none">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block" />
          <span>Bin Solid</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
          <span>Tool Ghost</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" />
          <span>42mm Ground Grid</span>
        </div>
      </div>
    </div>
  );
};
