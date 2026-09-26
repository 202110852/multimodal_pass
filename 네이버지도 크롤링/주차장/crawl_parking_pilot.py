#!/usr/bin/env python3
"""서귀포 주차장 CSV → 네이버지도 매칭/수집 파일럿 (N건)."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import time
import urllib.parse
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

from playwright.sync_api import sync_playwright, Page

ROOT = Path(__file__).resolve().parent
SRC_CSV = Path(
    "/Users/jpark/project/api_visitkorea/작업/주차장_csv_다운로드/"
    "제주특별자치도_서귀포시_주차장정보.csv"
)
OUT_DIR = ROOT / "pilot_10"
LOG_PATH = OUT_DIR / "match_log.jsonl"
RESULT_CSV = OUT_DIR / "enriched_10.csv"
RESULT_JSON = OUT_DIR / "enriched_10.json"

# 검색 지역 접두어 (서귀포 / 제주시 등)
REGION = "서귀포"

# 주소 일치로 볼 거리(m) / 가까워서 수동확인(m)
MATCH_DIST_M = 80
NEAR_DIST_M = 250


@dataclass
class Candidate:
    place_id: str
    name: str = ""
    category: str = ""
    road_address: str = ""
    address: str = ""
    lat: Optional[float] = None
    lng: Optional[float] = None
    query: str = ""
    source: str = "naver"


@dataclass
class MatchResult:
    status: str  # success | needs_confirm | fail
    step: str
    message: str
    candidate: Optional[Candidate] = None
    detail: dict[str, Any] = field(default_factory=dict)
    tried_queries: list[str] = field(default_factory=list)
    all_candidates: list[dict] = field(default_factory=list)


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
    s = s.strip()
    s = re.sub(r"\s+", "", s)
    s = s.replace("제주특별자치도", "제주")
    s = re.sub(r"\([^)]*\)", "", s)
    s = s.replace("번길", "번길")
    return s


def addr_tokens(s: str) -> set[str]:
    s = norm_addr(s)
    # 동/읍/면/리/로/길 + 숫자 덩어리
    parts = re.findall(r"[가-힣0-9]+(?:동|읍|면|리|로|길)|[0-9\-]+|[가-힣]{2,}", s)
    return {p for p in parts if p}


def address_similar(src_road: str, src_jibun: str, cand_road: str, cand_jibun: str) -> tuple[bool, str]:
    """엄격 일치 / 유사 판정."""
    srcs = [norm_addr(src_road), norm_addr(src_jibun)]
    cands = [norm_addr(cand_road), norm_addr(cand_jibun)]
    for a in srcs:
        for b in cands:
            if a and b and (a == b or a in b or b in a):
                return True, "exact_or_contains"

    # 지번 핵심: …동/리 + 번지
    src_set = addr_tokens(src_road) | addr_tokens(src_jibun)
    cand_set = addr_tokens(cand_road) | addr_tokens(cand_jibun)
    if not src_set or not cand_set:
        return False, "empty"

    # 동/리/읍/면 하나 + 번지 숫자 하나 이상 공유
    area = {t for t in src_set if re.search(r"(동|읍|면|리)$", t)}
    nums = {t for t in src_set if re.search(r"\d", t)}
    area_hit = bool(area & cand_set)
    num_hit = bool(nums & cand_set)
    if area_hit and num_hit:
        return True, "area_and_number"
    if area_hit and len(src_set & cand_set) >= 3:
        return True, "token_overlap"
    return False, f"overlap={len(src_set & cand_set)}"


def build_queries(row: dict) -> list[str]:
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
    add(f"{REGION} {name}")
    add(f"{REGION} {name} 주차장")
    # 공영주차빌딩 → 공영주차장 변형
    if "주차빌딩" in name:
        add(name.replace("주차빌딩", "주차장"))
        add(f"{REGION} {name.replace('주차빌딩', '주차장')}")
    # 지번/도로명 보조
    for addr in (jibun, road):
        if not addr:
            continue
        # 마지막 토큰(동/리+번지) 위주
        m = re.search(r"((?:[가-힣]+(?:읍|면)\s+)?[가-힣0-9]+(?:동|리)\s*[0-9\-]+)", addr)
        if m:
            add(f"{REGION} {m.group(1)} 주차장")
            add(f"{m.group(1)} 주차장")
    return qs


def pick_rows(limit: int) -> list[dict]:
    with SRC_CSV.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    # 매일올레 우선 + 유료/혼합 + 좌표 있는 것
    preferred_names = {"매일올레시장 공영주차빌딩", "동홍1공영주차빌딩", "천지연 공영주차장"}
    scored = []
    for r in rows:
        name = (r.get("주차장명") or "").strip()
        lat, lng = (r.get("위도") or "").strip(), (r.get("경도") or "").strip()
        if not name or not lat or not lng:
            continue
        fee = (r.get("요금정보") or "").strip()
        pri = 0 if name in preferred_names else (1 if fee in ("유료", "혼합") else 2)
        scored.append((pri, name, r))
    scored.sort(key=lambda x: (x[0], x[1]))
    return [r for _, __, r in scored[:limit]]


def extract_place_ids_from_html(html: str) -> list[str]:
    ids = re.findall(r"(?:place/|entry/place/)(\d{6,})", html)
    # 입구/출구보다 본체를 앞에 두기 위해 출현 순서 유지, 중복 제거
    out: list[str] = []
    for i in ids:
        if i not in out:
            out.append(i)
    return out[:15]


def search_naver_place_ids(page: Page, query: str) -> list[str]:
    """네이버 통합검색 HTML에서 place id 후보 추출."""
    url = "https://search.naver.com/search.naver?query=" + urllib.parse.quote(query)
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1200)
    html = page.content()
    return extract_place_ids_from_html(html)


def search_naver_map_list(page: Page, query: str, lat: float, lng: float) -> list[str]:
    """지도 검색 URL로 이동 후 페이지/iframe 소스에서 place id 추출."""
    q = urllib.parse.quote(query)
    url = f"https://map.naver.com/p/search/{q}?c=15.00,0,0,0,dh"
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    html = page.content()
    ids = extract_place_ids_from_html(html)
    # searchIframe src에도 id가 있을 수 있음
    for fr in page.frames:
        try:
            src = fr.url or ""
            ids.extend(extract_place_ids_from_html(src))
            if "pcmap.place.naver.com" in src:
                try:
                    ids.extend(extract_place_ids_from_html(fr.content()))
                except Exception:
                    pass
        except Exception:
            pass
    # 좌표 기반 주변 힌트용 (동일 id 유지)
    _ = (lat, lng)
    out: list[str] = []
    for i in ids:
        if i not in out:
            out.append(i)
    return out[:20]


def parse_hours_block(text: str) -> dict[str, Any]:
    """네이버 플레이스 영업시간 펼침 텍스트 파싱 (유료/무료 요일별)."""
    out: dict[str, Any] = {
        "summary": "",
        "status_line": "",
        "note": "",
        "days": {},  # 월..일 -> {paid, free}
        "raw": "",
    }
    if not text:
        return out

    # 영업시간 ~ 접기/수정제안/다음섹션
    m = re.search(
        r"영업시간\s*(.*?)(?:영업시간 수정 제안하기|전화번호|가격표|편의|소개|주소|방문자|블로그)",
        text,
        re.S,
    )
    block = m.group(1).strip() if m else ""
    if not block:
        # fallback: 영업시간부터 800자
        i = text.find("영업시간")
        block = text[i : i + 900] if i >= 0 else ""
    out["raw"] = re.sub(r"\n{3,}", "\n\n", block).strip()

    lines = [ln.strip() for ln in out["raw"].splitlines() if ln.strip()]
    junk = {
        "영업시간",
        "펼쳐보기",
        "접기",
        "정보 수정",
        "영업시간 수정 제안하기",
        "수정 제안하기",
    }
    # 요약/상태
    for ln in lines[:8]:
        if ln in junk or ln.startswith("영업시간 수정"):
            continue
        if not out["status_line"]:
            out["status_line"] = ln
            continue
        if ("유료" in ln or "무료" in ln or "24시간" in ln) and not out["summary"]:
            out["summary"] = ln
            break
    if not out["summary"]:
        if any("24시간" in ln for ln in lines):
            out["summary"] = "24시간 영업"
        elif out["days"]:
            # 요일별 유료 구간이 있으면 평일 유료 대표값
            for dname in ("월", "화", "수", "목", "금"):
                paid = (out["days"].get(dname) or {}).get("paid") or ""
                if paid and paid != "정보없음":
                    out["summary"] = f"유료 {paid}"
                    break
        if not out["summary"] and out["status_line"] and out["status_line"] not in junk:
            out["summary"] = out["status_line"]

    days = ("월", "화", "수", "목", "금", "토", "일")
    current = None
    for ln in lines:
        if ln in days:
            current = ln
            out["days"].setdefault(current, {"paid": "", "free": ""})
            continue
        if current is None:
            continue
        # 하단 안내 문구는 요일 free로 넣지 않음
        if re.match(r"유료\s*-", ln) or re.match(r"무료\s*-", ln):
            continue
        # "유료\t09:00 - 18:00" or "유료 09:00 - 18:00"
        pm = re.match(r"유료\s*[:\t ]*(.+)$", ln)
        fm = re.match(r"무료\s*[:\t ]*(.+)$", ln)
        if pm:
            out["days"][current]["paid"] = pm.group(1).strip()
        elif fm:
            out["days"][current]["free"] = fm.group(1).strip()

    # 하단 노트: "무료 - 토.일.공휴일 무료"
    for ln in lines:
        if ln.startswith("무료 -") or ln.startswith("유료 -") or "공휴일" in ln and "무료" in ln:
            if "정보없음" not in ln or "공휴일" in ln:
                out["note"] = ln
                break
    return out


def fetch_place_detail(page: Page, place_id: str) -> dict[str, Any]:
    url = f"https://pcmap.place.naver.com/place/{place_id}/home"
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2000)

    # 영업시간 펼치기 (접힌 요약만 보이면 상세 유료/무료가 안 나옴)
    page.evaluate(
        """() => {
      const btns = Array.from(document.querySelectorAll('button,a,[role=button]'));
      const expand = btns.find(b => {
        const t = (b.innerText || '').replace(/\\s+/g, ' ');
        return /영업시간|펼쳐보기|24시간|영업 전|영업 중|유료/.test(t)
          && !/수정 제안/.test(t);
      });
      if (expand) expand.click();
    }"""
    )
    page.wait_for_timeout(800)

    data = page.evaluate(
        """() => {
      const state = window.__APOLLO_STATE__ || {};
      const baseKey = Object.keys(state).find(k => k.startsWith('PlaceDetailBase:'));
      const base = baseKey ? state[baseKey] : null;
      const fees = [];
      for (const [k,v] of Object.entries(state)) {
        if (k.startsWith('ParkingmoduPrice:') && v && typeof v === 'object') {
          fees.push({id: v.id, name: v.name, price: v.price});
        }
      }
      fees.sort((a,b) => String(a.name).localeCompare(String(b.name), 'ko'));
      const body = (document.body && document.body.innerText) || '';
      return { base, fees, body };
    }"""
    )
    base = data.get("base") or {}
    body = data.get("body") or ""
    hours = parse_hours_block(body)

    lat = lng = None
    coord = base.get("coordinate") or {}
    try:
        lng = float(coord.get("x")) if coord.get("x") is not None else None
        lat = float(coord.get("y")) if coord.get("y") is not None else None
    except (TypeError, ValueError):
        pass

    conveniences = base.get("conveniences") or []
    toilet = None
    disabled = None
    for c in conveniences:
        if "화장실" in str(c):
            toilet = True
        if "장애인" in str(c):
            disabled = True

    desc = ""
    m2 = re.search(r"소개\s*\n([^\n]+)", body)
    if m2:
        desc = m2.group(1).strip()

    return {
        "place_id": place_id,
        "name": base.get("name") or "",
        "category": base.get("category") or "",
        "road_address": base.get("roadAddress") or "",
        "address": base.get("address") or "",
        "phone": base.get("phone") or "",
        "lat": lat,
        "lng": lng,
        "conveniences": conveniences,
        "toilet": toilet,
        "disabled_parking": disabled,
        "fees_modu": data.get("fees") or [],
        "hours_text": hours.get("summary") or hours.get("status_line") or "",
        "hours_status": hours.get("status_line") or "",
        "hours_note": hours.get("note") or "",
        "hours_days": hours.get("days") or {},
        "hours_raw": hours.get("raw") or "",
        "body_snippet": body[:2000],
        "description": desc,
        "raw_base_keys": list(base.keys()) if base else [],
    }


def enrich_hours_from_body(detail: dict) -> dict:
    """하위호환: hours_* 가 비었을 때만 body에서 재파싱."""
    if detail.get("hours_raw") or detail.get("hours_days"):
        return detail
    hours = parse_hours_block(detail.get("body_snippet") or "")
    detail["hours_text"] = hours.get("summary") or hours.get("status_line") or detail.get("hours_text") or ""
    detail["hours_status"] = hours.get("status_line") or ""
    detail["hours_note"] = hours.get("note") or ""
    detail["hours_days"] = hours.get("days") or {}
    detail["hours_raw"] = hours.get("raw") or ""
    if not detail.get("description"):
        m2 = re.search(r"소개\s*\n([^\n]+)", detail.get("body_snippet") or "")
        if m2:
            detail["description"] = m2.group(1).strip()
    return detail


def is_parking_category(cat: str, name: str) -> bool:
    t = f"{cat} {name}"
    if any(x in t for x in ("입구", "출구", "충전소")) and "주차장" not in cat:
        # 입구/출구 POI 제외 (본 주차장은 category에 주차장)
        if re.search(r"(입구|출구)\s*$", name) or "입구" in name or "출구" in name:
            return False
    return "주차" in t


def match_one(page: Page, row: dict) -> MatchResult:
    name = row["주차장명"]
    src_road = row.get("소재지도로명주소") or ""
    src_jibun = row.get("소재지지번주소") or ""
    src_lat = float(row["위도"])
    src_lng = float(row["경도"])

    queries = build_queries(row)
    seen_ids: set[str] = set()
    candidates: list[Candidate] = []
    tried: list[str] = []

    def add_ids(ids: list[str], query: str) -> None:
        for pid in ids:
            if pid in seen_ids:
                continue
            seen_ids.add(pid)
            try:
                detail = enrich_hours_from_body(fetch_place_detail(page, pid))
                time.sleep(0.8)
            except Exception as e:
                candidates.append(
                    Candidate(place_id=pid, name=f"(fetch_fail:{e})", query=query)
                )
                continue
            if not is_parking_category(detail.get("category") or "", detail.get("name") or ""):
                # 주차 관련 아니면 스킵하되 로그용으로 약하게 남김
                if "주차" not in (detail.get("name") or "") and "주차" not in (
                    detail.get("category") or ""
                ):
                    continue
            cand = Candidate(
                place_id=pid,
                name=detail.get("name") or "",
                category=detail.get("category") or "",
                road_address=detail.get("road_address") or "",
                address=detail.get("address") or "",
                lat=detail.get("lat"),
                lng=detail.get("lng"),
                query=query,
            )
            # detail을 candidate에 붙이기 위해 임시 저장
            cand_dict = asdict(cand)
            cand_dict["detail"] = detail
            candidates.append(cand)
            # stash detail on object
            setattr(cand, "detail", detail)

    # --- 1~2. 이름 검색 + 주소 일치, 실패 시 검색어 변형 ---
    for q in queries:
        tried.append(q)
        try:
            ids = search_naver_place_ids(page, q)
            if not ids:
                ids = search_naver_map_list(page, q, src_lat, src_lng)
        except Exception as e:
            continue
        before = len(candidates)
        add_ids(ids, q)
        # 이번 쿼리로 추가된 후보 중 주소 일치 확인
        for c in candidates[before:]:
            ok, reason = address_similar(src_road, src_jibun, c.road_address, c.address)
            if ok:
                return MatchResult(
                    status="success",
                    step="2_address_match",
                    message=f"주소일치({reason}) query={q}",
                    candidate=c,
                    detail=getattr(c, "detail", {}),
                    tried_queries=tried,
                    all_candidates=[asdict(x) for x in candidates],
                )
        # 너무 많이 쌓이면 중단
        if len(candidates) >= 12:
            break

    # --- 3. 이전 검색결과 포함 유사 주소 ---
    similar: list[tuple[Candidate, str]] = []
    for c in candidates:
        ok, reason = address_similar(src_road, src_jibun, c.road_address, c.address)
        if ok:
            similar.append((c, reason))
    if similar:
        c, reason = similar[0]
        return MatchResult(
            status="success",
            step="3_similar_address",
            message=f"유사주소({reason})",
            candidate=c,
            detail=getattr(c, "detail", {}),
            tried_queries=tried,
            all_candidates=[asdict(x) for x in candidates],
        )

    # --- 4. 좌표 근접 ---
    near: list[tuple[float, Candidate]] = []
    for c in candidates:
        if c.lat is None or c.lng is None:
            continue
        d = haversine_m(src_lat, src_lng, c.lat, c.lng)
        near.append((d, c))
    near.sort(key=lambda x: x[0])

    if near and near[0][0] <= MATCH_DIST_M:
        d, c = near[0]
        return MatchResult(
            status="success",
            step="4_coord_close_auto",
            message=f"좌표 {d:.0f}m ≤ {MATCH_DIST_M}m",
            candidate=c,
            detail=getattr(c, "detail", {}),
            tried_queries=tried,
            all_candidates=[asdict(x) for x in candidates],
        )

    if near and near[0][0] <= NEAR_DIST_M:
        d, c = near[0]
        return MatchResult(
            status="needs_confirm",
            step="4_coord_near_confirm",
            message=f"좌표 {d:.0f}m ≤ {NEAR_DIST_M}m → 확인 필요",
            candidate=c,
            detail=getattr(c, "detail", {}),
            tried_queries=tried,
            all_candidates=[asdict(x) for x in candidates],
        )

    # 좌표 기반 재검색
    jibun_tail = src_jibun
    for marker in ("제주시", "서귀포시"):
        if marker in src_jibun:
            jibun_tail = src_jibun.split(marker)[-1].strip()
            break
    coord_queries = [
        f"주차장 {src_lat:.5f} {src_lng:.5f}",
        f"{REGION} 주차장 {jibun_tail or name}",
    ]
    # 지번 동/리만
    m = re.search(r"([가-힣0-9]+(?:동|리))", src_jibun)
    if m:
        coord_queries.insert(0, f"{REGION} {m.group(1)} 공영주차장")

    for q in coord_queries:
        if q in tried:
            continue
        tried.append(q)
        try:
            ids = search_naver_map_list(page, q, src_lat, src_lng)
            add_ids(ids, q)
        except Exception:
            continue

    near2: list[tuple[float, Candidate]] = []
    for c in candidates:
        if c.lat is None or c.lng is None:
            continue
        d = haversine_m(src_lat, src_lng, c.lat, c.lng)
        near2.append((d, c))
    near2.sort(key=lambda x: x[0])

    if near2 and near2[0][0] <= MATCH_DIST_M:
        d, c = near2[0]
        return MatchResult(
            status="success",
            step="4_coord_research_match",
            message=f"좌표재검색 후 {d:.0f}m",
            candidate=c,
            detail=getattr(c, "detail", {}),
            tried_queries=tried,
            all_candidates=[asdict(x) for x in candidates],
        )
    if near2 and near2[0][0] <= NEAR_DIST_M:
        d, c = near2[0]
        return MatchResult(
            status="needs_confirm",
            step="4_coord_research_confirm",
            message=f"좌표재검색 후 {d:.0f}m → 확인 필요",
            candidate=c,
            detail=getattr(c, "detail", {}),
            tried_queries=tried,
            all_candidates=[asdict(x) for x in candidates],
        )

    # --- 5. 실패 ---
    return MatchResult(
        status="fail",
        step="5_fail",
        message="매칭 실패",
        candidate=near2[0][1] if near2 else (near[0][1] if near else None),
        detail={},
        tried_queries=tried,
        all_candidates=[asdict(x) for x in candidates],
    )


def place_urls(place_id: str) -> dict[str, str]:
    """매칭된 네이버 장소 페이지 URL."""
    if not place_id:
        return {
            "matched_site": "",
            "matched_site_url": "",
            "naver_map_url": "",
            "naver_place_home_url": "",
        }
    map_url = f"https://map.naver.com/p/entry/place/{place_id}"
    home_url = f"https://pcmap.place.naver.com/place/{place_id}/home"
    return {
        "matched_site": "naver_place",
        "matched_site_url": map_url,  # 대표 링크(지도 진입)
        "naver_map_url": map_url,
        "naver_place_home_url": home_url,
    }


def flatten_row(row: dict, mr: MatchResult) -> dict:
    d = mr.detail or {}
    fees = d.get("fees_modu") or []
    fee_str = "; ".join(f"{f.get('name')}={f.get('price')}" for f in fees)
    dist = ""
    if mr.candidate and mr.candidate.lat and mr.candidate.lng:
        dist = f"{haversine_m(float(row['위도']), float(row['경도']), mr.candidate.lat, mr.candidate.lng):.1f}"

    place_id = d.get("place_id") or (mr.candidate.place_id if mr.candidate else "")
    urls = place_urls(str(place_id) if place_id else "")

    return {
        "주차장관리번호": row.get("주차장관리번호"),
        "원본_주차장명": row.get("주차장명"),
        "원본_도로명": row.get("소재지도로명주소"),
        "원본_지번": row.get("소재지지번주소"),
        "원본_위도": row.get("위도"),
        "원본_경도": row.get("경도"),
        "원본_요금정보": row.get("요금정보"),
        "match_status": mr.status,
        "match_step": mr.step,
        "match_message": mr.message,
        "match_distance_m": dist,
        "matched_site": urls["matched_site"],
        "matched_site_url": urls["matched_site_url"],
        "naver_map_url": urls["naver_map_url"],
        "naver_place_home_url": urls["naver_place_home_url"],
        "naver_place_id": place_id,
        "naver_name": d.get("name") or (mr.candidate.name if mr.candidate else ""),
        "naver_category": d.get("category") or "",
        "naver_road_address": d.get("road_address") or "",
        "naver_jibun_address": d.get("address") or "",
        "naver_phone": d.get("phone") or "",
        "naver_lat": d.get("lat") if d.get("lat") is not None else "",
        "naver_lng": d.get("lng") if d.get("lng") is not None else "",
        "naver_hours": d.get("hours_text") or "",
        "naver_hours_status": d.get("hours_status") or "",
        "naver_hours_note": d.get("hours_note") or "",
        "naver_hours_days_json": json.dumps(d.get("hours_days") or {}, ensure_ascii=False),
        "naver_hours_raw": (d.get("hours_raw") or "").replace("\n", " | "),
        "naver_conveniences": "|".join(d.get("conveniences") or []),
        "naver_toilet": "" if d.get("toilet") is None else str(d.get("toilet")),
        "naver_disabled_parking": ""
        if d.get("disabled_parking") is None
        else str(d.get("disabled_parking")),
        "naver_fees_modu": fee_str,
        "naver_description": d.get("description") or "",
        "tried_queries": " | ".join(mr.tried_queries),
        # 모두의주차장: 공개 검색 API 없어 네이버 플레이스 내 ParkingmoduPrice로 수집
        "modu_via": "naver_place_ParkingmoduPrice" if fees else "",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = pick_rows(args.limit)
    print(f"대상 {len(rows)}건", flush=True)
    for r in rows:
        print(" -", r["주차장명"], flush=True)

    results: list[dict] = []
    logs: list[dict] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        context = browser.new_context(
            locale="ko-KR",
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        for i, row in enumerate(rows, 1):
            print(f"\n[{i}/{len(rows)}] {row['주차장명']}", flush=True)
            try:
                mr = match_one(page, row)
            except Exception as e:
                mr = MatchResult(
                    status="fail",
                    step="exception",
                    message=str(e),
                    tried_queries=[],
                )
            flat = flatten_row(row, mr)
            results.append(flat)
            log_obj = {
                "index": i,
                "name": row["주차장명"],
                "status": mr.status,
                "step": mr.step,
                "message": mr.message,
                "tried_queries": mr.tried_queries,
                "candidate": asdict(mr.candidate) if mr.candidate else None,
                "detail_keys": list((mr.detail or {}).keys()),
                "fees": (mr.detail or {}).get("fees_modu"),
            }
            logs.append(log_obj)
            with LOG_PATH.open("a", encoding="utf-8") as lf:
                lf.write(json.dumps(log_obj, ensure_ascii=False) + "\n")
            print(f"  → {mr.status} / {mr.step} / {mr.message}", flush=True)
            time.sleep(1.0)
        browser.close()

    RESULT_JSON.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    if results:
        with RESULT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(results[0].keys()))
            w.writeheader()
            w.writerows(results)

    # 요약
    from collections import Counter

    c = Counter(r["match_status"] for r in results)
    print("\n=== 요약 ===", flush=True)
    for k, v in c.items():
        print(f"  {k}: {v}", flush=True)
    print(f"CSV: {RESULT_CSV}", flush=True)
    print(f"JSON: {RESULT_JSON}", flush=True)
    print(f"LOG: {LOG_PATH}", flush=True)


if __name__ == "__main__":
    main()
