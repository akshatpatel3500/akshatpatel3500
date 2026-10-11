#!/usr/bin/env python3
"""Build dist/policy-grounded-agent-prototype.zip = agent_prototype.zip + design_memo.md."""
import io
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
PROJECT_FILES = ["README.md", "SPEC.md", "run.py", "run.sh"]
PROJECT_GLOBS = ["agent/*.py", "data/*.*", "data/variants/*", "tests/*.py"]
FIXED_TIME = (2026, 10, 11, 0, 0, 0)  # reproducible archives


def add(zf, arcname, data, executable=False):
    info = zipfile.ZipInfo(arcname, FIXED_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (0o755 if executable else 0o644) << 16
    zf.writestr(info, data)


def build_project_zip():
    paths = [ROOT / p for p in PROJECT_FILES]
    for pattern in PROJECT_GLOBS:
        paths += sorted(ROOT.glob(pattern))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for p in paths:
            add(zf, p.relative_to(ROOT).as_posix(), p.read_bytes(), executable=p.suffix == ".sh")
    return buf.getvalue()


def main():
    DIST.mkdir(exist_ok=True)
    inner = build_project_zip()
    (DIST / "agent_prototype.zip").write_bytes(inner)
    out = DIST / "policy-grounded-agent-prototype.zip"
    with zipfile.ZipFile(out, "w") as zf:
        add(zf, "agent_prototype.zip", inner)
        add(zf, "design_memo.md", (ROOT / "design_memo.md").read_bytes())
    print(out)


if __name__ == "__main__":
    main()
