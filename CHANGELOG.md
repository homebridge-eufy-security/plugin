# Change Log

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
