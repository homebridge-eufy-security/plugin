# Homebridge Plugin for Eufy Security

This repo is a work in progress so please treat it as a Beta. Contributions are welcome!

![npm](https://img.shields.io/npm/v/homebridge-eufy-security?style=flat-square)

https://www.npmjs.com/package/homebridge-eufy-security

This project uses the eufy-security-client made by Bropat: https://github.com/bropat/eufy-security-client

### Setup

Recommendation: Create a second Eufy account and add it as a guest account from your primary account. Use the second account for HomeBridge only.

- Enter Eufy username and password in the configuration for HomeBridge. At this time, 2FA is not supported
- Optional settings: You can change the default mapping of the security modes. Currently HomeKit only has the following modes and they cannot be renamed:
  - Home, Away, Night, Off

## Current Support

| Eufy Device   | Supported Functions   | HomeKit                               |
| ------------- | --------------------- | ------------------------------------- |
| HomeBase      | Can change guard mode | Shows as a security system in HomeKit |
| Camera        | Reports motion        | Shows as Motion Sensor                |
| Motion Sensor | Reports motion        | Shows as Motion Sensor                |
| Entry Sensor  | Open/Close detection  | Shows as Contact Sensor               |
| Doorbell      | Ringing Notification  | Shows as Dummy Object                 |
| Keypad        | Battery low level     | Shows as Switch                       |

## Roadmap

- Add 2FA
- Add Doorbell support
- Add support for turning cameras on/off

Feel free to contribute to this plugin by opening a PR!

## Issues

Please open a GitHub issue.

This is a side project for me so I will do my best to look at issues when I can.
