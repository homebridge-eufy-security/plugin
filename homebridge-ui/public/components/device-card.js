/**
 * DeviceCard component — renders a single device/station card for the dashboard grid.
 *
 * Usage:
 *   DeviceCard.render(container, {
 *     device: { uniqueId, displayName, type, typename, ... },
 *     isStation: false,
 *     enabled: true,
 *     onClick: (device) => { ... },
 *     onToggle: (device, enabled) => { ... }
 *   });
 */
// eslint-disable-next-line no-unused-vars
const DeviceCard = {

  CHARGING_LABELS: {
    1: 'Charging',
    2: 'Unplugged',
    3: 'Plugged In',
    4: 'Solar',
  },

  /**
   * @param {HTMLElement} container
   * @param {object} opts
   * @param {object} opts.device - L_Device or L_Station data
   * @param {boolean} [opts.isStation]
   * @param {boolean} opts.enabled - whether device is enabled (not ignored)
   * @param {function} opts.onClick - callback(device)
   * @param {function} opts.onToggle - callback(device, enabled)
   * @returns {HTMLElement}
   */
  render(container, opts) {
    const d = opts.device;
    const isUnsupported = d.unsupported === true;
    const isIgnored = d.ignored === true;

    const col = document.createElement('div');
    col.className = 'col-6 col-md-4 col-lg-3 mb-3';

    const card = document.createElement('div');
    card.className = 'device-card';
    if (isUnsupported) card.classList.add('device-card--unsupported');
    if (isIgnored) card.classList.add('device-card--ignored');

    // Image (skip for unsupported)
    if (!isUnsupported) {
      const imgWrap = document.createElement('div');
      imgWrap.className = 'device-card__image-wrap';
      const img = document.createElement('img');
      img.src = DeviceImages.getPath(d.type);
      img.alt = d.displayName;
      img.loading = 'lazy';
      imgWrap.appendChild(img);
      card.appendChild(imgWrap);
    }

    // Body
    const body = document.createElement('div');
    body.className = 'device-card__body';

    const name = document.createElement('div');
    name.className = 'device-card__name';
    name.textContent = d.displayName;
    name.title = d.displayName;

    const meta = document.createElement('div');
    meta.className = 'device-card__meta';

    // Build meta line with DOM nodes so we can mix text and SVG icons
    const metaFragments = [];
    if (isUnsupported) {
      metaFragments.push('Type ' + d.type);
    } else if (d.typename) {
      metaFragments.push(d.typename);
    }
    if (d.hasBattery && d.properties && d.properties.battery !== undefined) {
      metaFragments.push({ icon: Helpers.batteryIcon(d.properties.battery), text: d.properties.battery + '%' });
    }
    if (d.chargingStatus && this.CHARGING_LABELS[d.chargingStatus]) {
      const chargingIcon = d.chargingStatus === 4 ? 'solar_power.svg' : 'bolt.svg';
      metaFragments.push({ icon: chargingIcon, text: this.CHARGING_LABELS[d.chargingStatus] });
    }
    metaFragments.forEach((frag, i) => {
      if (i > 0) meta.append(' · ');
      if (typeof frag === 'string') {
        meta.append(frag);
      } else {
        meta.appendChild(Helpers.icon(frag.icon, 14, frag.text));
        meta.append(' ' + frag.text);
      }
    });

    body.appendChild(name);
    body.appendChild(meta);

    // Footer with badges + toggle
    const footer = document.createElement('div');
    footer.className = 'device-card__footer';

    const badgeArea = document.createElement('div');

    if (isUnsupported) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-unsupported';
      badge.textContent = 'Not Supported';
      badgeArea.appendChild(badge);
    } else if (isIgnored) {
      const badge = document.createElement('span');
      badge.className = 'badge bg-secondary';
      badge.textContent = 'Disabled';
      badgeArea.appendChild(badge);
    }

    footer.appendChild(badgeArea);

    // Toggle — only for non-unsupported devices
    if (!isUnsupported) {
      const switchWrap = document.createElement('div');
      switchWrap.className = 'form-check form-switch mb-0';
      switchWrap.addEventListener('click', (e) => e.stopPropagation());

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'form-check-input';
      toggle.checked = opts.enabled;
      toggle.role = 'switch';
      toggle.title = opts.enabled ? 'Enabled in HomeKit' : 'Disabled in HomeKit';

      toggle.addEventListener('change', (e) => {
        e.stopPropagation();
        if (opts.onToggle) opts.onToggle(d, toggle.checked);
      });

      switchWrap.appendChild(toggle);
      footer.appendChild(switchWrap);
    }

    card.appendChild(body);
    card.appendChild(footer);

    // Click handler — navigate to detail
    card.addEventListener('click', () => {
      if (opts.onClick) opts.onClick(d);
    });

    col.appendChild(card);
    if (container) container.appendChild(col);
    return col;
  },
};
