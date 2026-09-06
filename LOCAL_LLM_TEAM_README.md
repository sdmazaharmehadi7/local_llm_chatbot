# Local LLM --- SIH 2026 Team Development Guide

## 1. Project

**SIH Problem Statement:** 26117\
**Project:** Sovereign On-Premise Agentic AI Workbench using Open-Weight
Multimodal LLMs for Confidential Industrial Work.

### Core architecture

``` text
React / Vite Frontend
        ↓
Node.js / FastAPI Backend
        ↓
Orchestrator / Agentic Workflow
        ↓
Local Ollama Models
 ├── Qwen3 8B          → General / Reasoning
 ├── Qwen2.5-Coder 7B  → Coding
 └── Qwen2.5-VL 7B     → Vision / OCR
        ↓
RAG
 ├── nomic-embed-text
 └── Qdrant
        ↓
MongoDB
```

------------------------------------------------------------------------

# 2. Team Responsibilities

  ----------------------------------------------------------------------------
  Member                  Main Responsibility     Branch
  ----------------------- ----------------------- ----------------------------
  **Sayyad**              Agentic Workflow /      `feature/agentic-workflow`
                          Orchestrator            

  **Chaitanya**           RAG Pipeline            `feature/rag`

  **Vijay**               Multi-Model Router +    `feature/model-router`
                          Ollama Integration      

  **Narendra**            Authentication,         `feature/security-testing`
                          Security, Audit +       
                          Testing/Integration     
  ----------------------------------------------------------------------------

## Sayyad --- Agentic Workflow

Build the orchestration layer:

-   Intent detection
-   Agent selection
-   Agent execution flow
-   Planning → execution → observation → final response
-   General Agent
-   Coding Agent
-   Vision Agent
-   Tool interface
-   RAG as a capability/tool
-   Error handling and fallback
-   Keep the orchestrator independent from UI

Do **not** implement RAG internals; coordinate with Chaitanya's RAG
module.

------------------------------------------------------------------------

## Chaitanya --- RAG

Build the complete RAG pipeline:

``` text
Document
   ↓
Text Extraction
   ↓
Chunking
   ↓
nomic-embed-text
   ↓
Qdrant
   ↓
Similarity Search
   ↓
Relevant Chunks
   ↓
LLM
```

Tasks:

-   PDF/DOCX/text ingestion
-   Chunking
-   Embedding generation
-   Qdrant collection management
-   Similarity search
-   Metadata
-   Source/page tracking
-   Retrieval API/service
-   Return sources with retrieved chunks

Example source:

``` text
Inspection_Report.pdf — Page 17
```

Do not build the main orchestrator; expose a clean RAG service/API for
Sayyad's agentic layer.

------------------------------------------------------------------------

## Vijay --- Multi-Model Router + Ollama

Build the model-management layer.

Models:

``` text
qwen3:8b
qwen2.5-coder:7b
qwen2.5vl:7b
nomic-embed-text
```

Tasks:

-   Model registry/configuration
-   Model selection
-   Intent → model mapping
-   Ollama API service
-   Streaming responses
-   Model health checking
-   Lazy model loading
-   Ensure only one chat model is loaded at a time
-   Proper timeout/error handling
-   Keep Ollama externally managed

Important:

**Never start Ollama automatically from the application.**

Do not use:

``` text
ollama serve
ollama run
child_process.spawn()
child_process.exec()
```

The backend should only communicate with an already-running Ollama
server.

------------------------------------------------------------------------

## Narendra --- Security + Testing + Integration

Build the security and reliability foundation.

Tasks:

-   Authentication
-   JWT/session handling
-   RBAC
-   User/workspace permissions
-   Document access control
-   Audit logs
-   API validation
-   Rate limiting where appropriate
-   Error handling
-   Security checks
-   Integration tests
-   API tests
-   Regression testing
-   Verify that users cannot access another user's/workspace's documents

Also maintain a shared testing checklist for the complete system.

------------------------------------------------------------------------

# 3. Git Branch Strategy

**Never work directly on `main`.**

Each member works on their own feature branch.

``` text
main
 │
 ├── feature/agentic-workflow      → Sayyad
 ├── feature/rag                   → Chaitanya
 ├── feature/model-router          → Vijay
 └── feature/security-testing      → Narendra
```

If your feature becomes large, create smaller branches from your feature
branch.

Example:

``` text
feature/rag
   ├── feature/rag-ingestion
   ├── feature/rag-embeddings
   └── feature/rag-retrieval
```

------------------------------------------------------------------------

# 4. First-Time Setup --- Clone the Repository

Each member should clone the repository once.

``` bash
git clone <GITHUB_REPOSITORY_URL>
cd <PROJECT_FOLDER>
```

Check the repository:

``` bash
git status
git branch
git remote -v
```

------------------------------------------------------------------------

# 5. Always Start From Updated Main

Before creating a new branch:

``` bash
git checkout main
git pull origin main
```

Then create your feature branch.

### Sayyad

``` bash
git checkout -b feature/agentic-workflow
```

### Chaitanya

``` bash
git checkout -b feature/rag
```

### Vijay

``` bash
git checkout -b feature/model-router
```

### Narendra

``` bash
git checkout -b feature/security-testing
```

Push the branch:

``` bash
git push -u origin feature/your-branch-name
```

------------------------------------------------------------------------

# 6. Daily Development Workflow

Every time you start working:

``` bash
git checkout your-branch
git pull origin main
```

Then check:

``` bash
git status
```

Work only inside your assigned area.

------------------------------------------------------------------------

# 7. Before Committing

Check changed files:

``` bash
git status
```

Review changes:

``` bash
git diff
```

Run the relevant tests/build.

Then stage:

``` bash
git add .
```

Prefer staging specific files when possible:

``` bash
git add backend/src/services/rag.service.js
```

Commit with a meaningful message:

``` bash
git commit -m "feat: add document retrieval service"
```

Good commit examples:

``` text
feat: add agent intent router
feat: add qdrant retrieval service
feat: add ollama model manager
feat: add workspace permission checks
fix: handle ollama unavailable error
fix: prevent duplicate document chunks
test: add rag retrieval tests
refactor: separate agent execution service
```

------------------------------------------------------------------------

# 8. Push Your Work

``` bash
git push
```

If this is the first push of a new branch:

``` bash
git push -u origin feature/your-branch-name
```

------------------------------------------------------------------------

# 9. Create a Pull Request

After pushing:

1.  Open the GitHub repository.
2.  GitHub will show **Compare & pull request**.
3.  Create the PR.
4.  Base branch: `main`
5.  Compare branch: your feature branch.
6.  Add a clear title.
7.  Describe what you implemented.
8.  Mention testing performed.
9.  Request review from the team.

### PR title example

``` text
feat: implement agentic workflow orchestrator
```

### PR description example

``` text
## What changed

- Added intent routing
- Added agent selection
- Added agent execution flow
- Added error handling

## Testing

- Backend build passed
- API tests passed
- Tested agent routing

## Notes

RAG integration will be connected through Chaitanya's RAG service.
```

------------------------------------------------------------------------

# 10. IMPORTANT --- Do Not Merge Your Own PR

The recommended team flow is:

``` text
Developer
   ↓
Feature branch
   ↓
Push
   ↓
Pull Request
   ↓
Another team member reviews
   ↓
Changes requested / approved
   ↓
Merge into main
```

Do not directly push feature work to `main`.

------------------------------------------------------------------------

# 11. After Your PR Is Merged

Your local `main` may now be outdated.

Run:

``` bash
git checkout main
git pull origin main
```

Then delete the old local feature branch:

``` bash
git branch -d feature/your-branch-name
```

Delete the remote branch if it was not automatically deleted by GitHub:

``` bash
git push origin --delete feature/your-branch-name
```

For your next task, create a fresh branch:

``` bash
git checkout main
git pull origin main
git checkout -b feature/new-task
```

------------------------------------------------------------------------

# 12. If Git Shows Conflicts

Do not panic.

First update your branch:

``` bash
git checkout your-branch
git pull origin main
```

If conflicts occur, Git will show the affected files.

Check:

``` bash
git status
```

Resolve the conflict in the files.

Then:

``` bash
git add .
git commit -m "fix: resolve merge conflicts"
git push
```

If you are unsure about a conflict, **do not force push or delete
files**. Ask the team before proceeding.

------------------------------------------------------------------------

# 13. Never Use These Commands Carelessly

Avoid:

``` bash
git push --force
```

Avoid:

``` bash
git reset --hard
```

Avoid:

``` bash
git clean -fd
```

Avoid directly modifying `main`.

These commands can destroy someone else's work or remove uncommitted
changes.

------------------------------------------------------------------------

# 14. Environment Variables

Never commit `.env`.

`.gitignore` must contain:

``` gitignore
.env
node_modules/
dist/
build/
*.log
.DS_Store
```

Create:

``` text
.env.example
```

with placeholder values only:

``` env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b
MONGODB_URI=
QDRANT_URL=
JWT_SECRET=
```

Never commit:

``` text
API keys
OAuth secrets
JWT secrets
MongoDB passwords
Google client secrets
private credentials
```

------------------------------------------------------------------------

# 15. Shared Development Rules

### Rule 1 --- Pull before starting

``` bash
git checkout main
git pull origin main
```

### Rule 2 --- Create your own branch

``` bash
git checkout -b feature/<task>
```

### Rule 3 --- Do not modify another member's feature unnecessarily

Coordinate before changing their core files.

### Rule 4 --- Keep commits small

Prefer:

``` text
feat: add chunking service
feat: add qdrant search
```

instead of one huge:

``` text
final project changes
```

### Rule 5 --- Test before pushing

At minimum:

``` bash
git diff
git status
```

Then run the appropriate build/tests.

### Rule 6 --- Keep `main` stable

Only reviewed and working code should enter `main`.

------------------------------------------------------------------------

# 16. Coordination Between Team Members

The dependencies are:

``` text
Vijay
Model Router / Ollama
       ↓
Sayyad
Agentic Orchestrator
       ↓
Chaitanya
RAG Capability
       ↓
Narendra
Security + Integration + Testing
```

However, development can happen in parallel.

### Integration contracts

Chaitanya should expose a clean interface similar to:

``` js
await retrieveRelevantChunks(query, options)
```

Vijay should expose a model interface similar to:

``` js
await getAvailableModels()
await selectModel(model)
await streamChat(model, messages)
```

Sayyad should consume these services instead of duplicating their
internal logic.

Narendra should test the interfaces without rewriting their internals.

------------------------------------------------------------------------

# 17. Recommended Folder Ownership

Example:

``` text
backend/
├── src/
│   ├── agents/          ← Sayyad
│   ├── orchestrator/    ← Sayyad
│   ├── rag/             ← Chaitanya
│   ├── models/          ← Vijay
│   ├── ollama/          ← Vijay
│   ├── auth/            ← Narendra
│   ├── security/        ← Narendra
│   ├── audit/           ← Narendra
│   └── routes/
│
frontend/
└── ...
```

The exact folder structure should follow the existing project
architecture rather than creating duplicate patterns.

------------------------------------------------------------------------

# 18. Team Integration Order

Recommended merge order:

``` text
1. Vijay
   ↓
   Stable Ollama/model service

2. Chaitanya
   ↓
   Stable RAG service

3. Sayyad
   ↓
   Orchestrator integrates models + RAG

4. Narendra
   ↓
   Security + integration testing + hardening
```

If another dependency is ready earlier, merge it after review. The order
is a recommendation, not a strict requirement.

------------------------------------------------------------------------

# 19. Before the SIH Demo

All team members must verify:

-   [ ] Application runs locally
-   [ ] Backend starts correctly
-   [ ] Frontend starts correctly
-   [ ] Ollama connection works
-   [ ] Model routing works
-   [ ] Agentic workflow works
-   [ ] RAG ingestion works
-   [ ] RAG retrieval works
-   [ ] Sources are returned
-   [ ] Authentication works
-   [ ] RBAC works
-   [ ] Audit logs work
-   [ ] Error handling works
-   [ ] No secrets are committed
-   [ ] No unnecessary cloud AI dependency exists
-   [ ] `main` builds successfully

------------------------------------------------------------------------

# 20. Golden Git Workflow

Every member should remember this:

``` bash
# 1. Get latest main
git checkout main
git pull origin main

# 2. Create your branch
git checkout -b feature/<your-task>

# 3. Work on your task

# 4. Check changes
git status
git diff

# 5. Commit
git add .
git commit -m "feat: describe your change"

# 6. Push
git push -u origin feature/<your-task>

# 7. Open GitHub
# Create Pull Request → main

# 8. Get review
# Fix requested changes if any

# 9. After merge
git checkout main
git pull origin main

# 10. Start the next task from updated main
git checkout -b feature/<next-task>
```

------------------------------------------------------------------------

## Team Rule

**One person → one task → one feature branch → commits → push → Pull
Request → review → merge.**

Do not work directly on `main`.

Do not overwrite another member's branch.

Do not commit secrets.

Keep interfaces between Agentic Workflow, RAG, Model Router, and
Security clearly defined.
