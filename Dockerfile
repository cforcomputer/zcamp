FROM node:20.17

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json .

RUN npm ci

COPY . .

EXPOSE 8080

CMD [ "node", "src/index.js" ]