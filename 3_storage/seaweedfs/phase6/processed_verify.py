import os, boto3, datetime
from botocore.client import Config
def c(ep): return boto3.client("s3", endpoint_url=ep, region_name="us-east-1", aws_access_key_id=os.environ["AK"], aws_secret_access_key=os.environ["SK"], config=Config(signature_version="s3v4", s3={"addressing_style": "path"}))
S=c(os.environ["SW"]); M=c(os.environ["MN"])
def lst(cl): return {o["Key"]:(o["Size"],o["LastModified"]) for p in cl.get_paginator("list_objects_v2").paginate(Bucket="nhdw-processed") for o in p.get("Contents",[])}
s,m=lst(S),lst(M)
print(f"keys: SeaweedFS {len(s)}  MinIO {len(m)}  only-on-SeaweedFS {sorted(set(s)-set(m))}  only-on-MinIO {sorted(set(m)-set(s))}")
t0=datetime.datetime.fromisoformat(os.environ['T0']).replace(tzinfo=datetime.timezone.utc)
print(f"SeaweedFS keys rewritten today (LastModified>=10:40Z): {sum(1 for k in s if s[k][1]>=t0)}/{len(s)};  MinIO keys modified today: {sum(1 for k in m if m[k][1]>=t0)}")
print("KEYS " + " ".join(sorted(set(s)&set(m))))
