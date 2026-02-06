/**
 * Select component — renders a dropdown with label and optional help tooltip.
 *
 * Usage:
 *   Select.render(container, {
 *     id: 'snapshot-method',
 *     label: 'Snapshot Method',
 *     help: 'How snapshots are captured',
 *     options: [{ value: '0', label: 'Auto' }, { value: '1', label: 'From Stream' }],
 *     value: '0',
 *     onChange: (value) => { ... }
 *   });
 */
// eslint-disable-next-line no-unused-vars
const Select = {
  /**
   * @param {HTMLElement} container
   * @param {object} opts
   * @param {string} opts.id
   * @param {string} opts.label
   * @param {string} [opts.help]
   * @param {Array<{value: string, label: string}>} opts.options
   * @param {string} opts.value - initial selected value
   * @param {boolean} [opts.disabled]
   * @param {function} opts.onChange - callback(value: string)
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

    const selectEl = document.createElement('select');
    selectEl.className = 'form-select form-select-sm';
    selectEl.id = opts.id;
    selectEl.style.width = 'auto';
    selectEl.style.maxWidth = '200px';
    selectEl.disabled = !!opts.disabled;

    (opts.options || []).forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (String(opt.value) === String(opts.value)) option.selected = true;
      selectEl.appendChild(option);
    });

    selectEl.addEventListener('change', () => {
      if (opts.onChange) opts.onChange(selectEl.value);
    });

    row.appendChild(labelWrap);
    row.appendChild(selectEl);

    if (container) container.appendChild(row);
    return row;
  },
};
