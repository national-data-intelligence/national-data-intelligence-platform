# BUILD-ONLY image for the demo-console SPA (React+Vite). Never deployed — the
# console (console.py) serves the built files statically; build-spa.sh builds
# this image and extracts /dist out of it, so the demo machine needs no node.
FROM node:22-slim
WORKDIR /ui
COPY ui/package*.json ./
RUN npm install
COPY ui/ ./
RUN npm run build     # vite outDir '../dist' → /dist
