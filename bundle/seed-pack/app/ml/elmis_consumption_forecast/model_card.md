# elmis_consumption_forecast

**What it does.** For every facility × tracer product in the eLMIS v2 historical archive
(Zambia, Sep 2017 – Aug 2018), forecasts next month's consumption with a damped-trend Holt
model and converts it to days-to-stockout using the last reported stock in hand. One flat
forecast row per series; `alarm_prob` rises as projected days remaining fall inside the
30-day horizon.

**Data.** `bi_supply.mart_elmis_hist_facility_product_month` (non-skipped R&R lines only —
"skipped" means not reported, never zero). Quantities are pattern-preserving mutations of the
real archive: relative patterns are trustworthy, absolute units are not. 12 months of history:
no yearly seasonality is learnable, hence a damped trend and NO seasonal component.

**Evaluation.** At training time the last 3 months are held out; MAE of the one-step
forecast vs a naive-1 (last value) baseline is logged as `mase_vs_naive1` (< 1 = beats naive).

**Governance.** Facility codes are identities from a restricted known-entity dump: internal
dashboards only, behind role gates, until the data owner clears display. Option (c): this
lane never joins the Ethiopian entity model; the package is a sibling of `stockout_forecast`,
not a merge.

**Limits.** Monthly grain only; no shipment/lead-time data (OTIF impossible); series shorter
than 4 months fall back to their positive mean.
