/**
 * Dashboard View — displays device/station grid.
 * Main screen after login. Shows all discovered devices as cards.
 */
// eslint-disable-next-line no-unused-vars
const DashboardView = {

  _container: null,

  async render(container) {
    this._container = container;
    container.innerHTML = '';

    const config = await Config.get();

    // Header
    const header = document.createElement('div');
    header.className = 'eufy-header';

    const titleEl = document.createElement('h4');
    titleEl.textContent = 'Eufy Security';
    header.appendChild(titleEl);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'btn-group';

    const btnRefresh = this._headerBtn('🔄', 'Re-login / Re-fetch new devices', () => App.navigate('login'));
    const btnSettings = this._headerBtn('⚙️', 'Settings', () => App.navigate('settings'));

    btnGroup.appendChild(btnRefresh);
    btnGroup.appendChild(btnSettings);
    header.appendChild(btnGroup);
    container.appendChild(header);

    // Node.js version warning banner (shown if affected)
    const warning = App.state.nodeVersionWarning;
    if (warning && warning.affected) {
      const banner = document.createElement('div');
      banner.className = 'node-version-banner';
      banner.innerHTML = `
        <div class="node-version-banner__icon">⚠️</div>
        <div class="node-version-banner__content">
          <strong>Node.js ${Helpers.escHtml(warning.nodeVersion)} — Streaming Incompatible</strong>
          <div class="node-version-banner__text">${Helpers.nodeVersionWarningHtml()}</div>
        </div>
      `;
      container.appendChild(banner);
    }

    // Device grid
    const stations = App.state.stations || [];

    if (stations.length === 0) {
      container.insertAdjacentHTML('beforeend', `
        <div class="text-center text-muted py-5">
          <div style="font-size: 2rem; margin-bottom: 12px;">📦</div>
          <p>No devices found. Try logging in again to discover your devices.</p>
          <button class="btn btn-primary btn-sm mt-2" id="btn-go-login">Go to Login</button>
        </div>
      `);
      container.querySelector('#btn-go-login').addEventListener('click', () => App.navigate('login'));
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'row';

    // Flatten: stations + their devices
    const ignoreDevices = config.ignoreDevices || [];
    const ignoreStations = config.ignoreStations || [];

    // Separate supported and unsupported
    const supported = [];
    const unsupported = [];

    stations.forEach((station) => {
      // Check if station has a standalone device (device serial === station serial)
      const standaloneDevice = (station.devices || []).find(
        (d) => d.uniqueId === station.uniqueId
      );

      if (standaloneDevice) {
        // Standalone: show as single card (the device IS the station)
        const item = { ...standaloneDevice, type: standaloneDevice.type };
        if (station.unsupported) {
          item.unsupported = true;
          unsupported.push({ item, isStation: false, station });
        } else {
          supported.push({ item, isStation: false, station });
        }
      } else {
        // Station card
        if (!station.disabled) {
          const stationItem = {
            uniqueId: station.uniqueId,
            displayName: station.displayName,
            type: station.type,
            typename: station.typename,
            unsupported: station.unsupported,
            ignored: station.ignored,
          };
          if (station.unsupported) {
            unsupported.push({ item: stationItem, isStation: true, station });
          } else {
            supported.push({ item: stationItem, isStation: true, station });
          }
        }

        // Device cards for this station
        (station.devices || []).forEach((device) => {
          if (station.unsupported) {
            unsupported.push({ item: { ...device, unsupported: true }, isStation: false, station });
          } else {
            supported.push({ item: device, isStation: false, station });
          }
        });
      }
    });

    // Render supported devices
    supported.forEach(({ item, isStation }) => {
      const isIgnored = isStation
        ? ignoreStations.includes(item.uniqueId)
        : ignoreDevices.includes(item.uniqueId);

      DeviceCard.render(grid, {
        device: { ...item, ignored: isIgnored },
        isStation: isStation,
        enabled: !isIgnored,
        onClick: (d) => {
          const type = isStation ? 'station' : 'device';
          App.navigate('detail/' + type + '/' + d.uniqueId);
        },
        onToggle: (d, enabled) => {
          const type = isStation ? 'station' : 'device';
          Config.toggleIgnore(d.uniqueId, !enabled, type);
          // Re-render to update visual state
          this.render(this._container);
        },
      });
    });

    container.appendChild(grid);

    // Unsupported section
    if (unsupported.length > 0) {
      const section = document.createElement('div');
      section.className = 'mt-4';
      section.innerHTML = `
        <div class="detail-section__title">Unsupported Devices</div>
        <p class="text-muted" style="font-size: 0.8rem;">
          These devices were detected but are not yet fully supported by the eufy-security-client library.
          <a href="https://github.com/homebridge-eufy-security/plugin/issues" target="_blank">Request support on GitHub</a>
        </p>
      `;

      const unsupportedGrid = document.createElement('div');
      unsupportedGrid.className = 'row';

      unsupported.forEach(({ item, isStation }) => {
        DeviceCard.render(unsupportedGrid, {
          device: { ...item, unsupported: true },
          isStation: isStation,
          enabled: false,
          onClick: () => {},
          onToggle: () => {},
        });
      });

      section.appendChild(unsupportedGrid);
      container.appendChild(section);
    }
  },

  _headerBtn(icon, label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline-secondary btn-sm';
    btn.innerHTML = icon + ' <span class="d-none d-sm-inline">' + label + '</span>';
    btn.title = label;
    btn.addEventListener('click', onClick);
    return btn;
  },
};
