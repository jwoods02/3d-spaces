import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js';
import { useStore } from '../store.js';

async function loadScan(url, name) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'glb' || ext === 'gltf') return (await new GLTFLoader().loadAsync(url)).scene;
  if (ext === 'obj') return await new OBJLoader().loadAsync(url);
  if (ext === 'usdz') return await new USDZLoader().loadAsync(url);
  if (ext === 'ply') {
    const geo = await new PLYLoader().loadAsync(url);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: geo.hasAttribute('color'), color: geo.hasAttribute('color') ? '#fff' : '#ccc' });
    return new THREE.Mesh(geo, mat);
  }
  throw new Error(`Can't open .${ext} files. Export the scan as GLB if you can.`);
}

// Shows an uploaded LiDAR scan at real size (scan apps export in metres).
// It starts with its lowest point on the floor and its bounding box in the
// room's back-left corner; the space panel can turn and nudge it from there.
export default function Scan() {
  const scan = useStore((s) => s.scan);
  const setScan = useStore((s) => s.setScan);
  const [object, setObject] = useState(null);

  useEffect(() => {
    if (!scan?.url) return setObject(null);
    let cancelled = false;
    loadScan(scan.url, scan.name)
      .then((obj) => {
        if (cancelled) return;
        obj.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;
            o.receiveShadow = true;
            const ms = [].concat(o.material);
            ms.forEach((m) => (m.side = THREE.DoubleSide));
          }
        });
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        const mid = box.getCenter(new THREE.Vector3());
        // Centre it on its own footprint so rotating spins it in place.
        obj.position.sub(new THREE.Vector3(mid.x, box.min.y, mid.z));
        const wrapper = new THREE.Group();
        wrapper.add(obj);
        wrapper.userData.target = { type: 'scan' };
        setObject(wrapper);
        const prev = useStore.getState().scan;
        setScan({
          size: [size.x, size.y, size.z],
          offset: prev?.offset || [size.x / 2, 0, size.z / 2],
          error: null,
        });
      })
      .catch((err) => !cancelled && setScan({ error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [scan?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!object || scan?.visible === false) return null;
  const [ox, oy, oz] = scan.offset || [0, 0, 0];
  const rot = ((scan.rotation || 0) * Math.PI) / 180;
  return (
    <group position={[ox, oy, oz]} rotation={[0, rot, 0]}>
      <primitive object={object} />
    </group>
  );
}
