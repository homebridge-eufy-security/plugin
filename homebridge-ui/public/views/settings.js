/**
 * Settings View — global plugin settings with progressive disclosure.
 * Account info and advanced configuration options.
 */
// eslint-disable-next-line no-unused-vars
const SettingsView = {

  _advancedOpen: false,

  async render(container) {
    container.innerHTML = '';
    this._advancedOpen = false;

    const config = await Config.get();

    // Header
    const header = document.createElement('div');
    header.className = 'eufy-header';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-link p-0';
    backBtn.innerHTML = '← Back';
    backBtn.style.textDecoration = 'none';
    backBtn.addEventListener('click', () => App.navigate('dashboard'));

    const titleEl = document.createElement('h4');
    titleEl.textContent = 'Settings';

    header.appendChild(backBtn);
    header.appendChild(titleEl);
    // Empty spacer for alignment
    header.appendChild(document.createElement('div'));
    container.appendChild(header);

    // ── Credentials Info ──
    const credsSection = document.createElement('div');
    credsSection.className = 'settings-section';

    const credsTitle = document.createElement('div');
    credsTitle.className = 'detail-section__title';
    credsTitle.textContent = 'Account';
    credsSection.appendChild(credsTitle);

    const credsInfo = document.createElement('div');
    credsInfo.className = 'text-muted';
    credsInfo.style.fontSize = '0.85rem';
    const email = config.username || 'Not configured';
    const country = config.country || '—';
    credsInfo.innerHTML = `
      <div class="mb-1"><strong>Email:</strong> ${this._escHtml(email)}</div>
      <div><strong>Country:</strong> ${country}</div>
    `;
    credsSection.appendChild(credsInfo);
    container.appendChild(credsSection);

    // ── Advanced Settings ──
    const advBtn = document.createElement('button');
    advBtn.className = 'advanced-toggle';
    advBtn.innerHTML = `
      <span class="advanced-toggle__chevron" id="settings-adv-chevron">▶</span>
      Advanced Settings
    `;
    advBtn.addEventListener('click', () => {
      this._advancedOpen = !this._advancedOpen;
      const advSection = container.querySelector('#settings-advanced');
      if (advSection) advSection.style.display = this._advancedOpen ? 'block' : 'none';
      const chevron = container.querySelector('#settings-adv-chevron');
      if (chevron) chevron.classList.toggle('advanced-toggle__chevron--open', this._advancedOpen);
    });
    container.appendChild(advBtn);

    const advSection = document.createElement('div');
    advSection.id = 'settings-advanced';
    advSection.style.display = 'none';

    // ── Polling & Livestream ──
    const perfTitle = document.createElement('div');
    perfTitle.className = 'detail-section__title';
    perfTitle.textContent = 'Performance';
    advSection.appendChild(perfTitle);

    NumberInput.render(advSection, {
      id: 'num-polling',
      label: 'Polling Interval',
      help: 'How often (in minutes) to poll the Eufy Cloud for updates. Higher values = less API usage.',
      value: config.pollingIntervalMinutes || 10,
      min: 1, max: 120, step: 1,
      suffix: 'min',
      onChange: async (val) => {
        await Config.updateGlobal({ pollingIntervalMinutes: val });
      },
    });

    NumberInput.render(advSection, {
      id: 'num-livestream',
      label: 'Max Livestream Duration',
      help: 'Maximum duration (in seconds) for a single livestream session.',
      value: config.CameraMaxLivestreamDuration || 30,
      min: 10, max: 86400, step: 10,
      suffix: 'sec',
      onChange: async (val) => {
        await Config.updateGlobal({ CameraMaxLivestreamDuration: val });
      },
    });

    // ── Default Guard Modes ──
    const guardTitle = document.createElement('div');
    guardTitle.className = 'detail-section__title mt-3';
    guardTitle.textContent = 'Default Guard Modes';
    advSection.appendChild(guardTitle);

    const guardHelp = document.createElement('p');
    guardHelp.className = 'text-muted';
    guardHelp.style.fontSize = '0.8rem';
    guardHelp.textContent = 'Default HomeKit-to-Eufy guard mode mapping. Can be overridden per station.';
    advSection.appendChild(guardHelp);

    GuardModes.render(advSection, {
      hkHome: config.hkHome ?? 1,
      hkAway: config.hkAway ?? 0,
      hkNight: config.hkNight ?? 1,
      hkOff: config.hkOff ?? 63,
      onChange: async (modes) => {
        await Config.updateGlobal(modes);
      },
    });

    // ── Misc Toggles ──
    const miscTitle = document.createElement('div');
    miscTitle.className = 'detail-section__title mt-3';
    miscTitle.textContent = 'Miscellaneous';
    advSection.appendChild(miscTitle);

    Toggle.render(advSection, {
      id: 'toggle-auto-sync',
      label: 'Auto Sync Station',
      help: 'Automatically synchronize station mode with HomeKit security system.',
      checked: !!config.autoSyncStation,
      onChange: async (checked) => {
        await Config.updateGlobal({ autoSyncStation: checked });
      },
    });

    Toggle.render(advSection, {
      id: 'toggle-clean-cache',
      label: 'Clean Cache',
      help: 'Remove stale cached accessories on next restart.',
      checked: !!config.cleanCache,
      onChange: async (checked) => {
        await Config.updateGlobal({ cleanCache: checked });
      },
    });

    Toggle.render(advSection, {
      id: 'toggle-omit-logs',
      label: 'Omit Log Files',
      help: 'Disable writing plugin log files to disk.',
      checked: !!config.omitLogFiles,
      onChange: async (checked) => {
        await Config.updateGlobal({ omitLogFiles: checked });
      },
    });

    Toggle.render(advSection, {
      id: 'toggle-ignore-multi-warning',
      label: 'Ignore Multiple Devices Warning',
      help: 'Suppress warning when multiple plugins manage the same device.',
      checked: !!config.ignoreMultipleDevicesWarning,
      onChange: async (checked) => {
        await Config.updateGlobal({ ignoreMultipleDevicesWarning: checked });
      },
    });

    Toggle.render(advSection, {
      id: 'toggle-pkcs1',
      label: 'Embedded PKCS1 Support',
      help: 'Enable embedded PKCS1 support for device communication.',
      checked: !!config.enableEmbeddedPKCS1Support,
      onChange: async (checked) => {
        await Config.updateGlobal({ enableEmbeddedPKCS1Support: checked });
      },
    });

    container.appendChild(advSection);


  },

  _escHtml(str) {
    return Helpers.escHtml(str);
  },
};
