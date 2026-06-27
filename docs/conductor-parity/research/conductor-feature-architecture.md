Based on my extensive research of the Conductor documentation, let me compile a comprehensive summary of what I've found:

## Summary of Conductor Features - Architecture Research

Based on my research of Conductor's public documentation at conductor.build, here's a structured summary of each feature's architecture:

### 1. **Diff Viewer**

**Available Information:**

- **User-Facing Functionality**: Accessible via Command+Shift+D, enables review of workspace changes across multiple files
- **Capabilities**:
  - Unified and commit-filtered diff views
  - File-by-file navigation through changed files
  - Inline comment addition for specific lines
  - Integration with GitHub review comments
  - Line-by-line change highlighting

**Architecture Details NOT Publicly Available:**

- Internal data structures for diff representation
- Specific diffing algorithm used
- Git command implementation
- Inline comment storage/retrieval mechanism
- Rendering engine details

### 2. **PR Creation UI & Workflow**

**Available Information:**

- **User-Facing Workflow**: PR creation initiated via Command+Shift+P
- **Capabilities**:
  - Conductor assists with draft PR descriptions
  - Responds to review comments
  - Fixes failing checks
  - Prepares branch for merge
  - Integrates with GitHub's standard PR workflow

**Architecture Details NOT Publicly Available:**

- GitHub API endpoints called during PR creation
- OAuth/authentication flow specifics
- Request/response payloads
- PR metadata handling
- Comment synchronization mechanism

### 3. **Checks Tab**

**Data Sources Monitored:**

- Git status (tracked by version control layer)
- Pull request metadata (from GitHub)
- CI and status checks (from GitHub Actions, third-party CI systems)
- Deployments (from deployment platforms)
- GitHub comments and review threads
- Todos (task tracking)

**Architecture Characteristics:**

- **Aggregation Model**: Pulls status from multiple external sources
- **Conditional Rendering**: Display adapts based on repository configuration and enabled integrations
- **Blocking Logic**: Prevents merge when "unresolved todos or failed checks" exist
- **Real-Time Monitoring**: Follows GitHub Actions and status checks continuously

**Implementation Details NOT Publicly Available:**

- Data refresh frequency/polling mechanism
- Internal state data model
- Specific integration endpoints
- Comment resolution tracking system
- Todo extraction and parsing logic

### 4. **Custom Providers & Open Code Integration**

**Architecture Details AVAILABLE:**

**Provider Model:**

- OpenCode functions as "an open source AI coding harness"
- Supports distributed provider architecture (not monolithic)
- Supports multiple LLM providers: OpenRouter, Baseten, Cerebras, Vercel AI Gateway

**Credential Handling - Three-Tier Model:**

1. Conductor-saved API keys for integrated providers
2. Environment variables (shell or Conductor settings)
3. External OpenCode configurations (custom installations)

**Model Management:**

- Dynamic model discovery queried from OpenCode based on configured credentials
- Provider-qualified model naming convention: `provider/model-name` (e.g., `anthropic/claude-sonnet-4-5`)
- Model picker displays available options based on active provider

**Configuration:**

- Managed bundled OpenCode executable
- Supports custom OpenCode paths via harness settings (infrastructure flexibility)
- Settings accessible via Conductor app Settings > Harnesses > OpenCode

**Status Information Available:**

- Provider availability status
- Saved API keys display
- Visible models list
- Executable path configuration

**Implementation Details NOT Publicly Available:**

- Token counting and billing integration
- Provider authentication protocols
- Model routing algorithms
- Rate limiting mechanisms
- Caching strategies

### 5. **Overall Workflow Architecture**

**Core Design Principle:**

- "The workspace is the unit of delegation. The branch and pull request are the unit of integration."

**Workflow Sequence:**

1. Break work into shippable units
2. Create isolated workspaces (own branch, working tree, file system)
3. Run agents independently (agents can change code, run commands, build context)
4. Verify and review via:
   - Diff Viewer (Command+Shift+D)
   - Terminal and testing tools
   - Manual review with inline comments
   - Checks tab inspection
5. Create PR (Command+Shift+P)
6. GitHub Actions/status checks monitoring
7. Merge and archive with chat history preservation

**Key Architectural Principles:**

- Workspace isolation prevents collision between agents and main checkout
- Each workspace has independent branch tracking
- Chat history preserved across workspace lifecycle
- Integration points: GitHub PRs, status checks, CI workflows, issue tracking (GitHub & Linear)

---

**IMPORTANT LIMITATION:** Conductor's public documentation is deliberately **user-focused rather than architect-focused**. The documentation explains how to use features but does not provide implementation details such as:

- Specific algorithms (diffing, parsing, merging)
- Data structures and schemas
- API contracts and endpoints
- Persistence mechanisms
- Caching and performance strategies
- Authentication/authorization implementation

To obtain these technical specifications, you would need access to Conductor's internal engineering documentation, API reference materials, or source code repositories—materials not published in their public documentation.
