import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractHeuristic, parseDimensions, guessMount, assertPublicUrl } from './extract.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('reads the Cotswold Company coat rack page', () => {
  const html = readFileSync(new URL('./fixtures/cotswoldco-coat-rack.html', import.meta.url), 'utf8');
  const p = extractHeuristic(html, 'https://www.cotswoldco.com/x/');
  assert.equal(p.name, 'Chester Oak 5 Hook Coat Rack');
  near(p.width, 1.1);
  near(p.height, 0.185);
  near(p.depth, 0.135);
  assert.equal(p.mount, 'wall');
  assert.match(p.image, /660\.028/);
});

test('labelled dimensions skip part sizes like seat height', () => {
  const d = parseDimensions('Seat height: 45cm\nHeight: 90 cm\nWidth: 60cm\nDepth: 55cm');
  near(d.height, 0.9);
  near(d.width, 0.6);
});

test('lettered and triple formats', () => {
  const a = parseDimensions('Size W120 x D35 x H80cm');
  near(a.width, 1.2); near(a.depth, 0.35); near(a.height, 0.8);
  const b = parseDimensions('Dimensions 1200 x 350 x 800 mm (W x D x H)');
  near(b.width, 1.2); near(b.depth, 0.35); near(b.height, 0.8);
  const c = parseDimensions('Height (cm): 180\nWidth (cm): 50\nDepth (cm): 30');
  near(c.height, 1.8);
});

test('mount guess', () => {
  assert.equal(guessMount('Oak Coat Stand', ''), 'floor');
  assert.equal(guessMount('Round Wall Mirror', ''), 'wall');
  assert.equal(guessMount('Shoe Bench', ''), 'floor');
});

test('rejects private addresses', () => {
  assert.throws(() => assertPublicUrl('http://127.0.0.1/x'));
  assert.throws(() => assertPublicUrl('file:///etc/passwd'));
  assert.ok(assertPublicUrl('https://www.cotswoldco.com/'));
});
