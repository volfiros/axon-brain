import { z } from "zod";
import { SAVE_SESSION_TEMPLATE } from "../session/template";
import { definePrompt } from "../tool";

export default definePrompt({
  name: "save-session",
  description: "Distill this session's decisions, constraints, assumptions, open questions and notes, confirm them with you, and save them to Axon.",
  argsSchema: z.object({}),
  async handler() {
    return SAVE_SESSION_TEMPLATE;
  },
});
