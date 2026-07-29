"""ml-runner support library.

The runner owns ALL infrastructure I/O (Postgres, MLflow, MinIO) so model
packages stay pure: `train(df, params) -> mlflow.pyfunc.PythonModel`.
See ../README.md for the CLI + env contract and bundle/seed-pack/app/ml/_template/
for the package contract.
"""
