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

// ── Main Router Implementation ──────────────────────────────────────────────

/**
 * Determine whether a message warrants Chat-Scoped RAG retrieval.
 *
 * @param {object} params
 * @param {string} params.message - Current user query text
 * @param {Array<object>} [params.conversationHistory=[]] - Previous turns in this chat
 * @param {boolean} [params.hasChatDocuments=false] - Whether any documents exist in this chat
 * @param {Array<object>} [params.attachedFiles=[]] - Files attached to the current user message
 * @returns {{useRag: boolean, reason: string}}
 */
export function routeMessage({
  message = "",
  conversationHistory = [],
  hasChatDocuments = false,
  attachedFiles = [],
}) {
  const cleanMessage = (message || "").trim();

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
      useRag: true,
      reason: "attached_document",
    };
  }

  // 2. If no documents exist in the chat at all, RAG is completely unavailable
  if (!hasChatDocuments) {
    return {
      useRag: false,
      reason: "no_documents",
    };
  }

  // If message is empty (e.g. attachment only handled above)
  if (!cleanMessage) {
    return {
      useRag: false,
      reason: "empty_message",
    };
  }

  // 3. Explicit General Question Bypasses (Must bypass RAG even if document exists in chat)
  if (MATH_EXPRESSION_REGEX.test(cleanMessage)) {
    return {
      useRag: false,
      reason: "general_math",
    };
  }

  if (GREETING_OR_IDENTITY_REGEX.test(cleanMessage)) {
    return {
      useRag: false,
      reason: "general_greeting",
    };
  }

  const hasDocNoun = DOCUMENT_NOUNS_REGEX.test(cleanMessage);

  if (GENERAL_KNOWLEDGE_REGEX.test(cleanMessage) && !hasDocNoun) {
    return {
      useRag: false,
      reason: "general_knowledge",
    };
  }

  if (GENERAL_WORLD_QUESTIONS_REGEX.test(cleanMessage) && !hasDocNoun) {
    return {
      useRag: false,
      reason: "general_trivia",
    };
  }

  if (GENERAL_CODING_REGEX.test(cleanMessage) && !hasDocNoun) {
    return {
      useRag: false,
      reason: "general_coding",
    };
  }

  if (GENERAL_CREATIVE_OR_CHAT_REGEX.test(cleanMessage) && !hasDocNoun) {
    return {
      useRag: false,
      reason: "general_creative",
    };
  }

  // 4. Explicit Document Signals in the current message
  const hasDocStructure = DOCUMENT_STRUCTURE_REGEX.test(cleanMessage);
  const hasDocIntent = DOCUMENT_INTENT_REGEX.test(cleanMessage);
  const hasDocSourcePhrase = DOCUMENT_SOURCE_PHRASES_REGEX.test(cleanMessage);
  const hasDocTopic = DOCUMENT_TOPIC_TERMS_REGEX.test(cleanMessage);

  if (hasDocNoun || hasDocStructure || hasDocIntent || hasDocSourcePhrase || hasDocTopic) {
    return {
      useRag: true,
      reason: "document_question",
    };
  }

  // 5. Conversational Document Context (Multi-Turn Continuity)
  // Check if previous conversation turns establish that an uploaded document is being discussed
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    const recentMessages = conversationHistory.slice(-4);

    // Check if the previous assistant message cited document sources or discussed a document
    const lastAssistantMsg = [...recentMessages].reverse().find((m) => m.role === "assistant");
    const lastAssistantHadDocSources = Boolean(
      lastAssistantMsg?.metadata?.ragSources?.length > 0 ||
      lastAssistantMsg?.parts?.some((p) => (p.type === "source" && p.isDocument) || p.type === "source-document") ||
      (lastAssistantMsg?.content && /Sources:\s*.*—\s*Page/i.test(lastAssistantMsg.content))
    );

    // Check if previous user message was a document question
    const lastUserMsg = [...recentMessages].reverse().find((m) => m.role === "user");
    const lastUserWasDocQuery = Boolean(
      lastUserMsg?.content && (
        DOCUMENT_NOUNS_REGEX.test(lastUserMsg.content) ||
        DOCUMENT_INTENT_REGEX.test(lastUserMsg.content) ||
        DOCUMENT_TOPIC_TERMS_REGEX.test(lastUserMsg.content)
      )
    );

    const isDocumentThread = lastAssistantHadDocSources || lastUserWasDocQuery;

    if (isDocumentThread) {
      // General inquiries must NOT be captured as document follow-ups
      const isGeneralIntent =
        GENERAL_KNOWLEDGE_REGEX.test(cleanMessage) ||
        GENERAL_WORLD_QUESTIONS_REGEX.test(cleanMessage) ||
        GENERAL_CODING_REGEX.test(cleanMessage) ||
        GENERAL_CREATIVE_OR_CHAT_REGEX.test(cleanMessage) ||
        MATH_EXPRESSION_REGEX.test(cleanMessage) ||
        GREETING_OR_IDENTITY_REGEX.test(cleanMessage);

      if (!isGeneralIntent) {
        // Document follow-up must explicitly refer to the document or its topic
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
            useRag: true,
            reason: "conversational_followup",
          };
        }
      }
    }
  }

  // 6. Default to general path
  return {
    useRag: false,
    reason: "general_question",
  };
}

export default {
  routeMessage,
};
