import { config } from "../../config.ts";
import type { Qualification } from "../../qualify/classify.ts";
import { detectDominantLanguage } from "../../qualify/classify.ts";
import { formatIst } from "../../schedule/parseTime.ts";
import { activeProject } from "./project.ts";

export type Lang = "en" | "hi" | "te";

export function langOf(q: Qualification): Lang {
  return detectDominantLanguage(
    [q.quotes.join(" "), q.locality, q.bhk, q.barrier, q.timeline, q.budget, q.endUse],
    q.language,
  );
}

export function callSlip(q: Qualification) {
  const p = activeProject();
  return {
    lang: langOf(q),
    heat: q.classification,
    sells: q.locality || p.city,
    pieces: q.bhk,
    liveBy: q.timeline,
    budget: q.budget,
    asked: q.endUse,
    holdUp: q.barrier,
    said: q.quotes[0],
    project: p.name,
  };
}

function facts(lang: Lang, q: Qualification): string[] {
  const p = activeProject();
  const rows: Array<[string, string | undefined]> =
    lang === "hi"
      ? [
          ["project", p.name],
          ["city", p.city],
          ["area", q.locality],
          ["BHK", q.bhk],
          ["budget", q.budget],
          ["kab chahiye", q.timeline],
          ["rehna / invest", q.endUse],
          ["rukawat", q.barrier],
        ]
      : lang === "te"
        ? [
            ["project", p.name],
            ["city", p.city],
            ["area", q.locality],
            ["BHK", q.bhk],
            ["budget", q.budget],
            ["eppudu", q.timeline],
            ["stay / invest", q.endUse],
            ["aagindi", q.barrier],
          ]
        : [
            ["project", p.name],
            ["city", p.city],
            ["locality", q.locality],
            ["BHK", q.bhk],
            ["budget", q.budget],
            ["timeline", q.timeline],
            ["stay / invest", q.endUse],
            ["hold-up", q.barrier],
          ];
  return rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
}

export function midCallMessage(q: Qualification): string {
  const p = activeProject();
  const lang = langOf(q);
  const open =
    lang === "hi"
      ? `call pe hi hoon — ${p.name} ka brochure WhatsApp pe daal rahi hoon, phone dekho`
      : lang === "te"
        ? `call lo ne unnanu — ${p.name} brochure WhatsApp lo pampistunnanu, phone choodandi`
        : `still on the line — sending the ${p.name} brochure on WhatsApp, glance at your phone`;
  const visit = q.visitAt
    ? lang === "hi"
      ? `site visit: ${q.visitAt}`
      : lang === "te"
        ? `site visit: ${q.visitAt}`
        : `site visit: ${q.visitAt}`
    : undefined;
  const close =
    lang === "hi"
      ? `${p.rmName}  ${p.rmPhone}\nlocation: ${p.locationPin}\ncontact save kar lo.`
      : lang === "te"
        ? `${p.rmName}  ${p.rmPhone}\nlocation: ${p.locationPin}\ncontact save chesukondi.`
        : `${p.rmName}  ${p.rmPhone}\nlocation: ${p.locationPin}\nsave the contact.`;
  return [open, "", ...facts(lang, q), visit, q.quotes[0] ? (lang === "hi" ? `tumne kaha: “${q.quotes[0]}”` : lang === "te" ? `meeru chepparu: “${q.quotes[0]}”` : `you said: “${q.quotes[0]}”`) : null, "", close]
    .filter((x) => x !== null && x !== undefined)
    .join("\n");
}

export function followUpMessage(
  q: Qualification,
  extra?: { callbackAt?: Date; visitAt?: Date; midCallAlready?: boolean },
): string {
  const p = activeProject();
  const lang = langOf(q);
  if (extra?.midCallAlready) {
    return lang === "hi"
      ? `call khatam. brochure wahi hai.\n${p.rmPhone}`
      : lang === "te"
        ? `call aipoindi. brochure ade.\n${p.rmPhone}`
        : `that's the same brochure from the call.\n${p.rmPhone}`;
  }
  const open =
    lang === "hi" ? "abhi call hua — yeh note rakh rahi hoon" : lang === "te" ? "ippude call ayindi — ee note pettukondi" : "just got off the call — parking this here";
  const when = extra?.visitAt ?? extra?.callbackAt;
  let next: string;
  if (q.classification === "hot") {
    next = when
      ? lang === "hi"
        ? `site visit: ${formatIst(when)}`
        : lang === "te"
          ? `site visit: ${formatIst(when)}`
          : `site visit: ${formatIst(when)}`
      : lang === "hi"
        ? "jab aana ho, isi number pe."
        : lang === "te"
          ? "ravalante ee number meeda."
          : "when you want to walk the site, this number.";
  } else if (q.classification === "warm") {
    next = extra?.callbackAt
      ? lang === "hi"
        ? `wapas call: ${formatIst(extra.callbackAt)} — jaise bola.`
        : lang === "te"
          ? `malli call: ${formatIst(extra.callbackAt)} — meeru cheppinattu.`
          : `I'll call back ${formatIst(extra.callbackAt)}, as you said.`
      : lang === "hi"
        ? "jab family se baat ho jaye, time bhej dena."
        : lang === "te"
          ? "family tho matladaka time pampandi."
          : "when you've talked at home, send a time.";
  } else {
    next = lang === "hi" ? "koi zor nahi." : lang === "te" ? "pressure ledu." : "no chase from me.";
  }
  const factLines = facts(lang, q);
  return [
    open,
    "",
    factLines.length ? factLines.join("\n") : lang === "hi" ? "is call pe locality/BHK nahi aaya." : lang === "te" ? "ee call lo locality/BHK raaledu." : "we didn't get locality or BHK on this one.",
    "",
    next,
    "",
    p.rmName,
    p.rmPhone,
    p.locationPin,
  ]
    .filter((x) => x !== null && x !== undefined)
    .join("\n");
}

export function coldBrochure(q?: Qualification): string {
  const p = activeProject();
  const lang = q ? langOf(q) : "en";
  if (lang === "hi") {
    return `theek hai — abhi zarurat nahi.\n\n${p.name}, ${p.city}. ${p.bhkMix}. ${config.reRmPhone}`;
  }
  if (lang === "te") {
    return `sare — ippudu avasaram ledu.\n\n${p.name}, ${p.city}. ${p.bhkMix}. ${config.reRmPhone}`;
  }
  return `all good — no need right now.\n\n${p.name}, ${p.city}. ${p.bhkMix}. ${config.reRmPhone}`;
}

export function cloudTemplateVars(q: Qualification, slotLabel?: string) {
  const p = activeProject();
  return {
    project: p.name,
    builder: p.builder,
    city: p.city,
    rm: p.rmPhone,
    pin: p.locationPin,
    slot: slotLabel ?? "",
    bhk: q.bhk ?? p.bhkMix,
  };
}
