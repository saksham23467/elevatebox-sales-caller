import { activeProject } from "../packs/real-estate/project.ts";
import { AGENT_NAME } from "../packs/real-estate/prompt.ts";

/** Exact lines from the phone script. No model call, no voice session. */
export function scriptedReply(utterance: string): string | null {
  const p = activeProject();
  const t = utterance.toLowerCase().replace(/[?!.]/g, " ");

  if (/who (do|are) you work|which company|what company|kaunsi company|work for|whose company/.test(t)) {
    return `I work with ${p.builder}. This is about ${p.name} in ${p.city}.`;
  }
  if (/who are you|aap kaun|what's your name|your name/.test(t)) {
    return `${AGENT_NAME}. I work with ${p.builder}.`;
  }
  if (/\brobot\b|\bai\b|artificial|recording|ivr|bot\b/.test(t)) {
    return `Yeah, ${p.builder} put this on the line. Same talk.`;
  }
  if (/why (did|are) you call|kyun call|why this call/.test(t)) {
    return `Calling about ${p.name}.`;
  }
  if (/where is (it|this|the project)|kahan hai|location|which area/.test(t)) {
    return `${p.name} is in ${p.city} — ${p.localities.join(", ")}.`;
  }
  if (/price|rate|kitna|per sq|cost|how much/.test(t)) {
    return `Band is ${p.priceBand}. The relationship manager confirms the unit. Which BHK first?`;
  }
  if (/2 bhk|3 bhk|bhk|configuration/.test(t)) {
    return `This project is ${p.bhkMix}.`;
  }
  if (/loan|bank|finance/.test(t)) {
    return `Banks are on it. ${p.rmName} walks that on site. Which BHK are you looking at?`;
  }
  if (/not interested|wrong number|don't call|do not call/.test(t)) {
    return "Okay. I'll let you go.";
  }
  return null;
}
