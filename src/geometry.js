// All lengths are metres. The room's floor is the rectangle x ∈ [0, width],
// z ∈ [0, depth] at y = 0. Each wall has a "u" axis running left to right as
// you stand in the room facing it, and "v" running up from the floor.
import * as THREE from 'three';

export const WALLS = {
  back: { label: 'Back wall', origin: (s) => [0, 0, 0], dir: [1, 0, 0], normal: [0, 0, 1], length: (s) => s.width },
  left: { label: 'Left wall', origin: (s) => [0, 0, s.depth], dir: [0, 0, -1], normal: [1, 0, 0], length: (s) => s.depth },
  right: { label: 'Right wall', origin: (s) => [s.width, 0, 0], dir: [0, 0, 1], normal: [-1, 0, 0], length: (s) => s.depth },
  front: { label: 'Front wall', origin: (s) => [s.width, 0, s.depth], dir: [-1, 0, 0], normal: [0, 0, -1], length: (s) => s.width },
};
export const WALL_IDS = Object.keys(WALLS);

export function wallFrame(space, id) {
  const w = WALLS[id];
  return {
    id,
    origin: new THREE.Vector3(...w.origin(space)),
    dir: new THREE.Vector3(...w.dir),
    normal: new THREE.Vector3(...w.normal),
    length: w.length(space),
    height: space.height,
    rotY: Math.atan2(w.normal[0], w.normal[2]),
  };
}

export const activeWalls = (space) => WALL_IDS.filter((id) => space.walls[id]);

// World point -> (u, v) on a wall.
export function toWallUV(space, wallId, point) {
  const f = wallFrame(space, wallId);
  const rel = point.clone().sub(f.origin);
  return { u: rel.dot(f.dir), v: point.y };
}

// An object attached to a wall (fixture or wall-mounted item), given its left
// edge u, bottom v and size, as a centre + rotation in world space.
export function wallBoxTransform(space, { wall, u, v }, { w, h, d }) {
  const f = wallFrame(space, wall);
  const center = f.origin
    .clone()
    .addScaledVector(f.dir, u + w / 2)
    .addScaledVector(f.normal, d / 2);
  center.y = v + h / 2;
  return { center, rotY: f.rotY };
}

// Rotating local +z (an item's front) by rotY gives (sin, 0, cos).
export const frontFromRot = (rot) => new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));

export const sizeOf = (p) => ({ w: p.width, h: p.height, d: p.depth });

export function itemTransform(space, product, item) {
  const size = sizeOf(product);
  if (item.kind === 'wall') return wallBoxTransform(space, item, size);
  if (item.kind === 'floor') {
    return { center: new THREE.Vector3(item.x, size.h / 2, item.z), rotY: item.rot };
  }
  // 'surface': stuck to a scanned mesh. (x, y, z) is the bottom-centre of the
  // back face for wall items, or the bottom-centre for floor items.
  const base = new THREE.Vector3(item.x, item.y, item.z);
  if (item.onWall) base.addScaledVector(frontFromRot(item.rot), size.d / 2);
  base.y += size.h / 2;
  return { center: base, rotY: item.rot };
}

export function worldBox({ center, rotY }, { w, h, d }) {
  const c = Math.abs(Math.cos(rotY));
  const s = Math.abs(Math.sin(rotY));
  const hx = (c * w + s * d) / 2;
  const hz = (s * w + c * d) / 2;
  return new THREE.Box3(
    new THREE.Vector3(center.x - hx, center.y - h / 2, center.z - hz),
    new THREE.Vector3(center.x + hx, center.y + h / 2, center.z + hz),
  );
}

export const fixtureSize = (f) => ({ w: f.w, h: f.h, d: f.d });
export const fixtureBox = (space, f) => worldBox(wallBoxTransform(space, f, fixtureSize(f)), fixtureSize(f));

// Shrinks boxes a hair so things that merely touch don't count as overlapping.
const EPS = 0.002;
function overlaps(a, b) {
  return (
    a.min.x < b.max.x - EPS && a.max.x > b.min.x + EPS &&
    a.min.y < b.max.y - EPS && a.max.y > b.min.y + EPS &&
    a.min.z < b.max.z - EPS && a.max.z > b.min.z + EPS
  );
}

export function obstacles(space, products, items, skipItemId) {
  const out = [];
  if (space.useFixtures !== false) {
    for (const f of space.fixtures) out.push({ id: f.id, label: f.label, box: fixtureBox(space, f) });
  }
  for (const it of items) {
    if (it.id === skipItemId) continue;
    const p = products.find((x) => x.id === it.productId);
    if (!p) continue;
    out.push({ id: it.id, label: p.name, box: worldBox(itemTransform(space, p, it), sizeOf(p)) });
  }
  return out;
}

export function collisions(space, products, items, item) {
  const p = products.find((x) => x.id === item.productId);
  if (!p) return [];
  const box = worldBox(itemTransform(space, p, item), sizeOf(p));
  return obstacles(space, products, items, item.id).filter((o) => overlaps(box, o.box));
}

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), Math.max(lo, hi));
const snap = (x, step = 0.005) => Math.round(x / step) * step;

export function clampWall(space, product, item) {
  const len = WALLS[item.wall].length(space);
  return {
    ...item,
    u: snap(clamp(item.u, 0, len - product.width)),
    v: snap(clamp(item.v, 0, space.height - product.height)),
  };
}

const SNAP_DIST = 0.1;
const WALL_ROT = { back: 0, left: Math.PI / 2, right: -Math.PI / 2, front: Math.PI };

// Keeps a floor item on the floor and inside the walls, pushing it flush
// against the skirting (and turning its back to the wall) when it gets close.
export function clampFloor(space, product, item, { autoRotate = false } = {}) {
  let rot = item.rot;
  const sk = space.skirting?.depth ?? 0;
  const inset = (id) => (space.walls[id] ? sk : 0);
  const extents = (r) => {
    const c = Math.abs(Math.cos(r));
    const s = Math.abs(Math.sin(r));
    return { hx: (c * product.width + s * product.depth) / 2, hz: (s * product.width + c * product.depth) / 2 };
  };

  if (autoRotate) {
    const dists = {
      back: item.z, front: space.depth - item.z, left: item.x, right: space.width - item.x,
    };
    const near = activeWalls(space)
      .map((id) => ({ id, dist: dists[id] - extents(WALL_ROT[id]).hz }))
      .filter((n) => n.dist < SNAP_DIST + 0.25)
      .sort((a, b) => a.dist - b.dist)[0];
    if (near) rot = WALL_ROT[near.id];
  }

  const { hx, hz } = extents(rot);
  const minX = inset('left') + hx;
  const maxX = space.width - inset('right') - hx;
  const minZ = inset('back') + hz;
  const maxZ = space.depth - inset('front') - hz;
  let x = clamp(item.x, minX, maxX);
  let z = clamp(item.z, minZ, maxZ);
  if (space.walls.left && x - minX < SNAP_DIST) x = minX;
  if (space.walls.right && maxX - x < SNAP_DIST) x = maxX;
  if (space.walls.back && z - minZ < SNAP_DIST) z = minZ;
  if (space.walls.front && maxZ - z < SNAP_DIST) z = maxZ;
  return { ...item, x: snap(x), z: snap(z), rot };
}

export function clampItem(space, product, item, opts) {
  if (item.kind === 'wall') return clampWall(space, product, item);
  if (item.kind === 'floor') return clampFloor(space, product, item, opts);
  return item;
}

// Usual mounting heights (to the item's centre) by product type.
function preferredCentre(name = '') {
  if (/coat|hook|peg/i.test(name)) return 1.6;
  if (/mirror/i.test(name)) return 1.55;
  if (/shelf|shelves/i.test(name)) return 1.5;
  if (/key|letter|mail/i.test(name)) return 1.4;
  return 1.5;
}

const CLEARANCE = 0.03;

// Finds the free spot closest to the middle of a wall: wall items at a
// sensible height, floor items backed against a wall.
export function autoPlace(space, product, items, products) {
  const walls = activeWalls(space).sort((a, b) => WALLS[b].length(space) - WALLS[a].length(space));
  const allProducts = products.some((p) => p.id === product.id) ? products : [...products, product];
  const fits = (item) => {
    const p = { ...product, width: product.width + CLEARANCE * 2, height: product.height + CLEARANCE * 2 };
    const padded =
      item.kind === 'wall' ? { ...item, u: item.u - CLEARANCE, v: item.v - CLEARANCE } : item;
    const box = worldBox(itemTransform(space, p, padded), sizeOf(p));
    return !obstacles(space, allProducts, items).some((o) => overlaps(box, o.box));
  };
  const offsets = [0];
  for (let i = 1; i < 200; i++) offsets.push(i * 0.02, -i * 0.02);

  for (const wall of walls) {
    const len = WALLS[wall].length(space);
    const mid = (len - product.width) / 2;
    if (product.mount === 'wall') {
      const v0 = preferredCentre(product.name) - product.height / 2;
      for (const dv of [0, 0.1, -0.1, 0.2, -0.2, 0.3]) {
        for (const du of offsets) {
          const u = mid + du;
          if (u < 0 || u > len - product.width) continue;
          const item = clampWall(space, product, { kind: 'wall', wall, u, v: v0 + dv });
          if (fits(item)) return item;
        }
      }
    } else {
      const f = wallFrame(space, wall);
      for (const du of offsets) {
        const u = mid + du;
        if (u < 0 || u > len - product.width) continue;
        const p = f.origin.clone().addScaledVector(f.dir, u + product.width / 2).addScaledVector(f.normal, 0.05);
        const item = clampFloor(space, product, { kind: 'floor', x: p.x, z: p.z, rot: WALL_ROT[wall] });
        if (fits(item)) return item;
      }
    }
  }
  // Nowhere free: drop it in the middle and let the overlap warning show.
  if (product.mount === 'wall' && walls.length) {
    const wall = walls[0];
    return clampWall(space, product, {
      kind: 'wall', wall, u: (WALLS[wall].length(space) - product.width) / 2, v: preferredCentre(product.name) - product.height / 2,
    });
  }
  return clampFloor(space, product, { kind: 'floor', x: space.width / 2, z: space.depth / 2, rot: 0 });
}

// Gaps between a wall item and its neighbours on the same wall, for labels.
export function wallGaps(space, products, items, item) {
  const p = products.find((x) => x.id === item.productId);
  const len = WALLS[item.wall].length(space);
  const left = item.u;
  const right = item.u + p.width;
  const bottom = item.v;
  const top = item.v + p.height;
  const others = [
    ...(space.useFixtures !== false ? space.fixtures : []).filter((f) => f.wall === item.wall).map((f) => ({ label: f.label, u0: f.u, u1: f.u + f.w, v0: f.v, v1: f.v + f.h })),
    ...items
      .filter((o) => o.id !== item.id && o.kind === 'wall' && o.wall === item.wall)
      .map((o) => {
        const op = products.find((x) => x.id === o.productId);
        return op && { label: op.name, u0: o.u, u1: o.u + op.width, v0: o.v, v1: o.v + op.height };
      })
      .filter(Boolean),
  ];
  const gaps = {
    left: { dist: left, label: 'wall edge' },
    right: { dist: len - right, label: 'wall edge' },
    below: { dist: bottom, label: 'floor' },
    above: { dist: space.height - top, label: 'ceiling' },
  };
  for (const o of others) {
    const vOverlap = o.v0 < top && o.v1 > bottom;
    const uOverlap = o.u0 < right && o.u1 > left;
    if (vOverlap && o.u1 <= left + 0.001 && left - o.u1 < gaps.left.dist) gaps.left = { dist: left - o.u1, label: o.label };
    if (vOverlap && o.u0 >= right - 0.001 && o.u0 - right < gaps.right.dist) gaps.right = { dist: o.u0 - right, label: o.label };
    if (uOverlap && o.v1 <= bottom + 0.001 && bottom - o.v1 < gaps.below.dist) gaps.below = { dist: bottom - o.v1, label: o.label };
    if (uOverlap && o.v0 >= top - 0.001 && o.v0 - top < gaps.above.dist) gaps.above = { dist: o.v0 - top, label: o.label };
  }
  return gaps;
}
