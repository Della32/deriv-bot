FROM node:20-slim

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Create data directory
RUN mkdir -p data

EXPOSE 3000

CMD ["node", "src/mult/index.js"]
