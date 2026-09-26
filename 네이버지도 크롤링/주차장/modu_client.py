#!/usr/bin/env python3
"""모두의주차장 (app.modu.kr) API·상세 클라이언트.

검색: GET https://api.modu.cloud/poi/search/place?q=&type=naver
핀/요금표: GET https://api.modu.cloud/poi/pins?geohash=&durationId=&parkingDate=
상세(운영시간·요금안내): GET https://app.modu.kr/map?type=P&id={seq} SSR JSON
"""

from __future__ import annotations

import json
import math
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional

try:
    import pygeohash as pgh
except ImportError:  # pragma: no cover
    pgh = None  # type: ignore

API = "https://api.modu.cloud"
MAP = "https://app.modu.kr/map"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

MATCH_DIST_M = 80
NEAR_DIST_M = 250

# 결과 CSV — 모두의주차장 정보 탭 양식
MODU_FORM_FIELDS = [
    "운영 시간",
    "현장 요금",
    "주소",
    "초기무료",
    "기본요금",
    "추가 요금",
    "할증 기준시간",
    "운영시간_평일",
    "운영시간_토요일",
    "운영시간_일요일",
    "운영시간_공휴일",
    "추가정보",
]


@dataclass
class ModuPlace:
    name: str
    address: str = ""
    lat: Optional[float] = None
    lng: Optional[float] = None
    query: str = ""


@dataclass
class ModuPin:
    seq: int
    name: str
    lat: float
    lng: float
    is_free: bool = False
    is_closed: bool = False
    is_autopay: bool = False
    qty: Optional[int] = None
    options: list[str] = field(default_factory=list)
    calc_price: dict[str, Any] = field(default_factory=dict)
    geohash: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


def _get_json(path: str, params: Optional[dict] = None) -> Any:
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = f"{API}{path}{qs}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "application/json",
            "Origin": "https://app.modu.kr",
            "Referer": "https://app.modu.kr/",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get_text(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "ko",
            "Referer": "https://app.modu.kr/",
        },
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        return resp.read().decode("utf-8", "ignore")


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def norm_addr(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"\s+", "", s.strip())
    s = s.replace("제주특별자치도", "제주")
    s = re.sub(r"\([^)]*\)", "", s)
    return s


def addr_tokens(s: str) -> set[str]:
    s = norm_addr(s)
    parts = re.findall(r"[가-힣0-9]+(?:동|읍|면|리|로|길)|[0-9\-]+|[가-힣]{2,}", s)
    return {p for p in parts if p}


def address_similar(src_road: str, src_jibun: str, cand_addr: str) -> tuple[bool, str]:
    srcs = [norm_addr(src_road), norm_addr(src_jibun)]
    cand = norm_addr(cand_addr)
    for a in srcs:
        if a and cand and (a == cand or a in cand or cand in a):
            return True, "exact_or_contains"
    src_set = addr_tokens(src_road) | addr_tokens(src_jibun)
    cand_set = addr_tokens(cand_addr)
    if not src_set or not cand_set:
        return False, "empty"
    area = {t for t in src_set if re.search(r"(동|읍|면|리)$", t)}
    nums = {t for t in src_set if re.search(r"\d", t)}
    if (area & cand_set) and (nums & cand_set):
        return True, "area_and_number"
    if (area & cand_set) and len(src_set & cand_set) >= 3:
        return True, "token_overlap"
    return False, f"overlap={len(src_set & cand_set)}"


def name_key(s: str) -> str:
    s = re.sub(r"\s+", "", (s or "").lower())
    for x in ("주차장", "주차빌딩", "공영", "민영", "노상", "노외", "기계식"):
        s = s.replace(x, "")
    return s


def name_similar(a: str, b: str) -> bool:
    ka, kb = name_key(a), name_key(b)
    if not ka or not kb:
        return False
    if ka == kb or ka in kb or kb in ka:
        return True
    ta = set(re.findall(r"[가-힣]{2,}", ka))
    tb = set(re.findall(r"[가-힣]{2,}", kb))
    if ta and tb and len(ta & tb) >= max(1, min(len(ta), len(tb)) - 1):
        return True
    return False


def is_side_poi(name: str) -> bool:
    n = name or ""
    return any(x in n for x in ("출구", "입구", "관리실", "전기차", "충전소"))


def time_filter_defaults() -> tuple[str, str]:
    data = _get_json("/ticket/time-filter-options").get("data") or {}
    defaults = data.get("defaults") or {}
    parking_date = defaults.get("date") or date.today().isoformat()
    duration_id = defaults.get("durationId") or "PT1H"
    return parking_date, duration_id


def geohashes_around(lat: float, lng: float, delta: float = 0.003, precision: int = 6) -> list[str]:
    if pgh is None:
        raise RuntimeError("pygeohash 필요: pip install pygeohash")
    hashes: set[str] = set()
    steps = 10
    for i in range(steps + 1):
        for j in range(steps + 1):
            la = lat + (i / steps - 0.5) * 2 * delta
            ln = lng + (j / steps - 0.5) * 2 * delta
            hashes.add(pgh.encode(la, ln, precision))
    return sorted(hashes)


def search_places(query: str) -> list[ModuPlace]:
    data = _get_json("/poi/search/place", {"q": query, "type": "naver"})
    places = ((data.get("data") or {}).get("places")) or []
    out: list[ModuPlace] = []
    for p in places:
        out.append(
            ModuPlace(
                name=(p.get("name") or "").strip(),
                address=(p.get("address") or "").strip(),
                lat=float(p["latitude"]) if p.get("latitude") is not None else None,
                lng=float(p["longitude"]) if p.get("longitude") is not None else None,
                query=query,
            )
        )
    return out


def fetch_pins_near(
    lat: float,
    lng: float,
    *,
    parking_date: Optional[str] = None,
    duration_id: Optional[str] = None,
    delta: float = 0.003,
) -> list[ModuPin]:
    if not parking_date or not duration_id:
        parking_date, duration_id = time_filter_defaults()
    ghs = geohashes_around(lat, lng, delta=delta)
    data = _get_json(
        "/poi/pins",
        {
            "geohash": ",".join(ghs),
            "durationId": duration_id,
            "parkingDate": parking_date,
        },
    )
    out: list[ModuPin] = []
    seen: set[int] = set()
    for block in data.get("data") or []:
        for p in block.get("parkinglots") or []:
            seq = int(p.get("parkinglotSeq") or 0)
            if not seq or seq in seen:
                continue
            seen.add(seq)
            out.append(
                ModuPin(
                    seq=seq,
                    name=(p.get("name") or "").strip(),
                    lat=float(p["latitude"]),
                    lng=float(p["longitude"]),
                    is_free=bool(p.get("isFree")),
                    is_closed=bool(p.get("isClosed")),
                    is_autopay=bool(p.get("isAutopay")),
                    qty=p.get("qty"),
                    options=list(p.get("options") or []),
                    calc_price=dict(p.get("calcPrice") or {}),
                    geohash=(p.get("geohash") or ""),
                    raw=p,
                )
            )
    return out


def format_calc_price(calc: dict[str, Any]) -> str:
    if not calc:
        return ""
    items = []
    for k in sorted(calc.keys(), key=lambda x: int(x) if str(x).isdigit() else 0):
        try:
            minutes = int(k)
        except Exception:
            continue
        price = calc[k]
        label = f"{minutes // 60}시간" if minutes % 60 == 0 else f"{minutes}분"
        items.append(f"{label}={price}")
    return "; ".join(items)


def format_onsite_fee(calc: dict[str, Any], html: str = "") -> str:
    """UI '현장 요금' ≈ 1시간 기준 N원."""
    m = re.search(r"현장 요금</span><span[^>]*>\s*([^<]+)", html)
    if m:
        return m.group(1).strip()
    m = re.search(r"1시간 기준\s*([0-9,]+)\s*원", html)
    if m:
        return f"1시간 기준 {m.group(1)}원"
    for key in ("60", 60):
        if key in calc and calc[key] is not None:
            try:
                return f"1시간 기준 {int(calc[key]):,}원".replace(",", ",")
            except Exception:
                return f"1시간 기준 {calc[key]}원"
    return ""


def map_url(lat: float, lng: float, zoom: int = 17) -> str:
    return f"{MAP}?lat={lat}&lng={lng}&zoom={zoom}"


def detail_url(seq: int, parking_date: Optional[str] = None, duration_id: Optional[str] = None) -> str:
    if not parking_date or not duration_id:
        parking_date, duration_id = time_filter_defaults()
    return f"{MAP}?type=P&id={seq}&parkingDate={parking_date}&durationId={duration_id}"


def pin_map_url(pin: ModuPin) -> str:
    return detail_url(pin.seq)


def _kv_map(sections: list[dict], title: Optional[str] = None) -> dict[str, str]:
    out: dict[str, str] = {}
    for sec in sections or []:
        if title and sec.get("title") != title:
            continue
        for c in sec.get("contents") or []:
            k = (c.get("key") or "").strip()
            v = (c.get("value") or "").strip()
            if k:
                out[k] = v
    return out


def fetch_parking_detail(seq: int) -> dict[str, Any]:
    """type=P&id= SSR HTML에서 정보 탭 필드 파싱."""
    url = detail_url(seq)
    html = _get_text(url)
    text = html.replace('\\"', '"').replace("\\u0026", "&")

    times: list[dict] = []
    prices: list[dict] = []
    open_free: dict = {}
    m = re.search(
        r'"times":(\[.*?\]),"prices":(\[.*?\]),"openFree":(\{.*?\}),"modifyDate":"([^"]*)"',
        text,
    )
    if m:
        times = json.loads(m.group(1))
        prices = json.loads(m.group(2))
        open_free = json.loads(m.group(3))
        modify_date = m.group(4)
    else:
        modify_date = ""

    # parkingLot 메타
    name = ""
    address = ""
    new_address = ""
    options: list[str] = []
    lat = lng = None
    mlot = re.search(
        r'"name":"([^"]*)".*?"address":"([^"]*)".*?"options":(\[.*?\]).*?"newAddress":"([^"]*)".*?"latitude":([0-9.]+),"longitude":([0-9.]+)',
        text,
    )
    # 더 안전: newAddress / options 단독
    m_addr = re.search(r'"newAddress":"([^"]*)"', text)
    m_jibun = re.search(r'"address":"([^"]*)"', text)
    m_opt = re.search(r'"options":(\[[^\]]*\]),"category"', text)
    m_name = re.search(r'"parkinglotSeq":%d.*?"name":"([^"]*)"' % seq, html.replace('\\"', '"'))
    if not m_name:
        m_name = re.search(r'<h1[^>]*>\s*([^<]+?)\s*</h1>', html)
    if m_name:
        name = m_name.group(1).strip()
    if m_addr:
        new_address = m_addr.group(1).strip()
    if m_jibun:
        address = m_jibun.group(1).strip()
    if m_opt:
        try:
            options = json.loads(m_opt.group(1))
        except Exception:
            options = []
    m_ll = re.search(r'"latitude":([0-9.]+),"longitude":([0-9.]+)', text)
    if m_ll:
        lat, lng = float(m_ll.group(1)), float(m_ll.group(2))

    paid_hours = _kv_map(times, "유료 운영시간")
    hour_fees = _kv_map(prices, "시간요금")

    # calcPrice도 HTML/핀에 있을 수 있음 — 현장요금용
    calc: dict[str, Any] = {}
    m_calc = re.search(r'"calcPrice":(\{.*?\})', text)
    if m_calc:
        try:
            calc = json.loads(m_calc.group(1))
        except Exception:
            calc = {}

    form = empty_modu_form()
    form["운영 시간"] = (open_free.get("operationTime") or "").strip()
    form["현장 요금"] = format_onsite_fee(calc, html)
    form["주소"] = new_address or address
    form["초기무료"] = hour_fees.get("초기무료", "")
    form["기본요금"] = hour_fees.get("기본요금", "")
    form["추가 요금"] = hour_fees.get("추가요금", "")
    form["할증 기준시간"] = hour_fees.get("할증 기준시간", "")
    form["운영시간_평일"] = paid_hours.get("평일", "")
    form["운영시간_토요일"] = paid_hours.get("토요일", "")
    form["운영시간_일요일"] = paid_hours.get("일요일", "")
    form["운영시간_공휴일"] = paid_hours.get("공휴일", "")
    form["추가정보"] = ";".join(options) if options else ""

    return {
        "seq": seq,
        "name": name,
        "url": url,
        "modify_date": modify_date,
        "jibun_address": address,
        "new_address": new_address,
        "lat": lat,
        "lng": lng,
        "options": options,
        "times": times,
        "prices": prices,
        "open_free": open_free,
        "calc_price": calc,
        "form": form,
        "raw_ok": bool(m),
    }


def empty_modu_form() -> dict[str, str]:
    return {k: "" for k in MODU_FORM_FIELDS}


def build_queries(row: dict, region: str) -> list[str]:
    name = (row.get("주차장명") or "").strip()
    road = (row.get("소재지도로명주소") or "").strip()
    jibun = (row.get("소재지지번주소") or "").strip()
    qs: list[str] = []

    def add(q: str) -> None:
        q = re.sub(r"\s+", " ", q).strip()
        if q and q not in qs:
            qs.append(q)

    add(name)
    if "주차장" not in name:
        add(f"{name} 주차장")
    add(f"{region} {name}")
    add(f"{region} {name} 주차장")
    if "주차빌딩" in name:
        add(name.replace("주차빌딩", "주차장"))
        add(f"{region} {name.replace('주차빌딩', '주차장')}")
    for addr in (jibun, road):
        if not addr:
            continue
        m = re.search(r"((?:[가-힣]+(?:읍|면)\s+)?[가-힣0-9]+(?:동|리)\s*[0-9\-]+)", addr)
        if m:
            add(f"{region} {m.group(1)} 주차장")
            add(f"{m.group(1)} 주차장")
    return qs


def pick_best_pin(
    pins: list[ModuPin],
    *,
    src_name: str,
    src_lat: float,
    src_lng: float,
    place_lat: Optional[float] = None,
    place_lng: Optional[float] = None,
) -> tuple[Optional[ModuPin], float, str]:
    if not pins:
        return None, 99999.0, "no_pins"

    scored: list[tuple[float, float, ModuPin, str]] = []
    for p in pins:
        if is_side_poi(p.name):
            continue
        d_csv = haversine_m(src_lat, src_lng, p.lat, p.lng)
        d_place = (
            haversine_m(place_lat, place_lng, p.lat, p.lng)
            if place_lat is not None and place_lng is not None
            else d_csv
        )
        dist = min(d_csv, d_place)
        reason = "coord"
        score = dist
        if name_similar(src_name, p.name):
            score -= 40
            reason = "name+coord"
        scored.append((score, dist, p, reason))

    if not scored:
        return None, 99999.0, "side_poi_only"
    scored.sort(key=lambda x: (x[0], x[1]))
    _, dist, pin, reason = scored[0]
    return pin, dist, reason
