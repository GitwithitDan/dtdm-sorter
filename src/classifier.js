const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

async function callClaudeJson(systemPrompt, userPrompt) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  const raw = textBlock ? textBlock.text : '{}';
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    return { error: 'parse_failed', raw: cleaned };
  }
}

async function classifyFilter(instruction, filename, content) {
  const system = `You review a single file against one sorting criterion. Respond ONLY with JSON, no preamble, no markdown fences. Schema: {"match": true|false, "confidence": 0.0-1.0, "reason": "short reason"}`;
  const user = `Criterion: ${instruction}\n\nFilename: ${filename}\n\nContent:\n${content}`;
  return callClaudeJson(system, user);
}

async function classifyFixedCategory(categories, filename, content) {
  const catList = categories.map((c) => `- ${c.name}: ${c.description}`).join('\n');
  const system = `You classify a file into the single best-fit category from a fixed list. If nothing fits reasonably, use "NO_MATCH". Respond ONLY with JSON, no preamble, no markdown fences. Schema: {"category": "exact category name or NO_MATCH", "confidence": 0.0-1.0, "reason": "short reason"}`;
  const user = `Categories:\n${catList}\n\nFilename: ${filename}\n\nContent:\n${content}`;
  return callClaudeJson(system, user);
}

async function classifyGrowable(categories, filename, content) {
  const catList = categories.length
    ? categories.map((c) => `- ${c.name}: ${c.description}`).join('\n')
    : '(no categories exist yet)';
  const system = `You classify a file into the best-fit category from a list that is allowed to grow. If the file fits an existing category well, use it. If it clearly does not fit any existing category, propose a new one. Respond ONLY with JSON, no preamble, no markdown fences. Schema: {"category": "existing category name, or a new short category name", "is_new_category": true|false, "new_category_description": "only if is_new_category is true, one sentence", "confidence": 0.0-1.0, "reason": "short reason"}`;
  const user = `Existing categories:\n${catList}\n\nFilename: ${filename}\n\nContent:\n${content}`;
  return callClaudeJson(system, user);
}

async function generateCategories(instruction, samples) {
  const sampleText = samples
    .map((s, i) => `--- File ${i + 1}: ${s.file.name} ---\n${s.content}`)
    .join('\n\n');
  const intentClause = instruction
    ? `The user's sorting intent: "${instruction}".`
    : 'No specific intent was given -- infer sensible topical categories from the content itself.';
  const system = `You are proposing an initial folder taxonomy to organize a batch of files. ${intentClause} Propose between 2 and 8 categories. Respond ONLY with JSON, no preamble, no markdown fences. Schema: {"categories": [{"name": "short folder name", "description": "one sentence description used for future classification"}]}`;
  return callClaudeJson(system, sampleText);
}

async function resolveInstanceConfig(oneLineInstruction) {
  const system = `A user wants to create a new file-sorting instance from a single instruction. Decide which of three modes fits best:
- "filter": the instruction names one criterion, files either match or don't (e.g. "find everything related to martial arts").
- "fixed_category": the instruction implies a small fixed set of named categories (e.g. "sort into business vs personal").
- "discover_then_sort": no categories are given or implied; the user wants the content itself to determine the folder structure (e.g. "sort these", "organize these files").
Respond ONLY with JSON, no preamble, no markdown fences. Schema: {"mode": "filter|fixed_category|discover_then_sort", "instruction": "cleaned restatement of the instruction", "categories": [{"name":"...","description":"..."}] (empty array if mode is filter or discover_then_sort), "suggested_instance_name": "short name for this instance"}`;
  return callClaudeJson(system, oneLineInstruction);
}

module.exports = {
  classifyFilter,
  classifyFixedCategory,
  classifyGrowable,
  generateCategories,
  resolveInstanceConfig,
};
