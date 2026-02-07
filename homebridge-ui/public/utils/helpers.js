/**
 * Shared utility functions used across views and components.
 */
// eslint-disable-next-line no-unused-vars
const Helpers = {
  /**
   * Escape HTML to prevent XSS when inserting user-supplied strings.
   * @param {string} str
   * @returns {string}
   */
  escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * Node.js version warning message (shared between login and dashboard).
   * @param {string} nodeVersion - e.g. 'v20.18.1'
   * @returns {string} HTML string
   */
  nodeVersionWarningHtml(nodeVersion) {
    return `Your Node.js version has removed <code>RSA_PKCS1_PADDING</code> support, which breaks streaming features. `
      + `The rest of the plugin works fine. Use <strong>Node.js v20.11.0</strong> or earlier, or upgrade to <strong>v24.5.0+</strong>. `
      + `<a href="https://github.com/homebridge-eufy-security/plugin/wiki/Node.js-Compatibility-with-Eufy-Security-Plugin" target="_blank">Learn more</a>`;
  },
};
