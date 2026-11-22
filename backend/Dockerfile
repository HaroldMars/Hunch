# Hunch API. Build from the repository root (the backend imports ../shared):
#   docker build -f backend/Dockerfile -t hunch-api .
FROM node:24-alpine
ENV NODE_ENV=production
ENV PORT=5000
WORKDIR /app
COPY shared ./shared
COPY backend/package.json ./backend/package.json
RUN cd backend && npm install --omit=dev --no-audit --no-fund
COPY backend ./backend
WORKDIR /app/backend
# The SQLite database lives in /data. Attach a persistent volume at /data on the host
# (Railway: service > Volumes; Render: disk in render.yaml). No VOLUME instruction:
# Railway rejects Dockerfiles that declare one.
ENV DATA_DIR=/data
EXPOSE 5000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
