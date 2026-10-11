import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { loadScanFile, analyseScan, prepareMeshes, findWallPlanes, scanRef } from '../scan.js';

// Shows the uploaded LiDAR scan at real size (scan apps export in metres).
// On load it's levelled so the floor is at y = 0, turned so the walls run
// along the x/z axes, and its footprint is put in the room's back-left
// corner. The space panel can turn, nudge and rescale it from there.
export default function Scan() {
  const scan = useStore((s) => s.scan);
  const setScan = useStore((s) => s.setScan);
  const [object, setObject] = useState(null);
  const group = useRef();

  useEffect(() => {
    if (!scan?.url) {
      scanRef.meshes = [];
      scanRef.root = null;
      return setObject(null);
    }
    let cancelled = false;
    setScan({ loading: true, error: null });
    loadScanFile(scan.url, scan.name)
      .then((obj) => {
        if (cancelled) return;
        const { turnDeg, floorY, facesInward } = analyseScan(obj);
        const aligned = new THREE.Group();
        aligned.rotation.y = (turnDeg * Math.PI) / 180;
        aligned.add(obj);
        aligned.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(aligned);
        const size = box.getSize(new THREE.Vector3());
        const mid = box.getCenter(new THREE.Vector3());
        // Centre it on its own footprint so turning spins it in place.
        const wrapper = new THREE.Group();
        aligned.position.set(-mid.x, -floorY, -mid.z);
        wrapper.add(aligned);
        wrapper.userData.target = { type: 'scan' };
        scanRef.meshes = prepareMeshes(obj, facesInward);
        scanRef.root = wrapper;
        scanRef.planes = findWallPlanes(wrapper);
        setObject(wrapper);
        const prev = useStore.getState().scan;
        setScan({
          loading: false,
          size: [size.x, box.max.y - floorY, size.z],
          autoTurn: turnDeg,
          offset: prev?.offset || [size.x / 2, 0, size.z / 2],
          scale: prev?.scale || 1,
          rotation: prev?.rotation || 0,
        });
      })
      .catch((err) => !cancelled && setScan({ loading: false, error: `Couldn't open the scan: ${err.message}` }));
    return () => {
      cancelled = true;
      scanRef.meshes = [];
    };
  }, [scan?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the scan's world-space bounds in the store for camera framing.
  const pose = scan && JSON.stringify([scan.offset, scan.rotation, scan.scale]);
  useLayoutEffect(() => {
    if (!group.current || !object) return;
    group.current.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(group.current);
    if (!b.isEmpty()) setScan({ bounds: [b.min.toArray(), b.max.toArray()] });
  }, [object, pose]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!object) return null;
  const [ox, oy, oz] = scan.offset || [0, 0, 0];
  const rot = ((scan.rotation || 0) * Math.PI) / 180;
  const s = scan.scale || 1;
  return (
    <group ref={group} position={[ox, oy, oz]} rotation={[0, rot, 0]} scale={[s, s, s]} visible={scan.visible !== false}>
      <primitive object={object} />
    </group>
  );
}
