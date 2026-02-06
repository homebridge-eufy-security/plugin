/**
 * App — main controller, hash-based SPA router, and global state.
 * Entry point initialized on homebridge 'ready' event.
 */
// eslint-disable-next-line no-unused-vars
const App = {
  /** Global state shared across views */
  state: {
    stations: [],
    initialized: false,
  },

  /** Root container element */
  _root: null,

  /**
   * Initialize the app. Called once on homebridge 'ready' event.
   */
  async init() {
    this._root = document.getElementById('app');

    // Let Homebridge's native Save button handle saving to disk.
    // We call updatePluginConfig() on every change to keep config in sync.

    // Listen for admin account error globally
    Api.onAdminAccountUsed(() => {
      this._showAdminError();
    });

    // Listen for version mismatch
    Api.onVersionUnmatched(({ currentVersion, storedVersion }) => {
      homebridge.toast.warning(
        `Stored accessories version (${storedVersion}) differs from current (${currentVersion}). Please re-login to refresh.`,
        'Version Mismatch'
      );
    });

    // Listen for hash changes
    window.addEventListener('hashchange', () => this._onRoute());

    // Determine initial route
    try {
      // Load config without pushing it back to Homebridge
      const config = await Config.load();
      if (!config.platform) {
        // Initialize default config only if truly empty
        await Config.update({ platform: 'EufySecurity', name: 'EufySecurity' });
      }

      const stored = await Api.loadStoredAccessories();
      if (stored && stored.length > 0) {
        this.state.stations = stored;
        if (!window.location.hash || window.location.hash === '#/') {
          this.navigate('dashboard');
        } else {
          this._onRoute();
        }
      } else {
        this.navigate('login');
      }
    } catch (e) {
      // No stored accessories — go to login
      this.navigate('login');
    }

    this.state.initialized = true;
  },

  /**
   * Navigate to a route.
   * @param {string} route - e.g. 'login', 'dashboard', 'detail/device/SERIAL', 'settings'
   */
  navigate(route) {
    window.location.hash = '#/' + route;
  },

  /**
   * Handle route changes.
   */
  _onRoute() {
    const hash = window.location.hash.replace('#/', '') || '';
    const parts = hash.split('/');
    const route = parts[0];

    // Clear the root container
    this._root.innerHTML = '';

    switch (route) {
      case 'login':
        LoginView.render(this._root);
        break;

      case 'dashboard':
        DashboardView.render(this._root);
        break;

      case 'detail': {
        const type = parts[1]; // 'device' or 'station'
        const id = parts[2];   // uniqueId
        if (type && id) {
          DeviceDetailView.render(this._root, type, id);
        } else {
          this.navigate('dashboard');
        }
        break;
      }

      case 'settings':
        SettingsView.render(this._root);
        break;

      default:
        // Unknown route — try dashboard if we have stations, otherwise login
        if (this.state.stations.length > 0) {
          this.navigate('dashboard');
        } else {
          this.navigate('login');
        }
        break;
    }
  },

  /**
   * Show a blocking error when admin account is detected.
   */
  _showAdminError() {
    this._root.innerHTML = `
      <div class="alert alert-danger alert-admin mt-4" role="alert">
        <h5 class="alert-heading">⚠️ Admin Account Detected</h5>
        <p>
          You are not using a <strong>dedicated guest admin account</strong>. 
          Using your primary Eufy account can cause conflicts with the Eufy app.
        </p>
        <hr>
        <p class="mb-0">
          Please create a dedicated admin account for this plugin.
          <a href="https://github.com/homebridge-eufy-security/plugin/wiki/Create-a-dedicated-admin-account-for-Homebridge-Eufy-Security-Plugin" 
             target="_blank" class="alert-link">
            Follow this guide
          </a>
        </p>
      </div>
    `;
  },
};

// ===== Bootstrap the app when Homebridge UI is ready =====
homebridge.addEventListener('ready', () => {
  App.init();
});
