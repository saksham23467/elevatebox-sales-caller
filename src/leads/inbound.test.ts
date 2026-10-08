import { facebookFieldsToLead, leadsFromPayload, sourceLabel } from "./inbound.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(sourceLabel("99acres.com") === "99acres", "99acres label");
assert(sourceLabel("facebook") === "Facebook", "facebook label");

const acres = leadsFromPayload(
  { buyer_name: "Ravi Kumar", mobile: "9876543210", city: "Hyderabad", project: "Aarav Greens", bhk: "3 BHK" },
  "99acres",
);
assert(acres.length === 1 && acres[0].phone === "+919876543210", "99acres phone");
assert(acres[0].name === "Ravi Kumar" && acres[0].source === "99acres", "99acres name");

const wrapped = leadsFromPayload({ leads: [{ name: "Ana", phone_number: "+91 99887 76655" }] }, "housing");
assert(wrapped[0]?.source === "Housing.com", "housing source");

const fb = facebookFieldsToLead([
  { name: "full_name", values: ["Priya Sharma"] },
  { name: "phone_number", values: ["09123456780"] },
]);
assert(fb?.phone === "+919123456780" && fb.source === "Facebook", "facebook fields");
assert(leadsFromPayload({ note: "no phone" }).length === 0, "skip without phone");

console.log("inbound tests ok");
