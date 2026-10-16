# Build from the repository root: docker build -f server/Dockerfile .
FROM node:26-alpine
WORKDIR /app
COPY game/src/net/protocol.ts game/src/net/protocol.ts
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY server/*.ts server/
WORKDIR /app/server
EXPOSE 8787
CMD ["npm", "start"]
