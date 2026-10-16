# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-16

### Added

- ZoneMinder servers (1.36 and later, tested on 1.36 and 1.38), reached at the
  address of the configuration (`/zm` or the web root found on their own),
  with or without a login.
- One Gladys camera per monitor: its image, sent at the chosen pace and at once
  on an alarm or a new event, scaled down by ZoneMinder when too heavy for
  Gladys; "Alarm" (in alarm right now); "Mode" (Monitor, Modect, Record,
  Mocord, Nodect), which the dashboard can change, the 1.36 way or the 1.37+
  way; "Capture on"; "Events today".
- Monitors that receive no images show as unreachable in Gladys.
- Scene triggers "ZoneMinder: new event" (cause, kind, score) and "ZoneMinder:
  camera offline"; scene actions "ZoneMinder: change the mode" (one camera or
  all of them), "ZoneMinder: forced alarm" and "ZoneMinder: read a camera";
  dashboard widget "ZoneMinder camera"; action "Check the connection".
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-zoneminder/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-zoneminder/releases/tag/v1.0.0
