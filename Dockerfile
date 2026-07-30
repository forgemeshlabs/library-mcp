FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js README.md LICENSE server.json glama.json GLAMA.md smithery.yaml ./
RUN chmod +x /app/index.js

ENV NODE_ENV=production \
  LIBRARY_BASE_URL=https://library.forgemesh.io

USER node

ENTRYPOINT ["node", "index.js"]
