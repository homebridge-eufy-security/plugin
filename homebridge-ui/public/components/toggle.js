/**
 * Toggle component — renders an on/off switch with label and optional help tooltip.
 *
 * Usage:
 *   Toggle.render(container, {
 *     id: 'enable-camera',
 *     label: 'Enable Camera',
 *     help: 'Show this camera in HomeKit',
 *     checked: true,
 *     onChange: (checked) => { ... }
 *   });
 */
// eslint-disable-next-line no-unused-vars
const Toggle = {
  /**
   * @param {HTMLElement} container - parent element to append into
   * @param {object} opts
   * @param {string} opts.id - unique id for the input
   * @param {string} opts.label - display label
   * @param {string} [opts.help] - tooltip text
   * @param {boolean} opts.checked - initial state
   * @param {boolean} [opts.disabled] - disabled state
   * @param {function} opts.onChange - callback(checked: boolean)
   * @returns {HTMLElement}
   */
  render(container, opts) {
    const row = document.createElement('div');
    row.className = 'eufy-toggle';

    const labelWrap = document.createElement('div');
    labelWrap.className = 'eufy-toggle__label';

    const labelEl = document.createElement('label');
    labelEl.setAttribute('for', opts.id);
    labelEl.textContent = opts.label;
    labelWrap.appendChild(labelEl);

    if (opts.help) {
      const helpEl = document.createElement('span');
      helpEl.className = 'eufy-toggle__help';
      helpEl.textContent = '?';
      helpEl.title = opts.help;
      labelWrap.appendChild(helpEl);
    }

    const switchWrap = document.createElement('div');
    switchWrap.className = 'form-check form-switch mb-0';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'form-check-input';
    input.id = opts.id;
    input.checked = !!opts.checked;
    input.disabled = !!opts.disabled;
    input.role = 'switch';

    input.addEventListener('change', () => {
      if (opts.onChange) opts.onChange(input.checked);
    });

    switchWrap.appendChild(input);
    row.appendChild(labelWrap);
    row.appendChild(switchWrap);

    if (container) container.appendChild(row);
    return row;
  },
};
