FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4600
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node server ./server
RUN mkdir data && chown node:node data
USER node
VOLUME /app/data
EXPOSE 4600
HEALTHCHECK --interval=15s --timeout=4s CMD wget -qO- http://127.0.0.1:4600/api/health || exit 1
CMD ["node", "server.js"]
