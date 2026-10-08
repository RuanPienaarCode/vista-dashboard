'use strict';
/* The workspace view hosting the dashboard. */

const { ItemView } = require('obsidian');
const { VIEW_TYPE } = require('./constants');
const { mountDashboard } = require('./dashboard');

class VistaView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = true;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Vista'; }
  getIcon() { return 'layout-dashboard'; }

  async onOpen() {
    this.ctl = mountDashboard(this);
    await this.ctl.start();
  }

  async onClose() {
    if (this.ctl) { this.ctl.stop(); this.ctl = null; }
  }
}

module.exports = { VistaView };
