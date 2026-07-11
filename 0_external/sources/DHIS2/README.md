# DHIS2 — Ethiopia NHDW Source System

The **real** Ethiopian DHIS2 instance (not the public Sierra-Leone demo). Raw
Tomcat serving the unpacked DHIS2 v40 WAR, backed by PostGIS, seeded from the
exported Ethiopian database dump. This is the upstream source the
`2_pipelines/ingestor/DHIS2` ingestor reads from.

Public endpoint (unchanged, fronted by nginx + Let's Encrypt):
`https://ethio-dhis2.dataforimplementation.org`

## Layout (self-contained workspace)

```
docker-compose.yml      tomcat:9.0-jdk11 (dhis2_app) + postgis:14-3.3 (dhis2_db)
war/dhisv40/            unpacked DHIS2 WAR (735 MB, OS disk, mounted read-only as ROOT)
data -> /data/warehouse/dhis2     symlink to the 500 GB data disk:
  data/postgres         live PostgreSQL cluster
  data/dumps            seed dump (dhis2_seeded.pgdump)
  data/home             DHIS2_HOME — holds dhis.conf
scripts/restore.sh      drop+recreate dhis2 and pg_restore the dump
scripts/extract-war.py  unpack the (Windows-zipped) WAR, normalising path separators
```

Heavy bytes live on `/data` (the OS disk only has ~16 GB free); the `data`
symlink keeps everything reachable from this one folder.

## Bring-up / re-seed

```bash
docker compose up -d db
bash scripts/restore.sh          # ~5-20 min
docker compose up -d dhis2       # first boot runs migrations, ~3-10 min
curl http://127.0.0.1:8080/api/ping        # -> pong
```

After a fresh restore, regenerate analytics (or charts are blank):

```bash
curl -u admin:<pw> -X POST http://127.0.0.1:8080/api/resourceTables/analytics
```

## Notes

- Served on `127.0.0.1:8080`; nginx vhost proxies to it. **Do not change the
  port** without updating `/etc/nginx/sites-available/dhis2`.
- DB connection settings live in `data/home/dhis.conf`
  (`connection.url = jdbc:postgresql://db/dhis2`); `server.base.url` points at
  the public subdomain.
- JVM heap is `-Xmx8g` — sized for this shared 31 GB VM (no swap).
- The previous SL-demo replica that lived here was moved to `_sl-replica.bak/`.
