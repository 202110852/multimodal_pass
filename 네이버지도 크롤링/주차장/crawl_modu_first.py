#!/usr/bin/env python3
"""주차장 CSV 보강: 1) 모두의주차장 → 2) 실패 시 네이버 → 3) 모두의주차장 양식 저장."""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

import modu_client as modu
from modu_client import (
    MATCH_DIST_M,
    MODU_FORM_FIELDS,
    NEAR_DIST_M,
    ModuPin,
    ModuPlace,
    address_similar,
    build_queries,
    detail_url,
    empty_modu_form,
    fetch_parking_detail,
    fetch_pins_near,
    format_onsite_fee,
    haversine_m,
    is_side_poi,
    map_url,
    name_similar,
    search_places,
)


@dataclass
class MatchResult:
    status: str  # success | needs_confirm | fail
    step: str
    message: str
    source: str = ""  # modu | naver | ""
    place: Optional[ModuPlace] = None
    pin: Optional[ModuPin] = None
    form: dict[str, str] = field(default_factory=empty_modu_form)
    meta: dict[str, Any] = field(default_factory=dict)
    tried_queries: list[str] = field(default_factory=list)
    all_candidates: list[dict] = field(default_factory=list)


def _place_to_dict(p: ModuPlace) -> dict:
    return {
        "name": p.name,
        "address": p.address,
        "lat": p.lat,
        "lng": p.lng,
        "query": p.query,
    }


def _apply_detail(mr: MatchResult, seq: int, pin: Optional[ModuPin] = None) -> MatchResult:
    try:
        detail = fetch_parking_detail(seq)
    except Exception as e:
        mr.message += f" / 상세오류:{e}"
        if pin:
            # 핀만이라도 채움
            form = empty_modu_form()
            form["현장 요금"] = format_onsite_fee(pin.calc_price)
            form["추가정보"] = ";".join(pin.options or [])
            mr.form = form
            mr.meta.update({"modu_seq": seq, "modu_name": pin.name, "modu_url": detail_url(seq)})
        return mr

    form = detail.get("form") or empty_modu_form()
    # SSR에 현장요금 없으면 핀 calcPrice 보강
    if not form.get("현장 요금") and pin:
        form["현장 요금"] = format_onsite_fee(pin.calc_price)
    if not form.get("추가정보") and pin and pin.options:
        form["추가정보"] = ";".join(pin.options)
    if not form.get("주소") and mr.place and mr.place.address:
        form["주소"] = mr.place.address

    mr.form = form
    mr.meta.update(
        {
            "modu_seq": seq,
            "modu_name": detail.get("name") or (pin.name if pin else ""),
            "modu_url": detail.get("url") or detail_url(seq),
            "modu_modify_date": detail.get("modify_date", ""),
            "modu_detail_ok": detail.get("raw_ok"),
        }
    )
    if detail.get("raw_ok"):
        mr.message += " / 상세OK"
    else:
        mr.message += " / 상세부분"
    return mr


def match_modu(row: dict, region: str = "제주시") -> MatchResult:
    """모두의주차장만으로 매칭 + 상세(정보 탭) 수집."""
    name = (row.get("주차장명") or "").strip()
    road = (row.get("소재지도로명주소") or "").strip()
    jibun = (row.get("소재지지번주소") or "").strip()
    src_lat = float(row["위도"])
    src_lng = float(row["경도"])

    queries = build_queries(row, region)
    tried: list[str] = []
    candidates: list[ModuPlace] = []
    seen: set[tuple[str, str]] = set()

    for q in queries:
        tried.append(q)
        try:
            places = search_places(q)
        except Exception:
            continue
        for p in places:
            if is_side_poi(p.name):
                continue
            key = (p.name, p.address)
            if key in seen:
                continue
            seen.add(key)
            candidates.append(p)
            ok, how = address_similar(road, jibun, p.address)
            if ok and p.lat is not None and p.lng is not None:
                dist = haversine_m(src_lat, src_lng, p.lat, p.lng)
                if dist <= NEAR_DIST_M or how.startswith("exact"):
                    status = (
                        "success"
                        if dist <= MATCH_DIST_M or how.startswith("exact")
                        else "needs_confirm"
                    )
                    mr = MatchResult(
                        status=status,
                        step=f"modu_search_address:{how}",
                        message=f"검색 주소매칭 dist={dist:.1f}m",
                        source="modu",
                        place=p,
                        tried_queries=tried,
                        all_candidates=[_place_to_dict(c) for c in candidates],
                    )
                    return _enrich_pin_and_detail(row, mr, src_lat, src_lng)
        time.sleep(0.12)

    best_place: Optional[ModuPlace] = None
    best_score = 1e18
    best_raw_dist = 1e18
    for p in candidates:
        if p.lat is None or p.lng is None:
            continue
        d = haversine_m(src_lat, src_lng, p.lat, p.lng)
        score = d - (40 if name_similar(name, p.name) else 0)
        if score < best_score:
            best_score = score
            best_place = p
            best_raw_dist = d

    if best_place is not None and best_raw_dist <= NEAR_DIST_M:
        mr = MatchResult(
            status="success" if best_raw_dist <= MATCH_DIST_M else "needs_confirm",
            step="modu_search_coord" if best_raw_dist <= MATCH_DIST_M else "modu_search_coord_near",
            message=f"검색 좌표근접 dist={best_raw_dist:.1f}m",
            source="modu",
            place=best_place,
            tried_queries=tried,
            all_candidates=[_place_to_dict(c) for c in candidates],
        )
        return _enrich_pin_and_detail(row, mr, src_lat, src_lng)

    try:
        pins = fetch_pins_near(src_lat, src_lng)
    except Exception as e:
        return MatchResult(
            status="fail",
            step="modu_pins_error",
            message=str(e),
            tried_queries=tried,
            all_candidates=[_place_to_dict(c) for c in candidates],
        )

    pin, dist, reason = modu.pick_best_pin(
        pins, src_name=name, src_lat=src_lat, src_lng=src_lng
    )
    if pin and dist <= NEAR_DIST_M:
        mr = MatchResult(
            status="success" if dist <= MATCH_DIST_M else "needs_confirm",
            step=f"modu_pins:{reason}",
            message=f"좌표 핀매칭 dist={dist:.1f}m seq={pin.seq}",
            source="modu",
            pin=pin,
            tried_queries=tried,
            all_candidates=[_place_to_dict(c) for c in candidates],
        )
        return _apply_detail(mr, pin.seq, pin)

    return MatchResult(
        status="fail",
        step="modu_fail",
        message="모두의주차장에서 매칭 실패",
        tried_queries=tried,
        all_candidates=[_place_to_dict(c) for c in candidates],
    )


def _enrich_pin_and_detail(
    row: dict, mr: MatchResult, src_lat: float, src_lng: float
) -> MatchResult:
    place = mr.place
    if place is None or place.lat is None or place.lng is None:
        return mr

    pin = None
    dist = 99999.0
    reason = "none"
    try:
        pins = fetch_pins_near(place.lat, place.lng)
        pin, dist, reason = modu.pick_best_pin(
            pins,
            src_name=row.get("주차장명") or "",
            src_lat=src_lat,
            src_lng=src_lng,
            place_lat=place.lat,
            place_lng=place.lng,
        )
    except Exception:
        pass

    if pin is None or dist > NEAR_DIST_M:
        try:
            pins2 = fetch_pins_near(src_lat, src_lng)
            pin2, dist2, reason2 = modu.pick_best_pin(
                pins2,
                src_name=row.get("주차장명") or "",
                src_lat=src_lat,
                src_lng=src_lng,
            )
            if pin2 and dist2 < dist:
                pin, dist, reason = pin2, dist2, reason2
        except Exception:
            pass

    if pin and dist <= NEAR_DIST_M:
        mr.pin = pin
        mr.message += f" / pin={pin.name}({dist:.1f}m)"
        return _apply_detail(mr, pin.seq, pin)

    # 핀 없이 장소만 — 주소만이라도
    form = empty_modu_form()
    form["주소"] = place.address
    mr.form = form
    mr.meta.update(
        {
            "modu_name": place.name,
            "modu_url": map_url(place.lat, place.lng),
            "modu_pin_match": "none",
        }
    )
    mr.message += " / pin없음(장소만)"
    return mr


def form_from_naver(naver_flat: dict) -> dict[str, str]:
    """네이버 수집값을 모두의주차장 양식 컬럼으로 매핑."""
    form = empty_modu_form()
    form["운영 시간"] = (naver_flat.get("naver_hours") or "").strip()
    form["주소"] = (
        naver_flat.get("naver_road_address")
        or naver_flat.get("naver_jibun_address")
        or naver_flat.get("naver_address")
        or ""
    ).strip()

    fees = (naver_flat.get("naver_fees_modu") or "").strip()
    if fees:
        form["현장 요금"] = fees

    # 요일별 유료시간 JSON이 있으면 매핑
    import json as _json

    days_raw = naver_flat.get("naver_hours_days_json") or ""
    days = {}
    if days_raw:
        try:
            days = _json.loads(days_raw)
        except Exception:
            days = {}
    # days: {"월":{"paid":"...","free":"..."}, ...}
    weekday_paid = []
    for d in ("월", "화", "수", "목", "금"):
        paid = (days.get(d) or {}).get("paid") or ""
        if paid and paid != "정보없음":
            weekday_paid.append(paid)
    if weekday_paid:
        # 최빈/첫번째
        form["운영시간_평일"] = weekday_paid[0]
        if not form["운영 시간"]:
            form["운영 시간"] = weekday_paid[0]
    sat = (days.get("토") or {}).get("paid") or ""
    sun = (days.get("일") or {}).get("paid") or ""
    if sat and sat != "정보없음":
        form["운영시간_토요일"] = sat
    if sun and sun != "정보없음":
        form["운영시간_일요일"] = sun

    conv = (naver_flat.get("naver_conveniences") or "").strip()
    extras = []
    if conv:
        extras.append(conv)
    if "장애인" in conv:
        extras.append("장애인")
    # dedupe
    seen = set()
    uniq = []
    for x in extras:
        if x and x not in seen:
            seen.add(x)
            uniq.append(x)
    form["추가정보"] = ";".join(uniq)
    return form


def flatten_row(row: dict, mr: MatchResult) -> dict:
    form = mr.form or empty_modu_form()
    out = {
        "주차장관리번호": row.get("주차장관리번호"),
        "원본_주차장명": row.get("주차장명"),
        "원본_도로명": row.get("소재지도로명주소"),
        "원본_지번": row.get("소재지지번주소"),
        "원본_위도": row.get("위도"),
        "원본_경도": row.get("경도"),
        "원본_요금정보": row.get("요금정보"),
        "match_status": mr.status,
        "match_source": mr.source,
        "match_step": mr.step,
        "match_message": mr.message,
        "modu_seq": mr.meta.get("modu_seq", ""),
        "modu_name": mr.meta.get("modu_name", ""),
        "matched_site_url": mr.meta.get("modu_url")
        or mr.meta.get("naver_url")
        or "",
    }
    for k in MODU_FORM_FIELDS:
        out[k] = form.get(k, "")
    out["tried_queries"] = " | ".join(mr.tried_queries)
    return out


def log_dict(row: dict, mr: MatchResult) -> dict:
    return {
        "id": row.get("주차장관리번호"),
        "name": row.get("주차장명"),
        "status": mr.status,
        "source": mr.source,
        "step": mr.step,
        "message": mr.message,
        "tried_queries": mr.tried_queries,
        "place": _place_to_dict(mr.place) if mr.place else None,
        "pin": asdict(mr.pin) if mr.pin else None,
        "form": mr.form,
        "meta": mr.meta,
        "candidates": mr.all_candidates,
    }
