# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- TOLO steam generators and saunas (App Box) on the local network, in UDP
  (port 51500), at an IPv4 address typed in the configuration: one device.
- Heating on (read only), status, temperature, humidity, setpoint, time left,
  water level, tank temperature, lamp and fan (on/off).
- "Turn off" button, never held back, sent again while the App Box is silent
  and reaffirmed for 2 min (guard kept in `/data`).
- "Turn on (heat)" button and setpoint behind "Allow heating from Gladys"
  (off by default): every turn on first sets the timer to the session
  duration (30 min by default, 60 at most) and caps the setpoint (50 °C by
  default, 60 at most).
- "Test the connection" button; documentation in English and French.

[Unreleased]: https://github.com/LM1LC3N7/gladys-tolo/commits/main
