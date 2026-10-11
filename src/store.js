import { useMemo } from 'react';
import { create } from 'zustand';
import * as THREE from 'three';
import { persist } from 'zustand/middleware';
import { autoPlace, clampItem } from './geometry.js';
import { autoPlaceOnScan } from './scanPlacement.js';

// True when a scan is the room and the measured walls are hidden.
export const scanIsRoom = (s) => Boolean(s.scan?.url && s.scan.showRoom !== true);

// The measured room as placement should see it: with a scan as the room, its
// fixtures are in the scan itself, so the typed-in ones are left out.
export const roomSpace = (s) => (scanIsRoom(s) ? { ...s.space, useFixtures: false } : s.space);

export function useRoomSpace() {
  const space = useStore((s) => s.space);
  const isScan = useStore(scanIsRoom);
  return useMemo(() => (isScan ? { ...space, useFixtures: false } : space), [space, isScan]);
}

// The box the camera frames: the scan's bounds, or the measured room.
export function viewFrame(s) {
  if (scanIsRoom(s) && s.scan.bounds) {
    const [min, max] = s.scan.bounds;
    return { minX: min[0], maxX: max[0], minZ: min[2], maxZ: max[2], height: Math.max(max[1], 1) };
  }
  return { minX: 0, maxX: s.space.width, minZ: 0, maxZ: s.space.depth, height: s.space.height };
}

function findSpot(s, product, allItems) {
  const items = allItems.filter((i) => (i.kind === 'surface') === scanIsRoom(s));
  if (scanIsRoom(s)) {
    const spot = autoPlaceOnScan(roomSpace(s), product, items, s.products, s.scan.bounds);
    if (spot) return spot;
    // Nowhere free: drop it in the middle of the scan and let the warning show.
    const [min, max] = s.scan.bounds || [[0, 0, 0], [1, 0, 1]];
    return {
      kind: 'surface', onWall: product.mount === 'wall', rot: 0,
      x: (min[0] + max[0]) / 2, z: (min[2] + max[2]) / 2, y: product.mount === 'wall' ? 1.4 : 0,
    };
  }
  return autoPlace(s.space, product, items, s.products);
}

const uid = () => Math.random().toString(36).slice(2, 10);

export const FIXTURE_TYPES = {
  radiator: { label: 'Radiator', w: 0.4, h: 0.6, d: 0.1, v: 0.15 },
  switch: { label: 'Light switch', w: 0.086, h: 0.086, d: 0.012, v: 1.0 },
  socket: { label: 'Plug socket', w: 0.146, h: 0.086, d: 0.012, v: 0.45 },
  box: { label: 'Fuse box', w: 0.25, h: 0.28, d: 0.12, v: 1.45 },
  window: { label: 'Window', w: 0.9, h: 1.1, d: 0.02, v: 0.9 },
  door: { label: 'Door', w: 0.84, h: 2.04, d: 0.02, v: 0 },
  other: { label: 'Other', w: 0.3, h: 0.3, d: 0.05, v: 1.0 },
};

// Rough guess at the hallway corner in James's photo. The point is to measure
// it and type the real numbers in.
export const EXAMPLE_SPACE = {
  name: 'Hallway corner (example)',
  width: 1.35,
  depth: 1.2,
  height: 2.4,
  walls: { back: true, left: true, right: false, front: false },
  skirting: { height: 0.1, depth: 0.018 },
  wallColor: '#ece6d8',
  floorColor: '#7d6a58',
  useFixtures: true,
  fixtures: [
    { id: 'rad', type: 'radiator', label: 'Radiator', wall: 'back', u: 0.41, v: 0.15, w: 0.4, h: 0.6, d: 0.1 },
    { id: 'sw', type: 'switch', label: 'Light switch', wall: 'back', u: 1.2, v: 0.96, w: 0.086, h: 0.086, d: 0.012 },
    { id: 'fuse', type: 'box', label: 'Fuse box', wall: 'left', u: 0.88, v: 1.45, w: 0.25, h: 0.28, d: 0.12 },
  ],
};

export const SAMPLE_PRODUCT = {
  id: 'sample-coat-rack',
  name: 'Chester Oak 5 Hook Coat Rack',
  url: 'https://www.cotswoldco.com/hallway-furniture/coat-racks-hooks-stands/chester-oak-110cm-coat-rack/',
  image: 'https://img.cotswoldco.com/824658dd/67ceb724f6d85f926b230f21/660.028_dfnf589d.5.jpg?tr=w-768',
  price: '£99',
  width: 1.1,
  height: 0.185,
  depth: 0.135,
  mount: 'wall',
  color: '#b48a5a',
};

export const SAMPLE_BENCH = {
  id: 'sample-storage-bench',
  name: 'Chester Dove Grey Small Shoe Storage Trunk Bench',
  url: 'https://www.cotswoldco.com/hallway-furniture/shoe-storage-bench/shoe-storage-benches/chester-grey-small-storage-bench/',
  image: 'https://img.cotswoldco.com/c37963d6/67cebd58e1259fbe256da80f/620.138_fwkqgg4f.5.jpg?tr=w-768',
  price: '£299',
  width: 0.6,
  height: 0.6,
  depth: 0.35,
  mount: 'floor',
  color: '#a7a9a4',
};

export const useStore = create(
  persist(
    (set, get) => ({
      space: EXAMPLE_SPACE,
      products: [SAMPLE_PRODUCT, SAMPLE_BENCH],
      items: [],
      selectedId: null,
      // { mode: 'place', productId } while dropping a new item from the bar,
      // { mode: 'move', itemId } while dragging an existing one.
      drag: null,
      panel: null, // 'space' | null
      view: '3d',
      scan: null, // { url, name, rotation, offset, visible, showRoom, size, error }

      setSpace: (patch) => set((s) => ({ space: { ...s.space, ...patch } })),
      setWalls: (patch) => set((s) => ({ space: { ...s.space, walls: { ...s.space.walls, ...patch } } })),
      resetSpace: () => set({ space: EXAMPLE_SPACE }),

      addFixture: (type, wall) =>
        set((s) => {
          const t = FIXTURE_TYPES[type];
          const f = { id: uid(), type, label: t.label, wall, u: 0.1, v: t.v, w: t.w, h: t.h, d: t.d };
          return { space: { ...s.space, fixtures: [...s.space.fixtures, f] } };
        }),
      updateFixture: (id, patch) =>
        set((s) => ({
          space: { ...s.space, fixtures: s.space.fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)) },
        })),
      removeFixture: (id) =>
        set((s) => ({ space: { ...s.space, fixtures: s.space.fixtures.filter((f) => f.id !== id) } })),

      addProduct: (product) => {
        const p = { color: '#9a8f84', ...product, id: product.id || uid() };
        set((s) => ({ products: [...s.products.filter((x) => x.url == null || x.url !== p.url), p] }));
        return p;
      },
      updateProduct: (id, patch) =>
        set((s) => ({
          products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
          items: s.items.map((it) => {
            if (it.productId !== id) return it;
            const p = { ...s.products.find((x) => x.id === id), ...patch };
            // Switching between wall and floor mounting needs a fresh spot.
            const isWall = it.kind === 'wall' || (it.kind === 'surface' && it.onWall);
            if (patch.mount && (patch.mount === 'wall') !== isWall) {
              return { id: it.id, productId: it.productId, ...findSpot(s, p, s.items.filter((o) => o.id !== it.id)) };
            }
            return clampItem(s.space, p, it);
          }),
        })),
      removeProduct: (id) =>
        set((s) => ({
          products: s.products.filter((p) => p.id !== id),
          items: s.items.filter((it) => it.productId !== id),
        })),

      placeAuto: (productId) => {
        const s = get();
        const p = s.products.find((x) => x.id === productId);
        const spot = findSpot(s, p, s.items);
        const item = { id: uid(), productId, ...spot };
        set({ items: [...s.items, item], selectedId: item.id });
        return item;
      },
      addItem: (item) => {
        const it = { id: uid(), ...item };
        set((s) => ({ items: [...s.items, it], selectedId: it.id }));
        return it;
      },
      updateItem: (id, patch) => set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) })),
      removeItem: (id) => set((s) => ({ items: s.items.filter((it) => it.id !== id), selectedId: null })),
      duplicateItem: (id) => {
        const s = get();
        const it = s.items.find((x) => x.id === id);
        if (!it) return;
        const p = s.products.find((x) => x.id === it.productId);
        get().addItem({ productId: it.productId, ...findSpot(s, p, s.items) });
      },

      select: (id) => set({ selectedId: id }),
      setDrag: (drag) => set({ drag }),
      setPanel: (panel) => set({ panel }),
      setView: (view) => set({ view }),
      setScan: (scan) => set((s) => ({ scan: scan && { ...(s.scan || {}), ...scan } })),
      // Turns, moves or rescales the scan, carrying anything placed on it along.
      setScanPose: (patch) =>
        set((s) => {
          const old = s.scan;
          const next = { ...old, ...patch };
          const m = (sc) =>
            new THREE.Matrix4().compose(
              new THREE.Vector3(...(sc.offset || [0, 0, 0])),
              new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((sc.rotation || 0) * Math.PI) / 180),
              new THREE.Vector3().setScalar(sc.scale || 1),
            );
          const delta = m(next).multiply(m(old).invert());
          const turn = (((next.rotation || 0) - (old.rotation || 0)) * Math.PI) / 180;
          const items = s.items.map((it) => {
            if (it.kind !== 'surface') return it;
            const p = new THREE.Vector3(it.x, it.y, it.z).applyMatrix4(delta);
            return { ...it, x: p.x, y: p.y, z: p.z, rot: (it.rot || 0) + turn };
          });
          return { scan: next, items, measure: s.measure && { ...s.measure, points: [] } };
        }),
      measure: null, // { active, points: [[x,y,z], ...] }
      setMeasure: (measure) => set({ measure }),

      importState: (data) =>
        set({
          space: data.space ?? EXAMPLE_SPACE,
          products: data.products ?? [],
          items: data.items ?? [],
          selectedId: null,
        }),
    }),
    {
      name: '3d-spaces',
      version: 1,
      // The scan file itself lives in IndexedDB; only how it's lined up is kept here.
      partialize: (s) => ({
        space: s.space,
        products: s.products,
        items: s.items,
        scan: s.scan && {
          rotation: s.scan.rotation, offset: s.scan.offset, scale: s.scan.scale, visible: s.scan.visible, showRoom: s.scan.showRoom,
        },
      }),
    },
  ),
);

export const cm = (m) => (m == null || Number.isNaN(m) ? '' : Math.round(m * 1000) / 10);
