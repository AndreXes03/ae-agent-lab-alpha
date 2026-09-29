#!/usr/bin/env python3
"""Create a tracked source ZIP without local runtime data or machine paths."""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


EXCLUDED_COMPONENTS = {".git", "node_modules", "dist", "runtime", "secrets"}
EXCLUDED_NAMES = {"PROJECT.md", "MORNING-CHECKPOINT.md", "PUBLICATION-REVIEW.md", "ALPHA-CHECKPOINT.md", "PUBLICATION-STATUS.md", "NATIVE-RECOVERY.md", "RECORDING-SETUP.md", "RECORDING-SHOTLIST.md", "RELEASE-DRAFT.md", "ALPHA-RELEASE-CHECKLIST.md", "CLEAN-INSTALL.md", ".npmrc", ".pypirc", ".netrc", "id_rsa", "id_ed25519"}
SANITIZED_JSON = "demo/client-proof/client-proof-evidence.json"
MANIFEST_NAME = "PACKAGE-MANIFEST.json"
ARCHIVE_ROOT = "ae-agent-lab"
LOCAL_PATH_RE = re.compile(r"(?<![\w])/(?:Users|home)/[^\s\"'<>`),;]+")


def git(root: Path, *args: str) -> str:
    try:
        result = subprocess.run(
            ["git", *args], cwd=root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        detail = getattr(exc, "stderr", b"")
        if isinstance(detail, bytes):
            detail = detail.decode("utf-8", "replace")
        raise RuntimeError(f"git {' '.join(args)} failed: {detail or exc}") from exc
    return result.stdout.decode("utf-8", "surrogateescape")


def tracked_paths(root: Path) -> list[str]:
    raw = subprocess.run(
        ["git", "ls-files", "-z"], cwd=root, check=True, stdout=subprocess.PIPE
    ).stdout
    return [os.fsdecode(entry) for entry in raw.split(b"\0") if entry]


def excluded(relative: str) -> bool:
    path = PurePosixPath(relative)
    if any(part in EXCLUDED_COMPONENTS for part in path.parts):
        return True
    if relative.startswith("demo/runs/"):
        return True
    name = path.name
    if name.startswith(".env") or name in EXCLUDED_NAMES:
        return True
    if name.endswith((".pem", ".key", ".p12", ".pfx")):
        return True
    return False


def archive_reference(root: Path, absolute: str) -> str:
    root_text = root.as_posix()
    if absolute == root_text:
        return "."
    if absolute.startswith(root_text + "/"):
        relative = absolute[len(root_text) + 1 :]
        if relative.startswith("demo/runs/"):
            name = PurePosixPath(relative).name
            if name == "project.aep":
                return "demo/warm-glow-heavy-grain.aep"
            if (root / "demo/client-proof" / name).is_file():
                return f"demo/client-proof/{name}"
            return "[local run artifact excluded from archive]"
        return relative
    # Retain a portable subpath only after dropping the local account name.
    tail = absolute.split("/", 3)
    return "<HOME>" + (f"/{tail[3]}" if len(tail) == 4 else "")


def sanitize_text(root: Path, text: str) -> str:
    return LOCAL_PATH_RE.sub(lambda match: archive_reference(root, match.group(0)), text)


def sanitize_curated_json(root: Path, data: object) -> object:
    if isinstance(data, str):
        return sanitize_text(root, data)
    if isinstance(data, list):
        return [sanitize_curated_json(root, item) for item in data]
    if isinstance(data, dict):
        return {key: sanitize_curated_json(root, value) for key, value in data.items()}
    return data


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        help="new ZIP path (must be absolute and must not already exist)",
    )
    return parser


def main() -> int:
    args = make_parser().parse_args()
    script_root = Path(__file__).resolve().parent.parent
    root = Path(git(script_root, "rev-parse", "--show-toplevel").strip()).resolve()
    output = args.output if args.output is not None else root.parent / "ae-agent-lab-source.zip"
    if args.output is not None and not output.is_absolute():
        print("--output must be an absolute path", file=sys.stderr)
        return 2
    output = output.expanduser().absolute()
    if output.exists():
        print(f"Refusing to overwrite existing output: {output}", file=sys.stderr)
        return 2

    commit = git(root, "rev-parse", "HEAD").strip()
    dirty = bool(git(root, "status", "--porcelain"))
    entries: dict[str, tuple[bytes, int]] = {}
    sanitized: list[str] = []
    for relative in tracked_paths(root):
        normalized = PurePosixPath(relative).as_posix()
        if excluded(normalized) or normalized == MANIFEST_NAME:
            continue
        source = root / Path(*PurePosixPath(normalized).parts)
        if source.is_symlink():
            raise RuntimeError(f"tracked symlink is not packaged: {normalized}")
        if not source.exists():
            continue  # A tracked deletion remains reflected by git_dirty.
        source_stat = source.stat()
        if not stat.S_ISREG(source_stat.st_mode):
            continue
        resolved = source.resolve()
        try:
            resolved.relative_to(root)
        except ValueError:
            raise RuntimeError(f"tracked path resolves outside the repository: {normalized}")
        data = source.read_bytes()
        if normalized.endswith(".md") or normalized == SANITIZED_JSON:
            if normalized == SANITIZED_JSON:
                parsed = json.loads(data.decode("utf-8"))
                data = (json.dumps(
                    sanitize_curated_json(root, parsed), ensure_ascii=False, indent=2
                ) + "\n").encode("utf-8")
            else:
                data = sanitize_text(root, data.decode("utf-8")).encode("utf-8")
            sanitized.append(normalized)
        entries[normalized] = (data, stat.S_IMODE(source_stat.st_mode))

    manifest = {
        "format": "tracked working-tree source snapshot",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "gitCommit": commit,
        "gitDirty": dirty,
        "includedFileCount": len(entries) + 1,
        "excluded": [
            "runtime/", "node_modules/", "dist/", ".git/", "demo/runs/",
            "secrets/", ".env*", ".npmrc", ".pypirc", ".netrc", "private-key files",
        ],
        "pathNormalization": {
            "files": sanitized,
            "scope": "Markdown files and demo/client-proof/client-proof-evidence.json only",
            "rules": [
                "Repository absolute paths become archive-relative paths.",
                "Home paths outside the repository replace the account name with <HOME>.",
                "Excluded local run artifacts are labeled as excluded; known curated proof files map to demo/client-proof/.",
            ],
            "rawFilesOnDiskChanged": False,
            "binaryAepMetadataScrubbed": False,
        },
    }
    entries[MANIFEST_NAME] = (
        (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        0o644,
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        with output.open("xb") as reserved:
            with zipfile.ZipFile(reserved, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for name, (data, mode) in sorted(entries.items()):
                    info = zipfile.ZipInfo(f"{ARCHIVE_ROOT}/{name}")
                    info.create_system = 3  # Unix mode is stored in external_attr.
                    info.external_attr = (stat.S_IFREG | mode) << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, data)
    except FileExistsError:
        print(f"Refusing to overwrite existing output: {output}", file=sys.stderr)
        return 2
    except Exception:
        output.unlink(missing_ok=True)
        raise

    print(f"Created {output} ({len(entries)} files; gitDirty={str(dirty).lower()})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
