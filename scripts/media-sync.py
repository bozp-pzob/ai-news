#!/usr/bin/env python3
"""
AI News Media Sync - Downloads media files from manifest on gh-pages.

This script fetches media manifests from GitHub Pages and downloads the files
to a local directory. It's designed to run on a VPS via systemd timer.

Files are downloaded to a flat folder structure with human-readable names:
  {sanitized-name}_{hash8}.{ext}
  Example: screen-recording-20250906_085b9cc1.mp4

Usage:
    python media-sync.py sync              # Download media from manifests
    python media-sync.py setup             # Install systemd service and timer
    python media-sync.py status            # Show timer status and recent logs
    python media-sync.py sync --dry-run    # Show what would be downloaded
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen, urlretrieve, Request
from urllib.error import URLError, HTTPError
import time

# === Configuration ===
REPO = "M3-org/ai-news"
BRANCH = "gh-pages"
SOURCES = ["elizaos", "hyperfy"]
BASE_URL = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}"
INSTALL_DIR = Path(os.environ.get("INSTALL_DIR", Path.home() / "ai-news-media"))
SERVICE_NAME = "ai-news-media-sync"
MIN_FREE_SPACE_MB = int(os.environ.get("MIN_FREE_SPACE_MB", 500))  # Default 500MB

# === Rate Limiting Configuration (based on DiscordChatExporter best practices) ===
MAX_RETRY_ATTEMPTS = 8
MAX_RETRY_AFTER_SECONDS = 60  # Cap retry-after (Discord sometimes returns absurdly high values)
BASE_BACKOFF_SECONDS = 1  # For exponential backoff: 2^attempt + 1
USER_AGENT = os.environ.get("DISCORD_USER_AGENT", "DiscordBot (media-sync, 1.0)")


def normalize_discord_url(url: str) -> str:
    """
    Normalize Discord CDN URL for consistent hashing.
    Strips expiring signature params (ex, is, hm) so same file gets same hash.
    """
    try:
        from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
        parsed = urlparse(url)
        if parsed.netloc in ('cdn.discordapp.com', 'media.discordapp.net'):
            query = parse_qs(parsed.query)
            # Remove expiring params
            for param in ('ex', 'is', 'hm'):
                query.pop(param, None)
            # Rebuild URL without expiring params
            new_query = urlencode(query, doseq=True) if query else ''
            return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment))
    except:
        pass
    return url


def make_request_with_retry(url: str, headers: dict = None, max_retries: int = MAX_RETRY_ATTEMPTS):
    """
    Make HTTP request with exponential backoff retry logic.
    Respects Discord's rate limit headers and caps retry-after at MAX_RETRY_AFTER_SECONDS.

    Returns: (response_data, response_headers) tuple
    Raises: Exception after max retries exhausted
    """
    if headers is None:
        headers = {}

    # Always include User-Agent
    if "User-Agent" not in headers:
        headers["User-Agent"] = USER_AGENT

    last_error = None

    for attempt in range(max_retries):
        try:
            req = Request(url, headers=headers)
            with urlopen(req, timeout=60) as resp:
                # Read advisory rate limit headers for preemptive waiting
                remaining = resp.headers.get("X-RateLimit-Remaining")
                reset_after = resp.headers.get("X-RateLimit-Reset-After")

                data = resp.read()

                # If we're about to hit the limit, wait preemptively
                if remaining is not None and reset_after is not None:
                    try:
                        if int(remaining) <= 0:
                            delay = min(float(reset_after) + 1, MAX_RETRY_AFTER_SECONDS)
                            log(f"Rate limit approaching, waiting {delay:.1f}s...", "!")
                            time.sleep(delay)
                    except (ValueError, TypeError):
                        pass

                return data, dict(resp.headers)

        except HTTPError as e:
            last_error = e

            if e.code == 429:
                # Rate limited - use Retry-After header, capped at max
                retry_after = e.headers.get('Retry-After', '5')
                try:
                    delay = min(float(retry_after) + 1, MAX_RETRY_AFTER_SECONDS)
                except (ValueError, TypeError):
                    delay = MAX_RETRY_AFTER_SECONDS

                log(f"Rate limited (attempt {attempt + 1}/{max_retries}), waiting {delay:.1f}s...", "!")
                time.sleep(delay)
                continue

            elif e.code >= 500 or e.code == 408:
                # Server error or timeout - use exponential backoff
                delay = (2 ** attempt) + BASE_BACKOFF_SECONDS
                log(f"Server error {e.code} (attempt {attempt + 1}/{max_retries}), retrying in {delay}s...", "!")
                time.sleep(delay)
                continue
            else:
                # Non-retryable error (4xx except 429, 408)
                raise

        except (URLError, TimeoutError, OSError) as e:
            last_error = e
            # Network error - use exponential backoff
            delay = (2 ** attempt) + BASE_BACKOFF_SECONDS
            log(f"Network error (attempt {attempt + 1}/{max_retries}), retrying in {delay}s...", "!")
            time.sleep(delay)
            continue

    # Max retries exhausted
    raise last_error or Exception(f"Max retries ({max_retries}) exhausted for {url}")


def download_file_with_retry(url: str, dest: Path, max_retries: int = MAX_RETRY_ATTEMPTS) -> bool:
    """
    Download file with exponential backoff retry logic.
    Returns True on success, False on failure.
    """
    headers = {"User-Agent": USER_AGENT}

    for attempt in range(max_retries):
        try:
            req = Request(url, headers=headers)
            with urlopen(req, timeout=120) as resp:
                with open(dest, 'wb') as out_file:
                    out_file.write(resp.read())
            return True

        except HTTPError as e:
            if e.code == 429:
                retry_after = e.headers.get('Retry-After', '5')
                try:
                    delay = min(float(retry_after) + 1, MAX_RETRY_AFTER_SECONDS)
                except (ValueError, TypeError):
                    delay = MAX_RETRY_AFTER_SECONDS

                log(f"Download rate limited (attempt {attempt + 1}/{max_retries}), Retry-After={retry_after}, waiting {delay:.1f}s...", "!")
                time.sleep(delay)
                continue
            elif e.code == 404:
                log(f"Download failed: HTTP 404 (file not found or URL expired)", "x")
                return False

            elif e.code >= 500 or e.code == 408:
                delay = (2 ** attempt) + BASE_BACKOFF_SECONDS
                log(f"Download server error {e.code} (attempt {attempt + 1}/{max_retries}), retrying in {delay}s...", "!")
                time.sleep(delay)
                continue
            else:
                log(f"Download failed: HTTP {e.code}", "x")
                return False

        except (URLError, TimeoutError, OSError) as e:
            delay = (2 ** attempt) + BASE_BACKOFF_SECONDS
            log(f"Download network error (attempt {attempt + 1}/{max_retries}), retrying in {delay}s...", "!")
            time.sleep(delay)
            continue

    log(f"Download failed after {max_retries} retries", "x")
    return False


def log(msg: str, symbol: str = "*"):
    """Print timestamped log message."""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {symbol} {msg}")


def format_bytes(size_bytes: int) -> str:
    """Format bytes as human-readable string."""
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if abs(size_bytes) < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"


def get_disk_space(path: Path) -> tuple[int, int, int]:
    """Get disk space for path. Returns (total, used, free) in bytes."""
    # Ensure path exists for statvfs
    path.mkdir(parents=True, exist_ok=True)
    usage = shutil.disk_usage(path)
    return usage.total, usage.used, usage.free


def check_disk_space(path: Path, min_free_mb: int) -> tuple[bool, int]:
    """Check if enough disk space is available. Returns (ok, free_bytes)."""
    _, _, free = get_disk_space(path)
    min_free_bytes = min_free_mb * 1024 * 1024
    return free >= min_free_bytes, free


def cmd_sync(args):
    """Download media files from all source manifests."""
    log("Media Sync Started", "=")

    min_free_mb = args.min_free if hasattr(args, 'min_free') else MIN_FREE_SPACE_MB
    stats = {"downloaded": 0, "skipped": 0, "failed": 0, "disk_stopped": False}
    total_download_size = 0
    files_to_download = 0

    # Initial disk space check
    ok, free_bytes = check_disk_space(INSTALL_DIR, min_free_mb)
    log(f"Disk space: {format_bytes(free_bytes)} free (min: {min_free_mb} MB)")

    if not ok and not args.dry_run:
        log(f"Insufficient disk space! Need at least {min_free_mb} MB free", "!")
        return 1

    for source in SOURCES:
        manifest_url = f"{BASE_URL}/{source}/media-manifest.json"
        output_dir = INSTALL_DIR / f"{source}-media"

        log(f"Processing {source}", "-")

        # Fetch manifest
        try:
            with urlopen(manifest_url, timeout=30) as resp:
                manifest = json.loads(resp.read().decode())
        except (URLError, HTTPError) as e:
            log(f"No manifest for {source}: {e}", "!")
            continue

        files = manifest.get("files", [])
        log(f"Found {len(files)} files in manifest")

        # Download each file
        for entry in files:
            url = entry["url"]
            filename = entry["unique_name"]
            file_size = entry.get("size", 0)

            # Flat folder structure (all files in one directory)
            dest = output_dir / filename

            # Skip if already exists
            if dest.exists():
                if args.verbose:
                    log(f"Skipped (exists): {filename}", "o")
                stats["skipped"] += 1
                continue

            if args.dry_run:
                log(f"Would download: {filename} ({format_bytes(file_size)})", "o")
                total_download_size += file_size
                files_to_download += 1
                continue

            # Check disk space before each download
            ok, free_bytes = check_disk_space(INSTALL_DIR, min_free_mb)
            if not ok:
                log(f"Stopping: disk space low ({format_bytes(free_bytes)} free)", "!")
                stats["disk_stopped"] = True
                break

            # Download with retry logic
            dest.parent.mkdir(parents=True, exist_ok=True)
            if download_file_with_retry(url, dest):
                log(f"Downloaded: {filename}", "+")
                stats["downloaded"] += 1
            else:
                log(f"Failed: {filename}", "x")
                stats["failed"] += 1

        if stats["disk_stopped"]:
            break

    # Summary
    if args.dry_run:
        log(
            f"Dry Run: {files_to_download} files to download "
            f"(~{format_bytes(total_download_size)}), {stats['skipped']} already exist",
            "="
        )
    else:
        msg = (
            f"Sync Complete: {stats['downloaded']} downloaded, "
            f"{stats['skipped']} skipped, {stats['failed']} failed"
        )
        if stats["disk_stopped"]:
            msg += " (stopped: low disk space)"
        log(msg, "=")

    if stats["disk_stopped"]:
        return 2  # Special exit code for disk space issue
    return 0 if stats["failed"] == 0 else 1


def cmd_setup(args):
    """Install systemd service and timer."""
    log("Installing systemd service and timer...")

    script_path = Path(__file__).resolve()
    user = os.environ.get("USER", "root")

    service_content = f"""[Unit]
Description=AI News Media Sync
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/flock -n /tmp/{SERVICE_NAME}.lock /usr/bin/timeout 30m {sys.executable} {script_path} sync
User={user}
WorkingDirectory={INSTALL_DIR}
Environment=INSTALL_DIR={INSTALL_DIR}

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths={INSTALL_DIR}
PrivateTmp=true
"""

    timer_content = f"""[Unit]
Description=AI News Media Sync Timer
Documentation=https://github.com/{REPO}

[Timer]
# Run at 01:30 UTC daily (after GH Actions completes ~01:00 UTC)
OnCalendar=*-*-* 01:30:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
"""

    service_path = f"/etc/systemd/system/{SERVICE_NAME}.service"
    timer_path = f"/etc/systemd/system/{SERVICE_NAME}.timer"

    try:
        # Ensure install directory exists
        INSTALL_DIR.mkdir(parents=True, exist_ok=True)

        # Write service file
        subprocess.run(
            ["sudo", "tee", service_path],
            input=service_content.encode(),
            stdout=subprocess.DEVNULL,
            check=True
        )
        log(f"Created {service_path}", "+")

        # Write timer file
        subprocess.run(
            ["sudo", "tee", timer_path],
            input=timer_content.encode(),
            stdout=subprocess.DEVNULL,
            check=True
        )
        log(f"Created {timer_path}", "+")

        # Reload and enable
        subprocess.run(["sudo", "systemctl", "daemon-reload"], check=True)
        subprocess.run(
            ["sudo", "systemctl", "enable", "--now", f"{SERVICE_NAME}.timer"],
            check=True
        )

        log("Installed and enabled!", "+")
        print()
        cmd_status(args)
        return 0

    except subprocess.CalledProcessError as e:
        log(f"Setup failed: {e}", "x")
        return 1


def cmd_status(args):
    """Show timer status and recent logs."""
    # Disk space info
    print("=== Disk Space ===")
    total, used, free = get_disk_space(INSTALL_DIR)
    percent_used = (used / total) * 100 if total > 0 else 0
    print(f"Install dir: {INSTALL_DIR}")
    print(f"Total: {format_bytes(total)}")
    print(f"Used:  {format_bytes(used)} ({percent_used:.1f}%)")
    print(f"Free:  {format_bytes(free)}")
    print(f"Min:   {MIN_FREE_SPACE_MB} MB")

    # Media directory sizes
    print("\n=== Media Sizes ===")
    for source in SOURCES:
        media_dir = INSTALL_DIR / f"{source}-media"
        if media_dir.exists():
            size = sum(f.stat().st_size for f in media_dir.rglob("*") if f.is_file())
            file_count = sum(1 for f in media_dir.rglob("*") if f.is_file())
            print(f"{source}: {format_bytes(size)} ({file_count} files)")
        else:
            print(f"{source}: (no files yet)")

    print("\n=== Timer Status ===")
    subprocess.run(
        ["systemctl", "list-timers", f"{SERVICE_NAME}.timer", "--no-pager"],
        check=False
    )

    print("\n=== Recent Logs ===")
    subprocess.run(
        ["journalctl", "-u", f"{SERVICE_NAME}.service", "--no-pager", "-n", "20"],
        check=False
    )
    return 0


def cmd_uninstall(args):
    """Remove systemd service and timer."""
    log("Removing systemd service and timer...")

    service_path = f"/etc/systemd/system/{SERVICE_NAME}.service"
    timer_path = f"/etc/systemd/system/{SERVICE_NAME}.timer"

    try:
        # Stop and disable timer
        subprocess.run(
            ["sudo", "systemctl", "disable", "--now", f"{SERVICE_NAME}.timer"],
            check=False
        )

        # Remove files
        subprocess.run(["sudo", "rm", "-f", service_path], check=True)
        subprocess.run(["sudo", "rm", "-f", timer_path], check=True)

        # Reload systemd
        subprocess.run(["sudo", "systemctl", "daemon-reload"], check=True)

        log("Uninstalled successfully", "+")
        return 0

    except subprocess.CalledProcessError as e:
        log(f"Uninstall failed: {e}", "x")
        return 1


def cmd_refresh(args):
    """Refresh expired Discord URLs and download files."""
    token = os.environ.get("DISCORD_TOKEN")
    if not token:
        log("DISCORD_TOKEN environment variable required", "!")
        return 1

    manifest_path = Path(args.manifest)
    if not manifest_path.exists():
        log(f"Manifest not found: {manifest_path}", "!")
        return 1

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    log(f"Loading manifest: {manifest_path}", "=")
    with open(manifest_path) as f:
        manifest = json.load(f)

    files = manifest.get("files", [])

    # Filter by user if specified
    if args.user:
        files = [f for f in files if f.get("user_id") == args.user]
        log(f"Filtered to user {args.user}: {len(files)} files")

    # Filter by media type if specified
    if args.type:
        files = [f for f in files if f.get("media_type") == args.type]
        log(f"Filtered to type {args.type}: {len(files)} files")

    if not files:
        log("No files match filters", "!")
        return 0

    # Group by channel_id/message_id to minimize API calls
    messages = {}
    for f in files:
        key = (f["channel_id"], f["message_id"])
        if key not in messages:
            messages[key] = []
        messages[key].append(f)

    log(f"Found {len(files)} files in {len(messages)} messages")

    stats = {"downloaded": 0, "failed": 0, "skipped": 0}

    for (channel_id, message_id), msg_files in messages.items():
        # Check if all files already exist (flat folder structure)
        all_exist = all(
            (output_dir / f.get("unique_name", f["filename"])).exists()
            for f in msg_files
        )
        if all_exist and not args.force:
            stats["skipped"] += len(msg_files)
            if args.verbose:
                log(f"Skipped (exists): {msg_files[0]['filename']}", "o")
            continue

        if args.dry_run:
            for f in msg_files:
                log(f"Would download: {f['filename']}", "o")
            continue

        # Fetch fresh URLs from Discord API with retry logic
        # Use ?around= endpoint instead of direct message fetch (works around 403 permission issues)
        try:
            api_url = f"https://discord.com/api/v10/channels/{channel_id}/messages?around={message_id}&limit=1"
            data, headers = make_request_with_retry(
                api_url,
                headers={"Authorization": f"Bot {token}"}
            )
            messages_resp = json.loads(data.decode())

            # Find our target message in the response
            msg_data = None
            for msg in messages_resp:
                if msg["id"] == message_id:
                    msg_data = msg
                    break
            if not msg_data:
                log(f"Message not found: {message_id}", "x")
                stats["failed"] += len(msg_files)
                continue
        except Exception as e:
            log(f"API error for message {message_id}: {e}", "x")
            stats["failed"] += len(msg_files)
            continue

        # Check for Message Content Intent issue
        # If content is empty/None but there are attachments, the bot may lack the intent
        content = msg_data.get("content")
        has_attachments = len(msg_data.get("attachments", [])) > 0 or len(msg_data.get("embeds", [])) > 0
        if has_attachments and (content is None or content == ""):
            # Track this but don't warn on every message - we'll check at the end
            if not hasattr(cmd_refresh, '_empty_content_count'):
                cmd_refresh._empty_content_count = 0
                cmd_refresh._total_msg_count = 0
            cmd_refresh._empty_content_count += 1
            cmd_refresh._total_msg_count += 1

        # Build URL map from fresh data
        fresh_urls = {}
        for att in msg_data.get("attachments", []):
            fresh_urls[att["filename"]] = att["url"]
        for embed in msg_data.get("embeds", []):
            if embed.get("image"):
                fresh_urls[f"embed-image-{message_id}"] = embed["image"]["url"]
            if embed.get("thumbnail"):
                fresh_urls[f"embed-thumbnail-{message_id}"] = embed["thumbnail"]["url"]
            if embed.get("video"):
                fresh_urls[f"embed-video-{message_id}"] = embed["video"]["url"]

        # Download each file
        for f in msg_files:
            # Flat folder structure
            output_dir.mkdir(parents=True, exist_ok=True)
            dest = output_dir / f.get("unique_name", f["filename"])

            if dest.exists() and not args.force:
                stats["skipped"] += 1
                continue

            # Find fresh URL
            fresh_url = fresh_urls.get(f["filename"])
            if not fresh_url:
                # Try partial match for embeds
                for key, url in fresh_urls.items():
                    if key in f["filename"]:
                        fresh_url = url
                        break

            if not fresh_url:
                if args.verbose:
                    log(f"Available keys: {list(fresh_urls.keys())}", "?")
                    log(f"Looking for: {f['filename']}", "?")
                log(f"No fresh URL for: {f['filename']}", "x")
                stats["failed"] += 1
                continue

            if args.verbose:
                log(f"Fresh URL obtained for: {f['filename']}", "+")

            # Download with retry logic (handles rate limits, exponential backoff)
            # Try proxy_url as fallback for external embed media
            downloaded = download_file_with_retry(fresh_url, dest)
            if not downloaded and f.get("proxy_url"):
                log(f"Trying proxy URL for: {f['filename']}", "!")
                downloaded = download_file_with_retry(f["proxy_url"], dest)

            if downloaded:
                log(f"Downloaded: {f['filename']}", "+")
                stats["downloaded"] += 1
            else:
                stats["failed"] += 1

            # Small delay between downloads to be respectful
            time.sleep(0.1)

    log(
        f"Complete: {stats['downloaded']} downloaded, "
        f"{stats['skipped']} skipped, {stats['failed']} failed",
        "="
    )

    # Check for Message Content Intent issue
    # If ALL messages with media have empty content, the bot likely lacks the intent
    empty_count = getattr(cmd_refresh, '_empty_content_count', 0)
    total_count = getattr(cmd_refresh, '_total_msg_count', 0)
    if total_count > 0 and empty_count == total_count:
        log(
            "Warning: All fetched messages have empty content. "
            "The bot may lack the Message Content Intent privilege. "
            "See: https://discord.com/developers/docs/topics/gateway#message-content-intent",
            "!"
        )
    # Reset counters for next run
    cmd_refresh._empty_content_count = 0
    cmd_refresh._total_msg_count = 0

    return 0 if stats["failed"] == 0 else 1


def main():
    parser = argparse.ArgumentParser(
        description="AI News Media Sync - Download media from gh-pages manifests",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
Examples:
  %(prog)s sync              Download new media files
  %(prog)s sync --dry-run    Preview what would be downloaded
  %(prog)s sync --min-free 1000  Stop if less than 1GB free
  %(prog)s setup             Install systemd timer (run once)
  %(prog)s status            Check disk space, timer, and logs
  %(prog)s uninstall         Remove systemd timer

  %(prog)s refresh manifest.json -o ./media     Refresh URLs and download
  %(prog)s refresh manifest.json --user 12345   Download specific user's files
  %(prog)s refresh manifest.json --type attachment  Only direct uploads

Environment:
  INSTALL_DIR        Installation directory (default: ~/ai-news-media)
  MIN_FREE_SPACE_MB  Minimum free disk space in MB (default: 500)
  DISCORD_TOKEN      Bot token for refreshing expired URLs

Exit codes:
  0  Success
  1  Download failures or insufficient disk space at start
  2  Stopped mid-sync due to low disk space

Current config:
  Repository:    {REPO}
  Branch:        {BRANCH}
  Sources:       {', '.join(SOURCES)}
  Install dir:   {INSTALL_DIR}
  Min free:      {MIN_FREE_SPACE_MB} MB
"""
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # sync command
    sync_parser = subparsers.add_parser("sync", help="Download media from manifests")
    sync_parser.add_argument(
        "--dry-run", action="store_true", help="Show what would be downloaded"
    )
    sync_parser.add_argument(
        "-v", "--verbose", action="store_true", help="Show skipped files"
    )
    sync_parser.add_argument(
        "--min-free", type=int, default=MIN_FREE_SPACE_MB,
        help=f"Minimum free disk space in MB (default: {MIN_FREE_SPACE_MB})"
    )
    sync_parser.set_defaults(func=cmd_sync)

    # setup command
    setup_parser = subparsers.add_parser(
        "setup", help="Install systemd service and timer"
    )
    setup_parser.set_defaults(func=cmd_setup)

    # status command
    status_parser = subparsers.add_parser(
        "status", help="Show timer status and logs"
    )
    status_parser.set_defaults(func=cmd_status)

    # uninstall command
    uninstall_parser = subparsers.add_parser(
        "uninstall", help="Remove systemd service and timer"
    )
    uninstall_parser.set_defaults(func=cmd_uninstall)

    # refresh command
    refresh_parser = subparsers.add_parser(
        "refresh", help="Refresh expired URLs via Discord API and download"
    )
    refresh_parser.add_argument(
        "manifest", help="Path to manifest JSON file"
    )
    refresh_parser.add_argument(
        "-o", "--output", default="./media",
        help="Output directory for downloads (default: ./media)"
    )
    refresh_parser.add_argument(
        "--user", help="Filter by user ID"
    )
    refresh_parser.add_argument(
        "--type", choices=["attachment", "embed_image", "embed_thumbnail", "embed_video", "sticker"],
        help="Filter by media type"
    )
    refresh_parser.add_argument(
        "--dry-run", action="store_true", help="Show what would be downloaded"
    )
    refresh_parser.add_argument(
        "--force", action="store_true", help="Re-download even if file exists"
    )
    refresh_parser.add_argument(
        "-v", "--verbose", action="store_true", help="Show skipped files"
    )
    refresh_parser.set_defaults(func=cmd_refresh)

    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
