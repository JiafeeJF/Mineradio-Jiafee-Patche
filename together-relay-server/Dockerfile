FROM node:22-alpine

WORKDIR /app

COPY together-relay-server/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

COPY together-relay-server/server.js together-relay-server/healthcheck.js ./
COPY payload/desktop/together-listen ./lib

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=17861

EXPOSE 17861/tcp

USER node

HEALTHCHECK --interval=20s --timeout=5s --start-period=8s --retries=3 CMD ["node", "healthcheck.js"]

CMD ["node", "server.js"]
