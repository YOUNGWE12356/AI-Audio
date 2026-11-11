ARG NODE_IMAGE=node:22-alpine3.23
FROM ${NODE_IMAGE} AS base
WORKDIR /app
# Keep main/community on the image's Alpine release; only change the mirror.
ARG APK_MIRROR=https://mirrors.aliyun.com/alpine
RUN sed -i "s|https\?://dl-cdn.alpinelinux.org/alpine|${APK_MIRROR%/}|g" /etc/apk/repositories \
    && apk --timeout 30 add --no-cache ffmpeg python3
# Use the distro FFmpeg instead of downloading a glibc-linked static binary.
ENV FFMPEG_BIN=/usr/bin/ffmpeg FFMPEG_PATH=/usr/bin/ffmpeg

FROM base AS builder
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY index.html metadata.json tsconfig.json vite.config.ts server.ts ./
COPY src ./src
COPY tools ./tools
RUN npm run check && npm prune --omit=dev

FROM base AS runner
ENV NODE_ENV=production PORT=4030
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/tools ./tools
COPY package.json ./
RUN mkdir -p data uploads && chown node:node data uploads
USER node
EXPOSE 4030
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=6 CMD node -e "fetch('http://127.0.0.1:4030/healthz').then(r=>{if(!r.ok)console.error('GET /healthz HTTP '+r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error('GET /healthz failed:',e.message,e.cause?.code||'');process.exit(1)})"
CMD ["node", "dist/server/server.cjs"]
