import { parseLeadCsv, normalizeIndiaPhone, splitCsvLine } from "./csv.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(normalizeIndiaPhone("9876543210") === "+919876543210", "10 digit");
assert(normalizeIndiaPhone("+91 98765 43210") === "+919876543210", "plus spaced");
assert(normalizeIndiaPhone("09876543210") === "+919876543210", "leading zero");
assert(normalizeIndiaPhone("919876543210") === "+919876543210", "91 prefix");
assert(normalizeIndiaPhone("12345") === null, "too short");
assert(normalizeIndiaPhone("5123456789") === null, "not Indian mobile");
assert(JSON.stringify(splitCsvLine('Ravi,"9,876",ok', ",")) === JSON.stringify(["Ravi", "9,876", "ok"]), "quoted comma");

const named = parseLeadCsv("name,phone\nRavi Kumar,9876543210\n,8688664337\nPriya,+91 99887 76655\nRavi again,9876543210\nbad,123\n");
assert(named.rows.length === 3, `expected 3 rows, got ${named.rows.length}`);
assert(named.rows[0].name === "Ravi Kumar", "first name");
assert(named.rows[1].name === undefined, "unnamed kept");
assert(named.unnamed === 1, "unnamed count");
assert(named.rejected.some((r) => r.reason === "duplicate"), "in-file dedupe");
assert(named.rejected.some((r) => r.reason === "bad_phone"), "bad phone rejected");

const headerless = parseLeadCsv("Anita Sharma\t9123456780\n\t9000011122\n");
assert(headerless.rows.length === 2, "headerless rows");
assert(headerless.rows[0].name === "Anita Sharma", "inferred name");
assert(headerless.rows[1].phone === "+919000011122", "inferred phone");

const firstLast = parseLeadCsv("First Name,Last Name,Mobile\nAarav,Mehta,9876501234\n");
assert(firstLast.rows[0].name === "Aarav Mehta", "first+last");

try {
  parseLeadCsv("PK\x03\x04xlsx");
  throw new Error("xlsx should fail");
} catch (err) {
  assert(err instanceof Error && /Excel/.test(err.message), "xlsx message");
}

console.log("csv tests ok");
