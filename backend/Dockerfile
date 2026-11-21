# Hunch API. Build from the repository root (the backend imports ../shared):
#   docker build -f backend/Dockerfile -t hunch-api .
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY shared ./shared
COPY backend/package.json ./backend/package.json
RUN cd backend && npm install --omit=dev --no-audit --no-fund
COPY backend ./backend
WORKDIR /app/backend
# Persistent disk for the SQLite database (mount a volume here in production).
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 5000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
