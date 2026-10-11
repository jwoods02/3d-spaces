# 3D Spaces

A browser prototype for trying furniture in a real space at 1:1 scale. Set up a
corner of a room with its real measurements (or upload an iPhone LiDAR scan),
mark where the radiator, switches and fuse box are, then paste product links to
fill a Sims-style product bar and drag things into place.

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
- **Scans**: export a scan from Polycam, Scaniverse or a RoomPlan app as GLB
  (OBJ, PLY and USDZ also load). Scans are already in metres, so they show at
  real size. Wall items stick to scanned walls and floor items sit on the
  scanned floor.
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
