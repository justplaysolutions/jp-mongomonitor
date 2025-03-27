import { IncomingWebhook } from '@slack/webhook';

export default class Slack {
  constructor(slackConfig) {
    this.config = slackConfig;
    this.webhook = new IncomingWebhook(this.config.channelUrl);
  }

  /**
  * Send a new message to the webhook
  * @param {String} subject
  * @param {Error} error
  * @return {Promise}
  */
  sendWebhookMessage(subject, error) {
    return new Promise(((resolve, reject) => {
      const messageBody = this.generateMessage(subject, error);
      (async () => {
        try {
          const reply = await this.webhook.send(messageBody);
          resolve(reply);
        }
        catch (err) {
          reject(err);
        }
      })();
    }));
  }

  /**
  * Generate message body to send using slack SDK
  * @param {String} subject
  * @param {Error} error
  * @return {{attachments: [*]}}
  */
  generateMessage(subject, error) {
    const membersToAlert = this.config.notifyMembers !== undefined && this.config.notifyMembers.length > 0 ?
      this.config.notifyMembers.map(username => `<@${username}>`).join(' ') : undefined;
    return {
      attachments: [{
        fallback: error.message,
        pretext: membersToAlert,
        author_name: 'MongoMonitor',
        author_link: 'https://github.com/eladnava/mongomonitor',
        color: 'danger',
        title: subject,
        text: error.message
      }]
    };
  }
}
