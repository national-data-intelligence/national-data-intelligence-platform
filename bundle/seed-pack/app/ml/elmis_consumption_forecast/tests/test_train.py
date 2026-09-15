"""elmis_consumption_forecast self-test (facility × product × month grain)."""
from __future__ import annotations
import sys
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from train import FLAT_COLUMNS, ElmisConsumptionForecastModel, train  # noqa: E402


def _frame(n_months=12, soh=300.0, series=(("F001", "P01"), ("F001", "P02"), ("F002", "P01")), seed=7):
    rng = np.random.default_rng(seed); rows = []
    for fac, prod in series:
        for i, m in enumerate(pd.period_range("2017-09", periods=n_months, freq="M")):
            rows.append({"month_id": str(m), "facility_code": fac, "product_code": prod, "product_name": f"Product {prod}",
                         "quantity_dispensed": float(max(120 + 3 * i + rng.normal(0, 10), 1)), "normalized_consumption": None,
                         "stock_in_hand": soh, "amc": 125.0, "stockout_days": 0})
    return pd.DataFrame(rows)


def test_train_returns_pyfunc_model():
    import mlflow.pyfunc
    assert isinstance(train(_frame(), {}), (ElmisConsumptionForecastModel, mlflow.pyfunc.PythonModel))


def test_flat_schema_one_row_per_series():
    out = train(_frame(), {}).predict(None, _frame())
    for c in FLAT_COLUMNS:
        assert c in out.columns
    assert len(out) == 3 and set(out["district"]) == {"F001|P01", "F001|P02", "F002|P01"}
    r = out.iloc[0]
    assert r["pred_cases_mean"] > 0 and 1 <= int(r["week"]) <= 53 and r["method"] == "holt_damped"
    assert 0.0 <= r["alarm_prob"] <= 1.0 and "alarm_flag" not in out.columns


def test_short_series_mean_fallback_and_stockout():
    out = train(_frame(2, soh=0.0), {}).predict(None, _frame(2, soh=0.0))
    assert set(out["method"]) == {"mean"} and (out["status"] == "stockout").all() and (out["alarm_prob"] >= 0.5).all()


def test_holdout_mase_reported():
    m = ElmisConsumptionForecastModel(); res = m.holdout_mase(_frame(12), 3)
    assert res["holdout_series"] == 3 and res["mase_vs_naive1"] is not None


if __name__ == "__main__":
    test_train_returns_pyfunc_model(); test_flat_schema_one_row_per_series(); test_short_series_mean_fallback_and_stockout(); test_holdout_mase_reported(); print("ok")
