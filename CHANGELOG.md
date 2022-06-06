# Change Log

## 2.0.1 (beta) (06/06/2022)

### Changed
-   Additional log output when station guard mode is changed (see [enhancement]: Logging basic operations such as guard mode change on the UI without debug mode #39)
-   Edited description for livestream caching in configuration wizard
-   Changed log output messages for better understanding
-   Added error handling for misconfigured guard modes (possible fix [Bug]: Disarming Dufy Security Fails and Crashes Homebridge Server #52)
-   Added timeouts for guard mode changes with corresponding log messages and one retry (possible fix for [Bug]: Eufy Indoor Cam 2k alarm state issue #38 and [enhancement]: Logging basic operations such as guard mode change on the UI without debug mode #39)
-   Improved snapshot handling

### Fixed
-   [Bug]: package.json reqiures the wrong node version #44
- Bug where a local livestream cache may not have been shutdown properly and so subsequent livestreams would not be started
- A problem where motion events prevented the livestream cache to terminate properly (see [Bug]: Snapshot updates problem #43)
- Changed log file rotation behaviour to prevent race conditions with already moved log files (fix for #56)
- Sometimes motion events were not reset correctly, this will now be prevented
-   Fix issue while New Config UI (2.0.0 and above) causes Push Notification to not work properly #59
- Livestreams could fail if videoconfig was wrongly updated by plugin
- First snapshots in balanced mode were failing since there weren't snapshots available

## 2.0 (25/05/2022)

### Added
-   Local Livestream
-   Ability to switch light on compatible device (to be tested)
-   Fixing Duplicate notification on doorbell ring #236
-   Change Country #310
-   Provide a clear/reset wizard in order to clean persistent data
-   Add a config value to remove enable/motion homekit buttons #320
-   Handling captcha request
-   Adding videoconfig setting per camera
-   Adding a new button to force or not using live stream to create snapshot
-   Warn if user is using primary Eufy account instead of guest admin one

### Changed
-   Upgrade to the latest bropat/eufy-security-client lib (2.0.1)
-   Added livestream cache for local streaming (no rtsp) thanks @thieren

### Fixed
-   Updating some dep for security reason
-   Fix keypad issue while using off/disarmed mode (#88, #147, #197)
-   Handling stop livestream event from Eufy Station #262
-   Fix HB crashed #321 thanks @schliemann
-   Fix Arming stuck while using Schedule or Geo #342
-   Streaming issue while using Docker #308 (thanks @alternativ)
-   Fix issue on video stream while debug is disabled #356
-   Improve selecting Static Image / Local Live Stream / RTSP #382
-   Improvements for local livestream caching and bugfixes #37 thanks @thieren

### Removed
-   Selecting Camera or Motion Sensor is now per camera

## 1.0.1 (18/10/2021)

### Fixed
-  [Bug]: can’t login after plug-in remove #254 

## 1.0.0 (09/02/2021)

### Added
-   Increase compatibility with new Eufy Camera devices
-   New Config UI with onboarding
-   OTP attached to an Eufy Account is supported
-   Adding SmartLock (getting the status lock/unlock only)
-   Hability to use Camera as a motion sensor or as a camera streaming device
-   Audio support on LiveStream

### Changed
-   Upgrade to the latest bropat/eufy-security-client lib (1.1.2)
-   Improving debug collection
-   Code optimisation

### Removed
-   IP LAN address is no more required as config settings

### Fixed
-   Cloud Livestream on doorbell can stuck
-   Handle duplicate when using Guest Eufy Account
-   Updating some dep for security reason
-   Multiple typo fix
-   Sometimes battery status is not updated
-   Fix push notification issue on new indoor outdoor camera device #184
-   Fixing issue #190
-   As @bropat notice, we need to clean function reference which will be deprecated soon (bropat/eufy-security-client#40)

## 0.2.13 (07-26-2021)

### Changes

-   Motion Sensor Fix, trigger when motion is detected

## 0.2.12 (07-25-2021)

### Changes

-   Improvements to the motion sensor trigger

## 0.2.11 (07-19-2021)

### Changes

-   Improvements to handing alarm events
-   Many other improvements that were in the dev npm version

## 0.2.5 (06-26-2021)

### Changes

-   Improvements to handing alarm events
-   Other small bug fixes

## 0.2.4 (06-21-2021)

### Changes

-   Improvements to the doorbell motion sensor feature
-   Other small bug fixes


### Changes

-   Fixed doorbell ringing notification
-   Added switch to enable/disable motion detection for Cameras (not doorbell)
-   Better logging for debugging the doorbell

## 0.2.3 (06-20-2021)

### Changes

-   Fixed doorbell ringing notification
-   Added switch to enable/disable motion detection for Cameras (not doorbell)
-   Better logging for debugging the doorbell

## 0.2.2 (06-14-2021)

### Changes

-   Added switch to turn cameras on/off using a switch.
-   Added logging for the doorbell to help solve issues.

## 0.2.0 (06-12-2021)

### Changes

-   Doorbell now can stream video! More testing might be needed since there are a few differnt models supported.

## 0.1.3 (06-11-2021)

### Changes

-   Improvements to the doorbell functionality.

## 0.1.2 (06-11-2021)

### Changes

-   Fixed push notifications for security system
-   Added logging for hubs.

## 0.1.1 (06-10-2021)

### Changes

-   Added support for doorbell (ring notificaitons only)
-   Added support for security keypad (only battery notifications at this time)
-   Other small bug fixes
