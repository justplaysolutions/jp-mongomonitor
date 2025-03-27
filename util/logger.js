import log from 'npmlog';
import Slack from './slack.js';

let slack;

export function notifyError(error, config, subject) {
  // Fallback to generic subject
  subject = subject || 'Health Check Failed';

  // Log error to CLI
  log.error('mongomonitor', new Date(), error.message);

  // Send Slack message if webhook settings present
  if (config.slack !== undefined) {
    if (slack === undefined) {
      slack = new Slack(config.slack);
    }
    slack.sendWebhookMessage(subject, error)
    .catch((slackError) => {
      log.error('mongomonitor', new Date(), slackError.message);
    });
  }
}
