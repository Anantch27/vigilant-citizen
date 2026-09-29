# Vigilant Citizen

A citizen-reporting platform for civic accountability. Verified citizens report deforestation, corruption, and fake-fee incidents with photo, audio, or video evidence, prioritise them through one-Aadhaar-one-vote community voting, and reports that cross a vote threshold are automatically marked as forwarded to judicial/administrative attention. A Gemini-powered AI assistant helps citizens turn what they witnessed into a clear, factual report.

**Live demo:** <https://vigilant-citizen.onrender.com>
*(Hosted on Render's free tier. The first request after a period of inactivity can take 30-50 seconds while the service wakes up.)*

**Academic disclaimer:** Aadhaar verification in this project is simulated for demo purposes (real Verhoeff checksum, no real UIDAI integration). Nothing here performs a genuine government identity check.

## Table of contents

- [What's in this project](#whats-in-this-project)
- [The reporting flow](#the-reporting-flow)
- [The AI assistant](#the-ai-assistant)
- [Testing multiple citizen sessions](#testing-multiple-citizen-sessions)
- [Run it locally](#run-it-locally)
- [Run it with Docker](#run-it-with-docker)
- [Environment variables](#environment-variables)
- [Deploying on Render](#deploying-on-render)
- [Architecture](#architecture)
- [What's real vs. simulated](#whats-real-vs-simulated)
- [Limitations and production changes](#limitations-and-production-changes)
- [Tech stack](#tech-stack)
- [Acknowledgements](#acknowledgements)

---

## What's in this project

Everything lives in a single deployable unit: one Docker image, one Express process, one port, with no reverse proxy and no separate frontend host.

| Piece        | Where                           | Purpose                                                                                     |
| ------------ | ------------------------------- | ------------------------------------------------------------------------------------------- |
| Frontend     | `/frontend`                     | Static HTML/CSS/vanilla JS, no build step, served directly by Express                       |
| Backend      | `/backend`                      | Express REST API: reporting, voting, Aadhaar auth, file upload, Gemini streaming proxy      |
| AI assistant | `backend/routes/chat.js`        | Gemini-powered civic-reporting guidance, streamed over Server-Sent Events                   |
| Identity     | `backend/middleware/aadhaar.js` | Simulated Aadhaar verification: real Verhoeff checksum, SHA-256 hashing, mock OTP           |
| Deployment   | `Dockerfile`, Render            | Single-container deploy, secrets held as environment variables, never in the image          |

---

## The reporting flow

1. The citizen enters a 12-digit Aadhaar number. The backend validates the format, checks the **Verhoeff checksum** (the algorithm behind Aadhaar check digits), then returns a hash of the number plus a demo OTP.
2. The citizen enters the OTP. The backend checks it against an in-memory, time-limited store and returns a verification token (in this demo, the Aadhaar hash itself).
3. The citizen writes the report and can attach photo, audio, or video evidence, uploaded to `POST /api/upload`, which returns a URL for each file.
4. On submit, `POST /api/reports` stores the report with the reporter's hash, the evidence references, and an initial vote count of 1.
5. Other verified citizens can vote, but only once per report. This is enforced on the server by checking hash membership in that report's voter list. Once votes cross the threshold, the status changes to `forwarded_to_judiciary`.

Because the rule is enforced server-side, voting twice with the same Aadhaar hash is rejected by the API, not just disabled in the UI.

## The AI assistant

The assistant is not a general chatbot. It is scoped by a fixed system prompt sent with every request, so it stays on civic-reporting guidance: what counts as reportable misconduct, how to write a clear, factual, non-defamatory description, and how the platform's reporting and voting process works. It is instructed never to encourage vigilante action or violence, which matters in an app where users may be angry and the people being reported face real consequences.

Technically, the frontend sends the user's message and recent chat history to `/api/chat/stream`. The backend calls Gemini's `streamGenerateContent` endpoint and forwards each chunk to the browser over Server-Sent Events, so replies appear token by token.

## Testing multiple citizen sessions

Since one-Aadhaar-one-vote is enforced, a single test number can vote on a report only once. The UI has a **"Need another test number?"** control that shows ten additional Verhoeff-valid test Aadhaar numbers, so several different citizens can be simulated on the same report.

In demo mode the OTP is returned in the API response and shown on screen. This is safe only because it is a fixed, non-secret demo value. In a real deployment the OTP would be sent by SMS and never returned by the API.

---

## Run it locally

```bash
git clone https://github.com/Anantch27/vigilant-citizen.git
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

The Dockerfile is a single stage on Node 20 Alpine. It installs backend dependencies, copies `backend/` and `frontend/`, and serves both from one Express process on port 8080.

## Environment variables

| Variable          | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `GEMINI_API_KEY`  | API key for Google Gemini (required for the AI assistant)      |
| `GEMINI_MODEL`    | Gemini model ID (optional if the code has a default)           |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list (optional)                     |
| `PORT`            | Port the server listens on (`8080`)                            |

None of these are committed to the repository or baked into the Docker image. On Render they are set in the service's **Environment** tab.

---

## Deploying on Render

1. Push the repository to GitHub.
2. On [render.com](https://render.com), choose **New > Web Service** and connect this repository (or paste its public URL).
3. Set **Language** to **Docker**, **Branch** to `main`, and **Instance Type** to **Free**.
4. Add environment variables: `GEMINI_API_KEY` and `PORT=8080`.
5. Click **Deploy Web Service**. Render builds the Dockerfile and gives an HTTPS URL of the form `https://<service-name>.onrender.com`.

To publish new changes: `git push origin main`, then in the Render dashboard use **Manual Deploy > Deploy latest commit** (auto-deploy is not enabled for public-repo deployments).

---

## Architecture

```
Frontend (HTML/CSS/JS)
        |  served statically
        v
Express backend -----------------+
  reports.js  (CRUD, voting, Aadhaar auth)
  chat.js     (Gemini streaming proxy)
  upload.js   (Multer file upload)
        |                         |
        v                         v
backend/data/reports.json     Gemini API
  (JSON file datastore)       (streamGenerateContent,
        |                      forwarded via SSE)
        v
   Docker image (Node 20 Alpine)
        |
        v
      Render (Docker web service, HTTPS)
```

The data store is a plain JSON file rather than a database, a deliberate scoping choice for a project of this size.

---

## What's real vs. simulated

- **Aadhaar verification is simulated.** Real UIDAI eKYC access is limited to licensed AUA/KUA organisations, so this uses the real Verhoeff checksum plus a mock OTP: correct math, no real government check.
- **The AI assistant is real.** Actual Gemini API calls, scoped by the system prompt.
- **File upload is real.** A Multer-based endpoint with a MIME-type allow-list and a 25 MB size cap.
- **Voting enforcement is real.** The one-Aadhaar-one-vote rule is checked on the server against a stored voter-hash list.

## Limitations and production changes

- **Data persistence:** reports live in a JSON file. On Render's free tier the filesystem is ephemeral, so data can reset on restart or redeploy. A real deployment needs a database (PostgreSQL, DynamoDB, etc.).
- **Identity:** replace the simulated Aadhaar flow with a licensed UIDAI AUA/KUA integration, or a phone-OTP service (Twilio, MSG91, Firebase) if Aadhaar is not required. Never return the OTP in an API response, and never store full Aadhaar numbers.
- **Cold starts:** the free instance sleeps when idle; a paid instance avoids this.
- **Model deprecation:** Gemini model versions are retired over time. Check current availability and update `GEMINI_MODEL` when needed.

## Tech stack

- **Frontend:** HTML / CSS / vanilla JavaScript, responsive, no build step
- **Backend:** Node.js + Express (REST API, auth, file upload, AI proxy)
- **AI:** Google Gemini API, streamed via Server-Sent Events
- **Identity:** Simulated Aadhaar verification (Verhoeff checksum + mock OTP)
- **File handling:** Multer for photo/audio/video evidence
- **Container:** Docker, one image serving frontend and API
- **Hosting:** Render (Docker web service)

## Acknowledgements

- **Google Gemini API**: AI assistant capabilities
- **Render**: hosting

## License

Built for educational purposes. Add a license of your choice (for example MIT) before any public or production release.