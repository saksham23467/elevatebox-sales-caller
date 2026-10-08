import { config } from "../config.ts";
import { classifyLead as classifyEcommerce, mergeCatalog, type Qualification } from "../qualify/classify.ts";
import { callSlip, coldBrochure, followUpMessage, midCallMessage } from "../whatsapp/copy.ts";
import { contextBreakdown, systemPrompt, welcomeMessage } from "../omnidim/prompt.ts";
import type { VerticalPack } from "./types.ts";
import { classifyLead as classifyRealty, mergeQualification as mergeRealty } from "./real-estate/qualify.ts";
import {
  callSlip as reSlip,
  coldBrochure as reCold,
  followUpMessage as reFollow,
  midCallMessage as reMid,
} from "./real-estate/copy.ts";
import { contextBreakdown as reBreakdown, systemPrompt as reSystem, welcomeMessage as reWelcome } from "./real-estate/prompt.ts";
import { activeProject } from "./real-estate/project.ts";

const ECOM_QUAL: VerticalPack["toolQual"] = [
  { key: "classification", description: "hot, warm, or cold based on buying intent, not politeness", type: "string", required: true },
  { key: "quotes", description: "verbatim phrases the lead said, separated by |", type: "string", required: true },
  { key: "budget", description: "budget they mentioned, or empty", type: "string" },
  { key: "products", description: "what they sell", type: "string" },
  { key: "catalog_size", description: "how many products if mentioned", type: "string" },
  { key: "timeline", description: "when they need the site live", type: "string" },
  { key: "features", description: "features they asked for", type: "string" },
  { key: "barrier", description: "why they cannot buy now, if any", type: "string" },
  { key: "language", description: "en, hi, or te — whichever they spoke the most words in. Tie or unclear = en", type: "string" },
  { key: "call_id", description: "OmniDimension call id if you have it", type: "string" },
];

const RE_QUAL: VerticalPack["toolQual"] = [
  { key: "classification", description: "hot, warm, or cold from visit/brochure intent, not politeness", type: "string", required: true },
  { key: "quotes", description: "verbatim phrases the lead said, separated by |", type: "string", required: true },
  { key: "budget", description: "budget band they mentioned, or empty", type: "string" },
  { key: "locality", description: "area or locality they want", type: "string" },
  { key: "bhk", description: "BHK or plot size", type: "string" },
  { key: "timeline", description: "when they want to buy or move", type: "string" },
  { key: "end_use", description: "stay, invest, or both", type: "string" },
  { key: "barrier", description: "why they cannot visit or decide now, if any", type: "string" },
  { key: "language", description: "en, hi, or te — whichever they spoke the most words in. Tie = en", type: "string" },
  { key: "call_id", description: "OmniDimension call id if you have it", type: "string" },
];

const ecommerce: VerticalPack = {
  id: "ecommerce",
  agentTitle: "Saksham Ecom Sales — Ananya",
  agentName: "Ananya",
  welcomeMessage,
  contextBreakdown,
  systemPrompt,
  classifyLead: (input) => classifyEcommerce(input),
  mergeQualification: (q, extra) => mergeCatalog(q, extra?.catalogSize),
  midCallMessage,
  followUpMessage,
  coldBrochure,
  callSlip: (q) => callSlip(q) as unknown as Record<string, unknown>,
  toolQual: ECOM_QUAL,
  extractedVariables: [
    { key: "classification", prompt: "hot, warm, or cold" },
    { key: "budget", prompt: "Budget mentioned" },
    { key: "products", prompt: "What they sell" },
    { key: "catalog_size", prompt: "Number of products" },
    { key: "timeline", prompt: "When they need the site" },
    { key: "features", prompt: "Features requested" },
    { key: "barrier", prompt: "Why they cannot buy now" },
    { key: "quotes", prompt: "Verbatim quotes, separated by |" },
    { key: "language", prompt: "en, hi, or te — whichever they spoke the most words in. Tie or unclear = en" },
    { key: "callback_spoken", prompt: "Any callback time they named, verbatim" },
  ],
  bookVisit: false,
  packetAttachments: { resume: false, architecture: true },
};

function realtyPack(): VerticalPack {
  const p = activeProject();
  return {
    id: "real-estate",
    agentTitle: `${p.builder} — Ananya`,
    agentName: "Ananya",
    welcomeMessage: reWelcome(),
    contextBreakdown: reBreakdown,
    systemPrompt: reSystem,
    classifyLead: classifyRealty,
    mergeQualification: mergeRealty,
    midCallMessage: reMid,
    followUpMessage: reFollow,
    coldBrochure: reCold,
    callSlip: (q: Qualification) => reSlip(q) as unknown as Record<string, unknown>,
    toolQual: RE_QUAL,
    extractedVariables: [
      { key: "classification", prompt: "hot, warm, or cold" },
      { key: "budget", prompt: "Budget band mentioned" },
      { key: "locality", prompt: "Locality or area they want" },
      { key: "bhk", prompt: "BHK or plot size" },
      { key: "timeline", prompt: "When they want to buy or move" },
      { key: "end_use", prompt: "stay, invest, or both" },
      { key: "barrier", prompt: "Why they cannot visit or decide now" },
      { key: "quotes", prompt: "Verbatim quotes, separated by |" },
      { key: "language", prompt: "en, hi, or te — majority words. Tie = en" },
      { key: "callback_spoken", prompt: "Site-visit or callback time they named, verbatim" },
    ],
    bookVisit: true,
    packetAttachments: { brochure: true },
  };
}

export function pack(): VerticalPack {
  return config.vertical === "real-estate" ? realtyPack() : ecommerce;
}
