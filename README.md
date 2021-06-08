# Homebridge Plugin for Eufy Security

This repo is a work in progress and is not finished. I will be working on getting this done whenever I have time.

![npm](https://img.shields.io/npm/v/homebridge-eufy-security?style=flat-square)

https://www.npmjs.com/package/homebridge-eufy-security

This project uses the eufy-security-client made by Bropat: https://github.com/bropat/eufy-security-client

Enter Eufy username and password in the configuration for HomeBridge. At this time, 2FA is not supported

## Current Support

| Eufy Device   | Supported Functions   | HomeKit                               |
| ------------- | --------------------- | ------------------------------------- |
| HomeBase      | Can change guard mode | Shows as a security system in HomeKit |
| Camera        | Reports motion        | Shows as Motion Sensor                |
| Motion Sensor | Reports motion        | Shows as Motion Sensor                |
| Entry Sensor  | Open/Close detection  | Shows as Contact Sensor               |
