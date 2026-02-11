/**
 * API service — wraps homebridge.request() and push event listeners.
 * Communicates with server.ts endpoints.
 */
// eslint-disable-next-line no-unused-vars
const Api = {
  /** @private Track registered listeners to prevent stacking on re-render */
  _listeners: {},

  /**
   * Register an event listener, replacing any previous listener for the same event.
   * Prevents listener stacking when views re-render.
   * @param {string} event
   * @param {function} handler
   */
  _on(event, handler) {
    if (this._listeners[event]) {
      homebridge.removeEventListener(event, this._listeners[event]);
    }
    this._listeners[event] = handler;
    homebridge.addEventListener(event, handler);
  },

  /**
   * Remove a previously registered listener for an event.
   * Views can call this on teardown to explicitly detach their callbacks.
   * @param {string} event
   */
  _off(event) {
    if (this._listeners[event]) {
      homebridge.removeEventListener(event, this._listeners[event]);
      delete this._listeners[event];
    }
  },

  /**
   * Login with credentials, TFA code, or captcha
   * @param {object} options - { username, password, country, deviceName } | { verifyCode } | { captcha: { captchaCode, captchaId } }
   * @returns {Promise<{success: boolean, failReason?: number, data?: any}>}
   */
  async login(options) {
    return homebridge.request('/login', options);
  },

  /**
   * Check if a valid persistent cache file exists on the server.
   * @returns {Promise<{valid: boolean}>}
   */
  async checkCache() {
    return homebridge.request('/checkCache');
  },

  /**
   * Load stored accessories from server (cached from last login)
   * @returns {Promise<Array>} Array of L_Station objects
   */
  async loadStoredAccessories() {
    return homebridge.request('/storedAccessories');
  },

  /**
   * Reset plugin data (removes persistent storage)
   * @returns {Promise<{result: number}>}
   */
  async resetPlugin() {
    return homebridge.request('/reset');
  },

  /**
   * Download compressed log files
   * @returns {Promise<Buffer>}
   */
  async downloadLogs() {
    return homebridge.request('/downloadLogs');
  },

  /**
   * Register a listener for the 'addAccessory' push event.
   * Fired by server after batch processing completes (~45s after login).
   * Replaces any previously registered listener.
   * @param {function} callback - receives array of L_Station objects
   */
  onAccessoriesReady(callback) {
    this._on('addAccessory', (event) => {
      callback(event.data);
    });
  },

  /**
   * Register a listener for admin account error.
   * Replaces any previously registered listener.
   * @param {function} callback
   */
  onAdminAccountUsed(callback) {
    this._on('AdminAccountUsed', () => {
      callback();
    });
  },

  /**
   * Register a listener for cache warnings (stale, version mismatch).
   * Replaces any previously registered listener.
   * @param {function} callback - receives { reason, ageDays?, currentVersion?, storedVersion? }
   */
  onCacheWarning(callback) {
    this._on('cacheWarning', (event) => {
      callback(event.data);
    });
  },

  /**
   * Register a listener for log download progress.
   * Replaces any previously registered listener.
   * @param {function} callback - receives { progress, status }
   */
  onDownloadLogsProgress(callback) {
    this._on('downloadLogsProgress', (event) => {
      callback(event.data);
    });
  },

  /**
   * Get system and environment information for issue reporting
   * @returns {Promise<{pluginVersion: string, eufyClientVersion: string, homebridgeVersion: string, nodeVersion: string, os: string, devices: Array}>}
   */
  async getSystemInfo() {
    return homebridge.request('/systemInfo');
  },
};
