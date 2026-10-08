import type { Qualification } from "../qualify/classify.ts";

export type PackId = "ecommerce" | "real-estate";
export type Market = "india" | "us";
export type Playbook = "speed" | "campaign";

export type ClassifyInput = {
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
  catalogSize?: string;
};

export type ToolParam = {
  key: string;
  description: string;
  type: "string" | "boolean" | "number";
  required?: boolean;
};

export type PacketKind = "mid" | "followup" | "visit" | "brochure";

export type VerticalPack = {
  id: PackId;
  agentTitle: string;
  agentName: string;
  welcomeMessage: string;
  contextBreakdown: () => Array<{ is_enabled: boolean; title: string; body: string }>;
  systemPrompt: () => string;
  classifyLead: (input: ClassifyInput) => Qualification;
  mergeQualification: (q: Qualification, extra?: ClassifyInput) => Qualification;
  midCallMessage: (q: Qualification) => string;
  followUpMessage: (
    q: Qualification,
    extra?: { callbackAt?: Date; visitAt?: Date; midCallAlready?: boolean },
  ) => string;
  coldBrochure: (q?: Qualification) => string;
  callSlip: (q: Qualification) => Record<string, unknown>;
  toolQual: ToolParam[];
  extractedVariables: Array<{ key: string; prompt: string }>;
  bookVisit: boolean;
  packetAttachments: { brochure?: boolean; resume?: boolean; architecture?: boolean };
};
