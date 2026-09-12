import { IssueClassifierOutput, RemediationSelectorOutput } from './types.js';

export class RemediationSelector {
  public selectRemediation(issue: IssueClassifierOutput): RemediationSelectorOutput {
    switch (issue.issue) {
      case 'freelancer_api_failure':
        return {
          recommended_action: 'restartScraper',
          confidence: 0.91,
          expected_success: 0.88,
          alternative_actions: ['syncFreelancerJobs', 'clearCache', 'diagnoseFreelancer'],
        };

      case 'database_degradation':
        return {
          recommended_action: 'reconnectDatabase',
          confidence: 0.93,
          expected_success: 0.90,
          alternative_actions: ['createDatabaseSnapshot', 'verifyPostgres', 'reseedData'],
        };

      case 'queue_bottleneck':
        return {
          recommended_action: 'retryFailedJobs',
          confidence: 0.89,
          expected_success: 0.85,
          alternative_actions: ['restartWorkers', 'inspectQueue', 'clearCache'],
        };

      case 'overdue_work_orders':
        return {
          recommended_action: 'healWorkOrders',
          confidence: 0.92,
          expected_success: 0.89,
          alternative_actions: ['updateWorkOrderPriority', 'findOverdueOrders', 'verifyWorkOrders'],
        };

      default:
        return {
          recommended_action: 'verifySync',
          confidence: 0.95,
          expected_success: 0.95,
          alternative_actions: ['diagnoseFreelancer', 'verifyPostgres', 'inspectQueue'],
        };
    }
  }
}

export const remediationSelector = new RemediationSelector();
