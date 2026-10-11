import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { useStore, cm } from '../store.js';

const targetOf = (o) => {
  for (let n = o; n; n = n.parent) if (n.userData?.target) return n.userData.target;
  return null;
};
const isVisible = (o) => {
  for (let n = o; n; n = n.parent) if (!n.visible) return false;
  return true;
};

// Tape measure: click two points on the scan (or walls/floor) to see the
// distance between them. Used to check the scan against a real tape.
export default function Measure() {
  const { camera, gl, scene } = useThree();
  const measure = useStore((s) => s.measure);
  const setMeasure = useStore((s) => s.setMeasure);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const active = Boolean(measure?.active);

  useEffect(() => {
    if (!active) return;
    const el = gl.domElement;
    let down = null;
    const onDown = (e) => (down = [e.clientX, e.clientY]);
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const r = el.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
        camera,
      );
      const hit = ray.intersectObjects(scene.children, true).find((h) => targetOf(h.object) && isVisible(h.object));
      if (!hit) return;
      const m = useStore.getState().measure;
      const points = m.points?.length === 1 ? [m.points[0], hit.point.toArray()] : [hit.point.toArray()];
      setMeasure({ ...m, points });
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [active, camera, gl, scene, ray, setMeasure]);

  if (!measure?.points?.length) return null;
  const [a, b] = measure.points;
  const dist = b ? new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b)) : null;
  const mid = b && new THREE.Vector3(...a).add(new THREE.Vector3(...b)).multiplyScalar(0.5);
  return (
    <group>
      {[a, b].filter(Boolean).map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.012, 16, 16]} />
          <meshBasicMaterial color="#f59e0b" depthTest={false} />
        </mesh>
      ))}
      {b && (
        <>
          <Line points={[a, b]} color="#f59e0b" lineWidth={3} depthTest={false} />
          <Html position={mid} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
            <div className="tag tag-measure">{cm(dist)} cm</div>
          </Html>
        </>
      )}
    </group>
  );
}
