import { useStore, FIXTURE_TYPES, cm } from '../store.js';
import { WALLS, WALL_IDS, activeWalls } from '../geometry.js';
import { CmField, Select } from './fields.jsx';
import { saveScan, clearScan } from '../idb.js';

export default function SpacePanel() {
  const space = useStore((s) => s.space);
  const scan = useStore((s) => s.scan);
  const setSpace = useStore((s) => s.setSpace);
  const setWalls = useStore((s) => s.setWalls);
  const addFixture = useStore((s) => s.addFixture);
  const updateFixture = useStore((s) => s.updateFixture);
  const removeFixture = useStore((s) => s.removeFixture);
  const setScan = useStore((s) => s.setScan);
  const setPanel = useStore((s) => s.setPanel);
  const resetSpace = useStore((s) => s.resetSpace);
  const walls = activeWalls(space);

  async function onScan(file) {
    if (!file) return;
    if (scan?.url) URL.revokeObjectURL(scan.url);
    await saveScan(file).catch(() => {});
    useStore.setState({ scan: null });
    setScan({ url: URL.createObjectURL(file), name: file.name, rotation: 0, visible: true, showRoom: false });
  }
  const nudge = (i, d) => {
    const o = [...(scan.offset || [0, 0, 0])];
    o[i] += d;
    setScan({ offset: o });
  };

  return (
    <aside className="panel space">
      <header>
        <h2>Space</h2>
        <button className="ghost" onClick={() => setPanel(null)} aria-label="Close">
          ✕
        </button>
      </header>
      <p className="small">Measure with a tape and type the real numbers in. Everything is 1:1.</p>

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

      <h3>iPhone scan</h3>
      <p className="small">
        Scan the space with a LiDAR app (Polycam, Scaniverse, or a RoomPlan app) and export it as <b>GLB</b> (OBJ, PLY and USDZ also open).
        Scans are already life size, so you can check your measurements against it.
      </p>
      <label className="file block">
        {scan?.name ? `Replace ${scan.name}` : 'Upload scan…'}
        <input type="file" accept=".glb,.gltf,.obj,.ply,.usdz" hidden onChange={(e) => onScan(e.target.files[0])} />
      </label>
      {scan?.error && <p className="error">{scan.error}</p>}
      {scan?.url && (
        <>
          {scan.size && (
            <p className="small">
              Scan size: {cm(scan.size[0])} × {cm(scan.size[2])} cm, {cm(scan.size[1])} cm tall
            </p>
          )}
          <div className="checks">
            <label>
              <input type="checkbox" checked={scan.visible !== false} onChange={(e) => setScan({ visible: e.target.checked })} /> Show scan
            </label>
            <label>
              <input type="checkbox" checked={scan.showRoom !== false} onChange={(e) => setScan({ showRoom: e.target.checked })} /> Show walls
            </label>
            <label>
              <input type="checkbox" checked={space.useFixtures !== false} onChange={(e) => setSpace({ useFixtures: e.target.checked })} /> Show fixtures
            </label>
          </div>
          <div className="row">
            <button onClick={() => setScan({ rotation: ((scan.rotation || 0) + 270) % 360 })}>⟲ 90°</button>
            <button onClick={() => setScan({ rotation: ((scan.rotation || 0) + 359) % 360 })}>⟲ 1°</button>
            <button onClick={() => setScan({ rotation: ((scan.rotation || 0) + 1) % 360 })}>⟳ 1°</button>
            <button onClick={() => setScan({ rotation: ((scan.rotation || 0) + 90) % 360 })}>⟳ 90°</button>
          </div>
          <div className="row">
            <button onClick={() => nudge(0, -0.01)}>← 1cm</button>
            <button onClick={() => nudge(0, 0.01)}>→ 1cm</button>
            <button onClick={() => nudge(2, -0.01)}>↑ 1cm</button>
            <button onClick={() => nudge(2, 0.01)}>↓ 1cm</button>
            <button onClick={() => nudge(1, 0.005)}>Up</button>
            <button onClick={() => nudge(1, -0.005)}>Down</button>
          </div>
          <button
            className="ghost"
            onClick={() => {
              URL.revokeObjectURL(scan.url);
              clearScan().catch(() => {});
              useStore.setState({ scan: null });
            }}
          >
            Remove scan
          </button>
        </>
      )}

      <h3>Reset</h3>
      <button className="ghost" onClick={() => confirm('Reset the space to the example hallway corner?') && resetSpace()}>
        Reset to example space
      </button>
    </aside>
  );
}
