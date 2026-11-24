FROM node:22-bookworm-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build
FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=UTC
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server/ ./
COPY --from=client --chown=node:node /app/client/dist /app/client/dist
RUN install -d -o node -g node /app/private-files
ENV PRIVATE_FILE_DIR=/app/private-files
USER node
EXPOSE 8080
CMD ["node","src/index.js"]
