const https = require('https');

class TelegramService {
  constructor(botToken, chatId) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  async send(text, options = {}) {
    return new Promise((resolve) => {
      const payload = {
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML'
      };

      if (options.buttons) {
        payload.reply_markup = JSON.stringify({
          inline_keyboard: options.buttons
        });
      }

      const data = JSON.stringify(payload);

      const reqOptions = {
        hostname: 'api.telegram.org',
        path: `/bot${this.botToken}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      };

      const req = https.request(reqOptions, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            const resp = JSON.parse(body);
            if (!resp.ok) console.error('[TG] Error:', resp.description);
            else resolve(resp.result);
          } catch(e) { resolve(); }
        });
      });
      req.on('error', (e) => {
        console.error('[TG] Send error:', e.message);
        resolve();
      });
      req.write(data);
      req.end();
    });
  }

  async editMessage(messageId, text, options = {}) {
    return new Promise((resolve) => {
      const payload = {
        chat_id: this.chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML'
      };

      if (options.buttons) {
        payload.reply_markup = JSON.stringify({
          inline_keyboard: options.buttons
        });
      }

      const data = JSON.stringify(payload);

      const reqOptions = {
        hostname: 'api.telegram.org',
        path: `/bot${this.botToken}/editMessageText`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      };

      const req = https.request(reqOptions, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            const resp = JSON.parse(body);
            if (!resp.ok) console.error('[TG] Edit error:', resp.description);
          } catch(e) {}
          resolve();
        });
      });
      req.on('error', (e) => {
        console.error('[TG] Edit error:', e.message);
        resolve();
      });
      req.write(data);
      req.end();
    });
  }
}

module.exports = TelegramService;
