<p align="center">
   <a href="https://github.com/homebridge-eufy-security/plugin"><img src="https://raw.githubusercontent.com/wiki/homebridge-eufy-security/plugin/img/homebridge-eufy-security.png" width="456px"></a>
</p>
<span align="center">

# homebridge-eufy-security

⚠️ WARNING:
> This is a fork of homebridge-eufy-security with fixes for the E340 doorbell (Node 24.x compatibility, PKCS1 padding). Use at your own risk.

Homebridge plugin to control certain Eufy Security devices

[![npm](https://img.shields.io/npm/v/homebridge-eufy-security?color=green)](https://www.npmjs.com/package/homebridge-eufy-security)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm](https://img.shields.io/npm/dt/homebridge-eufy-security)](https://www.npmjs.com/package/homebridge-eufy-security)

[![npm](https://img.shields.io/npm/v/homebridge-eufy-security/rc?label=rc)](https://github.com/homebridge-eufy-security/plugin/wiki/Special-Version-(BETA---RC---HKSV))
[![npm](https://img.shields.io/npm/v/homebridge-eufy-security/beta?label=beta)](https://github.com/homebridge-eufy-security/plugin/wiki/Special-Version-(BETA---RC---HKSV))
[![npm](https://img.shields.io/npm/v/homebridge-eufy-security/hksv?label=hksv)](https://github.com/homebridge-eufy-security/plugin/wiki/Special-Version-(BETA---RC---HKSV))
[![Discord](https://img.shields.io/discord/432663330281226270?color=728ED5&logo=discord&label=hb-discord)](https://discord.com/channels/432663330281226270/876907345962229791)

</span>

### Plugin Information

- This plugin allows you to view and control your Eufy Security devices within HomeKit. The plugin:
  - requires your Eufy Security credentials **(we highly recommend to use [Family/Guest Account](https://support.eufylife.com/s/article/Share-Your-eufySecurity-Devices-With-Your-Family) dedicated to the plugin)**
  - we support Eufy Security OTP validation by email and captcha

### Prerequisites

- To use this plugin, you will need to already have [Homebridge](https://homebridge.io) (at least v1.6.1)  installed. Refer to the links for more information and installation instructions.
- For configuration Homebridge UI is recommenend. If you have 2FA enabled it is mandatory.

### ⚠️ Warning
Starting from Node.js versions `18.19.1`, `20.11.1`, and `21.6.2`, the removal of `RSA_PKCS1_PADDING` support breaks Eufy Security's livestream/P2P functionality. We advise against using Node.js versions beyond **v20.11.0** until compatibility with the plugin has been confirmed. If you encounter any issues, consider reverting to the recommended LTS version within the **v20** branch. See [here](https://github.com/homebridge-eufy-security/plugin/wiki/Node.js-Compatibility-with-Eufy-Security-Plugin) for more information.

#### Setup
* [Installation](https://github.com/homebridge-eufy-security/plugin/wiki/Installation-and-Configuration#installation)
* [Configuration](https://github.com/homebridge-eufy-security/plugin/wiki/Installation-and-Configuration#configuration)
* [Bridged and Unbridged Mode](https://github.com/homebridge-eufy-security/plugin/wiki/Bridged-and-Unbridged-Mode-and-Problems)
* [Beta Version](https://github.com/homebridge-eufy-security/plugin/wiki/Special-Version-(BETA---RC---HKSV))
* [Uninstallation](https://github.com/homebridge-eufy-security/plugin/wiki/Uninstallation)

#### Features
* [Streaming](https://github.com/homebridge-eufy-security/plugin/wiki/Streaming-Settings)
* [HomeKit Secure Video](https://github.com/homebridge-eufy-security/plugin/wiki/HomeKit-Secure-Video)

#### Help
* [Basic Troubleshooting](https://github.com/homebridge-eufy-security/plugin/wiki/Basic-Troubleshooting)
* [Common Issues](https://github.com/homebridge-eufy-security/plugin/wiki/Common-Issues)
* [Support Request](https://github.com/homebridge-eufy-security/plugin/issues/new/choose)
* [Changelog](https://github.com/homebridge-eufy-security/plugin/blob/master/CHANGELOG.md)

### Supporting

If you appreciate this plugin and want to support the work we do, you can use one of the following links:

**Active Contributors**

- **[lenoxys](https://github.com/sponsors/lenoxys)**
- **[schliemann](https://github.com/schliemann)**
- **[thieren](https://ko-fi.com/thieren)**

**The guy who started it all**

- **[samemory](https://ko-fi.com/S6S24XCVJ)**


**And also**

Big thanks to **[bropat](https://github.com/bropat)** who made this possible. You can support him [here](https://ko-fi.com/bropat)

### Disclaimer

- We are in no way affiliated with Eufy Security and this plugin is a personal project that we maintain in our free time.
- Use this plugin entirely at your own risk - please see licence for more information.
