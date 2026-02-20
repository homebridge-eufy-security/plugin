/**
 * Guard Modes mapping component.
 * Maps HomeKit modes (Home, Away, Night, Off) to Eufy guard mode numbers.
 *
 * Usage:
 *   GuardModes.render(container, {
 *     hkHome: 1, hkAway: 0, hkNight: 1, hkOff: 63,
 *     onChange: (modes) => { ... }  // { hkHome, hkAway, hkNight, hkOff }
 *   });
 */
// eslint-disable-next-line no-unused-vars
const GuardModes = {
  EUFY_MODES: [
    { value: '0', label: 'Away' },
    { value: '1', label: 'Home' },
    { value: '2', label: 'Schedule' },
    { value: '3', label: 'Custom 1' },
    { value: '4', label: 'Custom 2' },
    { value: '5', label: 'Custom 3' },
    { value: '6', label: 'Off' },
    { value: '47', label: 'Geofencing' },
    { value: '63', label: 'Disarmed' },
  ],

  /**
   * @param {HTMLElement} container
   * @param {object} opts
   * @param {number} [opts.hkHome]
   * @param {number} [opts.hkAway]
   * @param {number} [opts.hkNight]
   * @param {number} [opts.hkOff]
   * @param {boolean} [opts.disabled]
   * @param {function} opts.onChange - callback({ hkHome, hkAway, hkNight, hkOff })
   * @returns {HTMLElement}
   */
  render(container, opts) {
    const wrap = document.createElement('div');
    wrap.className = 'guard-mode-grid';

    const modes = {
      hkHome: { label: 'HomeKit Home', value: opts.hkHome ?? 1 },
      hkAway: { label: 'HomeKit Away', value: opts.hkAway ?? 0 },
      hkNight: { label: 'HomeKit Night', value: opts.hkNight ?? 1 },
      hkOff: { label: 'HomeKit Off', value: opts.hkOff ?? 63 },
    };

    const currentValues = {
      hkHome: modes.hkHome.value,
      hkAway: modes.hkAway.value,
      hkNight: modes.hkNight.value,
      hkOff: modes.hkOff.value,
    };

    Object.entries(modes).forEach(([key, mode]) => {
      const group = document.createElement('div');
      group.className = 'form-group';

      const label = document.createElement('label');
      label.textContent = mode.label;
      label.setAttribute('for', 'guard-' + key);

      const select = document.createElement('select');
      select.className = 'form-select form-select-sm';
      select.id = 'guard-' + key;
      select.disabled = !!opts.disabled;

      this.EUFY_MODES.forEach((em) => {
        const option = document.createElement('option');
        option.value = em.value;
        option.textContent = em.label;
        if (String(em.value) === String(mode.value)) option.selected = true;
        select.appendChild(option);
      });

      select.addEventListener('change', () => {
        currentValues[key] = parseInt(select.value);
        if (opts.onChange) opts.onChange({ ...currentValues });
      });

      group.appendChild(label);
      group.appendChild(select);
      wrap.appendChild(group);
    });

    if (container) container.appendChild(wrap);
    return wrap;
  },
};
