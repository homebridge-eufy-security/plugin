/**
 * Diagnostics View — troubleshooting tools.
 * Download diagnostics, enable debug logging, report issues, reset plugin.
 */
// eslint-disable-next-line no-unused-vars
const DiagnosticsView = {

  _downloadInProgress: false,

  async render(container) {
    container.innerHTML = '';

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
    titleEl.textContent = 'Diagnostics';

    header.appendChild(backBtn);
    header.appendChild(titleEl);
    header.appendChild(document.createElement('div'));
    container.appendChild(header);

    // ── Troubleshooting Steps ──
    const stepsSection = document.createElement('div');
    stepsSection.className = 'settings-section';

    const stepsTitle = document.createElement('div');
    stepsTitle.className = 'detail-section__title';
    stepsTitle.textContent = 'Troubleshooting';
    stepsSection.appendChild(stepsTitle);

    // Step 1 — Enable Debug Logging
    const step1 = this._stepBlock('1', 'Enable Debug Logging', 'Capture verbose logs to help diagnose the issue.');
    Toggle.render(step1, {
      id: 'toggle-detailed-log',
      label: 'Debug Logging',
      help: 'Enable this, then reproduce the problem before downloading diagnostics.',
      checked: !!config.enableDetailedLogging,
      onChange: async (checked) => {
        await Config.updateGlobal({ enableDetailedLogging: checked });
      },
    });
    const debugHint = document.createElement('div');
    debugHint.className = 'alert alert-warning mt-2 mb-2';
    debugHint.style.fontSize = '0.85rem';
    debugHint.innerHTML = '⚠️ Remember to <strong>disable debug logging</strong> once done — it generates a lot of data and may impact performance.';
    step1.appendChild(debugHint);
    stepsSection.appendChild(step1);

    // Step 2 — Download Diagnostics
    const step2 = this._stepBlock('2', 'Download Diagnostics', 'Download a zip archive containing log files and accessories data.');

    const warning = document.createElement('div');
    warning.className = 'alert alert-warning mt-2 mb-2';
    warning.style.fontSize = '0.85rem';
    warning.innerHTML = '⚠️ <strong>Security notice:</strong> Diagnostics may contain sensitive session data. If you share this archive with anyone, it is strongly recommended to reset your Eufy account password afterwards.';
    step2.appendChild(warning);

    const btnDownload = document.createElement('button');
    btnDownload.className = 'btn btn-primary btn-sm';
    btnDownload.textContent = '📋 Download Diagnostics';
    btnDownload.addEventListener('click', () => this._downloadDiagnostics(container));
    step2.appendChild(btnDownload);

    const logProgress = document.createElement('div');
    logProgress.id = 'log-download-progress';
    step2.appendChild(logProgress);
    stepsSection.appendChild(step2);

    // Step 3 — Report Issue
    const step3 = this._stepBlock('3', 'Report Issue', 'Open a pre-filled bug report on GitHub with your system information.');

    const attachHint = document.createElement('div');
    attachHint.className = 'alert alert-info mb-2';
    attachHint.style.fontSize = '0.85rem';
    attachHint.innerHTML = '📎 Don\'t forget to <strong>attach the diagnostics zip</strong> downloaded in step 2 to your GitHub issue.';
    step3.appendChild(attachHint);

    const btnReport = document.createElement('button');
    btnReport.className = 'btn btn-outline-secondary btn-sm';
    btnReport.textContent = '🐛 Report Issue';
    btnReport.addEventListener('click', () => this._reportIssue());
    step3.appendChild(btnReport);
    stepsSection.appendChild(step3);

    container.appendChild(stepsSection);

    // ── Reset Plugin ──
    const resetSection = document.createElement('div');
    resetSection.className = 'settings-section';

    const resetTitle = document.createElement('div');
    resetTitle.className = 'detail-section__title';
    resetTitle.textContent = 'Reset Plugin';
    resetSection.appendChild(resetTitle);

    const resetDesc = document.createElement('p');
    resetDesc.className = 'text-muted';
    resetDesc.style.fontSize = '0.85rem';
    resetDesc.textContent = 'Delete all persistent data, stored accessories, and logs. You will need to log in again.';
    resetSection.appendChild(resetDesc);

    const btnReset = document.createElement('button');
    btnReset.className = 'btn btn-outline-danger btn-sm';
    btnReset.textContent = '🗑️ Reset Plugin';
    btnReset.addEventListener('click', () => this._confirmReset(container));
    resetSection.appendChild(btnReset);

    container.appendChild(resetSection);
  },

  // ===== Report Issue =====
  async _reportIssue() {
    try {
      homebridge.toast.info('Gathering system info...', 'Report Issue');
      const info = await Api.getSystemInfo();

      const envSection = [
        `- **Plugin Version**: ${info.pluginVersion}`,
        `- **Homebridge Version**: ${info.homebridgeVersion}`,
        `- **Node.js Version**: ${info.nodeVersion}`,
        `- **OS**: ${info.os}`,
        `- **eufy-security-client**: ${info.eufyClientVersion}`,
      ].join('\n');

      const params = new URLSearchParams();
      params.set('template', 'bug_report.yml');
      params.set('environment', envSection);

      const url = 'https://github.com/homebridge-plugins/homebridge-eufy-security/issues/new?' + params.toString();
      window.open(url, '_blank');
    } catch (e) {
      homebridge.toast.error('Could not gather system info. Opening blank issue form.');
      window.open('https://github.com/homebridge-plugins/homebridge-eufy-security/issues/new?template=bug_report.yml', '_blank');
    }
  },

  // ===== Diagnostics Download =====
  async _downloadDiagnostics(container) {
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

    Api.onDiagnosticsProgress((data) => {
      const bar = document.querySelector('#log-progress-bar');
      const status = document.querySelector('#log-progress-status');
      if (bar) bar.style.width = data.progress + '%';
      if (status) status.textContent = data.status;
    });

    try {
      const result = await Api.downloadDiagnostics();
      const rawBuffer = result.buffer || result;
      const filename = result.filename || 'eufy-security-diagnostics.zip';
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

      homebridge.toast.success('Diagnostics downloaded.');
    } catch (e) {
      homebridge.toast.error('Failed to download diagnostics: ' + (e.message || e));
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
        await Config.update({ platform: 'EufySecurity' });
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

  /**
   * Create a numbered step block with title and description.
   */
  _stepBlock(number, title, description) {
    const block = document.createElement('div');
    block.className = 'diag-step';

    const header = document.createElement('div');
    header.className = 'diag-step__header';

    const badge = document.createElement('span');
    badge.className = 'diag-step__badge';
    badge.textContent = number;
    header.appendChild(badge);

    const titleEl = document.createElement('strong');
    titleEl.textContent = title;
    header.appendChild(titleEl);

    block.appendChild(header);

    if (description) {
      const desc = document.createElement('p');
      desc.className = 'text-muted mb-2';
      desc.style.fontSize = '0.85rem';
      desc.textContent = description;
      block.appendChild(desc);
    }

    return block;
  },
};
