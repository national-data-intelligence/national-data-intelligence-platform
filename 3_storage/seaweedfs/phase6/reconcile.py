#!/usr/bin/env python3
"""In-cluster delta reconciliation between two S3 stores. See reconcile.sh. Never deletes."""
import os, sys, json, hashlib, boto3
from botocore.client import Config
def cl(ep, ak, sk):
    c = boto3.client("s3", endpoint_url=ep, region_name="us-east-1", aws_access_key_id=ak, aws_secret_access_key=sk,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=5, read_timeout=60, retries={"max_attempts": 3, "mode": "standard"}))
    c.meta.events.register("before-send.s3.PutObject", lambda request, **k: request.headers.pop("Expect", None) and None)
    return c
F = cl(os.environ["FROM_ENDPOINT"], os.environ["FROM_AK"], os.environ["FROM_SK"])
T = cl(os.environ["TO_ENDPOINT"],   os.environ["TO_AK"],   os.environ["TO_SK"])
APPLY = os.environ.get("APPLY") == "1"
ALL = ["nhdw-raw","nhdw-processed","nhdw-archive","nhdw-artifacts","nhdw-static","nhdw-docs","nhdw-exports"]
buckets = ALL if os.environ.get("BUCKETS","all") == "all" else os.environ["BUCKETS"].split(",")
def listing(c, b):
    out = {}
    try:
        for p in c.get_paginator("list_objects_v2").paginate(Bucket=b):
            for o in p.get("Contents", []): out[o["Key"]] = o["Size"]
    except Exception as e: print(f"  ! cannot list {b} on {c.meta.endpoint_url}: {e}")
    return out
def sha(c, b, k): return hashlib.sha256(c.get_object(Bucket=b, Key=k)["Body"].read()).hexdigest()
report = {"from": os.environ["FROM_ENDPOINT"], "to": os.environ["TO_ENDPOINT"], "apply": APPLY, "buckets": {}}
total_delta = 0
for b in buckets:
    src, dst = listing(F, b), listing(T, b)
    missing = [k for k in src if k not in dst]
    size_diff = [k for k in src if k in dst and dst[k] != src[k]]
    same_size = [k for k in src if k in dst and dst[k] == src[k]]
    content_diff = [k for k in same_size if sha(F, b, k) != sha(T, b, k)]
    only_on_target = [k for k in dst if k not in src]          # deleted on source? REPORT ONLY
    delta = missing + size_diff + content_diff; total_delta += len(delta)
    copied = []
    if APPLY:
        for k in delta:
            o = F.get_object(Bucket=b, Key=k); body = o["Body"].read()
            T.put_object(Bucket=b, Key=k, Body=body, ContentType=o.get("ContentType","application/octet-stream"), Metadata=o.get("Metadata", {}))
            if hashlib.sha256(T.get_object(Bucket=b, Key=k)["Body"].read()).hexdigest() != hashlib.sha256(body).hexdigest(): print(f"  !! verify failed after copy: {b}/{k}"); sys.exit(1)
            copied.append(k)
    report["buckets"][b] = {"source_objects": len(src), "target_objects": len(dst), "missing_on_target": missing, "size_differs": size_diff, "content_differs": content_diff, "only_on_target_NOT_DELETED": only_on_target, "copied": copied}
    print(f"  {b:<16} src={len(src):<5} dst={len(dst):<5} delta={len(delta):<4} only-on-target={len(only_on_target):<4} {'COPIED '+str(len(copied)) if APPLY else 'dry-run'}")
print(json.dumps(report))
print(f"\nDELTA TOTAL = {total_delta}  ({'applied' if APPLY else 'dry-run — nothing changed'})")
sys.exit(0)
