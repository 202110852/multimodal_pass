#!/usr/bin/env python3
"""제주시 유료 주차장 크롤.

1) 모두의주차장 시도
2) 실패 시 네이버지도 폴백
3) 결과는 모두의주차장 정보 탭 양식 컬럼으로 저장
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from collections import Counter
from pathlib import Path

from playwright.sync_api import sync_playwright

import crawl_modu_first as pipe
import crawl_parking_pilot as naver_core
from modu_client import MODU_FORM_FIELDS

ROOT = Path(__file__).resolve().parent
WORK_DIR = Path("/Users/jpark/project/api_visitkorea/작업/주차장_csv_다운로드")
SRC_CSV = WORK_DIR / "제주특별자치도_제주시_주차장정보.csv"
# 결과물은 원본과 같은 작업 폴더에 저장 (서귀포 보강 CSV와 동일 위치)
OUT_DIR = WORK_DIR
RESULT_CSV = OUT_DIR / "제주특별자치도_제주시_주차장정보_모두의주차장보강.csv"
RESULT_JSON = OUT_DIR / "제주특별자치도_제주시_주차장정보_모두의주차장보강.json"
LOG_PATH = OUT_DIR / "제주시_모두의주차장_매칭로그.jsonl"
DONE_IDS = OUT_DIR / "제주시_모두의주차장_done_ids.txt"

META_COLS = [
    "주차장관리번호",
    "원본_주차장명",
    "원본_도로명",
    "원본_지번",
    "원본_위도",
    "원본_경도",
    "원본_요금정보",
    "match_status",
    "match_source",
    "match_step",
    "match_message",
    "modu_seq",
    "modu_name",
    "matched_site_url",
]
TAIL_COLS = ["tried_queries"]
FIELDNAMES = META_COLS + MODU_FORM_FIELDS + TAIL_COLS


def pick_paid_rows(limit: int | None = None, offset: int = 0) -> list[dict]:
    with SRC_CSV.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    paid = []
    for r in rows:
        name = (r.get("주차장명") or "").strip()
        lat = (r.get("위도") or "").strip()
        lng = (r.get("경도") or "").strip()
        fee = (r.get("요금정보") or "").strip()
        if fee != "유료":
            continue
        if not name or not lat or not lng:
            continue
        paid.append(r)
    paid = paid[offset:]
    if limit is not None:
        paid = paid[:limit]
    return paid


def load_done() -> set[str]:
    if not DONE_IDS.exists():
        return set()
    return {
        ln.strip()
        for ln in DONE_IDS.read_text(encoding="utf-8").splitlines()
        if ln.strip()
    }


def append_done(mid: str) -> None:
    with DONE_IDS.open("a", encoding="utf-8") as f:
        f.write(mid + "\n")


def rewrite_outputs(results: list[dict]) -> None:
    RESULT_JSON.write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if not results:
        return
    with RESULT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
        w.writeheader()
        for r in results:
            w.writerow({k: r.get(k, "") for k in FIELDNAMES})


def apply_naver_fallback(page, row: dict, mr: pipe.MatchResult) -> pipe.MatchResult:
    try:
        nmr = naver_core.match_one(page, row)
    except Exception as e:
        mr.message += f" / naver예외:{e}"
        return mr

    flat = naver_core.flatten_row(row, nmr)
    form = pipe.form_from_naver(flat)
    ok = nmr.status in ("success", "needs_confirm")
    if not ok:
        mr.message += f" / naver실패:{nmr.status}/{nmr.step}"
        return mr

    mr.status = nmr.status
    mr.source = "naver"
    mr.step = f"modu_fail→naver:{nmr.step}"
    mr.message = f"modu실패 후 네이버 매칭 / {nmr.message}"
    mr.form = form
    mr.meta["naver_url"] = flat.get("matched_site_url") or flat.get("naver_map_url") or ""
    mr.meta["modu_name"] = flat.get("naver_name") or ""
    return mr


def main() -> None:
    ap = argparse.ArgumentParser(description="제주시 유료: 모두의주차장→네이버, 모두의 양식 저장")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--no-resume", action="store_true")
    ap.add_argument(
        "--no-naver-fallback",
        action="store_true",
        help="네이버 폴백 끄기 (기본은 실패 시 네이버 시도)",
    )
    ap.add_argument("--region", default="제주시")
    args = ap.parse_args()

    naver_core.REGION = args.region
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.no_resume:
        for p in (RESULT_CSV, RESULT_JSON, LOG_PATH, DONE_IDS):
            if p.exists():
                p.unlink()

    rows = pick_paid_rows(args.limit, args.offset)
    done = set() if args.no_resume else load_done()
    results: list[dict] = []
    if RESULT_CSV.exists() and not args.no_resume:
        with RESULT_CSV.open(encoding="utf-8-sig", newline="") as f:
            results = list(csv.DictReader(f))
    for r in results:
        mid = (r.get("주차장관리번호") or "").strip()
        if mid:
            done.add(mid)

    todo = [r for r in rows if (r.get("주차장관리번호") or "") not in done]
    use_naver = not args.no_naver_fallback
    print(
        f"제주시 유료 {len(rows)} / 스킵 {len(rows) - len(todo)} / 이번 {len(todo)}"
        f" (modu→{'naver' if use_naver else 'modu만'})",
        flush=True,
    )

    if not todo:
        print("할 일 없음", flush=True)
        return

    browser = context = page = pw = None
    if use_naver:
        pw = sync_playwright().start()
        browser = pw.chromium.launch(headless=not args.headed)
        context = browser.new_context(
            locale="ko-KR",
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()

    try:
        for i, row in enumerate(todo, 1):
            mid = row.get("주차장관리번호") or ""
            print(f"\n[{i}/{len(todo)}] {row['주차장명']}", flush=True)
            try:
                mr = pipe.match_modu(row, region=args.region)
            except Exception as e:
                mr = pipe.MatchResult(
                    status="fail",
                    step="exception",
                    message=str(e),
                )

            if mr.status == "fail" and use_naver and page is not None:
                print("  → modu 실패, 네이버 시도…", flush=True)
                mr = apply_naver_fallback(page, row, mr)

            flat = pipe.flatten_row(row, mr)
            results.append(flat)
            with LOG_PATH.open("a", encoding="utf-8") as lf:
                lf.write(json.dumps(pipe.log_dict(row, mr), ensure_ascii=False) + "\n")
            if mid:
                append_done(mid)
            rewrite_outputs(results)

            hours = flat.get("운영 시간") or flat.get("운영시간_평일") or ""
            fee = flat.get("현장 요금") or ""
            print(
                f"  → {flat['match_status']} / {flat['match_source']} / {flat['match_step']}"
                f" / 운영={hours} / 요금={fee} / 주소={flat.get('주소','')[:24]}",
                flush=True,
            )
            time.sleep(0.35)
    finally:
        if browser is not None:
            browser.close()
        if pw is not None:
            pw.stop()

    c = Counter((r.get("match_status"), r.get("match_source")) for r in results)
    print("\n=== 요약 ===", flush=True)
    for k, v in c.items():
        print(f"  {k}: {v}", flush=True)
    print(f"CSV: {RESULT_CSV}", flush=True)


if __name__ == "__main__":
    main()
