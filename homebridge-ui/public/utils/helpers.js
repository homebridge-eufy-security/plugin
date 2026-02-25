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
   * Append Node.js version warning text nodes to the given parent element.
   * Uses DOM APIs exclusively — no innerHTML — to satisfy static-analysis security rules.
   * @param {HTMLElement} parent
   */
  appendNodeVersionWarning(parent) {
    const parts = [
      ['text', 'Your Node.js version has removed '],
      ['code', 'RSA_PKCS1_PADDING'],
      ['text', ' support, which breaks streaming features. The rest of the plugin works fine. Use '],
      ['strong', 'Node.js v20.11.0'],
      ['text', ' or earlier, or upgrade to '],
      ['strong', 'v24.5.0+'],
      ['text', '. '],
    ];
    for (const [type, value] of parts) {
      if (type === 'text') {
        parent.appendChild(document.createTextNode(value));
      } else {
        const el = document.createElement(type);
        el.textContent = value;
        parent.appendChild(el);
      }
    }
    const link = document.createElement('a');
    link.href = 'https://github.com/homebridge-plugins/homebridge-eufy-security/wiki/Node.js-Compatibility-with-Eufy-Security-Plugin';
    link.target = '_blank';
    link.textContent = 'Learn more';
    parent.appendChild(link);
  },

  /**
   * Create an inline SVG icon <img> element from the assets/icons/ folder.
   * @param {string}  name  Icon filename without path, e.g. 'warning.svg'
   * @param {number}  [size=16]  Width/height in px
   * @param {string}  [alt='']   Alt text
   * @returns {HTMLImageElement}
   */
  icon(name, size = 16, alt = '') {
    const img = document.createElement('img');
    img.src = 'assets/icons/' + name;
    img.alt = alt;
    img.width = size;
    img.height = size;
    img.style.verticalAlign = 'middle';
    return img;
  },

  /**
   * Return an HTML string for an inline SVG icon.
   * Useful inside innerHTML / insertAdjacentHTML templates.
   * @param {string}  name  Icon filename, e.g. 'warning.svg'
   * @param {number}  [size=16]  Width/height in px
   * @param {string}  [alt='']   Alt text
   * @returns {string}
   */
  iconHtml(name, size = 16, alt = '') {
    return `<img src="assets/icons/${name}" alt="${alt}" width="${size}" height="${size}" style="vertical-align:middle">`;
  },

  /**
   * Return the correct battery icon filename for a given percentage.
   * Maps 0-100% to battery_0.svg … battery_6.svg (7 levels).
   * @param {number} pct  Battery percentage (0-100)
   * @returns {string}  e.g. 'battery_3.svg'
   */
  batteryIcon(pct) {
    const level = Math.max(0, Math.min(6, Math.round((pct / 100) * 6)));
    return 'battery_' + level + '.svg';
  },

  /**
   * Generate a random device name to identify this Homebridge instance to Eufy.
   * @returns {string}
   */
  generateDeviceName() {
    const _d = (s) => atob(s).split('|');
    const _p = (a) => a[Math.floor(Math.random() * a.length)];
    const style = Math.floor(Math.random() * 3);

    if (style === 1) {
      return _p(_d('Sm9obnxFbW1hfEphbWVzfE9saXZpYXxXaWxsaWFtfFNvcGhpYXxBbGV4fE1pYXxEYW5pZWx8RWxsYXxEYXZpZHxHcmFjZXxDaHJpc3xMaWx5fFNhbQ=='))
        + '\'s '
        + _p(_d('aVBob25lfGlQaG9uZSAxM3xpUGhvbmUgMTMgUHJvfGlQaG9uZSAxNHxpUGhvbmUgMTQgUHJvfGlQaG9uZSAxNXxpUGhvbmUgMTUgUHJvfGlQaG9uZSAxNSBQcm8gTWF4fGlQaG9uZSAxNnxpUGhvbmUgMTYgUHJvfGlQaG9uZSAxNiBQcm8gTWF4fGlQYWR8aVBhZCBBaXJ8aVBhZCBQcm8='));
    }

    if (style === 2) {
      return _p(_d('Sm9obnxNYXJpYXxDYXJsb3N8U2FyYWh8QWxleHxQcml5YXxMZW98TmluYXxPbWFyfFphcmF8S2FpfFl1a2l8QmVufEF2YXxNYXg='))
        + '\'s '
        + _p(_d('R2FsYXh5IFMyM3xHYWxheHkgUzI0fEdhbGF4eSBTMjQgVWx0cmF8R2FsYXh5IEE1NHxHYWxheHkgWiBGbGlwNXxHYWxheHkgWiBGb2xkNXxQaXhlbCA3fFBpeGVsIDh8UGl4ZWwgOCBQcm98UGl4ZWwgOXxQaXhlbCA5IFByb3xPbmVQbHVzIDEyfEdhbGF4eSBUYWIgUzl8UGl4ZWwgVGFibGV0'));
    }

    return _p(_d('Q29yYWx8THVuYXJ8U29sYXJ8U3RlbGxhcnxBcmN0aWN8QW1iZXJ8QXp1cmV8Q3JpbXNvbnxHb2xkZW58SXZvcnl8SmFkZXxNYXBsZXxPbnl4fFBlYXJsfFF1YXJ0enxSdWJ5fFNpbHZlcnxUb3BhenxWZWx2ZXR8Q2VkYXI='))
      + ' '
      + _p(_d('QnJpZGdlfEh1YnxMaW5rfE5vZGV8R2F0ZXxSZWxheXxWYXVsdHxUb3dlcnxCZWFjb258TmV4dXN8UG9ydHxDb3JlfEFyY3xTcGFyaw=='))
      + ' '
      + Math.floor(Math.random() * 100);
  },
};
