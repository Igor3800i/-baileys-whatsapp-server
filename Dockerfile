FROM node:18-alpine

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

COPY package*.json ./

# Install dependencies with retry
RUN npm install --legacy-peer-deps || npm install --legacy-peer-deps

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
