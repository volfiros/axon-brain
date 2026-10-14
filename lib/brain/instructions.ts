export const instructions = [
  "Axon is this team's memory of decisions: what was decided, why, what was rejected, who decided and where it was said.",
  "Before changing code or a process, call recall with the file, process or topic to check for past decisions, and follow them or say why not.",
  "When recall answers, keep its sources and graph path in your reply. Never guess at a decision it did not return.",
  "When a restricted item is mentioned, pass on who to ask. Do not try to work out its content.",
  "To record something, call save or supersede with confirm: false, show the preview to the user, and only call again with confirm: true after they agree.",
  "To turn connector data into decisions: call pending_sources, read each Source, and call recall on each decision you find to skip ones already saved.",
  "Then call propose_from_source once per Source with the new decisions only, each excerpt copied word for word, or with no items when it holds no decision.",
  "Proposed decisions are not accepted. Show them with review_proposals list, and accept or dismiss only the ones the user names.",
].join("\n");
