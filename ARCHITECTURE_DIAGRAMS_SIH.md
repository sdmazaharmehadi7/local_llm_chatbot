# SIH 2026 — Sovereign On-Premise Agentic AI Workbench
## Technical Architecture & Multi-Agent Execution Flow Diagrams

> **Confidential Industrial AI System**  
> **Problem Statement ID:** 26117  
> **Operational Guarantee:** 100% Air-Gapped / On-Premise Execution — **NO CLOUD LLM / ZERO EXTERNAL API CALLS**

---

# DIAGRAM 1 — HIGH-LEVEL SYSTEM ARCHITECTURE

```text
========================================================================================================================
                          SOVEREIGN ON-PREMISE AGENTIC AI WORKBENCH — SYSTEM ARCHITECTURE
========================================================================================================================

 [LAYER 1: USER LAYER]
    Industrial Engineers │ Plant Operators │ Safety Inspectors │ Data Analysts
    (Concurrent Multi-User Requests: User A, User B, User C with Strict Tenant Context Isolation)
                                                │
                                                ▼  HTTPS / WSS (Air-Gapped Intranet)
 ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ [LAYER 2: FRONTEND LAYER — React + Vite + Tailwind CSS]                                                             │
 │                                                                                                                     │
 │  ┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐  ┌──────────────────┐  │
 │  │      Chat Interface       │  │  Model & Mode Selection   │  │   File & Media Ingestion  │  │ Agent Telemetry  │  │
 │  │  • Interactive turn chat  │  │  • Single model or /agent │  │  • Technical PDFs / DOCX  │  │ • Step-by-step   │  │
 │  │  • Markdown & code syntax │  │  • Context token indicator│  │  • Industrial schematics  │  │   trace badges   │  │
 │  │  • Real-time SSE listener │  │  • Temperature / params   │  │  • Dial / gauge images    │  │ • Tool cards     │  │
 │  └───────────────────────────┘  └───────────────────────────┘  └───────────────────────────┘  └──────────────────┘  │
 └──────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┘
                                                            │ REST Endpoints & Server-Sent Events (SSE)
                                                            ▼ (JSON Payloads / Multipart Form-Data / SSE Streams)
 ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ [LAYER 3: BACKEND & API GATEWAY LAYER — Node.js / Express]                                                          │
 │                                                                                                                     │
 │  ┌─────────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐   ┌───────────────────┐  │
 │  │  Auth & Access Control  │   │   API Routing Engine     │   │ Chat & Session Service   │   │ Stream Controller │  │
 │  │  • Local JWT / Sessions │   │   • /api/chat            │   │  • Session lifecycle     │   │ • Real-time SSE   │  │
 │  │  • Role-Based Access    │   │   • /api/agent           │   │  • Multi-turn history    │   │   pipeline        │  │
 │  │  • Workspace boundaries │   │   • /api/kb  /api/files  │   │  • Context windowing     │   │ • Heartbeats      │  │
 │  └─────────────────────────┘   └──────────────────────────┘   └──────────────────────────┘   └───────────────────┘  │
 └──────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┘
                                                            │ Dispatches Agent Turn with Isolated Context
                                                            ▼
 ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ [LAYER 4: AGENT ORCHESTRATION LAYER — LangGraph StateGraph Engine]                                                  │
 │                                                                                                                     │
 │  ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐  │
 │  │ LangGraph State Schema (Annotation.Root):                                                                    │  │
 │  │ • taskId  • userId  • chatId  • userRequest  • steps[]  • retrievedFacts[]  • workflow{}  • status           │  │
 │  └───────────────────────────────────────────────────────┬──────────────────────────────────────────────────────┘  │
 │                                                          │                                                          │
 │  ┌────────────────────────────────────────┐              │              ┌────────────────────────────────────────┐  │
 │  │        LangGraph Reasoner Node         │◄─────────────┴─────────────►│          LangGraph Tools Node          │  │
 │  │  • Supervisor Brain (Qwen3:8b)         │                             │  • Executes selected Specialist Tool   │  │
 │  │  • Intent analysis & decomposition     │     Conditional Edges       │  • Formats structured observation      │  │
 │  │  • Minimum-tool enforcement policy     │    (tools <--> reasoner)    │  • Appends to state.steps & facts      │  │
 │  │  • Bounded cycle control (max 10 steps)│                             │  • Emits lifecycle progress telemetry  │  │
 │  └────────────────────────────────────────┘                             └────────────────────────────────────────┘  │
 └──────────────────────────────┬───────────────────────────────────────────────────────────┬──────────────────────────┘
                                │ Logical Tool Invocation                                   │ Isolated State Saves
                                ▼                                                           ▼
 ┌──────────────────────────────────────────────────────────────────────┐     ┌────────────────────────────────────────┐
 │ SPECIALIST CAPABILITY CLUSTER (Separation of Concerns)               │     │ [LAYER 9: PERSISTENCE LAYER]           │
 │                                                                      │     │                                        │
 │  ┌────────────────────────────────────────────────────────────────┐  │     │  ┌──────────────────────────────────┐  │
 │  │ [LAYER 5: SPECIALIST AGENTS (Cognitive / LLM-Powered)]         │  │     │  │ Local MongoDB Database           │  │
 │  │                                                                │  │     │  │                                  │  │
 │  │  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────┐ │  │     │  │  • Users & RBAC credentials      │  │
 │  │  │   Vision Agent    │ │   Coding Agent    │ │Research Agent │ │  │     │  │  • Chat sessions & messages      │  │
 │  │  │ (Diagrams, Gauges,│ │  (Code synthesis, │ │ (Document QA, │ │  │     │  │  • Knowledge base metadata       │  │
 │  │  │  OCR, Inspection) │ │  repairs, audits) │ │  evidence ext)│ │  │     │  │  • Agent run steps & audit logs  │  │
 │  │  └─────────┬─────────┘ └─────────┬─────────┘ └───────┬───────┘ │  │     │  │  (Tenant isolated by userId)     │  │
 │  └────────────┼─────────────────────┼───────────────────┼─────────┘  │     │  └──────────────────────────────────┘  │
 │               │                     │                   │            │     │                                        │
 │  ┌────────────┼─────────────────────┼───────────────────┼─────────┐  │     │  ┌──────────────────────────────────┐  │
 │  │ [LAYER 6: DETERMINISTIC TOOLS (Zero LLM Overhead)]   │         │  │     │  │ [LAYER 7: RETRIEVAL / RAG]       │  │
 │  │            │                     │                   │         │  │     │  │ Local Qdrant Vector Database     │  │
 │  │  ┌─────────┴─────────┐ ┌─────────┴─────────┐         │         │  │     │  │                                  │  │
 │  │  │  Safe Calculator  │ │ Container Sandbox │         │         │  │     │  │  • Multi-tenant collection store │  │
 │  │  │ • Recursive AST   │ │ • Docker Alpine   │         │         │  │     │  │  • 768-dim dense embeddings      │  │
 │  │  │   math tokenizer  │ │ • Isolated tmpfs  │         │         │  │     │  │  • Cosine similarity search      │  │
 │  │  │ • NO eval()       │ │ • Network: NONE   │         │         │  │     │  │  • Payload metadata filter       │  │
 │  │  │ • Zero model cost │ │ • Zero host risk  │         │         │  │     │  │    (userId + chatId isolation)   │  │
 │  │  └───────────────────┘ └───────────────────┘         │         │  │     │  └──────────────────▲───────────────┘  │
 │  └──────────────────────────────────────────────────────┼─────────┘  │     └─────────────────────┼──────────────────┘
 └─────────────────────────────────────────────────────────┼────────────────────────────────────────┼───────────────────
                                                           │                                        │
                                                           │ (Vectors / Embeddings)                 │
                                                           ▼                                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ [LAYER 8: LOCAL MODEL RUNTIME & GOVERNANCE — Ollama Instance (http://localhost:11434)]                              │
 │                                                                                                                     │
 │  ┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐  │
 │  │ SINGLE-MODEL RESOURCE LOCK & RESIDENCY CONTROLLER (modelLock.service.js)                                      │  │
 │  │                                                                                                               │  │
 │  │  [FIFO Request Queue] ──► [Lock Guard: MAX ACTIVE LLM = 1] ──► [Residency Policy: Unload ONLY on Switch]      │  │
 │  │                                                                                                               │  │
 │  │  • Zero-Concurrency Invariant: Prevents GPU/VRAM thrashing and Out-Of-Memory (OOM) faults                     │  │
 │  │  • Smart Residency Cache: Reuses warm loaded model weights across continuous turns without reload overhead    │  │
 │  └───────────────────────────────────────────────────────┬───────────────────────────────────────────────────────┘  │
 │                                                          │ Controlled Sequential Invocation (1 Model at a time)     │
 │                                                          ▼                                                          │
 │  ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────────────┐  │
 │  │   Central Brain      │   │   Visual Specialist  │   │  Coding Specialist   │   │       Embedding Engine       │  │
 │  │      Qwen3:8b        │   │    Qwen2.5-VL:7b     │   │   Qwen2.5-Coder:7b   │   │       nomic-embed-text       │  │
 │  │                      │   │                      │   │                      │   │                              │  │
 │  │ • Orchestration      │   │ • Multimodal OCR     │   │ • Code generation    │   │ • 768-dim vector embeddings  │  │
 │  │ • Intent recognition │   │ • Diagram inspection │   │ • Bounded repairs    │   │ • High-throughput batching   │  │
 │  │ • Evidence synthesis │   │ • Meter reading      │   │ • Script analysis    │   │ • Local RAG ingestion        │  │
 │  └──────────────────────┘   └──────────────────────┘   └──────────────────────┘   └──────────────────────────────┘  │
 │                                                                                                                     │
 │  =================================================================================================================  │
 │  ★ SOVEREIGNTY GUARANTEE: 100% AIR-GAPPED ON-PREMISE | STRICTLY ZERO EXTERNAL / CLOUD API TRANSMISSION             │
 │  =================================================================================================================  │
 └─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

# DIAGRAM 2 — LOW-LEVEL MULTI-AGENT EXECUTION FLOW

```text
========================================================================================================================
             LOW-LEVEL CONDITIONAL MULTI-AGENT EXECUTION FLOW (WITH MODEL LOCK & RESIDENCY LIFECYCLE)
========================================================================================================================

                                            USER INPUT
                                                 │
                                                 │ User submits query / task (with optional image or document)
                                                 ▼
                                     ┌───────────────────────┐
                                     │  React Vite Frontend  │
                                     └───────────┬───────────┘
                                                 │ POST /api/agent
                                                 ▼
                                     ┌───────────────────────┐
                                     │ Express Backend Entry │
                                     └───────────┬───────────┘
                                                 │ Initializes AgentStateAnnotation
                                                 │ (userId, chatId, steps: [], retrievedFacts: [])
                                                 ▼
                                     ┌───────────────────────┐
                                     │ LangGraph StateGraph  │
                                     │     Initialization    │
                                     └───────────┬───────────┘
                                                 │
                                                 ▼
               ═════════════════════════════════════════════════════════════════
                 CONCURRENCY & MODEL LOCK PHASE (One Active Model Invariant)
               ═════════════════════════════════════════════════════════════════
                                                 │
                                                 ▼
                                     ┌───────────────────────┐
                                     │  ModelLockService     │
                                     │   FIFO Wait Queue     │◄── Other incoming requests (User B, User C) wait
                                     └───────────┬───────────┘
                                                 │
                                                 ▼
                                     ┌───────────────────────┐
                                     │  Acquire Model Lock   │
                                     │  [MAX ACTIVE LLM = 1] │
                                     └───────────┬───────────┘
                                                 │
                                                 ▼
                                  ┌─────────────────────────────┐
                                  │ Is Qwen3:8b Resident in GPU?│
                                  └──────────────┬──────────────┘
                                                 │
                                 YES ────────────┴──────────── NO
                                  │                             │
                                  ▼                             ▼
                      ┌──────────────────────┐      ┌─────────────────────────┐
                      │ Reuse Resident Model │      │ Unload Previous Model   │
                      │ (0ms reload latency) │      │ Load Qwen3:8b into VRAM │
                      └──────────┬───────────┘      └───────────┬─────────────┘
                                 │                              │
                                 └──────────────┬───────────────┘
                                                │
                                                ▼
                                  ┌─────────────────────────────┐
                                  │   Supervisor (Qwen3:8b)     │
                                  │  • Analyzes User Request    │
                                  │  • Reviews State & History  │
                                  │  • Enforces Min-Tool Policy │
                                  └─────────────┬───────────────┘
                                                │
                                                │ Releases Model Lock
                                                ▼
                                  ┌─────────────────────────────┐
                                  │   Supervisor Decision:      │
                                  │ Capability Selection Branch │
                                  └─────────────┬───────────────┘
                                                │
         ┌─────────────────────┬────────────────┴────────────────────┬───────────────────────┐
         │                     │                                     │                       │
         ▼                     ▼                                     ▼                       ▼
   [CALCULATION]        [VISUAL REASONING]                     [KNOWLEDGE RETRIEVAL]     [CODING / REPAIR]
         │                     │                                     │                       │
         │                     ▼                                     ▼                       ▼
         │             ┌────────────────┐                    ┌────────────────┐      ┌────────────────┐
         │             │Acquire Lock:   │                    │Zero LLM Lock:  │      │Acquire Lock:   │
         │             │Qwen2.5-VL:7b   │                    │nomic-embed-text│      │Qwen2.5-Coder:7b│
         │             └───────┬────────┘                    └───────┬────────┘      └───────┬────────┘
         │                     │                                     │                       │
         │                     ▼                                     ▼                       ▼
         │             ┌────────────────┐                    ┌────────────────┐      ┌────────────────┐
         │             │Model Switch:   │                    │Embed Query &   │      │Model Switch:   │
         │             │Unload Qwen3    │                    │Search Qdrant DB│      │Unload Qwen3    │
         │             │Load Qwen2.5-VL │                    │(User Isolated) │      │Load Qwen-Coder │
         │             └───────┬────────┘                    └───────┬────────┘      └───────┬────────┘
         │                     │                                     │                       │
         │                     ▼                                     ▼                       ▼
         │             ┌────────────────┐                    ┌────────────────┐      ┌────────────────┐
         │             │Vision Agent    │                    │Research Agent  │      │Coding Agent    │
         │             │Extracts metrics│                    │Extracts facts  │      │Generates script│
         │             │reads schematics│                    │& citations     │      │or patch        │
         │             └───────┬────────┘                    └───────┬────────┘      └───────┬────────┘
         │                     │                                     │                       │
         │                     ▼                                     │                       ▼
         │             ┌────────────────┐                            │               ┌────────────────┐
         │             │Release Lock    │                            │               │Release Lock    │
         │             │(Keep resident  │                            │               │(Coder resident │
         │             │until switch)   │                            │               │until switch)   │
         │             └───────┬────────┘                            │               └───────┬────────┘
         │                     │                                     │                       │
         │                     │ (If visual gauge                    │                       ▼
         │                     │  requires math)                     │               ┌────────────────┐
         │                     ▼                                     │               │Docker Sandbox  │
         │             ┌────────────────┐                            │               │Deterministic   │
         │             │Calculator Tool │                            │               │Safe Execution  │
         │             │(Deterministic) │                            │               │(Network: NONE) │
         │             └───────┬────────┘                            │               └───────┬────────┘
         │                     │                                     │                       │
         ▼                     │                                     │                       │
   ┌───────────────┐           │                                     │                       │
   │Safe Calculator│           │                                     │                       │
   │AST Tokenizer  │           │                                     │                       │
   │(Zero LLM Lock)│           │                                     │                       │
   └───────┬───────┘           │                                     │                       │
           │                   │                                     │                       │
           └───────────────────┴──────────────────┬──────────────────┴───────────────────────┘
                                                  │
                                                  ▼
                                     ┌─────────────────────────┐
                                     │ LangGraph Tools Node    │
                                     │ • Formats Observations  │
                                     │ • Appends to state.steps│
                                     │ • Appends retrievedFacts│
                                     └────────────┬────────────┘
                                                  │
                                                  ▼
                                     ┌─────────────────────────┐
                                     │ Re-Acquire Model Lock:  │
                                     │ Supervisor (Qwen3:8b)   │
                                     └────────────┬────────────┘
                                                  │
                                                  ▼
                                     ┌─────────────────────────┐
                                     │ Supervisor Reviews State│
                                     │ & Evidence Observations │
                                     └────────────┬────────────┘
                                                  │
                                                  ▼
                                     ┌─────────────────────────┐
                                     │ Is Task Complete or     │
                                     │ Additional Step Needed? │
                                     └────────────┬────────────┘
                                                  │
                                  ┌───────────────┴───────────────┐
                                  │                               │
                      [MORE OPERATIONS NEEDED]            [TASK COMPLETED]
                                  │                               │
                                  ▼                               ▼
                      ┌──────────────────────┐        ┌───────────────────────┐
                      │ Loop back to Next    │        │ Synthesize Final      │
                      │ Specialist / Tool    │        │ Comprehensive Answer  │
                      │ (Sequential execution│        │ With Source Citations │
                      │  Max 10 steps safe)  │        └───────────┬───────────┘
                      └──────────────────────┘                    │
                                                                  ▼
                                                      ┌───────────────────────┐
                                                      │ Release Model Lock    │
                                                      │ (Qwen3 stays resident)│
                                                      └───────────┬───────────┘
                                                                  │
                                                                  ▼
                                                      ┌───────────────────────┐
                                                      │ Stream Output SSE     │
                                                      │ & Commit to MongoDB   │
                                                      └───────────┬───────────┘
                                                                  │
                                                                  ▼
                                                      ┌───────────────────────┐
                                                      │  React UI Displays    │
                                                      │  Complete Solution    │
                                                      └───────────┬───────────┘
                                                                  │
                                                                  ▼
                                                                USER
```

---

# COMPONENT & LIFECYCLE REFERENCE TABLE

| Component | Technology | Role & Responsibility | Model Lock Invariant | Residency Policy |
| :--- | :--- | :--- | :--- | :--- |
| **Supervisor** | `Qwen3:8b` via Ollama | Central task decomposition, tool routing, evidence review, final synthesis | **Requires Lock** (`Max Active = 1`) | Kept resident by default; unloaded only when specialist LLM called |
| **Vision Agent** | `Qwen2.5-VL:7b` via Ollama | Visual reasoning, dial/gauge meter reading, technical diagram inspection | **Requires Lock** (`Max Active = 1`) | Loaded on demand; released upon task completion |
| **Coding Agent** | `Qwen2.5-Coder:7b` via Ollama | Python/JS code synthesis, syntax correction, self-repair loop | **Requires Lock** (`Max Active = 1`) | Loaded on demand; released upon task completion |
| **Research Agent** | Unified Retrieval Service | Knowledge Base similarity search, chunk ranking, citation generation | **Zero LLM Lock** (Uses CPU/Vector DB & nomic-embed-text) | Vector search does not evict active reasoning LLM weights |
| **Calculator** | Custom AST Parser | High-precision arithmetic, trigonometric, and logarithmic formulas | **Zero LLM Lock** (Deterministic Node.js) | No model interaction; pure CPU execution |
| **Container Sandbox**| Docker Alpine Runtime | Safe, sandboxed code execution (`--network none`, `--read-only`, tmpfs) | **Zero LLM Lock** (Deterministic Container) | Runs in background container; zero LLM footprint |
| **Model Lock** | `modelLock.service.js` | Strict mutex queue serializing inference across all users | **Enforces Max Active LLM = 1** | Decouples active lock from resident memory weights |
| **Vector Database** | Qdrant Engine | Sub-millisecond HNSW vector indexing for confidential manuals | **Zero LLM Lock** | Resident vector service running on localhost |
| **Primary Database**| MongoDB Instance | Chat sessions, message history, user identities, audit records | **Zero LLM Lock** | Persistent document store running on localhost |
