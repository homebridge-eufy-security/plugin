# Homebridge Plugin for Eufy Security

This repo is a work in progress so please treat it as a Beta. Contributions are welcome!

![npm](https://img.shields.io/npm/v/homebridge-eufy-security?style=flat-square)

![npm](https://img.shields.io/npm/dt/homebridge-eufy-security)

https://www.npmjs.com/package/homebridge-eufy-security

This project uses the eufy-security-client made by Bropat: https://github.com/bropat/eufy-security-client

### Setup

Recommendation: Create a second Eufy account and add it as a guest account from your primary account. Use the second account for HomeBridge only.

-   Enter Eufy username and password in the configuration for HomeBridge. At this time, 2FA is not supported
-   Optional settings: You can change the default mapping of the security modes. Currently HomeKit only has the following modes and they cannot be renamed:
    -   Home, Away, Night, Off

## Doorbell
To use the livestream feature of the doorbell, you must install ffmpeg as well
`npm i ffmpeg-for-homebridge`

The doorbell support is still a work in progress and needs more testing. Please use [this](https://github.com/samemory/homebridge-eufy-security/discussions/32) discussion to share your experience.

## Current Support

| Eufy Device   | Supported Functions             | HomeKit                               |
| ------------- | ------------------------------- | ------------------------------------- |
| HomeBase      | Can change guard mode           | Shows as a security system in HomeKit |
| Camera        | Reports motion On/Off           | Shows as Motion Sensor                |
| Motion Sensor | Reports motion                  | Shows as Motion Sensor                |
| Entry Sensor  | Open/Close detection            | Shows as Contact Sensor               |
| Doorbell      | Livestream, Ringing Notification | Shows as Doorbell                     |
| Keypad        | Battery low level               | Shows as Switch                       |

## Roadmap

-   Add 2FA
-   Add support for turning cameras on/off

Feel free to contribute to this plugin by opening a PR!

## Issues

Please open a GitHub issue.

This is a side project for me so I will do my best to look at issues when I can.

## Supporting

If you appreciate this plugin and want to support me, you can do it here:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/S6S24XCVJ)

Also consider supporting the other contributors:

-   **[schliemann](https://github.com/schliemann)**
-   [**lenoxys**](https://github.com/lenoxys)
