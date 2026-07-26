/**
 * Generates checksum-valid but synthetic Korean PII shapes for demo seed data.
 * Mirrors the validators in packages/gateway/src/detect.ts so the detector
 * actually recognizes these values (no real people or accounts involved).
 */

/**
 * Resident-registration-number-shaped value (YYMMDD + gender digit + 5-digit
 * serial + checksum = 13 digits total). `serial` is a fixed 5-digit filler
 * chosen by the caller so the value is fully deterministic across runs (no
 * randomness in seed data, ever).
 */
export function fakeRrn(birthYy: number, birthMm: number, birthDd: number, genderDigit: number, serial: number): string {
  const yy = String(birthYy).padStart(2, "0");
  const mm = String(birthMm).padStart(2, "0");
  const dd = String(birthDd).padStart(2, "0");
  const front = `${yy}${mm}${dd}`;
  const back = String(serial % 100000).padStart(5, "0");
  const digits = [...front, String(genderDigit), ...back].map(Number);
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  const checksum = weights.reduce((sum, weight, index) => sum + digits[index]! * weight, 0);
  const checkDigit = (11 - (checksum % 11)) % 10;
  return `${front}-${genderDigit}${back}${checkDigit}`;
}

/** Business-registration-number-shaped value (3-2-5 digits, valid checksum). */
export function fakeBizNo(seed: number): string {
  const base = String(1000000000 + (seed % 900000000)).slice(0, 9).split("").map(Number);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const sum = weights.reduce((total, weight, index) => total + base[index]! * weight, 0)
    + Math.floor((base[8]! * 5) / 10);
  const checkDigit = (10 - (sum % 10)) % 10;
  const digits = [...base, checkDigit].join("");
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 10)}`;
}

/** 16-digit card-number-shaped value that passes the Luhn check. */
export function fakeCard(seed: number): string {
  const base = String(4000000000000000n + BigInt(seed % 900000000)).padStart(15, "0").slice(0, 15).split("").map(Number);
  let sum = 0;
  let double = true;
  for (let index = base.length - 1; index >= 0; index -= 1) {
    let digit = base[index]!;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  const digits = [...base, checkDigit].join("");
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}`;
}
