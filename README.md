# ZoneMinder for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[ZoneMinder](https://zoneminder.com/), the free video surveillance software. It
brings each ZoneMinder monitor into Gladys as a camera with its image, whether
it is in alarm, its mode, whether it captures and the events of the day, plus
scene triggers, scene actions and a dashboard widget.

Tested against real ZoneMinder servers in Docker (1.36.4 and 1.38.6) with
simulated network cameras, not yet on a long-running installation: feedback
welcome in the [issues](https://github.com/guim31/gladys-zoneminder/issues).

## Features

- **One Gladys camera per monitor**: its image, sent at the chosen pace (10 s to
  15 min) and at once on an alarm or a new event, scaled down by ZoneMinder when
  it is too heavy for Gladys.
- **Alarm**: the monitor is in alarm right now (`motion-sensor`, 1 = alarm),
  read every 2 to 30 seconds.
- **Mode**: Monitor, Modect, Record, Mocord or Nodect, a list the dashboard can
  change (`text/select`), written the 1.36 way (`Function`) or the 1.37+ way
  (`Analysing` / `Recording`).
- **Capture on** (read only) and **Events today** (since midnight).
- **Unreachable badge** on the device of a monitor that receives no images.
- **Scene triggers**: "ZoneMinder: new event" (camera and kind of event as
  filters; cause, score and event number as variables) and "ZoneMinder: camera
  offline".
- **Scene actions**: "ZoneMinder: change the mode" (one camera or every camera:
  the "alarm armed" scene), "ZoneMinder: forced alarm" (start or cancel) and
  "ZoneMinder: read a camera" (online, alarm, capture, mode and events as scene
  values).
- **Dashboard widget** "ZoneMinder camera": image, alarm, mode, events of the
  day, a forced alarm button and a new image button.
- **"Check the connection"** action: the version, the monitors, whether they
  receive images, their mode.
- Texts and documentation in English, French, German and Spanish.

## Requirements

- Gladys 5.1.0 or later.
- ZoneMinder 1.36 or later, reachable from Gladys on the local network, with
  its API on (`OPT_USE_API`) and, when it asks for a login, an account with
  "API Enabled" ("Monitors: Edit" to change modes).

## Installation

In Gladys: **Integrations → Install from GitHub**, address
`https://github.com/guim31/gladys-zoneminder`. Then enter the ZoneMinder
address and account in the **Configuration** tab, and add the monitors from the
**Discovery** tab. The user guide: [English](docs/en.md),
[français](docs/fr.md), [Deutsch](docs/de.md), [español](docs/es.md).

## How it works

- **Authentication**: `POST /api/host/login.json` gives an access token (2 h),
  sent as `?token=` on every request and renewed before it ends or on a 401. A
  ZoneMinder without login answers with a null token: nothing is sent. The
  password and the tokens never appear in a log or a message (ZoneMinder repeats
  the request address, token included, in its errors: those are cleaned).
- **Web root**: `/zm` (packages) or `/` (some Docker images), tried in that order
  when the address has no path; images come from `ZM_PATH_ZMS`
  (`nph-zms?mode=single`).
- **Every few seconds** (alarm check), for the monitors added in Gladys: the
  alarm state (`monitors/alarm/id:N/command:status`), then the events after the
  last one seen (`events/index/Id >:N`).
- **Every minute**: `monitors.json` (names, modes, enabled, whether frames come
  in: `Monitor_Status.Status` is `Connected`) and today's count of each monitor
  (`events/index/MonitorId:N/StartDateTime >=:<midnight>`, `pagination.count`).
- Nothing is stored under `/data`. Devices are published with
  `should_poll: false`: the container runs its own timers.

## Checked, and what was not

- In Docker, against `zoneminderhq/zoneminder:latest-ubuntu18.04` (1.36.4, web
  root `/zm`) and `zoneminder-containers/zoneminder-base` (1.38.6, web root `/`,
  separate MariaDB), with network cameras served by `ffmpeg` (moving test
  pattern, still colour bars, and one unreachable): login, wrong password,
  account without API, viewer account, auth turned off, monitor list, alarm
  state, forced alarm on and off, change of mode both ways, events, today's
  count, images, refused token. The test fixtures
  (`test/fixtures/zoneminder/`) are those servers' answers, anonymized. The
  integration itself ran in its locked-down container (read-only, no
  capabilities, 256 MB) against the 1.36 server.
- Not checked: a long-running installation with real cameras, ZoneMinder 1.37, a multi-server setup, a reverse proxy, a Gladys instance (the
  integration was run against the SDK's fake Gladys).

## Limitations

- No live video: images only, at most 12 a minute per camera (the Gladys bound).
- Alarms are read every few seconds: a very short alarm between two checks
  shows as an event only. ZoneMinder cannot call the integration, which opens no
  port.
- "Events today" counts from midnight in ZoneMinder's time zone: Gladys and
  ZoneMinder should share it.
- The "None" mode and turning a monitor off are left to ZoneMinder.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the ZoneMinder notes.

## Credits

- The endpoints and the alarm states follow the
  [ZoneMinder API documentation](https://zoneminder.readthedocs.io/en/latest/api.html)
  (ZoneMinder: GPL-2.0, the ZoneMinder project), and the way
  [zm-py](https://github.com/rohankapoorcom/zm-py) (Apache 2.0, Rohan Kapoor)
  and the
  [Home Assistant ZoneMinder integration](https://www.home-assistant.io/integrations/zoneminder)
  (Apache 2.0) use them. No code was copied.

## Disclaimer

Not affiliated with, endorsed by or certified by the ZoneMinder project.

## License

[Apache License 2.0](LICENSE).
