# mBrana synthesizer · shared-model rewrite

`scripts/synthesize.py` now loads all canonical IDs from
`0_external/sources/_shared/_build/*.json` so mBrana joins cleanly with DHIS2,
EthioEMR, HCMIS-WDM, and MFR on the same `facility_id`, `mfr_id`,
`woreda_id`, `zone_id`, `region_id`, `epss_hub`, and commodity `id`.

## Tables rewritten

| Table                                   | Source JSON              | Row count |
|-----------------------------------------|--------------------------|-----------|
| `dbo.Region`                            | `regions.json`           | 14        |
| `dbo.Zone`                              | `zones.json`             | 134       |
| `dbo.Woreda`                            | `woredas.json` (capped)  | 200       |
| `AdministrativeUnit.AdministrativeUnit` | derived (hierarchyid)    | 349       |
| `USM.Environment`                       | `epss_hubs.json`         | 19        |
| `Commodity.Product`                     | `commodities.json`       | 34        |
| `dbo.Institution`                       | `facilities.json`        | 891       |
| `mBrana.InstitutionEnvironment`         | derived (region→hub)     | up to 600 |
| `mFlowUSSD.Commodities`                 | `commodities.json`       | 34        |
| `mFlowUSSD.Institutions`                | facilities filtered HEW  | 200       |
| `mFlowUSSD.Users`                       | derived                  | 200       |
| `mFlowUSSD.SOHLogs`                     | 24 mo × 30% reporting    | 7,200     |
| `mFlowUSSD.Requests` / `RequestLines`   | derived                  | 616       |
| `mFlowUSSD.ASNs` / `ASNLines`           | derived                  | 184       |

`dbo.Institution.Town` stores `facility_id`; `IvrID` holds the numeric
`mfr_id`. Facility → environment is derived from each region's
`epss_hub`. mFlowUSSD users are HEW-eligible only (`ownership='public'`
AND `tier_id ∈ {HP, HC}`). `AdministrativeUnit` is rebuilt as
`hierarchyid` paths `/1/<r>/<z>/<w>/`.

## Environment knobs

| Var                                  | Default     | Notes                                |
|--------------------------------------|-------------|--------------------------------------|
| `MBRANA_SYNTH_SEED`                  | 20260624    | entity-model `random_seed`           |
| `MBRANA_SYNTH_WOREDA_LIMIT`          | 200         | dbo.Woreda cap (574 available)       |
| `MBRANA_SYNTH_FACILITY_LIMIT`        | 893         | dbo.Institution cap                  |
| `MBRANA_SYNTH_MOBILE_USERS`          | 200         | mFlowUSSD.Users count                |
| `MBRANA_SYNTH_MONTHS_HISTORY`        | 24          | last N months from periods.json      |
| `MBRANA_SYNTH_SOH_ROWS`              | 7200        | SOHLogs target                       |
| `MBRANA_SYNTH_REQUESTS`              | 616         | Requests target                      |
| `MBRANA_SYNTH_ASNS`                  | 184         | ASNs target                          |

The script is idempotent: every target table is `DELETE`d in FK order
before the inserts, all wrapped in one transaction.

## Run

```bash
python3 scripts/synthesize.py
```

Requires `MBRANA_SA_PASSWORD` (loaded from `.env`) and a running
`mbrana-sqlserver` container. Docker compose is not touched by this
patch.
