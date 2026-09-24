"""
Minimal S3 helpers for private chat attachment storage.

Files live in a private bucket. The API never exposes a public URL: the
message stores the object `key`, and a short-lived presigned GET URL is
minted per request for verified group members (see GroupAttachmentLinkView).
"""

import boto3
from django.conf import settings

_client = None


def get_s3_client():
    """Return a cached boto3 S3 client configured from Django settings."""
    global _client
    if _client is None:
        kwargs = {
            'aws_access_key_id': settings.AWS_ACCESS_KEY_ID,
            'aws_secret_access_key': settings.AWS_SECRET_ACCESS_KEY,
            'region_name': settings.AWS_S3_REGION_NAME,
        }
        if settings.AWS_S3_ENDPOINT_URL:
            kwargs['endpoint_url'] = settings.AWS_S3_ENDPOINT_URL
        _client = boto3.client('s3', **kwargs)
    return _client


def get_attachment_key(group_id: str, filename: str) -> str:
    """Build an S3 object key for a group-chat attachment."""
    from uuid import uuid4
    return f"chat-attachments/{group_id}/{uuid4().hex}/{filename}"


def attachment_key_prefix(group_id: str) -> str:
    """Prefix all attachment keys for a group share."""
    return f"chat-attachments/{group_id}/"


def upload_to_s3(content, key: str, content_type: str) -> None:
    """Put bytes (or a file-like body) into the private bucket."""
    client = get_s3_client()
    client.put_object(
        Bucket=settings.AWS_S3_BUCKET_NAME,
        Key=key,
        Body=content,
        ContentType=content_type,
    )


def presign_s3_url(key: str) -> str:
    """Return a short-lived presigned GET URL for a private object."""
    client = get_s3_client()
    return client.generate_presigned_url(
        ClientMethod='get_object',
        Params={'Bucket': settings.AWS_S3_BUCKET_NAME, 'Key': key},
        ExpiresIn=settings.ATTACHMENT_LINK_TTL_SECONDS,
    )