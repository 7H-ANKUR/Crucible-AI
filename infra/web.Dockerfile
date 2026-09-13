FROM node:20-alpine

WORKDIR /app

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

COPY apps/web ./

ENV NEXT_PUBLIC_API_URL=http://localhost:8000
EXPOSE 3000

CMD ["npm", "run", "dev"]
