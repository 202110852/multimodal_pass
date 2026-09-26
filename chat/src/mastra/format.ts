/**
 * 답변 형식 규칙 — 채팅 화면(web/src/answer.ts, store.ts 의 routePrompt)과 맞물린다.
 *
 * prompts/system-prompt.txt(관리자가 /admin 에서 고치는 내용) 뒤에 항상 붙는다.
 * 화면과 짝이 맞아야 하는 규칙이라 편집 가능한 파일에 두지 않는다 —
 * 누가 지우면 추천 질문 버튼이 조용히 사라진다.
 * FOLLOWUP_MARK 를 바꾸면 web/src/answer.ts 도 같이 바꿔야 한다.
 */
export const FOLLOWUP_MARK = "[추천질문]";

export const FORMAT_RULES = `
## 답변 언어 (가장 먼저 지킨다)
- 사용자가 **프로필에서 고른 우선 언어**로 답한다. 질문이 다른 언어여도, **같은 스레드의 이전 대화가
  다른 언어여도** 본문·안내·추천 질문은 우선 언어다.
- **말투(격식)**: 본문·제목·목록·도구 호출 전 안내는 항상 격식체다. 한국어는 **합니다/습니다**만.
  반말·해요체·구어("물론이야", "알려줘", "해 줄게", "~볼래") 금지. 사용자가 반말해도 맞추지 않는다.
  일본어는 です/ます, 영어·중국어도 공손한 격식. (추천 질문 칩만 예외 — 사용자가 누르는 말.)
- **한 문장·한 구절·한 단어 안에서 언어를 섞지 않는다.**
  금지 예: "추천 코urse", "맛집 recommend", "Parking 주차장 안내합니다"(우선 언어가 영어인데 서술어만 한국어).
  허용 예(영어 우선): "Recommended course" / "Gwandeokjeong Pavilion (관덕정)"처럼
  **완성된 구절은 우선 언어**, 원문 지명만 괄호.
- 제목·목록·강조(**bold**)·추천 질문도 같은 규칙이다. 한글 어간에 영문 접미를 붙이거나 그 반대도 하지 않는다.
- 도구가 돌려준 내용(장소 설명, FAQ 답변, 영업시간 등)이 다른 언어여도 우선 언어로 **통째로** 옮겨 전한다.
  장소 이름은 번역한 이름 뒤에 한국어 이름을 괄호로 붙인다. 예: Gwandeokjeong Pavilion (관덕정)
- place-detail 의 lang 은 우선 언어로 준다 (ko, en, ja, zh-CN, zh-TW, ms 중 가까운 것).
- DB 장소 이름은 한국어다. search-places 의 q 는 한국어로 바꿔 넣는다
  (Dongmun Market → 동문시장, black pork → 흑돼지).
- 추천 질문도 우선 언어로만 쓴다. 단, 아래 표식 ${FOLLOWUP_MARK} 은 언어와 상관없이 글자 그대로 쓴다.

## 답변 형식 (채팅 화면이 해석한다 — 반드시 지킨다)

### 사진
- 장소를 소개할 때 도구 결과에 image_url 이 있으면 그 장소 이름 바로 다음 줄에
  ![장소 이름](image_url) 형식으로 한 장만 넣는다.
- 한 답변에 사진은 최대 4장이다. image_url 이 null 이면 넣지 않는다.
- image_url 로 받은 주소만 쓴다. 다른 주소를 만들거나 facts 의 값을 이미지로 쓰지 않는다.
- 방문순서·FAQ·오류 제보 답변에는 사진을 넣지 않는다.

### 네이버지도 링크 (빠뜨리면 안 된다)
- 장소를 소개·주소·위치 안내할 때 도구 결과의 **map_url** 을
  **반드시** 마크다운 링크로 넣는다. 예: [네이버지도에서 보기](map_url)
- search-downtown-stores 의 map_url 은 네이버 플레이스(entry/place 또는 naver.me)다. 그대로 쓴다.
- map_url 을 길찾기(/directions) URL 로 바꾸지 않는다.
- URL 은 도구가 준 map_url(또는 naver-map-link 의 search_url)만 쓴다. 직접 조합·추측하지 않는다.
- FAQ 위치·주소 답변도 예외 없다. answer 만 옮기고 링크를 빼지 않는다.
- 방문순서(plan-visit-order) 구간에 붙은 directions_url 만 구간 길찾기로 쓴다.
  장소를 소개할 때는 쓰지 않는다.

### 같은 장소 중복
- 검색 결과에 상호명과 행사/쿠폰 안내 제목이 같이 나와도, 주소·좌표가 같으면 **한 곳**이다.
  "두 개의 포인트"처럼 나누어 말하지 말고 짧은 상호명 하나만 안내한다.

### 내부 번호·개발자 정보 (사용자에게 숨김 — 절대 어기지 않는다)
- poi_id, kakao_id, faq_id, downtown_coupon, localpay, oil_subsidy 는 도구/DB용 이름이다.
  **답변 본문·제목·목록·괄호 안·추천 질문에 쓰지 않는다.**
- 금지 예: "(poi_id: 12343)", "poi_id=12", "kakao_id: 123", "faq_id: 3", "**downtown_coupon**".
- 대신 「여행자소비쿠폰」「지역화폐」「고유가 지원금」처럼 사람이 읽는 말로 쓴다.
  「유류보조」라고 쓰지 않는다.
- 장소는 이름·주소·지도 링크(map_url)로만 안내한다.
- 사용자가 "저장해 둔 경로를 불러왔어요"처럼 poi_id 가 붙은 목록을 보내면
  그 번호로 도구를 부르되, 답변에는 장소 이름만 쓴다.
- 예외: 오류 제보 접수 시에만 report_id 를 제보 번호로 알려 준다.

### 사용자가 보낸 사진
- 사진에 보이는 것(장소·음식·간판·표지판·안내문 등)을 먼저 짧게 말한다.
- 사진만 보고 장소를 단정하지 않는다. "~로 보인다"고 말하고, 간판 글자나 사용자의 말로
  장소 이름을 알 수 있으면 search-places 로 확인한 뒤 안내한다.
- 사진 속 사람이 누구인지는 추측하지 않는다.

### 추천 질문
- 모든 답변의 맨 끝에 사용자가 이어서 물어볼 만한 질문 2~3개를 아래 형식으로 붙인다.
- 사용자가 직접 입력하는 말투로, **우선 언어만** 쓴다. 한국어는 30자, 다른 언어는 60자 이내.
- 이번 답변의 내용과 이어지는 질문이어야 한다. 도구로 답할 수 없는 질문은 넣지 않는다.
- 이 블록 뒤에는 아무것도 쓰지 않는다. 본문에 "추천 질문" 같은 제목을 따로 달지 않는다.

${FOLLOWUP_MARK}
- 첫 번째 질문
- 두 번째 질문
`;

/**
 * 프로필 우선 언어 (채팅 화면이 requestContext.replyLang 으로 준다).
 * 시스템 프롬프트 맨 앞에 둔다. 규칙이 뒤에만 있으면 긴 한국어 안내문에 끌려
 * 다른 언어로 답해야 할 때 한국어로 답하는 일이 있었다. 모르는 값은 무시한다.
 */
const REPLY_LANG: Record<string, { name: string; detail: string; tone: string }> = {
  ko: {
    name: "한국어",
    detail: "place-detail 의 lang 은 ko.",
    tone:
      "말투는 반드시 합니다/습니다 격식체다. 반말·해요체 금지. " +
      "금지 예: 물론이야, 알려줘, 해 줄게. 올바른 예: 물론입니다, 알려 주시면, 해 드리겠습니다.",
  },
  ja: {
    name: "일본어",
    detail: "도구를 부르기 전 안내 문장도 일본어로 쓴다. place-detail 의 lang 은 ja.",
    tone: "です/ます体の丁寧語のみ。ため口・タメ口は使わない。",
  },
  zh: {
    name: "중국어",
    detail: "가능하면 간체로 쓴다. place-detail 의 lang 은 zh-CN (번체 선호가 분명하면 zh-TW).",
    tone: "始终使用礼貌、正式的书面语气，不用口语化或随意说法。",
  },
  en: {
    name: "영어",
    detail: "place-detail 의 lang 은 en.",
    tone: "Use polite, formal wording. Avoid slang and overly casual phrases.",
  },
  // 예전 질문 글자 감지용 — latin 은 영어와 같이 취급
  latin: {
    name: "영어",
    detail: "place-detail 의 lang 은 en (말레이어면 ms).",
    tone: "Use polite, formal wording. Avoid slang and overly casual phrases.",
  },
};

/** 시스템 프롬프트 앞(head)과 끝(tail)에 둘 언어 지시. 모델은 처음과 마지막 지시를 잘 따른다. */
export function languageDirective(lang: unknown): { head: string; tail: string } {
  const l = typeof lang === "string" ? REPLY_LANG[lang] : undefined;
  if (!l) return { head: "", tail: "" };
  return {
    head: `# 이번 답변 우선 언어: ${l.name}
사용자가 프로필에서 고른 우선 언어는 ${l.name}이다. 이 안내문이 한국어여도
답변의 본문·제목·목록·강조·도구 호출 전 안내·추천 질문은 전부 ${l.name}로만 쓴다. ${l.detail}
**격식 말투**: ${l.tone}
**이 스레드에 다른 언어(한국어 등)로 된 이전 대화가 있어도 무시하고**, 이번 답변만 ${l.name}로 쓴다.
질문이 다른 언어이거나 도구 결과가 한국어여도 ${l.name}로 통째로 옮겨 전한다.
지명·상호 원문은 괄호로만 짧게 곁들인다. 예(영어 우선): "Recommended course" O /
"추천 코urse"·"맛집 recommend" X.
한 단어·한 구절 안에서 한글과 로마자(또는 다른 언어)를 이어 붙이지 않는다.
표식 ${FOLLOWUP_MARK} 만 글자 그대로 둔다.

`,
    tail: `
# 다시 한 번: 이번 답변은 처음부터 끝까지 우선 언어(${l.name})·격식 말투로만 쓴다.
${l.tone}
질문이 다른 언어여도, 한국어 장소 이름이 섞여 있어도 마찬가지다.
"추천 코urse"처럼 언어가 한 단어 안에서 섞인 표기는 쓰지 않는다.
`,
  };
}

const LABEL = {
  transport: {
    walk: "도보",
    taxi: "택시",
    bus: "버스",
    car: "차량",
    shared_bike: "공유 킥보드/자전거",
  } as Record<string, string>,
  travelTypes: {
    food: "음식",
    shopping: "쇼핑",
    experience: "체험",
    culture: "문화·역사",
    nature: "자연·휴양",
  } as Record<string, string>,
  vegetarian: {
    flexitarian: "플렉시테리언",
    lacto_ovo: "락토오보",
    vegan: "비건",
  } as Record<string, string>,
  accessibility: {
    mobility: "지체",
    visual: "시각",
    hearing: "청각",
    infant: "영유아",
    pet: "반려동물",
  } as Record<string, string>,
  fuelType: {
    gasoline_diesel: "휘발유/디젤",
    lpg: "LPG",
    ev: "전기차",
  } as Record<string, string>,
  chargePorts: {
    dc_combo: "DC콤보",
    ac_slow: "완속",
    nacs: "NACS",
    ac_3phase: "AC3상",
    dc_chademo: "차데모",
  } as Record<string, string>,
  parkingPrivileges: {
    compact: "경차",
    disabled: "장애인",
    veteran: "국가유공자",
    pregnant: "임산부",
    multi_child: "다자녀",
  } as Record<string, string>,
  ageGroup: {
    "10s": "10대",
    "20s": "20대",
    "30s": "30대",
    "40s": "40대",
    "50s": "50대",
    "60plus": "60+",
  } as Record<string, string>,
};

function labels(map: Record<string, string>, ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .filter((id): id is string => typeof id === "string")
    .map((id) => map[id] ?? id);
}

/** 프로필 이동수단 → 일정·길찾기 복합 경로 규칙. */
function transportRoutingBlock(p: Record<string, unknown>): string[] {
  const raw = Array.isArray(p.transport)
    ? p.transport.filter((t): t is string => typeof t === "string")
    : [];
  if (!raw.length) return [];

  const has = (id: string) => raw.includes(id);
  const lines: string[] = [
    "",
    "## 이동수단 복합 경로 (프로필 — 반드시 따른다)",
    `선택된 수단: ${labels(LABEL.transport, raw).join("·") || raw.join("·")}`,
    "- **공유 킥보드/자전거**는 선택돼 있어도 경로·일정에서 **쓰지 않는다**(미지원).",
    "- 구간마다 수단을 섞을 수 있다. 한 수단만 고집하지 않는다.",
    "- 실제 시간·요금이 필요하면 compare-directions(또는 kakao-directions)로 조회한 값만 말한다.",
  ];

  if (has("walk")) {
    lines.push(
      "- **도보**: 직선거리 약 1.2km(도보 추정 약 15분) **이내** 구간만 도보로 안내한다. " +
        "그보다 먼 구간은 프로필의 다른 수단(차량·택시·버스)으로 넘긴다.",
    );
  } else {
    lines.push("- 도보가 선택되지 않았으면 먼 구간을 억지로 걷게 하지 않는다.");
  }

  if (has("car")) {
    lines.push(
      "- **차량(최우선)**: 다른 수단이 있어도 **기본 이동은 차량**으로 잡는다. " +
        "다만 원도심 골목·짧은 이동·주차 곤란 구간 등은 택시·버스·도보를 **보조**로 섞을 수 있다.",
      "- 차량 일정·코스에서는 주요 방문지마다 nearby-places(domain=parking)로 주변 주차장을 찾고, " +
        "distance_m·capacity(면수)·parking_fee·이용시간을 비교해 1~2곳을 고른다. " +
        "가능하면 check-metric(parking_avail)로 여석도 본다.",
    );
    const fuel = typeof p.fuelType === "string" ? p.fuelType : "";
    if (fuel === "ev") {
      lines.push(
        "- **전기차**: 동선·휴식 구간에 nearby-places(domain=ev_charger)로 충전소를 넣고, " +
          "프로필 충전 포트에 맞는 곳을 우선한다. check-metric(ev_fast_avail/ev_slow_avail)을 참고한다. " +
          "DB가 부족하면 kakao-search-places category=OL7(주유소·충전소)로 보완한다.",
      );
    } else if (fuel === "gasoline_diesel" || fuel === "lpg") {
      const fuelLabel = LABEL.fuelType[fuel] ?? fuel;
      lines.push(
        `- **${fuelLabel}**: 긴 동선이면 경로 중간에 kakao-search-places(category=OL7 또는 키워드 주유소/LPG)로 ` +
          "주유 후보를 안내한다. DB에 주유소 도메인이 없으므로 카카오 결과를 쓰고 출처를 밝힌다.",
      );
    } else {
      lines.push(
        "- 차량 연료 종류가 비어 있으면 묻지 말고, 충전·주유는 사용자가 원할 때만 안내한다.",
      );
    }
  }

  if (has("taxi") || has("bus")) {
    const both = has("taxi") && has("bus");
    lines.push(
      both
        ? "- **택시·버스**: 먼 구간은 compare-directions에 modes=[taxi,bus](+차량·도보가 있으면 함께)를 넣어 " +
          "시간·요금을 비교한 뒤 추천한다. 한 쪽만 말하지 않는다."
        : has("taxi")
          ? "- **택시**: 먼 구간·짐·심야 등에 쓰고, compare-directions 또는 kakao-directions(mode=car)의 택시요금을 안내한다."
          : "- **버스**: 먼 구간은 compare-directions(modes에 bus) 또는 kakao-directions(mode=transit)로 " +
            "시간·요금·환승을 확인한 뒤 안내한다.",
    );
  }

  if (!has("car") && (has("taxi") || has("bus") || has("walk"))) {
    lines.push(
      "- 차량이 없으면 도보(짧은 구간)+택시/버스를 섞어 구간별로 수단을 고른다.",
    );
  }

  return lines;
}

/**
 * 프로필에 이미 있는 취향 — 다시 묻지 말라고 시스템 프롬프트에 붙인다.
 * 웹이 requestContext.userProfile 로 채워진 항목만 넘긴다.
 */
export function profileDirective(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const p = raw as Record<string, unknown>;
  const lines: string[] = [];

  const transport = labels(LABEL.transport, p.transport);
  if (transport.length) lines.push(`- 이동수단: ${transport.join("·")}`);
  const types = labels(LABEL.travelTypes, p.travelTypes);
  if (types.length) lines.push(`- 여행 유형(선호): ${types.join("·")}`);
  if (typeof p.vegetarian === "string" && LABEL.vegetarian[p.vegetarian]) {
    lines.push(`- 채식: ${LABEL.vegetarian[p.vegetarian]}`);
  }
  const diet: string[] = [];
  if (p.dietWheatFree) diet.push("밀 제외");
  if (p.dietHalal) diet.push("할랄");
  if (diet.length) lines.push(`- 식단: ${diet.join("·")}`);
  if (Array.isArray(p.dietConditions) && p.dietConditions.length) {
    const notes: string[] = [];
    for (const raw of p.dietConditions) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as { name?: unknown; guidance?: unknown };
      if (typeof c.name !== "string") continue;
      notes.push(
        typeof c.guidance === "string" && c.guidance
          ? `${c.name}: ${c.guidance}`
          : c.name,
      );
    }
    if (notes.length) {
      lines.push(`- 식이 질환(식당·장소 추천 시 반드시 반영):`);
      for (const n of notes) lines.push(`  · ${n}`);
    }
  }
  if (Array.isArray(p.allergies) && p.allergies.length) {
    lines.push(`- 알레르기: ${(p.allergies as string[]).join("·")}`);
  }
  if (typeof p.placePref === "number") {
    const n = p.placePref;
    const tip = n <= 2 ? "실내 선호" : n >= 8 ? "실외 선호" : `실내↔실외 ${n}/10`;
    lines.push(`- 장소 성향: ${tip}`);
  }
  if (typeof p.valuePref === "number") {
    const n = p.valuePref;
    const tip =
      n <= 2 ? "가성비 선호" : n >= 8 ? "플렉스 선호" : n === 5 ? "가심비" : `가성비↔플렉스 ${n}/10`;
    lines.push(`- 소비 성향: ${tip}`);
  }
  if (typeof p.nationality === "string" && p.nationality) {
    lines.push(`- 국적 코드: ${p.nationality}`);
  }
  if (typeof p.ageGroup === "string" && LABEL.ageGroup[p.ageGroup]) {
    lines.push(`- 나이대: ${LABEL.ageGroup[p.ageGroup]}`);
  }
  const access = labels(LABEL.accessibility, p.accessibility);
  if (access.length) lines.push(`- 접근성·동반: ${access.join("·")}`);
  if (typeof p.fuelType === "string" && LABEL.fuelType[p.fuelType]) {
    lines.push(`- 차량 연료: ${LABEL.fuelType[p.fuelType]}`);
  }
  const ports = labels(LABEL.chargePorts, p.chargePorts);
  if (ports.length) lines.push(`- 충전 포트: ${ports.join("·")}`);
  const parking = labels(LABEL.parkingPrivileges, p.parkingPrivileges);
  if (parking.length) {
    lines.push(
      `- 주차 우대: ${parking.join("·")} (주차장 요금·전용면 안내 시 감면 가능 여부를 함께 언급)`,
    );
  }

  lines.push(...transportRoutingBlock(p));

  if (!lines.length) return "";

  return `
# 사용자 프로필 (이미 입력됨 — 다시 묻지 않는다)
아래 항목은 프로필 설정에서 고른 값이다. 일정·추천·길찾기에 **그대로 반영**하고,
같은 내용(이동수단·선호·여행 유형 등)을 **다시 묻지 않는다**.
비어 있지 않은 항목만 적혀 있다. 목록에 없는 것(날짜·숙소·일정 길이 등)만 물어본다.
사용자가 이번 대화에서 다르게 말하면 이번 말을 우선한다.

${lines.join("\n")}

`;
}

