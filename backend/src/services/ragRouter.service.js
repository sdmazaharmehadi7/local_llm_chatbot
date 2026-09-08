/**
 * RAG Router Service
 *
 * Lightweight, non-LLM decision layer that evaluates every user message
 * and determines whether document retrieval (RAG) is required or whether
 * the message should be answered directly by the general chat flow.
 *
 * Performance Rules:
 * - Zero LLM calls (no Qwen3 classification).
 * - Zero embedding calls (no nomic-embed-text for routing).
 * - Zero Qdrant queries for classification.
 * - Sub-millisecond synchronous execution per turn.
 */

// ── Pattern Definitions ──────────────────────────────────────────────────────

// Pure math expressions or calculations (e.g., "3 + 3", "what is 25 * 4")
const MATH_EXPRESSION_REGEX =
  /^(\s*\d+\s*[\+\-\*\/\^\%]\s*\d+[\d\s\+\-\*\/\^\%\=\(\)\.]*|\b(calculate|solve|what is)\s+\d+[\d\s\+\-\*\/\^\%\=\(\)\.]*)$/i;

// Conversational pleasantries, greetings, and assistant identity
const GREETING_OR_IDENTITY_REGEX =
  /^(hi|hello|hey|greetings|good\s*(morning|afternoon|evening|night)|howdy|sup|yo|what's up|who are you|what is your name|what can you do|how do you work|introduce yourself|tell me a joke|make me laugh|say something funny)[\s\.\!\?]*$/i;

// Common general programming questions that do not reference documents
const GENERAL_CODING_REGEX =
  /^(what is (python|react|javascript|typescript|c\+\+|java|rust|go|html|css|docker|kubernetes|node|sql|git|recursion|an api|oop|rest api|linux)|explain (recursion|polymorphism|inheritance|async await|promises|event loop|quicksort|binary search|merge sort|big o)|write a (java|python|javascript|c\+\+|c#|sql) (binary search|hello world|sorting|program|script|function|code))\b/i;

// General science, nature, astronomy, physics, geography, common knowledge keywords
const GENERAL_KNOWLEDGE_REGEX =
  /\b(sun\s*(rise|set|rising|setting)|sunrise|sunset|solar system|speed of light|boiling point|freezing point|periodic table|photosynthesis|gravity|planets?|continents?|oceans?|equator|hemisphere|latitude|longitude|dna|rna|mitochondria|evolution|relativity|thermodynamics|quantum|milky way|black hole|atmosphere|oxygen|water cycle|cardiac|nervous system|digestive system|blood group|vitamins?|friction|magnetism|sound waves?|light waves?|earthquake|volcano|tsunami|ecosystem)\b/i;

// General world questions, facts, trivia questions
const GENERAL_WORLD_QUESTIONS_REGEX =
  /^(in which direction|which direction|what direction|what is the (capital|currency|population|tallest|highest|largest|biggest|deepest|longest|fastest|hottest|coldest|distance|diameter|size|area|speed|formula|meaning of life))|(why is the (sky|grass|ocean|sea|sun|moon|earth))|(how many (continents|oceans|planets|countries|states|bones|teeth|days in|hours in|minutes in|seconds in|weeks in|months in))|(how far is (the )?(sun|moon|mars))|(who (was|is) (albert einstein|isaac newton|galileo|aristotle|plato|socrates|william shakespeare|shakespeare|napoleon|leonardo da vinci|mahatma gandhi|abraham lincoln|george washington|nelson mandela|steve jobs|bill gates|elon musk))|(who (discovered|invented|painted|wrote|composed) (electricity|gravity|telephone|light bulb|computer|penicillin|radio|airplane|mona lisa|hamlet|macbeth|symphony))\b/i;

// Creative writing, advice, jokes, everyday conversational requests
const GENERAL_CREATIVE_OR_CHAT_REGEX =
  /^(write (a|an|me|some) (poem|story|essay|joke|song|email|letter|haiku|dialogue|post)|tell me (a|some) (story|joke|riddle|fact|quote)|suggest (some|a|names?|ideas?|titles?)|how (do I|to) (make|cook|bake|brew|prepare|clean|fix|draw|play|learn))\b/i;

// Explicit document nouns and file references
const DOCUMENT_NOUNS_REGEX =
  /\b(pdf|documents?|docs?|files?|reports?|papers?|sheets?|resumes?|cvs?|attachments?)\b/i;

// Explicit document structural locations
const DOCUMENT_STRUCTURE_REGEX =
  /\b(pages?\s*\d+|sections?\s*(\d+|[a-z])|chapters?\s*\d+|tables?\s*\d+|paragraphs?\s*\d+|figures?\s*\d+|appendix(\s+[a-z0-9])?)\b/i;

// Document-oriented action verbs and intent markers
const DOCUMENT_INTENT_REGEX =
  /\b(summar(y|ize)|overview|outline|brief|review|gist|takeaways?|conclusions?|abstract|findings)\b/i;

// Phrases that explicitly reference an external text or source
const DOCUMENT_SOURCE_PHRASES_REGEX =
  /\b(according to|mentioned in|stated in|written in|based on the|per the|in the uploaded|in the attached|from the (file|doc|pdf|report)|what does (it|the (pdf|document|report|file)) say|does the (pdf|document|report|file) (have|contain|mention)|read (this|the) (pdf|document|file|report)|extract from|find in the)\b/i;

// Specific topic terms commonly asked about documents
const DOCUMENT_TOPIC_TERMS_REGEX =
  /\b(eligibility|requirements?|duration|criteria|guidelines?|findings|methodology|specifications?|author|stipend|salary|prerequisites?|work experience|education history|contact details|phone number|email address)\b/i;

// Knowledge Base organizational documentation and intent markers
const KB_INTENT_REGEX =
  /\b(knowledge\s*base|sop|sops|standard operating procedures?|manuals?|handbooks?|company polic(y|ies)|company guidelines?|company procedures?|safety guidelines?|safety manual|maintenance manual|inspection procedures?|inspection checklist|operations? manual|engineering manual|regulatory guidelines?|compliance guidelines?|specifications? sheet|company standard|organizational documents?|company documentation)\b/i;

const KB_SOURCE_PHRASES_REGEX =
  /\b(in the (knowledge\s*base|manual|handbook|sop|policy|guidelines|documentation|report|document)|according to the (company|safety|maintenance|inspection|operations?|engineering|manual|sop|handbook|policy|guidelines|documentation)|per the (company|safety|maintenance|sop|manual|policy|documentation)|stated in the (manual|sop|policy|guidelines|documentation)|what does (the|this) (manual|handbook|policy|sop|guide|document) say|what are the steps mentioned in the manual|from the (manual|handbook|policy|sop))\b/i;

// Expanded procedural, operational, and domain keywords for Knowledge Base RAG
const KB_PROCEDURAL_TERMS_REGEX =
  /\b(safety\s*procedures?|inspection(\s*(frequency|procedures?|checklist|steps?|requirements?|interval|guidelines?|findings|reports?|records?))?|maintenance(\s*(procedures?|schedule|interval|guide|steps?|requirements?|records?))?|confined\s*space(\s*entry)?|ppe\s*requirements?|ppe|precautions?|hazard(s|ous)?|compliance(\s*(requirements?|guidelines?|audit))?|standard\s*operating\s*procedures?|protocols?|regulations?|safety\s*measures?|safety\s*rules?|precautions\s*should\s*workers\s*follow|steps\s*mentioned|procedure\s*for|requirements\s*for|retain(ed|ing)?|retention(\s*period)?|certificates?|certification|test\s*certificates?|test\s*reports?|testing(\s*procedures?)?|calibrat(ion|e|ing|ed)|tolerances?|allowable\s*limits?|blowdown|set\s*pressure|operating\s*pressure|relief\s*valves?|pressure\s*relief|prv|valves?|quality\s*control|qc|qa|documentation\s*requirements?|roles\s*(and|&)\s*responsibilities|records?\s*retention|audit\s*trail|maintenance\s*history|stored|storage\s*period)\b/i;

// Common procedural and technical inquiry questions targeting documentation
const KB_PROCEDURAL_QUESTION_REGEX =
  /^(how long (must|should|is|are|do we|can|to)|how often (must|should|is|are|do we)|how many (years|months|days|hours|times)|what is the (retention|frequency|interval|duration|procedure|limit|standard|policy|requirement|specification|tolerance|blowdown|pressure|criteria|purpose|scope)|what are the (requirements|procedures|steps|precautions|roles|responsibilities|guidelines|standards|rules|limits|criteria|specifications|documents|records))\b/i;

// Explicit chat-scoped document markers
const CHAT_SPECIFIC_DOC_REGEX =
  /\b(uploaded (file|doc|document|pdf|resume)|my resume|my uploaded|in this chat|attached (file|doc|pdf)|this upload)\b/i;

// ── Document Name Normalization & Resolution Helpers ─────────────────────────

/**
 * Normalize a filename for resilient, deterministic matching.
 * Handles:
 * - case differences
 * - spaces, underscores, hyphens, dots
 * - stripping extensions (.pdf)
 * - collapsing repeated whitespace
 *
 * @param {string} str
 * @returns {string}
 */
export function normalizeDocName(str = "") {
  if (!str) return "";
  return str
    .replace(/\.[^/.]+$/, "") // Strip extension
    .toLowerCase()
    .replace(/[_\-.]+/g, " ") // Underscores, hyphens, dots to space
    .replace(/[^a-z0-9\s]/g, " ") // Non-alphanumerics to space
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
}

/**
 * Escape regular expression special characters.
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detect if the user explicitly references an indexed Knowledge Base document.
 *
 * Rules:
 * - Normalize names (case, underscores, spaces, hyphens, .pdf).
 * - Avoid false positive matches on words shorter than 3 characters or generic words.
 * - If multiple candidate documents match with no clear winner, DO NOT GUESS (avoid unsafe fuzzy matching).
 *
 * @param {string} message - Clean user message
 * @param {Array<object|string>} documents - Knowledge Base documents ([{ id, filename }] or [filename])
 * @returns {{
 *   documentId: string | null,
 *   filename: string | null,
 *   isAmbiguous: boolean
 * }}
 */
export function detectKnowledgeBaseDocument(message = "", documents = []) {
  if (!message || !Array.isArray(documents) || documents.length === 0) {
    return { documentId: null, filename: null, isAmbiguous: false };
  }

  const cleanMsg = message.trim();
  const lowerMsg = cleanMsg.toLowerCase();
  const normMsg = ` ${normalizeDocName(cleanMsg)} `;

  // Helper to extract base name without trailing version/date suffixes (e.g. "safety manual v1" -> "safety manual")
  const getCoreName = (name) => {
    return name
      .replace(/\s+(v\d+(\.\d+)*|ver\s*\d+|version\s*\d+|rev\s*[a-z0-9]+|part\s*\d+|\d{4})$/i, "")
      .trim();
  };

  // Normalize document entries
  const normalizedDocs = documents
    .map((doc) => {
      const id = typeof doc === "object" && doc ? doc.id || doc._id : null;
      const filename = typeof doc === "object" && doc ? doc.filename : String(doc);
      if (!filename) return null;
      const norm = normalizeDocName(filename);
      return {
        id: id ? String(id) : null,
        filename,
        cleanLowerFilename: filename.toLowerCase(),
        normalizedName: norm,
        coreName: getCoreName(norm),
      };
    })
    .filter(Boolean);

  const matchedCandidates = [];

  for (const doc of normalizedDocs) {
    const { cleanLowerFilename, normalizedName, coreName } = doc;
    if (!normalizedName || normalizedName.length < 3) continue;

    // 1. Exact raw filename mention (e.g. "Safety_Manual.pdf" or "safety_manual.pdf")
    if (lowerMsg.includes(cleanLowerFilename)) {
      matchedCandidates.push({ doc, score: 3, matchedTerm: cleanLowerFilename });
      continue;
    }

    // 2. Full normalized name mention on word boundaries
    // e.g. "safety manual v1" in "What does safety manual v1 say?"
    const wordBoundaryPattern = new RegExp(`(^|\\s)${escapeRegex(normalizedName)}(\\s|$)`, "i");
    if (wordBoundaryPattern.test(normMsg)) {
      matchedCandidates.push({ doc, score: 2, matchedTerm: normalizedName });
      continue;
    }

    // 3. Core name mention on word boundaries (e.g. "safety manual" matching "Safety_Manual_v1.pdf")
    if (coreName && coreName.length >= 4 && coreName !== normalizedName) {
      const corePattern = new RegExp(`(^|\\s)${escapeRegex(coreName)}(\\s|$)`, "i");
      if (corePattern.test(normMsg)) {
        matchedCandidates.push({ doc, score: 1.8, matchedTerm: coreName });
        continue;
      }
    }

    // 4. Substring match if sufficiently long and meaningful (>= 6 chars)
    if (normalizedName.length >= 6 && normMsg.includes(` ${normalizedName} `)) {
      matchedCandidates.push({ doc, score: 1, matchedTerm: normalizedName });
    }
  }

  if (matchedCandidates.length === 0) {
    return { documentId: null, filename: null, isAmbiguous: false };
  }

  // Sort candidates by match score descending, then length descending
  matchedCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.matchedTerm.length - a.matchedTerm.length;
  });

  const bestScore = matchedCandidates[0].score;
  const topMatches = matchedCandidates.filter((m) => m.score === bestScore);

  // If multiple different documents have identical match score (e.g. Safety_Manual_v1 vs Safety_Manual_v2
  // on a query "safety manual"), DO NOT guess an arbitrary document.
  if (topMatches.length > 1) {
    const distinctDocIds = new Set(topMatches.map((m) => m.doc.id || m.doc.filename));
    if (distinctDocIds.size > 1) {
      return { documentId: null, filename: null, isAmbiguous: true };
    }
  }

  const selected = topMatches[0].doc;
  return {
    documentId: selected.id,
    filename: selected.filename,
    isAmbiguous: false,
  };
}

// ── Main Router Implementation ──────────────────────────────────────────────

/**
 * Determine whether a message warrants Chat RAG, Knowledge Base RAG, or General Chat.
 *
 * Supported Routes:
 * - "GENERAL": Pure conversation, math, trivia, coding (bypasses nomic and Qdrant completely)
 * - "CHAT_DOCUMENT": Retrieves from chat-uploaded documents (scope = "chat", chatId)
 * - "KNOWLEDGE_BASE": Retrieves from Knowledge Base (scope = "knowledge_base", workspaceId)
 *
 * @param {object} params
 * @param {string} params.message - Current user query text
 * @param {Array<object>} [params.conversationHistory=[]] - Previous turns in this chat
 * @param {boolean} [params.hasChatDocuments=false] - Whether any documents exist in this chat
 * @param {Array<object>} [params.attachedFiles=[]] - Files attached to the current user message
 * @param {boolean} [params.hasKnowledgeBaseDocuments=false] - Whether any KB docs exist
 * @param {Array<object|string>} [params.knowledgeBaseDocuments=[]] - List of indexed KB docs ({ id, filename })
 * @param {Array<string>} [params.knowledgeBaseDocumentNames=[]] - (Backward compat) List of filenames
 * @returns {{
 *   route: "GENERAL" | "CHAT_DOCUMENT" | "KNOWLEDGE_BASE",
 *   useRag: boolean,
 *   reason: string,
 *   retrievalMode: "GLOBAL" | "DOCUMENT_SPECIFIC" | null,
 *   targetDocumentId: string | null,
 *   targetFilename: string | null
 * }}
 */
export function routeMessage({
  message = "",
  conversationHistory = [],
  hasChatDocuments = false,
  attachedFiles = [],
  hasKnowledgeBaseDocuments = false,
  knowledgeBaseDocuments = [],
  knowledgeBaseDocumentNames = [],
}) {
  const cleanMessage = (message || "").trim();

  // Combine document inputs
  const availableKbDocs =
    Array.isArray(knowledgeBaseDocuments) && knowledgeBaseDocuments.length > 0
      ? knowledgeBaseDocuments
      : (knowledgeBaseDocumentNames || []).map((name) => ({ id: null, filename: name }));

  // 1. Check if incoming message has newly attached indexable documents
  const hasIncomingDoc = (attachedFiles || []).some(
    (f) =>
      f?.category === "pdf" ||
      f?.category === "textLike" ||
      f?.mimeType === "application/pdf" ||
      (f?.filename && f.filename.toLowerCase().endsWith(".pdf"))
  );

  if (hasIncomingDoc) {
    return {
      route: "CHAT_DOCUMENT",
      useRag: true,
      reason: "attached_document",
      retrievalMode: null,
      targetDocumentId: null,
      targetFilename: null,
    };
  }

  // If message is empty (e.g. attachment only handled above)
  if (!cleanMessage) {
    return {
      route: "GENERAL",
      useRag: false,
      reason: "empty_message",
      retrievalMode: null,
      targetDocumentId: null,
      targetFilename: null,
    };
  }

  // 2. Explicit General Question Bypasses (Must bypass RAG even if documents exist)
  if (MATH_EXPRESSION_REGEX.test(cleanMessage)) {
    return {
      route: "GENERAL",
      useRag: false,
      reason: "general_math",
      retrievalMode: null,
      targetDocumentId: null,
      targetFilename: null,
    };
  }

  if (GREETING_OR_IDENTITY_REGEX.test(cleanMessage)) {
    return {
      route: "GENERAL",
      useRag: false,
      reason: "general_greeting",
      retrievalMode: null,
      targetDocumentId: null,
      targetFilename: null,
    };
  }

  // Extract keywords from indexed KB document names (>= 3 chars, e.g. "prv", "valve", "sop")
  const kbDocumentKeywords = new Set();
  const STOP_WORDS = new Set(["the", "and", "for", "doc", "docs", "pdf", "file", "files", "new", "old"]);
  for (const doc of availableKbDocs) {
    const norm = normalizeDocName(doc.filename);
    for (const word of norm.split(" ")) {
      if (word.length >= 3 && !STOP_WORDS.has(word)) {
        kbDocumentKeywords.add(word);
      }
    }
  }

  const normMsg = ` ${normalizeDocName(cleanMessage)} `;
  const matchesDocKeyword = Array.from(kbDocumentKeywords).some((kw) => {
    const kwPattern = new RegExp(`(^|\\s)${escapeRegex(kw)}(\\s|$)`, "i");
    return kwPattern.test(normMsg);
  });

  const hasDocNoun = DOCUMENT_NOUNS_REGEX.test(cleanMessage);
  const hasKbNoun =
    KB_INTENT_REGEX.test(cleanMessage) ||
    KB_SOURCE_PHRASES_REGEX.test(cleanMessage) ||
    KB_PROCEDURAL_TERMS_REGEX.test(cleanMessage) ||
    KB_PROCEDURAL_QUESTION_REGEX.test(cleanMessage) ||
    matchesDocKeyword;

  if (GENERAL_KNOWLEDGE_REGEX.test(cleanMessage) && !hasDocNoun && !hasKbNoun) {
    return {
      route: "GENERAL",
      useRag: false,
      reason: "general_knowledge",
      retrievalMode: null,
      targetDocumentId: null,
      targetFilename: null,
    };
  }

  if (GENERAL_WORLD_QUESTIONS_REGEX.test(cleanMessage) && !hasDocNoun && !hasKbNoun) {
    return {
      route: "GENERAL",
      useRag: false,
      reason: "general_trivia",
      retrievalMode: null,
      targetDocumentId: null,
      targetFilename: null,
    };
  }

  if (GENERAL_CODING_REGEX.test(cleanMessage) && !hasDocNoun && !hasKbNoun) {
    return {
      route: "GENERAL",
      useRag: false,
      reason: "general_coding",
      retrievalMode: null,
      targetDocumentId: null,
      targetFilename: null,
    };
  }

  if (GENERAL_CREATIVE_OR_CHAT_REGEX.test(cleanMessage) && !hasDocNoun && !hasKbNoun) {
    return {
      route: "GENERAL",
      useRag: false,
      reason: "general_creative",
      retrievalMode: null,
      targetDocumentId: null,
      targetFilename: null,
    };
  }

  // 3. Document-Specific Reference Detection for Knowledge Base
  let detectedKbDoc = { documentId: null, filename: null, isAmbiguous: false };
  if (hasKnowledgeBaseDocuments && availableKbDocs.length > 0) {
    detectedKbDoc = detectKnowledgeBaseDocument(cleanMessage, availableKbDocs);
  }

  const explicitlyChatDoc = CHAT_SPECIFIC_DOC_REGEX.test(cleanMessage);

  // 4. Knowledge Base Intent Matching (When KB documents exist)
  if (hasKnowledgeBaseDocuments) {
    const hasKbIntent =
      detectedKbDoc.filename !== null ||
      KB_INTENT_REGEX.test(cleanMessage) ||
      KB_SOURCE_PHRASES_REGEX.test(cleanMessage) ||
      KB_PROCEDURAL_TERMS_REGEX.test(cleanMessage) ||
      KB_PROCEDURAL_QUESTION_REGEX.test(cleanMessage) ||
      matchesDocKeyword;

    if (hasKbIntent && (!explicitlyChatDoc || !hasChatDocuments)) {
      let finalDocId = detectedKbDoc.documentId;
      let finalDocFilename = detectedKbDoc.filename;
      let reason = detectedKbDoc.documentId
        ? "kb_document_specific_mention"
        : "kb_procedural_or_intent_match";

      // If no explicit document mentioned in this turn, check conversational continuity (Part 13)
      if (!finalDocId && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
        const recentMessages = conversationHistory.slice(-4);
        const lastAssistantMsg = [...recentMessages].reverse().find((m) => m.role === "assistant");
        const prevSources = lastAssistantMsg?.metadata?.ragSources || [];
        const uniquePrevDocIds = Array.from(
          new Set(prevSources.map((s) => s.documentId).filter(Boolean))
        );

        if (uniquePrevDocIds.length === 1) {
          finalDocId = uniquePrevDocIds[0];
          finalDocFilename = prevSources[0]?.filename || null;
          reason = "kb_conversational_followup";
        }
      }

      const retrievalMode = finalDocId ? "DOCUMENT_SPECIFIC" : "GLOBAL";
      return {
        route: "KNOWLEDGE_BASE",
        useRag: true,
        reason,
        retrievalMode,
        targetDocumentId: finalDocId,
        targetFilename: finalDocFilename,
      };
    }
  }

  // 5. Chat Document Signals (if chat has documents)
  if (hasChatDocuments) {
    const hasDocStructure = DOCUMENT_STRUCTURE_REGEX.test(cleanMessage);
    const hasDocIntent = DOCUMENT_INTENT_REGEX.test(cleanMessage);
    const hasDocSourcePhrase = DOCUMENT_SOURCE_PHRASES_REGEX.test(cleanMessage);
    const hasDocTopic = DOCUMENT_TOPIC_TERMS_REGEX.test(cleanMessage);

    if (hasDocNoun || hasDocStructure || hasDocIntent || hasDocSourcePhrase || hasDocTopic) {
      return {
        route: "CHAT_DOCUMENT",
        useRag: true,
        reason: "chat_document_question",
        retrievalMode: null,
        targetDocumentId: null,
        targetFilename: null,
      };
    }

    // Conversational Document Continuity for Chat-scoped Docs
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      const recentMessages = conversationHistory.slice(-4);
      const lastAssistantMsg = [...recentMessages].reverse().find((m) => m.role === "assistant");
      const lastAssistantHadDocSources = Boolean(
        lastAssistantMsg?.metadata?.ragSources?.length > 0 ||
        lastAssistantMsg?.parts?.some((p) => (p.type === "source" && p.isDocument) || p.type === "source-document") ||
        (lastAssistantMsg?.content && /Sources:\s*.*—\s*Page/i.test(lastAssistantMsg.content))
      );

      const lastUserMsg = [...recentMessages].reverse().find((m) => m.role === "user");
      const lastUserWasDocQuery = Boolean(
        lastUserMsg?.content && (
          DOCUMENT_NOUNS_REGEX.test(lastUserMsg.content) ||
          DOCUMENT_INTENT_REGEX.test(lastUserMsg.content) ||
          DOCUMENT_TOPIC_TERMS_REGEX.test(lastUserMsg.content)
        )
      );

      if (lastAssistantHadDocSources || lastUserWasDocQuery) {
        const hasDocPronounReference =
          /\b(does it|what does it|is it mentioned|in it|from it|in this|from this|in that|from that|according to it)\b/i.test(
            cleanMessage
          );
        const isExplicitContinuation =
          /^(what else does it (say|mention|state)|tell me more about (it|this|that|the document|the project|his|her|their)|can you elaborate on (it|this|that|section|page)|any other (details|findings|requirements))\b/i.test(
            cleanMessage
          );

        if (hasDocPronounReference || hasDocTopic || isExplicitContinuation) {
          return {
            route: "CHAT_DOCUMENT",
            useRag: true,
            reason: "chat_conversational_followup",
            retrievalMode: null,
            targetDocumentId: null,
            targetFilename: null,
          };
        }
      }
    }
  }

  // 6. Conversational Follow-up Continuity for Knowledge Base (Multi-Turn)
  if (hasKnowledgeBaseDocuments && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    const recentMessages = conversationHistory.slice(-4);
    const lastAssistantMsg = [...recentMessages].reverse().find((m) => m.role === "assistant");
    const lastUserMsg = [...recentMessages].reverse().find((m) => m.role === "user");

    // Check if the previous assistant turn had Knowledge Base sources
    const prevSources = lastAssistantMsg?.metadata?.ragSources || [];
    const prevDocId = prevSources[0]?.documentId || null;
    const prevFilename = prevSources[0]?.filename || null;

    const isPrevKbConversation =
      prevSources.length > 0 ||
      (lastUserMsg?.content &&
        (KB_INTENT_REGEX.test(lastUserMsg.content) ||
          KB_PROCEDURAL_TERMS_REGEX.test(lastUserMsg.content) ||
          availableKbDocs.some((d) =>
            lastUserMsg.content.toLowerCase().includes(d.filename.toLowerCase())
          )));

    if (isPrevKbConversation) {
      const isFollowupPhrase =
        /^(what about|how about|and for|how often|what is the (inspection\s*frequency|interval|procedure|requirement|rule|step)|what are the|is there any|does it (say|mention|state|have)|what else|tell me more|elaborate on|any other)\b/i.test(
          cleanMessage
        ) ||
        /\b(inspection\s*frequency|maintenance\s*interval|inspection\s*steps?|precautions?)\b/i.test(cleanMessage);

      if (isFollowupPhrase) {
        // If the previous turn specifically focused on a single document, preserve it
        const uniquePrevDocIds = new Set(prevSources.map((s) => s.documentId).filter(Boolean));
        const preserveDocId = uniquePrevDocIds.size === 1 ? Array.from(uniquePrevDocIds)[0] : prevDocId;
        const preserveFilename = uniquePrevDocIds.size === 1 ? prevSources[0]?.filename : prevFilename;

        return {
          route: "KNOWLEDGE_BASE",
          useRag: true,
          reason: "kb_conversational_followup",
          retrievalMode: preserveDocId ? "DOCUMENT_SPECIFIC" : "GLOBAL",
          targetDocumentId: preserveDocId || null,
          targetFilename: preserveFilename || null,
        };
      }
    }
  }

  // 7. If no chat documents, but Knowledge Base exists and query asks for document topics/summary
  if (!hasChatDocuments && hasKnowledgeBaseDocuments) {
    const hasDocIntent = DOCUMENT_INTENT_REGEX.test(cleanMessage);
    const hasDocSourcePhrase = DOCUMENT_SOURCE_PHRASES_REGEX.test(cleanMessage);
    const hasDocTopic = DOCUMENT_TOPIC_TERMS_REGEX.test(cleanMessage);

    if (
      hasDocIntent ||
      hasDocSourcePhrase ||
      hasDocTopic ||
      hasDocNoun ||
      hasKbNoun ||
      matchesDocKeyword
    ) {
      return {
        route: "KNOWLEDGE_BASE",
        useRag: true,
        reason: "knowledge_base_topic",
        retrievalMode: "GLOBAL",
        targetDocumentId: null,
        targetFilename: null,
      };
    }
  }

  // 8. Default to general path
  return {
    route: "GENERAL",
    useRag: false,
    reason: "general_question",
    retrievalMode: null,
    targetDocumentId: null,
    targetFilename: null,
  };
}

export default {
  routeMessage,
  normalizeDocName,
  detectKnowledgeBaseDocument,
};
