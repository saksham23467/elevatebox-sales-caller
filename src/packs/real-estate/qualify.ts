import {
  detectDominantLanguage,
  mergeCatalog,
  type Qualification,
} from "../../qualify/classify.ts";
import type { ClassifyInput } from "../types.ts";

const HOT = [
  /send (me )?(the )?(details|info|brochure|quote|layout)/i,
  /share (the )?(details|pricing|price|brochure)/i,
  /whatsapp/i,
  /brochure/i,
  /site visit/i,
  /when can i (see|visit|come)/i,
  /kab dekh/i,
  /dekh (sakte|ne)/i,
  /loan/i,
  /home loan/i,
  /ready to (visit|book|see)/i,
  /book (a |the )?(visit|site)/i,
  /price (kya|kya hai|please|list)/i,
  /details (bhej|bhej do|bhejo)/i,
  /bhej do/i,
  /pampandi/i,
  /screenshot (bhej|pampandi)/i,
  /location (bhej|pin|share)/i,
];

const WARM = [
  /wife|husband|spouse|family/i,
  /partner (handles|decides|will)/i,
  /loan (not|pending|process)/i,
  /have to (think|discuss|check)/i,
  /need to discuss/i,
  /after (bonus|diwali|festival)/i,
  /next (month|quarter)/i,
  /bhai dekhega/i,
  /abhi budget/i,
  /not much (budget|right now)/i,
];

const COLD = [
  /just looking/i,
  /only (looking|research)/i,
  /no (need|budget|requirement)/i,
  /not interested/i,
  /wrong number/i,
  /already (bought|booked)/i,
  /different (city|area)/i,
  /sirf dekh/i,
  /zarurat nahi/i,
];

function hits(text: string, patterns: RegExp[]): string[] {
  return patterns.filter((p) => p.test(text)).map((p) => p.source);
}

export function classifyLead(input: ClassifyInput): Qualification {
  const blob = [
    input.utterances,
    input.budget,
    input.bhk,
    input.locality,
    input.timeline,
    input.endUse,
    input.barrier,
    ...(input.quotes ?? []),
    String(input.askedForDetails ?? ""),
    input.agentLabel ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  const quotes = (input.quotes ?? []).map((q) => q.trim()).filter(Boolean);
  const hotHits = hits(blob, HOT);
  const warmHits = hits(blob, WARM);
  const coldHits = hits(blob, COLD);
  const asked =
    input.askedForDetails === true ||
    /true|yes|1/i.test(String(input.askedForDetails ?? "")) ||
    /send|share|details|whatsapp|brochure|visit|quote|price|bhej/i.test(blob);

  let classification: Qualification["classification"] = "cold";
  const reasons: string[] = [];

  if (hotHits.length || asked) {
    classification = "hot";
    if (asked) reasons.push("Asked for brochure, price, or a site visit");
    if (hotHits.length) reasons.push(`High-intent phrasing: ${hotHits.slice(0, 2).join(", ")}`);
  } else if (warmHits.length || input.barrier) {
    classification = "warm";
    reasons.push(input.barrier ? `Barrier captured: ${input.barrier}` : "Interested, with a delay or decision-maker");
  } else if (coldHits.length) {
    classification = "cold";
    reasons.push("Browsing, wrong city, or already bought");
  } else if (input.budget || input.bhk || input.locality || input.timeline) {
    classification = "warm";
    reasons.push("Shared real requirement but no visit/brochure ask yet");
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
    catalogSize: input.catalogSize?.trim() || undefined,
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

export function mergeQualification(q: Qualification, extra?: ClassifyInput): Qualification {
  const merged = mergeCatalog(q, extra?.catalogSize);
  return {
    ...merged,
    bhk: extra?.bhk?.trim() || merged.bhk,
    locality: extra?.locality?.trim() || merged.locality,
    endUse: extra?.endUse?.trim() || merged.endUse,
    budget: extra?.budget?.trim() || merged.budget,
    timeline: extra?.timeline?.trim() || merged.timeline,
    barrier: extra?.barrier?.trim() || merged.barrier,
  };
}

