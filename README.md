# 3D Spaces

A browser prototype for trying furniture in a real space at 1:1 scale. Scan the
space with an iPhone (Scaniverse, free, export as GLB), upload the scan, then
paste product links to fill a Sims-style product bar and drag things into place
on the scanned walls and floor. Without a scan you can type in a room's
measurements instead.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # product page parsing tests
```

Pasting product links works out of the box: the app reads the page's title,
photo and listed dimensions. For pages that don't list sizes in a standard way,
add an Anthropic API key and Claude reads the page instead:

```sh
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

## Deploy

Import the repo into Vercel. It builds the Vite app and serves `api/product.js`
and `api/image.js` as functions. Set `ANTHROPIC_API_KEY` in the project's
environment variables if you want Claude extraction.

## How it works

- **Space**: the room is a floor rectangle with up to four walls, measured in
  metres. Fixtures (radiator, switch, socket, fuse box, window, door) sit on a
  wall at a distance from its left end and a height from the floor. Open
  *Edit space* to type in your own measurements.
- **Scans** (the main way in): in Scaniverse choose Mesh, scan slowly, and
  export as GLB (OBJ, PLY and USDZ also load). Scans are in metres, so they
  show at real size. On upload the scan is levelled (floor found from the
  biggest flat patch) and squared up (walls turned onto the x/z axes). The
  biggest flat walls are found too, so wall items sit on the wall itself even
  when you drag them over a radiator. Overlaps are checked against the scan
  mesh with a 1.5 cm allowance for bumpy surfaces (three-mesh-bvh).
- **Checking scale**: *Tape measure* measures between two clicked points.
  Measure something you know (a radiator), type its real length in *Scan &
  space*, and the scan is rescaled, along with anything placed on it.
- **Products**: `/api/product?url=…` fetches the page server-side (browsers
  can't read other sites directly), then pulls the name, photo, price and
  dimensions from structured data and text like `Width: 110cm`. If
  `ANTHROPIC_API_KEY` is set, Claude double-checks the dimensions and whether
  it's wall-mounted. Anything missing is asked for before adding.
  `/api/image` re-serves product photos so they can be used as textures.
- **Placement**: wall items slide along walls; floor items stay on the floor,
  snap flush to the skirting and turn their back to the nearest wall. Anything
  that overlaps a fixture or another item turns red. *Auto place* finds the
  free spot nearest the middle of a wall at a sensible height (coat racks
  higher than shelves, and so on).
- Everything is saved in the browser (localStorage, plus IndexedDB for the
  scan). *Export* and *Import* move a space between browsers as JSON.

## Controls

- Click a product card, then click in the room to place it. Esc cancels.
- Drag items to move them. Arrow keys nudge 1 cm (Shift for 10 cm), R rotates
  floor items, Delete removes.
- The wall buttons at the top look square on to a wall, which is handy for
  checking against a photo or tape measure.
