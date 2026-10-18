import type { BrainTool } from "../tool";
import changesSince from "./changes-since";
import checkAnswer from "./check-answer";
import answerStatus from "./answer-status";
import graphAlgorithm from "./graph-algorithm";
import impact from "./impact";
import knowledgeRisk from "./knowledge-risk";
import listQuestions from "./list-questions";
import pendingSources from "./pending-sources";
import proposeFromSource from "./propose-from-source";
import recall from "./recall";
import reviewProposals from "./review-proposals";
import reviewSourceChanges from "./review-source-changes";
import save from "./save";
import searchSources from "./search-sources";
import saveAnswer from "./save-answer";
import saveSession from "./save-session";
import staleDecisions from "./stale-decisions";
import supersede from "./supersede";
import whoami from "./whoami";
import whoKnows from "./who-knows";

export const tools: BrainTool[] = [
  whoami,
  recall,
  searchSources,
  save,
  saveSession,
  supersede,
  whoKnows,
  impact,
  staleDecisions,
  graphAlgorithm,
  knowledgeRisk,
  listQuestions,
  pendingSources,
  proposeFromSource,
  reviewProposals,
  reviewSourceChanges,
  changesSince,
  checkAnswer,
  saveAnswer,
  answerStatus,
];
