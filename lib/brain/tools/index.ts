import type { BrainTool } from "../tool";
import impact from "./impact";
import pendingSources from "./pending-sources";
import proposeFromSource from "./propose-from-source";
import recall from "./recall";
import reviewProposals from "./review-proposals";
import save from "./save";
import supersede from "./supersede";
import whoami from "./whoami";
import whoKnows from "./who-knows";

export const tools: BrainTool[] = [
  whoami,
  recall,
  save,
  supersede,
  whoKnows,
  impact,
  pendingSources,
  proposeFromSource,
  reviewProposals,
];
