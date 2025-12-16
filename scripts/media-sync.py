#!/usr/bin/env python3
"""
AI News Media Sync - Downloads media files from manifest on gh-pages.

This script fetches media manifests from GitHub Pages and downloads the files
to a local directory. It's designed to run on a VPS via systemd timer.

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
from urllib.request import urlopen, urlretrieve
from urllib.error import URLError, HTTPError

# === Configuration ===
REPO = "M3-org/ai-news"
BRANCH = "gh-pages"
SOURCES = ["elizaos", "hyperfy"]
BASE_URL = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}"
INSTALL_DIR = Path(os.environ.get("INSTALL_DIR", Path.home() / "ai-news-media"))
SERVICE_NAME = "ai-news-media-sync"
MIN_FREE_SPACE_MB = int(os.environ.get("MIN_FREE_SPACE_MB", 500))  # Default 500MB


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
            file_type = entry["type"]
            file_size = entry.get("size", 0)

            # Organize by type: images/, videos/, etc.
            dest = output_dir / f"{file_type}s" / filename

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

            # Download
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                urlretrieve(url, dest)
                log(f"Downloaded: {filename}", "+")
                stats["downloaded"] += 1
            except Exception as e:
                log(f"Failed: {filename} - {e}", "x")
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

Environment:
  INSTALL_DIR        Installation directory (default: ~/ai-news-media)
  MIN_FREE_SPACE_MB  Minimum free disk space in MB (default: 500)

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

    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
