#!/usr/bin/env python3
"""서귀포시 주차포털(API)로 서귀포 주차장 CSV 보강.

출처:
- https://parking.seogwipo.go.kr/parking/search
- https://parking.seogwipo.go.kr/parking/fee/info
- API: GET https://parking.seogwipo.go.kr/api/parking/realtime/list

요금안내 페이지 공통 규칙(참고):
- 회차 30분 이내 출차 시 요금면제
- 기본요금 1,000원 / 45분 초과 시 15분당 500원
- 1일 최대: 동지역 10,000 / 읍면 8,000 (대형 등은 조례·주차장별 별도)
"""

from __future__ import annotations

import csv
import json
import math
import re
import urllib.request
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "작업/주차장_csv_다운로드/제주특별자치도_서귀포시_주차장정보.csv"
OUT_DIR = ROOT / "작업/주차장_csv_다운로드"
OUT_CSV = OUT_DIR / "제주특별자치도_서귀포시_주차장정보_서귀포주차포털보강.csv"
OUT_JSON = OUT_DIR / "서귀포주차포털_매칭로그.json"
API_URL = "https://parking.seogwipo.go.kr/api/parking/realtime/list"

DAY_MAP = {
    "WEEK": ("평일운영시작시각", "평일운영종료시각"),
    "SAT": ("토요일운영시작시각", "토요일운영종료시각"),
    "HOLI": ("공휴일운영시작시각", "공휴일운영종료시각"),
    # SUN → 특기사항 / sgp 컬럼에만 (표준 CSV에 일요일 컬럼 없음)
}


def fetch_api() -> list[dict]:
    req = urllib.request.Request(
        API_URL,
        headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        payload = json.loads(res.read().decode("utf-8"))
    if not payload.get("result"):
        raise RuntimeError(payload.get("message") or "API failed")
    return payload["data"]


def norm_name(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"\([^)]*\)", "", s)
    s = re.sub(r"\s+", "", s)
    s = s.replace("공영", "")
    s = s.replace("주차빌딩", "주차장")
    s = s.replace("노외", "노외")
    return s


def tokens(s: str) -> set[str]:
    s = norm_name(s)
    # 한글 덩어리 + 숫자
    parts = re.findall(r"[가-힣]+|[0-9]+", s)
    stop = {"주차장", "노외"}
    return {p for p in parts if p not in stop and len(p) >= 1}


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def amount_by_day(lot: dict) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for a in lot.get("parkingAmountInfoList") or []:
        out[a.get("dayType") or ""] = a
    return out


def is_free_all_day(a: Optional[dict]) -> bool:
    if not a:
        return True
    st, en = a.get("startTm") or "", a.get("endTm") or ""
    # 00:00-00:00 은 유료시간 없음(무료)으로 해석
    if st == "00:00" and en == "00:00":
        return True
    return False


def fee_type(lot: dict) -> str:
    am = amount_by_day(lot)
    week = am.get("WEEK")
    if not week:
        return "무료"
    if is_free_all_day(week) and all(is_free_all_day(am.get(k)) for k in ("SAT", "SUN", "HOLI")):
        # 요금 숫자는 있어도 유료시간이 전부 없음
        if (week.get("dfltAmt") or "0") in ("0", "0.0", ""):
            return "무료"
    # 평일만 유료 / 주말 무료 → 혼합, 상시 유료 → 유료
    paid_days = [k for k, v in am.items() if v and not is_free_all_day(v)]
    if not paid_days:
        # 상시 00:00-23:59 유료
        if week and week.get("startTm") == "00:00" and week.get("endTm") in ("23:59", "24:00"):
            return "유료"
        return "혼합"
    if set(paid_days) >= {"WEEK", "SAT", "SUN", "HOLI"}:
        # 전부 유료 구간 있음
        if all(
            (am[k].get("startTm") == "00:00" and am[k].get("endTm") in ("23:59", "24:00"))
            for k in paid_days
            if k in am
        ):
            return "유료"
        return "혼합"
    return "혼합"


def paid_hours_text(lot: dict) -> str:
    am = amount_by_day(lot)
    labels = {"WEEK": "평일", "SAT": "토요일", "SUN": "일요일", "HOLI": "공휴일"}
    parts = []
    for k, lab in labels.items():
        a = am.get(k)
        if not a:
            continue
        if is_free_all_day(a):
            parts.append(f"{lab} 유료시간 없음(무료)")
        else:
            parts.append(f"{lab} 유료 {a.get('startTm')}-{a.get('endTm')}")
    note = "회차 " + str((am.get("WEEK") or {}).get("freeTm") or "30") + "분 이내 면제"
    return "유료운영시간: " + ", ".join(parts) + f" / {note}"


def score_match(row: dict, lot: dict) -> tuple[float, str]:
    """낮을수록 좋음. (score, reason)"""
    rn, ln = norm_name(row["주차장명"]), norm_name(lot["parkingName"])
    rt, lt = tokens(row["주차장명"]), tokens(lot["parkingName"])
    dist = 99999.0
    if row.get("위도") and row.get("경도") and lot.get("lat") and lot.get("lng"):
        try:
            dist = haversine_m(float(row["위도"]), float(row["경도"]), float(lot["lat"]), float(lot["lng"]))
        except ValueError:
            pass

    if rn == ln:
        return (dist * 0.01, "name_exact")
    if rn and ln and (rn in ln or ln in rn):
        # 포함 매칭도 좌표가 너무 멀면 제외
        if dist > 250:
            return (1e9, "no")
        return (10 + dist * 0.01, "name_contains")

    inter = rt & lt
    if len(inter) >= 2 and dist <= 200:
        return (50 + dist * 0.05 - 5 * len(inter), f"token+coord:{sorted(inter)}")
    if len(inter) >= 2 and dist <= 250:
        return (80 + dist * 0.1 - 5 * len(inter), f"token:{sorted(inter)}")
    if dist <= 60:
        return (100 + dist, "coord_only")
    return (1e9, "no")


def match_all(rows: list[dict], lots: list[dict]) -> dict[str, dict]:
    """csv 주차장관리번호 -> {lot, reason, dist, score}"""
    candidates: list[tuple[float, str, dict, dict, str]] = []
    for r in rows:
        for lot in lots:
            sc, reason = score_match(r, lot)
            if sc >= 1e8:
                continue
            dist = 99999.0
            if r.get("위도") and lot.get("lat"):
                try:
                    dist = haversine_m(float(r["위도"]), float(r["경도"]), float(lot["lat"]), float(lot["lng"]))
                except ValueError:
                    pass
            candidates.append((sc, r["주차장관리번호"], r, lot, reason))
    candidates.sort(key=lambda x: x[0])

    used_csv: set[str] = set()
    used_lot: set[int] = set()
    mapping: dict[str, dict] = {}
    for sc, mid, r, lot, reason in candidates:
        pid = lot["parkingId"]
        if mid in used_csv or pid in used_lot:
            continue
        # coord_only는 80m 초과면 스킵
        dist = 99999.0
        if r.get("위도") and lot.get("lat"):
            dist = haversine_m(float(r["위도"]), float(r["경도"]), float(lot["lat"]), float(lot["lng"]))
        if reason == "coord_only" and dist > 80:
            continue
        used_csv.add(mid)
        used_lot.add(pid)
        mapping[mid] = {
            "lot": lot,
            "reason": reason,
            "distance_m": round(dist, 1),
            "score": round(sc, 3),
        }
    return mapping


def apply_lot(row: dict, lot: dict) -> dict:
    out = dict(row)
    am = amount_by_day(lot)
    week = am.get("WEEK") or {}

    out["sgp_parking_id"] = lot.get("parkingId")
    out["sgp_parking_name"] = lot.get("parkingName")
    out["sgp_source_url"] = f"https://parking.seogwipo.go.kr/parking/search"
    out["sgp_fee_info_url"] = "https://parking.seogwipo.go.kr/parking/fee/info"
    out["sgp_lat"] = lot.get("lat")
    out["sgp_lng"] = lot.get("lng")
    out["sgp_cell_count"] = lot.get("cellCount")
    out["sgp_handicap_cell_count"] = lot.get("handicapCellCount")
    out["sgp_ev_charge_cell_count"] = lot.get("evChargeCellCount")
    out["sgp_period_ticket_amt"] = lot.get("periodTicketAmt")
    out["sgp_anyhour_run_yn"] = lot.get("anyhourRunYn")

    # 장애인 주차
    hc = lot.get("handicapCellCount")
    if hc is not None:
        out["장애인전용주차구역보유여부"] = "Y" if int(hc or 0) > 0 else "N"

    # 구획수
    if lot.get("cellCount"):
        out["주차구획수"] = lot.get("cellCount")

    # 요금
    ft = fee_type(lot)
    out["요금정보"] = ft
    if week:
        # 회차 freeTm / 기본·추가 단위는 포털 값 사용 (기존 CSV와 동일 패턴)
        free_tm = week.get("freeTm") or ""
        dflt_tm = week.get("dfltTm") or ""
        dflt_amt = week.get("dfltAmt") or ""
        intvl_tm = week.get("intvlTm") or ""
        intvl_amt = week.get("intvlAmt") or ""
        day_amt = week.get("dayParkingAmt") or ""
        # 표준데이터 관례: 기본시간/요금, 추가단위
        # 포털: freeTm=회차, dfltTm/dfltAmt=기본단위, intvl*=추가
        # 기존 CSV는 기본30/1000, 추가15/500 → dflt 쪽이 15/1000인 경우도 있어
        # 요금안내(회차30분 면제 + 기본 1000)와 맞추려면:
        #   주차기본시간=회차 후 기본 구간으로 보이도록 freeTm을 특기사항,
        #   숫자 필드는 포털 dflt/intvl 그대로 + day max
        out["주차기본시간"] = dflt_tm
        out["주차기본요금"] = dflt_amt
        out["추가단위시간"] = intvl_tm
        out["추가단위요금"] = intvl_amt
        out["1일주차권요금"] = day_amt
        out["월정기권요금"] = lot.get("periodTicketAmt") or week.get("periodTicketAmt") or ""
        out["sgp_free_tm"] = free_tm
        out["결제방법"] = out.get("결제방법") or "신용카드"

    # 유료 운영시간 → 요일 컬럼에는 '유료 구간'을 넣고, 개방은 특기사항에도 명시
    # (기존 CSV가 00:00-23:59로 개방만 넣어 유료시간과 혼동됨)
    for day, (c_start, c_end) in DAY_MAP.items():
        a = am.get(day)
        if not a:
            continue
        if is_free_all_day(a):
            # 유료 없음: 기존처럼 全日 표기 유지하되 특기사항으로 설명
            out[c_start] = out.get(c_start) or "00:00"
            out[c_end] = out.get(c_end) or "23:59"
        else:
            out[c_start] = a.get("startTm") or out.get(c_start)
            out[c_end] = a.get("endTm") or out.get(c_end)

    sun = am.get("SUN")
    if sun:
        out["sgp_sun_paid_start"] = "" if is_free_all_day(sun) else sun.get("startTm")
        out["sgp_sun_paid_end"] = "" if is_free_all_day(sun) else sun.get("endTm")

    paid_txt = paid_hours_text(lot)
    old_note = (row.get("특기사항") or "").strip()
    # 기존 유료운영시간 문구 제거 후 포털 문구로 교체
    old_note = re.sub(r"유료운영시간\([^)]*\)\s*이외는 무료\.?", "", old_note).strip(" .+")
    old_note = re.sub(r"유료운영시간:[^.]*", "", old_note).strip(" .+")
    pieces = [p for p in [paid_txt, old_note] if p]
    out["특기사항"] = " / ".join(pieces)

    # 도로명 비어 있고 포털에 지번형 roadName 있으면 보조
    if not (out.get("소재지도로명주소") or "").strip() and lot.get("roadName"):
        road = f"{lot.get('sidoName','')} {lot.get('sigunguName','')} {lot.get('roadName','')}".strip()
        if lot.get("buildingMainNo"):
            road = f"{road} {lot.get('buildingMainNo')}"
            if lot.get("buildingSubNo"):
                road = f"{road}-{lot.get('buildingSubNo')}"
        out["sgp_address_hint"] = road

    return out


def main() -> None:
    lots = fetch_api()
    with SRC.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
        fieldnames = list(rows[0].keys()) if rows else []

    mapping = match_all(rows, lots)
    extra_cols = [
        "sgp_match_status",
        "sgp_match_reason",
        "sgp_match_distance_m",
        "sgp_parking_id",
        "sgp_parking_name",
        "sgp_source_url",
        "sgp_fee_info_url",
        "sgp_lat",
        "sgp_lng",
        "sgp_cell_count",
        "sgp_handicap_cell_count",
        "sgp_ev_charge_cell_count",
        "sgp_period_ticket_amt",
        "sgp_anyhour_run_yn",
        "sgp_free_tm",
        "sgp_sun_paid_start",
        "sgp_sun_paid_end",
        "sgp_address_hint",
    ]
    out_fields = fieldnames + [c for c in extra_cols if c not in fieldnames]

    out_rows = []
    logs = []
    for r in rows:
        mid = r["주차장관리번호"]
        if mid in mapping:
            m = mapping[mid]
            enriched = apply_lot(r, m["lot"])
            enriched["sgp_match_status"] = "matched"
            enriched["sgp_match_reason"] = m["reason"]
            enriched["sgp_match_distance_m"] = m["distance_m"]
            logs.append(
                {
                    "csv_id": mid,
                    "csv_name": r["주차장명"],
                    "sgp_id": m["lot"]["parkingId"],
                    "sgp_name": m["lot"]["parkingName"],
                    "reason": m["reason"],
                    "distance_m": m["distance_m"],
                }
            )
        else:
            enriched = dict(r)
            enriched["sgp_match_status"] = "unmatched"
            # 포털에 없는 공영(대부분 무료)은 요금정보 유지
        out_rows.append(enriched)

    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=out_fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(out_rows)

    unmatched_portal = [
        {"parkingId": lot["parkingId"], "parkingName": lot["parkingName"]}
        for lot in lots
        if lot["parkingId"] not in {m["lot"]["parkingId"] for m in mapping.values()}
    ]
    OUT_JSON.write_text(
        json.dumps(
            {
                "api_url": API_URL,
                "portal_count": len(lots),
                "csv_count": len(rows),
                "matched": len(mapping),
                "matches": logs,
                "unmatched_portal": unmatched_portal,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"portal={len(lots)} csv={len(rows)} matched={len(mapping)}")
    print(f"OUT: {OUT_CSV}")
    print(f"LOG: {OUT_JSON}")
    for L in logs:
        print(f"  {L['csv_name']} ↔ {L['sgp_name']} ({L['reason']}, {L['distance_m']}m)")


if __name__ == "__main__":
    main()
