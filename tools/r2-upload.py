#!/usr/bin/env python3
"""Upload files to the Cloudflare R2 bucket behind cdn.elden-mogu.com.

    pip install boto3

    # mirror a built release (the same keys discord-release.yml writes)
    python tools/r2-upload.py release 0.5.5

    # anything else
    python tools/r2-upload.py put logo.png img/logo.png --cache-control "public, max-age=300"

Credentials come from the environment:

    R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID

The key must be an *Object* token (R2 -> Manage R2 API Tokens -> Account API
token, Object Read & Write, scoped to the bucket). Such tokens work only over
the S3 API used here; `wrangler r2 object put` goes through Cloudflare's REST
API and answers 403 for them.
"""
import argparse
import mimetypes
import os
import sys
from pathlib import Path

BUCKET = "elden-mogu-public"
BASE_URL = "https://cdn.elden-mogu.com"

# A versioned key never changes; anything rewritten in place caches briefly so
# a new release is not shadowed by the old one. Keep in sync with
# .github/workflows/discord-release.yml.
IMMUTABLE = "public, max-age=31536000, immutable"
SHORT = "public, max-age=300"

EXE_TYPE = "application/vnd.microsoft.portable-executable"


def client():
    try:
        import boto3
        from botocore.config import Config
    except ImportError:
        sys.exit("boto3 is missing — run: pip install boto3")

    try:
        account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
        key_id = os.environ["R2_ACCESS_KEY_ID"]
        secret = os.environ["R2_SECRET_ACCESS_KEY"]
    except KeyError as e:
        sys.exit(f"missing environment variable: {e.args[0]}")

    kwargs = dict(
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        region_name="auto",
    )
    try:
        # botocore >= 1.36 checksums every upload; R2 rejects some of those.
        return boto3.client(
            "s3", config=Config(request_checksum_calculation="when_required"), **kwargs
        )
    except TypeError:
        return boto3.client("s3", **kwargs)


def guess_type(path: Path) -> str:
    if path.suffix == ".exe":
        return EXE_TYPE
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def upload(s3, src: Path, key: str, content_type: str, cache_control: str) -> None:
    with src.open("rb") as fh:
        s3.put_object(
            Bucket=BUCKET,
            Key=key,
            Body=fh,
            ContentType=content_type,
            CacheControl=cache_control,
        )
    print(f"{BASE_URL}/{key}  ({src.stat().st_size:,} bytes, {cache_control})")


def cmd_release(args) -> int:
    dist = Path(args.dist)
    s3 = client()
    for suffix in (".exe", ".zip"):
        src = dist / f"mogugi_{args.version}{suffix}"
        if not src.is_file():
            sys.exit(f"not found: {src} (run release.ps1 first)")
        ct = guess_type(src)
        upload(s3, src, f"mogugi/v{args.version}/{src.name}", ct, IMMUTABLE)
        upload(s3, src, f"mogugi/latest/mogugi{suffix}", ct, SHORT)
    return 0


def cmd_put(args) -> int:
    src = Path(args.file)
    if not src.is_file():
        sys.exit(f"not found: {src}")
    upload(
        client(),
        src,
        args.key,
        args.content_type or guess_type(src),
        args.cache_control,
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    rel = sub.add_parser("release", help="mirror dist/mogugi_<version>.exe and .zip")
    rel.add_argument("version", help="e.g. 0.5.5")
    rel.add_argument("--dist", default="dist")
    rel.set_defaults(func=cmd_release)

    put = sub.add_parser("put", help="upload one file to a key")
    put.add_argument("file")
    put.add_argument("key", help="path inside the bucket, e.g. img/logo.png")
    put.add_argument("--content-type")
    put.add_argument("--cache-control", default=SHORT)
    put.set_defaults(func=cmd_put)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
