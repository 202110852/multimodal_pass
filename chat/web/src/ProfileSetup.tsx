import { useState } from "react";
import { useAppLocale } from "./AppLocaleContext.js";
import {
  ACCESS_OPTS,
  AGE_GROUP_OPTS,
  ALLERGY_OPTS,
  CHARGE_PORT_OPTS,
  DIET_CONDITION_OPTS,
  FUEL_TYPE_OPTS,
  LANGUAGE_OPTS,
  PARKING_PRIVILEGE_OPTS,
  PLACE_PREF_DEFAULT,
  PLACE_PREF_MAX,
  PLACE_PREF_MIN,
  TRANSPORT_OPTS,
  TRAVEL_OPTS,
  VALUE_PREF_DEFAULT,
  VALUE_PREF_MAX,
  VALUE_PREF_MIN,
  VEGETARIAN_OPTS,
  draftFrom,
  saveProfile,
  skipProfile,
  type Accessibility,
  type AgeGroup,
  type Allergy,
  type ChargePort,
  type DietCondition,
  type FuelType,
  type Language,
  type NationalityCode,
  type ParkingPrivilege,
  type PlacePrefLevel,
  type Transport,
  type TravelType,
  type UserProfile,
  type ValuePrefLevel,
  type VegetarianLevel,
} from "./profile.js";
import { isAppLocale } from "./locale.js";
import { NationalitySelect } from "./NationalitySelect.js";
import { hostedChat } from "./embed.js";

/**
 * 복합경로 안내에서 쓰지 않는 취향 항목(국적·나이대·여행 유형·소비유형·실내/실외·식이).
 * 코드는 남겨 두고 화면에서만 숨긴다 — false 로 바꾸면 다시 보인다.
 */
const HIDE_UNUSED_SECTIONS = true;

function toggleIn<T>(list: T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function Chip({
  label,
  on,
  onClick,
  title,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button type="button" className={on ? "on" : ""} aria-pressed={on} title={title} onClick={onClick}>
      {label}
    </button>
  );
}

/** 새 대화 시작 시 취향을 받는 창. 카테고리마다 칩으로 고른다. */
export function ProfileSetup({
  initial,
  onDone,
}: {
  initial: UserProfile | null;
  onDone: (saved: UserProfile | null) => void;
}) {
  const { t, locale, setLocale } = useAppLocale();
  const p = t.profile;
  const [draft, setDraft] = useState(() => draftFrom(initial));

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    const hasCar = (draft.transport ?? []).includes("car");
    const isEv = hasCar && draft.fuelType === "ev";
    const language: Language | undefined =
      draft.language === "other" || isAppLocale(draft.language) ? draft.language : undefined;
    const profile: UserProfile = {
      ...draft,
      fuelType: hasCar ? draft.fuelType : undefined,
      chargePorts: isEv ? draft.chargePorts : [],
      parkingPrivileges: hasCar ? draft.parkingPrivileges ?? [] : [],
      language: hostedChat ? locale : language,
      updatedAt: Date.now(),
    };
    saveProfile(profile);
    onDone(profile);
  };

  const skip = () => {
    skipProfile();
    onDone(null);
  };

  const place = draft.placePref ?? PLACE_PREF_DEFAULT;
  const placeText = place < 5 ? p.indoor : place > 5 ? p.outdoor : p.mid;
  const value = draft.valuePref ?? VALUE_PREF_DEFAULT;
  const valueText = value < 5 ? p.valueForMoney : value > 5 ? p.valueFlex : p.valueHeart;

  return (
    <div className="profile-backdrop">
      <div className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <header className="profile-head">
          <div>
            <h2 id="profile-title">{p.title}</h2>
            <p>
              {p.desc1}
              <br />
              {p.desc2}
            </p>
          </div>
        </header>

        <div className="profile-body">
          {!hostedChat && <section className="profile-section">
            <h3>{p.language}</h3>
            <div className="profile-chips">
              {LANGUAGE_OPTS.map((o) => (
                <Chip
                  key={o.id}
                  label={p.languages[o.id]}
                  on={draft.language === o.id}
                  onClick={() => {
                    set("language", o.id as Language);
                    setLocale(o.id === "other" ? "en" : o.id);
                  }}
                />
              ))}
            </div>
            {draft.language === "other" && <p className="hint">{p.otherLangHint}</p>}
          </section>}

          <section className="profile-section" hidden={HIDE_UNUSED_SECTIONS}>
            <h3>{p.nationality}</h3>
            <NationalitySelect
              value={draft.nationality}
              onChange={(v) => set("nationality", v as NationalityCode | undefined)}
              labels={p.nationalities}
              placeholder={p.nationalityPlaceholder}
              clearLabel={p.nationalityClear}
              emptyLabel={p.nationalityEmpty}
              aria-label={p.nationality}
            />
          </section>

          <section className="profile-section" hidden={HIDE_UNUSED_SECTIONS}>
            <h3>{p.ageGroup}</h3>
            <div className="profile-chips">
              {AGE_GROUP_OPTS.map((o) => (
                <Chip
                  key={o.id}
                  label={p.ageGroups[o.id]}
                  on={draft.ageGroup === o.id}
                  onClick={() =>
                    set("ageGroup", (draft.ageGroup === o.id ? undefined : o.id) as AgeGroup | undefined)
                  }
                />
              ))}
            </div>
          </section>

          <section className="profile-section">
            <h3>{p.access}</h3>
            <p className="hint">{p.accessHint}</p>
            <div className="profile-chips">
              {ACCESS_OPTS.map((o) => (
                <Chip
                  key={o.id}
                  label={p.accessOpts[o.id].label}
                  title={p.accessOpts[o.id].hint}
                  on={(draft.accessibility ?? []).includes(o.id)}
                  onClick={() => set("accessibility", toggleIn(draft.accessibility ?? [], o.id as Accessibility))}
                />
              ))}
            </div>
          </section>

          <section className="profile-section">
            <h3>{p.transport}</h3>
            <p className="hint">{p.transportHint}</p>
            <div className="profile-chips">
              {TRANSPORT_OPTS.map((o) => (
                <Chip
                  key={o.id}
                  label={p.transports[o.id]}
                  on={(draft.transport ?? []).includes(o.id)}
                  onClick={() => set("transport", toggleIn(draft.transport ?? [], o.id as Transport))}
                />
              ))}
            </div>
          </section>

          {(draft.transport ?? []).includes("car") && (
            <>
              <section className="profile-section">
                <h3>{p.fuel}</h3>
                <div className="profile-chips">
                  {FUEL_TYPE_OPTS.map((o) => (
                    <Chip
                      key={o.id}
                      label={p.fuels[o.id]}
                      on={draft.fuelType === o.id}
                      onClick={() =>
                        set("fuelType", (draft.fuelType === o.id ? undefined : o.id) as FuelType | undefined)
                      }
                    />
                  ))}
                </div>
                {draft.fuelType === "ev" && (
                  <>
                    <p className="hint">{p.chargePorts}</p>
                    <div className="profile-chips">
                      {CHARGE_PORT_OPTS.map((o) => (
                        <Chip
                          key={o.id}
                          label={p.charges[o.id]}
                          on={(draft.chargePorts ?? []).includes(o.id)}
                          onClick={() => set("chargePorts", toggleIn(draft.chargePorts ?? [], o.id as ChargePort))}
                        />
                      ))}
                    </div>
                  </>
                )}
              </section>

              <section className="profile-section">
                <h3>{p.parkingPrivilege}</h3>
                <p className="hint">{p.parkingPrivilegeHint}</p>
                <div className="profile-chips">
                  {PARKING_PRIVILEGE_OPTS.map((o) => (
                    <Chip
                      key={o.id}
                      label={p.parkingPrivileges[o.id]}
                      on={(draft.parkingPrivileges ?? []).includes(o.id)}
                      onClick={() =>
                        set(
                          "parkingPrivileges",
                          toggleIn(draft.parkingPrivileges ?? [], o.id as ParkingPrivilege),
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            </>
          )}

          <section className="profile-section" hidden={HIDE_UNUSED_SECTIONS}>
            <h3>{p.travelTypes}</h3>
            <p className="hint">{p.travelHint}</p>
            <div className="profile-chips">
              {TRAVEL_OPTS.map((o) => (
                <Chip
                  key={o.id}
                  label={p.travels[o.id]}
                  on={(draft.travelTypes ?? []).includes(o.id)}
                  onClick={() => set("travelTypes", toggleIn(draft.travelTypes ?? [], o.id as TravelType))}
                />
              ))}
            </div>
          </section>

          <section className="profile-section" hidden={HIDE_UNUSED_SECTIONS}>
            <h3>{p.valuePref}</h3>
            <div className="profile-slider">
              <input
                type="range"
                min={VALUE_PREF_MIN}
                max={VALUE_PREF_MAX}
                step={1}
                value={value}
                aria-label={p.valuePref}
                aria-valuetext={valueText}
                onChange={(e) => set("valuePref", Number(e.target.value) as ValuePrefLevel)}
              />
            </div>
            <div className="profile-slider-labels" aria-hidden="true">
              <span>{p.valueForMoney}</span>
              <span>{p.valueHeart}</span>
              <span>{p.valueFlex}</span>
            </div>
          </section>

          <section className="profile-section" hidden={HIDE_UNUSED_SECTIONS}>
            <h3>{p.placePref}</h3>
            <div className="profile-slider">
              <input
                type="range"
                min={PLACE_PREF_MIN}
                max={PLACE_PREF_MAX}
                step={1}
                value={place}
                aria-label={p.placePref}
                aria-valuetext={placeText}
                onChange={(e) => set("placePref", Number(e.target.value) as PlacePrefLevel)}
              />
            </div>
            <div className="profile-slider-labels" aria-hidden="true">
              <span>{p.indoor}</span>
              <span>{p.mid}</span>
              <span>{p.outdoor}</span>
            </div>
          </section>

          <section className="profile-section" hidden={HIDE_UNUSED_SECTIONS}>
            <h3>{p.diet}</h3>
            <p className="hint">{p.dietHint}</p>
            <div className="profile-chips">
              <Chip
                label={p.vegNone}
                on={draft.vegetarian === null || draft.vegetarian === undefined}
                onClick={() => set("vegetarian", null)}
              />
              {VEGETARIAN_OPTS.map((o) => (
                <Chip
                  key={o.id}
                  label={p.veg[o.id]}
                  on={draft.vegetarian === o.id}
                  onClick={() => set("vegetarian", (draft.vegetarian === o.id ? null : o.id) as VegetarianLevel | null)}
                />
              ))}
            </div>
            <div className="profile-chips">
              <Chip
                label={p.wheatFree}
                on={Boolean(draft.dietWheatFree)}
                onClick={() => set("dietWheatFree", !draft.dietWheatFree)}
              />
              <Chip label="Halal" on={Boolean(draft.dietHalal)} onClick={() => set("dietHalal", !draft.dietHalal)} />
            </div>
            <p className="hint">{p.conditionHint}</p>
            <div className="profile-chips">
              {DIET_CONDITION_OPTS.map((o) => (
                <Chip
                  key={o.id}
                  label={p.conditions[o.id]}
                  on={(draft.dietConditions ?? []).includes(o.id)}
                  onClick={() =>
                    set("dietConditions", toggleIn(draft.dietConditions ?? [], o.id as DietCondition))
                  }
                />
              ))}
            </div>
            <p className="hint">{p.allergyHint}</p>
            <div className="profile-chips">
              {ALLERGY_OPTS.map((o) => (
                <Chip
                  key={o.id}
                  label={p.allergies[o.id]}
                  on={(draft.allergies ?? []).includes(o.id)}
                  onClick={() => set("allergies", toggleIn(draft.allergies ?? [], o.id as Allergy))}
                />
              ))}
            </div>
          </section>
        </div>

        <footer className="profile-foot">
          <button type="button" className="ghost" onClick={skip}>
            {p.later}
          </button>
          <button type="button" className="primary" onClick={save}>
            {p.save}
          </button>
        </footer>
      </div>
    </div>
  );
}
