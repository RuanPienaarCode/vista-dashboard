'use strict';
/* Backgrounds: which photo shows, and the gradient presets. Pure. */

const { hashStr } = require('./dates');

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);

function isImagePath(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return IMAGE_EXT.has(ext);
}

/* paths: every file path in the vault → the image paths under folder, sorted. */
function listPhotos(paths, folder) {
  const norm = (folder || '').replace(/^\/+|\/+$/g, '');
  return paths
    .filter(p => isImagePath(p) && (!norm || p.startsWith(norm + '/')))
    .sort((a, b) => a.localeCompare(b));
}

/* mode daily → the same photo all day (seed = the date); open → seed is a
   per-mount random string; fixed → the chosen path, falling back to daily. */
function pickPhoto(photos, mode, fixed, seed) {
  if (!photos || !photos.length) return null;
  if (mode === 'fixed' && fixed && photos.includes(fixed)) return fixed;
  return photos[hashStr(String(seed || '')) % photos.length];
}

function nextPhoto(photos, current) {
  if (!photos || !photos.length) return null;
  const i = photos.indexOf(current);
  return photos[(i + 1) % photos.length];
}

/* A readable title from a file name: "jonatan-pie-night-road.jpg" → "Night road · Jonatan Pie" is
   too clever to get right in general, so: strip the extension, swap dashes for spaces. */
function photoTitle(path) {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  return name.replace(/[-_]+/g, ' ');
}

/* Each preset is a stack of radial gradients over a base colour — the
   radials are transparent at their edges, so without the base colour behind
   them the layer would show whatever was there before. `image` therefore
   never carries a bare colour of its own: that would sit at the top level
   of the background-image comma list, which CSS treats as invalid and
   drops the WHOLE declaration (every layer, not just the bad one). The base
   goes on background-color instead, where a plain colour belongs. Ocean is
   one solid linear-gradient with no transparent stop, so it needs no base. */
const GRADIENTS = [
  { id: 'aurora', name: 'Aurora', image: 'radial-gradient(at 15% 20%, #1b4b5a 0px, transparent 55%), radial-gradient(at 85% 25%, #3a1c71 0px, transparent 55%), radial-gradient(at 50% 95%, #0f3443 0px, transparent 60%)', color: '#0b1020' },
  { id: 'dusk', name: 'Dusk', image: 'radial-gradient(at 20% 90%, #7a2d4a 0px, transparent 55%), radial-gradient(at 80% 10%, #1d2b64 0px, transparent 60%)', color: '#141a33' },
  { id: 'ember', name: 'Ember', image: 'radial-gradient(at 80% 80%, #6b2d1a 0px, transparent 55%), radial-gradient(at 15% 15%, #2d1b3d 0px, transparent 55%)', color: '#14100f' },
  { id: 'forest', name: 'Forest', image: 'radial-gradient(at 25% 25%, #1f4d3a 0px, transparent 55%), radial-gradient(at 80% 75%, #0f2a22 0px, transparent 60%)', color: '#0b1512' },
  { id: 'ocean', name: 'Ocean', image: 'linear-gradient(135deg, #1a9ba1 0%, #2a5c96 45%, #2c1a6b 100%)', color: null },
  { id: 'graphite', name: 'Graphite', image: 'radial-gradient(at 30% 20%, #3a3f4b 0px, transparent 55%), radial-gradient(at 80% 80%, #1c1f27 0px, transparent 60%)', color: '#121419' },
];

function gradientPreset(id) {
  return GRADIENTS.find(x => x.id === id) || GRADIENTS[0];
}

/* { image, color } — set backgroundImage and backgroundColor separately;
   never join them back into one string, that is the bug this replaced. */
function gradientLayers(id) {
  const g = gradientPreset(id);
  return { image: g.image, color: g.color || '' };
}

/* Back-compat single string, for anything that only wants one CSS value
   (e.g. a settings preview swatch). Not for backgroundImage on a real layer. */
function gradientCss(id) {
  const g = gradientPreset(id);
  return g.color ? `${g.image}, ${g.color}` : g.image;
}

module.exports = { listPhotos, pickPhoto, nextPhoto, photoTitle, isImagePath, GRADIENTS, gradientPreset, gradientLayers, gradientCss };
