FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src

USER node

EXPOSE 3000

CMD ["node", "--experimental-strip-types", "src/main.ts"]
