/**
 * 식이 관련 질환 — 프로필에는 병명 id 만 저장한다.
 * 추천 안내용 설명(guidance)은 여기 상수로 두고, 에이전트에 넘길 때 붙인다.
 */

export type DietCondition =
  | "diabetes"
  | "hypertension"
  | "kidney"
  | "hyperlipidemia"
  | "gout"
  | "fatty_liver";

export const DIET_CONDITION_OPTS: { id: DietCondition; label: string }[] = [
  { id: "diabetes", label: "당뇨병" },
  { id: "hypertension", label: "고혈압" },
  { id: "kidney", label: "신장질환" },
  { id: "hyperlipidemia", label: "고지혈증" },
  { id: "gout", label: "통풍" },
  { id: "fatty_liver", label: "지방간" },
];

/** 식당·장소 추천 시 에이전트가 참고할 설명. 프로필 JSON 에는 넣지 않는다. */
export const DIET_CONDITION_GUIDANCE: Record<DietCondition, string> = {
  diabetes:
    "혈당이 급격히 오르는 것을 막기 위해 설탕, 탄산음료 등 단당류와 정제 탄수화물 섭취를 제한해야 합니다.",
  hypertension:
    "혈압 상승과 부종을 방지하기 위해 염분이 많은 찌개, 젓갈 등 고나트륨 식품을 주의해야 합니다.",
  kidney:
    "신장 부담을 줄이기 위해 단백질, 칼륨, 인, 나트륨의 섭취량을 엄격히 조절해야 합니다.",
  hyperlipidemia:
    "혈중 콜레스테롤과 중성지방 관리를 위해 포화지방, 트랜스지방, 고콜레스테롤 음식과 음주를 피해야 합니다.",
  gout: "요산 수치를 높이는 퓨린 함량이 높은 고기 내장류, 등푸른생선, 맥주 등의 섭취를 삼가야 합니다.",
  fatty_liver: "간 내 지방 축적을 막기 위해 알코올과 과도한 과당 및 탄수화물 섭취를 줄여야 합니다.",
};

export function isDietCondition(id: unknown): id is DietCondition {
  return typeof id === "string" && id in DIET_CONDITION_GUIDANCE;
}

/** 에이전트에 넘길 때: 병명 + 설명 */
export function dietConditionsForAgent(
  ids: DietCondition[] | undefined,
): { id: DietCondition; name: string; guidance: string }[] {
  if (!ids?.length) return [];
  return ids.filter(isDietCondition).map((id) => ({
    id,
    name: DIET_CONDITION_OPTS.find((o) => o.id === id)?.label ?? id,
    guidance: DIET_CONDITION_GUIDANCE[id],
  }));
}
