import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { useStore, roomSpace, useRoomSpace, viewFrame, scanIsRoom } from '../store.js';
import { clampItem, collisions, wallFrame, itemTransform, frontFromRot } from '../geometry.js';
import { onWallPlane } from '../scan.js';
import { hitsScan, snapFloorOnScan, squareUp } from '../scanPlacement.js';
import Measure from './Measure.jsx';
import Room from './Room.jsx';
import Item, { ProductBox } from './Item.jsx';
import Scan from './Scan.jsx';

const isVisible = (o) => {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};
const targetOf = (o) => {
  for (let n = o; n; n = n.parent) if (n.userData?.target) return n.userData.target;
  return null;
};

// Works out where a product would go under the cursor: on a wall for
// wall-mounted things, on the floor for the rest.
function placementFromHit(space, product, hit, prev, rayDir) {
  const t = targetOf(hit.object);
  const p = hit.point;
  // Scan faces can point either way; use the side facing the camera.
  const scanNormal = () => {
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    return n.dot(rayDir) > 0 ? n.negate() : n;
  };
  if (product.mount === 'wall') {
    if (t.type === 'wall') {
      const f = wallFrame(space, t.wall);
      const u = p.clone().sub(f.origin).dot(f.dir);
      return clampItem(space, product, { kind: 'wall', wall: t.wall, u: u - product.width / 2, v: p.y - product.height / 2 });
    }
    if (t.type === 'scan') {
      const n = scanNormal();
      if (Math.abs(n.y) > 0.5) return null;
      const rot = squareUp(Math.atan2(n.x, n.z));
      const at = onWallPlane(p, frontFromRot(rot));
      return { kind: 'surface', onWall: true, x: at.x, y: p.y - product.height / 2, z: at.z, rot };
    }
    return null;
  }
  const rot = prev?.kind === 'floor' || prev?.kind === 'surface' ? prev.rot : 0;
  if (t.type === 'floor' || t.type === 'wall') {
    return clampItem(space, product, { kind: 'floor', x: p.x, z: p.z, rot }, { autoRotate: !prev?.manualRot });
  }
  if (t.type === 'scan') {
    if (scanNormal().y < 0.6) return null;
    return snapFloorOnScan(product, { kind: 'surface', onWall: false, x: p.x, y: p.y, z: p.z, rot }, { autoRotate: !prev?.manualRot });
  }
  return null;
}

// When the click that drops an item lands, three.js also reports it as a
// click on empty space; this stops that from deselecting the new item.
let placedAt = 0;

function DragController() {
  const { camera, gl, scene } = useThree();
  const drag = useStore((s) => s.drag);
  const products = useStore((s) => s.products);
  const [ghost, setGhost] = useState(null);
  const ray = useMemo(() => new THREE.Raycaster(), []);

  useEffect(() => {
    if (!drag) return setGhost(null);
    const el = gl.domElement;
    const state = useStore.getState();
    const moving = drag.mode === 'move' ? state.items.find((i) => i.id === drag.itemId) : null;
    const product = state.products.find((p) => p.id === (moving ? moving.productId : drag.productId));
    if (!product) return;
    let last = moving;
    let moved = false;

    const hitAt = (e) => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.intersectObjects(scene.children, true).find((h) => targetOf(h.object) && isVisible(h.object));
    };
    const onMove = (e) => {
      if (drag.mode === 'move' && !moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
      moved = true;
      const hit = hitAt(e);
      if (!hit) return;
      const s = useStore.getState();
      const next = placementFromHit(s.space, product, hit, last, ray.ray.direction);
      if (!next) return;
      if (drag.mode === 'move') {
        last = { ...last, ...next, manualRot: last.manualRot };
        s.updateItem(drag.itemId, next);
      } else {
        last = next;
        setGhost({ product, item: next });
      }
    };
    const onDown = (e) => {
      if (drag.mode !== 'place' || e.button !== 0) return;
      const hit = hitAt(e);
      const s = useStore.getState();
      const spot = hit ? placementFromHit(s.space, product, hit, last, ray.ray.direction) : last;
      if (spot) s.addItem({ productId: product.id, ...spot });
      s.setDrag(null);
      placedAt = performance.now();
    };
    const onUp = () => {
      if (drag.mode === 'move') useStore.getState().setDrag(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') useStore.getState().setDrag(null);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [drag, camera, gl, scene, ray, products]);

  if (!ghost) return null;
  const state = useStore.getState();
  const space = roomSpace(state);
  const { center, rotY } = itemTransform(space, ghost.product, ghost.item);
  const blocked =
    collisions(space, products, state.items.filter(forRoom(scanIsRoom(state))), { id: 'ghost', productId: ghost.product.id, ...ghost.item }).length > 0 ||
    hitsScan(ghost.product, ghost.item);
  return (
    <group position={center} rotation={[0, rotY, 0]}>
      <ProductBox product={ghost.product} ghost highlight={blocked ? '#e5484d' : '#3b82f6'} />
    </group>
  );
}

// Moves the camera when a view button is pressed: a 3D overview, or square on
// to one wall so it can be checked against a photo or tape measure.
function CameraRig({ controls }) {
  const { camera, size } = useThree();
  const view = useStore((s) => s.view);
  const frameKey = useStore((s) => `${s.scan?.url}|${Boolean(s.scan?.bounds)}|${s.scan?.showRoom}`);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const f = viewFrame(useStore.getState());
    const w = f.maxX - f.minX;
    const d = f.maxZ - f.minZ;
    const cx = (f.minX + f.maxX) / 2;
    const cz = (f.minZ + f.maxZ) / 2;
    const target = new THREE.Vector3();
    if (view === '3d') {
      camera.position.set(f.maxX + 1.6, 1.9, f.maxZ + 2.4);
      target.set(f.minX + w * 0.4, 1.0, f.minZ + d * 0.35);
    } else {
      const sides = {
        back: { mid: [cx, f.minZ], normal: [0, 1], length: w },
        front: { mid: [cx, f.maxZ], normal: [0, -1], length: w },
        left: { mid: [f.minX, cz], normal: [1, 0], length: d },
        right: { mid: [f.maxX, cz], normal: [-1, 0], length: d },
      };
      const side = sides[view];
      const vfov = THREE.MathUtils.degToRad(camera.fov);
      const fitH = f.height / 2 / Math.tan(vfov / 2);
      const fitW = side.length / 2 / Math.tan(vfov / 2) / (size.width / size.height);
      const dist = Math.max(fitH, fitW) * 1.15;
      target.set(side.mid[0], f.height / 2, side.mid[1]);
      camera.position.set(side.mid[0] + side.normal[0] * dist, f.height / 2, side.mid[1] + side.normal[1] * dist);
    }
    c.target.copy(target);
    c.update();
  }, [view, controls, camera, frameKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Items belong either to the scan or to the measured room; only the ones for
// whichever is showing are drawn.
const forRoom = (isScan) => (it) => (it.kind === 'surface') === isScan;

function Items() {
  const space = useRoomSpace();
  const isScan = useStore(scanIsRoom);
  const items = useStore((s) => s.items);
  const products = useStore((s) => s.products);
  const shown = items.filter(forRoom(isScan));
  return shown.map((it) => {
    const p = products.find((x) => x.id === it.productId);
    if (!p) return null;
    const colliding = collisions(space, products, shown, it).length > 0 || hitsScan(p, it);
    return <Item key={it.id} item={it} product={p} colliding={colliding} />;
  });
}

export default function Scene() {
  const controls = useRef();
  const drag = useStore((s) => s.drag);
  const select = useStore((s) => s.select);
  const frame = JSON.parse(useStore((s) => JSON.stringify(viewFrame(s))));
  const cx = (frame.minX + frame.maxX) / 2;
  const cz = (frame.minZ + frame.maxZ) / 2;
  const span = Math.max(frame.maxX - frame.minX, frame.maxZ - frame.minZ, 1);

  return (
    <Canvas
      shadows
      camera={{ fov: 45, near: 0.02, far: 100, position: [4, 2, 4] }}
      onPointerMissed={(e) => e.button === 0 && !useStore.getState().drag && performance.now() - placedAt > 400 && select(null)}
      style={{ cursor: drag?.mode === 'place' ? 'copy' : 'auto' }}
    >
      <color attach="background" args={['#eef0f3']} />
      <hemisphereLight args={['#ffffff', '#d8d2c8', 1.1]} />
      <directionalLight
        position={[frame.maxX + 2, 4, frame.maxZ + 3]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-span * 2}
        shadow-camera-right={span * 2}
        shadow-camera-top={span * 2}
        shadow-camera-bottom={-span * 2}
        shadow-bias={-0.0005}
      />
      <Room />
      <Scan />
      <Items />
      <ContactShadows position={[cx, 0.002, cz]} scale={span * 2} opacity={0.35} blur={2} far={1.5} />
      <DragController />
      <Measure />
      <OrbitControls ref={controls} makeDefault enabled={!drag} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={0.3} maxDistance={15} />
      <CameraRig controls={controls} />
    </Canvas>
  );
}

