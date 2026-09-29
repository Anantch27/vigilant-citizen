/**
 * aadhaar.js
 * -----------------------------------------------------------------------
 * SIMULATED Aadhaar verification module.
 *
 * IMPORTANT — read this before you present the project:
 * Real Aadhaar eKYC/OTP verification is only available to organizations
 * licensed by UIDAI as an AUA/KUA (Authentication User Agency). That
 * licensing is not accessible to a student project, so this module
 * SIMULATES the verification flow that a real integration would follow:
 *
 *   1. Format + checksum validation of the 12-digit Aadhaar number
 *      (Verhoeff algorithm — the same checksum UIDAI itself uses).
 *   2. A mock OTP step (in this demo the "OTP" is always 123456, and is
 *      logged to the server console instead of being sent by SMS).
 *   3. The raw Aadhaar number is NEVER stored. Only a salted SHA-256 hash
 *      is kept, which is enough to enforce "one Aadhaar = one vote" /
 *      "one Aadhaar = one report flag" without holding a citizen's real
 *      government ID in the database.
 *
 * For a production version, step 1 stays the same, but step 2 would be
 * replaced by a call to a licensed eKYC provider's API (e.g. via NSDL,
 * CDSL, or Digilocker-based Aadhaar authentication), and you would need
 * to complete UIDAI's AUA/KUA empanelment process first. Mention this
 * explicitly in your project report under "Challenges" or "Key learnings".
 * -----------------------------------------------------------------------
 */

const crypto = require('crypto');

// Verhoeff algorithm tables — the actual checksum scheme UIDAI uses for Aadhaar
const d = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const p = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffIsValid(numStr) {
  let c = 0;
  const arr = numStr.split('').reverse().map(Number);
  for (let i = 0; i < arr.length; i++) {
    c = d[c][p[i % 8][arr[i]]];
  }
  return c === 0;
}

function isValidAadhaarFormat(aadhaar) {
  if (!/^\d{12}$/.test(aadhaar)) return false;
  if (/^[0-1]/.test(aadhaar)) return false; // Aadhaar never starts with 0 or 1
  return verhoeffIsValid(aadhaar);
}

const AADHAAR_SALT = process.env.AADHAAR_SALT || 'vigilant-citizen-demo-salt';

function hashAadhaar(aadhaar) {
  return crypto.createHash('sha256').update(AADHAAR_SALT + aadhaar).digest('hex');
}

// In-memory mock OTP store: hash(aadhaar) -> { otp, expiresAt }
const otpStore = new Map();
const MOCK_OTP = '123456';

function requestOtp(aadhaar) {
  if (!isValidAadhaarFormat(aadhaar)) {
    return { ok: false, error: 'Invalid Aadhaar number format or checksum.' };
  }
  const key = hashAadhaar(aadhaar);
  otpStore.set(key, { otp: MOCK_OTP, expiresAt: Date.now() + 5 * 60 * 1000 });
  // In production this line is replaced by a real SMS/eKYC provider call.
  console.log(`[SIMULATED SMS] OTP for Aadhaar ending ${aadhaar.slice(-4)}: ${MOCK_OTP}`);
  // demoOtp is returned directly so the frontend can display it — this is
  // safe ONLY because it's a fixed, publicly-documented demo value with no
  // real security purpose. A production integration would never return an
  // OTP in the API response.
  return { ok: true, aadhaarHash: key, demoOtp: MOCK_OTP };
}

function verifyOtp(aadhaarHash, otp) {
  const entry = otpStore.get(aadhaarHash);
  if (!entry) return { ok: false, error: 'No OTP requested for this Aadhaar, or it expired.' };
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(aadhaarHash);
    return { ok: false, error: 'OTP expired. Please request a new one.' };
  }
  if (entry.otp !== otp) return { ok: false, error: 'Incorrect OTP.' };
  otpStore.delete(aadhaarHash);
  return { ok: true };
}

module.exports = { isValidAadhaarFormat, hashAadhaar, requestOtp, verifyOtp };
