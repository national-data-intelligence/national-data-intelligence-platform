#!/usr/bin/env python3
"""Phase 6 G2 runtime validation — runs INSIDE the cluster (Job, ml-runner image).

Exercises the real artifact consumers after they were repointed to SeaweedFS:

  T1  gateway  GET  /api/docs                 read  (nhdw-docs via the gateway)
  T2  gateway  GET  /api/docs/{name}          presigned URL → fetched through the
                                              public Ingress host → byte-identical
  T3  gateway  POST /api/exports/marts/...    real export write → nhdw-exports,
                                              metadata, listing, presigned download
  T4  gateway  negative: tampered signature, anonymous export refused
  T5  mlflow   proxied artifacts (server owns S3): log 256 KiB + EMPTY file,
                                              list, download, byte compare, timing
  T6  mlflow   registered-model retrieval via models:/ → files byte-identical to
                                              the MinIO copy of the same version
  T7  runner   direct S3 with the mlflow identity (= _runner_env footprint):
                                              artifacts RW, exports W, processed R,
                                              raw W DENIED, zero-byte timing
  T8  sync     direct S3 with the jupyter-sync identity: projects/* RW,
                                              mlflow/ DENIED, nhdw-raw DENIED
  T9  asymmetry: nothing new landed on MinIO (counts + probe keys)
  T10 cleanup of probe keys on SeaweedFS (never touches MinIO)

Never prints a credential. Exit 0 only if every check passed.
"""
import hashlib, io, json, os, sys, tempfile, time, uuid, pathlib
import boto3, requests
from botocore.client import Config
from botocore.exceptions import ClientError

SW  = os.environ["SW"];  MN = os.environ.get("MN", "")          # MN empty ⇒ MinIO decommissioned: asymmetry checks become "no second store"
GW  = os.environ["GW"];  PUB = os.environ["PUB_HOST"]      # https://minio.<ip>.nip.io
MLF = os.environ["MLFLOW_TRACKING_URI"]
REG = "et-addis-1"
STAMP = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
TAG = f"_phase6_g2_{STAMP}"
R = []            # (id, ok, detail)
def rec(tid, ok, detail):
    R.append((tid, ok, detail)); print(f"  [{'PASS' if ok else 'FAIL'}] {tid:<6} {detail}", flush=True)

def s3(endpoint, ak, sk):
    return boto3.client("s3", endpoint_url=endpoint, aws_access_key_id=ak, aws_secret_access_key=sk,
                        region_name=REG, config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                                                       connect_timeout=10, read_timeout=30, retries={"max_attempts": 1}))
SWR = s3(SW, os.environ["SW_AK"], os.environ["SW_SK"])          # SeaweedFS admin (nhdw_root)
MNR = s3(MN, os.environ["MN_AK"], os.environ["MN_SK"]) if MN else None          # MinIO root (read-only use here); None after decommission
RUN = s3(SW, os.environ["ML_AK"], os.environ["ML_SK"])          # mlflow identity on SeaweedFS
SYN = s3(SW, os.environ["SY_AK"], os.environ["SY_SK"])          # jupyter-sync identity on SeaweedFS
# routes resolve the subject as a UUID; docs/exports need the R-SUPER capability set
MOCK = {"X-Mock-User": os.environ.get("MOCK_USER", str(uuid.uuid4())),
        "X-Mock-Role": os.environ.get("MOCK_ROLE", "R-SUPER"),
        "X-Mock-Secret": os.environ["MOCK_SECRET"]}
def sha(b): return hashlib.sha256(b).hexdigest()
def exists(c, b, k):
    try: c.head_object(Bucket=b, Key=k); return True
    except ClientError as e:
        if e.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"): return False
        raise
def count(c, b, prefix=""):
    n = 0
    for p in c.get_paginator("list_objects_v2").paginate(Bucket=b, Prefix=prefix): n += p.get("KeyCount", 0)
    return n
def err(e): return e.response["Error"]["Code"] if isinstance(e, ClientError) else type(e).__name__
def fetch_public(url):
    return requests.get(url, timeout=30, verify=False)

print(f"G2 validation {STAMP}  gateway={GW}  mlflow={MLF}  public={PUB}", flush=True)
requests.packages.urllib3.disable_warnings()
probe_keys = []   # (client, bucket, key) written on SeaweedFS by this run — cleaned at the end
mn_before = {b: count(MNR, b) for b in ("nhdw-artifacts", "nhdw-exports", "nhdw-docs")} if MNR else {}
print(f"  MinIO object counts before: {mn_before}", flush=True)

# ── T1 docs read through the gateway ─────────────────────────────────────────
try:
    r = requests.get(f"{GW}/api/docs", headers=MOCK, timeout=30); r.raise_for_status()
    docs = r.json().get("docs") or []
    rec("T1", len(docs) > 0 and r.json().get("bucket") == "nhdw-docs", f"GET /api/docs → {r.status_code}, {len(docs)} docs, bucket={r.json().get('bucket')}")
except Exception as e:
    docs = []; rec("T1", False, f"GET /api/docs failed: {e}")

# ── T2 doc presign → public host → bytes identical on SW and (restored copy) MinIO ─
try:
    name = next((d.get("name") or d.get("key") for d in docs if (d.get("name") or d.get("key", "")).endswith(".md")), None) or (docs[0].get("name") if docs else None)
    r = requests.get(f"{GW}/api/docs/{name}", headers=MOCK, timeout=30); r.raise_for_status()
    j = r.json(); url = j.get("url")
    if url:
        assert url.startswith(PUB), f"presigned URL not on public host: {url[:60]}"
        p = fetch_public(url); body = p.content
        direct = SWR.get_object(Bucket="nhdw-docs", Key=name)["Body"].read()
        mn = MNR.get_object(Bucket="nhdw-docs", Key=name)["Body"].read() if MNR else body
        rec("T2", p.status_code == 200 and sha(body) == sha(direct) == sha(mn),
            f"doc {name}: presigned via {PUB} → HTTP {p.status_code}, {len(body)} B, sha match SW={sha(body)==sha(direct)} MinIO-copy={sha(body)==sha(mn)}")
    else:
        md = j.get("markdown", ""); direct = SWR.get_object(Bucket="nhdw-docs", Key=name)["Body"].read().decode("utf-8", "replace")
        rec("T2", len(md) > 0 and md == direct, f"doc {name}: inline markdown {len(md)} chars, identical to direct SeaweedFS read={md==direct} (no presign path for .md)")
except Exception as e:
    rec("T2", False, f"doc presign/read failed: {e}")

# ── T3 real export through the gateway ───────────────────────────────────────
export_key = None
try:
    r = requests.get(f"{GW}/api/marts", headers=MOCK, timeout=60); r.raise_for_status()
    marts = r.json().get("rows") or r.json().get("marts") or []          # /api/marts → {"columns": [...], "rows": [{"table_schema","table_name"}]}
    m = marts[0]; schema, table = (m.get("table_schema") or m.get("schema")), (m.get("table_name") or m.get("table"))
    t0 = time.time()
    r = requests.post(f"{GW}/api/exports/marts/{schema}/{table}?format=csv&_limit=50", headers=MOCK, timeout=120)
    dt = time.time() - t0
    assert r.status_code == 200, f"export → {r.status_code} {r.text[:200]}"
    j = r.json(); url = j["download_url"]; export_id = j["export_id"]
    # the response carries no key → resolve it from the caller's own export listing (the real UI path)
    r2 = requests.get(f"{GW}/api/exports/me", headers=MOCK, timeout=30); r2.raise_for_status()
    mine = r2.json(); mine = mine if isinstance(mine, list) else (mine.get("rows") or mine.get("exports") or mine.get("items") or [])   # /api/exports/me → bare array
    row = next((x for x in mine if str(x.get("export_id") or x.get("id")) == str(export_id)), None)
    export_key = (row or {}).get("minio_key") or requests.utils.urlparse(url).path.split("/nhdw-exports/", 1)[1]
    head = SWR.head_object(Bucket="nhdw-exports", Key=export_key)
    meta = head.get("Metadata", {}); size = head["ContentLength"]
    p = fetch_public(url); ok_dl = p.status_code == 200 and sha(p.content) == meta.get("sha256") and len(p.content) == j.get("byte_count")   # response carries byte_count, not sha
    on_minio = exists(MNR, "nhdw-exports", export_key) if MNR else False
    listed = row is not None and bool(row.get("download_url"))
    rec("T3", size > 0 and ok_dl and not on_minio and listed and meta.get("source") == "nhdw-gateway",
        f"export {schema}.{table} → {export_key} ({size} B in {dt:.1f}s) meta.source={meta.get('source')} presigned-download HTTP {p.status_code} sha-match={ok_dl} listed-in-/me={listed} on-MinIO={on_minio}")
except Exception as e:
    rec("T3", False, f"export failed: {e}")

# ── T4 negatives ─────────────────────────────────────────────────────────────
try:
    bad = None
    if export_key:
        url = SWR.generate_presigned_url("get_object", Params={"Bucket": "nhdw-exports", "Key": export_key}, ExpiresIn=60)
        # public-host equivalent with a tampered signature
        url = url.replace(SW, PUB); url = url[:-4] + ("0000" if not url.endswith("0000") else "1111")
        bad = fetch_public(url)
    anon = requests.post(f"{GW}/api/exports/marts/bi_public/none?format=csv", timeout=30)      # no credential at all
    rec("T4", (bad is None or bad.status_code in (403, 400)) and anon.status_code in (401, 403, 404, 422),
        f"tampered presign → HTTP {getattr(bad,'status_code',None)}; anonymous export → HTTP {anon.status_code}")
except Exception as e:
    rec("T4", False, f"negative checks errored: {e}")

# ── T5 MLflow proxied artifacts ──────────────────────────────────────────────
import mlflow
mlflow.set_tracking_uri(MLF)
run_id = exp_id = None
try:
    exp_id = mlflow.create_experiment(TAG)
    big = os.urandom(256 * 1024)
    with tempfile.TemporaryDirectory() as d:
        pathlib.Path(d, "blob.bin").write_bytes(big); pathlib.Path(d, "empty.txt").write_bytes(b"")
        with mlflow.start_run(experiment_id=exp_id, run_name="g2-proxied") as run:
            run_id = run.info.run_id
            t0 = time.time(); mlflow.log_artifact(f"{d}/blob.bin"); t_big = time.time() - t0
            t0 = time.time(); mlflow.log_artifact(f"{d}/empty.txt"); t_empty = time.time() - t0
            mlflow.log_text("phase6 g2", "note.txt")
        arts = {a.path: a.file_size for a in mlflow.artifacts.list_artifacts(run_id=run_id)}
        out = mlflow.artifacts.download_artifacts(run_id=run_id, dst_path=f"{d}/dl")
        got_big = pathlib.Path(out, "blob.bin").read_bytes(); got_empty = pathlib.Path(out, "empty.txt").read_bytes()
    prefix = f"mlflow/{exp_id}/{run_id}/artifacts/"
    n_sw = count(SWR, "nhdw-artifacts", prefix); n_mn = count(MNR, "nhdw-artifacts", prefix) if MNR else 0
    rec("T5", got_big == big and got_empty == b"" and arts.get("empty.txt") in (0, None) and n_sw >= 3 and n_mn == 0 and t_empty < 3,   # proxied list: proto3 JSON omits file_size=0 → None
        f"run {run_id[:8]}: 256KiB {t_big:.2f}s, EMPTY {t_empty:.2f}s (stall threshold 3s), list={arts}, download identical={got_big==big and got_empty==b''}, keys SW={n_sw} MinIO={n_mn}")
except Exception as e:
    rec("T5", False, f"mlflow proxied artifacts failed: {e}")

# ── T6 registered-model retrieval == MinIO copy ──────────────────────────────
try:
    from mlflow import MlflowClient
    c = MlflowClient(); models = c.search_registered_models(max_results=50)
    pick = None
    for m in models:
        for a, v in (m.aliases or {}).items():
            if a == "champion": pick = (m.name, v); break
        if pick: break
    if not pick and models and models[0].latest_versions: pick = (models[0].name, models[0].latest_versions[0].version)
    assert pick, "no registered model found"
    name, ver = pick; mv = c.get_model_version(name, ver); src = mv.source
    with tempfile.TemporaryDirectory() as d:
        local = mlflow.artifacts.download_artifacts(f"models:/{name}/{ver}", dst_path=d)
        files = {str(p.relative_to(local)): sha(p.read_bytes()) for p in pathlib.Path(local).rglob("*") if p.is_file() and p.name != "registered_model_meta"}   # local-only file written by ModelsArtifactRepository
    if src.startswith("mlflow-artifacts:/"): key_prefix = "mlflow/" + src[len("mlflow-artifacts:/"):].lstrip("/")
    elif src.startswith("s3://nhdw-artifacts/"): key_prefix = src[len("s3://nhdw-artifacts/"):]
    else: key_prefix = None
    mn_files = {}
    if key_prefix and MNR:
        for p in MNR.get_paginator("list_objects_v2").paginate(Bucket="nhdw-artifacts", Prefix=key_prefix.rstrip("/") + "/"):
            for o in p.get("Contents", []):
                rel = o["Key"][len(key_prefix.rstrip("/")) + 1:]
                mn_files[rel] = sha(MNR.get_object(Bucket="nhdw-artifacts", Key=o["Key"])["Body"].read())
    same = (files == mn_files and len(files) > 0) if MNR else len(files) > 0
    loaded = None
    try:
        mlflow.pyfunc.load_model(f"models:/{name}/{ver}"); loaded = True
    except Exception as e2:
        loaded = f"load_model: {type(e2).__name__}"
    diff = sorted(set(files) ^ set(mn_files)) + sorted(k for k in files if k in mn_files and files[k] != mn_files[k])
    rec("T6", same, f"models:/{name}/{ver} source={src[:60]} → {len(files)} files via MLflow(SeaweedFS), byte-identical to MinIO copy={same} ({len(mn_files)} files there); differing={diff}; pyfunc.load_model={loaded}")
except Exception as e:
    rec("T6", False, f"registered-model retrieval failed: {e}")

# ── T7 runner identity footprint on SeaweedFS ────────────────────────────────
try:
    res = {}
    k1 = f"ml-adhoc/{TAG}/input.csv"; RUN.put_object(Bucket="nhdw-artifacts", Key=k1, Body=b"a,b\n1,2\n"); probe_keys.append((RUN, "nhdw-artifacts", k1)); res["artifacts W"] = "OK"
    res["artifacts R"] = "OK" if RUN.get_object(Bucket="nhdw-artifacts", Key=k1)["Body"].read() == b"a,b\n1,2\n" else "MISMATCH"
    k2 = f"{TAG}/runner.csv"; RUN.put_object(Bucket="nhdw-exports", Key=k2, Body=b"x\n"); probe_keys.append((RUN, "nhdw-exports", k2)); res["exports W"] = "OK"
    pk = next(iter(SWR.list_objects_v2(Bucket="nhdw-processed", MaxKeys=1).get("Contents", [])), {}).get("Key")
    res["processed R"] = "OK" if pk and RUN.get_object(Bucket="nhdw-processed", Key=pk)["ContentLength"] > 0 else "FAIL"
    try: RUN.put_object(Bucket="nhdw-raw", Key=f"{TAG}/x", Body=b"x"); res["raw W"] = "ALLOWED(!)"
    except ClientError as e: res["raw W"] = f"denied:{err(e)}"
    try: RUN.get_object(Bucket="nhdw-exports", Key=k2); res["exports R"] = "ALLOWED(!)"
    except ClientError as e: res["exports R"] = f"denied:{err(e)}"     # runner writes exports, only the gateway reads them
    t0 = time.time(); RUN.put_object(Bucket="nhdw-exports", Key=f"{TAG}/empty", Body=b""); t_empty = time.time() - t0; probe_keys.append((RUN, "nhdw-exports", f"{TAG}/empty"))
    res["zero-byte"] = f"{t_empty:.2f}s size={SWR.head_object(Bucket='nhdw-exports', Key=f'{TAG}/empty')['ContentLength']}"   # identity has no Read on exports (by design) → admin HEAD
    ok = res["artifacts W"] == "OK" and res["artifacts R"] == "OK" and res["exports W"] == "OK" and res["processed R"] == "OK" and res["raw W"].startswith("denied") and t_empty < 3
    rec("T7", ok, f"mlflow identity: {res}")
except Exception as e:
    rec("T7", False, f"runner identity checks errored: {e}")

# ── T8 sync identity footprint ───────────────────────────────────────────────
try:
    res = {}
    k = f"projects/{TAG}/files/a.txt"; SYN.put_object(Bucket="nhdw-artifacts", Key=k, Body=b"hello"); probe_keys.append((SYN, "nhdw-artifacts", k)); res["projects/* W"] = "OK"
    res["projects/* L"] = f"{count(SYN, 'nhdw-artifacts', f'projects/{TAG}/')} key(s)"
    try: SYN.put_object(Bucket="nhdw-artifacts", Key=f"mlflow/{TAG}/x", Body=b"x"); res["mlflow/ W"] = "ALLOWED(!)"
    except ClientError as e: res["mlflow/ W"] = f"denied:{err(e)}"
    try: SYN.put_object(Bucket="nhdw-raw", Key=f"{TAG}/x", Body=b"x"); res["raw W"] = "ALLOWED(!)"
    except ClientError as e: res["raw W"] = f"denied:{err(e)}"
    ok = res["projects/* W"] == "OK" and res["mlflow/ W"].startswith("denied") and res["raw W"].startswith("denied")
    rec("T8", ok, f"jupyter-sync identity: {res}")
except Exception as e:
    rec("T8", False, f"sync identity checks errored: {e}")

# ── T9 MinIO untouched ───────────────────────────────────────────────────────
try:
    if MNR:
        mn_after = {b: count(MNR, b) for b in ("nhdw-artifacts", "nhdw-exports", "nhdw-docs")}
        stray = [k for (_, b, k) in probe_keys if exists(MNR, b, k)] + ([export_key] if export_key and exists(MNR, "nhdw-exports", export_key) else [])
        rec("T9", mn_after == mn_before and not stray, f"MinIO counts before={mn_before} after={mn_after}; probe keys on MinIO={stray}")
    else:
        rec("T9", True, "no second store (MinIO decommissioned) — every write above landed on SeaweedFS by construction")
except Exception as e:
    rec("T9", False, f"MinIO asymmetry check errored: {e}")

# ── T10 cleanup on SeaweedFS (probe keys only; export + mlflow run kept as evidence) ─
try:
    n = 0
    for c, b, k in probe_keys:
        try: c.delete_object(Bucket=b, Key=k); n += 1
        except ClientError as e:
            SWR.delete_object(Bucket=b, Key=k); n += 1
    rec("T10", not any(exists(SWR, b, k) for _, b, k in probe_keys), f"{n} probe key(s) removed from SeaweedFS; kept: export {export_key}, mlflow experiment {TAG} (run {run_id[:8] if run_id else None})")
except Exception as e:
    rec("T10", False, f"cleanup errored: {e}")

print(json.dumps({"stamp": STAMP, "results": [{"id": i, "ok": o, "detail": d} for i, o, d in R],
                  "export_key": export_key, "mlflow_experiment": TAG, "mlflow_run": run_id}, indent=1))
sys.exit(0 if all(o for _, o, _ in R) else 1)
