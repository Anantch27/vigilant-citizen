# ---- Vigilant Citizen — single-container build ----------------------------
# Serves the static frontend AND the Express/Gemini API from one Node process,
# which keeps deployment on AWS App Runner / Elastic Beanstalk simple
# (one container, one port, no reverse proxy needed).

FROM node:20-alpine

WORKDIR /app

# Install backend dependencies first (better layer caching)
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Copy the rest of the application
COPY backend ./backend
COPY frontend ./frontend

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Basic container healthcheck against our /api/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

CMD ["node", "server.js"]
