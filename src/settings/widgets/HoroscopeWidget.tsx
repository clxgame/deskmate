import { useId, useState } from "react";
import { horoscopeContent } from "../../lib/horoscope/content";
import { ZODIAC_SIGNS, ZODIAC_SYMBOLS, isZodiacSign, type ZodiacSign } from "../../lib/horoscope/zodiac";
import type { Fortune } from "../../lib/horoscope/types";
import type { Settings } from "../../lib/settings";
import type { Patch } from "../settingsPrimitives";
import { horoscopeLabels, type HoroscopeLabels } from "./horoscopeLabels";
import { useDailyHoroscope } from "./useDailyHoroscope";
import "./horoscope.css";

function Rating({ label, value, labels }: { readonly label: string; readonly value: number; readonly labels: HoroscopeLabels }) {
  return <div className="set-horoscope-rating">
    <span className="set-horoscope-rating-label">{label}</span>
    <span role="img" aria-label={labels.starRating(label, value)} className="set-horoscope-stars">
      <span aria-hidden="true">{"★".repeat(value)}{"☆".repeat(5 - value)}</span>
    </span>
  </div>;
}

function formatLocalDate(dateKey: string, language: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const locale = ["zh-CN", "en-US", "ja-JP", "ko-KR"].includes(language) ? language : "zh-CN";
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" })
    .format(new Date(year, month - 1, day));
}

export function HoroscopeWidget({ settings, patch }: { readonly settings: Settings; readonly patch: Patch }) {
  const daily = useDailyHoroscope();
  const [selectedSign, setSelectedSign] = useState<ZodiacSign | null>(null);
  const id = useId();
  const labels = horoscopeLabels(settings.language);
  const content = horoscopeContent(settings.language);
  const mySign = isZodiacSign(settings.horoscopeSign) ? settings.horoscopeSign : null;
  const shownSign = selectedSign ?? daily.topSign;
  const fortune = daily.fortunes.find((item) => item.sign === shownSign) as Fortune;
  const signName = labels.zodiac[shownSign];

  return <section className="set-horoscope" aria-labelledby={`${id}-title`}>
    <header className="set-horoscope-header">
      <h3 id={`${id}-title`}>{labels.featureTitle}</h3>
      <time dateTime={daily.date}>{formatLocalDate(daily.date, settings.language)}</time>
    </header>

    <label className="set-horoscope-preference" htmlFor={`${id}-sign`}>
      <span>{labels.mySign}</span>
      <select id={`${id}-sign`} className="set-select" value={mySign ?? ""}
        onChange={(event) => patch("horoscopeSign", isZodiacSign(event.currentTarget.value) ? event.currentTarget.value : null)}>
        <option value="">{labels.unset}</option>
        {ZODIAC_SIGNS.map((sign) => <option key={sign} value={sign}>{labels.zodiac[sign]}</option>)}
      </select>
    </label>

    <div className="set-horoscope-shortcuts" role="group" aria-label={labels.featureTitle}>
      <button type="button" className="set-horoscope-shortcut" aria-pressed={selectedSign === null}
        onClick={() => setSelectedSign(null)}>{labels.topToday} · {labels.zodiac[daily.topSign]}</button>
      {mySign !== null && <button type="button" className="set-horoscope-shortcut"
        aria-pressed={selectedSign === mySign} onClick={() => setSelectedSign(mySign)}>
        {labels.myFortune} · {labels.zodiac[mySign]}
      </button>}
    </div>

    <article className="set-horoscope-detail" aria-label={signName}>
      <header className="set-horoscope-detail-head">
        <div className="set-horoscope-identity">
          <span className="set-horoscope-symbol" aria-hidden="true">{ZODIAC_SYMBOLS[shownSign]}</span>
          <h4>{signName}</h4>
        </div>
        {shownSign === daily.topSign && <span className="set-horoscope-badge">✦ {labels.topBadge}</span>}
      </header>
      <div className="set-horoscope-ratings">
        <Rating label={labels.overall} value={fortune.displayStars} labels={labels} />
        <Rating label={labels.career} value={fortune.career} labels={labels} />
        <Rating label={labels.love} value={fortune.love} labels={labels} />
        <Rating label={labels.wealth} value={fortune.wealth} labels={labels} />
        <Rating label={labels.energy} value={fortune.energy} labels={labels} />
      </div>
      <dl className="set-horoscope-facts">
        <div><dt>{labels.advice}</dt><dd>{fortune.adviceIds.map((item) => content.advice[item]).join(" · ")}</dd></div>
        <div><dt>{labels.caution}</dt><dd>{content.cautions[fortune.cautionId]}</dd></div>
        <div><dt>{labels.luckyColor}</dt><dd>{content.colors[fortune.luckyColorId]}</dd></div>
        <div><dt>{labels.luckyNumber}</dt><dd>{fortune.luckyNumber}</dd></div>
      </dl>
      <p className="set-horoscope-message"><strong>{labels.yumeSays}: </strong>{content.messages[fortune.messageId]}</p>
    </article>

    <section className="set-horoscope-all" aria-labelledby={`${id}-all`}>
      <h4 id={`${id}-all`}>{labels.allSigns}</h4>
      <div className="set-horoscope-signs">
        {ZODIAC_SIGNS.map((sign) => {
          const item = daily.fortunes.find((entry) => entry.sign === sign) as Fortune;
          return <button key={sign} type="button" className="set-horoscope-sign"
            aria-pressed={shownSign === sign} onClick={() => setSelectedSign(sign)}
            aria-label={`${labels.zodiac[sign]} · ${labels.starRating(labels.overall, item.displayStars)}${sign === daily.topSign ? ` · ${labels.topBadge}` : ""}`}>
            <span><span aria-hidden="true">{ZODIAC_SYMBOLS[sign]}</span> {labels.zodiac[sign]}{sign === daily.topSign && <span className="set-horoscope-top-mark" aria-hidden="true"> ✦</span>}</span>
            <span aria-hidden="true" className="set-horoscope-sign-stars">{"★".repeat(item.displayStars)}{"☆".repeat(5 - item.displayStars)}</span>
          </button>;
        })}
      </div>
    </section>
  </section>;
}
