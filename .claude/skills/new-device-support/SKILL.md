---
name: new-device-support
description: Full workflow to add support for a new Eufy Security device type across eufy-security-client and homebridge-eufy-security. Covers exploration, implementation, build verification, and git/PR creation.
---

# Add New Eufy Security Device Support

You are adding support for a new device type to the eufy-security ecosystem. The user will provide a GitHub issue URL or device details (model name, model number like T86P2, device type number like 111). They may also provide raw device properties JSON.

Use `$ARGUMENTS` for the issue URL or device details.

## Phase 1 — Gather Information

1. **Fetch the GitHub issue** (if URL provided) to extract: device name, model number (e.g. T86P2), device type number, raw properties JSON, firmware version, and any reference PRs.
2. **Identify the closest existing device** by analyzing the raw properties. Compare param_type numbers against existing DeviceProperties blocks in `eufy-security-client/src/http/types.ts` to find the best base device.
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

- **Property mapping**: Each raw property `param_type` number corresponds to a specific `PropertyName.*` constant. Look at existing DeviceProperties blocks to find the mapping. The property constant names (e.g. `DeviceBatteryProperty`, `DeviceMotionDetectionProperty`) define which `param_type` they handle via their `key` field.
- **Insert in order**: When adding to enums, switch statements, or `if` chains, maintain numeric ordering by device type number.
- **Audio recording property**: Different device families use different audio recording property constants (e.g. `DeviceAudioRecordingProperty`, `DeviceAudioRecordingStarlight4gLTEProperty`). Match the closest existing device.
- **No Co-Authored-By**: Do not add co-author lines to commits.

## Phase 4 — Build & Lint Verification

Run these in parallel:
```bash
cd eufy-security-client && npm run build
cd homebridge-eufy-security && npm run build
```

Then verify lint:
```bash
cd eufy-security-client && npm run lint
cd homebridge-eufy-security && npm run lint
```

Note: eufy-security-client lint may fail due to a pre-existing `jiti` library issue unrelated to our changes. The TypeScript build succeeding is sufficient validation.

## Phase 5 — Git & PR

### eufy-security-client

1. Discard any unrelated changes (e.g. `package-lock.json`)
2. Sync develop with upstream: `git fetch upstream && git checkout develop && git merge upstream/develop`
3. Create branch: `git checkout -b feat/<device-slug>`
4. Stage only relevant files (images (should match the `<device-slug>`), `src/http/types.ts`, `src/http/device.ts`, `src/push/service.ts`, `docs/supported_devices.md`)
5. Commit: `git commit -m "feat: add <Device Name> (<Model>, type <number>) support"`
6. Push: `git push origin feat/<device-slug>`
7. Create cross-fork PR:
   ```bash
   gh pr create --repo bropat/eufy-security-client --base develop \
     --head lenoxys:feat/<device-slug> \
     --title "feat: add <Device Name> (<Model>, type <number>) support" \
     --body-file /tmp/pr-body-<branch>.md
   ```

### homebridge-eufy-security

1. Branch from the current beta branch (check with `git branch`): `git checkout -b feat/<device-slug>`
2. Stage: `homebridge-ui/public/utils/device-images.js` + any added image
3. Commit: `git commit -m "feat: add <Device Name> (<Model>, type <number>) device image mapping"`
4. Push: `git push origin feat/<device-slug>`
5. Create PR:
   ```bash
   gh pr create --repo homebridge-plugins/homebridge-eufy-security \
     --base <beta-branch> \
     --title "feat: add <Device Name> (<Model>, type <number>) device image" \
     --body-file /tmp/pr-body-<branch>.md
   ```

### PR body format

Write PR bodies to `/tmp/pr-body-<branch>.md` files. Include:
- `## Summary` — bullet points describing the changes
- Cross-references: `Closes homebridge-plugins/homebridge-eufy-security#<issue>` in the client PR, `Closes #<issue>` in the plugin PR
- `Depends on bropat/eufy-security-client#<pr>` in the plugin PR
- `## Test plan` — checklist of verification steps

### Link the issue

After both PRs are created, update both PR bodies so they reference the issue with closing keywords.
