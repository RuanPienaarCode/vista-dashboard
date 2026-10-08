'use strict';
/* Route require('obsidian') to a stub for the modules that import it. */
const Module = require('node:module');
/* Obsidian's own normalizePath, faithfully: runs of / and \\ collapse to one
   /, leading and trailing / are stripped, an empty result is '/', NBSP and
   narrow NBSP become plain spaces, and the string is NFC-normalised. */
function normalizePath(p) {
  let s = String(p).replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, '');
  if (s === '') s = '/';
  return s.replace(/[\u00A0\u202F]/g, ' ').normalize('NFC');
}
const stub = {
  Plugin: class Plugin {}, ItemView: class ItemView {}, Modal: class Modal {}, Setting: class Setting {},
  PluginSettingTab: class PluginSettingTab {}, FuzzySuggestModal: class FuzzySuggestModal {}, Menu: class Menu {},
  Notice: class Notice { constructor(m) { stub.notices.push(m); } }, TFile: class TFile {}, TFolder: class TFolder {},
  Platform: { isMobile: false }, normalizePath, setIcon: () => {}, notices: [],
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'obsidian') return stub;
  return origLoad.call(this, request, ...rest);
};
module.exports = stub;
