'use strict';

const { IncomingWebhook } = require('@slack/webhook');

function Slack(slackConfig) {
    this.config = slackConfig;
    this.webhook = new IncomingWebhook(this.config.channelUrl);
}

/**
 * Send a new message to the webhook
 * @param {String} subject
 * @param {Error} error
 * @return {Promise}
 */
Slack.prototype.sendWebhookMessage = function (subject, error) {
    const self = this;
    return new Promise(function (resolve, reject) {
        const messageBody = self.generateMessage(subject, error);
        (async () => {
            try {
              const reply = await self.webhook.send(messageBody);
              resolve(reply);
            } catch (error) {
              reject(error);
            }
        })();
    });
};

/**
 * Generate message body to send using slack SDK
 * @param {String} subject
 * @param {Error} error
 * @return {{attachments: [*]}}
 */
Slack.prototype.generateMessage = function (subject, error) {
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
};

module.exports = Slack;