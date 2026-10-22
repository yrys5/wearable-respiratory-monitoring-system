## Install

```bash
npm install
```

## Run With A Development Build

Start Metro for a dev client:

```bash
npm run start:dev-client
```

Build and install the native app locally:

```bash
npm run android:dev
npm run ios:dev
```

Rebuild the development app after installing dependencies: the BLE client and SQLite storage both use native modules.

## BLE measurement protocol

The app uses the 20-byte DATA notification and 9-byte CONTROL protocol. It subscribes to DATA before issuing START or RESUME, saves every valid packet in SQLite, and ACKs only the highest continuous sequence committed to storage. It uses CONTROL write with response when available, otherwise write without response, and reads CONTROL status to confirm the command's effect. The firmware retries unacknowledged notifications after 500 ms; if a gap persists, the app requests RESUME after 1.5 seconds. Duplicate packets are checked and ignored. STOP ends sampling while pending packets remain available for recovery. CONTROL status, write mode, and integrity flags are visible on the Setup screen.

The Summary screen exports the latest stored session to CSV, including raw samples that the breathing signal filter rejected. The CSV includes session and sequence numbers, device and phone timestamps, and the known completeness status. Signal processing uses device timestamp differences so replayed packets retain their original spacing. A session is shown as complete only when the device reports no pending packets, its final generated number matches the locally stored continuous sequence, and it has acknowledged that number.

The device holds at most 512 pending samples, approximately 51 seconds at 10 samples/s with no acknowledgements. While connected, Setup warns when the queue reaches 75% capacity and reports the firmware's overflow and ADC gap flags. Data lost to an overflowing queue or a missing ADC conversion cannot be reconstructed by BLE replay.

CONTROL must advertise `READ` and either `WRITE` (preferred, with GATT response) or `WRITE_WITHOUT_RESPONSE`. STM32's `GATT_NOTIFY_ATTRIBUTE_WRITE` selects a firmware event; it does not set either characteristic write property. On Android the app refreshes the GATT service cache when connecting because the firmware added CONTROL. If CONTROL is still absent, check the firmware's `CONTROL creation failed` log and its GATT attribute/value limits.

Run the protocol unit tests with `npm run test:protocol`. The BLE command flow and recovery still need an end-to-end test on the updated sensor, particularly after reconnecting and after filling its queue.

## Chart and measurement modes

Summary provides RAW, FILTERED, and Normalized chart views. Normalized uses the filtered signal, scales each channel independently to −1…1 over the visible window, and displays CH1 above CH2. A constant channel is centered at zero. This display scaling does not change breath detection, stored samples, or CSV values.

Select a duration or **No limit** before starting. No limit shows elapsed time and records until you press Stop, without an automatic-stop timer. The live chart keeps at most 600 samples from the last 60 seconds; SQLite retains the full session. Session timing is saved locally and restored after reconnecting, so timed sessions keep their original deadline. Background recording is not guaranteed by this feature; reconnect to recover available device packets.

CSV export reads up to 256 packets at a time and writes the file incrementally, preserving filter state between batches. Exporting during a measurement captures a finite boundary and reports unconfirmed completeness.

Run all protocol and measurement feature tests with `npm test`.

For cloud builds, create an EAS development or preview build:

```bash
npx eas build --profile development --platform android
npx eas build --profile development --platform ios
```
