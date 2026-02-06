/**
 * API service — wraps homebridge.request() and push event listeners.
 * Communicates with server.ts endpoints.
 */
// eslint-disable-next-line no-unused-vars
const Api = {
  /**
   * Login with credentials, TFA code, or captcha
   * @param {object} options - { username, password, country, deviceName } | { verifyCode } | { captcha: { captchaCode, captchaId } }
   * @returns {Promise<{success: boolean, failReason?: number, data?: any}>}
   */
  async login(options) {
    return homebridge.request('/login', options);
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
   * @param {function} callback - receives array of L_Station objects
   */
  onAccessoriesReady(callback) {
    homebridge.addEventListener('addAccessory', (event) => {
      callback(event.data);
    });
  },

  /**
   * Register a listener for admin account error.
   * @param {function} callback
   */
  onAdminAccountUsed(callback) {
    homebridge.addEventListener('AdminAccountUsed', () => {
      callback();
    });
  },

  /**
   * Register a listener for version mismatch
   * @param {function} callback - receives { currentVersion, storedVersion }
   */
  onVersionUnmatched(callback) {
    homebridge.addEventListener('versionUnmatched', (event) => {
      callback(event.data);
    });
  },

  /**
   * Register a listener for log download progress
   * @param {function} callback - receives { progress, status }
   */
  onDownloadLogsProgress(callback) {
    homebridge.addEventListener('downloadLogsProgress', (event) => {
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
