/**
 * Login View — multi-step wizard for Eufy Security authentication.
 * Steps: Welcome → Credentials → TFA (if needed) → Captcha (if needed) → Discovery
 */
// eslint-disable-next-line no-unused-vars
const LoginView = {
  STEP: { WELCOME: 0, CREDENTIALS: 1, TFA: 2, CAPTCHA: 3, DISCOVERY: 4 },

  _currentStep: 0,
  _captchaData: null,
  _credentials: null,
  _container: null,

  render(container) {
    this._container = container;
    this._currentStep = this.STEP.WELCOME;
    this._renderStep();
  },

  _renderStep() {
    const c = this._container;
    c.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'login-card';

    switch (this._currentStep) {
      case this.STEP.WELCOME:
        this._renderWelcome(wrap);
        break;
      case this.STEP.CREDENTIALS:
        this._renderCredentials(wrap);
        break;
      case this.STEP.TFA:
        this._renderTFA(wrap);
        break;
      case this.STEP.CAPTCHA:
        this._renderCaptcha(wrap);
        break;
      case this.STEP.DISCOVERY:
        this._renderDiscovery(wrap);
        break;
    }

    c.appendChild(wrap);
  },

  // ===== Step 0: Welcome =====
  _renderWelcome(wrap) {
    const card = this._card(wrap, 'Welcome');

    const body = card.querySelector('.card-body');
    body.innerHTML = `
      <div class="welcome-banner">
        <div class="welcome-banner__title">Eufy Security for HomeKit</div>
        <div class="welcome-banner__text">
          Connect your Eufy Security devices to Apple HomeKit through Homebridge.
          You'll need your Eufy account credentials to get started.
        </div>
      </div>
      <div class="alert alert-warning mt-3" role="alert" style="font-size: 0.85rem;">
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="ack-guest-admin">
          <label class="form-check-label" for="ack-guest-admin">
            <strong>Important:</strong> Use a <strong>dedicated guest admin account</strong> — not your primary Eufy account.
            <a href="https://github.com/homebridge-eufy-security/plugin/wiki/Create-a-dedicated-admin-account-for-Homebridge-Eufy-Security-Plugin" target="_blank">Learn more</a>
          </label>
        </div>
      </div>
      <div class="alert alert-info mt-2" role="alert" style="font-size: 0.85rem;">
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="ack-stop-plugin">
          <label class="form-check-label" for="ack-stop-plugin">
            If the plugin is currently running, please <strong>stop it first</strong> before logging in here. Both cannot use the same credentials simultaneously.
          </label>
        </div>
      </div>
      <div id="node-version-warning" class="d-none"></div>
      <button class="btn btn-primary w-100 mt-2" id="btn-start" disabled>Continue to Login</button>
    `;

    const ack1 = body.querySelector('#ack-guest-admin');
    const ack2 = body.querySelector('#ack-stop-plugin');
    const btnStart = body.querySelector('#btn-start');
    const nodeWarningContainer = body.querySelector('#node-version-warning');
    let ack3 = null; // Node version checkbox, only if affected

    const updateBtn = () => {
      const allChecked = ack1.checked && ack2.checked && (!ack3 || ack3.checked);
      btnStart.disabled = !allChecked;
    };
    ack1.addEventListener('change', updateBtn);
    ack2.addEventListener('change', updateBtn);

    // Check Node.js version and conditionally show warning
    App.checkNodeVersion().then(() => {
      const warning = App.state.nodeVersionWarning;
      if (warning && warning.affected) {
        nodeWarningContainer.className = 'alert alert-danger mt-2';
        nodeWarningContainer.setAttribute('role', 'alert');
        nodeWarningContainer.style.fontSize = '0.85rem';

        const formCheck = document.createElement('div');
        formCheck.className = 'form-check';

        const input = document.createElement('input');
        input.className = 'form-check-input';
        input.type = 'checkbox';
        input.id = 'ack-node-version';
        formCheck.appendChild(input);

        const label = document.createElement('label');
        label.className = 'form-check-label';
        label.htmlFor = 'ack-node-version';

        const strongPrefix = document.createElement('strong');
        strongPrefix.textContent = 'Streaming unavailable:';
        label.appendChild(strongPrefix);
        label.appendChild(document.createTextNode(' Node.js '));
        const strongVer = document.createElement('strong');
        strongVer.textContent = warning.nodeVersion;
        label.appendChild(strongVer);
        label.appendChild(document.createTextNode(' — '));
        Helpers.appendNodeVersionWarning(label);

        formCheck.appendChild(label);
        nodeWarningContainer.appendChild(formCheck);
        ack3 = nodeWarningContainer.querySelector('#ack-node-version');
        ack3.addEventListener('change', updateBtn);
        updateBtn();
      }
    });

    btnStart.addEventListener('click', () => {
      this._currentStep = this.STEP.CREDENTIALS;
      this._renderStep();
    });
  },

  // ===== Step 1: Credentials =====
  _renderCredentials(wrap) {
    const card = this._card(wrap, 'Sign In');
    const body = card.querySelector('.card-body');

    this._renderStepDots(body, 1);

    body.insertAdjacentHTML('beforeend', `
      <div class="mb-3">
        <label for="login-email" class="form-label">Email Address</label>
        <input type="email" class="form-control" id="login-email" placeholder="your-eufy-email@example.com" required>
      </div>
      <div class="mb-3">
        <label for="login-password" class="form-label">Password</label>
        <input type="password" class="form-control" id="login-password" placeholder="Password" required>
      </div>
      <div class="mb-3">
        <label for="login-country" class="form-label">Country</label>
        <select class="form-select" id="login-country"></select>
      </div>
      <div class="mb-3">
        <label for="login-device" class="form-label">Device Name</label>
        <input type="text" class="form-control" id="login-device" value="" placeholder="e.g. My Homebridge">
        <div class="form-text">A name to identify this Homebridge instance to Eufy. Can be left blank.</div>
      </div>
      <div id="login-error" class="alert alert-danger d-none" role="alert"></div>
      <button class="btn btn-primary w-100" id="btn-login" type="button">
        <span class="spinner-border spinner-border-sm d-none me-1" id="login-spinner"></span>
        Sign In
      </button>
    `);

    // Populate country dropdown
    const countrySelect = body.querySelector('#login-country');
    Object.entries(COUNTRIES).forEach(([code, name]) => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = name;
      if (code === 'US') opt.selected = true;
      countrySelect.appendChild(opt);
    });

    // Pre-fill from existing config if available
    this._prefillCredentials(body);

    // Submit
    body.querySelector('#btn-login').addEventListener('click', () => this._doLogin(body));

    // Enter key support
    body.querySelectorAll('input').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._doLogin(body);
      });
    });
  },

  async _prefillCredentials(body) {
    try {
      const config = await Config.get();
      if (config.username) body.querySelector('#login-email').value = config.username;
      if (config.password) body.querySelector('#login-password').value = config.password;
      if (config.country) body.querySelector('#login-country').value = config.country;
      if (config.deviceName) body.querySelector('#login-device').value = config.deviceName;
    } catch (e) {
      // Ignore — no config yet
    }
  },

  async _doLogin(body) {
    const email = body.querySelector('#login-email').value.trim();
    const password = body.querySelector('#login-password').value;
    const country = body.querySelector('#login-country').value;
    const deviceName = body.querySelector('#login-device').value.trim() || '';

    if (!email || !password) {
      this._showError(body, 'Please enter your email and password.');
      return;
    }

    this._setLoading(body, true);
    this._hideError(body);

    try {
      // Stash credentials in memory — save only after full auth succeeds
      this._credentials = { username: email, password: password, country: country, deviceName: deviceName };

      const result = await Api.login({
        username: email,
        password: password,
        country: country,
        deviceName: deviceName,
      });

      if (result.success) {
        this._currentStep = this.STEP.DISCOVERY;
        this._renderStep();
      } else if (result.failReason === 2) {
        // TFA required
        this._currentStep = this.STEP.TFA;
        this._renderStep();
      } else if (result.failReason === 1) {
        // Captcha required
        this._captchaData = result.data;
        this._currentStep = this.STEP.CAPTCHA;
        this._renderStep();
      } else if (result.failReason === 3) {
        this._showError(body, 'Login timed out. Please try again.');
        this._setLoading(body, false);
      } else {
        this._showError(body, 'Login failed. Please check your credentials.');
        this._setLoading(body, false);
      }
    } catch (e) {
      this._showError(body, 'Connection error: ' + (e.message || e));
      this._setLoading(body, false);
    }
  },

  // ===== Step 2: TFA =====
  _renderTFA(wrap) {
    const card = this._card(wrap, 'Two-Factor Authentication');
    const body = card.querySelector('.card-body');

    this._renderStepDots(body, 2);

    body.insertAdjacentHTML('beforeend', `
      <p class="text-muted" style="font-size: 0.85rem;">
        A verification code has been sent to your registered device or email. Enter it below.
      </p>
      <div class="mb-3">
        <label for="tfa-code" class="form-label">Verification Code</label>
        <input type="text" class="form-control text-center" id="tfa-code" placeholder="000000"
               maxlength="6" autocomplete="one-time-code" inputmode="numeric" style="font-size: 1.5rem; letter-spacing: 0.3em;">
      </div>
      <div id="login-error" class="alert alert-danger d-none" role="alert"></div>
      <button class="btn btn-primary w-100" id="btn-verify">
        <span class="spinner-border spinner-border-sm d-none me-1" id="login-spinner"></span>
        Verify
      </button>
    `);

    body.querySelector('#tfa-code').focus();

    body.querySelector('#btn-verify').addEventListener('click', () => this._doTFA(body));
    body.querySelector('#tfa-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._doTFA(body);
    });
  },

  async _doTFA(body) {
    const code = body.querySelector('#tfa-code').value.trim();
    if (!code) {
      this._showError(body, 'Please enter the verification code.');
      return;
    }

    this._setLoading(body, true);
    this._hideError(body);

    try {
      const result = await Api.login({ verifyCode: code });
      if (result.success) {
        this._currentStep = this.STEP.DISCOVERY;
        this._renderStep();
      } else {
        this._showError(body, 'Invalid code. Please try again.');
        this._setLoading(body, false);
      }
    } catch (e) {
      this._showError(body, 'Error: ' + (e.message || e));
      this._setLoading(body, false);
    }
  },

  // ===== Step 3: Captcha =====
  _renderCaptcha(wrap) {
    const card = this._card(wrap, 'Captcha Verification');
    const body = card.querySelector('.card-body');

    this._renderStepDots(body, 3);

    body.insertAdjacentHTML('beforeend', `
      <p class="text-muted" style="font-size: 0.85rem;">
        Please solve the captcha below to continue.
      </p>
      <div class="text-center mb-3">
        <img id="captcha-image" class="img-fluid border rounded" alt="Captcha" style="max-height: 100px;">
      </div>
      <div class="mb-3">
        <label for="captcha-code" class="form-label">Captcha Code</label>
        <input type="text" class="form-control text-center" id="captcha-code" placeholder="Enter captcha"
               style="font-size: 1.2rem; letter-spacing: 0.2em;">
      </div>
      <div id="login-error" class="alert alert-danger d-none" role="alert"></div>
      <button class="btn btn-primary w-100" id="btn-captcha">
        <span class="spinner-border spinner-border-sm d-none me-1" id="login-spinner"></span>
        Submit
      </button>
    `);

    if (this._captchaData && this._captchaData.captcha) {
      body.querySelector('#captcha-image').src = this._captchaData.captcha;
    }

    body.querySelector('#captcha-code').focus();

    body.querySelector('#btn-captcha').addEventListener('click', () => this._doCaptcha(body));
    body.querySelector('#captcha-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._doCaptcha(body);
    });
  },

  async _doCaptcha(body) {
    const code = body.querySelector('#captcha-code').value.trim();
    if (!code) {
      this._showError(body, 'Please enter the captcha code.');
      return;
    }

    this._setLoading(body, true);
    this._hideError(body);

    try {
      const result = await Api.login({
        captcha: {
          captchaCode: code,
          captchaId: this._captchaData.id,
        },
      });
      if (result.success) {
        this._currentStep = this.STEP.DISCOVERY;
        this._renderStep();
      } else if (result.failReason === 2) {
        // TFA required after captcha — Eufy sent an OTP
        this._currentStep = this.STEP.TFA;
        this._renderStep();
      } else if (result.failReason === 1) {
        // New captcha
        this._captchaData = result.data;
        this._showError(body, 'Incorrect captcha. Please try again.');
        if (result.data && result.data.captcha) {
          body.querySelector('#captcha-image').src = result.data.captcha;
        }
        this._setLoading(body, false);
      } else if (result.failReason === 3) {
        this._showError(body, 'Login timed out. Please try again.');
        this._setLoading(body, false);
      } else {
        this._showError(body, 'Verification failed. Please try again.');
        this._setLoading(body, false);
      }
    } catch (e) {
      this._showError(body, 'Error: ' + (e.message || e));
      this._setLoading(body, false);
    }
  },

  // ===== Step 4: Discovery =====
  _renderDiscovery(wrap) {
    wrap.innerHTML = `
      <div class="discovery-screen">
        <div class="discovery-screen__icon">📡</div>
        <div class="discovery-screen__title">Discovering your devices...</div>
        <div class="discovery-screen__subtitle">
          Connecting to Eufy servers and detecting all your stations and devices.<br>
          This usually takes about <strong>45 seconds</strong>. Hang tight!
        </div>
        <div class="progress mt-4" style="max-width: 300px; margin: 0 auto; height: 6px;">
          <div class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar"
               style="width: 0%" id="discovery-progress"></div>
        </div>
        <div class="text-muted mt-2" style="font-size: 0.8rem;" id="discovery-status">Initializing...</div>
      </div>
    `;

    // Animate progress bar over ~45 seconds
    let progress = 0;
    const progressBar = wrap.querySelector('#discovery-progress');
    const statusEl = wrap.querySelector('#discovery-status');

    const messages = [
      { at: 5, text: 'Authenticating with Eufy Cloud...' },
      { at: 15, text: 'Fetching station list...' },
      { at: 30, text: 'Detecting devices...' },
      { at: 50, text: 'Analyzing compatibility...' },
      { at: 70, text: 'Processing device features...' },
      { at: 85, text: 'Almost there...' },
    ];

    const interval = setInterval(() => {
      progress += 2;
      if (progress > 90) progress = 90; // Cap at 90% until event arrives
      progressBar.style.width = progress + '%';

      const msg = messages.filter((m) => m.at <= progress).pop();
      if (msg) statusEl.textContent = msg.text;
    }, 1000);

    // Listen for the batch-processed accessories
    Api.onAccessoriesReady((stations) => {
      clearInterval(interval);
      progressBar.style.width = '100%';
      statusEl.textContent = 'Done!';

      // Auth fully complete — save credentials to config
      if (this._credentials) {
        Config.updateGlobal(this._credentials).then(() => Config.save());
        this._credentials = null;
      }

      // Go to dashboard
      setTimeout(() => {
        App.state.stations = stations;
        App.navigate('dashboard');
      }, 500);
    });
  },

  // ===== Helpers =====

  _card(container, title) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-header">${title}</div>
      <div class="card-body"></div>
    `;
    container.appendChild(card);
    return card;
  },

  _renderStepDots(body, activeStep) {
    const dots = document.createElement('div');
    dots.className = 'login-step-indicator';
    for (let i = 1; i <= 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'login-step-dot';
      if (i === activeStep) dot.classList.add('login-step-dot--active');
      if (i < activeStep) dot.classList.add('login-step-dot--done');
      dots.appendChild(dot);
    }
    body.appendChild(dots);
  },

  _showError(body, msg) {
    const el = body.querySelector('#login-error');
    if (el) {
      el.textContent = msg;
      el.classList.remove('d-none');
    }
  },

  _hideError(body) {
    const el = body.querySelector('#login-error');
    if (el) el.classList.add('d-none');
  },

  _setLoading(body, loading) {
    const btn = body.querySelector('.btn-primary');
    const spinner = body.querySelector('#login-spinner');
    if (btn) btn.disabled = loading;
    if (spinner) {
      spinner.classList.toggle('d-none', !loading);
    }
  },
};
