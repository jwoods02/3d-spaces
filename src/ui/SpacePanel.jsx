import { useState } from 'react';
import * as THREE from 'three';
import { useStore, FIXTURE_TYPES, cm, scanIsRoom } from '../store.js';
import { WALLS, WALL_IDS, activeWalls } from '../geometry.js';
import { CmField, Select } from './fields.jsx';
import { uploadScan, removeScan } from '../scanActions.js';

function ScanSection() {
  const scan = useStore((s) => s.scan);
  const measure = useStore((s) => s.measure);
  const setScan = useStore((s) => s.setScan);
  const setScanPose = useStore((s) => s.setScanPose);
  const [real, setReal] = useState('');

  const pts = measure?.points;
  const measured = pts?.length === 2 ? new THREE.Vector3(...pts[0]).distanceTo(new THREE.Vector3(...pts[1])) : null;
  const scale = scan?.scale || 1;

  return (
    <>
      <h3>iPhone scan</h3>
      {!scan?.url && (
        <p className="small">
          Scan the space in <b>Scaniverse</b> (free, choose Mesh) or Polycam, export as <b>GLB</b> and upload it here. OBJ, PLY and USDZ also open.
        </p>
      )}
      <label className="file block">
        {scan?.name ? `Replace ${scan.name}` : 'Upload scan…'}
        <input type="file" accept=".glb,.gltf,.obj,.ply,.usdz" hidden onChange={(e) => uploadScan(e.target.files[0])} />
      </label>
      {scan?.error && <p className="error">{scan.error}</p>}
      {scan?.url && (
        <>
          {scan.size && (
            <p className="small">
              {cm(scan.size[0] * scale)} × {cm(scan.size[2] * scale)} cm floor area, {cm(scan.size[1] * scale)} cm tall. Levelled and squared up
              automatically{scan.autoTurn ? ` (turned ${Math.abs(scan.autoTurn).toFixed(1)}°)` : ''}.
            </p>
          )}

          <h3>Check the scale</h3>
          {measured ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                const r = Number(real) / 100;
                if (r > 0) setScanPose({ scale: (scale * r) / measured });
                setReal('');
              }}
            >
              <span className="small">Tape says {cm(measured)} cm. Real length:</span>
              <div className="unit grow">
                <input type="number" step="0.1" value={real} onChange={(e) => setReal(e.target.value)} placeholder={String(cm(measured))} />
                <em>cm</em>
              </div>
              <button type="submit" disabled={!(Number(real) > 0)}>
                Fix scale
              </button>
            </form>
          ) : (
            <p className="small">Use the tape measure on something you know, like the radiator's width, then type its real length here.</p>
          )}
          {scale !== 1 && (
            <p className="small">
              Scale {(scale * 100).toFixed(1)}%{' '}
              <button className="link" onClick={() => setScanPose({ scale: 1 })}>
                reset
              </button>
            </p>
          )}

          <h3>Turn</h3>
          <p className="small">Turns the scan so a different wall is the back wall. Anything placed turns with it.</p>
          <div className="row">
            <button onClick={() => setScanPose({ rotation: ((scan.rotation || 0) + 270) % 360 })}>⟲ 90°</button>
            <button onClick={() => setScanPose({ rotation: ((scan.rotation || 0) + 359) % 360 })}>⟲ 1°</button>
            <button onClick={() => setScanPose({ rotation: ((scan.rotation || 0) + 1) % 360 })}>⟳ 1°</button>
            <button onClick={() => setScanPose({ rotation: ((scan.rotation || 0) + 90) % 360 })}>⟳ 90°</button>
          </div>
          <div className="checks">
            <label>
              <input type="checkbox" checked={scan.visible !== false} onChange={(e) => setScan({ visible: e.target.checked })} /> Show scan
            </label>
            <label>
              <input type="checkbox" checked={scan.showRoom === true} onChange={(e) => setScan({ showRoom: e.target.checked })} /> Use measured room instead
            </label>
          </div>
          <button className="ghost" onClick={() => confirm('Remove the scan and anything placed on it?') && removeScan()}>
            Remove scan
          </button>
        </>
      )}
    </>
  );
}

function MeasuredRoom() {
  const space = useStore((s) => s.space);
  const setSpace = useStore((s) => s.setSpace);
  const setWalls = useStore((s) => s.setWalls);
  const addFixture = useStore((s) => s.addFixture);
  const updateFixture = useStore((s) => s.updateFixture);
  const removeFixture = useStore((s) => s.removeFixture);
  const resetSpace = useStore((s) => s.resetSpace);
  const walls = activeWalls(space);

  return (
    <>
      <h3>Measured room</h3>
      <p className="small">Without a scan, type the room's real measurements in here. Everything is 1:1.</p>
      <label className="field">
        <span>Name</span>
        <input value={space.name} onChange={(e) => setSpace({ name: e.target.value })} />
      </label>
      <div className="grid3">
        <CmField label="Width" value={space.width} onChange={(width) => width > 0 && setSpace({ width })} title="Left to right along the back wall" />
        <CmField label="Depth" value={space.depth} onChange={(depth) => depth > 0 && setSpace({ depth })} title="Back wall to front" />
        <CmField label="Ceiling" value={space.height} onChange={(height) => height > 0 && setSpace({ height })} />
      </div>
      <div className="checks">
        {WALL_IDS.map((id) => (
          <label key={id}>
            <input type="checkbox" checked={!!space.walls[id]} onChange={(e) => setWalls({ [id]: e.target.checked })} />
            {WALLS[id].label.replace(' wall', '')}
          </label>
        ))}
      </div>
      <div className="grid2">
        <CmField label="Skirting height" value={space.skirting.height} onChange={(height) => setSpace({ skirting: { ...space.skirting, height } })} />
        <CmField label="Skirting depth" value={space.skirting.depth} onChange={(depth) => setSpace({ skirting: { ...space.skirting, depth } })} />
      </div>

      <h3>On the walls</h3>
      <p className="small">Positions are the fixture's left edge from the left end of the wall (as you face it) and its bottom edge from the floor.</p>
      {space.fixtures.map((f) => (
        <div key={f.id} className="fixture">
          <div className="row">
            <input className="grow" value={f.label} onChange={(e) => updateFixture(f.id, { label: e.target.value })} />
            <select value={f.wall} onChange={(e) => updateFixture(f.id, { wall: e.target.value })}>
              {WALL_IDS.map((w) => (
                <option key={w} value={w} disabled={!space.walls[w]}>
                  {WALLS[w].label}
                </option>
              ))}
            </select>
            <button className="ghost" onClick={() => removeFixture(f.id)} aria-label="Remove">
              ✕
            </button>
          </div>
          <div className="grid5">
            <CmField label="From left" value={f.u} onChange={(u) => updateFixture(f.id, { u })} />
            <CmField label="From floor" value={f.v} onChange={(v) => updateFixture(f.id, { v })} />
            <CmField label="W" value={f.w} onChange={(w) => w > 0 && updateFixture(f.id, { w })} />
            <CmField label="H" value={f.h} onChange={(h) => h > 0 && updateFixture(f.id, { h })} />
            <CmField label="Sticks out" value={f.d} onChange={(d) => updateFixture(f.id, { d })} />
          </div>
        </div>
      ))}
      {walls.length > 0 && (
        <Select
          label="Add to the wall"
          value=""
          onChange={(type) => type && addFixture(type, walls[0])}
          options={[['', 'Choose…'], ...Object.entries(FIXTURE_TYPES).map(([k, t]) => [k, t.label])]}
        />
      )}
      <button className="ghost" onClick={() => confirm('Reset the measured room to the example hallway corner?') && resetSpace()}>
        Reset to example room
      </button>
    </>
  );
}

export default function SpacePanel() {
  const setPanel = useStore((s) => s.setPanel);
  const isScan = useStore(scanIsRoom);
  return (
    <aside className="panel space">
      <header>
        <h2>Space</h2>
        <button className="ghost" onClick={() => setPanel(null)} aria-label="Close">
          ✕
        </button>
      </header>
      <ScanSection />
      {!isScan && <MeasuredRoom />}
    </aside>
  );
}
