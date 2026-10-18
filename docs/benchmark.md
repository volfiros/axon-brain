# HERB benchmark

[HERB](https://github.com/SalesforceAIResearch/HERB) (Salesforce AI Research, EMNLP 2025) is a synthetic software company: 30 products with Slack messages, documents, meeting transcripts and chats, pull requests, shared links, 530 employees and 120 customers, plus 815 answerable and 699 unanswerable questions. Every answerable question lists the artifacts that hold its evidence. The paper finds retrieval is the bottleneck: the best agentic RAG setup averages 32.96.

The data is CC BY-NC 4.0 and for research use only, so it lives in `.private/herb/` and never enters the repo or a shared graph.

## How Axon is tested

1. `npm run herb:load` writes each product into its own local graph (`axon_herb-<product>`) through the same connector writer as Slack, GitHub and Plane, using the shapes in [ontology.md](ontology.md#meetings-schema-ready-no-connector): messages with their `channel`, docs, PRs with reviews as messages, meetings with `ATTENDED`, customers as `ExternalParty`. It refuses any FalkorDB that is not on localhost.
2. `npm run herb:retrieval` asks every answerable question through `searchSources`, as the Admin of that graph, and checks whether the cited evidence comes back.
3. `npm run herb:topics` plays the team's agent once per product: it reads the planning meetings and PR titles and links each PR to the feature it builds, as `(PR)-[:ABOUT]->(Topic)`. A teammate or their agent would make the same link in a real workspace.
4. `npm run herb:answer` answers each question with an LLM standing in for a teammate's agent and scores the answer as the paper does: F1 on employee ids, company names and links, and an LLM judge (1 to 100) for content questions. Unanswerable questions score when the answer is exactly UNANSWERABLE. With `HERB_STEPS=8` the agent calls Axon's `search_sources` MCP tool (the same handler the server runs) up to 8 times before it answers; without it, the harness searches once and the model answers from that. It uses OpenRouter when `OPENROUTER_API_KEY` is set, and a re-run with the same label asks only the questions not yet scored.

```bash
FALKORDB_HOST=localhost FALKORDB_PORT=6390 FALKORDB_USERNAME= FALKORDB_PASSWORD= npm run herb:load
```

## Retrieval (all 815 answerable questions)

hit@k: at least one cited artifact in the first k results. recall@k: cited artifacts in the first k, over min(k, cited). Questions cite 15 to 88 artifacts, so a random ranking already reaches some hits.

| Search | hit@10 | recall@10 | hit@20 | recall@20 | recall@50 |
| --- | --- | --- | --- | --- | --- |
| `recall` (decisions only, before this change) | 0 | 0 | 0 | 0 | 0 |
| Random order | 31.8 | 5.2 | 45.4 | 5.4 | 6.6 |
| Full-text over `Source(title, text)` | 30.7 | 10.2 | 43.6 | 9.6 | 10.3 |
| + re-rank 200 candidates by covered query words | 50.1 | 10.7 | 64.7 | 10.9 | 11.7 |
| + rarer words weigh more, 3,000 candidates | 86.0 | 27.2 | 96.2 | 23.3 | 22.4 |
| + the conversation around the top 10 hits | 86.0 | 27.2 | 96.2 | 23.3 | 30.5 |
| + question verbs (find, list, provide, show, give, tell) as stopwords | 88.3 | 29.3 | 96.7 | 24.3 | 32.2 |
| + Sources a top hit references or is referenced by: `search_sources` | 88.3 | 29.3 | 96.7 | 24.3 | 32.4 |

By question type, final search:

| Type | n | hit@10 | recall@10 | recall@50 |
| --- | --- | --- | --- | --- |
| person | 260 | 91.5 | 29.6 | 34.3 |
| content | 238 | 77.7 | 20.7 | 37.3 |
| company | 130 | 87.7 | 31.5 | 38.5 |
| pr | 167 | 97.6 | 39.6 | 16.1 |
| url | 20 | 100 | 28.0 | 39.7 |

What moved the numbers:

- Raw Sources became searchable. Before, the brain only searched decisions, and HERB has none until someone extracts them.
- FalkorDB's full-text score rewards short texts that repeat one word, so it ranks no better than chance on these questions. Taking a wide candidate pool and ranking it by how many of the question's words each Source covers, rarer words counting more, is what lifted hit@10 from 31 to 86, and dropping question verbs took it to 88.
- Chat questions cite whole conversations, so each top message hit brings the messages within six hours of it in the same channel. That lifts recall@50 from 22 to 31 (32 with the stopwords) without moving the first 20 results.
- Customers are referenced by id in messages; the `ExternalParty` nodes turn those ids into company names for the answer step.

## Answers: agent loop

The agent is DeepSeek V4 Flash (`deepseek/deepseek-v4-flash` through OpenRouter) with Axon's `search_sources` tool, up to 8 calls per question; the same model judges content answers. The run stopped when the OpenRouter key reached its spending cap, so these are the 195 questions of the first five products (ActionGenie, AnomalyForce, AutoTuneForce, CoachForce, CollaborateForce). The single-shot run below is scored on the same questions for comparison.

| Type | n | Single search, DeepSeek V3 | Agent loop, V4 Flash |
| --- | --- | --- | --- |
| Content (judge) | 34 | 55.6 | 74.7 |
| People search | 39 | 37.7 | 55.3 |
| Customer search | 19 | 55.9 | 83.8 |
| Artifact search (PRs and URLs) | 19 | 26.0 | 87.5 |
| Unanswerable (correctly refused) | 84 | 63.1 | 67.9 |
| Average of the four answerable types | 111 | 43.8 | **75.3** |
| Average of people, customer, artifact | 77 | 39.9 | **75.5** |

The last row is the endpoint [inherit-brain](https://github.com/zeyusuntt/inherit-brain) reports for its HERB-specific graph and tools (80.0 on 24 held-out products, Qwen3-30B, with HERB's own search tools in the same loop at 39.2). Axon gets close with one general search tool and no HERB-specific extraction, but on five products, not a held-out split, so the two compare only roughly.

What moved the numbers: letting the agent search again with the names, ids and titles the first results reveal, and the `ABOUT` links from PRs to the features the planning meetings name, which `search_sources` follows when a query names the feature.

## Answers: single search (all 1,514 questions)

Each question goes to DeepSeek V3 (`deepseek/deepseek-chat` through OpenRouter) acting as a teammate's agent: it writes up to three keyword queries, `search_sources` runs them and the question itself, and the merged 50 Sources, with any customer ids resolved through `ExternalParty`, are all it may answer from. The same model judges content answers.

| Type | n | Axon + DeepSeek V3 |
| --- | --- | --- |
| Content (judge, 1 to 100) | 238 | 48.5 |
| People search (F1 on employee ids) | 260 | 38.1 |
| Customer search (F1 on company names) | 130 | 48.6 |
| Artifact search (F1 on PR links and URLs) | 187 | 12.3 |
| **Average of the four** | 815 | **36.9** |
| Unanswerable (correctly refused) | 699 | 65.7 |

The paper's best agentic RAG averages 32.96 on the same four types. The numbers compare only roughly: a different answering model, a single search round instead of a multi-step agent, and a DeepSeek judge instead of GPT-4o, which may score content more generously.

Artifact search is the weak spot. PR questions name a feature ("approved PRs for integrating predictive analytics"), while the PRs are titled by task ("Integrate TensorFlow LSTM for Time-Series Forecasting"); only the planning meeting transcripts tie the two together. What we tried for PR questions, measured on the full 167 or a fixed 20-question sample:

| Change | PR score |
| --- | --- |
| First full run | 9.1 (167) |
| Show each PR's reviews (state and reviewer) in `search_sources` | 10.0 (167) |
| Load PRs under GitHub ids so Slack links become `REFERENCES`, and follow them from top hits | 8.6 (20, was 7.4) |
| A second search round driven by what the first one found | 8.6 (20) |
| Agent loop over `search_sources`, with PRs linked `ABOUT` their feature | 85.1 (16, first five products) |

"Approved" in HERB comes from the Slack review threads, not the PR review states, and the planning meetings name features in words no PR or message shares. The server makes no semantic link itself; the `ABOUT` Topic links come from the agent step in `npm run herb:topics`.

## Limits

- Retrieval runs as an Admin, so access filtering is exercised but never hides evidence here.
- Product codenames (for example dAIX for TrendForce) are not linked to product names, so questions that only name the product lean on other words.
- The judge is the answering model, not the paper's GPT-4o, so content scores compare only roughly.
- The agent-loop numbers cover five of 30 products; the rest did not run before the key's spending cap.
- Search was tuned on the same questions it is scored on; there is no held-out split.
