const nodemailer = require('nodemailer');
const { WebClient } = require('@slack/web-api');

class TestNotifier {
  constructor() {
    this.emailTransporter = null;
    this.slackClient = null;
    this.setupEmail();
    this.setupSlack();
  }

  setupEmail() {
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      this.emailTransporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }
  }

  setupSlack() {
    if (process.env.SLACK_BOT_TOKEN) {
      this.slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    }
  }

  async notifyTestResults(results) {
    const summary = this.generateTestSummary(results);
    
    // Send notifications in parallel
    const notifications = [];
    
    if (this.emailTransporter) {
      notifications.push(this.sendEmailNotification(summary));
    }
    
    if (this.slackClient) {
      notifications.push(this.sendSlackNotification(summary));
    }
    
    try {
      await Promise.all(notifications);
      console.log('✅ Test notifications sent successfully');
    } catch (error) {
      console.error('❌ Failed to send test notifications:', error.message);
    }
  }

  generateTestSummary(results) {
    const {
      totalTests,
      passedTests,
      failedTests,
      testSuites,
      errors,
      performance,
      security,
      coverage
    } = results;

    const passRate = ((passedTests / totalTests) * 100).toFixed(1);
    const status = failedTests === 0 ? 'SUCCESS' : 'FAILURE';
    const emoji = status === 'SUCCESS' ? '✅' : '❌';

    return {
      status,
      emoji,
      passRate,
      totalTests,
      passedTests,
      failedTests,
      testSuites,
      errors,
      performance,
      security,
      coverage,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'test'
    };
  }

  async sendEmailNotification(summary) {
    if (!this.emailTransporter) return;

    const subject = `SplitSet Testing Report - ${summary.status} (${summary.passRate}% passed)`;
    
    const htmlContent = this.generateEmailHTML(summary);
    
    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.NOTIFICATION_EMAIL || 'admin@splitset.app',
      subject,
      html: htmlContent,
    };

    await this.emailTransporter.sendMail(mailOptions);
  }

  async sendSlackNotification(summary) {
    if (!this.slackClient) return;

    const blocks = this.generateSlackBlocks(summary);
    
    await this.slackClient.chat.postMessage({
      channel: process.env.SLACK_CHANNEL || '#splitset-alerts',
      blocks,
      username: 'SplitSet Test Bot',
      icon_emoji: summary.emoji
    });
  }

  generateEmailHTML(summary) {
    const statusColor = summary.status === 'SUCCESS' ? '#10B981' : '#EF4444';
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>SplitSet Testing Report</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .header { background: ${statusColor}; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; }
          .metric { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 8px; }
          .success { color: #10B981; }
          .failure { color: #EF4444; }
          .warning { color: #F59E0B; }
          .table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          .table th, .table td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
          .table th { background-color: #f8f9fa; }
          .footer { background: #f8f9fa; padding: 15px; text-align: center; color: #666; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${summary.emoji} SplitSet Testing Report</h1>
          <h2>Status: ${summary.status}</h2>
          <p>Test Pass Rate: ${summary.passRate}%</p>
        </div>
        
        <div class="content">
          <div class="metric">
            <h3>📊 Test Summary</h3>
            <p><strong>Total Tests:</strong> ${summary.totalTests}</p>
            <p><strong>Passed:</strong> <span class="success">${summary.passedTests}</span></p>
            <p><strong>Failed:</strong> <span class="failure">${summary.failedTests}</span></p>
            <p><strong>Environment:</strong> ${summary.environment}</p>
            <p><strong>Timestamp:</strong> ${new Date(summary.timestamp).toLocaleString()}</p>
          </div>

          ${summary.testSuites ? this.generateTestSuitesHTML(summary.testSuites) : ''}
          
          ${summary.performance ? this.generatePerformanceHTML(summary.performance) : ''}
          
          ${summary.security ? this.generateSecurityHTML(summary.security) : ''}
          
          ${summary.coverage ? this.generateCoverageHTML(summary.coverage) : ''}
          
          ${summary.errors && summary.errors.length > 0 ? this.generateErrorsHTML(summary.errors) : ''}
        </div>
        
        <div class="footer">
          <p>SplitSet Automated Testing System</p>
          <p>This is an automated message. Please do not reply.</p>
        </div>
      </body>
      </html>
    `;
  }

  generateTestSuitesHTML(testSuites) {
    const suiteRows = testSuites.map(suite => `
      <tr>
        <td>${suite.name}</td>
        <td class="success">${suite.passed}</td>
        <td class="failure">${suite.failed}</td>
        <td>${suite.duration}ms</td>
      </tr>
    `).join('');

    return `
      <div class="metric">
        <h3>🧪 Test Suites</h3>
        <table class="table">
          <thead>
            <tr>
              <th>Suite Name</th>
              <th>Passed</th>
              <th>Failed</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            ${suiteRows}
          </tbody>
        </table>
      </div>
    `;
  }

  generatePerformanceHTML(performance) {
    return `
      <div class="metric">
        <h3>⚡ Performance Metrics</h3>
        <p><strong>Average Response Time:</strong> ${performance.avgResponseTime}ms</p>
        <p><strong>95th Percentile:</strong> ${performance.p95}ms</p>
        <p><strong>Requests Per Second:</strong> ${performance.rps}</p>
        <p><strong>SplitSet Revenue Calc Time:</strong> ${performance.revenueCalcTime}ms</p>
      </div>
    `;
  }

  generateSecurityHTML(security) {
    return `
      <div class="metric">
        <h3>🔒 Security Tests</h3>
        <p><strong>Auth Tests:</strong> <span class="${security.authPassed ? 'success' : 'failure'}">${security.authPassed ? 'PASSED' : 'FAILED'}</span></p>
        <p><strong>Input Validation:</strong> <span class="${security.inputValidation ? 'success' : 'failure'}">${security.inputValidation ? 'PASSED' : 'FAILED'}</span></p>
        <p><strong>SQL Injection Protection:</strong> <span class="${security.sqlInjection ? 'success' : 'failure'}">${security.sqlInjection ? 'PASSED' : 'FAILED'}</span></p>
        <p><strong>XSS Protection:</strong> <span class="${security.xssProtection ? 'success' : 'failure'}">${security.xssProtection ? 'PASSED' : 'FAILED'}</span></p>
      </div>
    `;
  }

  generateCoverageHTML(coverage) {
    return `
      <div class="metric">
        <h3>📈 Code Coverage</h3>
        <p><strong>Lines:</strong> ${coverage.lines}%</p>
        <p><strong>Functions:</strong> ${coverage.functions}%</p>
        <p><strong>Branches:</strong> ${coverage.branches}%</p>
        <p><strong>Statements:</strong> ${coverage.statements}%</p>
      </div>
    `;
  }

  generateErrorsHTML(errors) {
    const errorItems = errors.map(error => `
      <li>
        <strong>${error.test}:</strong> ${error.message}
        ${error.stack ? `<pre style="background: #f8f9fa; padding: 10px; margin: 5px 0;">${error.stack}</pre>` : ''}
      </li>
    `).join('');

    return `
      <div class="metric">
        <h3>❌ Test Failures</h3>
        <ul>
          ${errorItems}
        </ul>
      </div>
    `;
  }

  generateSlackBlocks(summary) {
    const statusColor = summary.status === 'SUCCESS' ? 'good' : 'danger';
    
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${summary.emoji} SplitSet Testing Report`
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Status:* ${summary.status}`
          },
          {
            type: 'mrkdwn',
            text: `*Pass Rate:* ${summary.passRate}%`
          },
          {
            type: 'mrkdwn',
            text: `*Total Tests:* ${summary.totalTests}`
          },
          {
            type: 'mrkdwn',
            text: `*Environment:* ${summary.environment}`
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Results:* ${summary.passedTests} passed, ${summary.failedTests} failed`
        }
      }
    ];

    // Add performance section if available
    if (summary.performance) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Performance:* Avg ${summary.performance.avgResponseTime}ms, P95 ${summary.performance.p95}ms, ${summary.performance.rps} RPS`
        }
      });
    }

    // Add security section if available
    if (summary.security) {
      const securityStatus = Object.values(summary.security).every(Boolean) ? '✅ All Passed' : '❌ Some Failed';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Security Tests:* ${securityStatus}`
        }
      });
    }

    // Add errors section if there are failures
    if (summary.errors && summary.errors.length > 0) {
      const errorText = summary.errors.slice(0, 3).map(error => `• ${error.test}: ${error.message}`).join('\n');
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Recent Failures:*\n${errorText}${summary.errors.length > 3 ? `\n... and ${summary.errors.length - 3} more` : ''}`
        }
      });
    }

    // Add timestamp
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Tested at ${new Date(summary.timestamp).toLocaleString()}`
        }
      ]
    });

    return blocks;
  }

  // Method to send custom alerts for specific conditions
  async sendCriticalAlert(alertData) {
    const { title, message, severity = 'high', component } = alertData;
    
    const emoji = severity === 'critical' ? '🚨' : severity === 'high' ? '⚠️' : 'ℹ️';
    
    const notifications = [];
    
    // Email alert
    if (this.emailTransporter) {
      notifications.push(this.emailTransporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: process.env.CRITICAL_ALERT_EMAIL || process.env.NOTIFICATION_EMAIL,
        subject: `${emoji} SplitSet Alert: ${title}`,
        html: `
          <h2>${emoji} SplitSet Alert</h2>
          <p><strong>Component:</strong> ${component}</p>
          <p><strong>Severity:</strong> ${severity.toUpperCase()}</p>
          <p><strong>Message:</strong> ${message}</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        `
      }));
    }
    
    // Slack alert
    if (this.slackClient) {
      notifications.push(this.slackClient.chat.postMessage({
        channel: process.env.SLACK_ALERT_CHANNEL || process.env.SLACK_CHANNEL || '#splitset-alerts',
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${emoji} SplitSet Alert`
            }
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Component:* ${component}`
              },
              {
                type: 'mrkdwn',
                text: `*Severity:* ${severity.toUpperCase()}`
              }
            ]
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Message:* ${message}`
            }
          }
        ]
      }));
    }
    
    try {
      await Promise.all(notifications);
    } catch (error) {
      console.error('Failed to send critical alert:', error);
    }
  }
}

module.exports = TestNotifier;
