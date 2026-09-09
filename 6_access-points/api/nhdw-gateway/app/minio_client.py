"""MinIO bytes client — writes exports + signs URLs."""
from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Any

from .settings import settings

log = logging.getLogger("gateway.minio")

_client: Any = None
_lock = asyncio.Lock()


def _build() -> Any:
    import boto3
    from botocore.client import Config
    return boto3.client(
        "s3",
        endpoint_url=settings.MINIO_ENDPOINT,
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        config=Config(signature_version="s3v4",
                      s3={"addressing_style": "path"},
                      retries={"max_attempts": 3, "mode": "standard"}),
    )


def _build_public() -> Any:
    """Same as _build but with the *public* endpoint baked in so presigned
    URLs are reachable from the browser (which can't resolve `seaweedfs-s3`)."""
    import boto3
    from botocore.client import Config
    return boto3.client(
        "s3",
        endpoint_url=settings.MINIO_PUBLIC_ENDPOINT,
        aws_access_key_id=settings.MINIO_ACCESS_KEY,
        aws_secret_access_key=settings.MINIO_SECRET_KEY,
        config=Config(signature_version="s3v4",
                      s3={"addressing_style": "path"},
                      retries={"max_attempts": 3, "mode": "standard"}),
    )


async def _ensure() -> Any:
    global _client
    async with _lock:
        if _client is None:
            _client = await asyncio.get_event_loop().run_in_executor(None, _build)
        return _client


async def write_export(*, key: str, body: bytes, content_type: str,
                       bucket: str | None = None) -> tuple[str, str, int]:
    s3 = await _ensure()
    sha = hashlib.sha256(body).hexdigest()
    resp = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: s3.put_object(
            Bucket=bucket or settings.EXPORTS_BUCKET,
            Key=key, Body=body, ContentType=content_type,
            Metadata={"sha256": sha, "source": "nhdw-gateway"}))
    etag = (resp.get("ETag") or "").strip('"')
    return etag, sha, len(body)


async def read_object(*, key: str, bucket: str,
                      max_bytes: int = 512_000) -> bytes | None:
    """Small-object read (package manifests/cards). None when absent."""
    s3 = await _ensure()
    import asyncio as _aio
    try:
        resp = await _aio.get_event_loop().run_in_executor(
            None, lambda: s3.get_object(Bucket=bucket, Key=key))
        return resp["Body"].read(max_bytes)
    except Exception:
        return None


async def copy_object(*, src_key: str, dst_key: str,
                      bucket: str | None = None,
                      src_bucket: str | None = None) -> None:
    """Server-side copy src → dst (the direct-send / project-to-project copy
    primitive). No bytes transit the gateway — MinIO copies internally."""
    s3 = await _ensure()
    b = bucket or settings.ARTIFACTS_BUCKET
    sb = src_bucket or b
    await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: s3.copy_object(Bucket=b, Key=dst_key,
                               CopySource={"Bucket": sb, "Key": src_key}))


async def delete_object(*, key: str, bucket: str | None = None) -> None:
    """Delete a single object (the unlink / cleanup primitive). Idempotent —
    S3/MinIO delete_object succeeds even when the key is already absent, so an
    unlink of a never-materialized link is a harmless no-op."""
    s3 = await _ensure()
    await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: s3.delete_object(Bucket=bucket or settings.ARTIFACTS_BUCKET,
                                 Key=key))


async def ensure_prefix(*, prefix: str, bucket: str | None = None) -> str:
    """Materialize an (otherwise empty) prefix by writing a zero-byte `.keep`
    marker under it. S3/MinIO has no real directories, so this is how a
    project's files/ folder comes into existence at create time. Returns the
    marker key. Idempotent (overwrites the same key)."""
    s3 = await _ensure()
    key = prefix.rstrip("/") + "/.keep"
    await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: s3.put_object(
            Bucket=bucket or settings.ARTIFACTS_BUCKET,
            Key=key, Body=b"", ContentType="application/octet-stream",
            Metadata={"source": "nhdw-gateway", "role": "prefix-marker"}))
    return key


async def list_prefix(*, prefix: str, bucket: str | None = None,
                      max_keys: int = 1000) -> list[dict[str, Any]]:
    """List objects under `prefix`. Returns [{key, name, size, last_modified}]
    where `name` is relative to the prefix. The gateway proxies this so the
    browser never gets S3 credentials. The `.keep` prefix marker is filtered
    out by the caller (route) so an empty project reads as truly empty."""
    s3 = await _ensure()
    b = bucket or settings.ARTIFACTS_BUCKET

    def _list() -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=b, Prefix=prefix,
                                        PaginationConfig={"MaxItems": max_keys}):
            for obj in (page.get("Contents") or []):
                key = obj["Key"]
                rel = key[len(prefix):] if key.startswith(prefix) else key
                out.append({"key": key, "name": rel,
                            "size": obj.get("Size", 0),
                            "last_modified": obj.get("LastModified")})
        return out

    return await asyncio.get_event_loop().run_in_executor(None, _list)


async def presign_get(*, key: str, ttl_s: int | None = None,
                      bucket: str | None = None,
                      filename: str | None = None) -> str:
    """Presigned URL pointing at MINIO_PUBLIC_ENDPOINT so the browser can hit it."""
    pub = await asyncio.get_event_loop().run_in_executor(None, _build_public)
    params: dict[str, Any] = {"Bucket": bucket or settings.EXPORTS_BUCKET, "Key": key}
    if filename:
        params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
    return await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: pub.generate_presigned_url(
            "get_object", Params=params,
            ExpiresIn=ttl_s or settings.EXPORT_PRESIGN_TTL_S))
