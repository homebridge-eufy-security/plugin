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
};
