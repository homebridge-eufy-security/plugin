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

    const headerRight = document.createElement('div');
    headerRight.className = 'eufy-header__right';

    // Cache date label
    if (App.state.cacheDate) {
      const cacheLabel = document.createElement('span');
      cacheLabel.className = 'eufy-cache-date';
      const d = new Date(App.state.cacheDate);
      cacheLabel.textContent = 'Cached: ' + d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      cacheLabel.title = 'Last fetched: ' + d.toLocaleString();
      headerRight.appendChild(cacheLabel);
    }

    const btnGroup = document.createElement('div');
    btnGroup.className = 'd-flex gap-2';

    const btnRefresh = this._headerBtn('refresh.svg', 'Re-login / Re-fetch', 'btn-success', () => App.navigate('login'));
    const btnDiagnostic = this._headerBtn('bug-report.svg', 'Diagnostics', 'btn-warning', () => App.navigate('diagnostics'));
    const btnSettings = this._headerBtn('settings.svg', 'Global Settings', 'btn-danger', () => App.navigate('settings'));

    btnGroup.appendChild(btnRefresh);
    btnGroup.appendChild(btnDiagnostic);
    btnGroup.appendChild(btnSettings);
    headerRight.appendChild(btnGroup);
    header.appendChild(headerRight);
    container.appendChild(header);

    // Node.js version warning banner (shown if affected)
    const warning = App.state.nodeVersionWarning;
    if (warning && warning.affected) {
      const banner = document.createElement('div');
      banner.className = 'node-version-banner';

      const iconDiv = document.createElement('div');
      iconDiv.className = 'node-version-banner__icon';
      iconDiv.appendChild(Helpers.icon('warning.svg', 24));
      banner.appendChild(iconDiv);

      const contentDiv = document.createElement('div');
      contentDiv.className = 'node-version-banner__content';

      const title = document.createElement('strong');
      title.textContent = `Node.js ${warning.nodeVersion} — Streaming Incompatible`;
      contentDiv.appendChild(title);

      const textDiv = document.createElement('div');
      textDiv.className = 'node-version-banner__text';
      Helpers.appendNodeVersionWarning(textDiv);
      contentDiv.appendChild(textDiv);

      banner.appendChild(contentDiv);
      container.appendChild(banner);
    }

    // Device grid
    const stations = App.state.stations || [];

    if (stations.length === 0) {
      container.insertAdjacentHTML('beforeend', `
        <div class="text-center text-muted py-5">
          <div style="font-size: 2rem; margin-bottom: 12px;">${Helpers.iconHtml('inventory.svg', 32)}</div>
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
        if (station.unsupported || item.unsupported) {
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
          if (station.unsupported || device.unsupported) {
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
          Click on a device to find out how you can help us add support for it.
        </p>
      `;

      const unsupportedGrid = document.createElement('div');
      unsupportedGrid.className = 'row';

      unsupported.forEach(({ item, isStation }) => {
        DeviceCard.render(unsupportedGrid, {
          device: { ...item, unsupported: true },
          isStation: isStation,
          enabled: false,
          onClick: (d) => {
            App.navigate('unsupported/' + d.uniqueId);
          },
          onToggle: () => {},
        });
      });

      section.appendChild(unsupportedGrid);
      container.appendChild(section);
    }
  },

  _headerBtn(iconFile, label, btnClass, onClick) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + btnClass + ' btn-sm eufy-tooltip';
    btn.setAttribute('data-tooltip', label);
    const img = document.createElement('img');
    img.src = 'assets/icons/' + iconFile;
    img.alt = label;
    img.style.width = '24px';
    img.style.height = '24px';
    img.style.filter = 'brightness(0) invert(1)';
    btn.appendChild(img);
    btn.addEventListener('click', onClick);
    return btn;
  },
};
