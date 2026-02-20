/**
 * NumberInput component — renders a number input with +/- buttons, label, and optional help tooltip.
 *
 * Usage:
 *   NumberInput.render(container, {
 *     id: 'polling-interval',
 *     label: 'Polling Interval',
 *     help: 'Minutes between cloud polls',
 *     value: 10,
 *     min: 1,
 *     max: 120,
 *     step: 1,
 *     suffix: 'min',
 *     onChange: (value) => { ... }
 *   });
 */
// eslint-disable-next-line no-unused-vars
const NumberInput = {
  /**
   * @param {HTMLElement} container
   * @param {object} opts
   * @param {string} opts.id
   * @param {string} opts.label
   * @param {string} [opts.help]
   * @param {number} opts.value
   * @param {number} [opts.min]
   * @param {number} [opts.max]
   * @param {number} [opts.step]
   * @param {string} [opts.suffix] - text after the input (e.g., 'min', 'sec')
   * @param {boolean} [opts.disabled]
   * @param {function} opts.onChange - callback(value: number)
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

    const inputGroup = document.createElement('div');
    inputGroup.className = 'number-input-group';

    const step = opts.step || 1;
    const min = opts.min !== undefined ? opts.min : 0;
    const max = opts.max !== undefined ? opts.max : 99999;

    const btnMinus = document.createElement('button');
    btnMinus.type = 'button';
    btnMinus.className = 'btn btn-outline-secondary btn-sm';
    btnMinus.textContent = '−';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'form-control form-control-sm';
    input.id = opts.id;
    input.value = opts.value;
    input.min = min;
    input.max = max;
    input.step = step;
    input.disabled = !!opts.disabled;

    const btnPlus = document.createElement('button');
    btnPlus.type = 'button';
    btnPlus.className = 'btn btn-outline-secondary btn-sm';
    btnPlus.textContent = '+';

    const fireChange = () => {
      let val = parseFloat(input.value);
      if (isNaN(val)) val = min;
      val = Math.max(min, Math.min(max, val));
      input.value = val;
      if (opts.onChange) opts.onChange(val);
    };

    btnMinus.addEventListener('click', () => {
      let val = parseFloat(input.value) - step;
      input.value = Math.max(min, val);
      fireChange();
    });

    btnPlus.addEventListener('click', () => {
      let val = parseFloat(input.value) + step;
      input.value = Math.min(max, val);
      fireChange();
    });

    input.addEventListener('change', fireChange);

    inputGroup.appendChild(btnMinus);
    inputGroup.appendChild(input);
    inputGroup.appendChild(btnPlus);

    if (opts.suffix) {
      const suffixEl = document.createElement('span');
      suffixEl.className = 'text-muted ms-1';
      suffixEl.style.fontSize = '0.8rem';
      suffixEl.textContent = opts.suffix;
      inputGroup.appendChild(suffixEl);
    }

    row.appendChild(labelWrap);
    row.appendChild(inputGroup);

    if (container) container.appendChild(row);
    return row;
  },
};
