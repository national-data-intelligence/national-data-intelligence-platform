#!/usr/bin/env python3
"""Phase 6 G2 — JupyterHub project sync, exercised with the REAL script.

Runs inside the singleuser image (nhdw/jupyterlab) with exactly the env the hub
spawner injects for a project-scoped lab (NHDW_PROJECT_PREFIX, NHDW_SYNC_*,
BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE), against a fresh synthetic project prefix
so no user's files are touched:

  S1  pull on an empty prefix (what the lab entrypoint does first)
  S2  push: 3 files incl. a ZERO-BYTE csv and a nested dir → keys + sizes
  S3  push again after editing one file → only that file re-uploaded
  S4  pull into a second dir → byte-identical
  S5  asymmetry: none of the keys exist on MinIO
  S6  cleanup with the sync identity itself (SeaweedFS `Write` includes delete —
      the known, accepted regression vs MinIO's PutObject-only grant)
"""
import hashlib, os, pathlib, subprocess, sys, time, boto3
from botocore.client import Config
SCRIPT = "/usr/local/bin/nhdw_project_sync.py"
PREFIX = os.environ["NHDW_PROJECT_PREFIX"]; BUCKET = os.environ["NHDW_SYNC_BUCKET"]
def cli(ep, ak, sk):
    return boto3.client("s3", endpoint_url=ep, aws_access_key_id=ak, aws_secret_access_key=sk, region_name="et-addis-1",
                        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, retries={"max_attempts": 1}))
SYN = cli(os.environ["NHDW_SYNC_ENDPOINT"], os.environ["NHDW_SYNC_ACCESS_KEY"], os.environ["NHDW_SYNC_SECRET_KEY"])
MNR = cli(os.environ["MN"], os.environ["MN_AK"], os.environ["MN_SK"])
R = []
def rec(i, ok, d): R.append(ok); print(f"  [{'PASS' if ok else 'FAIL'}] {i:<4} {d}", flush=True)
def run(cmd, workdir):
    env = dict(os.environ, NHDW_PROJECT_DIR=workdir); t0 = time.time()
    p = subprocess.run([sys.executable, SCRIPT, cmd], env=env, capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr).strip(), time.time() - t0
def keys():
    out = {}
    for pg in SYN.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=PREFIX):
        for o in pg.get("Contents", []): out[o["Key"][len(PREFIX):]] = o["Size"]
    return out
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()

print(f"sync probe: endpoint={os.environ['NHDW_SYNC_ENDPOINT']} prefix={PREFIX} BOTO={os.environ.get('BOTO_EXPERIMENTAL__NO_EMPTY_CONTINUE')}", flush=True)
W1, W2 = "/tmp/proj", "/tmp/proj2"
rc, out, dt = run("pull", W1); rec("S1", rc == 0 and keys() == {}, f"pull on empty prefix rc={rc} ({dt:.1f}s) {out[-80:]!r}")
pathlib.Path(W1, "data").mkdir(parents=True, exist_ok=True)
pathlib.Path(W1, "notes.md").write_bytes(os.urandom(512).hex().encode())
pathlib.Path(W1, "data/empty.csv").write_bytes(b"")
pathlib.Path(W1, "analysis.ipynb").write_text('{"cells": [], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}')
rc, out, dt = run("push", W1); k = keys()
want = {rel: pathlib.Path(W1, rel).stat().st_size for rel in ("notes.md", "data/empty.csv", "analysis.ipynb")}
rec("S2", rc == 0 and k == want and dt < 6, f"push rc={rc} in {dt:.1f}s (incl. zero-byte) → {k}; {out[-70:]!r}")
pathlib.Path(W1, "notes.md").write_bytes(b"edited " + os.urandom(100).hex().encode())
rc, out, dt = run("push", W1); k2 = keys()
rec("S3", rc == 0 and "1 file(s)" in out and k2["notes.md"] == 207, f"second push rc={rc}: {out[-60:]!r} → notes.md now {k2.get('notes.md')} B")
rc, out, dt = run("pull", W2)
same = all(sha(f"{W1}/{f}") == sha(f"{W2}/{f}") for f in ("notes.md", "data/empty.csv", "analysis.ipynb"))
rec("S4", rc == 0 and same, f"pull into fresh dir rc={rc}: byte-identical={same}")
on_mn = []
for rel in k2:
    try: MNR.head_object(Bucket=BUCKET, Key=PREFIX + rel); on_mn.append(rel)
    except Exception: pass
rec("S5", not on_mn, f"keys on MinIO: {on_mn}")
for rel in k2: SYN.delete_object(Bucket=BUCKET, Key=PREFIX + rel)
rec("S6", keys() == {}, f"sync identity deleted its {len(k2)} probe keys (Write includes delete on SeaweedFS)")
sys.exit(0 if all(R) else 1)
