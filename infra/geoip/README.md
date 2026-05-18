# GeoIP Database

This directory is the runtime mount point for the GeoLite2-City database.

## Deploy-time bootstrap

Run `scripts/bootstrap-geoip-db.sh` before starting the server. The script downloads
the current GeoLite2-City database from MaxMind using `GEOIP_LICENCE_KEY`.

If `GEOIP_LICENCE_KEY` is unset, the script exits with code 2 and logs a warning.
The server boots normally — proxy alignment will skip locale/timezone resolution when
the database is unavailable (graceful degradation).

## Licensing

MaxMind GeoLite2 is distributed under the Creative Commons Attribution-ShareAlike 4.0
International License and requires attribution. The 30-day update obligation and
redistribution licence ambiguity mean we never ship the binary in this repository;
the bootstrap script downloads fresh on every deploy.

The `.gitignore` in this directory blocks accidental binary commits.

## Runtime path

Default: `/var/lib/synthetos/geoip/geolite2-city.mmdb`
Override: `GEOIP_RUNTIME_DIR` environment variable
