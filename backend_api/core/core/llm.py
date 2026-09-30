"""Shared DeepSeek helpers for the AI-generation endpoints.

These used to live in ``users.views``, which meant every other generator had to
either duplicate them or reach into a view module. Quiz generation ended up
with a private copy that had drifted: hardcoded model, no thinking toggle, no
token budget, and a bare 30s timeout. It then truncated mid-JSON and reported
"AI returned invalid JSON formatting" with nothing in the logs to explain it.

One implementation, imported by every generator, so the reliability settings
can't drift apart again.
"""

import json
import os
import re
import time

import requests

# Kept under Procfile's `gunicorn --timeout 90` (and Cloudflare's 100s origin
# cap) so a slow model or a retry storm fails as a clean HTTP error instead of
# an HTML error page the client can't parse.
AI_GEN_BUDGET_SECONDS = float(os.getenv('AI_GEN_BUDGET_SECONDS', '70'))

DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"


def _coerce_parsed(value):
    """The reasoning model sometimes wraps the object in a top-level array;
    unwrap to the first dict so schema checks still pass."""
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                return item
    return None


def safe_json_parse(text):
    """Try to parse JSON from text, with fallback to regex extraction."""
    try:
        return _coerce_parsed(json.loads(text))
    except (json.JSONDecodeError, TypeError):
        # Try to extract a JSON object using regex. This is a salvage path for
        # text that is *almost* JSON (a stray fence or preamble), not a way to
        # paper over a truncated response -- callers still have to check
        # finish_reason and see a real dict here.
        match = re.search(r"\{[\s\S]*\}", text or "")
        if match:
            try:
                return _coerce_parsed(json.loads(match.group()))
            except json.JSONDecodeError:
                pass
    return None


def deepseek_chat_completion(payload, api_key, max_retries=3, deadline_seconds=None):
    """POST to DeepSeek and retry transient failures.

    When deadline_seconds is given, the whole call (every attempt plus backoff)
    is bounded by that wall-clock budget. Without it a retry storm can run
    120s x 3 attempts plus Retry-After sleeps, which outlives any front-end
    timeout and gets the request killed mid-flight.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    started = time.monotonic()

    def remaining():
        if deadline_seconds is None:
            return None
        return deadline_seconds - (time.monotonic() - started)

    def budget_exhausted(reserve=5):
        left = remaining()
        return left is not None and left <= reserve

    def clamp_wait(wait):
        """Never sleep past the deadline."""
        left = remaining()
        if left is None:
            return wait
        return max(0.0, min(wait, left - 1))

    last_response = None
    for attempt in range(1, max_retries + 1):
        if budget_exhausted():
            print(f"[DeepSeek] deadline of {deadline_seconds}s exhausted before attempt {attempt}")
            return last_response

        left = remaining()
        read_timeout = 120 if left is None else max(5.0, min(120.0, left))
        try:
            last_response = requests.post(
                DEEPSEEK_URL,
                headers=headers,
                json=payload,
                # (connect, read): never hang on connect, cap the read so a
                # stalled generation still returns inside the budget.
                timeout=(10, read_timeout),
            )
        except requests.exceptions.RequestException as e:
            print(f"[DeepSeek] attempt {attempt} request error: {e}")
            last_response = None
            if attempt < max_retries and not budget_exhausted():
                time.sleep(clamp_wait(2 * attempt))
            continue

        if last_response.status_code == 200:
            return last_response

        print(f"[DeepSeek] attempt {attempt} status {last_response.status_code}: {last_response.text[:300]}")
        if attempt < max_retries and not budget_exhausted():
            # Honor DeepSeek's suggested wait time (rate limits) when present.
            wait = 2 * attempt
            retry_after = last_response.headers.get('Retry-After')
            if retry_after:
                try:
                    wait = max(wait, float(retry_after))
                except (TypeError, ValueError):
                    pass
            else:
                match = re.search(r"Please try again in\s+([\d.]+)\s*s", last_response.text)
                if match:
                    wait = max(wait, float(match.group(1)))
            time.sleep(clamp_wait(wait))
    return last_response
