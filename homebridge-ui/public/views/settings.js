/**
 * Settings View — global plugin settings with progressive disclosure.
 * Simple: re-login, download logs, reset.
 * Advanced: polling, livestream, guard modes, auto-sync, etc.
 */
// eslint-disable-next-line no-unused-vars
const SettingsView = {

  _advancedOpen: false,
  _downloadInProgress: false,

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

    // ── Quick Actions ──
    const actionsSection = document.createElement('div');
    actionsSection.className = 'settings-section';

    const actionsTitle = document.createElement('div');
    actionsTitle.className = 'detail-section__title';
    actionsTitle.textContent = 'Quick Actions';
    actionsSection.appendChild(actionsTitle);

    const btnRow = document.createElement('div');
    btnRow.className = 'settings-btn-row';

    // Re-login button
    const btnLogin = document.createElement('button');
    btnLogin.className = 'btn btn-outline-primary btn-sm';
    btnLogin.textContent = '🔄 Re-login / Re-fetch new devices';
    btnLogin.addEventListener('click', () => App.navigate('login'));
    btnRow.appendChild(btnLogin);

    // Download logs button
    const btnLogs = document.createElement('button');
    btnLogs.className = 'btn btn-outline-secondary btn-sm';
    btnLogs.textContent = '📋 Download Logs';
    btnLogs.addEventListener('click', () => this._downloadLogs(container));
    btnRow.appendChild(btnLogs);

    // Bug report button
    const btnBug = document.createElement('button');
    btnBug.className = 'btn btn-outline-secondary btn-sm';
    btnBug.textContent = '🐛 Report Issue';
    btnBug.addEventListener('click', () => this._reportIssue());
    btnRow.appendChild(btnBug);

    // Reset plugin button
    const btnReset = document.createElement('button');
    btnReset.className = 'btn btn-outline-danger btn-sm';
    btnReset.textContent = '🗑️ Reset Plugin';
    btnReset.addEventListener('click', () => this._confirmReset(container));
    btnRow.appendChild(btnReset);

    actionsSection.appendChild(btnRow);

    // Log download progress placeholder
    const logProgress = document.createElement('div');
    logProgress.id = 'log-download-progress';
    actionsSection.appendChild(logProgress);

    container.appendChild(actionsSection);

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

    // ── Debugging ──
    const debugSection = document.createElement('div');
    debugSection.className = 'settings-section';

    const debugTitle = document.createElement('div');
    debugTitle.className = 'detail-section__title';
    debugTitle.textContent = 'Debugging';
    debugSection.appendChild(debugTitle);

    Toggle.render(debugSection, {
      id: 'toggle-detailed-log',
      label: 'Enable Debug Logging',
      help: 'Enable verbose logging for troubleshooting. When reporting issues, enable this, reproduce the problem, then use the "Download Logs" button above to capture everything.',
      checked: !!config.enableDetailedLogging,
      onChange: async (checked) => {
        await Config.updateGlobal({ enableDetailedLogging: checked });
      },
    });

    const debugHint = document.createElement('div');
    debugHint.className = 'text-muted mt-1';
    debugHint.style.fontSize = '0.8rem';
    debugHint.innerHTML = '💡 After enabling, reproduce the issue, then click <strong>📋 Download Logs</strong> above to collect the debug output.<br>⚠️ Remember to disable debug logging once you\'re done — it generates a lot of data and may impact performance.';
    debugSection.appendChild(debugHint);

    container.appendChild(debugSection);

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

  // ===== Report Issue =====
  async _reportIssue() {
    try {
      homebridge.toast.info('Gathering system info...', 'Report Issue');
      const info = await Api.getSystemInfo();

      // Build environment section for the template
      const envSection = [
        `- **Plugin Version**: ${info.pluginVersion}`,
        `- **Homebridge Version**: ${info.homebridgeVersion}`,
        `- **Node.js Version**: ${info.nodeVersion}`,
        `- **OS**: ${info.os}`,
        `- **eufy-security-client**: ${info.eufyClientVersion}`,
      ].join('\n');

      // Build the URL with query params matching the bug report template field IDs
      const params = new URLSearchParams();
      params.set('template', 'bug_report.yml');
      params.set('environment', envSection);

      const url = 'https://github.com/homebridge-plugins/homebridge-eufy-security/issues/new?' + params.toString();
      window.open(url, '_blank');
    } catch (e) {
      // Fallback: open without pre-fill
      homebridge.toast.error('Could not gather system info. Opening blank issue form.');
      window.open('https://github.com/homebridge-plugins/homebridge-eufy-security/issues/new?template=bug_report.yml', '_blank');
    }
  },

  // ===== Log Download =====
  async _downloadLogs(container) {
    if (this._downloadInProgress) return;
    this._downloadInProgress = true;

    const progressArea = container.querySelector('#log-download-progress');
    if (progressArea) {
      progressArea.innerHTML = `
        <div class="log-progress mt-2">
          <div class="progress">
            <div class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 10%" id="log-progress-bar"></div>
          </div>
          <small class="text-muted" id="log-progress-status">Preparing...</small>
        </div>
      `;
    }

    // Listen for progress events
    Api.onDownloadLogsProgress((data) => {
      const bar = document.querySelector('#log-progress-bar');
      const status = document.querySelector('#log-progress-status');
      if (bar) bar.style.width = data.progress + '%';
      if (status) status.textContent = data.status;
    });

    try {
      const result = await Api.downloadLogs();
      // Support both old (raw buffer) and new (object with filename) response formats
      const rawBuffer = result.buffer || result;
      const filename = result.filename || 'eufy-security-diagnostics.zip';
      // Convert to base64 data URI (blob: URLs are blocked by Homebridge CSP)
      const bytes = new Uint8Array(rawBuffer.data || rawBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const a = document.createElement('a');
      a.href = 'data:application/zip;base64,' + base64;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      homebridge.toast.success('Logs downloaded.');
    } catch (e) {
      homebridge.toast.error('Failed to download logs: ' + (e.message || e));
    } finally {
      this._downloadInProgress = false;
      if (progressArea) progressArea.innerHTML = '';
    }
  },

  // ===== Reset Confirmation =====
  _confirmReset(container) {
    const existing = container.querySelector('#reset-confirm');
    if (existing) { existing.remove(); return; }

    const confirm = document.createElement('div');
    confirm.id = 'reset-confirm';
    confirm.className = 'alert alert-danger mt-3';
    confirm.innerHTML = `
      <strong>Are you sure?</strong> This will delete all persistent data, stored accessories, and logs.
      You will need to log in again.
      <div class="mt-2">
        <button class="btn btn-danger btn-sm me-2" id="btn-confirm-reset">Yes, Reset Everything</button>
        <button class="btn btn-outline-secondary btn-sm" id="btn-cancel-reset">Cancel</button>
      </div>
    `;

    confirm.querySelector('#btn-confirm-reset').addEventListener('click', async () => {
      try {
        await Api.resetPlugin();
        // Clear config
        await Config.update({
          platform: 'EufySecurity',
        });
        await Config.save();
        homebridge.toast.success('Plugin reset. Please restart Homebridge.');
        App.state.stations = [];
        App.navigate('login');
      } catch (e) {
        homebridge.toast.error('Reset failed: ' + (e.message || e));
      }
    });

    confirm.querySelector('#btn-cancel-reset').addEventListener('click', () => {
      confirm.remove();
    });

    container.appendChild(confirm);
  },

  _escHtml(str) {
    return Helpers.escHtml(str);
  },
};
