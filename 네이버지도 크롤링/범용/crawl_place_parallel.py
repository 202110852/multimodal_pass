#!/usr/bin/env python3
"""CSV → crawl_place_pilot 을 워커 3개(기본)로 쪼개 병렬 실행 후 결과 병합.

각 워커는 서로 다른 out-dir(_shard0..)에 쓰고, 끝나면 --out-dir 로 합친다.
같은 폴더에 동시 write 하지 않음.

예시:
  python3 "네이버지도 크롤링/범용/crawl_place_parallel.py" --csv downtown_stores.csv
  python3 "네이버지도 크롤링/범용/crawl_place_parallel.py" --csv downtown_stores.csv --out-dir downtown --workers 3
  python3 "네이버지도 크롤링/범용/crawl_place_parallel.py" --csv downtown_stores.csv --merge-only
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PILOT = ROOT / "crawl_place_pilot.py"
DEFAULT_WORKERS = 3


def count_csv_rows(csv_path: Path) -> int:
    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        return sum(1 for _ in csv.DictReader(f))


def shard_ranges(n: int, workers: int) -> list[tuple[int, int]]:
    """(offset, limit) 목록. 나머지를 앞쪽 워커에 1개씩."""
    if workers < 1:
        raise ValueError("workers >= 1")
    if n <= 0:
        return [(0, 0)] * workers
    base, rem = divmod(n, workers)
    out: list[tuple[int, int]] = []
    off = 0
    for i in range(workers):
        lim = base + (1 if i < rem else 0)
        out.append((off, lim))
        off += lim
    return out


def row_id(row: dict) -> str:
    return (row.get("contentsid") or row.get("원본_id") or row.get("id") or "").strip()


def merge_csvs(paths: list[Path], dest: Path) -> int:
    rows: list[dict] = []
    seen: dict[str, int] = {}
    for p in paths:
        if not p.exists():
            continue
        with p.open(encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                k = row_id(r)
                if k and k in seen:
                    rows[seen[k]] = r
                else:
                    if k:
                        seen[k] = len(rows)
                    rows.append(r)
    if not rows:
        return 0
    fields: list[str] = []
    field_seen: set[str] = set()
    for r in rows:
        for k in r:
            if k not in field_seen:
                field_seen.add(k)
                fields.append(k)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})
    return len(rows)


def merge_jsons(paths: list[Path], dest: Path) -> int:
    rows: list[dict] = []
    seen: dict[str, int] = {}
    for p in paths:
        if not p.exists():
            continue
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            continue
        for r in data:
            if not isinstance(r, dict):
                continue
            k = row_id(r)
            if k and k in seen:
                rows[seen[k]] = r
            else:
                if k:
                    seen[k] = len(rows)
                rows.append(r)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(rows)


def merge_done(paths: list[Path], dest: Path) -> int:
    ids: list[str] = []
    seen: set[str] = set()
    for p in paths:
        if not p.exists():
            continue
        for ln in p.read_text(encoding="utf-8").splitlines():
            rid = ln.strip()
            if rid and rid not in seen:
                seen.add(rid)
                ids.append(rid)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("\n".join(ids) + ("\n" if ids else ""), encoding="utf-8")
    return len(ids)


def merge_logs(paths: list[Path], dest: Path) -> int:
    n = 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", encoding="utf-8") as out:
        for p in paths:
            if not p.exists():
                continue
            text = p.read_text(encoding="utf-8")
            if not text:
                continue
            out.write(text)
            if not text.endswith("\n"):
                out.write("\n")
            n += sum(1 for ln in text.splitlines() if ln.strip())
    return n


def merge_crawled(shard_dirs: list[Path], dest_dir: Path) -> int:
    dest_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    for sd in shard_dirs:
        src = sd / "crawled"
        if not src.is_dir():
            continue
        for f in src.iterdir():
            if f.is_file() and f.suffix == ".txt":
                shutil.copy2(f, dest_dir / f.name)
                n += 1
    return n


def seed_done_from_parent(parent_done: Path, shard_done: Path) -> None:
    """부모 done_ids 가 있으면 샤드에 복사해 resume 스킵에 쓴다."""
    if not parent_done.exists():
        return
    shard_done.parent.mkdir(parents=True, exist_ok=True)
    if shard_done.exists():
        # 샤드 자체 resume + 부모 합집합
        parent = {
            ln.strip()
            for ln in parent_done.read_text(encoding="utf-8").splitlines()
            if ln.strip()
        }
        local = {
            ln.strip()
            for ln in shard_done.read_text(encoding="utf-8").splitlines()
            if ln.strip()
        }
        merged = sorted(parent | local)
        shard_done.write_text("\n".join(merged) + ("\n" if merged else ""), encoding="utf-8")
    else:
        shutil.copy2(parent_done, shard_done)


def pipe_output(proc: subprocess.Popen[str], prefix: str) -> int:
    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(f"{prefix}{line}")
        sys.stdout.flush()
    return proc.wait()


def run_workers(
    *,
    csv_path: Path,
    out_dir: Path,
    workers: int,
    headed: bool,
    no_resume: bool,
) -> list[int]:
    total = count_csv_rows(csv_path)
    ranges = shard_ranges(total, workers)
    print(
        f"CSV {csv_path.name}: {total}행 → 워커 {workers}개 "
        f"{[(o, l) for o, l in ranges]} → {out_dir}",
        flush=True,
    )

    procs: list[tuple[int, subprocess.Popen[str], Path]] = []
    threads: list[threading.Thread] = []
    codes: dict[int, int] = {}

    for i, (offset, limit) in enumerate(ranges):
        shard_dir = out_dir / f"_shard{i}"
        shard_dir.mkdir(parents=True, exist_ok=True)
        if no_resume:
            for name in (
                "enriched.csv",
                "enriched.json",
                "match_log.jsonl",
                "done_ids.txt",
            ):
                p = shard_dir / name
                if p.exists():
                    p.unlink()
            crawled = shard_dir / "crawled"
            if crawled.is_dir():
                shutil.rmtree(crawled)
        else:
            seed_done_from_parent(out_dir / "done_ids.txt", shard_dir / "done_ids.txt")

        if limit == 0:
            print(f"[w{i}] 할당 0건 — 스킵", flush=True)
            codes[i] = 0
            continue

        cmd = [
            sys.executable,
            str(PILOT),
            "--csv",
            str(csv_path),
            "--out-dir",
            str(shard_dir),
            "--offset",
            str(offset),
            "--limit",
            str(limit),
        ]
        if headed:
            cmd.append("--headed")
        if no_resume:
            cmd.append("--no-resume")

        print(f"[w{i}] start offset={offset} limit={limit} → {shard_dir.name}", flush=True)
        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        procs.append((i, proc, shard_dir))

        def _reader(idx: int = i, p: subprocess.Popen[str] = proc) -> None:
            codes[idx] = pipe_output(p, f"[w{idx}] ")

        t = threading.Thread(target=_reader, daemon=True)
        threads.append(t)
        t.start()
        # 브라우저 동시 기동 완화
        time.sleep(1.5)

    for t in threads:
        t.join()

    for i, proc, _ in procs:
        if i not in codes:
            codes[i] = proc.wait()

    return [codes.get(i, 0) for i in range(workers)]


def do_merge(out_dir: Path, workers: int) -> None:
    shard_dirs = [out_dir / f"_shard{i}" for i in range(workers)]
    # 부모 기존 + 샤드(같은 id면 뒤쪽=샤드가 덮어씀)
    csv_paths = []
    if (out_dir / "enriched.csv").exists():
        csv_paths.append(out_dir / "enriched.csv")
    csv_paths.extend(d / "enriched.csv" for d in shard_dirs)

    json_paths = []
    if (out_dir / "enriched.json").exists():
        json_paths.append(out_dir / "enriched.json")
    json_paths.extend(d / "enriched.json" for d in shard_dirs)

    done_paths = []
    if (out_dir / "done_ids.txt").exists():
        done_paths.append(out_dir / "done_ids.txt")
    done_paths.extend(d / "done_ids.txt" for d in shard_dirs)

    parent_log = out_dir / "match_log.jsonl"
    shard_logs = [
        d / "match_log.jsonl"
        for d in shard_dirs
        if (d / "match_log.jsonl").exists()
    ]
    if shard_logs:
        # 순차 실행 로그가 있으면 한 번만 백업 후, 부모 로그는 샤드만으로 재작성
        if parent_log.exists() and not (out_dir / "match_log.pre_parallel.jsonl").exists():
            shutil.copy2(parent_log, out_dir / "match_log.pre_parallel.jsonl")
        tmp_log = out_dir / "match_log.jsonl.tmp"
        n_log = merge_logs(shard_logs, tmp_log)
        tmp_log.replace(parent_log)
    else:
        n_log = (
            sum(
                1
                for ln in parent_log.read_text(encoding="utf-8").splitlines()
                if ln.strip()
            )
            if parent_log.exists()
            else 0
        )

    n_csv = merge_csvs(csv_paths, out_dir / "enriched.csv")
    n_json = merge_jsons(json_paths, out_dir / "enriched.json")
    n_done = merge_done(done_paths, out_dir / "done_ids.txt")
    n_txt = merge_crawled(shard_dirs, out_dir / "crawled")

    print(
        f"병합 완료 → {out_dir}\n"
        f"  enriched.csv {n_csv}행 / enriched.json {n_json}건 / "
        f"done_ids {n_done} / crawled txt {n_txt} / match_log {n_log}줄",
        flush=True,
    )


def main() -> None:
    ap = argparse.ArgumentParser(
        description="CSV를 워커 3개(기본)로 쪼개 crawl_place_pilot 병렬 실행"
    )
    ap.add_argument("--csv", type=str, required=True, help="입력 CSV")
    ap.add_argument(
        "--out-dir",
        type=str,
        default=None,
        help="최종 출력 폴더 (기본: 범용/downtown)",
    )
    ap.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"워커 수 (기본 {DEFAULT_WORKERS})",
    )
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--no-resume", action="store_true")
    ap.add_argument(
        "--merge-only",
        action="store_true",
        help="이미 돌린 _shard* 만 병합",
    )
    args = ap.parse_args()

    if not PILOT.exists():
        raise SystemExit(f"크롤러 없음: {PILOT}")

    csv_path = Path(args.csv).expanduser().resolve()
    if not csv_path.exists():
        raise SystemExit(f"CSV 없음: {csv_path}")

    workers = max(1, int(args.workers))
    out_dir = (
        Path(args.out_dir).expanduser().resolve()
        if args.out_dir
        else ROOT / "downtown"
    )
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.merge_only:
        do_merge(out_dir, workers)
        return

    codes = run_workers(
        csv_path=csv_path,
        out_dir=out_dir,
        workers=workers,
        headed=args.headed,
        no_resume=args.no_resume,
    )
    do_merge(out_dir, workers)

    failed = [i for i, c in enumerate(codes) if c != 0]
    if failed:
        print(
            f"\n일부 워커 실패: {[(i, codes[i]) for i in failed]} "
            f"(샤드 결과는 가능한 만큼 병합됨)",
            flush=True,
        )
        raise SystemExit(1)

    print("\n전체 워커 성공", flush=True)
    print(f"CSV: {out_dir / 'enriched.csv'}", flush=True)
    print(f"JSON: {out_dir / 'enriched.json'}", flush=True)
    print(f"샤드: {[out_dir / f'_shard{i}' for i in range(workers)]}", flush=True)


if __name__ == "__main__":
    main()
