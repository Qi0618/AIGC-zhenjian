# 帧间 Zhenjian：正式模式镜像（含 ffmpeg，用于合成短剧成片）
FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json index.html styles.css app.js ./
COPY server ./server
ENV PORT=8787 DATA_DIR=/data HOST=0.0.0.0
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "server/index.mjs"]
