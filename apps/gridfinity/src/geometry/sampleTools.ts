import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function createSampleToolGeometry(type: 'caliper' | 'wrench' | 'hexbit' | 'bracket'): THREE.BufferGeometry {
  if (type === 'hexbit') {
    // 1/4 inch hex bit (6.35mm hex diameter, 25mm length)
    const geo = new THREE.CylinderGeometry(3.6, 3.6, 25, 6);
    geo.rotateZ(Math.PI / 2);
    return BufferGeometryUtils.mergeVertices(geo, 1e-4);
  }

  if (type === 'bracket') {
    // Mounting bracket with two M4 screw holes (demonstrates screw hole defeaturing)
    const shape = new THREE.Shape();
    const w = 60, h = 24;
    shape.moveTo(-w / 2, -h / 2);
    shape.lineTo(w / 2, -h / 2);
    shape.lineTo(w / 2, h / 2);
    shape.lineTo(-w / 2, h / 2);
    shape.closePath();

    // Screw hole 1 (dia 4.5mm)
    const hole1 = new THREE.Path();
    hole1.absarc(-16, 0, 2.25, 0, Math.PI * 2, true);
    shape.holes.push(hole1);

    // Screw hole 2 (dia 4.5mm)
    const hole2 = new THREE.Path();
    hole2.absarc(16, 0, 2.25, 0, Math.PI * 2, true);
    shape.holes.push(hole2);

    const geo = new THREE.ExtrudeGeometry(shape, { depth: 10, bevelEnabled: false });
    geo.center();
    return BufferGeometryUtils.mergeVertices(geo, 1e-4);
  }

  if (type === 'wrench') {
    // Small combination wrench shape
    const group = new THREE.Group();
    // Handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(70, 8, 4));
    group.add(handle);
    // Head 1
    const head1 = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 4, 16));
    head1.position.set(-35, 0, 0);
    group.add(head1);
    // Head 2
    const head2 = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 4, 16));
    head2.position.set(35, 0, 0);
    group.add(head2);

    // Convert group to single geometry
    const geos: THREE.BufferGeometry[] = [];
    group.updateMatrixWorld();
    group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        const cloned = child.geometry.clone();
        cloned.applyMatrix4(child.matrixWorld);
        geos.push(cloned);
      }
    });

    const box = new THREE.BoxGeometry(60, 10, 5);
    return BufferGeometryUtils.mergeVertices(box, 1e-4);
  }

  // Caliper jaw shape
  const beam = new THREE.BoxGeometry(110, 14, 5);
  return BufferGeometryUtils.mergeVertices(beam, 1e-4);
}
