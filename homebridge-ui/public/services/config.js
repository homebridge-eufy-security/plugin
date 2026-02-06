/**
 * Config service — wraps homebridge plugin config CRUD operations.
 * Manages reading/writing plugin configuration via the Homebridge API.
 */
// eslint-disable-next-line no-unused-vars
const Config = {
  _cache: null,

  /**
   * Get the current plugin config (first block).
   * Uses cache if available; call load() to force a fresh read.
   * @returns {Promise<object>}
   */
  async get() {
    if (this._cache) return this._cache;
    return this.load();
  },

  /**
   * Load config from Homebridge (always fetches fresh, no side-effects).
   * @returns {Promise<object>}
   */
  async load() {
    const configs = await homebridge.getPluginConfig();
    this._cache = configs.length > 0 ? configs[0] : {};
    return this._cache;
  },

  /**
   * Update config in memory (does NOT save to disk).
   * @param {object} config - full config object
   */
  async update(config) {
    this._cache = config;
    await homebridge.updatePluginConfig([config]);
  },

  /**
   * Save current config to disk (config.json).
   * Call sparingly — only after login or explicit user save.
   */
  async save() {
    await homebridge.savePluginConfig();
  },

  /**
   * Update config and immediately save to disk.
   * @param {object} config
   */
  async updateAndSave(config) {
    await this.update(config);
    await this.save();
  },

  /**
   * Get camera config for a specific device by serial number.
   * @param {string} serialNumber
   * @returns {object|undefined}
   */
  getCameraConfig(serialNumber) {
    if (!this._cache) return undefined;
    const cameras = this._cache.cameras || [];
    return cameras.find((c) => c.serialNumber === serialNumber);
  },

  /**
   * Get station config for a specific station by serial number.
   * @param {string} serialNumber
   * @returns {object|undefined}
   */
  getStationConfig(serialNumber) {
    if (!this._cache) return undefined;
    const stations = this._cache.stations || [];
    return stations.find((s) => s.serialNumber === serialNumber);
  },

  /**
   * Update or create camera config for a device.
   * @param {string} serialNumber
   * @param {object} options - config properties to merge
   */
  async updateDeviceConfig(serialNumber, options) {
    const config = this._cache || await this.get();
    if (!config.cameras) config.cameras = [];

    const idx = config.cameras.findIndex((c) => c.serialNumber === serialNumber);
    if (idx !== -1) {
      Object.assign(config.cameras[idx], options);
    } else {
      config.cameras.push({ serialNumber, ...options });
    }

    await this.update(config);
  },

  /**
   * Update or create station config.
   * @param {string} serialNumber
   * @param {object} options - config properties to merge
   */
  async updateStationConfig(serialNumber, options) {
    const config = this._cache || await this.get();
    if (!config.stations) config.stations = [];

    const idx = config.stations.findIndex((s) => s.serialNumber === serialNumber);
    if (idx !== -1) {
      Object.assign(config.stations[idx], options);
    } else {
      config.stations.push({ serialNumber, ...options });
    }

    await this.update(config);
  },

  /**
   * Update global config options (top-level properties).
   * @param {object} options - properties to merge into top-level config
   */
  async updateGlobal(options) {
    const config = this._cache || await this.get();
    Object.assign(config, options);
    await this.update(config);
  },

  /**
   * Toggle a device in the ignore list.
   * @param {string} serialNumber
   * @param {boolean} ignored - true to ignore, false to un-ignore
   * @param {'device'|'station'} type
   */
  async toggleIgnore(serialNumber, ignored, type) {
    const config = this._cache || await this.get();
    const key = type === 'device' ? 'ignoreDevices' : 'ignoreStations';
    if (!config[key]) config[key] = [];

    if (ignored && !config[key].includes(serialNumber)) {
      config[key].push(serialNumber);
    } else if (!ignored) {
      config[key] = config[key].filter((id) => id !== serialNumber);
    }

    await this.update(config);
  },
};
