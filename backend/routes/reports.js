const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { requestOtp, verifyOtp, hashAadhaar } = require('../middleware/aadhaar');

const router = express.Router();
const DATA_FILE = path.join(__dirname, '..', 'data', 'reports.json');

// HIGHLIGHT_THRESHOLD: votes needed before a report is auto-forwarded to judiciary queue
const HIGHLIGHT_THRESHOLD = 100;

function readReports() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

function writeReports(reports) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(reports, null, 2));
}

// --- Aadhaar-gated auth (simulated) ---------------------------------------

// POST /api/auth/request-otp  { aadhaar }
router.post('/auth/request-otp', (req, res) => {
  const { aadhaar } = req.body || {};
  if (!aadhaar) return res.status(400).json({ ok: false, error: 'Aadhaar number is required.' });
  const result = requestOtp(String(aadhaar).replace(/\s/g, ''));
  if (!result.ok) return res.status(400).json(result);
  res.json(result); // { ok: true, aadhaarHash }
});

// POST /api/auth/verify-otp  { aadhaarHash, otp }
router.post('/auth/verify-otp', (req, res) => {
  const { aadhaarHash, otp } = req.body || {};
  if (!aadhaarHash || !otp) return res.status(400).json({ ok: false, error: 'Missing fields.' });
  const result = verifyOtp(aadhaarHash, otp);
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true, token: aadhaarHash }); // token = the hash itself for this demo
});

// --- Reports ---------------------------------------------------------------

// GET /api/reports?category=&sort=votes
router.get('/reports', (req, res) => {
  let reports = readReports();
  const { category, sort } = req.query;

  if (category && category !== 'All') {
    reports = reports.filter((r) => r.category === category);
  }

  if (sort === 'recent') {
    reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else {
    reports.sort((a, b) => b.votes - a.votes);
  }

  res.json({ ok: true, reports });
});

// GET /api/reports/:id
router.get('/reports/:id', (req, res) => {
  const reports = readReports();
  const report = reports.find((r) => r.id === req.params.id);
  if (!report) return res.status(404).json({ ok: false, error: 'Report not found.' });
  res.json({ ok: true, report });
});

// POST /api/reports  { title, category, description, location, evidence[], evidenceFiles[], reporterToken }
// evidenceFiles items look like { url, kind, originalName } — returned by POST /api/upload
router.post('/reports', (req, res) => {
  const { title, category, description, location, evidence, evidenceFiles, reporterToken } = req.body || {};

  if (!title || !category || !description || !location || !reporterToken) {
    return res.status(400).json({ ok: false, error: 'Missing required fields.' });
  }

  const reports = readReports();
  const newReport = {
    id: `vc-${uuidv4().slice(0, 8)}`,
    title: String(title).slice(0, 140),
    category,
    description: String(description).slice(0, 2000),
    location: String(location).slice(0, 140),
    reporterHash: reporterToken,
    votes: 1, // reporter's own vote counts once
    voters: [reporterToken],
    status: 'new',
    highlighted: false,
    createdAt: new Date().toISOString(),
    evidence: Array.isArray(evidence) ? evidence.slice(0, 5) : [],
    evidenceFiles: Array.isArray(evidenceFiles)
      ? evidenceFiles.slice(0, 5).map((f) => ({
          url: String(f.url || '').slice(0, 300),
          kind: String(f.kind || 'other').slice(0, 20),
          originalName: String(f.originalName || '').slice(0, 200),
        }))
      : [],
  };

  reports.unshift(newReport);
  writeReports(reports);
  res.status(201).json({ ok: true, report: newReport });
});

// POST /api/reports/:id/vote  { voterToken }
// Enforces "one Aadhaar, one vote" per report using the hashed token.
router.post('/reports/:id/vote', (req, res) => {
  const { voterToken } = req.body || {};
  if (!voterToken) return res.status(400).json({ ok: false, error: 'You must verify with Aadhaar to vote.' });

  const reports = readReports();
  const report = reports.find((r) => r.id === req.params.id);
  if (!report) return res.status(404).json({ ok: false, error: 'Report not found.' });

  if (report.voters.includes(voterToken)) {
    return res.status(409).json({ ok: false, error: 'This Aadhaar has already voted on this report.' });
  }

  report.voters.push(voterToken);
  report.votes += 1;

  if (report.votes >= HIGHLIGHT_THRESHOLD && !report.highlighted) {
    report.highlighted = true;
    report.status = 'forwarded_to_judiciary';
  }

  writeReports(reports);
  res.json({ ok: true, report });
});

// GET /api/stats — small aggregate used on the landing hero
router.get('/stats', (req, res) => {
  const reports = readReports();
  res.json({
    ok: true,
    totalReports: reports.length,
    totalVotes: reports.reduce((sum, r) => sum + r.votes, 0),
    highlighted: reports.filter((r) => r.highlighted).length,
    categories: [...new Set(reports.map((r) => r.category))],
  });
});

module.exports = router;
