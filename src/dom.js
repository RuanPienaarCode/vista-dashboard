'use strict';
/* Tiny DOM helpers on the standard API only, so the same rendering code runs
   in the browser preview harness. No innerHTML anywhere — every node is built. */

const { setIcon } = require('obsidian');

function el(parent, tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  if (parent) parent.appendChild(n);
  return n;
}

function icon(parent, name, cls) {
  const s = el(parent, 'span', 'vs-icon' + (cls ? ' ' + cls : ''));
  try { setIcon(s, name); } catch (e) { /* preview harness: no lucide */ }
  return s;
}

function button(parent, cls, label, onClick, iconName) {
  const b = el(parent, 'button', cls);
  b.type = 'button';
  if (iconName) icon(b, iconName);
  if (label) el(b, 'span', 'vs-btn-label', label);
  if (onClick) b.addEventListener('click', e => { e.preventDefault(); onClick(e); });
  return b;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

module.exports = { el, icon, button, clear };
