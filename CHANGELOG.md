# Change Log

You can find the complete detailled changelog for every beta release [here](https://github.com/homebridge-eufy-security/plugin/releases).

## 2.2.0-beta.17 - latest changes

### Changed

- eufy-security-client library is now added as forked dependency to enable direct changes

### Fixed

- Trying to fix login issue #250
- Fixed installation issues with previous betas
- Package size was dramatically reduced by removing cache files

## 2.2.0 (Beta)

### Added

- HomeKit Secure Video (HKSV) Support (see #6)
- Experimental Mode
- Experimental Mode Option: Enabling RTSP streaming on all devices (e.g. Doorbells can now stream via RTSP)
- Plugin will show warnings if it encounters a captcha or 2FA request while logging in.
- Setting to crop image to requested resolution. This might help with streaming issues when the HomeKit Controller stops the stream due to wrong stream configuration.
- Added additional audio settings in advanced video configuration
- Setting to choose custom path to ffmpeg executable.
- Config UI will now warn the user if a setting might decrease battery life drastically
- Option to set connection method in eufy-security-client to 'local'
- Support for Homebase 3, Eufy Camera 3 and Eufy Camera 3C
- Setting to sync the guard modes of all stations.
- Setting to add a switch to turn indoor chime on/off on some doorbells
- Setting for mono/stereo talkback configuration (needed for certain devices)

### Changed

- If HomeKit Secure Video is enabled, motion detection will not work while a recording is active. This is due to technical limitations for now. (see #6)
- Removed livestream caching (a.k.a `useCachedLocalLivestream`) since the continued streaming could cause issues with HKSV and motion detection in general
- Overhauled design of advanced video config
- Improved verbose output for snapshot and ffmpeg processes
- Added explanatory description to snapshot handling method.
- Updated to latest dependency: eufy-security-client
- Warn the user if multiple cameras are connected through the same station and limit critical options for these cameras (snapshot method and HKSV)
- Log errors in command results from eufy-security-client library to homebridge
- Removed overhead in stream processing improve performance
- eufy-security-client library is now added as forked dependency to enable direct changes

### Fixed

- Switches to turn camera and motion on/off should now be removed from HomeKit if the user switches the configuration
- Bug where no snapshot was returned after an event
- Bug that caused a crash with node version prior to v14.18
- Talkback was not working properly due to wrong channel configuration (can now be chosen: mono/stereo) #196

## 2.1.0 (RC)

### Added

- Talkback support #103
- Improved snapshot handling: 3 different snapshot methods
- Feature to improve camera snapshots at night (night vision)
- Feature to automatically generate camera snapshots a given period of time, so that snapshots are more up-to-date
- Feature allowing enabling and disabling motion detection throug switch if camera is used as a motion sensor only
- Feature allowing enabling and disabling the camera throug switch even if camera is used as a motion sensor only
- Control Station alarm through HomeKit (reset the alarm and even trigger it with HomeKit automations. You can now trigger the alarm even with third party accessories - e.g. with devices from vendors other than eufy) - see #26
- Feature to download log files through plugin configuration ui
- Setting to disable log file storage to disk (possible fix for #93)
- Setting to choose that separate ffmpeg processes for audio and video streaming will be used (this can increase performance)
- Setting to choose audio sample rate
- Presets (`copy`, `performance`) for advanced video config

### Changed

- Complete redesign of the config ui screen
- RTSP setting is now only avaiable on compatible devices
- Updated to latest version of eufy-security-client (2.1.2) (fix for #72 and #38)
- Refactored whole project structure to resemble the new workspace layout (plugin + custom ui)
- Reimplementation of device discovery algorithm to better reflect best practices mentioned in [this comment](https://github.com/bropat/eufy-security-client/issues/167#issuecomment-1155388624)
- Added timeouts for guard mode changes. If these fail HomeKit will no longer get stuck, trying to change the guard mode and an error will be written to the log output (see #39)
- Limit value for maximum streaming duration to prevent unexpected behaviour (see #111)
- Additional debug messages to help with issues
- Updated repo funding details (Readme.md and package.json)
- Cleaned up dependencies
- Using tslog instead of bunyan for logging of eufy-security-client messages since bunyan would not print deep nested objects correctly
- Logging for eufy-security-client is moved to separate log file: `eufy-log.log`
- Refactored handling of ffmpeg processes
- Deprecated option `forcerefreshsnap` was removed and will no longer be evaluated - use `snapshotHandlingMethod` instead
- Removed `mapvideo`, `mapaudio`, `maxDelay` and `forceMax` options from advanced VideoConfig since they are deprecated

### Fixed

- Plugin crash if guard modes were configured incorrectly (see #52)
- Plugin crashed if station was disarmed with certain configured guard modes
- Config ui crash due to a wrong node version requirement (#44)
- Livestream could not be started if previous local livestream cache was not shut down correctly (e.g. #43)
- Livestream was not working if videoconfig was populated with empty values
- Plugin may have crashed due to a race condition regarding log file rotation (see #56)
- Motion events were not reseted correctly in some cases. So new events would not be recognized
- Push notifications stopped working if the configuration editor was opened and the plugin not restarted aftwerwards (see #59)
- Options enableCamera and enableMotion were not working in specific configuration situations (see #48)
- Unbridge setting was not working for doorbell cameras (see #79)
- Fixed #81
- Fixed all lint warnings and errors
- Fixed npm warnings
- Smart lock states could be wrong on plugin startup (further improvements needed for smartlocks)
- Setting to 'enable audio' was not working - audio was always streamed
- Setting `maxFPS` in advanced camera configuration should now work as expected (see #125)
- Fix issue that streams were only rendered in 640x480 - see #46
- Fixed smartlocks - see #110
- Fixed occasional EPIPE Error when streaming - see #14
- Streams might have been aborted after 30-60 seconds due to stream backpressuring

## 2.0.1 (20.06.2022)

### Fixed
- locked dependency version to prevent breaking changes

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
