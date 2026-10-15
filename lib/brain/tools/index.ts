import type { BrainTool } from "../tool";
import impact from "./impact";
import pendingSources from "./pending-sources";
import proposeFromSource from "./propose-from-source";
import recall from "./recall";
import reviewProposals from "./review-proposals";
import reviewSourceChanges from "./review-source-changes";
import save from "./save";
import saveSession from "./save-session";
import supersede from "./supersede";
import whoami from "./whoami";
import whoKnows from "./who-knows";

export const tools: BrainTool[] = [
  whoami,
  recall,
  save,
  saveSession,
  supersede,
  whoKnows,
  impact,
  pendingSources,
  proposeFromSource,
  reviewProposals,
  reviewSourceChanges,
];
