#!/usr/bin/env python3
"""Build a shareable macOS ZIP from the reviewed public release allowlist."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath


ROOT_NAME = "KYNEM"
ALLOWLIST = "RELEASE-FILES.txt"
SECRET_RE = re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}")
LOCAL_PATH_RE = re.compile(r"(?<![\w])/(?:Users|home)/[^\s\"'<>`),;]+")
PERSONAL_PATH_RE = re.compile(rb"/(?:Users|home)/(?!me(?:/|\b))[A-Za-z0-9._-]+/")
DENIED_PARTS = {".git", "runtime", "secrets", "node_modules", "dist", "coverage"}
DENIED_NAMES = {".npmrc", ".netrc", ".pypirc", ".mcp.json", "PROJECT.md", "MORNING-CHECKPOINT.md"}
LICENSE_NAMES = {"LICENSE", "LICENCE", "COPYING", "NOTICE"}
SANITIZED_JSON = "demo/client-proof/client-proof-evidence.json"


def sanitize_bytes(root: Path, relative: str, data: bytes) -> bytes:
    if not (relative.endswith(".md") or relative == SANITIZED_JSON):
        if PERSONAL_PATH_RE.search(data):
            raise RuntimeError(f"possible personal machine path in release file: {relative}")
        return data
    text = data.decode("utf-8")

    def replace(match: re.Match[str]) -> str:
        absolute = match.group(0)
        root_text = root.as_posix()
        if absolute == root_text:
            return "."
        if absolute.startswith(root_text + "/"):
            return absolute[len(root_text) + 1 :]
        parts = absolute.split("/", 3)
        return "<HOME>" + (f"/{parts[3]}" if len(parts) == 4 else "")

    if relative == SANITIZED_JSON:
        def walk(value: object) -> object:
            if isinstance(value, str):
                return LOCAL_PATH_RE.sub(replace, value)
            if isinstance(value, list):
                return [walk(item) for item in value]
            if isinstance(value, dict):
                return {key: walk(item) for key, item in value.items()}
            return value

        text = json.dumps(walk(json.loads(text)), ensure_ascii=False, indent=2) + "\n"
    else:
        text = LOCAL_PATH_RE.sub(replace, text)
    result = text.encode("utf-8")
    if PERSONAL_PATH_RE.search(result):
        raise RuntimeError(f"personal machine path remains after sanitizing: {relative}")
    return result


def release_files(root: Path) -> list[str]:
    files: list[str] = []
    for raw in (root / ALLOWLIST).read_text(encoding="utf-8").splitlines():
        value = raw.strip()
        if not value or value.startswith("#"):
            continue
        path = PurePosixPath(value)
        if path.is_absolute() or ".." in path.parts or path.as_posix() != value:
            raise RuntimeError(f"invalid release allowlist entry: {value}")
        if any(part in DENIED_PARTS for part in path.parts) or path.name in DENIED_NAMES:
            raise RuntimeError(f"private/runtime path is in release allowlist: {value}")
        files.append(value)
    if not files or len(files) != len(set(files)):
        raise RuntimeError("release allowlist is empty or contains duplicate paths")
    return sorted(files)


def add_file(archive: zipfile.ZipFile, source: Path, archive_name: str, repo_root: Path) -> None:
    if source.is_symlink():
        resolved = source.resolve(strict=True)
        try:
            resolved.relative_to(repo_root.resolve())
        except ValueError as exc:
            raise RuntimeError(f"symlink escapes the release root: {source}") from exc
        info = zipfile.ZipInfo(archive_name)
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, os.readlink(source))
        return
    if not source.is_file():
        raise RuntimeError(f"allowlisted file is missing or not regular: {source}")
    data = source.read_bytes()
    if "/node_modules/" not in f"/{archive_name}" and SECRET_RE.search(data):
        raise RuntimeError(f"possible credential material in release file: {source}")
    info = zipfile.ZipInfo(archive_name)
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | (stat.S_IMODE(source.stat().st_mode) or 0o644)) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, data)


def check_dependency_licenses(node_modules: Path) -> None:
    packages = sorted(node_modules.glob("package.json"))
    packages.extend(sorted(node_modules.glob("@*/*/package.json")))
    packages.extend(sorted(node_modules.glob("**/node_modules/*/package.json")))
    packages.extend(sorted(node_modules.glob("**/node_modules/@*/*/package.json")))
    if not packages:
        raise RuntimeError("production npm install produced no packages")
    missing: list[str] = []
    for package_json in sorted(set(packages)):
        package_dir = package_json.parent
        try:
            metadata = json.loads(package_json.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"invalid dependency package metadata: {package_json}") from exc
        license_value = metadata.get("license") or metadata.get("licenses")
        has_license_file = any((package_dir / name).is_file() for name in LICENSE_NAMES)
        if not license_value and not has_license_file:
            missing.append(str(package_dir.relative_to(node_modules)))
        # The full dependency tree, including its package.json and any shipped
        # license texts, is retained in the archive.
    if missing:
        raise RuntimeError(f"dependency package metadata lacks a license field: {missing}")


def safe_tree_entries(directory: Path) -> list[Path]:
    found: list[Path] = []
    base = directory.resolve()
    for current, dirnames, filenames in os.walk(directory, followlinks=False):
        current_path = Path(current)
        for name in list(dirnames):
            item = current_path / name
            if item.is_symlink():
                target = item.resolve(strict=True)
                try:
                    target.relative_to(base)
                except ValueError as exc:
                    raise RuntimeError(f"dependency symlink escapes node_modules: {item}") from exc
                found.append(item)
        for name in filenames:
            item = current_path / name
            if item.is_symlink():
                target = item.resolve(strict=True)
                try:
                    target.relative_to(base)
                except ValueError as exc:
                    raise RuntimeError(f"dependency symlink escapes node_modules: {item}") from exc
                found.append(item)
            if item.is_file():
                found.append(item)
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="new absolute ZIP path")
    args = parser.parse_args()
    if not args.output.is_absolute():
        raise RuntimeError("--output must be an absolute path")
    output = args.output.expanduser().absolute()
    if output.exists():
        raise RuntimeError(f"refusing to overwrite existing output: {output}")
    script_root = Path(__file__).resolve().parent.parent
    root = Path(subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=script_root, check=True, capture_output=True, text=True).stdout.strip()).resolve()
    allowlisted = release_files(root)
    required = {"LICENSE", "PROVENANCE.md", "package.json", "package-lock.json", "Install KYNEM.command", "docs/INSTALL.it.md"}
    missing = sorted(required - set(allowlisted))
    if missing:
        raise RuntimeError(f"release allowlist is missing installer files: {missing}")
    if not any(path.startswith("codex-plugin/") for path in allowlisted):
        raise RuntimeError("release allowlist must include codex-plugin files")

    node = subprocess.run(["node", "--version"], check=True, capture_output=True, text=True).stdout.strip()
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", node)
    if not match or int(match.group(1)) < 24:
        raise RuntimeError(f"packaging requires Node.js 24 or newer; found {node or 'unknown'}")
    npm = shutil.which("npm")
    if not npm:
        raise RuntimeError("npm is required to assemble production dependencies")

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="kynem-package-") as temporary:
        stage = Path(temporary) / ROOT_NAME
        stage.mkdir()
        for relative in allowlisted:
            source = root / Path(*PurePosixPath(relative).parts)
            if source.is_symlink():
                resolved = source.resolve(strict=True)
                try:
                    resolved.relative_to(root)
                except ValueError as exc:
                    raise RuntimeError(f"allowlisted symlink escapes the source tree: {relative}") from exc
                raise RuntimeError(f"symlink is not supported in release sources: {relative}")
            destination = stage / Path(*PurePosixPath(relative).parts)
            if not source.is_file():
                raise RuntimeError(f"allowlisted source is missing or not regular: {relative}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            data = source.read_bytes()
            if SECRET_RE.search(data):
                raise RuntimeError(f"possible credential material in release file: {relative}")
            if relative.endswith(".md") or relative == SANITIZED_JSON:
                data = sanitize_bytes(root, relative, data)
            elif PERSONAL_PATH_RE.search(data):
                raise RuntimeError(f"possible personal machine path in release file: {relative}")
            destination.write_bytes(data)
            shutil.copystat(source, destination)

        dist = root / "dist"
        if not dist.is_dir():
            raise RuntimeError("dist/ is missing; build the project before packaging")
        shutil.copytree(dist, stage / "dist", symlinks=True)

        # Isolate npm's install in the stage so the developer checkout is untouched.
        subprocess.run([npm, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=stage, check=True)
        deps = stage / "node_modules"
        safe_tree_entries(stage)
        check_dependency_licenses(deps)

        entries = sorted(path for path in stage.rglob("*") if path.is_file() or path.is_symlink())
        forbidden_roots = {".git", "runtime", "secrets", "coverage"}
        if any(path.relative_to(stage).parts[0] in forbidden_roots for path in entries):
            raise RuntimeError("staged installer contains a denied/private directory")
        try:
            with output.open("xb") as reserved:
                with zipfile.ZipFile(reserved, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    for path in entries:
                        relative = path.relative_to(stage).as_posix()
                        add_file(archive, path, f"{ROOT_NAME}/{relative}", stage)
        except Exception:
            output.unlink(missing_ok=True)
            raise
    print(f"Created {output} ({len(entries)} files; production dependencies only)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
