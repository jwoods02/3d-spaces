// Placement on a scanned room: snapping to scanned walls and floor, overlap
// checks against the scan, gaps for labels, and auto placement.
import * as THREE from 'three';
import { boxHitsScan, distanceToScan, scanRef, onWallPlane } from './scan.js';
import { itemTransform, sizeOf, frontFromRot, obstacles, worldBox } from './geometry.js';

const QUARTER = Math.PI / 2;
const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

// Rounds an angle to the nearest quarter turn when it's within ~12° of one,
// so things sit square on slightly wonky scanned walls.
export function squareUp(rot) {
  const snapped = Math.round(rot / QUARTER) * QUARTER;
  return Math.abs(rot - snapped) < 0.21 ? snapped : rot;
}

const halfExtent = (product, rot, dir) => {
  const front = frontFromRot(rot);
  const right = new THREE.Vector3(front.z, 0, -front.x);
  return Math.abs(dir.dot(right)) * (product.width / 2) + Math.abs(dir.dot(front)) * (product.depth / 2);
};

const SNAP = 0.12;

// A floor item at (x, y, z): turn its back to the nearest scanned wall and
// slide it flush against anything within a hand's width.
export function snapFloorOnScan(product, item, { autoRotate = true } = {}) {
  let rot = item.rot || 0;
  const probe = (x, z) => new THREE.Vector3(x, item.y + 0.05, z);
  if (autoRotate) {
    const near = AXES.map((d) => ({ d, dist: distanceToScan(probe(item.x, item.z), d, 2) }))
      .filter((h) => h.dist != null)
      .sort((a, b) => a.dist - b.dist)[0];
    if (near && near.dist < Math.max(product.width, product.depth) / 2 + 0.3) {
      rot = Math.atan2(-near.d.x, -near.d.z);
    }
  }
  let { x, z } = item;
  for (const d of AXES) {
    const dist = distanceToScan(probe(x, z), d, 2);
    if (dist == null) continue;
    const gap = dist - halfExtent(product, rot, d);
    if (gap < SNAP) {
      x += d.x * (gap - 0.002);
      z += d.z * (gap - 0.002);
    }
  }
  return { ...item, x, z, rot };
}

export function hitsScan(product, item) {
  if (!scanRef.meshes.length) return false;
  const { center, rotY } = itemTransform(null, product, item);
  return boxHitsScan(sizeOf(product), center, rotY);
}

// How far each side of the item is from the nearest scanned surface (or the
// nearest placed item), measured straight out from that side.
export function scanGaps(space, products, items, item) {
  const product = products.find((p) => p.id === item.productId);
  const { center, rotY } = itemTransform(space, product, item);
  const front = frontFromRot(rotY);
  const right = new THREE.Vector3(front.z, 0, -front.x);
  const up = new THREE.Vector3(0, 1, 0);
  const { width: w, height: h, depth: d } = product;
  const others = obstacles(space, products, items, item.id);
  const toOthers = (origin, dir) => {
    const r = new THREE.Ray(origin, dir);
    let best = null;
    for (const o of others) {
      const p = r.intersectBox(o.box, new THREE.Vector3());
      if (p) {
        const dist = p.distanceTo(origin);
        if (best == null || dist < best.dist) best = { dist, label: o.label };
      }
    }
    return best;
  };
  const measure = (label, origin, dir) => {
    const s = distanceToScan(origin, dir, 6);
    const o = toOthers(origin, dir);
    if (o && (s == null || o.dist < s)) return { side: label, dist: o.dist, label: o.label };
    return s == null ? null : { side: label, dist: s, label: 'scan' };
  };
  const at = (v) => center.clone().add(v);
  const lowY = new THREE.Vector3(0, -h / 2 + Math.min(0.05, h / 4), 0);
  const sides = item.onWall
    ? [
        measure('left', at(right.clone().multiplyScalar(-w / 2 - 0.002)), right.clone().negate()),
        measure('right', at(right.clone().multiplyScalar(w / 2 + 0.002)), right),
        measure('below', at(new THREE.Vector3(0, -h / 2 - 0.002, 0)), up.clone().negate()),
        measure('above', at(new THREE.Vector3(0, h / 2 + 0.002, 0)), up),
      ]
    : [
        measure('left', at(right.clone().multiplyScalar(-w / 2 - 0.002).add(lowY)), right.clone().negate()),
        measure('right', at(right.clone().multiplyScalar(w / 2 + 0.002).add(lowY)), right),
        measure('behind', at(front.clone().multiplyScalar(-d / 2 - 0.002).add(lowY)), front.clone().negate()),
        measure('front', at(front.clone().multiplyScalar(d / 2 + 0.002).add(lowY)), front),
        measure('above', at(new THREE.Vector3(0, h / 2 + 0.002, 0)), up),
      ];
  return sides.filter(Boolean);
}

function preferredCentre(name = '') {
  if (/coat|hook|peg/i.test(name)) return 1.6;
  if (/mirror/i.test(name)) return 1.55;
  if (/shelf|shelves/i.test(name)) return 1.5;
  return 1.5;
}

// Tries spots along each side of the scan, closest to the middle first, and
// returns the first one that doesn't cut into the scan or another item.
export function autoPlaceOnScan(space, product, items, products, bounds) {
  if (!bounds) return null;
  const [min, max] = bounds.map((v) => new THREE.Vector3(...v));
  const cx = (min.x + max.x) / 2;
  const cz = (min.z + max.z) / 2;
  const all = products.some((p) => p.id === product.id) ? products : [...products, product];
  const free = (item) => {
    const box = worldBox(itemTransform(space, product, item), sizeOf(product));
    box.expandByScalar(0.02);
    return !hitsScan(product, item) && !obstacles(space, all, items).some((o) => o.box.intersectsBox(box));
  };
  // Each side: a ray direction towards that wall and the axis to slide along.
  const sides = [
    { dir: new THREE.Vector3(0, 0, -1), along: 'x', from: (t, y) => new THREE.Vector3(t, y, max.z + 0.5) },
    { dir: new THREE.Vector3(-1, 0, 0), along: 'z', from: (t, y) => new THREE.Vector3(max.x + 0.5, y, t) },
    { dir: new THREE.Vector3(1, 0, 0), along: 'z', from: (t, y) => new THREE.Vector3(min.x - 0.5, y, t) },
    { dir: new THREE.Vector3(0, 0, 1), along: 'x', from: (t, y) => new THREE.Vector3(t, y, min.z - 0.5) },
  ];
  const ray = new THREE.Raycaster();
  // Only count hits in the far third of the scan along the ray, so stray
  // scraps at the open edge of a scan aren't mistaken for walls.
  const span = { x: max.x - min.x, z: max.z - min.z };
  const nearFarEnd = (p, dir) =>
    dir.x < 0 ? p.x < min.x + span.x / 3 : dir.x > 0 ? p.x > max.x - span.x / 3 : dir.z < 0 ? p.z < min.z + span.z / 3 : p.z > max.z - span.z / 3;
  const hitFrom = (origin, dir) => {
    ray.set(origin, dir);
    ray.far = 20;
    return ray.intersectObjects(scanRef.meshes, false).find((h) => nearFarEnd(h.point, dir));
  };
  const steps = [0];
  for (let i = 1; i < 150; i++) steps.push(i * 0.03, -i * 0.03);

  for (const side of sides) {
    const mid = side.along === 'x' ? cx : cz;
    const lo = side.along === 'x' ? min.x : min.z;
    const hi = side.along === 'x' ? max.x : max.z;
    for (const dt of steps) {
      const t = mid + dt;
      if (t - product.width / 2 < lo || t + product.width / 2 > hi) continue;
      if (product.mount === 'wall') {
        const y = preferredCentre(product.name);
        const hit = hitFrom(side.from(t, y), side.dir);
        if (!hit) continue;
        const rot = Math.atan2(-side.dir.x, -side.dir.z);
        const at = onWallPlane(hit.point, side.dir.clone().negate());
        const item = { kind: 'surface', onWall: true, x: at.x, y: y - product.height / 2, z: at.z, rot };
        if (free(item)) return item;
      } else {
        // Find the floor just in front of the wall, then snap back to it.
        const wallHit = hitFrom(side.from(t, 0.3), side.dir);
        if (!wallHit) continue;
        const spot = wallHit.point.clone().addScaledVector(side.dir, -(product.depth / 2 + 0.05));
        ray.set(new THREE.Vector3(spot.x, max.y, spot.z), new THREE.Vector3(0, -1, 0));
        ray.far = 20;
        const floor = ray.intersectObjects(scanRef.meshes, false).find((h) => h.point.y < min.y + 0.3);
        if (!floor) continue;
        const item = snapFloorOnScan(product, { kind: 'surface', onWall: false, x: spot.x, y: floor.point.y, z: spot.z, rot: Math.atan2(-side.dir.x, -side.dir.z) }, { autoRotate: false });
        if (free(item)) return item;
      }
    }
  }
  return null;
}
