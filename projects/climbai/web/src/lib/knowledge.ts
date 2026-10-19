import knowledgeFile from '../../../backend/knowledge.json';
import retrievalRules from '../../../backend/retrieval_rules.json';
import type { Citation, KnowledgeMeta } from './types';

interface KnowledgeRecord extends Citation { keywords: string[]; tags: string[] }
const records: KnowledgeRecord[] = knowledgeFile.knowledge;
export const knowledgeSources: Citation[] = records.map(({ keywords: _keywords, tags: _tags, ...citation }) => citation);
export const knowledgeMetadata: KnowledgeMeta = {
  version: knowledgeFile.version,
  review_status: knowledgeFile.review_status,
  knowledge_count: records.length,
  exercise_count: knowledgeFile.exercises.length,
  reference_page_count: new Set(records.flatMap(item => item.url ? [item.url] : [])).size,
  retrieval: 'browser_keyword_demo',
};

export const knowledgeQuestions = [
  '踩边 edging 和摩擦 smearing 有什么区别？',
  '旗式 flagging 是什么意思？',
  '抱石的 V 和 Font 等级能直接比较吗？',
  '第一次买攀岩鞋要看什么？',
  '在岩馆，等待位置与落地区域有什么要求？',
  '今天只有 30 分钟怎么办？',
];

const normalizeText = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchesTerm(text: string, rawTerm: string) {
  const term = normalizeText(rawTerm);
  if (!term) return false;
  if (/^[a-z0-9_ -]+$/.test(term)) return new RegExp(`(^|[^a-z0-9_])${escapePattern(term)}(?=$|[^a-z0-9_])`).test(text);
  return text.includes(term);
}

export function isKnowledgeMedicalQuestion(question: string) {
  let text = normalizeText(question);
  for (const phrase of retrievalRules.medical_negations) {
    const normalized = normalizeText(phrase);
    text = /^[a-z ]+$/.test(normalized)
      ? text.replace(new RegExp(`(^|[^a-z0-9_])${escapePattern(normalized)}(?=$|[^a-z0-9_])`, 'g'), '$1')
      : text.replaceAll(normalized, '');
  }
  text = text.replace(/(^|[，。；、\s])不疼(?=$|[，。；、\s])/g, '$1');
  return retrievalRules.medical_terms.some(term => matchesTerm(text, term));
}

export function searchKnowledge(question: string, limit = 3): Citation[] {
  const query = normalizeText(question);
  if (!query || limit <= 0) return [];
  if (retrievalRules.excluded_context_terms.some(term => matchesTerm(query, term))) return [];
  const genericTerms = new Set(retrievalRules.generic_terms.map(normalizeText));
  const aliasGroups = retrievalRules.alias_groups.map(group => group.map(normalizeText));
  const activeGroups = new Set(aliasGroups.flatMap((group, index) => group.some(term => !genericTerms.has(term) && matchesTerm(query, term)) ? [index] : []));
  const numericTime = /\d+\s*(分钟|minutes?\b|mins?\b)/.test(query);
  if (numericTime) aliasGroups.forEach((group, index) => { if (group.includes('时间预算')) activeGroups.add(index); });
  const context = retrievalRules.context_terms.some(term => matchesTerm(query, term)) || numericTime;
  const rows = records.map(item => {
    const concepts = new Map<string, number>();
    const generic = new Set<string>();
    const title = normalizeText(item.title);
    for (const rawKeyword of item.keywords) {
      const keyword = normalizeText(rawKeyword);
      if ([...keyword].length < 2) continue;
      const direct = matchesTerm(query, keyword);
      const group = aliasGroups.findIndex(terms => terms.includes(keyword));
      const alias = group >= 0 && activeGroups.has(group);
      if (!direct && !alias) continue;
      if (genericTerms.has(keyword)) { if (direct) generic.add(keyword); continue; }
      const concept = group >= 0 ? `alias:${group}` : `term:${keyword}`;
      const points = direct ? 3 + Math.min([...keyword].length, 12) / 12 + (matchesTerm(title, keyword) ? 2 : 0) : 1.5;
      // A bilingual synonym group contributes its strongest match only once.
      concepts.set(concept, Math.max(concepts.get(concept) || 0, points));
    }
    return { item, concepts, generic };
  });
  const allowGeneric = context || rows.some(row => row.concepts.size > 0);
  const candidates = rows.map(row => ({ item: row.item, score: [...row.concepts.values()].reduce((sum, points) => sum + points, 0) + (allowGeneric ? row.generic.size * .5 : 0) })).filter(candidate => candidate.score > 0);
  return candidates.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id)).slice(0, limit).map(({ item: { keywords: _keywords, tags: _tags, ...citation } }) => citation);
}
