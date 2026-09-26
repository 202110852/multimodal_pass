/**
 * 검색 결과에서 "같은 실세계 장소"를 한 행으로 접는다.
 *
 * 엔티티 해소(canonical_poi_id)가 이름만 다르면(예: 상호 vs 행사 제목) 놓친다.
 * 챗봇이 두 곳으로 나열하지 않도록, 좌표가 가깝고 이름이 포함 관계면 하나로 합친다.
 */

export type PlaceLike = {
  poi_id: number;
  name: string;
  addr?: string | null;
  lat?: number | null;
  lon?: number | null;
  sources?: string[];
};

const NEAR_M = 80;
const PREFIX_MIN = 6;

function normName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s()[\]{}<>·‧・,./\\'"`~!@#$%^&*+=_|:;?\-–—]/g, "");
}

function distM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function namesRelated(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const n = Math.min(na.length, nb.length);
  let i = 0;
  while (i < n && na[i] === nb[i]) i++;
  return i >= PREFIX_MIN && i >= n * 0.5;
}

function nearEnough(a: PlaceLike, b: PlaceLike): boolean {
  if (
    a.lat != null &&
    a.lon != null &&
    b.lat != null &&
    b.lon != null &&
    distM({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }) <= NEAR_M
  ) {
    return true;
  }
  const aa = normName(a.addr ?? "");
  const ab = normName(b.addr ?? "");
  if (aa.length >= 8 && ab.length >= 8 && (aa.includes(ab) || ab.includes(aa))) {
    return true;
  }
  return false;
}

function samePlace(a: PlaceLike, b: PlaceLike): boolean {
  return nearEnough(a, b) && namesRelated(a.name, b.name);
}

/** 짧은 상호명을 선호(행사·쿠폰 안내 제목보다). 동길이면 앞선 행. */
function prefer<T extends PlaceLike>(a: T, b: T): T {
  if (a.name.length !== b.name.length) {
    return a.name.length < b.name.length ? a : b;
  }
  return a;
}

export function collapseSamePlaces<T extends PlaceLike>(rows: T[]): T[] {
  if (rows.length <= 1) return rows;
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const unite = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  };

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (samePlace(rows[i], rows[j])) unite(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }

  const out: T[] = [];
  for (const idxs of groups.values()) {
    let best = rows[idxs[0]];
    const sources = new Set<string>(best.sources ?? []);
    for (let k = 1; k < idxs.length; k++) {
      const cur = rows[idxs[k]];
      for (const s of cur.sources ?? []) sources.add(s);
      best = prefer(best, cur);
    }
    out.push(
      sources.size
        ? ({ ...best, sources: [...sources].sort() } as T)
        : best,
    );
  }
  // 원래 유사도 순서를 유지 — 그룹 대표를 첫 등장 위치에 둔다
  const order = new Map(rows.map((r, i) => [r.poi_id, i]));
  out.sort(
    (a, b) => (order.get(a.poi_id) ?? 0) - (order.get(b.poi_id) ?? 0),
  );
  return out;
}
