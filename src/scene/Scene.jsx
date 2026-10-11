import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { useStore } from '../store.js';
import { clampItem, collisions, wallFrame, itemTransform } from '../geometry.js';
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
function placementFromHit(space, product, hit, prev) {
  const t = targetOf(hit.object);
  const p = hit.point;
  if (product.mount === 'wall') {
    if (t.type === 'wall') {
      const f = wallFrame(space, t.wall);
      const u = p.clone().sub(f.origin).dot(f.dir);
      return clampItem(space, product, { kind: 'wall', wall: t.wall, u: u - product.width / 2, v: p.y - product.height / 2 });
    }
    if (t.type === 'scan') {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (Math.abs(n.y) > 0.5) return null;
      return { kind: 'surface', onWall: true, x: p.x, y: p.y - product.height / 2, z: p.z, rot: Math.atan2(n.x, n.z) };
    }
    return null;
  }
  const rot = prev?.kind === 'floor' || prev?.kind === 'surface' ? prev.rot : 0;
  if (t.type === 'floor' || t.type === 'wall') {
    return clampItem(space, product, { kind: 'floor', x: p.x, z: p.z, rot }, { autoRotate: !prev?.manualRot });
  }
  if (t.type === 'scan') {
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (n.y < 0.6) return null;
    return { kind: 'surface', onWall: false, x: p.x, y: p.y, z: p.z, rot };
  }
  return null;
}

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
      const next = placementFromHit(s.space, product, hit, last);
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
      const spot = hit ? placementFromHit(s.space, product, hit, last) : last;
      if (spot) s.addItem({ productId: product.id, ...spot });
      s.setDrag(null);
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
  const { space, items } = useStore.getState();
  const { center, rotY } = itemTransform(space, ghost.product, ghost.item);
  const blocked = collisions(space, products, items, { id: 'ghost', productId: ghost.product.id, ...ghost.item }).length > 0;
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
  const space = useStore((s) => s.space);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const target = new THREE.Vector3(space.width / 2, space.height / 2 - 0.1, space.depth / 2);
    if (view === '3d') {
      camera.position.set(space.width + 1.6, 1.9, space.depth + 2.4);
      target.set(space.width * 0.4, 1.0, space.depth * 0.35);
    } else {
      const f = wallFrame(space, view);
      const mid = f.origin.clone().addScaledVector(f.dir, f.length / 2);
      mid.y = space.height / 2;
      const vfov = THREE.MathUtils.degToRad(camera.fov);
      const aspect = size.width / size.height;
      const fitH = space.height / 2 / Math.tan(vfov / 2);
      const fitW = f.length / 2 / Math.tan(vfov / 2) / aspect;
      const dist = Math.max(fitH, fitW) * 1.15;
      target.copy(mid);
      camera.position.copy(mid).addScaledVector(f.normal, dist);
    }
    c.target.copy(target);
    c.update();
  }, [view, controls, camera]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Items() {
  const space = useStore((s) => s.space);
  const items = useStore((s) => s.items);
  const products = useStore((s) => s.products);
  return items.map((it) => {
    const p = products.find((x) => x.id === it.productId);
    if (!p) return null;
    const colliding = collisions(space, products, items, it).length > 0;
    return <Item key={it.id} item={it} product={p} colliding={colliding} />;
  });
}

export default function Scene() {
  const controls = useRef();
  const drag = useStore((s) => s.drag);
  const select = useStore((s) => s.select);
  const space = useStore((s) => s.space);

  return (
    <Canvas
      shadows
      camera={{ fov: 45, near: 0.02, far: 100, position: [4, 2, 4] }}
      onPointerMissed={(e) => e.button === 0 && !useStore.getState().drag && select(null)}
      style={{ cursor: drag?.mode === 'place' ? 'copy' : 'auto' }}
    >
      <color attach="background" args={['#eef0f3']} />
      <hemisphereLight args={['#ffffff', '#d8d2c8', 1.1]} />
      <directionalLight
        position={[space.width + 2, 4, space.depth + 3]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-bias={-0.0005}
      />
      <Room />
      <Scan />
      <Items />
      <ContactShadows position={[space.width / 2, 0.002, space.depth / 2]} scale={Math.max(space.width, space.depth) * 2} opacity={0.35} blur={2} far={1.5} />
      <DragController />
      <OrbitControls ref={controls} makeDefault enabled={!drag} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={0.3} maxDistance={15} />
      <CameraRig controls={controls} />
    </Canvas>
  );
}

