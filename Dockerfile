FROM node:22-bookworm-slim AS base
WORKDIR /app

COPY package*.json ./
COPY packages/publication-platform/package.json ./packages/publication-platform/package.json
COPY packages/publication-client/package.json ./packages/publication-client/package.json
RUN npm ci

COPY . .
RUN npm run build:packages && npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
