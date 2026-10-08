import { config } from "../config.ts";
import { detectDominantLanguage, type Qualification } from "../qualify/classify.ts";
import { formatIst } from "../schedule/parseTime.ts";

export type Lang = "en" | "hi" | "te";

export type CallSlip = {
  lang: Lang;
  heat: Qualification["classification"];
  sells?: string;
  pieces?: string;
  liveBy?: string;
  budget?: string;
  asked?: string;
  holdUp?: string;
  said?: string;
  festival?: string;
};

export function langOf(q: Qualification): Lang {
  return detectDominantLanguage(
    [q.quotes.join(" "), q.products, q.barrier, q.features, q.timeline, q.budget],
    q.language,
  );
}

function festivalNote(timeline: string | undefined, lang: Lang): string | undefined {
  if (!timeline) return;
  const t = timeline.toLowerCase();
  if (/diwali|deepavali|दीवाली|దీపావళి/.test(t)) {
    if (lang === "hi") return "Diwali se pehle live = catalog October pehle freeze. Baad mein extras daal sakte ho.";
    if (lang === "te") return "Diwali mundu live ayithe catalog October lo lock. Tarvata add cheyochu.";
    return "Diwali live means the catalog has to freeze by early October. Extra SKUs can wait.";
  }
  if (/sankranti|pongal|ugadi|sankranthi/.test(t)) {
    if (lang === "hi") return "Sankranti/Ugadi window short hai — pehle catalog, phir offers.";
    if (lang === "te") return "Sankranti/Ugadi window chinna di — mundu catalog, tarvata offers.";
    return "Sankranti/Ugadi is a short window — catalog first, offers second.";
  }
  if (/navratri|durga puja|dussehra/.test(t)) {
    if (lang === "hi") return "Navratri rush se pehle payment + size chart lock karna.";
    if (lang === "te") return "Navratri rush mundu payment + size chart lock.";
    return "Lock payments and the size chart before the Navratri rush, not during it.";
  }
  if (/\beid\b|ramzan|ramadan/.test(t)) {
    if (lang === "hi") return "Eid se pehle COD + courier slots nikal jaate hain. Site usse pehle.";
    if (lang === "te") return "Eid mundu COD + courier slots fill. Site daani mundu.";
    return "COD and courier slots fill before Eid. The site has to be up before that scramble.";
  }
  return;
}

export function callSlip(q: Qualification): CallSlip {
  const lang = langOf(q);
  return {
    lang,
    heat: q.classification,
    sells: q.products,
    pieces: q.catalogSize,
    liveBy: q.timeline,
    budget: q.budget,
    asked: q.features,
    holdUp: q.barrier,
    said: q.quotes[0],
    festival: festivalNote(q.timeline, lang),
  };
}

function facts(lang: Lang, slip: CallSlip): string[] {
  const rows: Array<[string, string | undefined]> =
    lang === "hi"
      ? [
          ["bechte ho", slip.sells],
          ["pieces", slip.pieces],
          ["live", slip.liveBy],
          ["budget", slip.budget],
          ["maanga", slip.asked],
          ["rukawat", slip.holdUp],
        ]
      : lang === "te"
        ? [
            ["ammutunnaru", slip.sells],
            ["pieces", slip.pieces],
            ["live", slip.liveBy],
            ["budget", slip.budget],
            ["adigaaru", slip.asked],
            ["aagindi", slip.holdUp],
          ]
        : [
            ["you sell", slip.sells],
            ["pieces", slip.pieces],
            ["live by", slip.liveBy],
            ["budget", slip.budget],
            ["you asked", slip.asked],
            ["hold-up", slip.holdUp],
          ];
  return rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
}

function saidLine(lang: Lang, said?: string): string | null {
  if (!said) return null;
  if (lang === "hi") return `tumne kaha: “${said}”`;
  if (lang === "te") return `meeru chepparu: “${said}”`;
  return `you said: “${said}”`;
}

export function midCallMessage(q: Qualification): string {
  const slip = callSlip(q);
  const lang = slip.lang;
  const open =
    lang === "hi"
      ? "call pe hi hoon — WhatsApp pe daal rahi hoon, phone dekho"
      : lang === "te"
        ? "call lo ne unnanu — WhatsApp lo pampistunnanu, phone choodandi"
        : "still on the line — putting this on WhatsApp, glance at your phone";
  const close =
    lang === "hi"
      ? `${config.candidateName}  ${config.candidatePhone}\ncontact save kar lo.`
      : lang === "te"
        ? `${config.candidateName}  ${config.candidatePhone}\ncontact save chesukondi.`
        : `${config.candidateName}  ${config.candidatePhone}\nsave the contact.`;
  return [open, "", ...facts(lang, slip), saidLine(lang, slip.said), slip.festival, "", close].filter((x) => x !== null && x !== undefined).join("\n");
}

export function followUpMessage(q: Qualification, extra?: { callbackAt?: Date; visitAt?: Date; midCallAlready?: boolean }): string {
  const slip = callSlip(q);
  const lang = slip.lang;
  if (extra?.midCallAlready) {
    return lang === "hi"
      ? `call khatam. jo bheja tha wahi hai.\n${config.candidatePhone}`
      : lang === "te"
        ? `call aipoindi. pampinadi ade.\n${config.candidatePhone}`
        : `that's the same packet from the call.\n${config.candidatePhone}`;
  }

  const open =
    lang === "hi" ? "abhi call hua — yeh note rakh rahi hoon" : lang === "te" ? "ippude call ayindi — ee note pettukondi" : "just got off the call — parking this here";

  let next: string;
  if (q.classification === "hot") {
    next =
      lang === "hi"
        ? "scope lock karna ho to isi number pe."
        : lang === "te"
          ? "scope lock cheyali ante ee number meeda."
          : "when you want to lock scope, this number.";
  } else if (q.classification === "warm") {
    next = extra?.callbackAt
      ? lang === "hi"
        ? `wapas call: ${formatIst(extra.callbackAt)} — jaise bola.`
        : lang === "te"
          ? `malli call: ${formatIst(extra.callbackAt)} — meeru cheppinattu.`
          : `I'll call back ${formatIst(extra.callbackAt)}, as you said.`
      : lang === "hi"
        ? "jab rukawat hat jaye, time bhej dena."
        : lang === "te"
          ? "aagindi poothe time pampandi."
          : "when the hold-up clears, send a time.";
  } else {
    next = lang === "hi" ? "koi zor nahi." : lang === "te" ? "pressure ledu." : "no chase from me.";
  }

  const factLines = facts(lang, slip);
  return [
    open,
    "",
    factLines.length ? factLines.join("\n") : lang === "hi" ? "is call pe catalog/budget nahi aaya." : lang === "te" ? "ee call lo catalog/budget raaledu." : "we didn't get catalog or budget on this one.",
    saidLine(lang, slip.said),
    slip.festival,
    "",
    next,
    "",
    `${config.candidateName}`,
    config.candidatePhone,
  ]
    .filter((x) => x !== null && x !== undefined)
    .join("\n");
}

export function coldBrochure(q?: Qualification): string {
  const lang = q ? langOf(q) : "en";
  const n = config.candidatePhone;
  if (lang === "hi") {
    return `theek hai — abhi zarurat nahi.\n\nagar baad mein shop socho:\ncatalog, Razorpay, courier, admin. ${config.candidateName} ${n}`;
  }
  if (lang === "te") {
    return `sare — ippudu avasaram ledu.\n\ntarvata shop kavali ante:\ncatalog, Razorpay, courier, admin. ${config.candidateName} ${n}`;
  }
  return `all good — no need right now.\n\nif a shop comes up later:\ncatalog, Razorpay, courier, admin. ${config.candidateName} ${n}`;
}
