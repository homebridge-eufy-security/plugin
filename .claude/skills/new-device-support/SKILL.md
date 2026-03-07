---
name: new-device-support
description: Full workflow to add support for a new Eufy Security device type across eufy-security-client and homebridge-eufy-security. Covers exploration, implementation, build verification, and git/PR creation.
---

# Add New Eufy Security Device Support

You are adding support for a new device type to the eufy-security ecosystem. The user will provide a GitHub issue URL or device details (model name, model number like T86P2, device type number like 111). They may also provide raw device properties JSON.

Use `$ARGUMENTS` for the issue URL or device details.

## Phase 1 — Gather Information

1. **Fetch the GitHub issue** (if URL provided) to extract: device name, model number (e.g. T86P2), device type number, raw properties JSON, firmware version, and any reference PRs.
2. **Run the property mapping script**: Save the raw properties JSON to a temp file and run:
   ```bash
   node homebridge-eufy-security/.claude/skills/new-device-support/map-properties.mjs /tmp/<device>-raw-props.json
   ```
   This maps each raw `param_type` to its `CommandType`/`ParamType` enum name, matching property constants, and which existing device types use them. It also outputs a suggested DeviceProperties block. Use this output to identify the closest existing device and plan the property mapping.
3. **Ask the user** two questions:
   - Image naming convention (check if images already exist or need renaming)
   - Enum name for the DeviceType (e.g. `CAMERA_4G_S330`)

## Phase 2 — Plan (use EnterPlanMode)

Create a detailed plan covering all files that need changes. The plan must be based on the actual raw device properties — never guess which properties a device supports.

### Files to modify in eufy-security-client

#### `src/http/types.ts` — 6 locations:

1. **DeviceType enum**: Add `ENUM_NAME = <number>, //<model>` in numeric order
2. **GenericTypeProperty states**: Add `<number>: "<Display Name> (<Model>)"` in numeric order
3. **DeviceProperties**: Add `[DeviceType.ENUM_NAME]` block. Always starts with `...GenericDeviceProperties`. Map each raw param_type to its corresponding `PropertyName.*` property constant. Base on the closest existing device but only include properties that match the raw data.
4. **StationProperties**: Add `[DeviceType.ENUM_NAME]` block if device can act as its own station (solo cameras, integrated devices). Use `...BaseStationProperties` plus station-specific properties.
5. **DeviceCommands**: Add `[DeviceType.ENUM_NAME]` array. Commands depend on device capabilities (livestream, talkback, pan/tilt, download, snooze, preset positions, calibrate, alarm).
6. **StationCommands**: Add `[DeviceType.ENUM_NAME]` array if device has station properties. Typically `[CommandName.StationReboot, CommandName.StationTriggerAlarmSound]`.

#### `src/http/device.ts` — Classification methods:

Add the new device type to all applicable static classification methods. Common ones:
- `isCamera()` — if it's a camera/doorbell/floodlight
- `hasBattery()` — if battery-powered
- `isPanAndTiltCamera()` — if has PTZ
- `isOutdoorPanAndTiltCamera()` — if outdoor PTZ (this feeds into `isSoloCameras()`)
- `isFloodLight()`, `isIndoorCamera()`, `isDoorbell()`, etc. — as applicable

Add a **new static type guard method** and matching **instance method**:
```typescript
static isNewDevice(type: number): boolean {
  //<Model>
  return DeviceType.ENUM_NAME == type;
}

public isNewDevice(): boolean {
  return Device.isNewDevice(this.rawDevice.device_type);
}
```

Update serial number checks if applicable:
- `isIntegratedDeviceBySn()` — add `sn.startsWith("<model>")` if the device is integrated/standalone
- `isSoloCameraBySn()` — add `sn.startsWith("<model>")` if it's a solo camera

#### `src/http/station.ts`:

- `isIntegratedDevice()` — if the device is standalone or can pair as its own station, it may already be covered by `isSoloCameras()`, `isFloodLight()`, etc. Only add explicit check if needed.

#### `src/push/service.ts`:

- If the device is 4G LTE or needs special push notification handling, expand the normalization block (~line 768) to include the new type guard.

#### `docs/supported_devices.md`:

Add an entry in the correct table section:
```markdown
| ![<Model> image](_media/<image_small>.png) | <Display Name> (<Model>) | :wrench: | Firmware: <version> |
```
Use `:wrench:` for initial support.

### Files to modify in homebridge-eufy-security

#### `homebridge-ui/public/utils/device-images.js`:

Add a case in the `getImage()` switch:
```javascript
case <type_number>: return '<image_large>.png';
```

#### Image assets:

- Rename or add images in `eufy-security-client/docs/_media/` (small + large)
- Rename or add image in `homebridge-eufy-security/homebridge-ui/public/assets/devices/` (large only)

## Phase 3 — Implement

Execute the plan. Key implementation notes:

- **Property mapping**: Use the output from `map-properties.mjs` (Phase 1) as the primary guide. When multiple property constants match the same `param_type` (e.g. `DeviceWatermarkProperty` vs `DeviceWatermarkSoloWiredDoorbellProperty`), pick the variant used by the closest existing device. Check the "Used by DeviceTypes" column in the script output.
- **Companion custom properties**: Some properties have required companions with `custom_*` keys that never appear in raw device data (they're populated at runtime). The script detects these and marks them with `⚠ companion`. Always include them — omitting a companion breaks functionality silently. Key pairs: `DeviceRTSPStream` → `DeviceRTSPStreamUrl`, `DeviceWifiRSSI` → `DeviceWifiSignalLevel`, `DeviceCellularRSSI` → `DeviceCellularSignalLevel`.
- **Insert in order**: When adding to enums, switch statements, or `if` chains, maintain numeric ordering by device type number.
- **Audio recording property**: Different device families use different audio recording property constants (e.g. `DeviceAudioRecordingProperty`, `DeviceAudioRecordingStarlight4gLTEProperty`). Match the closest existing device.

## Phase 4 — Build & Lint Verification

Run build and lint for both repos. Note: eufy-security-client lint may fail due to a pre-existing `jiti` library issue unrelated to our changes — the TypeScript build succeeding is sufficient validation.

## Phase 5 — Git & PR

Follow CLAUDE.md Git Workflow for commit messages, branch naming, and PR body format. This skill creates **two PRs** across repos:

### eufy-security-client (cross-fork)

1. Discard unrelated changes (e.g. `package-lock.json`)
2. Sync develop: `git fetch upstream && git checkout develop && git merge upstream/develop`
3. Branch: `git checkout -b feat/<device-slug>`
4. Stage only: images, `src/http/types.ts`, `src/http/device.ts`, `src/push/service.ts`, `docs/supported_devices.md`
5. Cross-fork PR:
   ```bash
   gh pr create --repo bropat/eufy-security-client --base develop \
     --head lenoxys:feat/<device-slug> \
     --title "feat: add <Device Name> (<Model>, type <number>) support" \
     --body-file /tmp/pr-body-<branch>.md
   ```

### homebridge-eufy-security

1. Branch from current beta: `git checkout -b feat/<device-slug>`
2. Stage: `homebridge-ui/public/utils/device-images.js` + any added image

### Cross-referencing

After both PRs are created, update both bodies so they reference each other.
