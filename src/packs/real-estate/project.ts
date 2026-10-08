import { config } from "../../config.ts";

export type VisitSlot = {
  id: string;
  label: string;
  hour: number;
  weekendOnly?: boolean;
  weekdayOnly?: boolean;
};

/** Hours an RM will actually stand on site. Agent may only promise these. */
export const VISIT_SLOTS: VisitSlot[] = [
  { id: "morning", label: "11:00 AM", hour: 11 },
  { id: "evening", label: "6:00 PM", hour: 18, weekdayOnly: true },
  { id: "weekend", label: "11:00 AM weekend", hour: 11, weekendOnly: true },
];

export type Project = {
  id: string;
  builder: string;
  name: string;
  city: string;
  localities: string[];
  bhkMix: string;
  priceBand: string;
  brochureUrl: string;
  locationPin: string;
  rmName: string;
  rmPhone: string;
  agentName: string;
};

export function activeProject(): Project {
  return {
    id: "aarav-greens",
    builder: config.reBuilder,
    name: config.reProject,
    city: config.reCity,
    localities: config.reLocalities,
    bhkMix: config.reBhkMix,
    priceBand: config.rePriceBand,
    brochureUrl: config.reBrochureUrl,
    locationPin: config.reLocationPin,
    rmName: config.reRmName,
    rmPhone: config.reRmPhone,
    agentName: "Ananya",
  };
}
