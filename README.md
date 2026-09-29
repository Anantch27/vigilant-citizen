# Vigilant Citizen

A citizen-reporting platform for civic accountability — verified citizens report deforestation, corruption, and fake-fee incidents with multimedia evidence, prioritize them through one-Aadhaar-one-vote community voting, and automatically escalate high-vote reports toward judicial/administrative attention. Built with a Gemini-powered AI assistant that helps a citizen turn what they witnessed into a clear, factual report.

**Academic disclaimer:** Aadhaar verification in this project is simulated for demo purposes (real checksum math, no real UIDAI integration). Nothing here performs a genuine government identity check. This was built as part of the AICTE GenAI & Cloud Computing — 6 Weeks Summer Internship 2026, in collaboration with BharatCares × IBM.

**Live demo:** http://vigilant-citizen-env.eba-y9armrjh.ap-south-1.elasticbeanstalk.com
*(currently served over HTTP, not HTTPS — see "Why the live site isn't on HTTPS yet" below)*

## Table of contents

- [What's in this project](#whats-in-this-project)
- [The reporting flow](#the-reporting-flow)
- [The AI assistant](#the-ai-assistant)
- [Testing multiple citizen sessions](#testing-multiple-citizen-sessions)
- [Run it locally](#run-it-locally)
- [Run it with Docker](#run-it-with-docker)
- [Environment variables](#environment-variables)
- [Deploying to AWS Elastic Beanstalk](#deploying-to-aws-elastic-beanstalk)
- [Architecture](#architecture)
- [What's real vs. simulated, explicitly](#whats-real-vs-simulated-explicitly)
- [Challenges encountered and how they were resolved](#challenges-encountered-and-how-they-were-resolved)
- [Where this would need to change for production](#where-this-would-need-to-change-for-production)
- [Key learnings](#key-learnings)
- [Tech stack summary](#tech-stack-summary)
- [License](#license)
- [Acknowledgements](#acknowledgements)

---

## What's in this project

Everything lives in a single deployable unit rather than being split across services — deliberately, to keep the AWS deployment story simple (one Docker image, one Elastic Beanstalk environment, no reverse proxy, no separate frontend host).

| Piece | Where | Purpose |
|---|---|---|
| Frontend | `/frontend` | Static HTML/CSS/vanilla JS — no build step, no framework, served directly by the Express process |
| Backend | `/backend` | Express REST API — reporting, voting, Aadhaar auth, file upload, Gemini streaming proxy |
| AI assistant | `backend/routes/chat.js` | Gemini-powered civic-reporting guidance, streamed token-by-token over Server-Sent Events |
| Identity | `backend/middleware/aadhaar.js` | Simulated Aadhaar verification — real Verhoeff checksum, SHA-256 hashing, mock OTP |
| Deployment | `Dockerfile`, AWS Elastic Beanstalk | Single-container deploy, secrets held as environment properties, never in the image |

---

## The reporting flow

1. Citizen enters a 12-digit Aadhaar number. The backend validates the format and checks it against the real **Verhoeff checksum algorithm** (the actual algorithm UIDAI uses for Aadhaar check digits), then returns a hash of the number plus a demo OTP.
2. Citizen enters the OTP. The backend checks it against an in-memory, time-limited store and returns a verification token — for this demo, that token is just the Aadhaar hash itself.
3. Citizen writes the report and optionally attaches photo, audio, or video evidence, uploaded immediately to `POST /api/upload`, which returns a URL for each file.
4. Citizen submits. `POST /api/reports` stores the report with the reporter's hash, evidence references, and an initial vote count of 1.
5. Other verified citizens can vote — but only once per report, enforced by checking hash membership in that report's voter list. Cross a vote threshold and the report's status flips automatically to `forwarded_to_judiciary`.

This is genuinely enforced server-side, not just a UI restriction — if you try voting twice with the same Aadhaar hash, the API rejects the second vote. That's by design (it's the whole point of one-Aadhaar-one-vote), but it does mean a single shared test Aadhaar number will look "broken" to anyone testing it twice. See [Testing multiple citizen sessions](#testing-multiple-citizen-sessions) below for how to demo this properly.

## The AI assistant

The assistant embedded in the app isn't a general chatbot — it's scoped with a fixed system prompt sent on every request, so it stays on civic-reporting guidance rather than drifting into open-ended conversation:

```
You are the Vigilant Citizen Assistant, a helpful civic-guidance AI embedded in an
Indian citizen-reporting platform. You help people:
- understand what counts as reportable civic misconduct (corruption, illegal fees, deforestation, etc.)
- write a clear, factual, non-defamatory report description from what they tell you
- understand the reporting and community-voting process on this platform
Keep answers concise, practical, and neutral. Never encourage vigilante action or violence.
If asked something unrelated to civic reporting, answer briefly and steer back to how the platform can help.
```

The "never encourage vigilante action" line was added deliberately, not as boilerplate. A civic-reporting assistant sits close to genuinely sensitive ground — unverified accusations, angry users, real-world consequences for the people being reported — so the guardrail against escalating a frustrated citizen into anything actionable-unsafe matters more here than in a typical support bot.

Under the hood: the frontend `POST`s the user's message and recent chat history to `/api/chat/stream`; the backend calls Gemini's `streamGenerateContent` endpoint and forwards each chunk to the frontend over Server-Sent Events as it arrives, so replies appear to type out in real time instead of showing up all at once.

## Testing multiple citizen sessions

Because one-Aadhaar-one-vote is enforced for real, a single test Aadhaar number can only vote on a given report once — trying it a second time will correctly get blocked, which can look like a bug to someone demoing the app rather than reading this README first. To get around that during testing, the UI has a **"Need another test number?"** control that surfaces ten additional Verhoeff-valid test Aadhaar numbers, so you can simulate several different citizens voting on the same report without tripping the rule you're trying to demonstrate.

Similarly, the OTP for any test number is returned directly in the API response and shown on-screen — not just written to a server console log, which would be invisible once the app is running on AWS rather than on localhost. That's safe here only because it's a fixed, non-secret demo value; it's explicitly commented in code as a pattern that should never be used for a real OTP.

---

## Run it locally

```bash
git clone https://github.com/aditisg9/vigilant-citizen.git
cd vigilant-citizen/backend
npm install
cp .env.example .env    # fill in your GEMINI_API_KEY
npm start
# open http://localhost:8080
```

## Run it with Docker

```bash
docker build -t vigilant-citizen .
docker run -p 8080:8080 --env-file backend/.env vigilant-citizen
```

The Dockerfile is a single stage on Node 20 Alpine — it installs backend dependencies, copies both `backend/` and `frontend/` into the image, and serves both from one Express process on one port. That one-process, one-port design is what keeps the AWS deployment simple: no reverse proxy, no separate static host, just one container.

## Environment variables

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | API key for Google Gemini |
| `GEMINI_MODEL` | Model ID — currently `gemini-3.5-flash` |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list |

None of these are committed to the repo or baked into the Docker image — on AWS they're held as Elastic Beanstalk environment properties, injected at runtime only.

---

## Deploying to AWS Elastic Beanstalk

1. Zip the **contents** of the project folder (`backend`, `frontend`, `Dockerfile`, `.dockerignore`) — not the parent folder itself. On Windows, multi-selecting folders in File Explorer to build a zip can silently drop nested folder contents, which is exactly what broke the first deployment attempt here (see [Challenges](#challenges-encountered-and-how-they-were-resolved)). Verify the zip's internal file listing before uploading.
2. Upload the zip to an Elastic Beanstalk environment on the **Docker platform**.
3. Set `GEMINI_API_KEY`, `GEMINI_MODEL`, and `ALLOWED_ORIGINS` as environment properties in the Elastic Beanstalk console.
4. Confirm environment health returns to **Ok**.

### Why the live site isn't on HTTPS yet

The project brief calls for a public HTTPS URL, but Elastic Beanstalk's single-instance setup only serves HTTP by default. The plan was to front it with Amazon CloudFront (free tier, automatic HTTPS on a `*.cloudfront.net` domain, configured with Origin Protocol = HTTP only, Viewer Protocol Policy = redirect HTTP→HTTPS, Cache Policy = CachingDisabled, and Origin Request Policy = AllViewer so nothing breaks the dynamic API or the streaming chat responses). Distribution creation was blocked by AWS with *"Your account must be verified before you can add new CloudFront resources"* — a new-account identity/fraud check, unrelated to anything in the application itself, that needs an AWS support ticket to clear. Rather than block submission on a ticket outside the project's control, the deployment was left on HTTP and this is documented as a known limitation instead of silently ignored.

---

## Architecture

```
Frontend (HTML/CSS/JS)
        │  served statically
        ▼
Express backend  ──────────────┐
  reports.js  (CRUD, voting, Aadhaar auth)
  chat.js     (Gemini streaming proxy)
  upload.js   (Multer file upload)
        │                       │
        ▼                       ▼
backend/data/reports.json   Gemini API
  (JSON file datastore)     (streamGenerateContent,
        │                    forwarded via SSE)
        ▼
   Docker image (Node 20 Alpine)
        │
        ▼
AWS Elastic Beanstalk (Docker platform)
   single-instance, env vars hold all secrets
```

The data store is a plain JSON file rather than a database, which is a deliberate scoping decision for a project at this size — see [Where this would need to change for production](#where-this-would-need-to-change-for-production) below for what a real deployment would need instead.

---

## What's real vs. simulated, explicitly

This project is upfront about where it cuts corners, rather than dressing a simulation up to look like a real integration:

- **Aadhaar verification is simulated.** There's no public UIDAI eKYC API available outside licensed AUA/KUA organizations, so this uses the real Verhoeff checksum algorithm plus a mock OTP — correct math, no real government check. It's commented as such in code.
- **The AI assistant is real** — actual Gemini API calls, actually scoped by the system prompt above, not a canned response set.
- **File upload is real** — a genuine Multer-based endpoint with a MIME-type allow-list and a 25MB size cap, not just UI placeholder buttons. (It started as the latter — see [Challenges](#challenges-encountered-and-how-they-were-resolved) below.)
- **Voting enforcement is real** — the one-Aadhaar-one-vote rule is checked server-side against a stored voter-hash list, not just disabled in the UI after one click.

---

## Challenges encountered and how they were resolved

<details>
<summary>Click to expand the full challenges table</summary>

| Challenge | Resolution |
|---|---|
| No access to real UIDAI Aadhaar eKYC API (licensed AUA/KUA only) | Simulated verification using the real Verhoeff checksum + mock OTP, documented as a demo scoping decision rather than hidden |
| Evidence "upload" was originally just tag buttons (photo/audio/video labels), no real upload | Added a Multer-based upload route with MIME allow-list and size cap; wired a real `<input type="file">` with live progress feedback and inline media rendering on report cards |
| `gemini-2.0-flash` was fully retired mid-project, breaking the chat endpoint with HTTP 404 | Root-caused directly from the server-side error message rather than guessing; switched to `gemini-3.5-flash`; left a README note that the `gemini-2.5-*` family is also scheduled to retire (Oct 16, 2026) |
| Docker build failed on AWS: `COPY frontend ./frontend: "/frontend": not found` | Diagnosed via Elastic Beanstalk's `eb-engine.log`; root cause was a Windows Explorer multi-select zip not reliably including the frontend folder's contents at the zip root; fixed by re-zipping the folder contents directly and checking the zip listing before re-upload |
| Mock OTP was only printed to the server console — invisible once running on AWS, not just localhost | Returned the demo OTP directly in the API response and displayed it in the UI, with a code comment restricting this pattern to non-secret demo values only |
| A single shared test Aadhaar number correctly blocked a second vote (by design), which looks like a bug when demoing | Generated ten additional Verhoeff-valid test Aadhaar numbers, surfaced via a "Need another test number?" UI control |
| AWS new-account identity verification delayed environment creation | Waited out AWS's verification process; resubmitted the government ID with a clearer image and an exactly-matching name after an initial rejection |
| CloudFront (needed for HTTPS) blocked by an AWS new-account fraud/identity check | Documented as a known limitation rather than blocking submission on an unresolved AWS support ticket |

</details>

---

## Where this would need to change for production

This is an academic/demo build, and a few decisions here are explicitly not production-ready:

- **Swap the JSON file datastore for a real database** (PostgreSQL, DynamoDB, etc.) — a flat file works for a demo's data volume but has no real concurrency safety or query performance at scale.
- **Replace simulated Aadhaar verification with a licensed UIDAI AUA/KUA integration** — the current flow is checksum math and a mock OTP, not a real identity check, and should never be mistaken for one.
- **Resolve the CloudFront/AWS account verification** to get HTTPS in front of the API — sending Aadhaar numbers and OTPs over plain HTTP is not acceptable outside a demo context.
- **Watch the Gemini model deprecation schedule** — `gemini-2.5-*` is scheduled to retire October 16, 2026; confirm current model availability rather than assuming the hardcoded default keeps working indefinitely.

---

## Key learnings

- Treating real error output (Docker build logs, Gemini API error bodies, Elastic Beanstalk's `eb-engine.log`) as the primary debugging source — instead of guessing at causes — resolved every deployment failure in this project on the first correct attempt once the actual log was read.
- A feature described in a spec is only as complete as its weakest implied requirement. The evidence-upload gap (tag buttons standing in for a real upload endpoint) was invisible until it was tested end-to-end, which is the whole argument for walking the full user flow rather than trusting that a described feature is actually wired up.
- Cloud account identity/fraud checks (AWS account verification, CloudFront's new-account block) are a real and easy-to-underestimate part of a first deployment timeline for a new AWS account — worth starting early rather than assuming account creation is instantaneous.
- A simulation is more defensible when the simplification is stated plainly — both in code comments and in project documentation — than when it's dressed up to look like a real integration.
- Model and platform dependencies are moving targets. Documenting the fallback plan (how to swap the Gemini model, why the deployment is on HTTP instead of HTTPS) carries about as much value as the working state itself.

---

## Tech stack summary

- **Frontend:** HTML / CSS / vanilla JavaScript — custom-designed, responsive, no build step
- **Backend:** Node.js + Express — REST API, auth, file upload, AI proxy
- **AI:** Google Gemini API (`gemini-3.5-flash`), streamed via Server-Sent Events
- **Identity:** Simulated Aadhaar verification — Verhoeff checksum + mock OTP
- **File handling:** Multer — photo/audio/video evidence upload
- **Container:** Docker — single image serving frontend + API
- **Cloud:** AWS Elastic Beanstalk (Docker platform) — live public deployment

---

## License

Built for educational purposes as part of the AICTE GenAI & Cloud Computing Summer Internship 2026. Add a license of your choice (e.g. MIT) before any public/production release.

## Acknowledgements

- **AICTE** — GenAI & Cloud Computing 6 Weeks Summer Internship 2026
- **BharatCares × IBM** — program partners
- **Google Gemini API** — AI assistant capabilities
- **AWS Elastic Beanstalk** — cloud deployment platform
