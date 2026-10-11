// Loading, auto-aligning and querying an uploaded LiDAR scan.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// The live scan meshes, for raycasts and overlap checks outside React.
export const scanRef = { meshes: [] };

export async function loadScanFile(url, name) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'glb' || ext === 'gltf') return (await new GLTFLoader().loadAsync(url)).scene;
  if (ext === 'obj') return await new OBJLoader().loadAsync(url);
  if (ext === 'usdz') return await new USDZLoader().loadAsync(url);
  if (ext === 'ply') {
    const geo = await new PLYLoader().loadAsync(url);
    if (!geo.index && geo.attributes.position.count && !geo.attributes.normal) geo.computeVertexNormals();
    const hasColor = geo.hasAttribute('color');
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: hasColor, color: hasColor ? '#fff' : '#ccc' }));
  }
  throw new Error(`Can't open .${ext} files. Export the scan as GLB if you can.`);
}

// Looks at every triangle to find (a) the floor height, from the biggest
// patch of flat surface, (b) how far the walls are turned from the x/z axes,
// and (c) whether faces point into the room (so walls can be seen through
// from outside, like a dollhouse).
export function analyseScan(obj) {
  obj.updateMatrixWorld(true);
  const angleBins = new Float64Array(90);
  const heightBins = new Map();
  let up = 0;
  let down = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const box = new THREE.Box3().setFromObject(obj);

  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const count = idx ? idx.count : pos.count;
    // Big scans: sample triangles rather than visiting every one.
    const stride = Math.max(1, Math.floor(count / 3 / 300000)) * 3;
    for (let i = 0; i + 2 < count; i += stride) {
      const ia = idx ? idx.getX(i) : i;
      const ib = idx ? idx.getX(i + 1) : i + 1;
      const ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      n.subVectors(b, a).cross(c.clone().sub(a));
      const area = n.length() / 2;
      if (!area) continue;
      n.normalize();
      if (Math.abs(n.y) < 0.2) {
        const deg = (Math.atan2(n.x, n.z) * 180) / Math.PI;
        angleBins[Math.floor((((deg % 90) + 90) % 90))] += area;
      } else if (Math.abs(n.y) > 0.9) {
        const y = (a.y + b.y + c.y) / 3;
        if (y < box.min.y + (box.max.y - box.min.y) * 0.5) {
          const key = Math.round(y * 100);
          heightBins.set(key, (heightBins.get(key) || 0) + area);
          if (n.y > 0) up += area;
          else down += area;
        }
      }
    }
  });

  // Peak of the wall-direction histogram (smoothed, wrapping at 90°).
  let best = 0;
  let bestVal = -1;
  for (let i = 0; i < 90; i++) {
    const v = angleBins[(i + 89) % 90] + angleBins[i] * 2 + angleBins[(i + 1) % 90];
    if (v > bestVal) {
      bestVal = v;
      best = i;
    }
  }
  const l = angleBins[(best + 89) % 90];
  const r = angleBins[(best + 1) % 90];
  const m = angleBins[best];
  const peak = best + 0.5 + (l + m + r ? (r - l) / (l + m + r) : 0);
  const turn = peak > 45 ? 90 - peak : -peak;

  let floorKey = null;
  let floorArea = 0;
  for (const [k, v] of heightBins) {
    // Merge neighbouring centimetres so a slightly bumpy floor still wins.
    const sum = v + (heightBins.get(k - 1) || 0) + (heightBins.get(k + 1) || 0);
    if (sum > floorArea) {
      floorArea = sum;
      floorKey = k;
    }
  }

  return {
    turnDeg: bestVal > 0 ? turn : 0,
    floorY: floorKey == null ? box.min.y : floorKey / 100,
    facesInward: up >= down,
  };
}

export function prepareMeshes(obj, facesInward) {
  const meshes = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundsTree();
    o.receiveShadow = true;
    for (const mat of [].concat(o.material)) {
      // Faces that point into the room let you look in through the near walls.
      mat.side = facesInward ? THREE.FrontSide : THREE.DoubleSide;
    }
    meshes.push(o);
  });
  return meshes;
}

const tmpMatrix = new THREE.Matrix4();
const tmpBox = new THREE.Box3();

// Does a box (size, centre, y-rotation) cut into the scan? The box is shrunk
// by `inset` first, because scanned walls and floors are a bit bumpy and
// things placed against them would otherwise always "overlap".
export function boxHitsScan({ w, h, d }, center, rotY, inset = 0.015) {
  if (!scanRef.meshes.length) return false;
  const world = new THREE.Matrix4().compose(center, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(1, 1, 1));
  const half = new THREE.Vector3(Math.max(0.001, w / 2 - inset), Math.max(0.001, h / 2 - inset), Math.max(0.001, d / 2 - inset));
  tmpBox.set(half.clone().negate(), half);
  for (const mesh of scanRef.meshes) {
    if (!mesh.geometry.boundsTree || !isShown(mesh)) continue;
    tmpMatrix.copy(mesh.matrixWorld).invert().multiply(world);
    if (mesh.geometry.boundsTree.intersectsBox(tmpBox, tmpMatrix)) return true;
  }
  return false;
}

const isShown = (o) => {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};

const ray = new THREE.Raycaster();
ray.firstHitOnly = true;

// Distance from a point along a direction to the first scanned surface.
export function distanceToScan(origin, dir, max = 5) {
  if (!scanRef.meshes.length) return null;
  ray.set(origin, dir.clone().normalize());
  ray.far = max;
  const hits = ray.intersectObjects(scanRef.meshes.filter(isShown), false);
  return hits.length ? hits[0].distance : null;
}

// Finds the big flat walls in the (already squared-up) scan: for each of the
// four horizontal directions, the planes with the most surface facing that
// way. Wall-mounted items are pushed back onto these, so dragging a coat
// rack over a radiator puts it on the wall behind (and flags the overlap)
// rather than on the radiator's front.
export function findWallPlanes(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ].map((n) => ({ n: new THREE.Vector3(...n), bins: new Map() }));
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const count = idx ? idx.count : pos.count;
    const stride = Math.max(1, Math.floor(count / 3 / 300000)) * 3;
    for (let i = 0; i + 2 < count; i += stride) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(m);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(m);
      n.subVectors(b, a).cross(c.clone().sub(a));
      const area = n.length() / 2;
      if (!area) continue;
      n.normalize();
      for (const d of dirs) {
        // Faces may be wound either way, so match both sides.
        const dot = n.dot(d.n);
        if (Math.abs(dot) < 0.96) continue;
        const key = Math.round(((a.x + b.x + c.x) / 3) * d.n.x * 100 + ((a.z + b.z + c.z) / 3) * d.n.z * 100);
        d.bins.set(key, (d.bins.get(key) || 0) + area);
      }
    }
  });
  const planes = [];
  for (const d of dirs) {
    for (const [k, v] of d.bins) {
      const sum = v + (d.bins.get(k - 1) || 0) + (d.bins.get(k + 1) || 0);
      const isPeak = v >= (d.bins.get(k - 1) || 0) && v >= (d.bins.get(k + 1) || 0);
      if (isPeak && sum > 0.4) planes.push({ n: d.n.toArray(), d: k / 100, area: sum });
    }
  }
  return planes;
}

// Moves a point on a scanned surface back onto the wall plane behind it, if
// there's one within `reach`. `normal` is the world direction out of the wall.
export function onWallPlane(point, normal, reach = 0.4) {
  const root = scanRef.root;
  if (!root || !scanRef.planes?.length) return point;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const local = point.clone().applyMatrix4(inv);
  const scale = root.matrixWorld.getMaxScaleOnAxis();
  const q = new THREE.Quaternion();
  root.matrixWorld.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  const ln = normal.clone().applyQuaternion(q.invert());
  let best = null;
  for (const p of scanRef.planes) {
    const pn = new THREE.Vector3(...p.n);
    if (pn.dot(ln) < 0.95) continue;
    const behind = local.dot(pn) - p.d; // how far in front of the plane the point is
    if (behind < -0.005 || behind * scale > reach) continue;
    if (!best || p.area > best.area) best = { ...p, behind, pn };
  }
  if (!best) return point;
  return local.addScaledVector(best.pn, -best.behind).applyMatrix4(root.matrixWorld);
}
