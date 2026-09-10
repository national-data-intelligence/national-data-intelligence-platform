"""elmis_consumption_forecast — damped-trend Holt per facility × product series.

Vectorised numpy implementation (no per-series statsmodels fit): with ~180k tracer
series of ≤12 points, a per-series optimiser would take an hour; a fixed-parameter
damped Holt runs in seconds and is the appropriate model for 12-month archives (no
seasonality is learnable). Skipped lines never reach this model
(excluded in the feature mart). Quantities are pattern-preserved mutations
(relative patterns trustworthy).

Target series = quantity_dispensed, falling back to normalized_consumption where
dispensed is null. Output = the unified FLAT forecast schema (one row per series):
  district = "<facility_code>|<product_code>", year/week = ISO of projection date,
  pred_cases_* = projected monthly consumption, alarm_prob = stockout risk,
  extras (soh_now, amc, projected_days_remaining, projected_stockout_date, status,
  method, product_name, facility_code, product_code) -> attrs by the runner.

train() also computes a holdout MASE (last `holdout_months`) against naive-1 on the
pooled series and logs it to the active MLflow run when one exists.
"""
from __future__ import annotations

import mlflow
import mlflow.pyfunc
import numpy as np
import pandas as pd

MODEL_NAME = "elmis_consumption_forecast"
MODEL_VERSION = "v1"

FLAT_COLUMNS = [
    "disease", "district", "year", "week",
    "pred_cases_mean", "pred_cases_sd", "pred_cases_lwr95",
    "pred_cases_median", "pred_cases_upr95",
    "endemic_mean", "endemic_sd", "outbreak_z",
    "alarm_threshold", "alarm_prob", "n_draws",
]
SERIES_KEYS = ["facility_code", "product_code"]


def _damped_holt(y: np.ndarray, alpha: float, beta: float, phi: float, h: int = 1):
    """Damped-trend Holt on ONE series (y 1-D, NaNs already handled). Returns
    (forecast_h, fitted_values). Standard recursions (Gardner & McKenzie 1985)."""
    n = len(y)
    level, trend = y[0], (y[1] - y[0]) if n > 1 else 0.0
    fitted = np.empty(n); fitted[0] = y[0]
    for t in range(1, n):
        fitted[t] = level + phi * trend
        new_level = alpha * y[t] + (1 - alpha) * (level + phi * trend)
        trend = beta * (new_level - level) + (1 - beta) * phi * trend
        level = new_level
    damp = sum(phi ** i for i in range(1, h + 1))
    return max(level + damp * trend, 0.0), fitted


def _status(soh: float, days_remaining: float, horizon_days: int) -> str:
    if soh <= 0:
        return "stockout"
    if not np.isfinite(days_remaining):
        return "ok"
    if days_remaining <= horizon_days / 2:
        return "risk"
    if days_remaining <= horizon_days:
        return "watch"
    return "ok"


class ElmisConsumptionForecastModel(mlflow.pyfunc.PythonModel):
    def __init__(self, alpha=0.5, beta=0.2, phi=0.85, horizon_days=30, min_months=4):
        self.alpha, self.beta, self.phi = float(alpha), float(beta), float(phi)
        self.horizon_days, self.min_months = int(horizon_days), int(min_months)
        self.name, self.version = MODEL_NAME, MODEL_VERSION

    # ── series preparation ────────────────────────────────────────────────
    @staticmethod
    def _target(df: pd.DataFrame) -> pd.Series:
        q = pd.to_numeric(df.get("quantity_dispensed"), errors="coerce")
        n = pd.to_numeric(df.get("normalized_consumption"), errors="coerce")
        return q.where(q.notna(), n).fillna(0.0).clip(lower=0.0)

    def _forecast_series(self, y: np.ndarray) -> tuple[float, float, str]:
        if len(y) < self.min_months or y.sum() <= 0:
            pos = y[y > 0]
            mean = float(pos.mean()) if len(pos) else 0.0
            return mean, float(np.sqrt(max(mean, 1.0))), "mean"
        fc, fitted = _damped_holt(y, self.alpha, self.beta, self.phi, 1)
        resid = y[1:] - fitted[1:]
        sd = float(np.std(resid, ddof=1)) if len(resid) > 1 else 0.0
        if not np.isfinite(sd) or sd <= 0:
            sd = float(np.sqrt(max(fc, 1.0)))
        return float(fc), sd, "holt_damped"

    # ── pyfunc contract ───────────────────────────────────────────────────
    def predict(self, context, model_input, params=None):  # noqa: D401
        params = params or {}
        horizon_days = int(params.get("horizon_days", self.horizon_days))
        df = model_input.copy()
        df["_y"] = self._target(df)
        for c in ("stock_in_hand", "amc"):
            df[c] = pd.to_numeric(df.get(c), errors="coerce")
        df = df.sort_values(SERIES_KEYS + ["month_id"])
        rows = []
        for (fac, prod), g in df.groupby(SERIES_KEYS, sort=False):
            y = g["_y"].to_numpy(dtype=float)
            fc, sd, method = self._forecast_series(y)
            soh_now = float(np.nan_to_num(g["stock_in_hand"].iloc[-1], nan=0.0))
            amc_now = float(np.nan_to_num(g["amc"].iloc[-1], nan=0.0))
            last_month = str(g["month_id"].iloc[-1])
            daily = fc / 30.0
            days_remaining = (soh_now / daily) if daily > 0 else float("inf")
            end = pd.Period(last_month, freq="M").end_time.normalize()
            proj = end + pd.Timedelta(days=horizon_days); iso = proj.isocalendar()
            # cap the projection at 10 years: beyond that "no foreseeable stockout" (also keeps
            # pandas Timedelta arithmetic finite — a huge SOH / tiny forecast overflowed it)
            stockout_date = ((end + pd.Timedelta(days=float(days_remaining))).date().isoformat()
                             if np.isfinite(days_remaining) and days_remaining <= 3650 else None)
            status = _status(soh_now, days_remaining, horizon_days)
            alarm = float(np.clip(1.0 - days_remaining / horizon_days, 0.0, 1.0)) if np.isfinite(days_remaining) else 0.0
            if soh_now <= 0:
                alarm = 1.0
            rows.append({
                "disease": "", "district": f"{fac}|{prod}",
                "year": int(iso[0]), "week": int(iso[1]),
                "pred_cases_mean": fc, "pred_cases_sd": sd,
                "pred_cases_lwr95": max(0.0, fc - 1.96 * sd), "pred_cases_median": fc,
                "pred_cases_upr95": fc + 1.96 * sd,
                "endemic_mean": np.nan, "endemic_sd": np.nan, "outbreak_z": np.nan,
                "alarm_threshold": fc, "alarm_prob": alarm, "n_draws": np.nan,
                "soh_now": soh_now, "amc": amc_now,
                "projected_days_remaining": None if not np.isfinite(days_remaining) or days_remaining > 3650 else round(float(days_remaining), 1),
                "projected_stockout_date": stockout_date, "status": status, "method": method,
                "product_name": str(g["product_name"].iloc[-1]), "facility_code": str(fac), "product_code": str(prod),
            })
        return pd.DataFrame(rows)

    # ── holdout evaluation (training time only) ──────────────────────────
    def holdout_mase(self, df: pd.DataFrame, holdout_months: int) -> dict:
        df = df.copy(); df["_y"] = self._target(df); df = df.sort_values(SERIES_KEYS + ["month_id"])
        err_model, err_naive, n = [], [], 0
        for _, g in df.groupby(SERIES_KEYS, sort=False):
            y = g["_y"].to_numpy(dtype=float)
            if len(y) < self.min_months + holdout_months or y[:-holdout_months].sum() <= 0:
                continue
            train_y, test_y = y[:-holdout_months], y[-holdout_months:]
            fc, _ = _damped_holt(train_y, self.alpha, self.beta, self.phi, 1)
            err_model.append(abs(test_y[0] - fc)); err_naive.append(abs(test_y[0] - train_y[-1])); n += 1
        if not n:
            return {"holdout_series": 0, "mase_vs_naive1": None}
        mae_m, mae_n = float(np.mean(err_model)), float(np.mean(err_naive))
        return {"holdout_series": n, "mae_model": mae_m, "mae_naive1": mae_n,
                "mase_vs_naive1": (mae_m / mae_n) if mae_n > 0 else None}


def train(df: pd.DataFrame, params: dict) -> mlflow.pyfunc.PythonModel:
    """Freeze hyperparameters, report the holdout MASE, return the pyfunc model."""
    params = params or {}
    model = ElmisConsumptionForecastModel(
        alpha=params.get("alpha", 0.5), beta=params.get("beta", 0.2), phi=params.get("phi", 0.85),
        horizon_days=params.get("horizon_days", 30), min_months=params.get("min_months", 4))
    metrics = model.holdout_mase(df, int(params.get("holdout_months", 3)))
    print(f"[{MODEL_NAME}] holdout: {metrics}")
    try:
        if mlflow.active_run() is not None:
            for k, v in metrics.items():
                if isinstance(v, (int, float)) and v is not None:
                    mlflow.log_metric(k, float(v))
    except Exception:  # metrics are a report, never a failure
        pass
    if model.predict(None, df).empty:
        raise ValueError("training frame produced zero forecast rows — check feature_spec.yaml scoping")
    return model
