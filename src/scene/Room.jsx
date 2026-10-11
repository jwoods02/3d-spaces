import { useMemo } from 'react';
import * as THREE from 'three';
import { Grid } from '@react-three/drei';
import { useStore, scanIsRoom } from '../store.js';
import { activeWalls, wallFrame, wallBoxTransform } from '../geometry.js';

function Wall({ space, id }) {
  const f = wallFrame(space, id);
  const center = f.origin.clone().addScaledVector(f.dir, f.length / 2);
  center.y = space.height / 2;
  const sk = space.skirting;
  const skCenter = f.origin.clone().addScaledVector(f.dir, f.length / 2).addScaledVector(f.normal, sk.depth / 2);
  skCenter.y = sk.height / 2;

  return (
    <group>
      {/* Plane faces into the room, so from outside it's see-through. */}
      <mesh position={center} rotation={[0, f.rotY, 0]} receiveShadow userData={{ target: { type: 'wall', wall: id } }}>
        <planeGeometry args={[f.length, space.height]} />
        <meshStandardMaterial color={space.wallColor} roughness={0.95} />
      </mesh>
      {sk.height > 0 && (
        <mesh position={skCenter} rotation={[0, f.rotY, 0]} castShadow receiveShadow>
          <boxGeometry args={[f.length, sk.height, sk.depth]} />
          <meshStandardMaterial color="#f4f2ee" roughness={0.6} />
        </mesh>
      )}
      <lineSegments position={center} rotation={[0, f.rotY, 0]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(f.length, space.height)]} />
        <lineBasicMaterial color="#b9b2a4" />
      </lineSegments>
    </group>
  );
}

function Fixture({ space, f }) {
  const { center, rotY } = wallBoxTransform(space, f, f);
  const parts = useMemo(() => fixtureParts(f), [f]);
  return (
    <group position={center} rotation={[0, rotY, 0]} userData={{ fixtureId: f.id }}>
      {parts.map((p, i) => (
        <mesh key={i} position={p.pos} castShadow receiveShadow>
          <boxGeometry args={p.size} />
          <meshStandardMaterial color={p.color} roughness={p.rough ?? 0.5} metalness={p.metal ?? 0} transparent={p.opacity != null} opacity={p.opacity ?? 1} />
        </mesh>
      ))}
    </group>
  );
}

// Simple shapes so each fixture is recognisable. Local origin is the centre
// of the fixture's box, front facing +z.
function fixtureParts({ type, w, h, d }) {
  const white = '#f7f7f5';
  switch (type) {
    case 'radiator': {
      const panelD = Math.min(0.05, d);
      const z = d / 2 - panelD / 2;
      const fins = [];
      const n = Math.max(3, Math.round(w / 0.045));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (w / n) * (i + 0.5);
        fins.push({ pos: [x, -0.01, z + panelD / 2 + 0.002], size: [0.012, h * 0.9, 0.004], color: '#e4e4e0' });
      }
      return [
        { pos: [0, 0, z], size: [w, h, panelD], color: white, rough: 0.35 },
        { pos: [0, h / 2 - 0.01, z - 0.005], size: [w * 0.98, 0.012, panelD], color: '#d8d8d4' },
        ...fins,
        { pos: [-w / 2 - 0.03, -h / 2 + 0.02, 0], size: [0.025, 0.06, 0.025], color: '#c9c9c9', metal: 0.6, rough: 0.3 },
        { pos: [w / 2 + 0.03, -h / 2 + 0.02, 0], size: [0.025, 0.06, 0.025], color: white },
      ];
    }
    case 'switch':
      return [
        { pos: [0, 0, 0], size: [w, h, d], color: '#ececea' },
        { pos: [0, 0, d / 2 + 0.002], size: [w * 0.22, h * 0.32, 0.006], color: white },
      ];
    case 'socket':
      return [
        { pos: [0, 0, 0], size: [w, h, d], color: '#f2f2f0' },
        { pos: [-w * 0.22, 0, d / 2 + 0.001], size: [w * 0.28, h * 0.45, 0.002], color: '#d0d0cc' },
        { pos: [w * 0.22, 0, d / 2 + 0.001], size: [w * 0.28, h * 0.45, 0.002], color: '#d0d0cc' },
      ];
    case 'window':
      return [
        { pos: [0, 0, 0], size: [w, h, d], color: '#cfe3f2', opacity: 0.55, rough: 0.1 },
        { pos: [0, h / 2, d / 2], size: [w + 0.06, 0.04, 0.03], color: white },
        { pos: [0, -h / 2, d / 2], size: [w + 0.1, 0.04, 0.05], color: white },
        { pos: [-w / 2, 0, d / 2], size: [0.04, h, 0.03], color: white },
        { pos: [w / 2, 0, d / 2], size: [0.04, h, 0.03], color: white },
      ];
    case 'door':
      return [
        { pos: [0, 0, 0], size: [w, h, d], color: '#e8e4dc' },
        { pos: [w / 2 - 0.07, -h / 2 + 1.0, d / 2 + 0.02], size: [0.11, 0.02, 0.03], color: '#a8a8a8', metal: 0.7, rough: 0.3 },
      ];
    case 'box':
      return [
        { pos: [0, 0, 0], size: [w, h, d], color: white, rough: 0.4 },
        { pos: [0, h * 0.05, d / 2 + 0.001], size: [w * 0.8, h * 0.02, 0.002], color: '#dcdcd8' },
      ];
    default:
      return [{ pos: [0, 0, 0], size: [w, h, d], color: '#cfcac0' }];
  }
}

export default function Room() {
  const space = useStore((s) => s.space);
  const showRoom = useStore((s) => !scanIsRoom(s));
  const walls = activeWalls(space);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[space.width / 2, 0, space.depth / 2]} userData={{ target: { type: 'floor' } }} visible={showRoom}>
        <planeGeometry args={[space.width, space.depth]} />
        <meshStandardMaterial color={space.floorColor} roughness={0.85} />
      </mesh>
      <Grid
        position={[space.width / 2, 0.001, space.depth / 2]}
        args={[space.width, space.depth]}
        cellSize={0.1}
        sectionSize={0.5}
        cellColor="#b8ad9c"
        sectionColor="#a3967f"
        fadeDistance={20}
        visible={showRoom}
      />
      {showRoom && walls.map((id) => <Wall key={id} space={space} id={id} />)}
      {showRoom && space.useFixtures !== false && space.fixtures.map((f) => <Fixture key={f.id} space={space} f={f} />)}
    </group>
  );
}
