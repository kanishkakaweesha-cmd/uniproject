# Serial Ingestion Service

The backend can ingest telemetry directly from a locally connected ESP32 over a serial (COM) port and propagate updates to the dashboard in real time.

## Environment variables

Configure the following variables in your `.env` file or shell before starting the server:

| Variable | Default | Description |
| --- | --- | --- |
| `SERIAL_INGEST_ENABLED` | `true` | Set to `false` to disable serial ingestion without editing code. |
| `SERIAL_PORT_PATH` | _required_ | Serial device path (for example `/dev/ttyUSB0` or `COM3`). |
| `SERIAL_BAUD_RATE` | `9600` | Baud rate for the ESP32 connection. |
| `SERIAL_REOPEN_DELAY_MS` | `5000` | Delay before retrying when the serial port closes or fails. |
| `SERIAL_MIN_PERSIST_MS` | `15000` | Minimum spacing between package inserts when readings have not changed. |
| `SERIAL_WEIGHT_DIFF` | `0.05` | Minimum delta (grams) to treat weight as a new reading. |
| `SERIAL_VOLUME_DIFF` | `5` | Minimum delta (cm³) to treat volume as a new reading. |
| `SERIAL_PRICE_DIFF` | `0.5` | Minimum delta (Rs) to treat price as a new reading. |
| `SERIAL_DELIVERY_COMPANY` | `ESP32 Device` | Company name to store on persisted packages. |

If `ESP32_COMPANY_NAME` is set it will be reused when `SERIAL_DELIVERY_COMPANY` is omitted.

## What the service does

- Watches the configured serial port for lines containing weight, volume, fee, and fee type markers.
- Streams parsed values to all connected Server-Sent Event clients instantly.
- Persists meaningful changes as `Package` documents (with a guard against rapid duplicates).
- Automatically retries the serial port when connections drop.

## Sample telemetry lines

```
Average Weight: 123.45 g
Average Volume: 678.90 cm³
Fee: Rs. 12.34
T= B
```

Any line containing `Weight:`, `Volume:`, `Fee: Rs.` or `T=` will be parsed; units and additional text are ignored.

## Usage

1. Install dependencies (`npm install`) and ensure `serialport` builds successfully on your platform.
2. Define the required environment variables.
3. Start the backend (`npm start`). The server will bring up the serial ingestion service automatically.
4. Watch the dashboard's “Live Data” block for real-time updates.

The service logs connection failures and retry attempts to the console. Use those logs to verify that the ESP32 is detected.
