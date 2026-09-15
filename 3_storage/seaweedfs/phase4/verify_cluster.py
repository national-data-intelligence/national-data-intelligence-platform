#!/usr/bin/env python3
"""Phase 4A — in-cluster verification of the deployed SeaweedFS, with REAL identities.

Runs as a Job (verify-job.yaml) on the gateway image; identities.json is mounted from
seaweedfs-secrets, so no credential leaves the cluster. Every check prints one line:
    [PASS|FAIL|NOTE] <id> <what>  — <evidence>
and the process exits non-zero if anything FAILs. 04a-verify.sh runs it twice: MODE=all,
then MODE=persist after restarting the volume + filer pods (check 6).
"""
import hashlib, io, json, os, sys, time, urllib.request, urllib.error
import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

EP = os.environ.get("S3_ENDPOINT", "http://seaweedfs-s3:8333")
MASTER = os.environ.get("MASTER_URL", "http://seaweedfs-master:9333")
VOLUME = os.environ.get("VOLUME_URL", "http://seaweedfs-volume-0.seaweedfs-volume:8080")
FILER = os.environ.get("FILER_URL", "http://seaweedfs-filer:8888")
MODE = os.environ.get("MODE", "all")
SCRATCH = "nhdw-4a-scratch"
BUCKETS = ["nhdw-raw","nhdw-processed","nhdw-archive","nhdw-lake","nhdw-exports",
           "nhdw-artifacts","nhdw-backups","nhdw-static","nhdw-logs","nhdw-docs"]
PRIVATE = [b for b in BUCKETS if b != "nhdw-static"]

ids = json.load(open(os.environ.get("IDENTITIES_FILE", "/etc/seaweedfs/identities.json")))["identities"]
def find(pred):
    for i in ids:
        if pred(i): return i
    return None
admin = find(lambda i: "Admin" in i.get("actions", []))
mlflow = find(lambda i: any(a.startswith("Write:nhdw-artifacts") and "/" not in a.split(":",1)[1] for a in i.get("actions", [])) and "Admin" not in i.get("actions", []))
psync = find(lambda i: any("/projects/*" in a for a in i.get("actions", [])))
anon = find(lambda i: i.get("name") == "anonymous")

fails = 0
def out(v, cid, what, ev=""):
    global fails
    if v == "FAIL": fails += 1
    print(f"[{v}] {cid:<4} {what}" + (f"  — {ev}" if ev else ""), flush=True)

def creds(i): c = i["credentials"][0]; return c["accessKey"], c["secretKey"]
def client(ak, sk, strip_expect=True, **kw):
    c = boto3.client("s3", endpoint_url=EP, region_name="us-east-1", aws_access_key_id=ak, aws_secret_access_key=sk,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=5,
                      read_timeout=kw.get("read_timeout", 20), retries={"max_attempts": 2, "mode": "standard"}))
    if strip_expect: c.meta.events.register("before-send.s3.PutObject", lambda request, **k: request.headers.pop("Expect", None) and None)
    return c
def code(e): return e.response.get("Error", {}).get("Code", "?")
def http(url, timeout=8):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, b""
    except Exception as e: return None, str(e).encode()

A = client(*creds(admin))

# ── persist-check mode: only the marker read (run after pod restarts) ─────────
if MODE == "persist":
    try:
        got = A.get_object(Bucket=SCRATCH, Key="_persist/marker.txt")["Body"].read()
        ok = got == b"4A-persist-marker"
        out("PASS" if ok else "FAIL", "6", "PVC persistence after volume + filer pod restart (READ)", f"marker readback identical={ok}")
    except Exception as e:
        out("FAIL", "6", "PVC persistence after volume + filer pod restart (READ)", repr(e))
    # 6b — WRITES after the restart. Added after the first live run: a rolling restart of
    # the filer emptied the lock ring, so reads passed while every write failed with
    # "no lock server found". A restart test that only reads would have hidden it.
    try:
        A.put_object(Bucket=SCRATCH, Key="_persist/after-restart.txt", Body=b"written-after-restart")
        got = A.get_object(Bucket=SCRATCH, Key="_persist/after-restart.txt")["Body"].read()
        out("PASS" if got == b"written-after-restart" else "FAIL", "6b", "WRITE after volume + filer pod restart", "put+get ok" if got == b"written-after-restart" else "readback mismatch")
    except Exception as e:
        out("FAIL", "6b", "WRITE after volume + filer pod restart", f"{type(e).__name__}: {str(e)[:120]}")
    sys.exit(1 if fails else 0)

# ── 1–4 component health over HTTP (k8s readiness is checked by the shell too) ──
st, body = http(f"{MASTER}/cluster/status"); out("PASS" if st == 200 else "FAIL", "1", "Master health /cluster/status", f"HTTP {st}")
st, body = http(f"{VOLUME}/status");         out("PASS" if st == 200 else "FAIL", "2", "Volume server health /status", f"HTTP {st}")
st, body = http(f"{FILER}/");                out("PASS" if st in (200, 403) else "FAIL", "3", "Filer health /", f"HTTP {st}")
try:
    A.list_buckets(); out("PASS", "4", "S3 gateway answers an authenticated ListBuckets")
except Exception as e: out("FAIL", "4", "S3 gateway answers an authenticated ListBuckets", repr(e))
# 5 (PostgreSQL filer connection) is verified by the shell via psql; here: filer store must not be leveldb
st, body = http(f"{MASTER}/dir/status")
try:
    topo = json.loads(body)["Topology"]; out("PASS" if topo["Free"] > 20 else "FAIL", "5b", "Master volume capacity headroom", f"Max={topo['Max']} Free={topo['Free']} (needs >20)")
except Exception as e: out("FAIL", "5b", "Master volume capacity headroom", repr(e))

# ── 7 buckets ──────────────────────────────────────────────────────────────────
have = {b["Name"] for b in A.list_buckets()["Buckets"]}
missing = [b for b in BUCKETS if b not in have]
out("PASS" if not missing else "FAIL", "7", "All 10 buckets exist (seaweedfs-init)", f"missing={missing}" if missing else f"{len(BUCKETS)}/10 present")
try: A.create_bucket(Bucket=SCRATCH)
except ClientError: pass

# ── 8 credential authentication ───────────────────────────────────────────────
ak, sk = creds(admin)
try:
    client(ak, "definitely-wrong").list_buckets(); out("FAIL", "8", "Wrong secret is rejected", "accepted!")
except ClientError as e: out("PASS", "8", "Wrong secret is rejected, right secret accepted", f"wrong→{code(e)}; right→OK")

# ── 9 positive / 10 negative permissions, 16 delete ──────────────────────────
def can(c, op, bucket, key, body=b"x"):
    try:
        {"get": lambda: c.get_object(Bucket=bucket, Key=key), "put": lambda: c.put_object(Bucket=bucket, Key=key, Body=body),
         "del": lambda: c.delete_object(Bucket=bucket, Key=key), "list": lambda: c.list_objects_v2(Bucket=bucket, MaxKeys=1)}[op]()
        return "ALLOW"
    except ClientError as e: return code(e)
A.put_object(Bucket="nhdw-artifacts", Key="_4a/projects/p/nb.ipynb", Body=b"{}")
A.put_object(Bucket="nhdw-artifacts", Key="_4a/mlflow/m/MLmodel", Body=b"m")
A.put_object(Bucket="nhdw-raw", Key="_4a/raw.txt", Body=b"r")
pos = []; neg = []
pos.append(("admin put nhdw-raw", can(A, "put", "nhdw-raw", "_4a/a.txt")))
if mlflow:
    M = client(*creds(mlflow))
    pos.append((f"{mlflow['name']} put nhdw-artifacts", can(M, "put", "nhdw-artifacts", "_4a/mlflow/m/x")))
    neg.append((f"{mlflow['name']} put nhdw-raw", can(M, "put", "nhdw-raw", "_4a/hijack")))
    pos.append((f"{mlflow['name']} get nhdw-raw", can(M, "get", "nhdw-raw", "_4a/raw.txt")))   # Phase 6 G3: the ML runner reads the raw lake (Read:nhdw-raw granted)
else: out("NOTE", "9", "no bucket-scoped (mlflow) identity found in identities.json")
if psync:
    P = client(*creds(psync))
    # the real grant is projects/* at the bucket root; our fixtures sit under _4a/ → test the real prefix
    A.put_object(Bucket="nhdw-artifacts", Key="projects/_4a/nb.ipynb", Body=b"{}")
    A.put_object(Bucket="nhdw-artifacts", Key="mlflow/_4a/MLmodel", Body=b"m")
    pos.append((f"{psync['name']} get projects/*", can(P, "get", "nhdw-artifacts", "projects/_4a/nb.ipynb")))
    pos.append((f"{psync['name']} put projects/*", can(P, "put", "nhdw-artifacts", "projects/_4a/w.txt")))
    neg.append((f"{psync['name']} get mlflow/*", can(P, "get", "nhdw-artifacts", "mlflow/_4a/MLmodel")))
    neg.append((f"{psync['name']} put mlflow/*", can(P, "put", "nhdw-artifacts", "mlflow/_4a/HIJACK")))
    neg.append((f"{psync['name']} get nhdw-raw", can(P, "get", "nhdw-raw", "_4a/raw.txt")))
    d = can(P, "del", "nhdw-artifacts", "projects/_4a/w.txt")
    out("NOTE", "16b", f"{psync['name']} delete inside projects/* → {d}", "EXPECTED regression: SeaweedFS Write includes delete (Q6b)")
else: out("NOTE", "9", "no prefix-scoped (jupyter-sync) identity found in identities.json")
out("PASS" if all(r == "ALLOW" for _, r in pos) else "FAIL", "9", "Positive permissions", "; ".join(f"{l}={r}" for l, r in pos))
out("PASS" if all(r != "ALLOW" for _, r in neg) else "FAIL", "10", "Negative permissions", "; ".join(f"{l}={r}" for l, r in neg))
out("PASS" if can(A, "del", "nhdw-raw", "_4a/a.txt") == "ALLOW" else "FAIL", "16", "Delete behaviour (admin can delete)")
if mlflow: out("PASS" if can(M, "del", "nhdw-raw", "_4a/raw.txt") != "ALLOW" else "FAIL", "16c", f"{mlflow['name']} cannot delete in nhdw-raw")

# ── 11 anonymous static / 12 every private bucket denied ─────────────────────
A.put_object(Bucket="nhdw-static", Key="_4a/open.json", Body=b'{"open":true}', ContentType="application/json")
st, _ = http(f"{EP}/nhdw-static/_4a/open.json"); out("PASS" if st == 200 else "FAIL", "11", "Anonymous GET on nhdw-static", f"HTTP {st}")
denied = {}
for b in PRIVATE:
    A.put_object(Bucket=b, Key="_4a/private.txt", Body=b"p")
    st, _ = http(f"{EP}/{b}/_4a/private.txt"); denied[b] = st
bad = {b: s for b, s in denied.items() if s == 200}
out("PASS" if not bad else "FAIL", "12", f"Anonymous GET denied on all {len(PRIVATE)} private buckets", f"exposed={bad}" if bad else "all 403/4xx")
stl, _ = http(f"{EP}/nhdw-raw?list-type=2"); out("PASS" if stl != 200 else "FAIL", "12b", "Anonymous LIST on a private bucket denied", f"HTTP {stl}")

# ── 13/14 presigned ───────────────────────────────────────────────────────────
try:
    u = A.generate_presigned_url("get_object", Params={"Bucket": "nhdw-raw", "Key": "_4a/raw.txt"}, ExpiresIn=120)
    st, b = http(u); out("PASS" if st == 200 and b == b"r" else "FAIL", "13", "Presigned GET", f"HTTP {st}")
    pu = A.generate_presigned_url("put_object", Params={"Bucket": SCRATCH, "Key": "_4a/presigned.txt"}, ExpiresIn=120)
    req = urllib.request.Request(pu, data=b"via-presigned-put", method="PUT")
    with urllib.request.urlopen(req, timeout=10) as r: st = r.status
    rb = A.get_object(Bucket=SCRATCH, Key="_4a/presigned.txt")["Body"].read()
    out("PASS" if st == 200 and rb == b"via-presigned-put" else "FAIL", "14", "Presigned PUT", f"HTTP {st}, readback ok={rb==b'via-presigned-put'}")
except Exception as e: out("FAIL", "13/14", "Presigned URLs", repr(e))

# ── 15 multipart ─────────────────────────────────────────────────────────────
try:
    from boto3.s3.transfer import TransferConfig
    payload = os.urandom(24 * 1024 * 1024); tc = TransferConfig(multipart_threshold=8*1024*1024, multipart_chunksize=8*1024*1024)
    A.upload_fileobj(io.BytesIO(payload), SCRATCH, "_4a/big.bin", Config=tc)
    o = io.BytesIO(); A.download_fileobj(SCRATCH, "_4a/big.bin", o, Config=tc)
    ok = hashlib.sha256(o.getvalue()).hexdigest() == hashlib.sha256(payload).hexdigest()
    out("PASS" if ok else "FAIL", "15", "Multipart upload 24 MB, sha256 identical", f"identical={ok}")
except Exception as e: out("FAIL", "15", "Multipart upload", repr(e))

# ── 17 zero-byte regression ──────────────────────────────────────────────────
try:
    D = client(*creds(admin), strip_expect=False, read_timeout=12); F = client(*creds(admin))
    def seq(c):
        ts = []
        for k, body in (("_4a/z-d1", b"x"*200), ("_4a/z-0", b""), ("_4a/z-d2", b"y"*200)):
            t = time.time()
            try: c.put_object(Bucket=SCRATCH, Key=k, Body=body); ts.append((time.time()-t)*1000)
            except Exception: ts.append(99999)
        return ts
    a = seq(D); b = seq(F)
    out("PASS" if b[2] < 1000 else "FAIL", "17", "Zero-byte regression: data PUT after empty PUT (Expect stripped)", f"default={a[2]:.0f} ms  stripped={b[2]:.0f} ms")
except Exception as e: out("FAIL", "17", "Zero-byte regression", repr(e))

# ── 18 listing + pagination ──────────────────────────────────────────────────
try:
    for i in range(1100): A.put_object(Bucket=SCRATCH, Key=f"_4a/page/k{i:05d}", Body=b"x")
    seen = []; pages = 0
    for p in A.get_paginator("list_objects_v2").paginate(Bucket=SCRATCH, Prefix="_4a/page/"): pages += 1; seen += [o["Key"] for o in p.get("Contents", [])]
    ok = len(set(seen)) == 1100 and seen == sorted(seen)
    out("PASS" if ok else "FAIL", "18", "Listing + pagination past 1000 keys, byte order", f"{len(set(seen))} keys, {pages} pages, sorted={seen==sorted(seen)}")
    d = A.list_objects_v2(Bucket=SCRATCH, Prefix="_4a/", Delimiter="/"); out("PASS" if d.get("CommonPrefixes") else "FAIL", "18b", "Delimiter listing returns CommonPrefixes")
except Exception as e: out("FAIL", "18", "Listing + pagination", repr(e))

# ── 6 (part 1) persistence marker — read back after restarts in MODE=persist ──
A.put_object(Bucket=SCRATCH, Key="_persist/marker.txt", Body=b"4A-persist-marker"); out("NOTE", "6", "Persistence marker written; read back after pod restarts")

# ── cleanup of fixtures in the real buckets (scratch bucket is removed by the shell at the very end) ──
for b, k in [("nhdw-artifacts","_4a/projects/p/nb.ipynb"),("nhdw-artifacts","_4a/mlflow/m/MLmodel"),("nhdw-artifacts","_4a/mlflow/m/x"),
             ("nhdw-artifacts","projects/_4a/nb.ipynb"),("nhdw-artifacts","projects/_4a/w.txt"),("nhdw-artifacts","mlflow/_4a/MLmodel"),
             ("nhdw-static","_4a/open.json")] + [(b, "_4a/private.txt") for b in PRIVATE] + [("nhdw-raw","_4a/raw.txt")]:
    try: A.delete_object(Bucket=b, Key=k)
    except ClientError: pass
print(f"\n{'ALL IN-CLUSTER CHECKS PASSED' if not fails else f'{fails} CHECK(S) FAILED — DO NOT MIGRATE DATA'}", flush=True)
sys.exit(1 if fails else 0)
