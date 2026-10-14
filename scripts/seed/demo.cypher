// Tallyroll: a fictional invoicing startup. Every name, quote and number here is synthetic.

CREATE
  (admin:Role {id: 'role_admin', name: 'Admin'}),
  (member:Role {id: 'role_member', name: 'Member'}),
  (guest:Role {id: 'role_guest', name: 'Guest'}),

  (eng:Team {id: 'team_eng', name: 'Engineering'}),
  (ops:Team {id: 'team_ops', name: 'Operations'}),

  (maya:Person {id: 'p_maya', name: 'Maya Okafor', handle: 'maya', title: 'Founder', account_id: 'acct_demo_maya'}),
  (dev:Person {id: 'p_dev', name: 'Dev Raman', handle: 'devr', title: 'Engineer', account_id: 'acct_demo_dev'}),
  (lena:Person {id: 'p_lena', name: 'Lena Fischer', handle: 'lena', title: 'Operations lead', account_id: 'acct_demo_lena'}),
  (sam:Person {id: 'p_sam', name: 'Sam Ortiz', handle: 'samo', title: 'Contract engineer', account_id: 'acct_demo_sam'}),
  (ari:Person {id: 'p_ari', name: 'Ari Chen', handle: 'arichen', title: 'Former engineer'}),

  (maya)-[:HAS_ROLE]->(admin),
  (dev)-[:HAS_ROLE]->(member),
  (lena)-[:HAS_ROLE]->(member),
  (sam)-[:HAS_ROLE]->(guest),
  (maya)-[:MEMBER_OF]->(eng),
  (dev)-[:MEMBER_OF]->(eng),
  (lena)-[:MEMBER_OF]->(ops),

  (refunds:Project {id: 'proj_refunds', name: 'Self-serve refunds'}),
  (refundFlow:Process {id: 'proc_refund', name: 'Refund flow'}),
  (repo:CodeUnit {id: 'cu_repo', name: 'tallyroll/app', kind: 'repository', path: '/'}),
  (refundsFile:CodeUnit {id: 'cu_refunds', name: 'refunds.ts', kind: 'file', path: 'src/billing/refunds.ts'}),
  (webhooksFile:CodeUnit {id: 'cu_webhooks', name: 'webhooks.ts', kind: 'file', path: 'src/billing/webhooks.ts'}),
  (regionsFile:CodeUnit {id: 'cu_regions', name: 'regions.tf', kind: 'file', path: 'infra/regions.tf'}),
  (refundsFile)-[:PART_OF]->(repo),
  (webhooksFile)-[:PART_OF]->(repo),
  (regionsFile)-[:PART_OF]->(repo),

  (refundButton:WorkItem {id: 'wi_refund_button', title: 'Add a refund button to the billing page', status: 'in_progress'}),
  (refundButton)-[:PART_OF]->(refunds),
  (refundButton)-[:TOUCHES]->(refundsFile),

  (topicRefunds:Topic {id: 'topic_refunds', name: 'refunds'}),
  (topicWebhooks:Topic {id: 'topic_webhooks', name: 'payment webhooks'}),
  (topicResidency:Topic {id: 'topic_residency', name: 'data residency'}),

  (northwind:ExternalParty {id: 'ext_northwind', name: 'Northwind Retail', kind: 'customer'}),
  (slowRefunds:Feedback {id: 'fb_slow_refunds', text: 'Refund requests sit for days before anyone answers.', kind: 'complaint'}),
  (slowRefunds)-[:FROM]->(northwind),
  (slowRefunds)-[:REPORTS]->(refundFlow),

  (maya)-[:OWNS]->(refunds),
  (lena)-[:OWNS]->(refundFlow),
  (dev)-[:OWNS]->(webhooksFile),
  (dev)-[:WORKED_ON {count: 14, last_at: localdatetime('2026-09-30T16:20:00')}]->(webhooksFile),
  (dev)-[:WORKED_ON {count: 6, last_at: localdatetime('2026-09-18T11:05:00')}]->(refundsFile),
  (sam)-[:WORKED_ON {count: 2, last_at: localdatetime('2026-10-10T10:00:00')}]->(refundButton),
  (ari)-[:WORKED_ON {count: 9, last_at: localdatetime('2026-06-02T09:00:00')}]->(webhooksFile),

  (pr12:Source:PR {id: 'src_pr12', title: 'PR #12: Retry the webhook handler on failure', url: 'https://github.com/tallyroll/app/pull/12', sensitivity: 'public', created_at: localdatetime('2026-06-02T09:00:00')}),
  (pr57:Source:PR {id: 'src_pr57', title: 'PR #57: Handle webhooks idempotently', url: 'https://github.com/tallyroll/app/pull/57', sensitivity: 'public', created_at: localdatetime('2026-08-14T15:30:00')}),
  (pr61:Source:PR {id: 'src_pr61', title: 'PR #61: Manual approval for large refunds', url: 'https://github.com/tallyroll/app/pull/61', sensitivity: 'public', created_at: localdatetime('2026-09-03T10:10:00')}),
  (opsThread:Source:Thread {id: 'src_ops_thread', title: '#ops thread: refund ticket backlog', sensitivity: 'team', created_at: localdatetime('2026-09-10T08:45:00')}),
  (foundersSync:Source:Meeting {id: 'src_founders_sync', title: 'Founder sync, 22 Sep 2026', sensitivity: 'restricted', created_at: localdatetime('2026-09-22T17:00:00')}),
  (ari)-[:AUTHORED]->(pr12),
  (dev)-[:AUTHORED]->(pr57),
  (dev)-[:AUTHORED]->(pr61),
  (lena)-[:AUTHORED]->(opsThread),
  (maya)-[:AUTHORED]->(foundersSync),

  (ex12:Excerpt {id: 'ex_pr12', text: 'If the handler throws, retry it inline up to three times before giving up.'}),
  (ex57:Excerpt {id: 'ex_pr57', text: 'The processor resends events and can deliver them out of order, so we store the event id and skip anything we have already seen. Retrying inline was double-crediting refunds.'}),
  (ex61:Excerpt {id: 'ex_pr61', text: 'Anything over $500 has to wait for a human. The processor flags large refunds issued with no approval step and freezes payouts while it reviews them.'}),
  (exOps:Excerpt {id: 'ex_ops_thread', text: 'From Monday every refund ticket gets a first answer within one business day, even if it is just to say we are on it.'}),
  (exSync:Excerpt {id: 'ex_founders_sync', text: 'We will stand up an EU region before the Brightwater pilot. Without it the contract does not go ahead.'}),
  (ex12)-[:IN]->(pr12),
  (ex57)-[:IN]->(pr57),
  (ex61)-[:IN]->(pr61),
  (exOps)-[:IN]->(opsThread),
  (exSync)-[:IN]->(foundersSync),

  (outOfOrder:Constraint {id: 'con_webhook_order', statement: 'Processor webhooks can arrive more than once and out of order', sensitivity: 'public'}),
  (largeRefunds:Constraint {id: 'con_large_refunds', statement: 'The payment processor reviews refunds over $500 issued without an approval step', sensitivity: 'public'}),
  (euContract:Constraint {id: 'con_eu_contract', statement: 'The Brightwater pilot contract requires customer data to stay in the EU', sensitivity: 'restricted'}),
  (fewReviews:Assumption {id: 'asm_review_volume', statement: 'Fewer than 20 refunds a day will need a manual approval', sensitivity: 'team'}),

  (pollApi:Alternative {id: 'alt_poll_api', title: 'Poll the processor API every minute instead of using webhooks', reason_rejected: 'Rate limits and a minute of lag on every refund'}),
  (autoApprove:Alternative {id: 'alt_auto_approve', title: 'Auto-approve every refund', reason_rejected: 'Large refunds would trigger processor reviews and frozen payouts'}),
  (usOnly:Alternative {id: 'alt_us_only', title: 'Stay US-only and let the pilot go', reason_rejected: 'The pilot is the largest deal in the pipeline'}),

  (retries:Decision {id: 'dec_webhook_retries', title: 'Retry failed webhook handling inline', statement: 'When the webhook handler fails, retry it inline up to three times.', status: 'superseded', sensitivity: 'public', valid_from: localdatetime('2026-06-02T09:00:00'), valid_to: localdatetime('2026-08-14T15:30:00'), recorded_at: localdatetime('2026-06-02T09:00:00'), confidence: 0.7, extracted_by: 'import'}),
  (idempotent:Decision {id: 'dec_idempotent_webhooks', title: 'Handle webhooks idempotently by event id', statement: 'Store each processor event id and skip events that were already handled.', status: 'accepted', sensitivity: 'public', valid_from: localdatetime('2026-08-14T15:30:00'), recorded_at: localdatetime('2026-08-14T16:00:00'), confidence: 0.95, extracted_by: 'llm', confirmed_by: 'p_maya'}),
  (manualReview:Decision {id: 'dec_manual_review', title: 'Refunds over $500 need a manual approval', statement: 'Refunds above $500 wait in a queue until someone approves them. Smaller refunds go through automatically.', status: 'accepted', sensitivity: 'public', valid_from: localdatetime('2026-09-03T10:10:00'), recorded_at: localdatetime('2026-09-03T12:00:00'), confidence: 0.92, extracted_by: 'llm', confirmed_by: 'p_lena'}),
  (refundSla:Decision {id: 'dec_refund_sla', title: 'Answer refund tickets within one business day', statement: 'Every refund ticket gets a first reply within one business day.', status: 'accepted', sensitivity: 'team', valid_from: localdatetime('2026-09-14T09:00:00'), recorded_at: localdatetime('2026-09-10T09:00:00'), confidence: 0.88, extracted_by: 'llm', confirmed_by: 'p_lena'}),
  (euRegion:Decision {id: 'dec_eu_region', title: 'Stand up an EU hosting region', statement: 'Run a separate EU region for customers whose contracts require EU data hosting.', status: 'accepted', sensitivity: 'restricted', valid_from: localdatetime('2026-09-22T17:00:00'), recorded_at: localdatetime('2026-09-22T18:00:00'), confidence: 0.9, extracted_by: 'llm', confirmed_by: 'p_maya'}),

  (retries)-[:MADE_BY]->(ari),
  (retries)-[:ABOUT]->(topicWebhooks),
  (retries)-[:AFFECTS]->(webhooksFile),
  (retries)-[:IMPLEMENTED_BY]->(pr12),
  (retries)-[:DERIVED_FROM]->(ex12),

  (idempotent)-[:MADE_BY]->(dev),
  (idempotent)-[:APPROVED_BY]->(maya),
  (idempotent)-[:SUPERSEDES]->(retries),
  (idempotent)-[:ABOUT]->(topicWebhooks),
  (idempotent)-[:AFFECTS]->(webhooksFile),
  (idempotent)-[:AFFECTS]->(refundFlow),
  (idempotent)-[:BECAUSE_OF]->(outOfOrder),
  (idempotent)-[:CONSIDERED]->(pollApi),
  (idempotent)-[:IMPLEMENTED_BY]->(pr57),
  (idempotent)-[:DERIVED_FROM]->(ex57),

  (manualReview)-[:MADE_BY]->(lena),
  (manualReview)-[:APPROVED_BY]->(maya),
  (manualReview)-[:ABOUT]->(topicRefunds),
  (manualReview)-[:AFFECTS]->(refundFlow),
  (manualReview)-[:AFFECTS]->(refundsFile),
  (manualReview)-[:BECAUSE_OF]->(largeRefunds),
  (manualReview)-[:BECAUSE_OF]->(fewReviews),
  (manualReview)-[:CONSIDERED]->(autoApprove),
  (manualReview)-[:IMPLEMENTED_BY]->(pr61),
  (manualReview)-[:DERIVED_FROM]->(ex61),

  (refundSla)-[:MADE_BY]->(lena),
  (refundSla)-[:ABOUT]->(topicRefunds),
  (refundSla)-[:AFFECTS]->(refundFlow),
  (refundSla)-[:BECAUSE_OF]->(slowRefunds),
  (refundSla)-[:DERIVED_FROM]->(exOps),

  (euRegion)-[:MADE_BY]->(maya),
  (euRegion)-[:ABOUT]->(topicResidency),
  (euRegion)-[:AFFECTS]->(regionsFile),
  (euRegion)-[:BECAUSE_OF]->(euContract),
  (euRegion)-[:CONSIDERED]->(usOnly),
  (euRegion)-[:DERIVED_FROM]->(exSync);

// Visibility follows the glossary: public reaches every Role, team excludes Guests, restricted is Admin only.
MATCH (n) WHERE n.sensitivity IS NOT NULL
MATCH (r:Role)
WHERE r.name = 'Admin'
   OR (r.name = 'Member' AND n.sensitivity <> 'restricted')
   OR (r.name = 'Guest' AND n.sensitivity = 'public')
CREATE (n)-[:VISIBLE_TO]->(r);
