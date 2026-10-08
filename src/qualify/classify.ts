export type LeadClass = "hot" | "warm" | "cold";

export type Qualification = {
  classification: LeadClass;
  confidence: number;
  reasons: string[];
  budget?: string;
  products?: string;
  catalogSize?: string;
  timeline?: string;
  features?: string;
  barrier?: string;
  quotes: string[];
  language?: string;
  bhk?: string;
  locality?: string;
  endUse?: string;
  visitAt?: string;
};

const HOT = [
  /send (me )?(the )?(details|info|brochure|quote)/i,
  /share (the )?(details|pricing|price|quote)/i,
  /whatsapp/i,
  /how soon can you start/i,
  /when can you (start|begin|deliver)/i,
  /let'?s (do|go|proceed|start)/i,
  /go ahead/i,
  /i want (it|this|to (go|proceed|start))/i,
  /book (it|this|us)/i,
  /ready to (start|buy|go)/i,
  /price (kya|kya hai|please)/i,
  /details (bhej|bhej do|bhejo)/i,
  /jaldi start/i,
  /karwa (lete|do)/i,
  /pampandi/i,
  /start chey/i,
  /screenshot (bhej|pampandi)/i,
  /number (note|save|likh)/i,
  /cheppandi/i,
];

const WARM = [
  /brother/i,
  /partner (handles|decides|will)/i,
  /someone else (handles|decides)/i,
  /not much (budget|right now)/i,
  /budget (is )?(tight|low|not much)/i,
  /later/i,
  /next (month|quarter|year)/i,
  /have to (think|discuss|check)/i,
  /need to discuss/i,
  /after (diwali|festival|season)/i,
  /bhai dekhega/i,
  /abhi budget/i,
];

const COLD = [
  /just looking/i,
  /only (looking|research)/i,
  /no (need|budget|requirement)/i,
  /not interested/i,
  /wrong number/i,
  /no website/i,
  /sirf dekh/i,
  /zarurat nahi/i,
];

function hits(text: string, patterns: RegExp[]): string[] {
  return patterns.filter((p) => p.test(text)).map((p) => p.source);
}

function salvageQuotes(utterances: string | undefined): string[] {
  if (!utterances) return [];
  return utterances
    .split(/[\n|]/)
    .map((s) => s.replace(/^["“]|["”]$/g, "").trim())
    .filter((s) => s.length > 6 && s.length < 160)
    .filter((s) =>
      /bhej|pampandi|details|price|chahiye|start|whatsapp|budget|saree|catalog|diwali|karwa|screenshot/i.test(s),
    )
    .slice(0, 3);
}

const HI_ROMAN =
  /\b(hai|haan|haanji|kya|kyaa|bhej|bhejo|bhejdo|theek|accha|acha|nahi|nahin|kal|subah|aap|tum|main|hum|karo|karna|chahiye|kitna|kaise|kyun|mat|bas|sahi|bilkul|abhi|baad|pehle|wala|wali|bolo|sun|dekho|zarurat|theekhai)\b/gi;
const TE_ROMAN =
  /\b(undi|unnadi|pampandi|cheyandi|avunu|kadhu|kaadu|meeru|nenu|repu|ela|enti|cheppu|cheppandi|sare|avuna|ledu|kavali|ippudu|tarvata|mundu|cheyali|pampistunnanu)\b/gi;
const EN_ROMAN =
  /\b(the|and|you|your|what|how|when|yes|yeah|okay|please|want|need|can|will|just|about|this|that|have|don't|not|got|two|minutes|website|shop|calling)\b/gi;

function countRe(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

/** Majority language by words/script. Tie or empty → English. */
export function detectDominantLanguage(parts: Array<string | undefined>, hinted?: string): "en" | "hi" | "te" {
  const blob = parts.filter(Boolean).join("\n");
  const teScript = (blob.match(/[\u0C00-\u0C7F]/g) ?? []).length / 3;
  const hiScript = (blob.match(/[\u0900-\u097F]/g) ?? []).length / 3;
  const te = teScript + countRe(blob, TE_ROMAN);
  const hi = hiScript + countRe(blob, HI_ROMAN);
  const en = countRe(blob, EN_ROMAN);
  const hint = (hinted ?? "").toLowerCase();
  const bonus = 1.2;
  const scores = {
    te: te + (hint.startsWith("te") || hint.includes("telugu") ? bonus : 0),
    hi: hi + (hint.startsWith("hi") || hint.includes("hindi") ? bonus : 0),
    en: en + (hint.startsWith("en") || hint.includes("english") ? bonus : 0),
  };
  const max = Math.max(scores.en, scores.hi, scores.te);
  if (max <= 0) return "en";
  const winners = (["en", "hi", "te"] as const).filter((k) => scores[k] === max);
  if (winners.length !== 1) return "en";
  return winners[0];
}

export function classifyLead(input: {
  agentLabel?: string;
  utterances?: string;
  budget?: string;
  products?: string;
  timeline?: string;
  features?: string;
  barrier?: string;
  quotes?: string[];
  askedForDetails?: boolean | string;
  language?: string;
  bhk?: string;
  locality?: string;
  endUse?: string;
}): Qualification {
  const blob = [
    input.utterances,
    input.budget,
    input.products,
    input.timeline,
    input.features,
    input.barrier,
    ...(input.quotes ?? []),
    String(input.askedForDetails ?? ""),
    input.agentLabel ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  const quotes = [...(input.quotes ?? []).map((q) => q.trim()).filter(Boolean), ...salvageQuotes(input.utterances)].filter(
    (q, i, a) => a.findIndex((x) => x.toLowerCase() === q.toLowerCase()) === i,
  );
  const hotHits = hits(blob, HOT);
  const warmHits = hits(blob, WARM);
  const coldHits = hits(blob, COLD);
  const asked =
    input.askedForDetails === true ||
    /true|yes|1/i.test(String(input.askedForDetails ?? "")) ||
    /send|share|details|whatsapp|quote|price/i.test(blob);

  let classification: LeadClass = "cold";
  const reasons: string[] = [];

  if (hotHits.length || asked) {
    classification = "hot";
    if (asked) reasons.push("Asked for details, price, or WhatsApp during the call");
    if (hotHits.length) reasons.push(`High-intent phrasing: ${hotHits.slice(0, 2).join(", ")}`);
  } else if (warmHits.length || input.barrier) {
    classification = "warm";
    reasons.push(input.barrier ? `Barrier captured: ${input.barrier}` : "Interested, with a delay or decision-maker");
  } else if (coldHits.length) {
    classification = "cold";
    reasons.push("Curiosity only, no clear need or budget");
  } else if (input.products || input.budget || input.timeline) {
    classification = "warm";
    reasons.push("Shared real business details but no buying signal yet");
  } else {
    reasons.push("Not enough signal — defaulting to cold");
  }

  const agent = (input.agentLabel ?? "").toLowerCase();
  if (agent === "hot" && classification !== "hot") {
    classification = "hot";
    reasons.push("Agent labeled hot from live conversation");
  }

  return {
    classification,
    confidence: classification === "hot" ? 0.86 : classification === "warm" ? 0.7 : 0.55,
    reasons,
    budget: input.budget?.trim() || undefined,
    products: input.products?.trim() || undefined,
    catalogSize: undefined,
    timeline: input.timeline?.trim() || undefined,
    features: input.features?.trim() || undefined,
    barrier: input.barrier?.trim() || undefined,
    quotes: quotes.slice(0, 6),
    language: detectDominantLanguage([input.utterances, ...quotes], input.language),
    bhk: input.bhk?.trim() || undefined,
    locality: input.locality?.trim() || undefined,
    endUse: input.endUse?.trim() || undefined,
  };
}

export function mergeCatalog(q: Qualification, catalogSize?: string): Qualification {
  return { ...q, catalogSize: catalogSize?.trim() || q.catalogSize };
}
