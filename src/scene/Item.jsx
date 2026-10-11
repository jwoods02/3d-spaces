import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Html, Edges } from '@react-three/drei';
import { useStore, cm } from '../store.js';
import { itemTransform } from '../geometry.js';

export const imageSrc = (url) =>
  !url ? null : url.startsWith('data:') || url.startsWith('blob:') ? url : `/api/image?url=${encodeURIComponent(url)}`;

const cache = new Map();

// Draws the product photo onto a canvas with the same aspect as the box's
// front face ("contain" fit), filling the rest with the photo's corner colour,
// so it doesn't look stretched.
function useFaceTexture(image, w, h) {
  const [tex, setTex] = useState(null);
  useEffect(() => {
    const src = imageSrc(image);
    if (!src) return setTex(null);
    let cancelled = false;
    const key = `${src}|${w.toFixed(3)}|${h.toFixed(3)}`;
    if (cache.has(key)) return setTex(cache.get(key));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const scale = 512 / Math.max(w, h);
      const cw = Math.max(16, Math.round(w * scale));
      const ch = Math.max(16, Math.round(h * scale));
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const ctx = c.getContext('2d');
      const probe = document.createElement('canvas');
      probe.width = probe.height = 1;
      const pctx = probe.getContext('2d');
      pctx.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, cw, ch);
      const k = Math.min(cw / img.width, ch / img.height);
      const dw = img.width * k;
      const dh = img.height * k;
      ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      cache.set(key, t);
      setTex(t);
    };
    img.onerror = () => !cancelled && setTex(null);
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [image, w, h]);
  return tex;
}

export function ProductBox({ product, ghost = false, highlight = null }) {
  const { width: w, height: h, depth: d } = product;
  const tex = useFaceTexture(product.image, w, h);
  const color = product.color || '#9a8f84';
  const mats = useMemo(() => {
    const opts = { transparent: ghost, opacity: ghost ? 0.6 : 1, roughness: 0.7 };
    const side = new THREE.MeshStandardMaterial({ color, ...opts });
    const front = new THREE.MeshStandardMaterial({ color: tex ? '#ffffff' : color, map: tex, ...opts, roughness: 0.8 });
    // Box faces: +x, -x, +y, -y, +z (front), -z
    return [side, side, side, side, front, side];
  }, [tex, color, ghost]);
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);

  return (
    <mesh material={mats} castShadow={!ghost} receiveShadow>
      <boxGeometry args={[w, h, d]} />
      {highlight && <Edges color={highlight} lineWidth={2} scale={1.002} />}
    </mesh>
  );
}

export default function Item({ item, product, colliding }) {
  const space = useStore((s) => s.space);
  const selected = useStore((s) => s.selectedId === item.id);
  const dragging = useStore((s) => s.drag?.itemId === item.id);
  const select = useStore((s) => s.select);
  const setDrag = useStore((s) => s.setDrag);
  const { center, rotY } = itemTransform(space, product, item);

  const highlight = colliding ? '#e5484d' : selected ? '#3b82f6' : null;

  return (
    <group
      position={center}
      rotation={[0, rotY, 0]}
      onPointerDown={(e) => {
        if (e.button !== 0 || useStore.getState().drag) return;
        e.stopPropagation();
        select(item.id);
        setDrag({ mode: 'move', itemId: item.id, startX: e.clientX, startY: e.clientY });
      }}
    >
      <ProductBox product={product} highlight={highlight} />
      {(selected || dragging) && (
        <Html position={[0, product.height / 2 + 0.06, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`tag ${colliding ? 'tag-bad' : ''}`}>
            {cm(product.width)} × {cm(product.height)} × {cm(product.depth)} cm
            {item.kind === 'wall' && <span> · bottom {cm(item.v)} cm up</span>}
          </div>
        </Html>
      )}
    </group>
  );
}
